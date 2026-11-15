'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(action, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { const value = await action(); if (value) return value; } catch (error) { lastError = error; }
    await delay(150);
  }
  throw new Error(`${label} timed out${lastError ? ': ' + lastError.message : ''}`);
}
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function processExists(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

(async () => {
  const verification = path.join(__dirname, '.verification');
  fs.mkdirSync(verification, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(verification, 'plain-text-fixture-'));
  for (const filename of ['receiver.cjs', 'runtime-paths.cjs', 'notification-format.cjs', 'notification-history.cjs', 'notification-workers.cjs', 'app-icon-cache.cjs', 'app-icon-catalog.cjs', 'app-icon-catalog.json', 'toast-worker.ps1'])
    fs.copyFileSync(path.join(__dirname, filename), path.join(fixture, filename));
  const popupCandidate = fs.existsSync(path.join(__dirname, 'NotificationPopup.next.exe')) ? 'NotificationPopup.next.exe' : 'NotificationPopup.exe';
  fs.copyFileSync(path.join(__dirname, popupCandidate), path.join(fixture, 'NotificationPopup.exe'));
  const iconFixture = fs.readFileSync(path.join(__dirname, require('./app-icon-catalog.cjs').bundledApps.find(app => app.storeId === 414478124).file)).toString('base64');
  const preload = path.join(fixture, 'icon-fetch-fixture.cjs');
  fs.writeFileSync(preload, `
const originalFetch = global.fetch;
global.fetch = async (raw, options) => {
  const url = new URL(raw);
  if (url.hostname === 'itunes.apple.com') {
    await new Promise(resolve => setTimeout(resolve, 300));
    const results = url.searchParams.get('term') === '微信' || url.searchParams.get('id') === '414478124' ? [{trackId:414478124,trackName:'微信',artistName:'WeChat',bundleId:'com.tencent.xin',artworkUrl100:'https://fixture.mzstatic.com/wechat.jpg'}] : [];
    return new Response(JSON.stringify({resultCount:results.length,results}),{headers:{'Content-Type':'application/json'}});
  }
  if (url.hostname === 'fixture.mzstatic.com') return new Response(Buffer.from('${iconFixture}','base64'),{headers:{'Content-Type':'image/jpeg'}});
  return originalFetch(raw,options);
};
`, 'utf8');
  const config = { host: '127.0.0.1', port: await freePort(), token: crypto.randomBytes(24).toString('base64url'), nodePath: process.execPath, popupDiagnostics: true };
  fs.writeFileSync(path.join(fixture, 'config.json'), JSON.stringify(config));
  const origin = `http://${config.host}:${config.port}`;
  const child = spawn(process.execPath, ['--require', preload, path.join(fixture, 'receiver.cjs')], { cwd: fixture, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let processError = '';
  child.stderr.on('data', chunk => { processError = (processError + chunk.toString()).slice(-2000); });
  child.stdout.resume();
  const exited = new Promise(resolve => child.once('exit', resolve));
  const checks = [];
  const acceptedTimes = [];
  const request = async (endpoint, payload) => {
    const url = endpoint === 'health' ? `${origin}/health` : `${origin}/${endpoint}/${config.token}`;
    const started = Date.now();
    const response = await fetch(url, { method: payload === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(5000) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
    if (endpoint === 'notify' && payload !== undefined) {
      assert.equal(result.accepted, true);
      acceptedTimes.push(Date.now() - started);
      await waitFor(async () => {
        const status = await (await fetch(`${origin}/status/${config.token}`)).json();
        const item = status.history.find(entry => entry.id === result.id);
        if (item?.status === 'failed') throw Error('Fixture notification failed');
        return item?.status === 'shown';
      }, 'accepted notification delivered');
    }
    return result;
  };
  let popupPid;
  let firstId;
  let queueResult;
  try {
    await waitFor(async () => (await request('health')).worker === 'ready', 'two workers ready');
    checks.push('native-history and popup workers ready');
    const first = await request('notify', { appId: '微信', title: '林一', body: '图标通知已经接入，文字和卡片尺寸保持不变。', silent: true });
    firstId = first.id;
    const snapshot = await request('popup-check');
    assert.equal(snapshot.presentation, 'app-icon');
    assert.equal(snapshot.activeCount, 1);
    assert.equal(snapshot.iconCount, 1);
    const window = snapshot.windows[0];
    assert.equal(window.showActivated, false);
    assert.equal(window.topmost, true);
    assert.equal(window.attribution, '微信 • 来自 iPhone');
    assert.equal(window.cardWidth, 404);
    assert.equal(window.cardHeight, 88);
    assert.equal(window.iconSource, 'appstore');
    assert.equal(window.iconWidth, 36);
    assert.equal(window.iconMask, 'continuous-superellipse');
    assert.equal(snapshot.workArea.right - window.cardRight, 8);
    assert.equal(snapshot.workArea.bottom - window.cardBottom, 8);
    checks.push('real WPF app icon with continuous mask; merged app footer, 404x88 card and 8px gaps');
    popupPid = snapshot.processId;
    const image = path.join(fixture, '.verification', `popup-${first.id}.png`);
    await waitFor(() => fs.existsSync(image), 'own-window rendered image');
    fs.copyFileSync(image, path.join(verification, 'app-icon-notification.png'));
    const status = await request('status');
    const item = status.history.find(entry => entry.id === first.id);
    assert.equal(item.presentation, 'app-icon');
    assert.equal(item.nativePopupSuppressed, true);
    assert((await request('history-check')).tags.includes(first.id));
    checks.push('same request saved in Windows history with native popup suppressed');

    const extras = [];
    for (let index = 0; index < 3; index++) extras.push(await request('notify', {
      appName: index === 0 ? '没有预置图标的新应用' : '微信',
      title: `连续消息 ${index + 1}`,
      body: index === 0 ? '未知软件直接显示完整名称；<script> 与 emoji 📱 都按文字处理。' : '连续通知分开放置，不会叠在同一个位置。', silent: true,
    }));
    const burst = await request('popup-check');
    assert.equal(burst.activeCount, 3);
    assert.equal(burst.queuedCount, 1);
    assert(burst.windows.some(entry => entry.iconSource === 'phone-notify'));
    const bounds = burst.windows.map(entry => [entry.cardTop, entry.cardBottom]).sort((a, b) => a[0] - b[0]);
    for (let index = 1; index < bounds.length; index++) assert(bounds[index][0] - bounds[index - 1][1] >= 8);
    queueResult = { active: burst.activeCount, queued: burst.queuedCount };
    checks.push('burst of four messages: three separated cards and one queued');
    const afterBurst = await request('status');
    assert(afterBurst.history.some(entry => entry.appName === '没有预置图标的新应用'));
    const diagnosticFiles = ['runtime.json', 'receiver.log'].map(file => fs.readFileSync(path.join(fixture, file), 'utf8')).join('\n');
    assert(!diagnosticFiles.includes('图标通知已经接入'));
    assert(!diagnosticFiles.includes('<script>'));
    checks.push('unknown app uses embedded Phone Notify icon; runtime and logs contain no notification body');

    await delay(11500);
    const drained = await request('popup-check');
    assert.equal(drained.queuedCount, 0);
    assert(drained.activeCount === 0 || drained.windows.every(entry => entry.paused));
    checks.push('queue advanced; cards auto-dismissed or explicitly paused by current user pointer/focus');

    const oldPid = popupPid;
    process.kill(oldPid);
    await waitFor(async () => {
      if ((await request('health')).worker !== 'ready') return false;
      const next = await request('popup-check');
      if (next.processId === oldPid) return false;
      popupPid = next.processId;
      return true;
    }, 'display worker recovery');
    checks.push('isolated popup crash automatically restarts both workers');
    await request('stop', {});
    await Promise.race([exited, delay(5000).then(() => { throw new Error('Fixture receiver did not stop'); })]);
    await waitFor(() => !processExists(popupPid), 'owned popup exits with receiver', 5000);
    checks.push('receiver stop releases popup worker and windows');
    const report = { result: 'PASS', checks, fixture, firstId, queueResult, acceptedTimes, externalAppStoreRequests: 0, liveReceiverModified: false, screenshotMethod: 'Own WPF RenderTargetBitmap; diagnostic fixture only', userHoverAndManualCloseNotAutomated: true };
    fs.writeFileSync(path.join(verification, 'app-icon-integration.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (child.exitCode === null) {
      try { await request('stop', {}); } catch { child.kill(); }
      await Promise.race([exited, delay(2500)]);
    }
    if (processError) console.error(processError);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
