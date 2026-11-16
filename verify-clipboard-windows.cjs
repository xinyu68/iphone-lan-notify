'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {ClipboardBridge}=require('./clipboard-transfer.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'phone-clipboard-windows-'));
const folder=path.join(root,'inbox','0'.repeat(32));fs.mkdirSync(folder,{recursive:true});
const bridge=new ClipboardBridge(__dirname,root,true);
(async()=>{let captured=false;try{
  await bridge.call({kind:'snapshot'});captured=true;
  const text='手机剪贴板验证 📋\n中文与空格  https://example.com';await bridge.call({kind:'text',text});assert.equal((await bridge.call({kind:'inspect'})).text,text);
  const first=path.join(folder,'file.txt'),second=path.join(folder,'other.bin');fs.writeFileSync(first,'file bytes');fs.writeFileSync(second,Buffer.from([0,255,42]));
  await bridge.call({kind:'files',files:[first,second]});assert.deepEqual((await bridge.call({kind:'inspect'})).files,[first,second]);
  const image=path.join(folder,'image.png');fs.copyFileSync(path.join(__dirname,'assets','app-icon.png'),image);await bridge.call({kind:'image',files:[image]});const actual=await bridge.call({kind:'inspect'});assert.equal(actual.image,true);assert.deepEqual(actual.files,[image]);
  await assert.rejects(bridge.call({kind:'files',files:[path.join(__dirname,'README.md')]}));
  const bad=path.join(folder,'bad.png');fs.writeFileSync(bad,'not an image');await assert.rejects(bridge.call({kind:'image',files:[bad]}));assert.equal((await bridge.call({kind:'inspect'})).image,true,'invalid input leaves prior clipboard intact');
  const writer=new ClipboardBridge(__dirname,root,true);
  try {
    await assert.rejects(writer.call({kind:'stall'}),/超时/);
    await writer.call({kind:'text',text:'timeout recovery'});
    assert.equal((await bridge.call({kind:'inspect'})).text,'timeout recovery');
  }finally{writer.close();}
  console.log('PASS: real Windows Unicode text, CF_HDROP multi-file copy, Bitmap/PNG image plus file copy, outside-path rejection and invalid-image preservation');
}finally{try{if(captured)await bridge.call({kind:'restore'});}finally{bridge.close();}await new Promise(resolve=>setTimeout(resolve,1700));fs.rmSync(root,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
