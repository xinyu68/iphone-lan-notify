'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
fs.mkdirSync(path.join(__dirname, '.verification'), { recursive:true });
for (const test of ['verify-release.cjs','verify-notification-format.cjs','verify-notification-history.cjs','verify-app-icon-cache.cjs','verify-bundled-icons.cjs','verify-scriptable.cjs','verify-portability.cjs','verify-clipboard-transfer.cjs','verify-clipboard-sender.cjs','verify-heic.cjs','verify-clipboard-preview.cjs']) {
  const result = spawnSync(process.execPath, [test], { cwd:__dirname, stdio:'inherit', windowsHide:true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
