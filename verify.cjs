const assert = require('node:assert/strict');
const fs = require('node:fs');
const { config, dataRoot } = require('./runtime-paths.cjs').loadConfig();
const base = `http://${config.host}:${config.port}`;

async function check(path, init, expected) {
  const response = await fetch(base + path, init);
  assert.equal(response.status, expected, path);
  return response;
}

(async () => {
  assert.equal((await (await check('/health', {}, 200)).json()).worker, 'ready');
  await check('/setup/wrong-token', {}, 404);
  await check(`/setup/${config.token}`, {}, 410);
  await check(`/events/${config.token}`, {}, 410);
  await check('/app.js', {}, 404);
  await check(`/notify/${config.token}`, { method: 'POST', headers: { Origin: 'http://example.invalid' }, body: '{}' }, 403);
  await check(`/notify/${config.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' }, 400);
  await check(`/notify/${config.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"message":""}' }, 400);
  await check(`/notify/${config.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"message":{"unexpected":"object"}}' }, 400);
  await check(`/notify/${config.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'x'.repeat(40000) }) }, 413);
  const title = '通知通道验证 📱 <>&';
  const body = '中文、emoji、换行\n与 <script> 标签均作为通知文字处理';
  const response = await check(`/notify/${config.token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, appId: 'com.tencent.xin', silent: true }),
  }, 200);
  const result = await response.json();
  let notification;
  for (let attempt = 0; attempt < 80; attempt++) {
    const status = await (await check(`/status/${config.token}`, {}, 200)).json();
    notification = status.history.find(item => item.id === result.id);
    if (notification?.status === 'shown' || notification?.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(notification.title, title);
  assert.equal(notification.body, body);
  assert.equal(notification.status, 'shown');
  assert.equal(notification.appName, '微信');
  assert.equal(notification.presentation, 'app-icon');
  assert.equal(notification.nativePopupSuppressed, true);
  const popup = await (await check(`/popup-check/${config.token}`, {}, 200)).json();
  assert.equal(popup.presentation, 'app-icon');
  const windowsHistory = await (await check(`/history-check/${config.token}`, {}, 200)).json();
  assert(windowsHistory.tags.includes(result.id), 'Notification was not found in Windows notification history');
  assert.equal(windowsHistory.details.find(item => item.id === result.id).hasAppIcon, false, 'System history must not repeat the large app icon');
  const runtimeText = fs.readFileSync(require('node:path').join(dataRoot, 'runtime.json'), 'utf8');
  const logText = fs.readFileSync(require('node:path').join(dataRoot, 'receiver.log'), 'utf8');
  assert(!runtimeText.includes(title) && !logText.includes(title), 'Notification text unexpectedly written to diagnostic files');
  console.log('PASS: request validation, Unicode text, icon custom popup, suppressed native banner, Windows history, metadata-only logging');
})().catch(error => { console.error(error); process.exitCode = 1; });
