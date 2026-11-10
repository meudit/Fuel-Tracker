/* ============================================================
   FuelTrack – app.js
   Odometer-based: stores raw odo reading, derives distance
   from consecutive entries sorted by date.
   ============================================================ */

const DATA_KEY = 'fueltrack_data_v2';
const LEGACY_STORAGE_KEY = 'fueltrack_entries';
const THEME_KEY = 'fueltrack_theme';

function makeId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
}

function loadAppState() {
  try {
    const saved = JSON.parse(localStorage.getItem(DATA_KEY));
    if (saved && Array.isArray(saved.vehicles) && Array.isArray(saved.entries)) {
      const safeVehicles = saved.vehicles.map(v => ({ ...v, photos: Array.isArray(v.photos) ? v.photos : [] }));
      const safeEntries = saved.entries.map(e => ({
        ...e, id: e.id || makeId(), vehicleId: e.vehicleId || safeVehicles[0]?.id
      }));
      if (safeVehicles.length) {
        return { vehicles: safeVehicles, entries: safeEntries,
          selectedVehicleId: safeVehicles.some(v => v.id === saved.selectedVehicleId)
            ? saved.selectedVehicleId : safeVehicles[0].id };
      }
    }
  } catch (error) { console.warn('Could not read FuelTrack data; starting fresh.', error); }

  let legacyEntries = [];
  try { legacyEntries = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY)) || []; } catch {}
  const starterId = makeId();
  return {
    vehicles: [{ id: starterId, name: 'My Vehicle', brand: '', model: '',
      registrationNumber: '', type: 'Car', photos: [], isStarter: true }],
    entries: legacyEntries.map(entry => ({ ...entry, id: makeId(), vehicleId: starterId })),
    selectedVehicleId: starterId
  };
}

const initialState = loadAppState();
let vehicles = initialState.vehicles;
let entries = initialState.entries;
let selectedVehicleId = initialState.selectedVehicleId;
let deletedVehicleIds = Array.isArray(initialState.deletedVehicleIds) ? initialState.deletedVehicleIds : [];
let deletedEntryIds = Array.isArray(initialState.deletedEntryIds) ? initialState.deletedEntryIds : [];

function getCurrentEntries() {
  return entries.filter(entry => entry.vehicleId === selectedVehicleId);
}

function save() {
  localStorage.setItem(DATA_KEY, JSON.stringify({ vehicles, entries, selectedVehicleId, deletedVehicleIds, deletedEntryIds }));
  syncRemoteIfReady();
}

// ── Derived calculations ──────────────────────────────────────
// Entries are stored in insertion order but may have any dates.
// We sort by date to calculate distances correctly, then map
// back to insertion indices for editing/deleting.

function isFullTank(entry) {
  // Existing entries without this field retain the old full-tank assumption.
  return entry.fullTank !== false;
}

function getEnrichedEntries() {
  const sorted = entries
    .map((e, i) => ({ ...e, origIdx: i }))
    .filter(e => e.vehicleId === selectedVehicleId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.origIdx - b.origIdx);

  let lastFullTank = null;
  let litresSinceFullTank = 0;
  let spendSinceFullTank = 0;

  return sorted.map((e, si) => {
    const prev = sorted[si - 1] || null;
    const dist = (prev && e.odo != null && prev.odo != null && e.odo > prev.odo)
      ? fmt2(e.odo - prev.odo)
      : null;
    const volume = e.amount / e.price;
    litresSinceFullTank += volume;
    spendSinceFullTank += e.amount;

    let intervalDist = null;
    let kmPerL = null;
    let rsPerKm = null;
    if (isFullTank(e)) {
      if (lastFullTank && e.odo != null && lastFullTank.odo != null && e.odo > lastFullTank.odo && litresSinceFullTank > 0) {
        intervalDist = fmt2(e.odo - lastFullTank.odo);
        kmPerL = fmt2(intervalDist / litresSinceFullTank);
        rsPerKm = fmt2(spendSinceFullTank / intervalDist);
      }
      lastFullTank = e;
      litresSinceFullTank = 0;
      spendSinceFullTank = 0;
    }

    return { ...e, dist, volume: fmt2(volume), rsPerKm, kmPerL, intervalDist, fullTank: isFullTank(e) };
  });
}

// ── DOM ───────────────────────────────────────────────────────

const inputDate    = document.getElementById('inputDate');
const inputPrice   = document.getElementById('inputPrice');
const inputOdo     = document.getElementById('inputOdo');
const inputAmount  = document.getElementById('inputAmount');
const inputFullTank = document.getElementById('inputFullTank');
const themeToggle = document.getElementById('themeToggle');
const vehicleSelects = document.querySelectorAll('.vehicle-select');
const vehicleListEl = document.getElementById('vehicleList');
const vehicleFormEl = document.getElementById('vehicleForm');
const vehicleNameInput = document.getElementById('vehicleName');
const vehicleBrandInput = document.getElementById('vehicleBrand');
const vehicleModelInput = document.getElementById('vehicleModel');
const vehicleRegInput = document.getElementById('vehicleReg');
const vehicleTypeInput = document.getElementById('vehicleType');
const vehiclePhotoInput = document.getElementById('vehiclePhotoInput');
const vehiclePhotoPreviews = document.getElementById('vehiclePhotoPreviews');
const overviewTotalsEl = document.getElementById('overviewTotals');
const overviewVehiclesEl = document.getElementById('overviewVehicles');
const authStatusEl = document.getElementById('authStatus');
const authSetupHintEl = document.getElementById('authSetupHint');
const authControlsEl = document.getElementById('authControls');
const authEmailInput = document.getElementById('authEmail');
const authPasswordInput = document.getElementById('authPassword');
const signInBtn = document.getElementById('signInBtn');
const signUpBtn = document.getElementById('signUpBtn');
const signOutBtn = document.getElementById('signOutBtn');
let editingVehicleId = null;
let pendingVehiclePhotos = [];
const addForm      = document.getElementById('addForm');
const clearBtn     = document.getElementById('clearBtn');
const clearAllBtn  = document.getElementById('clearAllBtn');
const todayLabelEl = document.getElementById('todayLabel');

