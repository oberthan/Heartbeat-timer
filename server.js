// Static hosting + WebSocket sync for the heartbeat countdown.
// Env: PORT (set by Render), CONTROL_PASSWORD (required to change settings / start / stop).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { defaultSettings, cleanSettings } = require('./public/common.js');

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.CONTROL_PASSWORD || '';
const PUBLIC = path.join(__dirname, 'public');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

if (!PASSWORD) console.warn('WARNING: CONTROL_PASSWORD is not set - anyone with the URL can start/stop the countdown.');

let settings = defaultSettings();
try { settings = cleanSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))); } catch {}
let run = { running: false, startServerMs: 0 };

// uploaded heartbeat sound (kept in memory, and on disk so it survives a restart where the disk persists)
const SAMPLE_FILE = path.join(__dirname, 'sample.bin'), SAMPLE_META = path.join(__dirname, 'sample.json');
const MAX_SAMPLE = 12 * 1024 * 1024;
let sample = null; // { buf, type, name, version }
try { const meta = JSON.parse(fs.readFileSync(SAMPLE_META, 'utf8')); sample = { buf: fs.readFileSync(SAMPLE_FILE), ...meta }; } catch {}
const sampleInfo = () => sample ? { name: sample.name, version: sample.version } : null;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.ico': 'image/x-icon' };

function handleUpload(req, res) {
  if (PASSWORD && req.headers['x-password'] !== PASSWORD) { res.writeHead(401); return res.end('Wrong password'); }
  const type = String(req.headers['content-type'] || '');
  if (!type.startsWith('audio/')) { res.writeHead(415); return res.end('Upload an audio file'); }
  if (Number(req.headers['content-length']) > MAX_SAMPLE) { res.writeHead(413, { Connection: 'close' }); return res.end('File too large (max 12 MB)'); }
  const chunks = []; let size = 0, tooBig = false;
  req.on('data', c => { size += c.length; if (size > MAX_SAMPLE) tooBig = true; else chunks.push(c); });
  req.on('end', () => {
    if (tooBig) { res.writeHead(413); return res.end('File too large (max 12 MB)'); }
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
    if (PASSWORD && req.headers['x-password'] !== PASSWORD) { res.writeHead(401); return res.end('Wrong password'); }
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
function stateMsg() { return JSON.stringify({ type: 'state', settings, run, sample: sampleInfo(), ...counts(), serverNow: Date.now() }); }
function broadcast() { const m = stateMsg(); for (const c of wss.clients) if (c.readyState === 1) c.send(m); }
function authed(msg) { return !PASSWORD || msg.password === PASSWORD; }

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
        if (!authed(msg)) return ws.send(JSON.stringify({ type: 'error', error: 'Wrong password' }));
        settings = cleanSettings(msg.settings, settings);
        try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings)); } catch {}
        broadcast();
        break;
      case 'start': {
        if (!authed(msg)) return ws.send(JSON.stringify({ type: 'error', error: 'Wrong password' }));
        const delay = Math.min(Math.max(Number(msg.delaySec) || 0, 0), 600);
        run = { running: true, startServerMs: Date.now() + delay * 1000 };
        broadcast();
        break;
      }
      case 'stop':
        if (!authed(msg)) return ws.send(JSON.stringify({ type: 'error', error: 'Wrong password' }));
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
