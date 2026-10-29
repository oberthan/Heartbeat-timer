// Static hosting + WebSocket sync for the heartbeat countdown.
// Env: PORT (set by Render).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { defaultSettings, cleanSettings } = require('./public/common.js');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

let settings = defaultSettings();
try { settings = cleanSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))); } catch {}
let run = { running: false, startServerMs: 0 };
let hint = null; // { text, id } - shown on the displays; a new hint replaces the old one
const LOCKED = 'Locked while the countdown is running. Press Stop first.';

// uploaded heartbeat sound (kept in memory, and on disk so it survives a restart where the disk persists)
const SAMPLE_FILE = path.join(__dirname, 'sample.bin'), SAMPLE_META = path.join(__dirname, 'sample.json');
let sample = null; // { buf, type, name, version }
try { const meta = JSON.parse(fs.readFileSync(SAMPLE_META, 'utf8')); sample = { buf: fs.readFileSync(SAMPLE_FILE), ...meta }; } catch {}
const sampleInfo = () => sample ? { name: sample.name, version: sample.version } : null;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.ico': 'image/x-icon' };

function handleUpload(req, res) {
  if (run.running) { res.writeHead(409); return res.end(LOCKED); }
  const type = String(req.headers['content-type'] || '');
  if (!type.startsWith('audio/')) { res.writeHead(415); return res.end('Upload an audio file'); }
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const name = String(req.headers['x-filename'] || 'sound').slice(0, 120);
    sample = { buf: Buffer.concat(chunks), type, name, version: Date.now() };
    try { fs.writeFileSync(SAMPLE_FILE, sample.buf); fs.writeFileSync(SAMPLE_META, JSON.stringify({ type, name, version: sample.version })); } catch {}
    broadcast();
    res.writeHead(200); res.end('ok');
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/upload')) return handleUpload(req, res);
  if (req.method === 'POST' && req.url === '/sample-clear') {
    if (run.running) { res.writeHead(409); return res.end(LOCKED); }
    sample = null; try { fs.unlinkSync(SAMPLE_FILE); fs.unlinkSync(SAMPLE_META); } catch {}
    broadcast(); res.writeHead(200); return res.end('ok');
  }
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  if (url === '/sample') {
    if (!sample) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': sample.type, 'Cache-Control': 'no-cache' });
    return res.end(sample.buf);
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
  for (const c of wss.clients) if (c.role === 'display') { displays++; if (c.armed) armed++; }
  return { displays, armed };
}
function stateMsg() { return JSON.stringify({ type: 'state', settings, run, sample: sampleInfo(), hint, ...counts(), serverNow: Date.now() }); }
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
      case 'armed':
        ws.armed = !!msg.armed; broadcast();
        break;
      case 'set':
        if (run.running) return ws.send(JSON.stringify({ type: 'error', error: LOCKED }));
        settings = cleanSettings(msg.settings, settings);
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
        hint = text ? { text, id: Date.now() } : null;
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
