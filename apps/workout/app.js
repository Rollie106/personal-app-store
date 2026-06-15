// Workout Tracker — vanilla JS, single file.
//
// State lives in localStorage under one key. Every weight is stored in kg
// (the canonical unit) — a future kg↔lb toggle will convert only for display.
//
// Three views (Log / History / Progress) live in the same page; switching
// just toggles `hidden` on three <section> elements. No router.

// ---------- Constants ----------

const STORAGE_KEY = 'workout-tracker:v1';

// PRD-04: custom exercises persisted separately so clearing workout history
// doesn't lose a curated exercise list, and vice versa.
const CUSTOM_EXERCISES_KEY = 'custom-exercises:v1';

// Starter list. Voice/text parsing adds anything else the user mentions
// to `customExercises` (persisted to localStorage), and both lists render
// together — starter first, then a divider, then custom (alphabetical).
const STARTER_EXERCISES = [
  'Bench Press',
  'Squat',
  'Deadlift',
  'Overhead Press',
  'Barbell Row',
  'Pull-up',
];

// PRD-04 Session C: muscle group heat map.
//
// Approved 2026-06-15. Keys are exact-match against `workout.exercise` strings.
// Values are logical muscle names that match SVG path IDs (with _left/_right
// suffixes stripped at render time — see renderHeatmap).
// Primary muscles only in v2.
const MUSCLE_MAP = {
  'Bench Press':            ['chest', 'triceps', 'shoulders'],
  'Overhead Press':         ['shoulders', 'triceps'],
  'Incline Dumbbell Press': ['chest', 'shoulders'],
  'Tricep Pushdown':        ['triceps'],
  'Pull-up':                ['back', 'biceps'],
  'Barbell Row':            ['back', 'biceps'],
  'Bicep Curl':             ['biceps'],
  'Squat':                  ['quads', 'glutes'],
  'Romanian Deadlift':      ['hamstrings', 'glutes'],
  'Leg Extension':          ['quads'],
  'Deadlift':               ['hamstrings', 'glutes', 'back'],
  'Hammer Curl':            ['biceps'],
  'Lateral Raise':          ['shoulders'],
};

// Absolute kg thresholds for 4-bucket coloring (Rohan, 2026-06-15).
// Edit these four lines to retune.
const HEATMAP_WINDOW_DAYS = 30;
const BUCKET_LIGHT_MIN  = 1;
const BUCKET_MEDIUM_MIN = 2500;
const BUCKET_FULL_MIN   = 7500;

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

// Custom exercises (PRD-04). Mirror loadState/saveState pattern but on a
// separate key so the two registries can be cleared independently.
function loadCustomExercises() {
  try {
    const raw = localStorage.getItem(CUSTOM_EXERCISES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.exercises) ? parsed.exercises.filter((s) => typeof s === 'string' && s.trim()) : [];
  } catch (err) {
    console.warn('Could not parse custom exercises; starting fresh.', err);
    return [];
  }
}

function saveCustomExercises(list) {
  localStorage.setItem(CUSTOM_EXERCISES_KEY, JSON.stringify({ exercises: list }));
}

function addCustomExercise(name) {
  const clean = String(name || '').trim();
  if (!clean) return false;
  // Don't duplicate starter or existing custom
  if (STARTER_EXERCISES.includes(clean)) return false;
  if (customExercises.includes(clean)) return false;
  customExercises.push(clean);
  customExercises.sort((a, b) => a.localeCompare(b));
  saveCustomExercises(customExercises);
  return true;
}

function removeCustomExercise(name) {
  const i = customExercises.indexOf(name);
  if (i < 0) return false;
  customExercises.splice(i, 1);
  saveCustomExercises(customExercises);
  return true;
}

// One source of truth, mutated through helpers below.
let state = loadState();
let customExercises = loadCustomExercises();

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
const heatmapContainer = $('#heatmap-container');
const segButtons      = document.querySelectorAll('.seg');

