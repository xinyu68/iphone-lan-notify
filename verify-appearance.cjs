'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { NotificationWorkers } = require('./notification-workers.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const payload = { appName: '微信', title: '通知来源格式已更新', body: '底部圆点与空格已统一为通知中心的格式。', silent: true };
  if (process.argv.includes('--live')) {
    const { config } = require('./runtime-paths.cjs').loadConfig();
    const base = `http://${config.host}:${config.port}`;
    const response = await fetch(`${base}/notify/${config.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json();
    assert(response.ok && result.ok);
    let item;
    for (let attempt = 0; attempt < 80; attempt++) {
      const status = await (await fetch(`${base}/status/${config.token}`)).json();
      item = status.history.find(entry => entry.id === result.id);
      if (item?.status === 'shown' || item?.status === 'failed') break;
      await delay(100);
    }
    assert.equal(item.appName, payload.appName);
    assert.equal(item.title, payload.title);
    assert.equal(item.body, payload.body);
    assert.equal(item.presentation, 'app-icon');
    assert.equal(item.status, 'shown');
    assert.equal(item.nativePopupSuppressed, true);
    const snapshot = await (await fetch(`${base}/popup-check/${config.token}`)).json();
    const window = snapshot.windows.find(entry => entry.id === result.id);
    assert(window, 'Actual popup is visible');
    assert.equal(window.cardWidth, 404);
    assert.equal(window.cardHeight, 88);
    assert.equal(window.attribution, '微信 • 来自 iPhone');
    assert.equal(snapshot.workArea.right - window.cardRight, 8);
    assert.equal(snapshot.workArea.bottom - window.cardBottom, 8);
    const report = { result: 'PASS', actualService: true, chineseTextPreserved: true, cardSize: [404, 88], attribution: window.attribution, rightGap: 8, bottomGap: 8, presentation: item.presentation, nativePopupSuppressed: item.nativePopupSuppressed, testId: result.id };
    fs.writeFileSync(path.join(__dirname, '.verification', 'footer-appearance-live.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    return;
  }
  const fixture = fs.mkdtempSync(path.join(__dirname, '.verification', 'appearance-'));
  const candidate = path.join(__dirname, fs.existsSync(path.join(__dirname, 'NotificationPopup.next.exe')) ? 'NotificationPopup.next.exe' : 'NotificationPopup.exe');
  fs.copyFileSync(candidate, path.join(fixture, 'NotificationPopup.exe'));
  fs.copyFileSync(path.join(__dirname, 'toast-worker.ps1'), path.join(fixture, 'toast-worker.ps1'));
  fs.cpSync(path.join(__dirname, 'assets', 'app-icons'), path.join(fixture, 'assets', 'app-icons'), { recursive: true });
  if (fs.existsSync(path.join(__dirname, '.icon-cache'))) fs.cpSync(path.join(__dirname, '.icon-cache'), path.join(fixture, '.icon-cache'), { recursive: true });
  let state = 'starting';
  const worker = new NotificationWorkers({ root: fixture, diagnostics: true, onState: value => { state = value; }, log: () => {} });
  try {
    worker.start();
    for (let attempt = 0; attempt < 120 && state !== 'ready'; attempt++) await delay(100);
    assert.equal(state, 'ready');
    const id = crypto.randomBytes(8).toString('hex');
    await worker.notify({ id, ...payload, notifierAppId: 'Xinyu.IPhoneLanNotify' });
    const snapshot = await worker.call({ op: 'inspect' }, 'popup');
    assert.equal(snapshot.activeCount, 1);
    assert.equal(snapshot.workArea.right - snapshot.windows[0].cardRight, 8);
    assert.equal(snapshot.workArea.bottom - snapshot.windows[0].cardBottom, 8);
    assert.equal(snapshot.windows[0].cardWidth, 404);
    assert.equal(snapshot.windows[0].cardHeight, 88);
    assert.equal(snapshot.windows[0].attribution, '微信 • 来自 iPhone');
    const image = path.join(fixture, '.verification', `popup-${id}.png`);
    for (let attempt = 0; attempt < 50 && !fs.existsSync(image); attempt++) await delay(100);
    assert(fs.existsSync(image));
    fs.copyFileSync(image, path.join(__dirname, '.verification', 'compact-height-notification.png'));
    await worker.notify({ id: crypto.randomBytes(8).toString('hex'), ...payload, notifierAppId: 'Xinyu.IPhoneLanNotify' });
    const stack = await worker.call({ op: 'inspect' }, 'popup');
    assert.equal(stack.activeCount, 2);
    const positions = stack.windows.toSorted((a, b) => a.cardTop - b.cardTop);
    assert.equal(positions[1].cardTop - positions[0].cardBottom, 8);
    const report = { result: 'PASS', stagedPopupReady: true, cardSize: [404, 88], attribution: snapshot.windows[0].attribution, rightGap: 8, bottomGap: 8, stackGap: 8, renderedImage: 'compact-height-notification.png', liveReceiverModified: false };
    fs.writeFileSync(path.join(__dirname, '.verification', 'footer-staging.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { worker.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
