(function () {
  const { parseOneHomeLink, authenticateFromLink, fetchListingIds, fetchListingSummaries, fetchAllDetails, buildPortalUrl } = window.OneHomeAPI;
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
    domSlider: document.getElementById('dom-slider'),
    domSliderLabel: document.getElementById('dom-slider-label'),
    resetBtn: document.getElementById('reset-filters'),
    errorBox: document.getElementById('error-box'),
    searchMeta: document.getElementById('search-meta'),
    saveFavBtn: document.getElementById('save-fav-btn'),
    favoritesRow: document.getElementById('favorites-row'),
  };

  let state = {
    auth: null,
    listings: [], // built records
    propertyTypes: [], // distinct subtypes found
  };

  const LAST_URL_KEY = 'onehome-filter:last-url';
  const FAVORITES_KEY = 'onehome-filter:favorites';
  const DEFAULT_FAVORITES = [
    {
      label: 'My OneHome Properties',
      url: 'https://portal.onehome.com/en-CA/properties?token=eyJPU04iOiJJVFNPIiwidHlwZSI6IjEiLCJjb250YWN0aWQiOjg1NTkxMTAsInNldGlkIjoiMTI3MDI0NCIsInNldGtleSI6IjQ2MiIsImVtYWlsIjoiYW5hcy5hYnVzaGFpa2hhQG91dGxvb2suY29tIiwicmVzb3VyY2VpZCI6MCwiYWdlbnRpZCI6MTI0ODM5LCJpc2RlbHRhIjpmYWxzZSwiVmlld01vZGUiOiIxIn0=&SMS=0',
    },
  ];

  function loadFavorites() {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      if (raw === null) {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(DEFAULT_FAVORITES));
        return [...DEFAULT_FAVORITES];
      }
      return JSON.parse(raw);
    } catch (e) {
      return [...DEFAULT_FAVORITES];
    }
  }

  function saveFavoritesList(list) {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
  }

  function renderFavorites() {
    const favorites = loadFavorites();
    els.favoritesRow.innerHTML = favorites.length
      ? favorites
          .map(
            (f, i) => `
        <button type="button" class="fav-chip" data-index="${i}">
          <span class="fav-label">${escapeHtml(f.label)}</span>
          <span class="fav-remove" data-remove-index="${i}" title="Remove">×</span>
        </button>`
          )
          .join('')
      : '<span class="fav-empty">No saved links yet — click ☆ Save to add this one.</span>';

    els.favoritesRow.querySelectorAll('.fav-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = Number(btn.dataset.removeIndex);
        const favorites = loadFavorites();
        favorites.splice(idx, 1);
        saveFavoritesList(favorites);
        renderFavorites();
      });
    });

    els.favoritesRow.querySelectorAll('.fav-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const idx = Number(chip.dataset.index);
        const fav = loadFavorites()[idx];
        if (fav) {
          els.input.value = fav.url;
          loadFromShareUrl(fav.url);
        }
      });
    });
  }

  function saveCurrentAsFavorite() {
    const url = els.input.value.trim();
    if (!url) {
      showError('Paste a link first, then save it.');
      return;
    }
    const label = window.prompt('Name this saved search:', 'My Search');
    if (label === null) return;
    const favorites = loadFavorites();
    favorites.push({ label: label.trim() || 'Saved search', url });
    saveFavoritesList(favorites);
    renderFavorites();
  }

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
    const parsed = parseOneHomeLink(rawInput);
    if (!parsed) {
      showError('Could not read that link. Paste a full OneHome link your agent sent you (e.g. https://portal.onehome.com/en-CA/share/XXXXXXX or .../properties?token=...).');
      return;
    }

    setLoading(true);
    els.filtersPanel.hidden = true;
    els.results.innerHTML = '';
    els.resultsSummary.textContent = '';

    try {
      setStatus('Authenticating with OneHome…');
      const auth = await authenticateFromLink(parsed);

      setStatus('Fetching listing IDs…');
      const listingIds = await fetchListingIds(auth);
      if (!listingIds.length) {
        showError('This link has no listings on it.');
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
      showError(err.message || 'Something went wrong loading this link.');
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

    const domValues = state.listings.map(l => l.daysOnMarket).filter(d => typeof d === 'number');
    const maxDom = domValues.length ? Math.max(...domValues) : 0;
    els.domSlider.max = String(maxDom);
    els.domSlider.value = String(maxDom);
    updateDomSliderLabel(maxDom, maxDom);
  }

  function updateDomSliderLabel(value, max) {
    els.domSliderLabel.textContent = value >= max ? 'Any' : `${value} day${value === 1 ? '' : 's'} or less`;
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
      domMax: Number(els.domSlider.value),
      domAtMax: Number(els.domSlider.value) >= Number(els.domSlider.max),
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
    if (!f.domAtMax && (listing.daysOnMarket === null || listing.daysOnMarket === undefined || listing.daysOnMarket > f.domMax)) return false;
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

  function formatDaysOnMarket(days) {
    if (days === null || days === undefined) return null;
    if (days <= 0) return 'Listed today';
    if (days === 1) return '1 day on market';
    return `${days} days on market`;
  }

  function renderCard(listing) {
    const portalUrl = state.auth ? buildPortalUrl(state.auth, listing.id) : '#';
    const img = listing.imageUrl
      ? `<img src="${listing.imageUrl}" alt="${escapeHtml(listing.streetAddress)}" loading="lazy" />`
      : `<div class="img-placeholder">No photo</div>`;
    const statusPill = listing.status && listing.status !== 'Active'
      ? `<span class="status-pill">${escapeHtml(listing.status)}</span>`
      : '';
    const domText = formatDaysOnMarket(listing.daysOnMarket);

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
          ${domText ? `<div class="card-dom">${escapeHtml(domText)}</div>` : ''}
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
    els.domSlider.value = els.domSlider.max;
    updateDomSliderLabel(Number(els.domSlider.value), Number(els.domSlider.max));
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
  const debouncedApplyFilters = debounce(applyFiltersAndRender, 80);
  els.domSlider.addEventListener('input', () => {
    updateDomSliderLabel(Number(els.domSlider.value), Number(els.domSlider.max));
    debouncedApplyFilters();
  });
  els.resetBtn.addEventListener('click', resetFilters);
  els.saveFavBtn.addEventListener('click', saveCurrentAsFavorite);

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

  renderFavorites();
})();
