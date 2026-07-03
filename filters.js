// Turns raw RESO/MLS fields into simple yes/no/unknown signals for the filter UI.

const WATER_POSITIVE_OWNER_TERMS = ['Water', 'HotWater'];
const WATER_ASSOC_FEE_TERMS = ['Water'];

const PARKING_NEGATIVE_FEATURES = ['NoDriveway', 'None', 'NoParking'];

const LAUNDRY_POSITIVE_TERMS = [
  'InUnit', 'Inside', 'LaundryCloset', 'MainLevel', 'Ensuite', 'InBasement',
  'UpperLevel', 'LowerLevel', 'LaundryRoom', 'ElectricDryerHookup', 'WasherHookup',
];
const LAUNDRY_NEGATIVE_TERMS = [
  'CommonArea', 'Common', 'Coin', 'CoinOperated', 'Community', 'Shared', 'SharedLaundry', 'None', 'Outside',
];

const CONDO_SUBTYPE_PATTERN = /condo|apartment/i;

function toArray(v) {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function num(v) {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

/** yes | no | unknown */
function deriveWaterStatus(property) {
  if (!property) return 'unknown';
  const ownerPays = toArray(property.OwnerPays);
  const tenantPays = toArray(property.TenantPays);
  const rentIncludes = toArray(property.RentIncludes);
  const assocIncludes = toArray(property.AssociationFeeIncludes);

  const ownerCovers =
    ownerPays.some(v => WATER_POSITIVE_OWNER_TERMS.includes(v)) ||
    rentIncludes.some(v => WATER_POSITIVE_OWNER_TERMS.includes(v)) ||
    assocIncludes.some(v => WATER_ASSOC_FEE_TERMS.includes(v));

  const tenantCovers = tenantPays.includes('Water');

  if (ownerCovers && !tenantCovers) return 'yes';
  if (tenantCovers && !ownerCovers) return 'no';
  if (ownerCovers && tenantCovers) return 'yes'; // owner-pays signal takes precedence when both mention it
  return 'unknown';
}

/** yes | no | unknown */
function deriveParkingStatus(property) {
  if (!property) return 'unknown';
  const total = num(property.ParkingTotal);
  const garageSpaces = num(property.GarageSpaces);
  const carportSpaces = num(property.CarportSpaces);
  const coveredSpaces = num(property.CoveredSpaces);
  const features = toArray(property.ParkingFeatures);

  const anyPositiveCount = [total, garageSpaces, carportSpaces, coveredSpaces].some(n => n !== null && n > 0);
  const yesFlags = [property.GarageYN, property.CarportYN, property.AttachedGarageYN].some(v => v === true);
  const hasPositiveFeature = features.some(f => !PARKING_NEGATIVE_FEATURES.includes(f));

  if (anyPositiveCount || yesFlags || hasPositiveFeature) return 'yes';

  const explicitlyNone =
    (total === 0 && features.length === 0) ||
    features.every(f => PARKING_NEGATIVE_FEATURES.includes(f)) && features.length > 0;

  if (explicitlyNone) return 'no';
  return 'unknown';
}

/** yes | no | unknown */
function deriveLaundryStatus(property) {
  if (!property) return 'unknown';
  const features = toArray(property.LaundryFeatures);
  if (features.length === 0) return 'unknown';

  const hasPositive = features.some(f => LAUNDRY_POSITIVE_TERMS.includes(f));
  const hasNegative = features.some(f => LAUNDRY_NEGATIVE_TERMS.includes(f));

  if (hasPositive) return 'yes';
  if (hasNegative) return 'no';
  return 'unknown';
}

function isCondoLike(property) {
  if (!property) return false;
  if (property.CommonInterest === 'Condominium') return true;
  return CONDO_SUBTYPE_PATTERN.test(property.PropertySubType || '');
}

/** Merges a summary listing + its detail fetch into one flat record the UI renders from. */
function buildListingRecord(summary, detail) {
  const summaryProp = summary.property || {};
  const detailProp = (detail && detail.property) || {};
  const merged = { ...summaryProp, ...detailProp };

  const image =
    (summary.media || []).find(m => m.Image && m.Image.Medium && m.Image.Medium.mediaUrl) ||
    (summary.media || []).find(m => m.Image && m.Image.Thumbnail && m.Image.Thumbnail.mediaUrl);
  const imageUrl = image
    ? (image.Image.Medium && image.Image.Medium.mediaUrl) || image.Image.Thumbnail.mediaUrl
    : null;

  const addressParts = [
    merged.StreetNumber,
    merged.StreetDirPrefix,
    merged.StreetName,
    merged.StreetSuffix,
    merged.StreetDirSuffix,
  ].filter(Boolean);
  let streetAddress = addressParts.join(' ');
  if (merged.UnitNumber) streetAddress += ` #${merged.UnitNumber}`;

  return {
    id: summary.id,
    imageUrl,
    streetAddress,
    city: merged.City,
    stateOrProvince: merged.StateOrProvince,
    postalCode: merged.PostalCode,
    listPrice: merged.ListPrice,
    beds: merged.BedroomsTotal,
    baths: merged.BathroomsTotalInteger,
    livingArea: merged.LivingArea,
    livingAreaUnits: merged.LivingAreaUnits,
    propertySubType: merged.PropertySubType || 'Unknown',
    status: merged.StandardStatus,
    mlsId: merged.ListingId,
    petsAllowed: merged.PetsAllowed,
    availabilityDate: merged.AvailabilityDate,
    remarks: merged.PublicRemarks,
    isCondo: isCondoLike(merged),
    waterStatus: deriveWaterStatus(merged),
    parkingStatus: deriveParkingStatus(merged),
    laundryStatus: deriveLaundryStatus(merged),
    hasDetail: !!detail,
    _raw: merged,
  };
}

window.OneHomeFilters = { buildListingRecord, deriveWaterStatus, deriveParkingStatus, deriveLaundryStatus, isCondoLike };