const prevDist   = document.getElementById('prevDist');
const prevVolume = document.getElementById('prevVolume');
const prevRsKm   = document.getElementById('prevRsKm');
const prevKmL    = document.getElementById('prevKmL');

const totalEntriesVal = document.getElementById('totalEntriesVal');
const totalSpendVal   = document.getElementById('totalSpendVal');

// Insights
const insightsEmpty   = document.getElementById('insightsEmpty');
const insightsContent = document.getElementById('insightsContent');
const avgKmLEl        = document.getElementById('avgKmL');
const avgRsKmEl       = document.getElementById('avgRsKm');
const avgCostFillEl   = document.getElementById('avgCostFill');
const avgDistanceEl   = document.getElementById('avgDistance');
const avgVolumeEl     = document.getElementById('avgVolume');
const totalSpentInsEl = document.getElementById('totalSpentIns');
const totalDistanceEl = document.getElementById('totalDistance');
const totalVolumeEl   = document.getElementById('totalVolume');

// Log
const logEmpty   = document.getElementById('logEmpty');
const logContent = document.getElementById('logContent');
const logCards   = document.getElementById('logCards');

// ── Tab Navigation ────────────────────────────────────────────

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const tid = btn.dataset.tab;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(tid).classList.add('active');
  });
});

// ── Init ─────────────────────────────────────────────────────

inputDate.value = todayISO();
if (todayLabelEl) todayLabelEl.textContent = todayLabel();

// Remember the user's preferred appearance.
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  if (themeToggle) {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    themeToggle.setAttribute('aria-label', 'Switch to ' + nextTheme + ' theme');
    themeToggle.setAttribute('title', 'Switch to ' + nextTheme + ' theme');
  }
}
applyTheme(localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark');
if (themeToggle) themeToggle.addEventListener('click', () => {
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, nextTheme);
  applyTheme(nextTheme);
});

// ── Live Preview ──────────────────────────────────────────────

function updatePreview() {
  const price = parseFloat(inputPrice.value);
  const odo = parseFloat(inputOdo.value);
  const amount = parseFloat(inputAmount.value);
  const currentDate = inputDate.value || todayISO();

  const chronological = entries
    .map((entry, index) => ({ ...entry, _index: index }))
    .filter(entry => entry.vehicleId === selectedVehicleId && entry.date <= currentDate)
    .sort((a, b) => a.date.localeCompare(b.date) || a._index - b._index);
  const withOdo = chronological.filter(entry => entry.odo != null);
  const lastEntry = withOdo[withOdo.length - 1] || null;
  const lastOdo = lastEntry ? lastEntry.odo : null;
  const lastFullTank = [...chronological].reverse().find(entry => entry.odo != null && isFullTank(entry)) || null;

  let dist = null;
  if (!isNaN(odo) && odo > 0 && lastOdo !== null && odo > lastOdo) {
    dist = odo - lastOdo;
    prevDist.textContent = dist.toFixed(2) + ' km';
    prevDist.classList.add('live');
  } else if (!isNaN(odo) && odo > 0 && lastOdo === null) {
    prevDist.textContent = 'First entry';
    prevDist.classList.remove('live');
  } else if (!isNaN(odo) && odo > 0 && lastOdo !== null && odo <= lastOdo) {
    prevDist.textContent = '⚠ Odo lower than last';
    prevDist.classList.remove('live');
  } else {
    prevDist.textContent = '—';
    prevDist.classList.remove('live');
  }

  const validFuel = !isNaN(price) && price > 0 && !isNaN(amount) && amount > 0;
  const volume = validFuel ? amount / price : 0;
  prevVolume.textContent = validFuel ? disp(volume, 'L') : '—';
  prevVolume.classList.toggle('live', validFuel);

  const fullTankSelected = inputFullTank.checked;
  const intervalDistance = fullTankSelected && lastFullTank && !isNaN(odo) && odo > lastFullTank.odo
    ? odo - lastFullTank.odo : null;
  let previousVolume = 0;
  let afterLastFullTank = !lastFullTank;
  chronological.forEach(entry => {
    if (lastFullTank && entry._index === lastFullTank._index) {
      afterLastFullTank = true;
      return;
    }
    if (afterLastFullTank) previousVolume += entry.amount / entry.price;
  });
  const totalIntervalVolume = previousVolume + volume;

  if (fullTankSelected && intervalDistance !== null) {
    prevDist.textContent = intervalDistance.toFixed(2) + ' km';
    prevDist.classList.add('live');
  }

  const rsPerKm = dist !== null && validFuel ? amount / dist : null;
  prevRsKm.textContent = rsPerKm !== null ? '₹' + disp(rsPerKm) + '/km' : '—';
  prevRsKm.classList.toggle('live', rsPerKm !== null);

  if (fullTankSelected && intervalDistance !== null && intervalDistance > 0 && totalIntervalVolume > 0) {
    prevKmL.textContent = disp(intervalDistance / totalIntervalVolume, 'km/L');
    prevKmL.classList.remove('status');
    prevKmL.classList.add('live');
  } else {
    prevKmL.textContent = fullTankSelected ? 'Need prior full tank' : 'Select full tank';
    prevKmL.classList.remove('live');
    prevKmL.classList.add('status');
  }
}
[inputPrice, inputOdo, inputAmount, inputDate].forEach(el => el.addEventListener('input', updatePreview));
inputFullTank.addEventListener('change', updatePreview);

// ── Add Entry ─────────────────────────────────────────────────

