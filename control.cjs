const fs = require('node:fs');
const path = require('node:path');
const { config } = require('./runtime-paths.cjs').loadConfig();
const command = process.argv[2] || 'status';
if (!['status', 'stop'].includes(command)) throw new Error('Use status or stop');
fetch(`http://${config.host}:${config.port}/${command}/${config.token}`, {
  method: command === 'stop' ? 'POST' : 'GET', signal: AbortSignal.timeout(4000),
}).then(async response => {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  console.log(JSON.stringify(command === 'stop' ? result : {
    worker: result.worker, received: result.received, shown: result.shown,
    failed: result.failed, lastReceivedAt: result.lastReceivedAt,
  }, null, 2));
}).catch(error => { console.error(`Receiver is unavailable: ${error.message}`); process.exitCode = 1; });
