'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const bundle = path.resolve(process.argv[2] || path.join(__dirname, 'dist', `PhoneNotify-${require('./package.json').version}-win-x64`));
(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'bundle-manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
  for (const item of manifest.files) {
    const filename = path.resolve(bundle, item.path);
    assert(filename.startsWith(bundle + path.sep));
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'), item.sha256, item.path);
  }
  assert(!manifest.files.some(item => /(^|\/)(config\.json|preferences\.json|runtime\.json|controller-state\.json|receiver\.log|\.notification-history\.json|\.webview2-profile|\.verification|\.private)(\/|$)/.test(item.path)));
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-notify-bundle-'));
  const app = path.join(fixture, '全新电脑 app folder');
  const data = path.join(fixture, '独立 data folder');
  // Use explicit Unicode-aware file operations; this also verifies every copied file.
  fs.mkdirSync(app);
  for (const entry of manifest.files) {
    const destination = path.join(app, entry.path);
    fs.mkdirSync(path.dirname(destination), { recursive:true });
    fs.copyFileSync(path.join(bundle, entry.path), destination);
  }
  fs.mkdirSync(data);
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const token = crypto.randomBytes(24).toString('base64url');
  const node = path.join(app, 'runtime', 'node.exe');
  fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ host:'127.0.0.1', port, token, nodePath:node }));
  const env = { ...process.env, PATH:path.join(process.env.SystemRoot, 'System32'), PHONE_NOTIFY_DATA_DIR:data };
  const version = execFileSync(node, ['--version'], { env, encoding:'utf8', windowsHide:true }).trim();
  assert.equal(version, require('./node-runtime.json').version);
  let child;
  const origin = `http://127.0.0.1:${port}`;
  const request = async (route, init) => {
    const response = await fetch(`${origin}/${route}/${token}`, { ...init, signal:AbortSignal.timeout(5000) });
    assert(response.ok); return response.json();
  };
  try {
    const heicId='e'.repeat(32),heicDirectory=path.join(data,'inbox',heicId);
    fs.mkdirSync(heicDirectory,{recursive:true});
    fs.copyFileSync(path.join(__dirname,'test-fixtures','sample.heic'),path.join(heicDirectory,'示例.heic'));
    fs.writeFileSync(path.join(data,'clipboard-receipts.json'),JSON.stringify([{id:heicId,kind:'files',files:['示例.heic']}]));
    const decoded=JSON.parse(execFileSync(node,[path.join(app,'heic-render.cjs')],{cwd:app,env,windowsHide:true,encoding:'utf8',input:JSON.stringify({dataRoot:data,id:heicId,index:0})}));
    assert.equal(decoded.ok,true);assert.equal(decoded.width,16);assert.equal(decoded.height,12);
    assert(fs.readFileSync(decoded.path).subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
    child = spawn(node, [path.join(app, 'receiver.cjs')], { cwd:app, env, windowsHide:true, stdio:'ignore' });
    const exited = new Promise(resolve => child.once('exit', resolve));
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      if (child.exitCode !== null) throw Error('Packaged receiver exited early');
      try { ready = (await (await fetch(origin + '/health', { signal:AbortSignal.timeout(1000) })).json()).worker === 'ready'; } catch {}
      if (ready) break; await delay(100);
    }
    assert(ready, 'Packaged workers ready');
    const sent = await request('notify', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ appId:'com.tencent.qqmail', title:'新电脑目录验证', body:'独立数据目录和内置图标，无需系统 Node.js。', silent:true }) });
    let item;
    for (let attempt = 0; attempt < 100; attempt++) {
      item = (await request('status')).history.find(entry => entry.id === sent.id);
      if (item?.status === 'shown' || item?.status === 'failed') break;
      await delay(100);
    }
    assert.equal(item.status, 'shown'); assert.equal(item.appName, 'QQ邮箱'); assert.equal(item.iconBuiltin, true);
    const card = (await request('popup-check')).windows.find(entry => entry.id === sent.id);
    assert(card && card.iconSource === 'appstore'); assert.equal(card.attribution, 'QQ邮箱 • 来自 iPhone');
    const native = (await request('history-check')).details.find(entry => entry.id === sent.id);
    assert(native && native.hasAppIcon === false);
    assert(fs.existsSync(path.join(data, '.notification-history.json')));
    assert(fs.readdirSync(path.join(data, '.icon-cache')).some(name => name.endsWith('.ico')), 'Native icons generated in writable user data');
    for (const file of ['config.json','runtime.json','receiver.log','.notification-history.json','.icon-cache']) assert(!fs.existsSync(path.join(app,file)), file + ' must not be written beside binaries');
    await request('stop', { method:'POST' });
    await Promise.race([exited, delay(5000)]);
    assert(child.exitCode !== null);
    const report = { result:'PASS', files:manifest.files.length, bundledNode:version, systemNodeOnPath:false, unicodeAndSpacePaths:true, programDirectoryWrites:false, nativeSmallIcon:true, builtinIcon:true, separateUserHistory:true, heicWithBundledCodecs:true };
    fs.mkdirSync(path.join(__dirname, '.verification'), {recursive:true});
    fs.writeFileSync(path.join(__dirname,'.verification','bundle-portability.json'), JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally {
    if (child && child.exitCode === null) { child.kill(); await delay(1500); }
    assert.equal(path.dirname(fs.realpathSync(fixture)), fs.realpathSync(os.tmpdir()));
    await delay(1500);
    function removeOwned(directory) {
      for (const name of fs.readdirSync(directory)) {
        const filename = path.join(directory, name);
        const info = fs.lstatSync(filename);
        if (info.isDirectory() && !info.isSymbolicLink()) removeOwned(filename); else fs.unlinkSync(filename);
      }
      fs.rmdirSync(directory);
    }
    removeOwned(fixture);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