addForm.addEventListener('submit', e => {
  e.preventDefault();
  const date   = inputDate.value;
  const price  = parseFloat(inputPrice.value);
  const odo    = parseFloat(inputOdo.value) || null;
  const amount = parseFloat(inputAmount.value);

  if (!date)                        { toast('Please select a date', 'error');    return; }
  if (isNaN(price) || price <= 0)   { toast('Enter a valid fuel price', 'error'); return; }
  if (isNaN(amount) || amount <= 0) { toast('Enter the amount paid', 'error');   return; }
  if (odo !== null && odo <= 0)     { toast('Odometer must be > 0', 'error');    return; }

  // Warn if odo looks wrong (lower than last)
  const sorted = [...entries]
    .filter(e => e.vehicleId === selectedVehicleId && e.date <= date && e.odo != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const lastOdo = sorted.length ? sorted[sorted.length - 1].odo : null;
  if (odo !== null && lastOdo !== null && odo <= lastOdo) {
    toast('⚠ Odo reading is lower than last entry!', 'error');
    return;
  }

  // Store only raw fields; derived values calculated at render time
  entries.push({ id: makeId(), vehicleId: selectedVehicleId, date, price, odo, amount, fullTank: inputFullTank.checked });
  save();
  renderAll();
  resetForm();
  toast('Entry added', 'success');
});

clearBtn.addEventListener('click', resetForm);
clearAllBtn.addEventListener('click', () => {
  const currentIds = getCurrentEntries().map(entry => entry.id);
  if (!currentIds.length) return;
  if (confirm('Clear all fuel entries for this vehicle? This cannot be undone.')) {
    entries = entries.filter(entry => entry.vehicleId !== selectedVehicleId);
    deletedEntryIds.push(...currentIds);
    if (cloudClient && cloudSession && currentIds.length) cloudClient.from('fuel_entries').delete().in('id', currentIds).then(({ error }) => {
      if (error) console.error('Cloud delete failed:', error);
    });
    save(); renderAll(); toast('Vehicle entries cleared', 'error');
  }
});

function resetForm() {
  inputPrice.value = inputOdo.value = inputAmount.value = '';
  inputFullTank.checked = false;
  inputDate.value = todayISO();
  updatePreview();
}

// ── Delete ────────────────────────────────────────────────────

function deleteEntry(origIdx) {
  if (!confirm('Delete this entry?')) return;
  const deletedId = entries[origIdx]?.id;
  if (deletedId) deletedEntryIds.push(deletedId);
  entries.splice(origIdx, 1);
  if (cloudClient && cloudSession && deletedId) cloudClient.from('fuel_entries').delete().eq('id', deletedId).then(({ error }) => {
    if (error) console.error('Cloud delete failed:', error);
  });
  save();
  renderAll();
  toast('Entry deleted', 'error');
}

// ── Save Edit ─────────────────────────────────────────────────

function saveEdit(origIdx, card) {
  const date   = card.querySelector('.ei-date').value;
  const price  = parseFloat(card.querySelector('.ei-price').value);
  const odo    = parseFloat(card.querySelector('.ei-odo').value) || null;
  const amount = parseFloat(card.querySelector('.ei-amount').value);

  if (!date)                        { toast('Invalid date', 'error');         return; }
  if (isNaN(price) || price <= 0)   { toast('Invalid fuel price', 'error');   return; }
  if (isNaN(amount) || amount <= 0) { toast('Invalid amount', 'error');       return; }

  // Store only raw fields; derived values re-computed at render
  const fullTank = card.querySelector('.ei-full-tank').checked;
  entries[origIdx] = { ...entries[origIdx], date, price, odo, amount, fullTank };
  save();
  renderAll();
  toast('Entry updated', 'success');
}

// ── Render ────────────────────────────────────────────────────

function renderAll() {
  renderVehicleSelectors();
  renderHeader();
  renderInsights();
  renderLog();
  renderVehicles();
  renderOverview();
}

function renderHeader() {
  const currentEntries = getCurrentEntries();
  totalEntriesVal.textContent = currentEntries.length;
  const total = currentEntries.reduce((s, e) => s + (e.amount || 0), 0);
  totalSpendVal.textContent = '₹' + total.toLocaleString('en-IN', {
    minimumFractionDigits: 0, maximumFractionDigits: 0
  });
}

function renderInsights() {
  const currentEntries = getCurrentEntries();
  if (!currentEntries.length) {
    insightsEmpty.classList.remove('hidden');
    insightsContent.classList.add('hidden');
    return;
  }
  insightsEmpty.classList.add('hidden');
  insightsContent.classList.remove('hidden');

  const enriched = getEnrichedEntries();

  const totalPaid = enriched.reduce((s, e) => s + e.amount, 0);
  const totalVol  = enriched.reduce((s, e) => s + (e.volume || 0), 0);
  const withDist  = enriched.filter(e => e.dist !== null);
  const totalDist = withDist.reduce((s, e) => s + e.dist, 0);
  const withKmL   = enriched.filter(e => e.kmPerL !== null);
  const withRsKm  = enriched.filter(e => e.rsPerKm !== null);

  const avgKmLVal  = withKmL.length  ? withKmL.reduce((s,e)  => s + e.kmPerL,  0) / withKmL.length  : null;
  const avgRsKmVal = withRsKm.length ? withRsKm.reduce((s,e) => s + e.rsPerKm, 0) / withRsKm.length : null;
  const avgDist    = withDist.length ? totalDist / withDist.length : null;

  avgKmLEl.textContent        = avgKmLVal  !== null ? avgKmLVal.toFixed(2)  : '—';
  avgRsKmEl.textContent       = avgRsKmVal !== null ? avgRsKmVal.toFixed(2) : '—';
  avgCostFillEl.textContent   = '₹' + (totalPaid / enriched.length).toFixed(2);
  avgDistanceEl.textContent   = avgDist    !== null ? avgDist.toFixed(2) + ' km' : '—';
  avgVolumeEl.textContent     = (totalVol / enriched.length).toFixed(2) + ' L';
  totalSpentInsEl.textContent = '₹' + totalPaid.toLocaleString('en-IN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  totalDistanceEl.textContent = totalDist > 0 ? totalDist.toFixed(2) + ' km' : '—';
  totalVolumeEl.textContent   = totalVol.toFixed(2) + ' L';
}

function renderLog() {
  if (!getCurrentEntries().length) {
    logEmpty.classList.remove('hidden');
    logContent.classList.add('hidden');
    return;
  }
  logEmpty.classList.add('hidden');
  logContent.classList.remove('hidden');
  logCards.innerHTML = '';

  // Enrich and display newest date first
  const enriched = getEnrichedEntries().reverse();

  enriched.forEach((entry, ri) => {
    const card = document.createElement('div');
    card.className = 'log-card' + (ri === 0 ? ' card-enter' : '');

    const hasKmL  = entry.kmPerL  !== null;
    const hasRsKm = entry.rsPerKm !== null;
    const hasDist = entry.dist    !== null;
    const entryNum = enriched.length - ri;

    card.innerHTML = `
      <div class="lc-head">
        <div class="lc-num">${entryNum}</div>
        <div class="lc-meta">
          <div class="lc-topline">
            <span class="lc-date">${fmtDate(entry.date)}</span>
            <span class="tank-marker ${entry.fullTank ? 'tank-full' : 'tank-partial'}" title="${entry.fullTank ? 'Full tank' : 'Partial refill'}" aria-label="${entry.fullTank ? 'Full tank' : 'Partial refill'}">${entry.fullTank ? 'F' : 'P'}</span>
            <div class="lc-pills">
              ${hasKmL
                ? `<span class="lc-pill pill-green">${entry.kmPerL.toFixed(2)} km/L</span>`
                : `<span class="lc-pill pill-na">No dist</span>`}
              ${hasRsKm
                ? `<span class="lc-pill pill-orange">₹${entry.rsPerKm.toFixed(2)}/km</span>`
                : ''}
            </div>
          </div>
          <div class="lc-price">
            <span>₹${entry.price.toFixed(2)}/L</span>
            <span class="lc-meta-sep">·</span>
            <span class="lc-odo">${entry.odo != null ? 'Odo ' + entry.odo.toLocaleString('en-IN') + ' km' : 'Odo —'}</span>
          </div>
        </div>
        <svg class="lc-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>

      <div class="lc-body">
        <!-- Detail grid -->
        <div class="lc-details">
          <div class="lc-detail-item">
            <div class="lc-detail-label">Odometer</div>
            <div class="lc-detail-val val-blue">${entry.odo != null ? entry.odo.toLocaleString('en-IN') + ' km' : '—'}</div>
          </div>
          <div class="lc-detail-item">
            <div class="lc-detail-label">Full tank</div>
            <div class="lc-detail-val ${entry.fullTank ? 'val-green' : 'val-na'}">${entry.fullTank ? 'Yes' : 'No — partial refill'}</div>
          </div>
          <div class="lc-detail-item">
            <div class="lc-detail-label">Distance</div>
            <div class="lc-detail-val ${entry.intervalDist !== null ? '' : 'val-na'}">${entry.intervalDist !== null ? entry.intervalDist.toFixed(2) + ' km' : (hasDist ? entry.dist.toFixed(2) + ' km since last entry' : '—')}</div>
          </div>
          <div class="lc-detail-item">
            <div class="lc-detail-label">Volume Filled</div>
            <div class="lc-detail-val val-blue">${entry.volume != null ? entry.volume.toFixed(2) + ' L' : '—'}</div>
          </div>
          <div class="lc-detail-item">
            <div class="lc-detail-label">Amount Paid</div>
            <div class="lc-detail-val">₹${entry.amount.toFixed(2)}</div>
          </div>
          <div class="lc-detail-item">
            <div class="lc-detail-label">Mileage (km/L)</div>
            <div class="lc-detail-val ${hasKmL ? 'val-green' : 'val-na'}">${hasKmL ? entry.kmPerL.toFixed(2) : '—'}</div>
          </div>
          <div class="lc-detail-item">
            <div class="lc-detail-label">Running Cost</div>
            <div class="lc-detail-val ${hasRsKm ? 'val-orange' : 'val-na'}">${hasRsKm ? '₹' + entry.rsPerKm.toFixed(2) + '/km' : '—'}</div>
          </div>
        </div>

        <!-- Edit form -->
        <div class="lc-edit-form">
          <div class="edit-grid">
            <div class="edit-field">
              <label class="edit-label">Date</label>
              <input class="edit-input ei-date" type="date" value="${entry.date}" />
            </div>
            <div class="edit-field">
              <label class="edit-label">Fuel Price (Rs/L)</label>
              <input class="edit-input ei-price" type="number" step="0.01" value="${entry.price}" inputmode="decimal" />
            </div>
            <div class="edit-field">
              <label class="edit-label">Odometer (km)</label>
              <input class="edit-input ei-odo" type="number" step="1" value="${entry.odo != null ? entry.odo : ''}" placeholder="e.g. 12450" inputmode="decimal" />
            </div>
            <div class="edit-field">
              <label class="edit-label">Amount Paid (₹)</label>
              <input class="edit-input ei-amount" type="number" step="0.01" value="${entry.amount}" inputmode="decimal" />
            </div>
            <div class="edit-field edit-checkbox-field">
              <label class="edit-label" for="ei-full-tank-${entry.origIdx}">Full tank</label>
              <label class="checkbox-wrap" for="ei-full-tank-${entry.origIdx}">
                <input class="ei-full-tank" id="ei-full-tank-${entry.origIdx}" type="checkbox" ${entry.fullTank ? 'checked' : ''} />
                <span class="checkbox-text">Filled completely</span>
              </label>
            </div>
          </div>
          <p class="edit-note">Distance &amp; mileage will be recalculated automatically.</p>
          <div class="edit-btns">
            <button class="eb-cancel" type="button">Cancel</button>
            <button class="eb-save" type="button">Save</button>
          </div>
        </div>

        <!-- Action row -->
        <div class="lc-actions">
          <button class="lc-btn lc-btn-edit" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Edit
          </button>
          <div class="lc-btn-sep"></div>
          <button class="lc-btn lc-btn-del" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
            </svg>
            Delete
          </button>
        </div>
      </div>
    `;

    // Events
    card.querySelector('.lc-head').addEventListener('click', () => {
      const wasExpanded = card.classList.contains('expanded');
      document.querySelectorAll('.log-card.expanded').forEach(c => c.classList.remove('expanded', 'editing'));
      if (!wasExpanded) card.classList.add('expanded');
    });
    card.querySelector('.lc-btn-edit').addEventListener('click', e => {
      e.stopPropagation();
      card.classList.add('editing');
    });
    card.querySelector('.eb-cancel').addEventListener('click', () => {
      card.classList.remove('editing');
    });
    card.querySelector('.eb-save').addEventListener('click', () => {
      saveEdit(entry.origIdx, card);
    });
    card.querySelector('.lc-btn-del').addEventListener('click', e => {
      e.stopPropagation();
      deleteEntry(entry.origIdx);
    });

    logCards.appendChild(card);
  });
}


/* ── Multi-vehicle management ────────────────────────────────── */

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function renderVehicleSelectors() {
  document.querySelectorAll('.vehicle-select').forEach(select => {
    select.innerHTML = vehicles.map(vehicle =>
      '<option value="' + escapeHtml(vehicle.id) + '"' +
      (vehicle.id === selectedVehicleId ? ' selected' : '') + '>' +
      escapeHtml(vehicle.name) + '</option>'
    ).join('');
    select.disabled = vehicles.length <= 1;
  });
}

function photoSource(photo) {
  return photo ? (photo.url || photo.dataUrl || '') : '';
}

function renderVehicles() {
  if (!vehicleListEl) return;
  if (!vehicles.length) {
    vehicleListEl.innerHTML = '<div class="empty-state"><p class="empty-title">No vehicles yet</p><p class="empty-sub">Add a vehicle to start tracking fuel.</p></div>';
    return;
  }

  vehicleListEl.innerHTML = vehicles.map(vehicle => {
    const current = entries.filter(entry => entry.vehicleId === vehicle.id);
    const spent = current.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const firstPhoto = photoSource((vehicle.photos || [])[0]);
    const cover = firstPhoto
      ? '<img class="vehicle-cover" src="' + escapeHtml(firstPhoto) + '" alt="' + escapeHtml(vehicle.name) + '">'
      : '<div class="vehicle-cover vehicle-placeholder">' + (vehicle.type === 'Bike' ? '🏍️' : vehicle.type === 'Scooter' ? '🛵' : '🚘') + '</div>';
    const gallery = (vehicle.photos || []).slice(1).map(photo => {
      const src = photoSource(photo);
      return src ? '<img class="vehicle-thumb" src="' + escapeHtml(src) + '" alt="Vehicle photo">' : '';
    }).join('');
    return '<article class="vehicle-card">' +
      '<div class="vehicle-card-media">' + cover + '</div>' +
      '<div class="vehicle-card-content">' +
      '<div class="vehicle-card-title-row"><div><div class="vehicle-card-title">' + escapeHtml(vehicle.name) + '</div>' +
      '<div class="vehicle-card-sub">' + escapeHtml([vehicle.brand, vehicle.model].filter(Boolean).join(' ')) + '</div></div>' +
      '<span class="vehicle-type-pill">' + escapeHtml(vehicle.type || 'Other') + '</span></div>' +
      '<div class="vehicle-meta">' + escapeHtml(vehicle.registrationNumber || 'No registration number') + '</div>' +
      '<div class="vehicle-metrics"><div><strong>' + current.length + '</strong><span>Fills</span></div>' +
      '<div><strong>₹' + spent.toLocaleString('en-IN', { maximumFractionDigits: 0 }) + '</strong><span>Total spent</span></div></div>' +
      (gallery ? '<div class="vehicle-gallery">' + gallery + '</div>' : '') +
      '<div class="vehicle-card-actions">' +
      '<button class="lc-btn lc-btn-edit" data-vehicle-select="' + escapeHtml(vehicle.id) + '" type="button">Use vehicle</button>' +
      '<button class="lc-btn lc-btn-edit" data-vehicle-edit="' + escapeHtml(vehicle.id) + '" type="button">Edit</button>' +
      '<button class="lc-btn lc-btn-del" data-vehicle-delete="' + escapeHtml(vehicle.id) + '" type="button">Delete</button>' +
      '</div></div></article>';
  }).join('');

  vehicleListEl.querySelectorAll('[data-vehicle-select]').forEach(button => {
    button.addEventListener('click', () => selectVehicle(button.dataset.vehicleSelect));
  });
  vehicleListEl.querySelectorAll('[data-vehicle-edit]').forEach(button => {
    button.addEventListener('click', () => openVehicleForm(button.dataset.vehicleEdit));
  });
  vehicleListEl.querySelectorAll('[data-vehicle-delete]').forEach(button => {
    button.addEventListener('click', () => deleteVehicle(button.dataset.vehicleDelete));
  });
}

function renderOverview() {
  if (!overviewTotalsEl || !overviewVehiclesEl) return;
  const totalSpent = entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  overviewTotalsEl.innerHTML =
    '<div class="stat-row"><span class="stat-name">Vehicles</span><strong class="stat-val">' + vehicles.length + '</strong></div>' +
    '<div class="row-sep"></div><div class="stat-row"><span class="stat-name">Total fuel fills</span><strong class="stat-val">' + entries.length + '</strong></div>' +
    '<div class="row-sep"></div><div class="stat-row"><span class="stat-name">Combined fuel spend</span><strong class="stat-val stat-big">₹' + totalSpent.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</strong></div>';

  overviewVehiclesEl.innerHTML = vehicles.map(vehicle => {
    const fuelEntries = entries.filter(entry => entry.vehicleId === vehicle.id);
    const spend = fuelEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const photo = photoSource((vehicle.photos || [])[0]);
    const image = photo ? '<img class="overview-thumb" src="' + escapeHtml(photo) + '" alt="">' : '<div class="overview-thumb vehicle-placeholder">🚘</div>';
    return '<button class="overview-vehicle" type="button" data-overview-vehicle="' + escapeHtml(vehicle.id) + '">' +
      image + '<span class="overview-vehicle-info"><strong>' + escapeHtml(vehicle.name) + '</strong><small>' + fuelEntries.length + ' fills</small></span>' +
      '<strong class="overview-spend">₹' + spend.toLocaleString('en-IN', { maximumFractionDigits: 0 }) + '</strong></button>';
  }).join('');
  overviewVehiclesEl.querySelectorAll('[data-overview-vehicle]').forEach(button => {
    button.addEventListener('click', () => {
      selectVehicle(button.dataset.overviewVehicle);
      document.querySelector('[data-tab="tab-insights"]').click();
    });
  });
}

function selectVehicle(id) {
  if (!vehicles.some(vehicle => vehicle.id === id)) return;
  selectedVehicleId = id;
  save();
  renderAll();
  updatePreview();
}

function resetVehicleForm() {
  editingVehicleId = null;
  pendingVehiclePhotos = [];
  if (vehicleNameInput) vehicleNameInput.value = '';
  if (vehicleBrandInput) vehicleBrandInput.value = '';
  if (vehicleModelInput) vehicleModelInput.value = '';
  if (vehicleRegInput) vehicleRegInput.value = '';
  if (vehicleTypeInput) vehicleTypeInput.value = 'Car';
  if (vehiclePhotoInput) vehiclePhotoInput.value = '';
  if (vehiclePhotoPreviews) vehiclePhotoPreviews.innerHTML = '';
  if (vehicleFormEl) vehicleFormEl.classList.add('hidden');
}

function openVehicleForm(id) {
  resetVehicleForm();
  const vehicle = id ? vehicles.find(item => item.id === id) : null;
  editingVehicleId = vehicle ? vehicle.id : null;
  if (vehicle) {
    vehicleNameInput.value = vehicle.name || '';
    vehicleBrandInput.value = vehicle.brand || '';
    vehicleModelInput.value = vehicle.model || '';
    vehicleRegInput.value = vehicle.registrationNumber || '';
    vehicleTypeInput.value = vehicle.type || 'Other';
    (vehicle.photos || []).forEach(photo => {
      const src = photoSource(photo);
      if (src) vehiclePhotoPreviews.insertAdjacentHTML('beforeend', '<img class="vehicle-thumb" src="' + escapeHtml(src) + '" alt="Existing vehicle photo">');
    });
  }
  vehicleFormEl.classList.remove('hidden');
  vehicleFormEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.readAsDataURL(file);
  });
}

