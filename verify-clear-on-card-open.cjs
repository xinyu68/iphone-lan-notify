'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { NotificationWorkers } = require('./notification-workers.cjs');
const { normaliseNotification } = require('./notification-format.cjs');
const historyStore = require('./notification-history.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) { for (let n = 0; n < 80; n++) { if (await check()) return; await delay(100); } throw Error('Timeout: ' + label); }
(async () => {
  const fixture = fs.mkdtempSync(path.join(__dirname, '.verification', 'clear-on-open-'));
  fs.copyFileSync(path.join(__dirname, fs.existsSync(path.join(__dirname, 'NotificationPopup.next.exe')) ? 'NotificationPopup.next.exe' : 'NotificationPopup.exe'), path.join(fixture, 'NotificationPopup.exe'));
  fs.copyFileSync(path.join(__dirname, 'toast-worker.ps1'), path.join(fixture, 'toast-worker.ps1'));
  fs.writeFileSync(path.join(fixture, 'OpenProbe.cs'), 'using System;using System.IO;class OpenProbe{static void Main(string[] args){if(args.Length==2&&args[0]=="--notification")File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"opened-ids.txt"),args[1]+"\\n");}}');
  execFileSync(path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/target:winexe', '/out:' + path.join(fixture, 'PhoneNotify.exe'), path.join(fixture, 'OpenProbe.cs')], { windowsHide: true });
  let state;
  const events = [];
  const workers = new NotificationWorkers({ root: fixture, diagnostics: true, onState: value => { state = value; }, log: (event, metadata) => events.push({ event, ...metadata }) });
  const id = () => crypto.randomBytes(8).toString('hex');
  const sourceA = normaliseNotification({ appId: 'test.clear.' + id(), appName: '手机通知', title: '点击清除测试', body: '仅清除对应的系统通知' });
  const sourceB = normaliseNotification({ appId: 'test.other.' + id(), appName: '手机通知', title: '其他来源', body: '同编号的其他来源通知应保留' });
  const first = { ...sourceA, id: id(), silent: true, at: new Date().toISOString(), status: 'shown' };
  const second = { ...sourceA, id: id(), silent: true, at: new Date().toISOString(), status: 'shown' };
  const failed = { ...sourceA, id: id(), silent: true };
  const sameTagOtherSource = { ...sourceB, id: first.id, silent: true };
  const native = () => workers.call({ op: 'history' });
  try {
    workers.start();
    await until(() => state === 'ready', 'workers ready');
    await workers.notify(first);
    await workers.notify(second);
    await workers.call(sameTagOtherSource);
    historyStore.save(fixture, [first, second]);
    const saved = fs.readFileSync(path.join(fixture, '.notification-history.json'), 'utf8');
    assert.equal((await native()).tags.filter(tag => tag === first.id).length, 2, 'Both source identities have the same test tag');
    await workers.call({ op: 'exercise-open', targetId: first.id }, 'popup');
    await until(async () => (await native()).tags.filter(tag => tag === first.id).length === 1, 'only clicked source removed');
    await until(() => fs.existsSync(path.join(fixture, 'opened-ids.txt')), 'application open invoked');
    assert(fs.readFileSync(path.join(fixture, 'opened-ids.txt'), 'utf8').includes(first.id));
    assert((await native()).tags.includes(second.id), 'Another notification from the same source remains');
    assert.equal(fs.readFileSync(path.join(fixture, '.notification-history.json'), 'utf8'), saved, 'App records are unchanged');
    await workers.dismissSystemNotification(first.id, first.notifierAppId);
    assert.equal((await native()).tags.filter(tag => tag === first.id).length, 1, 'Repeated removal is idempotent and keeps other source');
    await workers.call({ op: 'exercise-dismiss', targetId: second.id }, 'popup');
    assert((await native()).tags.includes(second.id), 'Closing the card does not remove its system notification');
    await workers.notify(failed);
    fs.renameSync(path.join(fixture, 'PhoneNotify.exe'), path.join(fixture, 'PhoneNotify.disabled.exe'));
    await workers.call({ op: 'exercise-open', targetId: failed.id }, 'popup');
    assert((await native()).tags.includes(failed.id), 'Failed application launch does not remove its system notification');
    await assert.rejects(workers.dismissSystemNotification(second.id, 'Other.Application'), /Invalid notification/);
    await assert.rejects(workers.call({ op: 'remove', notificationId: second.id, notifierAppId: 'Other.Application' }), /Invalid notification/);
    assert((await native()).tags.includes(second.id));
    assert(!events.some(event => event.event === 'notification-center-remove-failed'));
    const report = { result: 'PASS', applicationOpenInvoked: true, clickedNativeNotificationRemoved: true, otherMessageSameSourcePreserved: true, sameTagOtherSourcePreserved: true, appHistoryUnchanged: true, repeatedRemovalSafe: true, closingOnlyRetainsNativeNotification: true, failedLaunchRetainsNativeNotification: true, unrelatedAppRejected: true, exercisedActualWpfOpenHandler: true, physicalMouseClickNotAutomated: true };
    fs.writeFileSync(path.join(__dirname, '.verification', 'clear-on-card-open.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    if (workers.ready) for (const message of [first, second, failed, sameTagOtherSource]) { try { await workers.dismissSystemNotification(message.id, message.notifierAppId); } catch {} }
    workers.stop();
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
