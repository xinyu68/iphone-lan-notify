'use strict';
const fs = require('node:fs');
const path = require('node:path');
const nameKey = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const isBundleId = value => /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/i.test(value || '');
let bundledApps = [];
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'app-icon-catalog.json'), 'utf8'));
  if (manifest.version === 1 && Array.isArray(manifest.apps)) bundledApps = manifest.apps.filter(app =>
    Number.isSafeInteger(app.storeId) && typeof app.name === 'string' && Array.isArray(app.aliases) && app.aliases.every(alias => typeof alias === 'string') &&
    isBundleId(app.bundleId) && /^assets\/app-icons\/[0-9]+-[a-f0-9]{12}\.(jpg|png)$/.test(app.file || '') && /^[a-f0-9]{64}$/.test(app.sha256 || '') && Number.isFinite(Date.parse(app.verifiedAt)));
} catch { /* A missing optional pack must not prevent normal notifications. */ }

const compatibilityApps = [
  { name:'微信', aliases:['微信','WeChat'], storeId:414478124, bundleId:'com.tencent.xin', country:'cn' },
  { name:'QQ', aliases:['QQ'], storeId:444934666, bundleId:'com.tencent.mqq', country:'cn' },
  { name:'京东金融', aliases:['京东金融'], storeId:895682747, bundleId:'com.jd.jinrong', country:'cn' },
  { name:'X', aliases:['X','Twitter','推特','X（前身为Twitter）'], storeId:333903271, bundleId:'com.atebits.Tweetie2', country:'cn' },
  { name:'币安', aliases:['币安','幣安','Binance'], storeId:1436799971, bundleId:'com.czzhao.binance', country:'hk' }
];
const knownApps = [...bundledApps, ...compatibilityApps.filter(app => !bundledApps.some(bundled => bundled.storeId === app.storeId))];

function byName(name) {
  const key = nameKey(name);
  if (!key) return null;
  const found = knownApps.filter(app => [app.name, app.storeName, ...app.aliases].filter(Boolean).some(alias => nameKey(alias) === key));
  return found.length === 1 ? found[0] : null;
}

function knownApplication(source) {
  if (isBundleId(source.appId)) {
    const found = knownApps.filter(app => app.bundleId.toLowerCase() === source.appId.toLowerCase());
    return found.length === 1 ? found[0] : null;
  }
  return byName(source.appId) || byName(source.appName);
}

module.exports = { bundledApps, knownApplication, nameKey, isBundleId };