async function compressVehiclePhoto(file) {
  const dataUrl = await readAsDataUrl(file);
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('Unsupported image file.'));
    image.src = dataUrl;
  });
  const maxSide = 1400;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.78);
}

async function saveVehicle() {
  const name = vehicleNameInput.value.trim();
  if (!name) { toast('Enter a vehicle name', 'error'); return; }
  const existing = editingVehicleId ? vehicles.find(vehicle => vehicle.id === editingVehicleId) : null;
  const vehicle = existing || { id: makeId(), photos: [] };
  vehicle.name = name;
  vehicle.brand = vehicleBrandInput.value.trim();
  vehicle.model = vehicleModelInput.value.trim();
  vehicle.registrationNumber = vehicleRegInput.value.trim();
  vehicle.type = vehicleTypeInput.value;
  vehicle.isStarter = false;
  vehicle.photos = vehicle.photos || [];
  pendingVehiclePhotos.forEach(dataUrl => vehicle.photos.push({ id: makeId(), dataUrl }));
  if (!existing) vehicles.push(vehicle);
  selectedVehicleId = vehicle.id;
  save();
  resetVehicleForm();
  renderAll();
  updatePreview();
  toast(existing ? 'Vehicle updated' : 'Vehicle added', 'success');
}

function deleteVehicle(id) {
  const vehicle = vehicles.find(item => item.id === id);
  if (!vehicle) return;
  if (vehicles.length === 1) { toast('Add another vehicle before deleting this one', 'error'); return; }
  if (!confirm('Delete ' + vehicle.name + ' and all its fuel entries? This cannot be undone.')) return;
  const removedEntryIds = entries.filter(entry => entry.vehicleId === id).map(entry => entry.id);
  deletedVehicleIds.push(id);
  deletedEntryIds.push(...removedEntryIds);
  if (cloudClient && cloudSession) {
    cloudClient.from('vehicles').delete().eq('id', id).then(({ error }) => {
      if (error) console.error('Cloud vehicle delete failed:', error);
    });
    if (removedEntryIds.length) cloudClient.from('fuel_entries').delete().in('id', removedEntryIds).then(({ error }) => {
      if (error) console.error('Cloud entry delete failed:', error);
    });
  }
  vehicles = vehicles.filter(item => item.id !== id);
  entries = entries.filter(entry => entry.vehicleId !== id);
  if (selectedVehicleId === id) selectedVehicleId = vehicles[0].id;
  save();
  renderAll();
  updatePreview();
  toast('Vehicle deleted', 'error');
}