// Wispr-first entry refs (PRD-04 Session B). Textarea + Parse are always
// visible; the device mic is a small inline link, hidden if SpeechRecognition
// isn't available in this browser.
const wisprBlock      = $('#wispr-block');
const micBtn          = $('#mic-btn');
const transcriptText  = $('#transcript-text');
const parseBtn        = $('#parse-btn');
const voiceError      = $('#voice-error');
const rpeRow          = $('#rpe-row');
const rpeValueEl      = $('#rpe-value');
const rpeClearBtn     = $('#rpe-clear');

// Manage custom exercises (PRD-04)
const manageCustom    = $('#manage-custom');
const manageCustomList = $('#manage-custom-list');

// Multi-exercise preview (PRD-04)
const previewStackWrap = $('#preview-stack-wrap');
const previewStack     = $('#preview-stack');
const previewCount     = $('#preview-count');
const previewSaveBtn   = $('#preview-save-btn');
const previewDiscardBtn = $('#preview-discard-btn');

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

// Build the dropdown HTML used by every exercise <select> on the page:
// starter list (alphabetical) + divider + custom list (alphabetical).
// Re-render any time customExercises changes.
function buildExerciseOptionsHTML() {
  const starter = STARTER_EXERCISES.slice().sort((a, b) => a.localeCompare(b));
  const starterOpts = starter.map((ex) => `<option value="${escapeHTML(ex)}">${escapeHTML(ex)}</option>`).join('');
  if (customExercises.length === 0) return starterOpts;
  const customOpts = customExercises.map((ex) => `<option value="${escapeHTML(ex)}">${escapeHTML(ex)}</option>`).join('');
  // Disabled divider so it can't be selected. Width-padded em-dashes for visual separation.
  return starterOpts + `<option disabled>──────</option>` + customOpts;
}

