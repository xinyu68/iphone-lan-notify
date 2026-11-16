'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {ensureHeicPng,checkDimensions}=require('./heic-render.cjs');
const {inboxBytes}=require('./inbox-storage.cjs');
const {PNG}=require('pngjs');
(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'phone-notify-heic-'));
  const id='b'.repeat(32),directory=path.join(root,'inbox',id);
  const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  try {
    fs.mkdirSync(directory,{recursive:true});
    const source=path.join(directory,'示例.heic');
    fs.copyFileSync(path.join(__dirname,'test-fixtures','sample.heic'),source);
    const before=digest(source);
    const receipt=name=>fs.writeFileSync(path.join(root,'clipboard-receipts.json'),JSON.stringify([{id,kind:'files',files:[name]}]));
    receipt('示例.heic');
    const args={dataRoot:root,id,index:0};
    const first=await ensureHeicPng(args),image=PNG.sync.read(fs.readFileSync(first.path));
    assert.equal(first.cached,false);assert.equal(image.width,16);assert.equal(image.height,12);
    assert.equal(digest(source),before,'Original HEIC must remain unchanged');
    const again=await ensureHeicPng(args);assert.equal(again.cached,true);assert.equal(again.path,first.path);
    assert.equal(inboxBytes(path.join(root,'inbox')),fs.statSync(source).size+fs.statSync(first.path).size,'Cache counts toward inbox quota');
    for(const patch of [{id:'../outside'},{index:-1},{index:1},{index:20}])await assert.rejects(ensureHeicPng({...args,...patch}));
    receipt('../示例.heic');await assert.rejects(ensureHeicPng(args));
    fs.writeFileSync(path.join(directory,'broken.heic'),'not a HEIC file');receipt('broken.heic');await assert.rejects(ensureHeicPng(args));
    for(const [w,h] of [[0,12],[16385,1],[10000,10000]])assert.throws(()=>checkDimensions(w,h));
    console.log('PASS: HEIC decode, PNG dimensions, cache reuse, original preservation, quota accounting and invalid inputs');
  } finally {assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