if (document.getElementById('showVehicleForm')) {
  document.getElementById('showVehicleForm').addEventListener('click', () => openVehicleForm(null));
  document.getElementById('cancelVehicle').addEventListener('click', resetVehicleForm);
  document.getElementById('saveVehicle').addEventListener('click', saveVehicle);
}
if (vehiclePhotoInput) {
  vehiclePhotoInput.addEventListener('change', async () => {
    const files = Array.from(vehiclePhotoInput.files || []).filter(file => file.type.startsWith('image/')).slice(0, 8);
    try {
      pendingVehiclePhotos = await Promise.all(files.map(compressVehiclePhoto));
      vehiclePhotoPreviews.innerHTML = pendingVehiclePhotos.map(src => '<img class="vehicle-thumb" src="' + src + '" alt="New vehicle photo preview">').join('');
      if (editingVehicleId) {
        const current = vehicles.find(vehicle => vehicle.id === editingVehicleId);
        (current?.photos || []).forEach(photo => {
          const src = photoSource(photo);
          if (src) vehiclePhotoPreviews.insertAdjacentHTML('afterbegin', '<img class="vehicle-thumb" src="' + escapeHtml(src) + '" alt="Existing vehicle photo">');
        });
      }
    } catch (error) {
      toast(error.message || 'Could not process photo', 'error');
    }
  });
}
document.querySelectorAll('.vehicle-select').forEach(select => {
  select.addEventListener('change', () => selectVehicle(select.value));
});