function populateExerciseSelects() {
  const html = buildExerciseOptionsHTML();
  // Preserve current selection where possible so re-renders don't reset the dropdown.
  const prevMain = exerciseSelect.value;
  const prevProg = progressSelect.value;
  exerciseSelect.innerHTML = html;
  progressSelect.innerHTML = html;
  if (prevMain && Array.from(exerciseSelect.options).some((o) => o.value === prevMain)) {
    exerciseSelect.value = prevMain;
  }
  if (prevProg && Array.from(progressSelect.options).some((o) => o.value === prevProg)) {
    progressSelect.value = prevProg;
  }
  // Also re-render any open preview-card dropdowns
  document.querySelectorAll('.preview-card select[data-card-field="exercise"]').forEach((sel) => {
    const prev = sel.value;
    sel.innerHTML = html;
    if (prev && Array.from(sel.options).some((o) => o.value === prev)) sel.value = prev;
  });
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

// Optional RPE for the current form; set by voice parse, cleared on save or × tap
let formRpe = null;

function setRpe(value) {
  formRpe = (Number.isInteger(value) && value >= 1 && value <= 10) ? value : null;
  if (formRpe == null) {
    if (rpeRow) rpeRow.hidden = true;
  } else {
    if (rpeValueEl) rpeValueEl.textContent = String(formRpe);
    if (rpeRow)     rpeRow.hidden = false;
  }
}

// Add an exercise to the persisted custom list if it isn't already known
// (starter or custom). Persists to localStorage and re-renders all dropdowns
// + the "Manage custom exercises" UI.
function addExerciseIfNew(name) {
  const added = addCustomExercise(name);
  if (!added) return;
  populateExerciseSelects();
  renderManageCustom();
}

// Renders the small "Manage custom exercises" section at the bottom of Log.
// Hidden when there are none.
function renderManageCustom() {
  if (!manageCustom || !manageCustomList) return;
  if (customExercises.length === 0) {
    manageCustom.hidden = true;
    manageCustomList.innerHTML = '';
    return;
  }
  manageCustom.hidden = false;
  manageCustomList.innerHTML = customExercises.map((name) => `
    <li class="manage-custom__item">
      <span class="manage-custom__name">${escapeHTML(name)}</span>
      <button type="button" class="manage-custom__remove" data-name="${escapeHTML(name)}" aria-label="Remove ${escapeHTML(name)}">×</button>
    </li>
  `).join('');
}

if (manageCustomList) {
  manageCustomList.addEventListener('click', (e) => {
    const btn = e.target.closest('.manage-custom__remove');
    if (!btn) return;
    const name = btn.dataset.name;
    if (!name) return;
    if (!confirm(`Remove "${name}" from your custom exercises?`)) return;
    removeCustomExercise(name);
    populateExerciseSelects();
    renderManageCustom();
  });
}

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
  if (formRpe != null) entry.rpe = formRpe;

  state.workouts.unshift(entry);  // newest first
  saveState(state);

  // Reset form
  formSets = [{ reps: '', weight: '' }];
  notesInput.value = '';
  setRpe(null);
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
        <span class="history-item__exercise">
          ${escapeHTML(w.exercise)}${Number.isInteger(w.rpe) ? `<span class="history-item__rpe">RPE ${w.rpe}</span>` : ''}
        </span>
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
  // Heat map at the top — independent of the exercise picker below.
  refreshHeatmap();

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

// ---------- Heat map (PRD-04 Session C) ----------

let heatmapLoaded = false;
let heatmapLoading = null;  // in-flight Promise to dedupe concurrent fetches

async function refreshHeatmap() {
  if (!heatmapContainer) return;
  if (!heatmapLoaded) {
    // Lazy-load the SVG on first Progress visit. Subsequent calls just re-color.
    if (!heatmapLoading) heatmapLoading = loadHeatmapSVG();
    try { await heatmapLoading; } catch (e) { return; }
  }
  const svg = heatmapContainer.querySelector('svg');
  if (!svg) return;
  const volumes = computeMuscleVolume(state.workouts, HEATMAP_WINDOW_DAYS);
  renderHeatmap(svg, volumes);
}

async function loadHeatmapSVG() {
  try {
    const res = await fetch('/apps/workout/body-diagram.svg', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const svgText = await res.text();
    heatmapContainer.innerHTML = svgText;
    heatmapLoaded = true;
  } catch (err) {
    console.warn('[heatmap] could not load body-diagram.svg:', err);
    heatmapContainer.innerHTML = '';  // graceful empty
    throw err;
  }
}

// Cumulative volume per muscle in the last `sinceDays` days.
// volume = sets × reps × weight (canonical kg). Unmapped exercises silently
// contribute nothing but are logged once so future-Rohan sees the gap.
const _unmappedLogged = new Set();

function computeMuscleVolume(workouts, sinceDays = HEATMAP_WINDOW_DAYS) {
  const cutoff = Date.now() - sinceDays * 86400 * 1000;
  const totals = {};
  for (const w of workouts) {
    const t = new Date(w.date).getTime();
    if (!Number.isFinite(t) || t < cutoff) continue;
    const muscles = MUSCLE_MAP[w.exercise];
    if (!muscles) {
      if (!_unmappedLogged.has(w.exercise)) {
        _unmappedLogged.add(w.exercise);
        console.info('[heatmap] unmapped exercise:', w.exercise);
      }
      continue;
    }
    if (!Array.isArray(w.sets)) continue;
    const volume = w.sets.reduce((sum, s) => {
      const r = Number(s.reps), wt = Number(s.weight);
      if (!Number.isFinite(r) || !Number.isFinite(wt)) return sum;
      return sum + (r * wt);
    }, 0);
    for (const m of muscles) {
      totals[m] = (totals[m] || 0) + volume;
    }
  }
  return totals;
}

function bucketFill(volume) {
  if (volume < BUCKET_LIGHT_MIN)  return 'var(--border)';
  if (volume < BUCKET_MEDIUM_MIN) return 'rgba(0, 113, 227, 0.25)';
  if (volume < BUCKET_FULL_MIN)   return 'rgba(0, 113, 227, 0.55)';
  return '#0071e3';
}

function renderHeatmap(svgRootEl, volumes) {
  svgRootEl.querySelectorAll('path.muscle[id]').forEach((el) => {
    // "chest_left" -> "chest" so both halves share one volume bucket
    const muscle = el.id.replace(/_(left|right)$/, '');
    const v = volumes[muscle] || 0;
    el.setAttribute('fill', bucketFill(v));
  });
}

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

// ---------- Voice (Web Speech API + Gemini parser) ----------
//
// iOS Safari exposes webkitSpeechRecognition (on-device transcription).
// If it's missing, the mic UI stays hidden and form-only logging still works.

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;
let liveTranscript = '';   // accumulates final results across an utterance
let isRecording = false;

function showVoiceError(msg) {
  if (!voiceError) return;
  voiceError.textContent = msg;
  voiceError.hidden = false;
}
function clearVoiceError() {
  if (!voiceError) return;
  voiceError.textContent = '';
  voiceError.hidden = true;
}

function setRecordingUI(on) {
  isRecording = on;
  micBtn.classList.toggle('mic-link--recording', on);
  micBtn.textContent = on ? '■ Stop recording' : '🎤 Use device mic instead';
}

function startRecording() {
  clearVoiceError();
  // Append-not-replace: capture any existing textarea content (typed, pasted,
  // or Wispr-dictated) so the user can add more via mic without losing it.
  const startingText = transcriptText.value.trim();
  liveTranscript = '';

  recognition = new SpeechRecognition();
  recognition.lang = navigator.language || 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) liveTranscript += res[0].transcript + ' ';
      else interim += res[0].transcript;
    }
    const combined = `${startingText} ${liveTranscript} ${interim}`.replace(/\s+/g, ' ').trim();
    transcriptText.value = combined;
  };

  recognition.onerror = (event) => {
    setRecordingUI(false);
    const code = event.error;
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      showVoiceError('Microphone permission denied. Enable it in Settings → Safari → Microphone.');
    } else if (code === 'no-speech') {
      showVoiceError('Didn’t catch anything. Try again.');
    } else {
      showVoiceError('Speech recognition error: ' + code);
    }
  };

  recognition.onend = () => {
    setRecordingUI(false);
  };

  try {
    recognition.start();
    setRecordingUI(true);
  } catch (err) {
    showVoiceError('Could not start recording: ' + err.message);
  }
}

