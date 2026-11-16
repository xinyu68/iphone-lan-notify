'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {newer,releaseInfo,prepareUpdate}=require('./updater.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const zip=Buffer.from('synthetic package bytes'),name='PhoneNotify-1.3.0-win-x64.zip',sum=Buffer.from(hash(zip)+'  '+name+'\n');
const asset=(name,bytes)=>({name,size:bytes.length,state:'uploaded',digest:'sha256:'+hash(bytes),browser_download_url:'https://github.com/xinyu68/iphone-lan-notify/releases/download/v1.3.0/'+name});
const metadata=()=>({tag_name:'v1.3.0',draft:false,prerelease:false,body:'Synthetic notes',assets:[asset(name,zip),asset(name+'.sha256',sum)]});
(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'phone-update-test-'));
  try {
    assert(newer('1.10.0','1.2.0'));assert(!newer('1.2.0','1.2.0'));assert(!newer('1.2.0','1.3.0'));assert.throws(()=>newer('../bad','1.2.0'));
    assert.equal(releaseInfo(metadata(),'1.2.1').available,true);assert.equal(releaseInfo(metadata(),'1.3.0').available,false);
    for(const mutate of [m=>m.prerelease=true,m=>m.assets.pop(),m=>m.assets[0].browser_download_url='https://untrusted.example/a.zip',m=>m.assets[0].digest=null,m=>m.assets[0].size=201*1024*1024,m=>m.tag_name='v../bad']){const m=metadata();mutate(m);assert.throws(()=>releaseInfo(m,'1.2.1'));}
    const mock=(bad=false)=>async url=>new Response(url.includes('/releases/tags/')?JSON.stringify(metadata()):url.endsWith('.sha256')?sum:bad?Buffer.from('corrupt'):zip);
    const progress=[];const good=await prepareUpdate({current:'1.2.1',target:'1.3.0',dataRoot:root},p=>progress.push(p),mock());
    assert.equal(hash(fs.readFileSync(path.join(good.stage,'package.zip'))),hash(zip));assert.equal(progress.at(-1),100);assert.equal(JSON.parse(fs.readFileSync(path.join(good.stage,'download.json'))).version,'1.3.0');
    await assert.rejects(prepareUpdate({current:'1.2.1',target:'1.3.0',dataRoot:root},()=>{},mock(true)),/校验|大小/);
    await assert.rejects(prepareUpdate({current:'1.3.0',target:'1.3.0',dataRoot:root},()=>{},mock()),/较新/);
    console.log('PASS: version comparison, release identity, pinned asset URLs, missing/oversized assets, verified download, progress and corrupt download rejection; no network');
  }finally{assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