/* ── Supabase cloud database (optional; local-first) ─────────── */

const SUPABASE_URL = window.FUELTRACK_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = window.FUELTRACK_SUPABASE_ANON_KEY || '';
const STORAGE_BUCKET = 'vehicle-photos';
let cloudClient = null;
let cloudSession = null;
let cloudSyncInProgress = false;
let cloudSyncPending = false;

if (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase && window.supabase.createClient) {
  cloudClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  if (authControlsEl) authControlsEl.classList.remove('hidden');
  if (authSetupHintEl) authSetupHintEl.classList.add('hidden');
  if (signInBtn) signInBtn.addEventListener('click', signInToCloud);
  if (signUpBtn) signUpBtn.addEventListener('click', signUpToCloud);
  if (signOutBtn) signOutBtn.addEventListener('click', async () => {
    const { error } = await cloudClient.auth.signOut();
    if (error) toast(error.message, 'error');
    else { cloudSession = null; updateCloudStatus(); toast('Signed out', 'success'); }
  });
  initialiseCloudAuth();
} else if (authStatusEl) {
  authStatusEl.textContent = 'Local mode · data is saved in this browser';
}

function updateCloudStatus(message) {
  if (!authStatusEl) return;
  if (!cloudClient) authStatusEl.textContent = 'Local mode · data is saved in this browser';
  else if (message) authStatusEl.textContent = message;
  else if (cloudSession) authStatusEl.textContent = 'Connected as ' + cloudSession.user.email + ' · cloud sync enabled';
  else authStatusEl.textContent = 'Cloud configured · sign in to sync across devices';
  if (signOutBtn) signOutBtn.classList.toggle('hidden', !cloudSession);
}

