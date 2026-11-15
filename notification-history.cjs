'use strict';
const fs = require('node:fs');
const path = require('node:path');
const MAX_ITEMS = 200;
const MAX_AGE = 7 * 86400000;
function retained(items, now = Date.now()) {
  if (!Array.isArray(items)) return [];
  return items.filter(item => item && /^[a-f0-9]{16}$/.test(item.id) && typeof item.title === 'string' && typeof item.body === 'string' && item.title.length <= 200 && item.body.length <= 8000 && Date.parse(item.at) >= now - MAX_AGE && Date.parse(item.at) <= now + 60000)
    .slice(0, MAX_ITEMS).map(item => {
      const saved = {};
      for (const field of ['id', 'title', 'body', 'appId', 'appName', 'source', 'notifierAppId', 'at', 'isTest', 'status', 'presentation', 'iconSource', 'iconCacheHit', 'iconBuiltin', 'nativePopupSuppressed']) if (Object.hasOwn(item, field)) saved[field] = item[field];
      return saved;
    });
}
function load(root, now) {
  try {
    const file = path.join(root, '.notification-history.json');
    if (fs.statSync(file).size > 8 * 1024 * 1024) return [];
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    return saved.version === 1 ? retained(saved.items, now) : [];
  } catch { return []; }
}
function save(root, items) {
  const file = path.join(root, '.notification-history.json');
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, items: retained(items) }));
  fs.renameSync(temporary, file);
}
module.exports = { load, save, retained, MAX_ITEMS };
