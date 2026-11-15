const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(check, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(150);
  }
  throw new Error('Startup verification timed out');
}

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function launch(fixture, preload) {
  const args = preload ? ['--require', preload, 'receiver.cjs'] : ['receiver.cjs'];
  const child = spawn(process.execPath, args, { cwd: fixture, windowsHide: true, stdio: 'ignore' });
  child.completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  return child;
}

(async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'iphone-notify-startup-'));
  const config = { host: '127.0.0.1', port: await freePort(), token: 'startup-test-token-not-a-secret-123456789', nodePath: process.execPath };
  const origin = `http://${config.host}:${config.port}`;
  let receiver;
  let duplicate;
  try {
    for (const filename of ['receiver.cjs', 'runtime-paths.cjs', 'notification-format.cjs', 'notification-history.cjs', 'notification-workers.cjs', 'app-icon-cache.cjs', 'app-icon-catalog.cjs', 'app-icon-catalog.json', 'NotificationPopup.exe', 'toast-worker.ps1']) {
      const candidate = filename === 'NotificationPopup.exe' && fs.existsSync(path.join(__dirname, 'NotificationPopup.next.exe')) ? 'NotificationPopup.next.exe' : filename;
      fs.copyFileSync(path.join(__dirname, candidate), path.join(fixture, filename));
    }
    fs.writeFileSync(path.join(fixture, 'config.json'), JSON.stringify(config));
    const preload = path.join(fixture, 'network-delay.cjs');
    fs.writeFileSync(preload, `
const http = require('node:http');
const createServer = http.createServer;
http.createServer = function (...args) {
  const server = createServer.apply(this, args);
  const listen = server.listen;
  let unavailable = true;
  server.listen = function (...listenArgs) {
    if (unavailable) {
      unavailable = false;
      queueMicrotask(() => server.emit('error', Object.assign(new Error('Simulated startup network delay'), { code: 'EADDRNOTAVAIL' })));
      return server;
    }
    return listen.apply(this, listenArgs);
  };
  return server;
};
`);
    receiver = launch(fixture, preload);
    const logPath = path.join(fixture, 'receiver.log');
    await until(() => fs.existsSync(logPath) && fs.readFileSync(logPath, 'utf8').includes('waiting-for-network'), 4000);
    assert.equal(receiver.exitCode, null, 'Receiver must wait for the network instead of exiting');
    await until(async () => {
      assert.equal(receiver.exitCode, null, 'Receiver exited before it became ready');
      try {
        const health = await (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) })).json();
        return health.ok === true && health.worker === 'ready';
      } catch (_) { return false; }
    });
    const runtimePath = path.join(fixture, 'runtime.json');
    assert.equal(JSON.parse(fs.readFileSync(runtimePath, 'utf8')).pid, receiver.pid);
    duplicate = launch(fixture);
    await until(() => duplicate.exitCode !== null, 8000);
    assert.equal((await duplicate.completion).code, 0, 'Duplicate launch must exit successfully');
    assert.equal(receiver.exitCode, null, 'Duplicate launch must preserve the original receiver');
    assert.equal(JSON.parse(fs.readFileSync(runtimePath, 'utf8')).pid, receiver.pid);
    const log = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(log.filter(item => item.event === 'waiting-for-network').length, 1);
    assert.equal(log.filter(item => item.event === 'notification-worker-ready' && item.channel === 'center').length, 1);
    assert.equal(log.filter(item => item.event === 'notification-worker-ready' && item.channel === 'popup').length, 1);
    assert.equal(log.filter(item => item.event === 'already-running').length, 1);
    console.log('PASS: delayed network startup recovers, both display workers become ready, duplicate launch preserves the active receiver');
  } finally {
    if (duplicate && duplicate.exitCode === null) duplicate.kill();
    if (receiver && receiver.exitCode === null) {
      try { await fetch(`${origin}/stop/${config.token}`, { method: 'POST', signal: AbortSignal.timeout(1500) }); } catch (_) {}
      try { await until(() => receiver.exitCode !== null, 4000); } catch (_) { receiver.kill(); }
      await receiver.completion;
    }
    const resolved = fs.realpathSync(fixture);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert(path.basename(resolved).startsWith('iphone-notify-startup-'));
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