async function initialiseCloudAuth() {
  const { data, error } = await cloudClient.auth.getSession();
  if (error) updateCloudStatus('Could not read account session: ' + error.message);
  cloudSession = data ? data.session : null;
  updateCloudStatus();
  if (cloudSession) await loadCloudData();
  cloudClient.auth.onAuthStateChange((event, session) => {
    cloudSession = session;
    updateCloudStatus();
    if (session && event !== 'INITIAL_SESSION') loadCloudData();
  });
}

async function signInToCloud() {
  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;
  if (!email || !password) { toast('Enter your email and password', 'error'); return; }
  const { error } = await cloudClient.auth.signInWithPassword({ email, password });
  if (error) toast(error.message, 'error');
  else toast('Signed in', 'success');
}

async function signUpToCloud() {
  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;
  if (!email || password.length < 8) { toast('Enter an email and a password of at least 8 characters', 'error'); return; }
  const { error } = await cloudClient.auth.signUp({ email, password });
  if (error) toast(error.message, 'error');
  else toast('Account created. Check your email if confirmation is enabled.', 'success');
}

async function loadCloudData() {
  if (!cloudClient || !cloudSession) return;
  updateCloudStatus('Loading your cloud data…');
  const [vehicleResult, entryResult] = await Promise.all([
    cloudClient.from('vehicles').select('*').order('created_at', { ascending: true }),
    cloudClient.from('fuel_entries').select('*').order('fill_date', { ascending: true })
  ]);
  if (vehicleResult.error || entryResult.error) {
    updateCloudStatus('Database setup required: ' + ((vehicleResult.error || entryResult.error).message));
    return;
  }

  const remoteVehicles = await Promise.all((vehicleResult.data || []).filter(row => !deletedVehicleIds.includes(row.id)).map(async row => {
    const paths = Array.isArray(row.photo_paths) ? row.photo_paths : [];
    const photos = await Promise.all(paths.map(async path => {
      const { data } = await cloudClient.storage.from(STORAGE_BUCKET).createSignedUrl(path, 3600);
      return { id: path, path, url: data?.signedUrl || '' };
    }));
    return {
      id: row.id, name: row.name, brand: row.brand || '', model: row.model || '',
      registrationNumber: row.registration_number || '', type: row.vehicle_type || 'Other',
      photos, isStarter: false
    };
  }));
  const remoteEntries = (entryResult.data || []).filter(row => !deletedEntryIds.includes(row.id)).map(row => ({
    id: row.id, vehicleId: row.vehicle_id, date: row.fill_date,
    price: Number(row.fuel_price), odo: row.odometer == null ? null : Number(row.odometer),
    amount: Number(row.amount_paid), fullTank: row.full_tank !== false
  }));

  const hasLocalWork = entries.length > 0 || deletedVehicleIds.length > 0 || deletedEntryIds.length > 0 ||
    vehicles.some(vehicle => !vehicle.isStarter && vehicle.name !== 'My Vehicle');
  if (remoteVehicles.length && !hasLocalWork) {
    vehicles = remoteVehicles;
    entries = remoteEntries;
    selectedVehicleId = vehicles.some(vehicle => vehicle.id === selectedVehicleId)
      ? selectedVehicleId : vehicles[0].id;
  } else {
    const vehicleMap = new Map(remoteVehicles.map(vehicle => [vehicle.id, vehicle]));
    vehicles.forEach(vehicle => {
      const remoteVehicle = vehicleMap.get(vehicle.id);
      if (!remoteVehicle) {
        vehicleMap.set(vehicle.id, vehicle);
        return;
      }
      // Keep offline additions, but prefer freshly signed URLs from the server
      // for photos that already exist in cloud storage.
      const mergedPhotos = [...(remoteVehicle.photos || [])];
      (vehicle.photos || []).forEach(localPhoto => {
        if (localPhoto.dataUrl) {
          mergedPhotos.push(localPhoto);
        } else if (localPhoto.path && !mergedPhotos.some(photo => photo.path === localPhoto.path)) {
          mergedPhotos.push(localPhoto);
        }
      });
      vehicleMap.set(vehicle.id, { ...remoteVehicle, ...vehicle, photos: mergedPhotos });
    });
    vehicles = Array.from(vehicleMap.values());
    const entryMap = new Map(remoteEntries.map(entry => [entry.id, entry]));
    entries.forEach(entry => entryMap.set(entry.id, entry));
    entries = Array.from(entryMap.values());
    if (!vehicles.some(vehicle => vehicle.id === selectedVehicleId)) selectedVehicleId = vehicles[0]?.id;
  }
  if (!vehicles.length) {
    const starterId = makeId();
    vehicles = [{ id: starterId, name: 'My Vehicle', type: 'Car', photos: [], isStarter: true }];
    selectedVehicleId = starterId;
  }
  localStorage.setItem(DATA_KEY, JSON.stringify({ vehicles, entries, selectedVehicleId, deletedVehicleIds, deletedEntryIds }));
  renderAll();
  updatePreview();
  updateCloudStatus('Cloud data loaded · syncing local changes…');
  await syncRemote();
  updateCloudStatus();
}

