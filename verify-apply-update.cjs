'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
if(process.platform!=='win32'){console.log('SKIP: Windows update handoff test');process.exit(0);}
const wait=ms=>new Promise(r=>setTimeout(r,ms)),hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'phone-apply-update-'));
const compiler=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
function ps(script,args=[]){const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,...args],{encoding:'utf8',windowsHide:true,timeout:30000});if(r.status!==0)throw Error(r.stdout+r.stderr);return r;}
async function until(test){for(let i=0;i<120;i++){if(test())return;await wait(100);}throw Error('Timed out waiting for update handoff');}
function fixture(name,extra){
  const work=path.join(root,name),app=path.join(work,'应用 app'),data=path.join(work,'用户 data'),stage=path.join(data,'.updates','d'.repeat(32)),source=path.join(work,'PhoneNotify-1.3.0-win-x64');
  for(const dir of [app,stage,source])fs.mkdirSync(dir,{recursive:true});
  fs.copyFileSync(path.join(root,'stub.exe'),path.join(app,'PhoneNotify.exe'));
  fs.writeFileSync(path.join(app,'package.json'),'old package');fs.mkdirSync(path.join(app,'public'));fs.writeFileSync(path.join(app,'public','desktop.html'),'old UI');fs.writeFileSync(path.join(app,'receiver.cjs'),'old receiver');
  fs.writeFileSync(path.join(data,'config.json'),'private pairing fixture');fs.writeFileSync(path.join(app,'config.json'),'legacy pairing fixture');fs.writeFileSync(path.join(data,'preferences.json'),'preferences fixture');
  fs.writeFileSync(path.join(data,'update-result.json'),JSON.stringify({ok:true,version:'1.2.1',at:'2026-01-01T00:00:00Z'}));
  const files={'PhoneNotify.exe':fs.readFileSync(path.join(root,'stub.exe')),'package.json':JSON.stringify({version:'1.3.0'}),'public/desktop.html':'new UI','updater.cjs':'updater','apply-update.ps1':'installer','receiver.cjs':'new receiver','runtime/node.exe':'runtime fixture','README.md':'readme','LICENSE':'license','public/app.js':'script',...extra};
  const entries=[];for(const [name,content]of Object.entries(files)){const filename=path.join(source,name);fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,content);entries.push({path:name,sha256:hash(filename)});}
  fs.writeFileSync(path.join(source,'bundle-manifest.json'),JSON.stringify({version:'1.3.0',files:entries}));
  const archive=path.join(stage,'package.zip');ps(path.join(root,'archive.ps1'),['-Source',source,'-Output',archive]);
  fs.writeFileSync(path.join(stage,'download.json'),JSON.stringify({version:'1.3.0',size:fs.statSync(archive).size,sha256:hash(archive)}));
  return {app,data,stage,archive,source};
}
const apply=path.join(__dirname,'apply-update.ps1');
const args=(f,pid)=>['-AppRoot',f.app,'-DataRoot',f.data,'-Stage',f.stage,'-ParentId',String(pid)];
(async()=>{
 let parent,installer,locker;
 try {
  fs.writeFileSync(path.join(root,'Stub.cs'),'using System;using System.IO;using System.Threading;using System.Diagnostics;using System.Web.Script.Serialization;class Stub{static void Main(string[] a){if(a.Length>0){Thread.Sleep(60000);return;}string d=Environment.GetEnvironmentVariable("PHONE_NOTIFY_DATA_DIR");File.WriteAllText(Path.Combine(d,"controller-state.json"),new JavaScriptSerializer().Serialize(new{pid=Process.GetCurrentProcess().Id,version="1.3.0",webReady=true,preferred=false,clipboardEnabled=false}));Thread.Sleep(1000);}}');
  const compilation=spawnSync(compiler,['/nologo','/target:winexe','/platform:x64','/reference:System.Web.Extensions.dll','/out:'+path.join(root,'stub.exe'),path.join(root,'Stub.cs')],{encoding:'utf8',windowsHide:true});if(compilation.status!==0)throw Error(compilation.stdout+compilation.stderr);
  fs.writeFileSync(path.join(root,'archive.ps1'),"param($Source,$Output)\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n[IO.Compression.ZipFile]::CreateFromDirectory($Source,$Output,[IO.Compression.CompressionLevel]::Optimal,$true)\n");
  const invalid=fixture('invalid',{'config.json':'must not overwrite pairing'});
  const rejected=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',apply,...args(invalid,1),'-ValidateOnly'],{encoding:'utf8',windowsHide:true,timeout:30000});assert.notEqual(rejected.status,0);assert.equal(fs.readFileSync(path.join(invalid.data,'config.json'),'utf8'),'private pairing fixture');assert.equal(fs.readFileSync(path.join(invalid.app,'public','desktop.html'),'utf8'),'old UI');
  const corrupt=fixture('corrupt');fs.appendFileSync(corrupt.archive,'corrupt');const bad=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',apply,...args(corrupt,1),'-ValidateOnly'],{encoding:'utf8',windowsHide:true,timeout:30000});assert.notEqual(bad.status,0);
  for(const fail of [false,true]){
    const f=fixture(fail?'rollback':'success');
    if(fail){const escaped=path.join(f.app,'receiver.cjs').replaceAll("'","''");locker=spawn('powershell.exe',['-NoProfile','-Command',"$f=[IO.File]::Open('"+escaped+"',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);[Console]::WriteLine('LOCKED');Start-Sleep -Seconds 30;$f.Dispose()"],{windowsHide:true,stdio:['ignore','pipe','ignore']});await new Promise(resolve=>locker.stdout.once('data',resolve));}
    parent=spawn(path.join(f.app,'PhoneNotify.exe'),['--wait'],{windowsHide:true,stdio:'ignore'});await wait(200);
    installer=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',apply,...args(f,parent.pid)],{windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';installer.stdout.on('data',b=>logs+=b);installer.stderr.on('data',b=>logs+=b);const ended=new Promise(resolve=>installer.once('exit',resolve));
    await until(()=>fs.existsSync(path.join(f.stage,'ready.json'))||installer.exitCode!==null);if(installer.exitCode!==null)throw Error(logs);
    parent.kill();await Promise.race([ended,wait(20000).then(()=>{throw Error('Update apply timed out');})]);
    const result=JSON.parse(fs.readFileSync(path.join(f.data,'update-result.json'),'utf8').replace(/^\uFEFF/,''));assert.equal(result.ok,!fail,logs);
    assert.equal(fs.readFileSync(path.join(f.app,'public','desktop.html'),'utf8'),fail?'old UI':'new UI');assert.equal(fs.readFileSync(path.join(f.app,'receiver.cjs'),'utf8'),fail?'old receiver':'new receiver');
    assert.equal(fs.readFileSync(path.join(f.data,'config.json'),'utf8'),'private pairing fixture');assert.equal(fs.readFileSync(path.join(f.app,'config.json'),'utf8'),'legacy pairing fixture');assert.equal(fs.readFileSync(path.join(f.data,'preferences.json'),'utf8'),'preferences fixture');
    if(locker){locker.kill();locker=null;}parent=null;installer=null;await wait(1300);
  }
  console.log('PASS: real Windows updater validates archives, refuses user-data overwrite/corruption, waits for the owned app to exit, installs/restarts and rolls back on file lock; pairing/preferences preserved and previous update results atomically replaced');
 }finally{for(const child of [parent,installer,locker])if(child&&child.exitCode===null)child.kill();await wait(1300);assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
