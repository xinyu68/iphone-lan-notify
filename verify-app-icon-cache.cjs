'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AppIconCache, matchApplication, imageInfo } = require('./app-icon-cache.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const verification = path.join(__dirname, '.verification');
fs.mkdirSync(verification, { recursive: true });
const root = fs.mkdtempSync(path.join(verification, 'icon-cache-tests-'));
const imageFixture = fs.readFileSync(path.join(__dirname, require('./app-icon-catalog.cjs').bundledApps.find(app => app.storeId === 414478124).file));
const actualImage = imageInfo(imageFixture);
assert.equal(actualImage.width, 100);
const wechat = { trackId: 414478124, trackName: '微信', artistName: 'WeChat', bundleId: 'com.tencent.xin', artworkUrl100: 'https://test.mzstatic.com/wechat.jpg' };
const binance = { trackId: 1436799971, trackName: '幣安 - 加密貨幣', artistName: 'Binance Switzerland AG', bundleId: 'com.czzhao.binance', artworkUrl100: 'https://test.mzstatic.com/binance.jpg' };
const checks = [];
const fixtureRoot = name => { const dir = path.join(root, name); fs.mkdirSync(dir); return dir; };
const json = results => new Response(JSON.stringify({ resultCount: results.length, results }), { headers: { 'Content-Type': 'application/json' } });
const icon = () => new Response(imageFixture, { headers: { 'Content-Type': 'image/jpeg' } });

(async () => {
  const calls = [];
  const fetchImpl = async raw => { const url = new URL(raw); calls.push(url); return url.hostname.endsWith('mzstatic.com') ? icon() : json([{ ...wechat, trackName: '微信助手', trackId: 999 }, wechat]); };
  const cacheRoot = fixtureRoot('positive');
  const cache = new AppIconCache({ root: cacheRoot, fetchImpl });
  const found = await cache.resolve({ appName: '微信', appId: '微信' });
  assert.equal(found.iconSource, 'appstore');
  assert.equal(found.iconStoreId, 414478124);
  assert.equal(calls.length, 2);
  assert(fs.existsSync(found.iconPath));
  assert.equal((await cache.resolve({ appName: '微信' })).iconCacheHit, true);
  assert.equal(calls.length, 2);
  cache.close();
  const reopened = new AppIconCache({ root: cacheRoot, fetchImpl: async () => { throw Error('Network must not run on cache hit'); } });
  assert.equal((await reopened.resolve({ appName: '微信' })).iconCacheHit, true);
  reopened.close();
  checks.push('verified result selected; local cache reused and persists after process restart');

  const regions = [];
  const regional = new AppIconCache({ root: fixtureRoot('regions'), fetchImpl: async raw => {
    const url = new URL(raw);
    if (url.hostname.endsWith('mzstatic.com')) return icon();
    regions.push(url.searchParams.get('country'));
    return json(url.searchParams.get('country') === 'hk' ? [binance] : []);
  } });
  assert.equal((await regional.resolve({ appName: '币安' })).iconStoreId, 1436799971);
  assert.deepEqual(regions, ['hk']);
  regional.close();
  checks.push('known Hong Kong identity uses direct lookup; simplified name matches verified traditional-title app');

  let unknownQueries = 0;
  const missing = new AppIconCache({ root: fixtureRoot('missing'), fetchImpl: async () => { unknownQueries++; return json([]); } });
  assert.equal((await missing.resolve({ appName: '不存在的测试应用' })).iconSource, 'phone-notify');
  assert.equal(unknownQueries, 4);
  await missing.resolve({ appName: '不存在的测试应用' });
  assert.equal(unknownQueries, 4);
  missing.close();
  assert.equal(matchApplication([{ trackName: '重复名称', trackId: 1 }, { trackName: '重复名称', trackId: 2 }], { appName: '重复名称' }), null);
  assert.equal(matchApplication([{ trackName: 'QQ音乐', trackId: 414603431 }], { appName: 'QQ' }), null);
  checks.push('no match and ambiguous/similarly named apps use fallback; missing results are not repeatedly queried');

  let groupedSearches = 0;
  const grouped = new AppIconCache({ root: fixtureRoot('deduplicate'), fetchImpl: async raw => {
    if (new URL(raw).hostname.endsWith('mzstatic.com')) return icon();
    groupedSearches++; await delay(30); return json([wechat]);
  } });
  const concurrent = await Promise.all(Array.from({ length: 5 }, () => grouped.resolve({ appName: '微信' })));
  assert(concurrent.every(value => value.iconSource === 'appstore'));
  assert.equal(groupedSearches, 1);
  grouped.close();
  checks.push('five concurrent notifications from one app share one query/download');

  const slow = new AppIconCache({ root: fixtureRoot('deadline'), displayWaitMs: 10, fetchImpl: async raw => {
    if (new URL(raw).hostname.endsWith('mzstatic.com')) return icon();
    await delay(70); return json([wechat]);
  } });
  const began = Date.now();
  assert.equal((await slow.resolve({ appName: '微信' })).iconSource, 'phone-notify');
  assert(Date.now() - began < 100);
  await delay(100);
  assert.equal((await slow.resolve({ appName: '微信' })).iconCacheHit, true);
  slow.close();
  checks.push('display deadline uses app fallback while a successful background lookup fills cache');

  let now = 1000000;
  let offline = true;
  const network = new AppIconCache({ root: fixtureRoot('offline'), now: () => now, fetchImpl: async raw => {
    if (offline) throw Error('Simulated network unavailable');
    return new URL(raw).hostname.endsWith('mzstatic.com') ? icon() : json([wechat]);
  } });
  assert.equal((await network.resolve({ appName: '微信' })).iconSource, 'phone-notify');
  const failure = Object.values(network.entries)[0];
  assert(failure.retryAt - now <= 5 * 60000);
  now += 6 * 60000; offline = false;
  assert.equal((await network.resolve({ appName: '微信' })).iconSource, 'appstore');
  now += 8 * 86400000; offline = true;
  assert.equal((await network.resolve({ appName: '微信' })).iconSource, 'appstore');
  await delay(10);
  assert.equal((await network.resolve({ appName: '微信' })).iconSource, 'appstore');
  network.close();
  checks.push('offline fallback retries after cooldown and retains valid cached artwork when refresh fails');

  let limitedQueries = 0;
  const limited = new AppIconCache({ root: fixtureRoot('rate-limit'), maxApiCalls: 1, fetchImpl: async () => { limitedQueries++; return json([]); } });
  assert.equal((await limited.resolve({ appName: '测试配额' })).iconSource, 'phone-notify');
  assert.equal(limitedQueries, 1);
  limited.close();
  checks.push('API query budget prevents region fallback from exhausting rate limits');

  const corrupt = new AppIconCache({ root: cacheRoot, fetchImpl: async () => { throw Error('Offline after corrupt cache'); } });
  fs.writeFileSync(found.iconPath, 'invalid image');
  assert.equal((await corrupt.resolve({ appName: '微信' })).iconSource, 'phone-notify');
  corrupt.close();
  assert.throws(() => imageInfo(Buffer.from('not an image')));
  checks.push('corrupt cache and invalid image data fall back without breaking notifications');
  const report = { result: 'PASS', checks, fixture: root, externalRequests: 0 };
  fs.writeFileSync(path.join(verification, 'app-icon-cache-tests.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