function stopRecording() {
  if (recognition) {
    try { recognition.stop(); } catch (e) { /* ignore */ }
  }
  setRecordingUI(false);
}

if (micBtn) {
  micBtn.addEventListener('click', () => {
    if (isRecording) stopRecording();
    else startRecording();
  });
}

if (parseBtn) {
  parseBtn.addEventListener('click', async () => {
    if (isRecording) stopRecording();
    const transcript = transcriptText.value.trim();
    if (!transcript) {
      showVoiceError('Transcript is empty.');
      return;
    }
    clearVoiceError();
    parseBtn.disabled = true;
    parseBtn.textContent = 'Parsing…';
    try {
      const parsed = await parseWithGemini(transcript);
      renderPreviewCards(parsed.workouts);
      // Clear the textarea so a follow-up rant starts fresh.
      transcriptText.value = '';
      liveTranscript = '';
    } catch (err) {
      showVoiceError(err.message || 'Could not parse workout.');
    } finally {
      parseBtn.disabled = false;
      parseBtn.textContent = 'Parse →';
    }
  });
}

async function parseWithGemini(transcript) {
  let res;
  try {
    res = await fetch('/api/parse-workout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript }),
    });
  } catch (e) {
    throw new Error('Couldn’t reach the parser. Check your connection.');
  }
  let data;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) {
    const detail = data?.error || `HTTP ${res.status}`;
    throw new Error(detail);
  }
  if (!data || !Array.isArray(data.workouts)) {
    throw new Error('Parser returned an unexpected shape.');
  }
  return data;
}

// ---------- Multi-exercise preview (PRD-04) ----------
//
// After parse: render N editable cards into #preview-stack. Each card mirrors
// the manual form (exercise dropdown, sets list with × per row, notes input,
// optional RPE chip), plus a per-card × in the top right to remove the whole
// card before saving. Save-all writes all cards as separate workout entries
// with one shared timestamp.

