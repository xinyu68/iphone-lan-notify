const crypto = require('node:crypto');
const { bundledApps } = require('./app-icon-catalog.cjs');

const appNames = Object.freeze({
  ...Object.fromEntries(bundledApps.map(app => [app.bundleId.toLowerCase(), app.name])),
  'com.tencent.xin': '微信',
  'com.alipay.iphoneclient': '支付宝',
  'com.tencent.mqq': 'QQ',
  'com.ss.iphone.ugc.aweme': '抖音',
  'com.apple.mobilemail': '邮件',
  'com.apple.mobilesms': '信息',
});

function cleanText(value, limit) {
  if (value == null) return '';
  if (typeof value !== 'string' && typeof value !== 'number') throw Object.assign(new Error('Notification values must be text'), { status: 400 });
  return String(value).replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim().slice(0, limit);
}

function normaliseNotification(input, customAppNames = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Expected a JSON object'), { status: 400 });
  const message = cleanText(input.message ?? input.text ?? input.body, 12000);
  let title = cleanText(input.title, 200);
  let body = cleanText(input.body ?? message, 12000);
  if (!title && message.includes('\n')) {
    const lines = message.split('\n');
    title = lines.shift().trim().slice(0, 200);
    body = lines.join('\n').trim();
  }
  title ||= 'iPhone 通知';
  body ||= message;
  if (!body) throw Object.assign(new Error('Notification message is empty'), { status: 400 });

  const appId = cleanText(input.appId ?? input.bundleIdentifier ?? input.bundleId, 200).replace(/\s+/g, '');
  const providedName = cleanText(input.appName ?? input.app ?? input.source, 80).replace(/\s+/g, ' ');
  const lookupId = appId.toLowerCase();
  const configuredName = customAppNames[appId] ?? customAppNames[lookupId];
  const mappedName = typeof configuredName === 'string' ? configuredName.trim() : '';
  const appName = (mappedName || providedName || appNames[lookupId] || appId || 'iPhone').slice(0, 80);
  const identity = (appId || `name:${appName}`) + '\0' + appName;
  const notifierAppId = 'Xinyu.IPhoneLanNotify.Source.' + crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24);
  return { title, body: body.slice(0, 8000), appId, appName, notifierAppId, source: appName };
}

module.exports = { normaliseNotification };
