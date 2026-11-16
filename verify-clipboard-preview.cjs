'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
if(process.platform!=='win32'){console.log('SKIP: native clipboard previews require Windows');process.exit(0);}
const root=fs.mkdtempSync(path.join(os.tmpdir(),'phone-preview-test-'));
try{
  const compiler=path.join(process.env.SystemRoot,'Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  const executable=path.join(root,'ClipboardPreviewProbe.exe');
  const result=spawnSync(compiler,['/nologo','/codepage:65001','/target:exe','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll','/out:'+executable,path.join(__dirname,'test-fixtures','ClipboardPreviewProbe.cs'),path.join(__dirname,'ClipboardSettings.cs')],{encoding:'utf8',windowsHide:true});
  if(result.status!==0)throw Error(result.stdout+result.stderr);
  const probe=spawnSync(executable,[root],{encoding:'utf8',windowsHide:true,timeout:30000});
  if(probe.status!==0)throw Error(probe.stdout+probe.stderr);
  console.log(probe.stdout.trim());
}finally{assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});}