async function syncRemoteIfReady() {
  if (!cloudClient || !cloudSession) return;
  if (cloudSyncInProgress) { cloudSyncPending = true; return; }
  syncRemote();
}

async function syncRemote() {
  if (!cloudClient || !cloudSession) return;
  if (cloudSyncInProgress) { cloudSyncPending = true; return; }
  cloudSyncInProgress = true;
  updateCloudStatus('Syncing…');
  try {
    const userId = cloudSession.user.id;
    for (const vehicle of vehicles) {
      vehicle.photos = vehicle.photos || [];
      for (const photo of vehicle.photos) {
        if (photo.dataUrl && !photo.path) {
          const blob = await fetch(photo.dataUrl).then(response => response.blob());
          const path = userId + '/' + vehicle.id + '/' + photo.id + '.jpg';
          const { error: uploadError } = await cloudClient.storage.from(STORAGE_BUCKET).upload(path, blob, {
            contentType: 'image/jpeg', upsert: true
          });
          if (uploadError) throw uploadError;
          photo.path = path;
          photo.dataUrl = null;
          const { data } = await cloudClient.storage.from(STORAGE_BUCKET).createSignedUrl(path, 3600);
          photo.url = data?.signedUrl || '';
        }
      }
    }

    if (deletedEntryIds.length) {
      const { error } = await cloudClient.from('fuel_entries').delete().in('id', deletedEntryIds);
      if (error) throw error;
    }
    if (deletedVehicleIds.length) {
      const { error } = await cloudClient.from('vehicles').delete().in('id', deletedVehicleIds);
      if (error) throw error;
    }

    const vehicleRows = vehicles.map(vehicle => ({
      id: vehicle.id, user_id: userId, name: vehicle.name, brand: vehicle.brand || null,
      model: vehicle.model || null, registration_number: vehicle.registrationNumber || null,
      vehicle_type: vehicle.type || 'Other',
      photo_paths: (vehicle.photos || []).map(photo => photo.path).filter(Boolean)
    }));
    if (vehicleRows.length) {
      const { error } = await cloudClient.from('vehicles').upsert(vehicleRows, { onConflict: 'id' });
      if (error) throw error;
    }

    const entryRows = entries.map(entry => ({
      id: entry.id, user_id: userId, vehicle_id: entry.vehicleId,
      fill_date: entry.date, fuel_price: entry.price, odometer: entry.odo,
      amount_paid: entry.amount, full_tank: entry.fullTank !== false
    }));
    if (entryRows.length) {
      const { error } = await cloudClient.from('fuel_entries').upsert(entryRows, { onConflict: 'id' });
      if (error) throw error;
    }
    deletedVehicleIds = [];
    deletedEntryIds = [];
    localStorage.setItem(DATA_KEY, JSON.stringify({ vehicles, entries, selectedVehicleId, deletedVehicleIds, deletedEntryIds }));
    updateCloudStatus();
  } catch (error) {
    console.error('FuelTrack cloud sync failed:', error);
    updateCloudStatus('Sync issue: ' + (error.message || 'Check your database setup'));
  } finally {
    cloudSyncInProgress = false;
    if (cloudSyncPending) {
      cloudSyncPending = false;
      syncRemote();
    }
  }
}

// ── Toast ─────────────────────────────────────────────────────

let _toastEl = null, _toastTimer = null;
function toast(msg, type = 'success') {
  if (!_toastEl) {
    _toastEl = document.createElement('div');
    _toastEl.className = 'toast';
    document.body.appendChild(_toastEl);
  }
  _toastEl.className = `toast ${type}`;
  // clear old text node
  while (_toastEl.firstChild) _toastEl.removeChild(_toastEl.firstChild);
  _toastEl.appendChild(document.createTextNode(msg));
  void _toastEl.offsetWidth;
  _toastEl.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => _toastEl.classList.remove('show'), 2800);
}

// ── Boot ──────────────────────────────────────────────────────

renderAll();
updatePreview();
