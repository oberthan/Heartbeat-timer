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

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
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
function stateMsg() { return JSON.stringify({ type: 'state', settings, run, ...counts(), serverNow: Date.now() }); }
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