function renderPreviewCards(workouts) {
  if (!previewStack || !previewStackWrap) return;

  // First persist any new exercises so dropdowns include them.
  workouts.forEach((w) => addExerciseIfNew(w.exercise));

  const html = workouts.map((w, i) => renderPreviewCardHTML(w, i)).join('');
  previewStack.innerHTML = html;

  // After mount, set each card's dropdown value (innerHTML can't pre-select reliably)
  Array.from(previewStack.querySelectorAll('.preview-card')).forEach((cardEl, i) => {
    const sel = cardEl.querySelector('select[data-card-field="exercise"]');
    if (sel) sel.value = workouts[i].exercise;
  });

  previewCount.textContent = String(workouts.length);
  previewStackWrap.hidden = false;
  document.body.classList.add('preview-active');
}

function renderPreviewCardHTML(w, index) {
  const sets = Array.isArray(w.sets) ? w.sets : [];
  const setsHTML = (sets.length > 0 ? sets : [{ reps: '', weight: '' }])
    .map((s, i) => renderCardSetRowHTML(s, i))
    .join('');
  const rpeShown = Number.isInteger(w.rpe) && w.rpe >= 1 && w.rpe <= 10;
  return `
    <div class="preview-card" data-card-index="${index}" data-rpe="${rpeShown ? w.rpe : ''}">
      <button type="button" class="preview-card__remove" data-action="remove-card" aria-label="Remove this exercise">×</button>
      <label class="field">
        <span class="field__label">Exercise</span>
        <select data-card-field="exercise">${buildExerciseOptionsHTML()}</select>
      </label>
      <div class="sets">
        <div class="sets__header"><span>Sets</span></div>
        <ul class="sets__list" data-card-sets>${setsHTML}</ul>
        <button type="button" class="btn btn--ghost" data-action="add-set">+ Add set</button>
      </div>
      <label class="field">
        <span class="field__label">Notes (optional)</span>
        <input type="text" data-card-field="notes" value="${escapeHTML(w.notes || '')}" placeholder="How did it feel?">
      </label>
      ${rpeShown ? `
        <div class="rpe-row">
          <span class="rpe-chip">RPE <span data-card-rpe-display>${w.rpe}</span></span>
          <button type="button" class="rpe-clear" data-action="clear-rpe" aria-label="Clear RPE">×</button>
        </div>
      ` : ''}
    </div>
  `;
}

function renderCardSetRowHTML(s, i) {
  return `
    <li class="set-row" data-index="${i}">
      <input type="number" inputmode="numeric" min="0" placeholder="Reps"   value="${s.reps   ?? ''}" data-field="reps">
      <input type="number" inputmode="decimal" min="0" step="0.5" placeholder="Weight (kg)" value="${s.weight ?? ''}" data-field="weight">
      <button type="button" class="set-row__remove" aria-label="Remove set">×</button>
    </li>
  `;
}

function readCardData(cardEl) {
  const sel = cardEl.querySelector('select[data-card-field="exercise"]');
  const notes = cardEl.querySelector('input[data-card-field="notes"]');
  const rows = Array.from(cardEl.querySelectorAll('.set-row'));
  const sets = rows.map((row) => ({
    reps:   row.querySelector('[data-field="reps"]').value,
    weight: row.querySelector('[data-field="weight"]').value,
  }));
  const rpeAttr = cardEl.dataset.rpe;
  const rpe = rpeAttr ? Number(rpeAttr) : null;
  return {
    exercise: sel ? sel.value : '',
    sets,
    notes: notes ? notes.value.trim() : '',
    rpe: Number.isInteger(rpe) && rpe >= 1 && rpe <= 10 ? rpe : null,
  };
}

function discardPreview() {
  if (!previewStack || !previewStackWrap) return;
  previewStack.innerHTML = '';
  previewStackWrap.hidden = true;
  previewCount.textContent = '0';
  document.body.classList.remove('preview-active');
}

