'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {ClipboardBridge}=require('./clipboard-transfer.cjs');
if(process.platform!=='win32'){console.log('SKIP: native clipboard previews require Windows');process.exit(0);}
const root=fs.mkdtempSync(path.join(os.tmpdir(),'phone-preview-test-'));
(async()=>{let bridge,captured=false;try{
  const compiler=path.join(process.env.SystemRoot,'Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  const executable=path.join(root,'ClipboardPreviewProbe.exe');
  const result=spawnSync(compiler,['/nologo','/codepage:65001','/target:exe','/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll','/out:'+executable,path.join(__dirname,'test-fixtures','ClipboardPreviewProbe.cs'),path.join(__dirname,'ClipboardSettings.cs')],{encoding:'utf8',windowsHide:true});
  if(result.status!==0)throw Error(result.stdout+result.stderr);
  const args=[root,__dirname];
  if(process.argv.includes('--live-clipboard')){bridge=new ClipboardBridge(__dirname,root,true);await bridge.call({kind:'snapshot'});captured=true;args.push('--live-clipboard');}
  const probe=spawnSync(executable,args,{encoding:'utf8',windowsHide:true,timeout:60000,env:{...process.env,PHONE_NOTIFY_TEST_NODE:process.execPath}});
  if(probe.status!==0)throw Error(probe.stdout+probe.stderr);
  console.log(probe.stdout.trim());
}finally{try{if(captured)await bridge.call({kind:'restore'});}finally{if(bridge)bridge.close();}assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
