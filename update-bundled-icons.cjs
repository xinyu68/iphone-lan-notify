'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { imageInfo } = require('./app-icon-cache.cjs');
const root = __dirname;
const manifestPath = path.join(root, 'app-icon-catalog.json');
const bootstrap = process.argv.indexOf('--bootstrap');
const input = JSON.parse(fs.readFileSync(bootstrap >= 0 ? path.resolve(process.argv[bootstrap + 1]) : manifestPath, 'utf8'));

async function download(url, limit) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`HTTP ${response.status}: ${new URL(url).hostname}`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw Error('App Store response exceeded size limit');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

(async () => {
  if (input.apps.length !== 30 || new Set(input.apps.map(app => app.storeId)).size !== 30) throw Error('Expected exactly 30 distinct app identities');
  let apps = input.apps.map(app => ({ ...app }));
  if (bootstrap < 0) {
    const groups = new Map();
    for (const app of apps) { if (!groups.has(app.country)) groups.set(app.country, []); groups.get(app.country).push(app); }
    for (const [country, group] of groups) {
      const url = 'https://itunes.apple.com/lookup?' + new URLSearchParams({ country, id: group.map(app => app.storeId).join(',') });
      const data = JSON.parse((await download(url, 4 * 1024 * 1024)).toString('utf8'));
      for (const app of group) {
        const latest = data.results.find(result => result.trackId === app.storeId);
        if (!latest || latest.bundleId.toLowerCase() !== app.bundleId.toLowerCase() || latest.artistId !== app.publisherId) throw Error(`Identity changed: ${app.name}; review before updating`);
        Object.assign(app, { storeName: latest.trackName, publisher: latest.artistName, artworkUrl: latest.artworkUrl100 || latest.artworkUrl512, storeUrl: latest.trackViewUrl });
      }
    }
  }
  const directory = path.join(root, 'assets', 'app-icons');
  fs.mkdirSync(directory, { recursive: true });
  let next = 0;
  await Promise.all([0, 1].map(async () => {
    while (next < apps.length) {
      const app = apps[next++];
      if (app.storeId === 507161324) { app.name = '淘宝闪购'; app.aliases.push('饿了么', '餓了麼'); }
      if (app.storeId === 554499054) app.aliases.push('滴滴');
      app.aliases = [...new Set([app.name, ...app.aliases])];
      const artwork = new URL(app.artworkUrl);
      if (artwork.protocol !== 'https:' || !/(^|\.)mzstatic\.com$/i.test(artwork.hostname)) throw Error(`Invalid artwork host: ${app.name}`);
      const bytes = await download(artwork, 512 * 1024);
      const info = imageInfo(bytes);
      if (info.width < 64 || info.height < 64 || info.width > 1024 || info.height > 1024) throw Error(`Invalid icon dimensions: ${app.name}`);
      app.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      app.file = `assets/app-icons/${app.storeId}-${app.sha256.slice(0, 12)}.${info.extension}`;
      const file = path.join(root, app.file);
      if (!fs.existsSync(file)) { fs.writeFileSync(file + '.tmp', bytes); fs.renameSync(file + '.tmp', file); }
      app.bytes = bytes.length; app.width = info.width; app.height = info.height;
      app.verifiedAt = new Date().toISOString();
      console.log(JSON.stringify({ name: app.name, id: app.storeId, bytes: app.bytes }));
    }
  }));
  const output = { version: 1, description: 'Verified China App Store icon catalog; names are explicit aliases, not substring guesses.', apps };
  fs.writeFileSync(manifestPath + '.tmp', JSON.stringify(output, null, 2) + '\n');
  fs.renameSync(manifestPath + '.tmp', manifestPath);
  console.log(JSON.stringify({ result: 'PASS', apps: apps.length, totalBytes: apps.reduce((sum, app) => sum + app.bytes, 0) }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
