// Talks directly to OneHome's public services API (services.onehome.com sends
// Access-Control-Allow-Origin: * on these endpoints, so no server-side proxy is needed).

const ONEHOME_SERVICES = 'https://services.onehome.com';

const SAVED_SEARCH_QUERY = `query GetSavedSearchBySearchId($searchId: String!) {
  savedSearch(id: $searchId) {
    id
    name
    listingIds
    __typename
  }
}`;

const SAVED_LISTINGS_QUERY = `query GetSavedListings($groupId: String!, $listingIds: [String!]!, $sort: SortCriteria, $pageInput: PageInput, $savedSearchId: String!, $includeDislikes: Boolean!, $suppressEvent: Boolean!) {
  listingsBySavedSearchId(groupId: $groupId, osks: $listingIds, sort: $sort, pageInput: $pageInput, savedSearchId: $savedSearchId, includeDislikes: $includeDislikes, suppressEvent: $suppressEvent) {
    pageInfo { totalElements totalPages pageNumber pageSize __typename }
    listings {
      id
      property {
        OriginatingSystemKey StreetNumber StreetName StreetSuffix StreetDirPrefix StreetDirSuffix
        UnitNumber City StateOrProvince PostalCode ListPrice PropertyType PropertySubType
        BedroomsTotal BathroomsTotalInteger LivingArea LivingAreaUnits StandardStatus
        MajorChangeTimestamp ListingId CommonInterest
        __typename
      }
      media {
        MediaKey MediaType Order ImageOf
        Image { Thumbnail { mediaUrl __typename } Medium { mediaUrl __typename } __typename }
        __typename
      }
      __typename
    }
    __typename
  }
}`;

const LISTING_DETAIL_QUERY = `query ListingById($listingId: String!, $groupId: String!, $savedSearchId: String, $suppressEvent: Boolean = true) {
  listingDetail(listingId: $listingId, groupId: $groupId, savedSearchId: $savedSearchId, suppressEvent: $suppressEvent) {
    id
    property {
      ParkingTotal ParkingFeatures CarportYN CarportSpaces GarageYN GarageSpaces AttachedGarageYN CoveredSpaces
      LaundryFeatures AssociationFeeIncludes AssociationFee AssociationFeeFrequency
      RentIncludes TenantPays OwnerPays PetsAllowed Furnished LeaseTerm AvailabilityDate
      Utilities WaterSource PublicRemarks
      __typename
    }
    __typename
  }
}`;

/** Extracts the OneHome share id from a pasted URL or raw id string. */
function parseShareId(input) {
  const trimmed = (input || '').trim();
  const match = trimmed.match(/share\/([A-Za-z0-9]+)/i);
  if (match) return match[1];
  if (/^[A-Za-z0-9]+$/.test(trimmed)) return trimmed;
  return null;
}

async function gqlFetch(operationName, variables, query, sessionToken) {
  const res = await fetch(`${ONEHOME_SERVICES}/graphql?${operationName}`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ operationName, variables, query }),
  });
  if (!res.ok) throw new Error(`${operationName} failed: HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors && json.errors.length) {
    throw new Error(`${operationName} failed: ${json.errors[0].message}`);
  }
  return json.data;
}

/** Step 1+2: exchange a share id for a session token + saved search id + a reusable "portal token". */
async function authenticateShare(shareId) {
  const shareRes = await fetch(`${ONEHOME_SERVICES}/api/authentication/checkShare/${encodeURIComponent(shareId)}`, {
    headers: { accept: 'application/json', 'content-type': 'application/json' },
  });
  if (!shareRes.ok) {
    throw new Error(shareRes.status === 404
      ? 'That share link was not found. Double-check the URL your agent sent you.'
      : `Could not reach OneHome (HTTP ${shareRes.status}).`);
  }
  const { emailToken } = await shareRes.json();
  if (!emailToken) throw new Error('OneHome did not return a valid share token for this link.');

  const tokenRes = await fetch(`${ONEHOME_SERVICES}/api/authentication/checkToken`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ emailToken }),
  });
  if (!tokenRes.ok) throw new Error('This share link appears to have expired.');
  const tokenData = await tokenRes.json();
  if (!tokenData.sessionToken || !tokenData.savedSearchID) {
    throw new Error('OneHome did not return session details for this link.');
  }

  return {
    sessionToken: tokenData.sessionToken,
    savedSearchId: tokenData.savedSearchID,
    portalToken: emailToken, // same token OneHome's own UI appends as ?token= on deep links
  };
}

async function fetchListingIds(auth) {
  const data = await gqlFetch(
    'GetSavedSearchBySearchId',
    { searchId: auth.savedSearchId },
    SAVED_SEARCH_QUERY,
    auth.sessionToken
  );
  return data.savedSearch.listingIds;
}

async function fetchListingSummaries(auth, listingIds) {
  const data = await gqlFetch(
    'GetSavedListings',
    {
      groupId: '',
      listingIds,
      sort: { name: 'property.MajorChangeTimestamp', order: 'DESC' },
      pageInput: { pageNum: 0, size: listingIds.length || 1 },
      savedSearchId: auth.savedSearchId,
      includeDislikes: false,
      suppressEvent: true,
    },
    SAVED_LISTINGS_QUERY,
    auth.sessionToken
  );
  return data.listingsBySavedSearchId.listings;
}

async function fetchListingDetail(auth, listingId) {
  const data = await gqlFetch(
    'ListingById',
    { listingId, groupId: '', savedSearchId: auth.savedSearchId, suppressEvent: true },
    LISTING_DETAIL_QUERY,
    auth.sessionToken
  );
  return data.listingDetail;
}

/**
 * Fetches every listing's extra detail fields (parking/laundry/utilities) with a
 * small concurrency pool, reporting progress via onProgress(done, total).
 */
async function fetchAllDetails(auth, summaries, onProgress) {
  const results = new Array(summaries.length);
  let nextIndex = 0;
  let done = 0;
  const CONCURRENCY = 6;

  async function worker() {
    while (nextIndex < summaries.length) {
      const myIndex = nextIndex++;
      try {
        results[myIndex] = await fetchListingDetail(auth, summaries[myIndex].id);
      } catch (e) {
        results[myIndex] = null;
      }
      done++;
      if (onProgress) onProgress(done, summaries.length);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

/** Builds the deep link back to this listing on the agent's OneHome portal. */
function buildPortalUrl(auth, listingId) {
  const params = new URLSearchParams({ token: auth.portalToken, searchId: auth.savedSearchId });
  return `https://portal.onehome.com/en-CA/property/${encodeURIComponent(listingId)}?${params.toString()}`;
}

window.OneHomeAPI = {
  parseShareId,
  authenticateShare,
  fetchListingIds,
  fetchListingSummaries,
  fetchAllDetails,
  buildPortalUrl,
};
