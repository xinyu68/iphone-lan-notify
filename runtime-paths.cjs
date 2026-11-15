'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
function dataDirectory(root = __dirname) {
  const configured = process.env.PHONE_NOTIFY_DATA_DIR;
  if (configured && !path.isAbsolute(configured)) throw Error('PHONE_NOTIFY_DATA_DIR must be an absolute path');
  return configured ? path.resolve(configured) : fs.existsSync(path.join(root, 'config.json')) ? root : path.join(process.env.LOCALAPPDATA || os.homedir(), 'PhoneNotify', 'data');
}
function loadConfig(root = __dirname) {
  const dataRoot = dataDirectory(root);
  fs.mkdirSync(dataRoot, { recursive:true });
  const filename = path.join(dataRoot, 'config.json');
  if (!fs.existsSync(filename)) {
    const addresses = Object.values(os.networkInterfaces()).flat().filter(address => address.family === 'IPv4' && !address.internal);
    fs.writeFileSync(filename, JSON.stringify({ host:addresses[0]?.address || '127.0.0.1', port:18766, token:crypto.randomBytes(24).toString('base64url'), nodePath:process.execPath }, null, 2), { flag:'wx' });
  }
  const config = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(config.token) || !require('node:net').isIPv4(config.host) || config.host === '0.0.0.0' || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw Error('Invalid receiver configuration');
  return { config, dataRoot };
}
module.exports = { dataDirectory, loadConfig };
