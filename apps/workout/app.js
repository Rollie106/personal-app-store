// Workout Tracker — vanilla JS, single file.
//
// State lives in localStorage under one key. Every weight is stored in kg
// (the canonical unit) — a future kg↔lb toggle will convert only for display.
//
// Three views (Log / History / Progress) live in the same page; switching
// just toggles `hidden` on three <section> elements. No router.

// ---------- Constants ----------

const STORAGE_KEY = 'workout-tracker:v1';

// Hard-coded for v1 (PRD §10). "Add custom exercise" is intentionally out of scope.
const EXERCISES = [
  'Bench Press',
  'Squat',
  'Deadlift',
  'Overhead Press',
  'Barbell Row',
  'Pull-up',
];

// ---------- Persistence ----------

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { workouts: [] };
    const parsed = JSON.parse(raw);
    return { workouts: Array.isArray(parsed.workouts) ? parsed.workouts : [] };
  } catch (err) {
    console.warn('Could not parse stored workouts; starting fresh.', err);
    return { workouts: [] };
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// One source of truth, mutated through helpers below.
let state = loadState();

// ---------- DOM refs ----------

const $ = (sel) => document.querySelector(sel);

const exerciseSelect  = $('#exercise-select');
const progressSelect  = $('#progress-select');
const setsList        = $('#sets-list');
const addSetBtn       = $('#add-set-btn');
const repeatBtn       = $('#repeat-btn');
const notesInput      = $('#notes-input');
const saveBtn         = $('#save-btn');
const historyList     = $('#history-list');
const chartContainer  = $('#chart-container');
const segButtons      = document.querySelectorAll('.seg');
const views = {
  log:      $('#view-log'),
  history:  $('#view-history'),
  progress: $('#view-progress'),
};

// ---------- View switching ----------

function setView(name) {
  for (const key of Object.keys(views)) {
    views[key].hidden = (key !== name);
  }
  segButtons.forEach((b) => {
    const active = b.dataset.view === name;
    b.classList.toggle('seg--active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  // Re-render the entered view so it's fresh
  if (name === 'history')  renderHistory();
  if (name === 'progress') renderProgress();
}

segButtons.forEach((b) => {
  b.addEventListener('click', () => setView(b.dataset.view));
});

// ---------- Log view ----------

function populateExerciseSelects() {
  const opts = EXERCISES.map((ex) => `<option value="${escapeHTML(ex)}">${escapeHTML(ex)}</option>`).join('');
  exerciseSelect.innerHTML = opts;
  progressSelect.innerHTML = opts;
}

function renderSetsList(sets) {
  // sets: [{reps, weight}, ...]
  setsList.innerHTML = sets.map((s, i) => `
    <li class="set-row" data-index="${i}">
      <input type="number" inputmode="numeric" min="0" placeholder="Reps"   value="${s.reps   ?? ''}" data-field="reps">
      <input type="number" inputmode="decimal" min="0" step="0.5" placeholder="Weight (kg)" value="${s.weight ?? ''}" data-field="weight">
      <button type="button" class="set-row__remove" aria-label="Remove set">×</button>
    </li>
  `).join('');
}

// In-memory form sets (separate from saved workouts so the form is editable freely)
let formSets = [{ reps: '', weight: '' }];

function refreshForm() {
  renderSetsList(formSets);
  updateRepeatBtn();
}

function readSetsFromDOM() {
  return Array.from(setsList.querySelectorAll('.set-row')).map((row) => ({
    reps:   row.querySelector('[data-field="reps"]').value,
    weight: row.querySelector('[data-field="weight"]').value,
  }));
}

setsList.addEventListener('input', () => {
  formSets = readSetsFromDOM();
});

setsList.addEventListener('click', (e) => {
  const btn = e.target.closest('.set-row__remove');
  if (!btn) return;
  formSets = readSetsFromDOM();
  const i = Number(btn.closest('.set-row').dataset.index);
  formSets.splice(i, 1);
  if (formSets.length === 0) formSets = [{ reps: '', weight: '' }];
  refreshForm();
});

addSetBtn.addEventListener('click', () => {
  formSets = readSetsFromDOM();
  formSets.push({ reps: '', weight: '' });
  refreshForm();
});

// "Repeat last workout" — pre-fill from the most recent entry for the selected exercise
function findLastFor(exercise) {
  // workouts are stored newest-first (we prepend on save)
  return state.workouts.find((w) => w.exercise === exercise) || null;
}

function updateRepeatBtn() {
  const last = findLastFor(exerciseSelect.value);
  repeatBtn.disabled = !last;
  repeatBtn.textContent = last
    ? '↻ Repeat last workout'
    : '↻ No previous workout for this exercise';
}

exerciseSelect.addEventListener('change', updateRepeatBtn);

repeatBtn.addEventListener('click', () => {
  const last = findLastFor(exerciseSelect.value);
  if (!last) return;
  // Deep copy so editing doesn't mutate the saved entry
  formSets = last.sets.map((s) => ({ reps: s.reps, weight: s.weight }));
  refreshForm();
});

saveBtn.addEventListener('click', () => {
  const exercise = exerciseSelect.value;
  const raw = readSetsFromDOM();

  // Validate: each set needs positive reps; weight ≥ 0 (Pull-up bodyweight = 0)
  const sets = [];
  for (const s of raw) {
    const reps   = Number(s.reps);
    const weight = Number(s.weight);
    if (!Number.isFinite(reps) || reps <= 0) continue;
    if (!Number.isFinite(weight) || weight < 0) continue;
    sets.push({ reps, weight });
  }
  if (sets.length === 0) {
    alert('Add at least one set with reps and weight (use 0 for bodyweight).');
    return;
  }

  const entry = {
    id: Date.now().toString(),
    date: new Date().toISOString(),
    exercise,
    sets,
    unit: 'kg',
    notes: notesInput.value.trim(),
  };
  state.workouts.unshift(entry);  // newest first
  saveState(state);

  // Reset form
  formSets = [{ reps: '', weight: '' }];
  notesInput.value = '';
  refreshForm();

  // Jump to History and briefly highlight the new entry
  setView('history');
  const firstItem = historyList.querySelector('.history-item');
  if (firstItem) {
    firstItem.classList.add('history-item--new');
    setTimeout(() => firstItem.classList.remove('history-item--new'), 1500);
  }
});

// ---------- History view ----------

function renderHistory() {
  if (state.workouts.length === 0) {
    historyList.innerHTML = `<li class="empty">No workouts yet. Log your first one in the Log tab.</li>`;
    return;
  }
  historyList.innerHTML = state.workouts.map((w) => `
    <li class="history-item">
      <div class="history-item__meta">
        <span class="history-item__exercise">${escapeHTML(w.exercise)}</span>
        <span class="history-item__date">${escapeHTML(relativeDate(w.date))}</span>
      </div>
      <div class="history-item__sets">${escapeHTML(summarizeSets(w.sets))}</div>
      ${w.notes ? `<div class="history-item__notes">${escapeHTML(w.notes)}</div>` : ''}
    </li>
  `).join('');
}

// Collapse identical (reps, weight) runs: "3 × 8 @ 60kg, 1 × 6 @ 65kg"
function summarizeSets(sets) {
  if (!sets || sets.length === 0) return '';
  const groups = [];
  for (const s of sets) {
    const last = groups[groups.length - 1];
    if (last && last.reps === s.reps && last.weight === s.weight) {
      last.count += 1;
    } else {
      groups.push({ reps: s.reps, weight: s.weight, count: 1 });
    }
  }
  return groups.map((g) => `${g.count} × ${g.reps} @ ${g.weight}kg`).join(', ');
}

function relativeDate(iso) {
  const then = new Date(iso);
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  const startOfNow  = new Date(now.getFullYear(),  now.getMonth(),  now.getDate()).getTime();
  const days = Math.round((startOfNow - startOfThen) / dayMs);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7)   return `${days} days ago`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---------- Progress view ----------

function renderProgress() {
  const exercise = progressSelect.value;
  // Oldest-first for chart x-axis
  const sessions = state.workouts
    .filter((w) => w.exercise === exercise)
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (sessions.length < 2) {
    chartContainer.innerHTML = `<div class="empty">Need at least 2 sessions of ${escapeHTML(exercise)} to plot progress.</div>`;
    return;
  }

  // Top working set = max weight across the sets in each session
  const points = sessions.map((s) => ({
    date: new Date(s.date).getTime(),
    weight: Math.max(...s.sets.map((set) => set.weight)),
  }));
  chartContainer.innerHTML = renderChartSVG(points);
}

progressSelect.addEventListener('change', renderProgress);

// Hand-rolled SVG chart. ~60 LOC including axes, gridline, polyline, points.
function renderChartSVG(points) {
  const W = 600, H = 240;
  const pad = { top: 16, right: 16, bottom: 28, left: 44 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const xs = points.map((p) => p.date);
  const ys = points.map((p) => p.weight);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yRaw = Math.min(...ys), yPeak = Math.max(...ys);
  const yPad = Math.max(2, (yPeak - yRaw) * 0.15);
  const yMin = Math.max(0, Math.floor(yRaw - yPad));
  const yMax = Math.ceil(yPeak + yPad);

  const xScale = (x) => pad.left + ((x - xMin) / Math.max(1, xMax - xMin)) * innerW;
  const yScale = (y) => pad.top + innerH - ((y - yMin) / Math.max(1, yMax - yMin)) * innerH;

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.date).toFixed(1)} ${yScale(p.weight).toFixed(1)}`).join(' ');

  const circles = points.map((p) => {
    const cx = xScale(p.date).toFixed(1);
    const cy = yScale(p.weight).toFixed(1);
    const label = `${new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} — ${p.weight}kg`;
    return `<circle class="data-point" cx="${cx}" cy="${cy}" r="4"><title>${escapeHTML(label)}</title></circle>`;
  }).join('');

  // Y-axis: min / mid / max
  const yMid = Math.round((yMin + yMax) / 2);
  const yTicks = [yMin, yMid, yMax].map((v) => `
    <line class="grid-line" x1="${pad.left}" x2="${W - pad.right}" y1="${yScale(v)}" y2="${yScale(v)}"/>
    <text class="axis-text" x="${pad.left - 8}" y="${yScale(v) + 4}" text-anchor="end">${v}kg</text>
  `).join('');

  // X-axis: first and last date labels
  const xLabel = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const xTicks = `
    <text class="axis-text" x="${xScale(xMin)}" y="${H - 8}" text-anchor="start">${escapeHTML(xLabel(xMin))}</text>
    <text class="axis-text" x="${xScale(xMax)}" y="${H - 8}" text-anchor="end">${escapeHTML(xLabel(xMax))}</text>
  `;

  return `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Top set weight over time">
      ${yTicks}
      <line class="axis-line" x1="${pad.left}" x2="${W - pad.right}" y1="${pad.top + innerH}" y2="${pad.top + innerH}"/>
      <path class="data-line" d="${linePath}"/>
      ${circles}
      ${xTicks}
    </svg>
  `;
}

// ---------- Utils ----------

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- Init ----------

populateExerciseSelects();
refreshForm();
setView('log');
