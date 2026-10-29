// Shared by the server, the controller and the display.
// Parameter ids/ranges match EscapeRoom_Heartbeat.jsfx.
const DEFS = [
  ['Timing', null],
  ['dur',    'Duration (minutes)',               30, 1, 120, 0.5],
  ['bpm0',   'Start BPM',                        55, 20, 250, 1],
  ['bpm1',   'End BPM',                         170, 20, 300, 1],
  ['bpmC',   'BPM curve (>1 = speeds up late)', 1.5, 0.2, 4, 0.05],
  ['offs',   'Start offset (seconds)',            0, 0, 3600, 1],
  ['endMode','After time runs out (0 hold, 1 no new beats)', 1, 0, 1, 1],
  ['Volume', null],
  ['db0',    'Start volume (dB)',               -30, -90, 6, 0.5],
  ['db1',    'End volume (dB)',                   0, -90, 6, 0.5],
  ['dbC',    'Volume curve (>1 = swells late)', 1.5, 0.2, 4, 0.05],
  ['trim',   'Output trim (dB)',                  0, -24, 24, 0.5],
  ['Sound', null],
  ['pitch',  'Thump pitch (Hz)',                 48, 25, 120, 1],
  ['drop',   'Pitch drop (Hz)',                 110, 0, 400, 1],
  ['decay',  'Lub decay (s)',                  0.12, 0.03, 0.5, 0.01],
  ['dub',    'Dub level',                       0.8, 0, 1.5, 0.01],
  ['gap',    'Lub-dub gap (ms)',                130, 40, 400, 1],
  ['body',   'Body (2nd harmonic)',            0.25, 0, 1, 0.01],
  ['Reverb', null],
  ['rev',    'Reverb amount',                  0.35, 0, 1.5, 0.01],
  ['revLen', 'Reverb length (s)',                 3, 0.2, 12, 0.1],
  ['revDamp','Reverb damping',                  0.4, 0, 0.95, 0.01],
  ['Video', null],
  ['pulse',  'Visual pulse strength',             1, 0, 2, 0.05],
  ['minGrey','Number grey (resting)',            90, 20, 200, 1],
  ['maxGrey','Number grey (at heartbeat)',      190, 40, 255, 1],
  ['tsize',  'Text size (fraction of height)',  0.4, 0.1, 0.9, 0.01],
  ['Testing', null],
  ['startAt','Start at (minutes into the timeline)', 0, 0, 120, 0.5],
];

const PARAMS = DEFS.filter(d => d[1] !== null);

function defaultSettings() {
  const s = {};
  for (const [id, , def] of PARAMS) s[id] = def;
  return s;
}

// Keep only known ids, force numbers, clamp to range.
function cleanSettings(input, base) {
  const out = Object.assign({}, base || defaultSettings());
  if (!input || typeof input !== 'object') return out;
  for (const [id, , , min, max] of PARAMS) {
    const v = Number(input[id]);
    if (input[id] !== undefined && isFinite(v)) out[id] = Math.min(Math.max(v, min), max);
  }
  return out;
}

// Timeline maths, closed form (same BPM curve as the plugin).
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const bpmAt = (P, t) => P.bpm0 + (P.bpm1 - P.bpm0) * Math.pow(clamp(t / (P.dur * 60), 0, 1), P.bpmC);
const dbAt  = (P, t) => P.db0 + (P.db1 - P.db0) * Math.pow(clamp(t / (P.dur * 60), 0, 1), P.dbC) + P.trim;
function beatsAt(P, t) { // beats elapsed at time t
  const d = P.dur * 60, u = Math.min(Math.max(t, 0), d);
  let B = (P.bpm0 * u + (P.bpm1 - P.bpm0) * d / (P.bpmC + 1) * Math.pow(u / d, P.bpmC + 1)) / 60;
  if (t > d) B += P.bpm1 * (t - d) / 60;
  return B;
}
function beatTime(P, k) { // time of beat number k (inverse of beatsAt)
  let lo = 0, hi = 1;
  while (beatsAt(P, hi) < k) hi *= 2;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; beatsAt(P, m) < k ? lo = m : hi = m; }
  return hi;
}
function fmtTime(s) {
  s = Math.ceil(s - 1e-6);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

if (typeof module !== 'undefined') module.exports = { DEFS, PARAMS, defaultSettings, cleanSettings };
