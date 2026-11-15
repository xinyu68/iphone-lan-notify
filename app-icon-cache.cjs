'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { knownApplication, nameKey: normalize, isBundleId } = require('./app-icon-catalog.cjs');

function matchApplication(items, source) {
  const name = normalize(source.appName);
  const catalog = knownApplication(source);
  const bundle = isBundleId(source.appId) ? source.appId.toLowerCase() : null;
  if (bundle) {
    const exact = items.filter(item => item.bundleId?.toLowerCase() === bundle && (!catalog || item.trackId === catalog.storeId));
    return exact.length === 1 ? exact[0] : null;
  }
  if (catalog) {
    const verified = items.filter(item => item.trackId === catalog.storeId && item.bundleId?.toLowerCase() === catalog.bundleId.toLowerCase());
    return verified.length === 1 ? verified[0] : null;
  }
  const exact = items.filter(item => normalize(item.trackName) === name);
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  const matches = items.filter(item => normalize(item.trackName?.split(/[-－—:：|（(]/, 1)[0]) === name);
  return matches.length === 1 ? matches[0] : null;
}

function imageInfo(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
    return { extension: 'png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset++] !== 255) continue;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))
        return { extension: 'jpg', height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
      offset += length;
    }
  }
  throw Error('Unsupported or invalid icon image');
}

class AppIconCache {
  constructor({ root, dataRoot = root, fetchImpl = fetch, log = () => {}, now = Date.now, displayWaitMs = 2200, requestTimeoutMs = 2500, maxApiCalls = 18 }) {
    this.root = root;
    this.directory = path.join(dataRoot, '.icon-cache');
    this.indexPath = path.join(this.directory, 'index.json');
    this.fallbackPath = path.join(root, 'assets', 'app-icon.png');
    this.fetch = fetchImpl;
    this.log = log;
    this.now = now;
    this.displayWaitMs = displayWaitMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.maxApiCalls = maxApiCalls;
    this.entries = {};
    this.inflight = new Map();
    this.controllers = new Set();
    this.calls = [];
    this.closed = false;
    this.active = 0;
    this.waiters = [];
    try { fs.mkdirSync(this.directory, { recursive: true }); } catch { this.disabled = true; }
    try {
      const index = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
      if (index.version === 1 && index.entries && typeof index.entries === 'object') this.entries = index.entries;
    } catch { /* Missing or invalid metadata is rebuilt lazily. */ }
  }

  identity(source) {
    const appId = String(source.appId || '');
    const known = knownApplication(source);
    if (known) return crypto.createHash('sha256').update(`store:${known.storeId}`).digest('hex');
    const identity = isBundleId(appId) ? `bundle:${appId.toLowerCase()}` : `name:${normalize(source.appName)}`;
    return crypto.createHash('sha256').update(identity).digest('hex');
  }

  fallback(reason) { return { iconPath: this.fallbackPath, iconSource: 'phone-notify', iconReason: reason }; }

  bundled(app) {
    if (!app?.file) return null;
    try {
      const file = path.resolve(this.root, app.file);
      const directory = path.resolve(this.root, 'assets', 'app-icons') + path.sep;
      if (!file.startsWith(directory)) return null;
      const bytes = fs.readFileSync(file);
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== app.sha256) return null;
      imageInfo(bytes);
      return { iconPath:file, iconSource:'appstore', iconBuiltin:true, iconStoreId:app.storeId, iconCountry:app.country, iconCacheHit:false };
    } catch { return null; }
  }

  migrateKnownCache(key, known) {
    if (!known || this.entries[key]) return;
    const candidates = Object.entries(this.entries).filter(([, entry]) => entry.storeId === known.storeId && entry.bundleId?.toLowerCase() === known.bundleId.toLowerCase())
      .sort(([, first], [, second]) => (second.updatedAt || 0) - (first.updatedAt || 0));
    for (const [oldKey, entry] of candidates) {
      if (this.cached(oldKey)) { this.entries[key] = { ...entry }; this.persist(); return; }
    }
  }

  cached(key) {
    const entry = this.entries[key];
    if (!entry?.file || !/^[a-f0-9]{64}\.(png|jpg)$/.test(entry.file)) return null;
    try {
      const filename = path.join(this.directory, entry.file);
      const bytes = fs.readFileSync(filename);
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== entry.sha256) return null;
      return { iconPath: filename, iconSource: 'appstore', iconStoreId: entry.storeId, iconCountry: entry.country, iconCacheHit: true };
    } catch { return null; }
  }

  async resolve(message) {
    const source = { appName: String(message.appName || '').trim(), appId: String(message.appId || '') };
    if (this.closed) return this.fallback('stopped');
    const known = knownApplication(source);
    if (!known && (!source.appName || ['iphone', '手机通知', 'iphone 通知'].includes(normalize(source.appName)))) return this.fallback('no-source');
    const key = this.identity(source);
    this.migrateKnownCache(key, known);
    const entry = this.entries[key];
    let cached = this.cached(key);
    if (known && cached && (entry.storeId !== known.storeId || entry.bundleId?.toLowerCase() !== known.bundleId.toLowerCase())) cached = null;
    const bundled = this.bundled(known);
    if (bundled) {
      const useCache = cached && entry.updatedAt >= Date.parse(known.verifiedAt);
      const expiresAt = useCache ? entry.expiresAt : Date.parse(known.verifiedAt) + 7 * 86400000;
      if (!this.disabled && expiresAt < this.now() && !(entry?.retryAt > this.now())) this.begin(key, source);
      return useCache ? cached : bundled;
    }
    if (this.disabled) return this.fallback('cache-unavailable');
    if (cached) {
      if (entry.expiresAt < this.now()) this.begin(key, source);
      return cached;
    }
    if (entry?.retryAt > this.now()) return this.fallback(entry.reason || 'retry-later');
    const pending = this.begin(key, source);
    let timeout;
    try {
      return await Promise.race([
        pending,
        new Promise(resolve => { timeout = setTimeout(() => resolve(this.fallback('lookup-deadline')), this.displayWaitMs); }),
      ]);
    } finally { clearTimeout(timeout); }
  }

  begin(key, source) {
    if (this.inflight.has(key)) return this.inflight.get(key);
    if (this.closed || this.inflight.size >= 32) return Promise.resolve(this.fallback('busy'));
    const operation = this.lookup(key, source).catch(error => {
      if (!this.closed) {
        if (this.cached(key)) { this.entries[key].expiresAt = this.now() + 5 * 60000; this.entries[key].retryAt = this.now() + 5 * 60000; }
        else this.entries[key] = { retryAt: this.now() + 5 * 60000, reason: error.code === 'RATE_LIMIT' ? 'rate-limit' : 'unavailable' };
        this.persist();
        this.log('app-icon-unavailable', { key: key.slice(0, 12), reason: error.code === 'RATE_LIMIT' ? 'rate-limit' : 'lookup-failed' });
      }
      return this.fallback(error.code === 'RATE_LIMIT' ? 'rate-limit' : 'unavailable');
    }).finally(() => { this.inflight.delete(key); });
    this.inflight.set(key, operation);
    return operation;
  }

  async acquire() {
    if (this.closed) throw Error('Icon resolver stopped');
    if (this.active >= 2) await new Promise(resolve => this.waiters.push(resolve));
    if (this.closed) throw Error('Icon resolver stopped');
    this.active++;
  }

  release() { this.active--; const next = this.waiters.shift(); if (next) next(); }

  async request(url, image = false) {
    if (this.closed) throw Error('Icon resolver stopped');
    if (!image) {
      const now = this.now();
      if (this.cooldownUntil > now) throw Object.assign(Error('App Store query cooling down'), { code: 'RATE_LIMIT' });
      this.calls = this.calls.filter(at => now - at < 60000);
      if (this.calls.length >= this.maxApiCalls) throw Object.assign(Error('App Store query budget exhausted'), { code: 'RATE_LIMIT' });
      this.calls.push(now);
    }
    const controller = new AbortController();
    this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetch(url, { signal: controller.signal, redirect: 'follow', headers: { Accept: image ? 'image/png,image/jpeg' : 'application/json', 'User-Agent': 'PhoneNotify/1.0' } });
      if (!response.ok) {
        if (response.status === 429) { this.cooldownUntil = this.now() + 60000; throw Object.assign(Error('App Store HTTP 429'), { code: 'RATE_LIMIT' }); }
        throw Error(`App Store HTTP ${response.status}`);
      }
      const limit = image ? 512 * 1024 : 1024 * 1024;
      if (Number(response.headers.get('content-length')) > limit) throw Error('Icon response too large');
      const chunks = [];
      let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > limit) { controller.abort(); throw Error('Icon response too large'); }
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } finally { clearTimeout(timeout); this.controllers.delete(controller); }
  }

  async lookup(key, source) {
    await this.acquire();
    try {
      const previous = this.entries[key];
      const known = knownApplication(source);
      const countries = [...new Set([previous?.country, known?.country, 'cn', 'hk', 'tw', 'us'].filter(Boolean))];
      let networkFailures = 0;
      for (const country of countries) {
        const url = new URL('https://itunes.apple.com/search');
        const lookupId = known?.storeId || (previous?.country === country ? previous.storeId : null);
        if (lookupId) {
          url.pathname = '/lookup';
          url.search = new URLSearchParams({ id: String(lookupId), country }).toString();
        } else {
          url.search = new URLSearchParams({ term: source.appName, country, media: 'software', entity: 'software', limit: '10' }).toString();
        }
        let response;
        try { response = JSON.parse((await this.request(url)).toString('utf8')); }
        catch (error) { if (error.code === 'RATE_LIMIT' || this.closed) throw error; networkFailures++; continue; }
        const selected = matchApplication(response.results || [], source);
        if (!selected) continue;
        const artwork = new URL(selected.artworkUrl100 || selected.artworkUrl60 || selected.artworkUrl512);
        if (artwork.protocol !== 'https:' || !/(^|\.)mzstatic\.com$/i.test(artwork.hostname)) continue;
        const bytes = await this.request(artwork, true);
        const image = imageInfo(bytes);
        if (image.width < 16 || image.height < 16 || image.width > 1024 || image.height > 1024) throw Error('Unexpected icon dimensions');
        const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
        const file = `${key}.${image.extension}`;
        const filename = path.join(this.directory, file);
        const temporary = filename + '.tmp';
        fs.writeFileSync(temporary, bytes);
        fs.renameSync(temporary, filename);
        this.entries[key] = { file, sha256, country, storeId: selected.trackId, bundleId: selected.bundleId, name: selected.trackName, publisher: selected.artistName, updatedAt: this.now(), expiresAt: this.now() + 7 * 86400000 };
        this.persist();
        this.log('app-icon-cached', { key: key.slice(0, 12), country, storeId: selected.trackId, bytes: bytes.length });
        return { iconPath: filename, iconSource: 'appstore', iconStoreId: selected.trackId, iconCountry: country, iconCacheHit: false };
      }
      if (networkFailures) throw Error('App Store search was unavailable or incomplete');
      this.entries[key] = { retryAt: this.now() + 86400000, reason: 'not-found' };
      this.persist();
      return this.fallback('not-found');
    } finally { this.release(); }
  }

  persist() {
    if (this.closed) return;
    try {
      fs.writeFileSync(this.indexPath + '.tmp', JSON.stringify({ version: 1, entries: this.entries }, null, 2));
      fs.renameSync(this.indexPath + '.tmp', this.indexPath);
    } catch { /* A read-only cache never prevents showing a notification. */ }
  }

  close() {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    for (const resolve of this.waiters.splice(0)) resolve();
  }
}

module.exports = { AppIconCache, matchApplication, imageInfo };
