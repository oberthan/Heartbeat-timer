// Static hosting + WebSocket sync for the heartbeat countdown.
// Env: PORT (set by Render).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { defaultSettings, cleanSettings } = require('./public/common.js');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
// Where settings and the uploaded track are stored. On a host with a persistent disk, point DATA_DIR at it
// (Render: mount a disk at /var/data and set DATA_DIR=/var/data). Otherwise it is the app folder (wiped on restart).
const DATA_DIR = process.env.DATA_DIR || __dirname;
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

let settings = defaultSettings();
let fresh = true; // true until settings were loaded from disk or set by a controller (so a controller can restore its backup)
try { settings = cleanSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))); fresh = false; } catch {}
let run = { running: false, startServerMs: 0 };
let hint = null; // { text, id } - shown on the displays; a new hint replaces the old one
const LOCKED = 'Locked while the countdown is running. Press Stop first.';

// uploaded track (the whole 30 min audio): streamed to disk while uploading, streamed back with Range support
const SAMPLE_FILE = path.join(DATA_DIR, 'sample.bin'), SAMPLE_META = path.join(DATA_DIR, 'sample.json');
let sample = null; // { type, name, version, size }
try {
  const meta = JSON.parse(fs.readFileSync(SAMPLE_META, 'utf8'));
  sample = { ...meta, size: fs.statSync(SAMPLE_FILE).size };
} catch {}
const sampleInfo = () => sample ? { name: sample.name, version: sample.version } : null;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.ico': 'image/x-icon' };

function handleUpload(req, res) {
  if (run.running) { res.writeHead(409); return res.end(LOCKED); }
  const type = String(req.headers['content-type'] || '');
  if (!type.startsWith('audio/')) { res.writeHead(415); return res.end('Upload an audio file'); }
  const name = decodeURIComponent(String(req.headers['x-filename'] || 'sound')).slice(0, 120);
  const tmp = SAMPLE_FILE + '.' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.part';
  const out = fs.createWriteStream(tmp);
  let failed = false;
  const fail = code => { if (failed) return; failed = true; out.destroy(); fs.unlink(tmp, () => {}); if (!res.writableEnded) { res.writeHead(code); res.end('Upload failed'); } };
  req.on('error', () => fail(400));
  req.on('aborted', () => fail(400));
  out.on('error', () => fail(500));
  out.on('finish', () => {
    if (failed) return;
    try {
      fs.renameSync(tmp, SAMPLE_FILE);
      sample = { type, name, version: Date.now(), size: fs.statSync(SAMPLE_FILE).size };
      fs.writeFileSync(SAMPLE_META, JSON.stringify({ type, name, version: sample.version }));
    } catch { return fail(500); }
    broadcast();
    res.writeHead(200); res.end('ok');
  });
  req.pipe(out);
}

function serveSample(req, res) {
  if (!sample) { res.writeHead(404); return res.end(); }
  const size = sample.size;
  const headers = { 'Content-Type': sample.type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] || m[2])) {
    let start = m[1] === '' ? Math.max(size - Number(m[2]), 0) : Number(m[1]);
    let end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': 'bytes */' + size }); return res.end(); }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(SAMPLE_FILE, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  fs.createReadStream(SAMPLE_FILE).pipe(res);
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/upload')) return handleUpload(req, res);
  if (req.method === 'POST' && req.url === '/sample-clear') {
    if (run.running) { res.writeHead(409); return res.end(LOCKED); }
    sample = null; try { fs.unlinkSync(SAMPLE_FILE); } catch {} try { fs.unlinkSync(SAMPLE_META); } catch {}
    broadcast(); res.writeHead(200); return res.end('ok');
  }
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  if (url === '/sample') {
    return serveSample(req, res);
  }
  if (url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  const file = path.normalize(path.join(PUBLIC, url));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });

function counts() {
  let displays = 0, armed = 0;
  const displayList = []; // what each display last reported (is it armed, is its sound ready...)
  for (const c of wss.clients) if (c.role === 'display') {
    displays++; if (c.armed) armed++;
    const st = c.status || {};
    displayList.push({ armed: !!c.armed, sound: st.sound || 'unknown', pct: st.pct || 0, ctx: st.ctx || '' });
  }
  return { displays, armed, displayList };
}
function stateMsg() { return JSON.stringify({ type: 'state', settings, run, sample: sampleInfo(), hint, fresh, ...counts(), serverNow: Date.now() }); }
function broadcast() { const m = stateMsg(); for (const c of wss.clients) if (c.readyState === 1) c.send(m); }

wss.on('connection', ws => {
  ws.role = 'viewer'; ws.armed = false; ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.send(stateMsg());
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    switch (msg.type) {
      case 'sync': // clock sync: client sends its t0, we answer with server time
        ws.send(JSON.stringify({ type: 'sync', t0: msg.t0, server: Date.now() }));
        break;
      case 'hello':
        ws.role = msg.role === 'display' ? 'display' : 'controller';
        broadcast();
        break;
      case 'status': { // a display reports whether its sound is ready / blocked
        const st = { sound: String(msg.sound || '').slice(0, 12), pct: Math.min(Math.max(Number(msg.pct) || 0, 0), 100), ctx: String(msg.ctx || '').slice(0, 12) };
        const same = ws.status && JSON.stringify(ws.status) === JSON.stringify(st) && ws.armed === !!msg.armed;
        ws.status = st; ws.armed = !!msg.armed;
        if (!same) broadcast();
        break;
      }
      case 'armed':
        ws.armed = !!msg.armed; broadcast();
        break;
      case 'set':
        if (run.running) return ws.send(JSON.stringify({ type: 'error', error: LOCKED }));
        settings = cleanSettings(msg.settings, settings);
        fresh = false;
        try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings)); } catch {}
        broadcast();
        break;
      case 'start': {
        if (run.running) return ws.send(JSON.stringify({ type: 'error', error: 'Already running. Press Stop first.' }));
        const delay = Math.min(Math.max(Number(msg.delaySec) || 0, 0), 600);
        run = { running: true, startServerMs: Date.now() + delay * 1000 };
        broadcast();
        break;
      }
      case 'hint': {
        const text = String(msg.text || '').trim().slice(0, 300);
        // how obvious: style 0 normal, 1 highlighted (flash, pulsing border, label), 2 full screen for holdSec seconds;
        // chimes = how many times the bell rings (0 = silent) at soundDb dB
        const style = [0, 1, 2].includes(Number(msg.style)) ? Number(msg.style) : 0;
        const holdSec = Math.min(Math.max(Number(msg.holdSec) || 10, 3), 60);
        const chimes = Math.min(Math.max(Math.round(Number(msg.chimes !== undefined ? msg.chimes : (msg.sound ? 1 : 0))) || 0, 0), 5);
        const soundDb = Math.min(Math.max(Number(msg.soundDb) || -8, -40), 0);
        hint = text ? { text, id: Date.now(), sound: chimes > 0, chimes, soundDb, style, holdSec } : null;
        broadcast();
        break;
      }
      case 'hint-clear':
        hint = null; broadcast();
        break;
      case 'stop':
        run = { running: false, startServerMs: 0 };
        broadcast();
        break;
    }
  });
  ws.on('close', broadcast);
});

// keep connections alive through Render's proxy and drop dead ones
setInterval(() => {
  for (const c of wss.clients) {
    if (!c.alive) { c.terminate(); continue; }
    c.alive = false; c.ping();
  }
}, 25000);

server.listen(PORT, () => console.log('Heartbeat countdown listening on ' + PORT));
