'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AppIconCache } = require('./app-icon-cache.cjs');
const { bundledApps, knownApplication, nameKey } = require('./app-icon-catalog.cjs');
const { normaliseNotification } = require('./notification-format.cjs');
const verification = path.join(__dirname, '.verification');
const root = fs.mkdtempSync(path.join(verification, 'bundled-icons-'));
fs.cpSync(path.join(__dirname, 'assets', 'app-icons'), path.join(root, 'assets', 'app-icons'), { recursive: true });
const checks = [];
(async () => {
  assert.equal(bundledApps.length, 30);
  const names = new Map();
  let requests = 0;
  const offline = new AppIconCache({ root, fetchImpl: async () => { requests++; throw Error('Offline'); } });
  let resolved = 0;
  for (const app of bundledApps) {
    for (const alias of [app.name, ...app.aliases, app.storeName]) {
      const previous = names.get(nameKey(alias));
      assert(!previous || previous === app.storeId, `Ambiguous built-in alias: ${alias}`);
      names.set(nameKey(alias), app.storeId);
      const icon = await offline.resolve({ appName: alias });
      assert.equal(icon.iconBuiltin, true, alias);
      assert.equal(icon.iconStoreId, app.storeId);
      assert(icon.iconPath.startsWith(path.join(root, 'assets', 'app-icons')));
      resolved++;
    }
    assert.equal((await offline.resolve({ appId: app.bundleId })).iconStoreId, app.storeId);
    assert.equal((await offline.resolve({ appId: app.bundleId.toUpperCase(), appName: '别的名称' })).iconStoreId, app.storeId);
    assert.equal(normaliseNotification({ appId: app.bundleId, body: 'test' }).appName, app.name);
    assert.equal(normaliseNotification({ appId: app.bundleId, appName: '手机提供的名称', body: 'test' }).appName, '手机提供的名称');
  }
  assert.equal(requests, 0);
  checks.push('all 30 icons and aliases resolve with an empty cache and no network, including exact bundle identities');
  for (const [first, second] of [['QQ','QQ邮箱'],['QQ','QQ音乐'],['京东','京东金融'],['美团','美团外卖'],['淘宝','淘宝闪购'],['微信','企业微信']])
    assert.notEqual(knownApplication({ appName:first }).storeId, knownApplication({ appName:second }).storeId);
  assert.equal(knownApplication({ appName:'饿了么' }).storeId, knownApplication({ appName:'淘宝闪购' }).storeId);
  for (const name of ['QQ音乐极速版','京东金融助手','抖音极速版','美团众包']) assert.equal(knownApplication({ appName:name }), null);
  assert.equal(knownApplication({ appId:'com.unrelated.application', appName:'微信' }), null);
  checks.push('related brands remain distinct; explicit rebrand alias works; editions and unknown bundles do not receive guessed icons');
  assert.equal((await offline.resolve({ appName:'  ＱＱ  ' })).iconStoreId, 444934666);
  offline.close();

  const legacyRoot = path.join(root, 'legacy');
  const legacyDirectory = path.join(legacyRoot, '.icon-cache');
  fs.mkdirSync(legacyDirectory, { recursive:true });
  const oldKey = require('node:crypto').createHash('sha256').update('name:x').digest('hex');
  const oldBytes = fs.readFileSync(path.join(root, bundledApps[0].file));
  fs.writeFileSync(path.join(legacyDirectory, oldKey+'.jpg'), oldBytes);
  fs.writeFileSync(path.join(legacyDirectory, 'index.json'), JSON.stringify({version:1,entries:{[oldKey]:{file:oldKey+'.jpg',sha256:require('node:crypto').createHash('sha256').update(oldBytes).digest('hex'),storeId:333903271,bundleId:'com.atebits.Tweetie2',country:'cn',updatedAt:Date.now(),expiresAt:Date.now()+86400000}}}));
  const legacy = new AppIconCache({ root:legacyRoot, fetchImpl:async()=>{throw Error('Existing X icon must work offline');} });
  assert.equal((await legacy.resolve({appName:'X'})).iconStoreId,333903271);
  assert.equal((await legacy.resolve({appId:'com.atebits.Tweetie2'})).iconCacheHit,true);
  legacy.close();
  checks.push('existing verified cache migrates across aliases and bundle identities; X/Binance compatibility is preserved');

  const first = bundledApps[0];
  const bytes = fs.readFileSync(path.join(root, first.file));
  const requestsAfterExpiry = [];
  const stale = new AppIconCache({ root, now: () => Date.parse(first.verifiedAt) + 8 * 86400000, fetchImpl: async raw => {
    const url = new URL(raw); requestsAfterExpiry.push(url);
    if (url.hostname.endsWith('mzstatic.com')) return new Response(bytes);
    return new Response(JSON.stringify({ results:[{ trackId:first.storeId, bundleId:first.bundleId, trackName:'商店标题已经改变', artworkUrl100:'https://test.mzstatic.com/icon.jpg' }] }));
  } });
  assert.equal((await stale.resolve({ appName:first.name })).iconBuiltin, true);
  await Promise.all([...stale.inflight.values()]);
  assert.equal(requestsAfterExpiry[0].pathname, '/lookup');
  assert.equal(requestsAfterExpiry[0].searchParams.get('id'), String(first.storeId));
  assert.equal((await stale.resolve({ appName:first.name })).iconCacheHit, true);
  assert.equal(stale.identity({ appName:first.name }), stale.identity({ appId:first.bundleId }));
  stale.close();
  checks.push('expired bundled artwork displays immediately while verified ID lookup refreshes cache; name changes do not break identity');

  const damaged = bundledApps[1];
  fs.writeFileSync(path.join(root, damaged.file), 'damaged bundled image');
  const damagedCache = new AppIconCache({ root, fetchImpl: async () => { throw Error('Offline'); } });
  assert.equal((await damagedCache.resolve({ appName:damaged.name })).iconSource, 'phone-notify');
  assert.equal((await damagedCache.resolve({ appName:bundledApps[2].name })).iconBuiltin, true);
  damagedCache.close();
  checks.push('damaged pack image falls back safely; other bundled images remain available');
  const report = { result:'PASS', apps:bundledApps.length, aliasCases:resolved, initialNetworkRequests:requests, checks };
  fs.writeFileSync(path.join(verification, 'bundled-icons.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
