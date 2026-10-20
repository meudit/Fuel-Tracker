/* ============================================================
   FuelTrack – app.js
   Odometer-based: stores raw odo reading, derives distance
   from consecutive entries sorted by date.
   ============================================================ */

const STORAGE_KEY = 'fueltrack_entries';

// ── Helpers ──────────────────────────────────────────────────

function fmt2(val) {
  if (val === null || val === undefined || isNaN(val)) return null;
  return parseFloat(val.toFixed(2));
}
function disp(val, suffix = '') {
  if (val === null || val === undefined || isNaN(val)) return '—';
  return val.toFixed(2) + (suffix ? ' ' + suffix : '');
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(d)} ${months[parseInt(m)-1]} '${y.slice(2)}`;
}
function todayLabel() {
  return new Date().toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long' });
}

// ── Storage ──────────────────────────────────────────────────

function load()  { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; } }
function save(e) { localStorage.setItem(STORAGE_KEY, JSON.stringify(e)); }

// ── State ─────────────────────────────────────────────────────

let entries = load();

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

// ── Live Preview ──────────────────────────────────────────────

function updatePreview() {
  const price = parseFloat(inputPrice.value);
  const odo = parseFloat(inputOdo.value);
  const amount = parseFloat(inputAmount.value);
  const currentDate = inputDate.value || todayISO();

  const chronological = entries
    .map((entry, index) => ({ ...entry, _index: index }))
    .filter(entry => entry.date <= currentDate)
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
    prevKmL.classList.add('live');
  } else {
    prevKmL.textContent = fullTankSelected ? 'Need prior full tank' : 'Full tank only';
    prevKmL.classList.remove('live');
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
    .filter(e => e.date <= date && e.odo != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const lastOdo = sorted.length ? sorted[sorted.length - 1].odo : null;
  if (odo !== null && lastOdo !== null && odo <= lastOdo) {
    toast('⚠ Odo reading is lower than last entry!', 'error');
    return;
  }

  // Store only raw fields; derived values calculated at render time
  entries.push({ date, price, odo, amount, fullTank: inputFullTank.checked });
  save(entries);
  renderAll();
  resetForm();
  toast('Entry added', 'success');
});

clearBtn.addEventListener('click', resetForm);
clearAllBtn.addEventListener('click', () => {
  if (!entries.length) return;
  if (confirm('Clear all fuel entries? This cannot be undone.')) {
    entries = []; save(entries); renderAll(); toast('All entries cleared', 'error');
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
  entries.splice(origIdx, 1);
  save(entries);
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
  entries[origIdx] = { date, price, odo, amount, fullTank };
  save(entries);
  renderAll();
  toast('Entry updated', 'success');
}

// ── Render ────────────────────────────────────────────────────

function renderAll() {
  renderHeader();
  renderInsights();
  renderLog();
}

function renderHeader() {
  totalEntriesVal.textContent = entries.length;
  const total = entries.reduce((s, e) => s + (e.amount || 0), 0);
  totalSpendVal.textContent = '₹' + total.toLocaleString('en-IN', {
    minimumFractionDigits: 0, maximumFractionDigits: 0
  });
}

function renderInsights() {
  if (!entries.length) {
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
  if (!entries.length) {
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
          <div class="lc-date">${fmtDate(entry.date)}</div>
          <div class="lc-price">
            ₹${entry.price.toFixed(2)}/L
            ${entry.odo != null ? `&nbsp;·&nbsp; Odo ${entry.odo.toLocaleString('en-IN')} km` : ''}
          
            ${entry.fullTank ? '&nbsp;·&nbsp; Full tank' : '&nbsp;·&nbsp; Partial'}
          </div>
        </div>
        <div class="lc-pills">
          ${hasKmL
            ? `<span class="lc-pill pill-green">${entry.kmPerL.toFixed(2)} km/L</span>`
            : `<span class="lc-pill pill-na">No dist</span>`}
          ${hasRsKm
            ? `<span class="lc-pill pill-orange">₹${entry.rsPerKm.toFixed(2)}/km</span>`
            : ''}
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
