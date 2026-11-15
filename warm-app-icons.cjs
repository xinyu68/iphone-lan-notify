'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { AppIconCache } = require('./app-icon-cache.cjs');
const names = process.argv.slice(2);
const sources = names.length ? names : ['微信', 'QQ', '京东金融', 'X', '币安'];
const cache = new AppIconCache({ root: __dirname, dataRoot:require('./runtime-paths.cjs').dataDirectory(), displayWaitMs: 15000 });

(async () => {
  const results = [];
  try {
    for (const appName of sources) {
      const started = performance.now();
      const result = await cache.resolve({ appName });
      const record = { appName, source: result.iconSource, storeId: result.iconStoreId, country: result.iconCountry, cacheHit: result.iconCacheHit === true, milliseconds: Math.round(performance.now() - started) };
      results.push(record);
      console.log(JSON.stringify(record));
    }
    fs.mkdirSync(path.join(__dirname, '.verification'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '.verification', 'app-icon-cache-warm.json'), JSON.stringify({ date: '2026-11-15', results }, null, 2));
  } finally { cache.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
