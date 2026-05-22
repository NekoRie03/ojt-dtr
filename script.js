// OJT DTR – Clean, maintainable, smart fill & per-month persistence
// No duplicate / dead code, fixed total hours logic, reliable local storage

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const STORAGE_KEY = "ojt_dtr_v6_permonth";

// global cache: stores all time entries per (blockId, year, month)
let allTimesCache = {};
let currentYear = 2026, currentMonth1 = 4, currentMonth2 = 5;
let saveTimer = null;

// ----- helpers -----
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveToStorage(), 400);
}

function getStorageKey(blockId, year, month) {
  return `${blockId}_${year}_${month}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[m] || m));
}

function toMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return (isNaN(h) || isNaN(m)) ? null : (h * 60 + m);
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

// ---- core time & total calculator (fixed logic, no overwrite bug) ----
function recalcRow(blockId, dayNum) {
  const getField = (suffix) => document.getElementById(`${blockId}_${suffix}_${dayNum}`)?.value;
  const ai = getField('ai'), ao = getField('ao'), pi = getField('pi'), po = getField('po');
  
  let totalMins = 0;
  
  // AM block (arrival -> departure)
  if (ai && ao) {
    const start = toMinutes(ai);
    const end = toMinutes(ao);
    if (start !== null && end !== null && end > start) totalMins += (end - start);
  }
  
  // PM block (arrival -> departure)
  if (pi && po) {
    const start = toMinutes(pi);
    const end = toMinutes(po);
    if (start !== null && end !== null && end > start) totalMins += (end - start);
  }
  
  // Edge case: only AM arrival + PM departure (no AM out / PM in) -> treat as full continuous shift
  if (totalMins === 0 && ai && po && !ao && !pi) {
    const start = toMinutes(ai);
    const end = toMinutes(po);
    if (start !== null && end !== null && end > start) totalMins = end - start;
  }
  
  const hoursSpan = document.getElementById(`${blockId}_h_${dayNum}`);
  const minsSpan = document.getElementById(`${blockId}_m_${dayNum}`);
  if (hoursSpan && minsSpan) {
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    hoursSpan.textContent = totalMins > 0 ? hrs : '';
    minsSpan.textContent = totalMins > 0 ? String(mins).padStart(2, '0') : '';
  }
  return totalMins;
}

// update monthly totals (scan all days)
function updateMonthlyTotals(blockId, year, month) {
  const daysInMonth = getDaysInMonth(year, month);
  let totalMinutes = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const hoursEl = document.getElementById(`${blockId}_h_${d}`);
    const minsEl = document.getElementById(`${blockId}_m_${d}`);
    if (hoursEl && minsEl) {
      const h = parseInt(hoursEl.textContent) || 0;
      const m = parseInt(minsEl.textContent) || 0;
      totalMinutes += (h * 60 + m);
    }
  }
  const totalH = document.getElementById(`${blockId}_th`);
  const totalM = document.getElementById(`${blockId}_tm`);
  if (totalH) totalH.textContent = Math.floor(totalMinutes / 60);
  if (totalM) totalM.textContent = String(totalMinutes % 60).padStart(2, '0');
}

// Save all times of one block into allTimesCache
function captureBlockToCache(blockId, year, month) {
  const days = getDaysInMonth(year, month);
  const key = getStorageKey(blockId, year, month);
  const times = {};
  for (let d = 1; d <= days; d++) {
    const date = new Date(year, month, d);
    if (date.getDay() === 0) continue; // skip Sundays
    ['ai', 'ao', 'pi', 'po'].forEach(type => {
      const el = document.getElementById(`${blockId}_${type}_${d}`);
      if (el) times[`${type}_${d}`] = el.value;
    });
  }
  allTimesCache[key] = times;
}

// Restore times from cache to DOM
function restoreBlockFromCache(blockId, year, month) {
  const key = getStorageKey(blockId, year, month);
  const saved = allTimesCache[key];
  if (!saved) return;
  const days = getDaysInMonth(year, month);
  for (let d = 1; d <= days; d++) {
    if (new Date(year, month, d).getDay() === 0) continue;
    ['ai', 'ao', 'pi', 'po'].forEach(type => {
      const val = saved[`${type}_${d}`];
      const field = document.getElementById(`${blockId}_${type}_${d}`);
      if (field && val !== undefined) field.value = val;
    });
  }
  // recalc each day after restoration
  for (let d = 1; d <= days; d++) {
    if (new Date(year, month, d).getDay() !== 0) recalcRow(blockId, d);
  }
  updateMonthlyTotals(blockId, year, month);
}

// triggered by any time field edit
function onTimeEdit(blockId, dayNum, year, month) {
  recalcRow(blockId, dayNum);
  updateMonthlyTotals(blockId, year, month);
  captureBlockToCache(blockId, year, month);
  scheduleSave();
}

// ----- render whole DTR block (HTML & attach listeners) -----
function buildDTRBlock(blockId, monthIdx, year, employeeName) {
  const daysInMonth = getDaysInMonth(year, monthIdx);
  let tbodyRows = '';
  for (let d = 1; d <= 31; d++) {
    const isReal = d <= daysInMonth;
    if (!isReal) {
      tbodyRows += `<tr class="empty"><td class="day-num">${d}</td><td class="time-cell"></td><td class="time-cell"></td><td class="time-cell"></td><td class="time-cell"></td><td class="val-cell"></td><td class="val-cell"></td></tr>`;
      continue;
    }
    const dt = new Date(year, monthIdx, d);
    const dow = dt.getDay();
    if (dow === 0) {
      tbodyRows += `<tr class="sunday"><td class="day-num">${d}</td><td colspan="4" class="sun-label">Sunday</td><td class="val-cell"></td><td class="val-cell"></td></tr>`;
      continue;
    }
    const satClass = dow === 6 ? 'saturday' : '';
    tbodyRows += `<tr class="${satClass}">
      <td class="day-num">${d}</td>
      <td class="time-cell"><input type="time" id="${blockId}_ai_${d}" autocomplete="off"></td>
      <td class="time-cell"><input type="time" id="${blockId}_ao_${d}" autocomplete="off"></td>
      <td class="time-cell"><input type="time" id="${blockId}_pi_${d}" autocomplete="off"></td>
      <td class="time-cell"><input type="time" id="${blockId}_po_${d}" autocomplete="off"></td>
      <td class="val-cell" id="${blockId}_h_${d}"></td>
      <td class="val-cell" id="${blockId}_m_${d}"></td>
    </tr>`;
  }
  
  const monthName = MONTHS[monthIdx];
  const htmlContent = `
    <div class="dtr-title"><h2>DAILY TIME RECORD</h2><div class="ooo">••• o0o •••</div></div>
    <div class="name-wrap"><span class="name-line emp-name">${escapeHtml(employeeName)}</span></div>
    <div class="name-label">(trainee / employee)</div>
    <div class="dtr-meta">
      <div class="meta-month"><span class="ml">For the month of</span><span class="mv"> ${monthName} ${year}</span></div>
      <div class="meta-hours"><p>Official hours (Monday to Saturday): 8:00 AM – 5:00 PM</p></div>
    </div>
    <table class="dtr-table">
      <thead><tr><th rowspan="2">Day</th><th colspan="2">A.M.</th><th colspan="2">P.M.</th><th colspan="2">Total</th></tr>
      <tr><th>Arrival</th><th>Departure</th><th>Arrival</th><th>Departure</th><th>Hours</th><th>Mins</th></tr></thead>
      <tbody>${tbodyRows}</tbody>
      <tfoot><tr><td colspan="5" class="tlabel">TOTAL HOURS (Month)</td><td class="tval" id="${blockId}_th">0</td><td class="tval" id="${blockId}_tm">00</td></tr></tfoot>
    </table>
    <div class="cert">I certify on my honor that the above is a true and correct report of the hours of work performed, record of which was made daily at the time of arrival and departure from office.
</div>
    <div class="verified">VERIFIED as per prescribed office hours (8:00 AM – 5:00 PM).</div>
    <div class="sig">SUPERVISOR / IN-CHARGE</div>
  `;
  
  const container = document.getElementById(blockId);
  if (container) container.innerHTML = htmlContent;
  
  // attach event listeners to fields
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(year, monthIdx, d).getDay() === 0) continue;
    ['ai', 'ao', 'pi', 'po'].forEach(type => {
      const field = document.getElementById(`${blockId}_${type}_${d}`);
      if (field) {
        field.addEventListener('input', () => onTimeEdit(blockId, d, year, monthIdx));
      }
    });
  }
  
  restoreBlockFromCache(blockId, year, monthIdx);
}

// ----- build both months -----
function rebuildAll() {
  const year = parseInt(document.getElementById('cfgYear').value);
  const m1 = parseInt(document.getElementById('cfgMonth1').value);
  const m2 = parseInt(document.getElementById('cfgMonth2').value);
  const traineeName = document.getElementById('cfgName').value.trim() || '';
  
  buildDTRBlock('block1', m1, year, traineeName);
  buildDTRBlock('block2', m2, year, traineeName);
}

// re-apply current name to .emp-name elements (if needed)
function syncEmployeeNameToUI() {
  const name = document.getElementById('cfgName').value.trim() || '';
  document.querySelectorAll('.emp-name').forEach(el => el.textContent = name);
}

// ----- smart fill (on focus, empty AI or PO) -----
function setupSmartFill() {
  document.body.addEventListener('focus', (e) => {
    const input = e.target;
    if (!input || input.tagName !== 'INPUT' || input.type !== 'time') return;
    const parts = input.id?.split('_');
    if (!parts || parts.length !== 3) return;
    const [blockId, fieldType, dayStr] = parts;
    const dayNum = parseInt(dayStr);
    if (isNaN(dayNum)) return;
    
    // Allow all four field types: ai, ao, pi, po
    if (!['ai', 'ao', 'pi', 'po'].includes(fieldType)) return;
    if (input.value && input.value.trim() !== "") return;
    
    // get proper year/month for this block
    const year = parseInt(document.getElementById('cfgYear').value);
    const monthSel = blockId === 'block1' ? 'cfgMonth1' : 'cfgMonth2';
    const month = parseInt(document.getElementById(monthSel).value);
    const date = new Date(year, month, dayNum);
    if (date.getDay() === 0) return; // skip Sunday
    
    // Set default time based on field type
    let defaultValue;
    switch (fieldType) {
      case 'ai': defaultValue = "08:00"; break;
      case 'ao': defaultValue = "11:30"; break;
      case 'pi': defaultValue = "12:00"; break;
      case 'po': defaultValue = "17:00"; break;
      default: return;
    }
    input.value = defaultValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, true);
}
// ----- persistence (localStorage) -----
function saveToStorage() {
  const config = {
    name: document.getElementById('cfgName').value,
    color: document.getElementById('cfgColor').value,
    year: parseInt(document.getElementById('cfgYear').value),
    month1: parseInt(document.getElementById('cfgMonth1').value),
    month2: parseInt(document.getElementById('cfgMonth2').value),
    allTimes: allTimesCache
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  const indicator = document.getElementById('savedIndicator');
  if (indicator) {
    indicator.classList.add('show');
    setTimeout(() => indicator.classList.remove('show'), 1300);
  }
}

function loadFromStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    if (data.name !== undefined) document.getElementById('cfgName').value = data.name;
    if (data.color) {
      document.getElementById('cfgColor').value = data.color;
      applyColor(data.color);
    }
    if (data.year) document.getElementById('cfgYear').value = data.year;
    if (data.month1 !== undefined) document.getElementById('cfgMonth1').value = data.month1;
    if (data.month2 !== undefined) document.getElementById('cfgMonth2').value = data.month2;
    if (data.allTimes) allTimesCache = data.allTimes;
    return true;
  } catch(e) { return false; }
}

// ----- events: month/year change (save previous then rebuild)-----
function handleMonthChange() {
  const year = parseInt(document.getElementById('cfgYear').value);
  const newM1 = parseInt(document.getElementById('cfgMonth1').value);
  const newM2 = parseInt(document.getElementById('cfgMonth2').value);
  
  // save current state of old months before switching
  captureBlockToCache('block1', currentYear, currentMonth1);
  captureBlockToCache('block2', currentYear, currentMonth2);
  
  currentYear = year;
  currentMonth1 = newM1;
  currentMonth2 = newM2;
  rebuildAll();
  scheduleSave();
}

function handleYearChange() {
  const newYear = parseInt(document.getElementById('cfgYear').value);
  captureBlockToCache('block1', currentYear, currentMonth1);
  captureBlockToCache('block2', currentYear, currentMonth2);
  
  currentYear = newYear;
  rebuildAll();
  scheduleSave();
}

function clearAllRecords() {
  if (!confirm('Clear ALL time entries for both months? This action is permanent.')) return;
  allTimesCache = {};
  rebuildAll();
  scheduleSave();
}

function applyColor(hex) {
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent-light', hex + '15');
}

// ----- initial startup & wiring -----
window.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();
  
  // sync current tracking variables
  currentYear = parseInt(document.getElementById('cfgYear').value);
  currentMonth1 = parseInt(document.getElementById('cfgMonth1').value);
  currentMonth2 = parseInt(document.getElementById('cfgMonth2').value);
  
  rebuildAll();
  setupSmartFill();
  syncEmployeeNameToUI();
  
  // event listeners
  document.getElementById('cfgName').addEventListener('input', () => {
    syncEmployeeNameToUI();
    scheduleSave();
  });
  document.getElementById('cfgMonth1').addEventListener('change', handleMonthChange);
  document.getElementById('cfgMonth2').addEventListener('change', handleMonthChange);
  document.getElementById('cfgYear').addEventListener('change', handleYearChange);
  document.getElementById('cfgColor').addEventListener('input', (e) => {
    applyColor(e.target.value);
    scheduleSave();
  });
  document.getElementById('printBtn').addEventListener('click', () => window.print());
  document.getElementById('clearAllBtn').addEventListener('click', clearAllRecords);
  
  // extra name sync on any external set
  applyColor(document.getElementById('cfgColor').value);
});
