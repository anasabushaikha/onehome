(function () {
  const { parseShareId, authenticateShare, fetchListingIds, fetchListingSummaries, fetchAllDetails, buildPortalUrl } = window.OneHomeAPI;
  const { buildListingRecord } = window.OneHomeFilters;

  const els = {
    form: document.getElementById('share-form'),
    input: document.getElementById('share-url'),
    loadBtn: document.getElementById('load-btn'),
    status: document.getElementById('load-status'),
    progressBar: document.getElementById('progress-bar'),
    progressWrap: document.getElementById('progress-wrap'),
    filtersPanel: document.getElementById('filters-panel'),
    results: document.getElementById('results'),
    resultsSummary: document.getElementById('results-summary'),
    sortSelect: document.getElementById('sort-select'),
    propertyTypeChecks: document.getElementById('property-type-checks'),
    condoOnly: document.getElementById('condo-only'),
    waterFilter: document.getElementById('water-filter'),
    parkingFilter: document.getElementById('parking-filter'),
    laundryFilter: document.getElementById('laundry-filter'),
    statusFilter: document.getElementById('status-filter'),
    priceMin: document.getElementById('price-min'),
    priceMax: document.getElementById('price-max'),
    bedsMin: document.getElementById('beds-min'),
    resetBtn: document.getElementById('reset-filters'),
    errorBox: document.getElementById('error-box'),
    searchMeta: document.getElementById('search-meta'),
  };

  let state = {
    auth: null,
    listings: [], // built records
    propertyTypes: [], // distinct subtypes found
  };

  const LAST_URL_KEY = 'onehome-filter:last-url';

  function setStatus(text) {
    els.status.textContent = text || '';
  }

  function showError(message) {
    els.errorBox.textContent = message;
    els.errorBox.hidden = !message;
  }

  function setLoading(isLoading) {
    els.loadBtn.disabled = isLoading;
    els.loadBtn.textContent = isLoading ? 'Loading…' : 'Load listings';
    els.progressWrap.hidden = !isLoading;
    if (!isLoading) els.progressBar.style.width = '0%';
  }

  function money(n) {
    if (n === null || n === undefined) return '—';
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  }

  function badge(label, statusValue) {
    const cls = statusValue === 'yes' ? 'badge-yes' : statusValue === 'no' ? 'badge-no' : 'badge-unknown';
    const icon = statusValue === 'yes' ? '✓' : statusValue === 'no' ? '✕' : '?';
    return `<span class="badge ${cls}" title="${label}: ${statusValue}">${icon} ${label}</span>`;
  }

  async function loadFromShareUrl(rawInput) {
    showError('');
    const shareId = parseShareId(rawInput);
    if (!shareId) {
      showError('Could not find a share ID in that link. Paste the full link your agent sent you (e.g. https://portal.onehome.com/en-CA/share/XXXXXXX).');
      return;
    }

    setLoading(true);
    els.filtersPanel.hidden = true;
    els.results.innerHTML = '';
    els.resultsSummary.textContent = '';

    try {
      setStatus('Authenticating with OneHome…');
      const auth = await authenticateShare(shareId);

      setStatus('Fetching listing IDs…');
      const listingIds = await fetchListingIds(auth);
      if (!listingIds.length) {
        showError('This share link has no listings on it.');
        setLoading(false);
        return;
      }

      setStatus(`Fetching ${listingIds.length} listings…`);
      const summaries = await fetchListingSummaries(auth, listingIds);

      setStatus(`Fetching details (parking, laundry, utilities)…`);
      const details = await fetchAllDetails(auth, summaries, (done, total) => {
        setStatus(`Fetching details… ${done}/${total}`);
        els.progressBar.style.width = `${Math.round((done / total) * 100)}%`;
      });

      const records = summaries.map((s, i) => buildListingRecord(s, details[i]));

      state.auth = auth;
      state.listings = records;
      state.propertyTypes = [...new Set(records.map(r => r.propertySubType))].sort();

      localStorage.setItem(LAST_URL_KEY, rawInput);

      setStatus(`Loaded ${records.length} listings.`);
      renderFilterOptions();
      els.filtersPanel.hidden = false;
      applyFiltersAndRender();
    } catch (err) {
      console.error(err);
      showError(err.message || 'Something went wrong loading this share link.');
      setStatus('');
    } finally {
      setLoading(false);
    }
  }

  function renderFilterOptions() {
    els.propertyTypeChecks.innerHTML = state.propertyTypes
      .map(
        (t, i) => `
        <label class="checkbox-row">
          <input type="checkbox" class="ptype-check" value="${t}" checked />
          ${t}
        </label>`
      )
      .join('');
    els.propertyTypeChecks.querySelectorAll('.ptype-check').forEach(cb => {
      cb.addEventListener('change', applyFiltersAndRender);
    });

    const prices = state.listings.map(l => l.listPrice).filter(p => typeof p === 'number');
    if (prices.length) {
      els.priceMin.placeholder = `Min (e.g. ${Math.min(...prices)})`;
      els.priceMax.placeholder = `Max (e.g. ${Math.max(...prices)})`;
    }
  }

  function currentFilters() {
    const checkedTypes = [...els.propertyTypeChecks.querySelectorAll('.ptype-check:checked')].map(cb => cb.value);
    return {
      condoOnly: els.condoOnly.checked,
      propertyTypes: new Set(checkedTypes),
      water: els.waterFilter.value, // any | yes | no
      parking: els.parkingFilter.value,
      laundry: els.laundryFilter.value,
      statusFilter: els.statusFilter.value, // any | active
      priceMin: els.priceMin.value ? Number(els.priceMin.value) : null,
      priceMax: els.priceMax.value ? Number(els.priceMax.value) : null,
      bedsMin: els.bedsMin.value ? Number(els.bedsMin.value) : null,
    };
  }

  function matches(listing, f) {
    if (f.condoOnly && !listing.isCondo) return false;
    if (!f.condoOnly && f.propertyTypes.size && !f.propertyTypes.has(listing.propertySubType)) return false;
    if (f.water !== 'any' && listing.waterStatus !== f.water) return false;
    if (f.parking !== 'any' && listing.parkingStatus !== f.parking) return false;
    if (f.laundry !== 'any' && listing.laundryStatus !== f.laundry) return false;
    if (f.statusFilter === 'active' && listing.status !== 'Active') return false;
    if (f.priceMin !== null && (listing.listPrice === null || listing.listPrice < f.priceMin)) return false;
    if (f.priceMax !== null && (listing.listPrice === null || listing.listPrice > f.priceMax)) return false;
    if (f.bedsMin !== null && (listing.beds === null || listing.beds < f.bedsMin)) return false;
    return true;
  }

  function sortListings(list) {
    const mode = els.sortSelect.value;
    const copy = [...list];
    if (mode === 'price-asc') copy.sort((a, b) => (a.listPrice ?? Infinity) - (b.listPrice ?? Infinity));
    else if (mode === 'price-desc') copy.sort((a, b) => (b.listPrice ?? -Infinity) - (a.listPrice ?? -Infinity));
    else if (mode === 'beds-desc') copy.sort((a, b) => (b.beds ?? -Infinity) - (a.beds ?? -Infinity));
    return copy;
  }

  function applyFiltersAndRender() {
    const f = currentFilters();
    const filtered = sortListings(state.listings.filter(l => matches(l, f)));
    els.resultsSummary.textContent = `Showing ${filtered.length} of ${state.listings.length} listings`;
    els.results.innerHTML = filtered.map(renderCard).join('') || '<p class="empty-state">No listings match these filters.</p>';
  }

  function renderCard(listing) {
    const portalUrl = state.auth ? buildPortalUrl(state.auth, listing.id) : '#';
    const img = listing.imageUrl
      ? `<img src="${listing.imageUrl}" alt="${escapeHtml(listing.streetAddress)}" loading="lazy" />`
      : `<div class="img-placeholder">No photo</div>`;
    const statusPill = listing.status && listing.status !== 'Active'
      ? `<span class="status-pill">${escapeHtml(listing.status)}</span>`
      : '';

    return `
      <article class="card">
        <div class="card-img">${img}${statusPill}</div>
        <div class="card-body">
          <div class="card-price">${money(listing.listPrice)}<span class="card-permonth">/mo</span></div>
          <div class="card-subtype">${escapeHtml(listing.propertySubType)}</div>
          <div class="card-address">${escapeHtml(listing.streetAddress)}</div>
          <div class="card-citystate">${escapeHtml([listing.city, listing.stateOrProvince].filter(Boolean).join(', '))} ${escapeHtml(listing.postalCode || '')}</div>
          <div class="card-stats">
            ${listing.beds !== null && listing.beds !== undefined ? `${listing.beds} bd` : '—'} ·
            ${listing.baths !== null && listing.baths !== undefined ? `${listing.baths} ba` : '—'} ·
            ${listing.livingArea ? `${listing.livingArea} ${listing.livingAreaUnits || 'sqft'}` : 'sqft n/a'}
          </div>
          <div class="card-badges">
            ${badge('Condo', listing.isCondo ? 'yes' : 'no')}
            ${badge('Water', listing.waterStatus)}
            ${badge('Parking', listing.parkingStatus)}
            ${badge('In-suite laundry', listing.laundryStatus)}
          </div>
          <div class="card-footer">
            <span class="mls-id">${listing.mlsId ? `MLS® #${escapeHtml(listing.mlsId)}` : ''}</span>
            <a href="${portalUrl}" target="_blank" rel="noopener">View on OneHome ↗</a>
          </div>
        </div>
      </article>`;
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function resetFilters() {
    els.condoOnly.checked = false;
    els.propertyTypeChecks.querySelectorAll('.ptype-check').forEach(cb => (cb.checked = true));
    els.waterFilter.value = 'any';
    els.parkingFilter.value = 'any';
    els.laundryFilter.value = 'any';
    els.statusFilter.value = 'any';
    els.priceMin.value = '';
    els.priceMax.value = '';
    els.bedsMin.value = '';
    els.sortSelect.value = 'newest';
    applyFiltersAndRender();
  }

  els.form.addEventListener('submit', e => {
    e.preventDefault();
    loadFromShareUrl(els.input.value);
  });

  [els.condoOnly, els.waterFilter, els.parkingFilter, els.laundryFilter, els.statusFilter, els.sortSelect].forEach(el =>
    el.addEventListener('change', applyFiltersAndRender)
  );
  [els.priceMin, els.priceMax, els.bedsMin].forEach(el => el.addEventListener('input', debounce(applyFiltersAndRender, 300)));
  els.resetBtn.addEventListener('click', resetFilters);

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // Prefill with the last-used share link for convenience.
  const lastUrl = localStorage.getItem(LAST_URL_KEY);
  if (lastUrl) els.input.value = lastUrl;
})();