function saveAllPreviewCards() {
  if (!previewStack) return;
  const cards = Array.from(previewStack.querySelectorAll('.preview-card'));
  if (cards.length === 0) {
    discardPreview();
    return;
  }

  // Validate every card up front so we don't half-save.
  const entries = [];
  const sharedTimestamp = new Date().toISOString();
  for (let i = 0; i < cards.length; i++) {
    const raw = readCardData(cards[i]);
    if (!raw.exercise) {
      alert(`Card ${i + 1}: exercise is empty.`);
      return;
    }
    const sets = [];
    for (const s of raw.sets) {
      const reps   = Number(s.reps);
      const weight = Number(s.weight);
      if (!Number.isFinite(reps) || reps <= 0) continue;
      if (!Number.isFinite(weight) || weight < 0) continue;
      sets.push({ reps, weight });
    }
    if (sets.length === 0) {
      alert(`Card ${i + 1} (${raw.exercise}): add at least one set with reps and weight (use 0 for bodyweight).`);
      return;
    }
    const entry = {
      id: `${Date.now()}-${i}`,
      date: sharedTimestamp,
      exercise: raw.exercise,
      sets,
      unit: 'kg',
      notes: raw.notes,
    };
    if (raw.rpe != null) entry.rpe = raw.rpe;
    entries.push(entry);
  }

  // Unshift in reverse so the first card ends up at the top of history.
  for (let i = entries.length - 1; i >= 0; i--) {
    state.workouts.unshift(entries[i]);
  }
  saveState(state);

  discardPreview();
  setView('history');

  // Briefly highlight the newly saved batch (top N entries).
  const items = historyList.querySelectorAll('.history-item');
  for (let i = 0; i < entries.length && i < items.length; i++) {
    items[i].classList.add('history-item--new');
  }
  setTimeout(() => {
    historyList.querySelectorAll('.history-item--new').forEach((el) => el.classList.remove('history-item--new'));
  }, 1800);
}

// Event delegation for inside-card interactions: remove card, add set,
// remove set row, clear RPE.
if (previewStack) {
  previewStack.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    const cardEl = e.target.closest('.preview-card');
    if (!cardEl) return;

    if (action === 'remove-card') {
      cardEl.remove();
      const remaining = previewStack.querySelectorAll('.preview-card').length;
      previewCount.textContent = String(remaining);
      if (remaining === 0) discardPreview();
      return;
    }

    if (action === 'add-set') {
      const list = cardEl.querySelector('[data-card-sets]');
      if (!list) return;
      const i = list.querySelectorAll('.set-row').length;
      list.insertAdjacentHTML('beforeend', renderCardSetRowHTML({ reps: '', weight: '' }, i));
      return;
    }

    if (action === 'clear-rpe') {
      cardEl.dataset.rpe = '';
      const row = cardEl.querySelector('.rpe-row');
      if (row) row.remove();
      return;
    }

    if (e.target.closest('.set-row__remove')) {
      const row = e.target.closest('.set-row');
      const list = cardEl.querySelector('[data-card-sets]');
      if (row && list) {
        row.remove();
        if (list.querySelectorAll('.set-row').length === 0) {
          list.insertAdjacentHTML('beforeend', renderCardSetRowHTML({ reps: '', weight: '' }, 0));
        }
      }
    }
  });
}

if (previewSaveBtn)    previewSaveBtn.addEventListener('click', saveAllPreviewCards);
if (previewDiscardBtn) previewDiscardBtn.addEventListener('click', discardPreview);

// Wispr-block is always visible (textarea + Parse work without mic support).
// Only the device-mic fallback link is gated on SpeechRecognition availability.
function initVoice() {
  if (!SpeechRecognition) return;
  if (micBtn) micBtn.hidden = false;
}

if (rpeClearBtn) {
  rpeClearBtn.addEventListener('click', () => setRpe(null));
}

// ---------- Init ----------

populateExerciseSelects();
refreshForm();
renderManageCustom();
setView('log');
initVoice();
