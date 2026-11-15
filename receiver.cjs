const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normaliseNotification } = require('./notification-format.cjs');
const { NotificationWorkers } = require('./notification-workers.cjs');
const notificationHistory = require('./notification-history.cjs');

const root = __dirname;
const { config, dataRoot } = require('./runtime-paths.cjs').loadConfig(root);
const origin = `http://${config.host}:${config.port}`;
const notifyUrl = `${origin}/notify/${config.token}`;
const startedAt = new Date().toISOString();
const state = { received: 0, shown: 0, failed: 0, lastReceivedAt: null, lastClient: null, worker: 'starting', presentation: 'app-icon' };
const history = notificationHistory.load(dataRoot).map(item => item.status === 'sending' ? { ...item, status: 'failed' } : item);
let stopping = false;
let worker;
let listenRetryTimer;
let networkWaitLogged = false;

function log(event, extra = {}) {
  fs.appendFileSync(path.join(dataRoot, 'receiver.log'), JSON.stringify({ at: new Date().toISOString(), event, ...extra }) + '\n');
}

function writeRuntime() {
  fs.writeFileSync(path.join(dataRoot, 'runtime.json'), JSON.stringify({
    pid: process.pid, startedAt, desktopApp: path.join(root, 'PhoneNotify.exe'), notifyUrl, ...state,
  }, null, 2));
}

function publish() {
  writeRuntime();
}

function saveHistory() {
  const cutoff = Date.now() - 7 * 86400000;
  for (let index = history.length - 1; index >= 0; index--) if (Date.parse(history[index].at) < cutoff) history.splice(index, 1);
  try { notificationHistory.save(dataRoot, history); }
  catch (error) { log('history-save-failed', { code: error.code || 'unknown' }); }
}

function startWorker() {
  worker = new NotificationWorkers({
    dataRoot,
    root, log, diagnostics: config.popupDiagnostics === true,
    onState(value) { state.worker = value; publish(); },
  });
  worker.start();
}

function workerCall(message, channel = 'center') {
  if (!worker) return Promise.reject(new Error('Notification display worker is not ready'));
  return worker.call(message, channel);
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function validToken(value) {
  const candidate = Buffer.from(value || '');
  const expected = Buffer.from(config.token);
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > 32768) { const error = new Error('Body too large'); error.status = 413; reject(error); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        if (/application\/json/i.test(request.headers['content-type'] || '')) resolve(JSON.parse(body));
        else resolve({ message: body });
      } catch { const error = new Error('Invalid JSON'); error.status = 400; reject(error); }
    });
    request.on('aborted', () => reject(new Error('Request aborted')));
    request.on('error', reject);
  });
}

function normalise(input) {
  return normaliseNotification(input, config.appNames);
}

async function receive(input, client, isTest) {
  if (stopping || !worker?.ready) throw new Error('Notification display worker is not ready');
  const notification = normalise(input);
  const id = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
  const item = { id, ...notification, at: new Date().toISOString(), client, isTest, status: 'sending' };
  state.received++;
  state.lastReceivedAt = item.at;
  state.lastClient = client;
  history.unshift(item);
  history.length = Math.min(history.length, notificationHistory.MAX_ITEMS);
  saveHistory();
  publish();
  const deliver = async () => { try {
    const delivery = await worker.notify({ id, ...notification, at: item.at, silent: Boolean(input.silent) });
    item.presentation = delivery.presentation;
    item.iconSource = delivery.iconSource;
    item.iconCacheHit = delivery.iconCacheHit;
    item.iconBuiltin = delivery.iconBuiltin;
    item.nativePopupSuppressed = delivery.nativePopupSuppressed;
    item.status = 'shown';
    state.shown++;
    log('notification', { id, client, isTest, chars: notification.body.length, ok: true });
  } catch (error) {
    item.status = 'failed';
    state.failed++;
    log('notification', { id, client, isTest, ok: false, error: error.message });
    saveHistory();
    publish();
    return;
  }
  saveHistory();
  publish();
  };
  // Acknowledge receipt promptly; desktop icon lookup must not consume the phone's timeout.
  void deliver().catch(error => { log('delivery-error', { id, error: error.message }); });
  return { ok: true, id, accepted: true };
}

const server = http.createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const url = new URL(request.url, origin);
    const parts = url.pathname.split('/').filter(Boolean);
    if (request.headers.origin && request.headers.origin !== origin) return json(response, 403, { ok: false, error: 'Origin not allowed' });
    if (url.pathname === '/health' && request.method === 'GET') return json(response, 200, { ok: true, app: 'iphone-lan-notify', worker: state.worker });
    if (parts.length !== 2 || !validToken(parts[1])) return json(response, 404, { ok: false, error: 'Use your personal setup link' });
    if (['setup', 'events'].includes(parts[0]) && request.method === 'GET')
      return json(response, 410, { ok: false, error: '网页设置入口已停用，请在电脑上打开「手机通知」桌面程序' });
    if (parts[0] === 'status' && request.method === 'GET') {
      if (history.some(item => Date.parse(item.at) < Date.now() - 7 * 86400000)) saveHistory();
      return json(response, 200, { ok: true, ...state, history, notifyUrl, startedAt });
    }
    if (parts[0] === 'test' && request.method === 'POST') {
      return json(response, 200, await receive({ title: 'iPhone 通知同步已连接', message: '这是一条测试通知。手机与电脑之间的通知通道正常。' }, request.socket.remoteAddress, true));
    }
    if (parts[0] === 'notify' && request.method === 'POST') return json(response, 200, await receive(await readBody(request), request.socket.remoteAddress, false));
    if (parts[0] === 'history-check' && request.method === 'GET') return json(response, 200, await workerCall({ op: 'history' }));
    if (parts[0] === 'popup-check' && request.method === 'GET') return json(response, 200, await workerCall({ op: 'inspect' }, 'popup'));
    if (parts[0] === 'stop' && request.method === 'POST') {
      json(response, 200, { ok: true, stopping: true });
      setTimeout(() => shutdown(), 100);
      return;
    }
    return json(response, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    if (!response.headersSent && !response.destroyed) json(response, error.status || 503, { ok: false, error: error.message });
  }
});

server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.on('error', async error => {
  if (stopping) return;
  if (error.code === 'EADDRNOTAVAIL') {
    if (!networkWaitLogged) {
      log('waiting-for-network', { host: config.host });
      networkWaitLogged = true;
    }
    listenRetryTimer = setTimeout(() => server.listen(config.port, config.host), 5000);
    return;
  }
  if (error.code === 'EADDRINUSE') {
    try {
      const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2000) });
      const running = await response.json();
      if (response.ok && running.ok === true && running.app === 'iphone-lan-notify') {
        log('already-running', { host: config.host, port: config.port });
        shutdown();
        return;
      }
    } catch (_) {}
  }
  log('server-error', { error: error.message });
  shutdown(1);
});
server.on('listening', () => {
  startWorker();
  writeRuntime();
  log('started', { host: config.host, port: config.port });
  console.log(`iPhone notification receiver: ${origin}`);
});
server.listen(config.port, config.host);

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(listenRetryTimer);
  if (worker) worker.stop();
  server.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 2000).unref();
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
process.on('uncaughtException', error => { log('uncaught-error', { error: error.message }); shutdown(1); });
