'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { dataDirectory, loadConfig } = require('./runtime-paths.cjs');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-notify-portability-'));
const old = process.env.PHONE_NOTIFY_DATA_DIR;
try {
  const first = path.join(fixture, '用户 data one');
  process.env.PHONE_NOTIFY_DATA_DIR = first;
  const initial = loadConfig();
  assert.equal(initial.dataRoot, first);
  assert.equal(initial.config.token.length, 32);
  assert.equal(loadConfig().config.token, initial.config.token);
  const second = path.join(fixture, 'fresh-computer');
  process.env.PHONE_NOTIFY_DATA_DIR = second;
  assert.notEqual(loadConfig().config.token, initial.config.token);
  process.env.PHONE_NOTIFY_DATA_DIR = 'relative-data';
  assert.throws(() => dataDirectory(), /absolute/);
  delete process.env.PHONE_NOTIFY_DATA_DIR;
  const legacy = path.join(fixture, 'legacy-install');
  fs.mkdirSync(legacy);
  fs.writeFileSync(path.join(legacy, 'config.json'), '{}');
  assert.equal(dataDirectory(legacy), legacy);
  if (process.platform === 'win32') {
    const source = path.join(fixture, 'Probe.cs');
    const executable = path.join(fixture, 'Probe.exe');
    fs.writeFileSync(source, 'using System;using System.IO;using Xinyu.PhoneNotifications;class Probe{static void Main(string[] args){AppEnvironment.Initialize(args[0]);Console.WriteLine(AppEnvironment.DataRoot);}}');
    execFileSync(path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo','/reference:System.Web.Extensions.dll','/out:'+executable,path.join(__dirname,'AppEnvironment.cs'),source], { windowsHide:true });
    const app = path.join(fixture, '应用 program files');
    fs.mkdirSync(path.join(app, 'runtime'), { recursive:true });
    fs.writeFileSync(path.join(app, 'runtime', 'node.exe'), 'fixture - existence probe only');
    const data = path.join(fixture, 'isolated-user-data');
    const env = { ...process.env, PATH:'', PHONE_NOTIFY_DATA_DIR:data };
    execFileSync(executable, [app], { env, windowsHide:true });
    const saved = JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8'));
    assert.equal(fs.realpathSync(saved.nodePath).toLowerCase(), fs.realpathSync(path.join(app, 'runtime', 'node.exe')).toLowerCase());
    assert(saved.token && saved.token.length === 32);
    assert(!fs.existsSync(path.join(app, 'config.json')));
    fs.writeFileSync(path.join(data, 'preferences.json'), JSON.stringify({receiveEnabled:false}));
    execFileSync(executable, [app], { env, windowsHide:true });
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8')).token, saved.token);
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'preferences.json'), 'utf8')).receiveEnabled, false);
    fs.renameSync(path.join(app, 'runtime'), path.join(app, 'runtime-unavailable'));
    assert.throws(() => execFileSync(executable, [app], { env, windowsHide:true, stdio:'pipe' }));
  }
  console.log('PASS: separate writable data, unique first-run pairing, persistent identity, legacy paths, invalid override rejected, bundled runtime preferred, Unicode/space paths, no PATH dependency and clear missing-runtime failure');
} finally {
  if (old === undefined) delete process.env.PHONE_NOTIFY_DATA_DIR; else process.env.PHONE_NOTIFY_DATA_DIR = old;
  assert.equal(path.dirname(fs.realpathSync(fixture)), fs.realpathSync(os.tmpdir()));
  fs.rmSync(fixture, { recursive:true, force:true });
}
