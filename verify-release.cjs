'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {publishRelease,compareVersions}=require('./publish-release.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function mockApi(options={}) {
  const state={release:null,uploads:0,writes:0,publishes:0};
  const fetchImpl=async(url,init)=>{
    const parsed=new URL(url),method=init.method;let data;
    if(method!=='GET')state.writes++;
    if(parsed.pathname.endsWith('/git/ref/tags/v1.2.0'))data={object:{type:'tag',sha:'b'.repeat(40)}};
    else if(parsed.pathname.endsWith('/git/tags/'+'b'.repeat(40)))data={object:{type:'commit',sha:options.wrongCommit?'c'.repeat(40):'a'.repeat(40)}};
    else if(parsed.pathname.endsWith('/releases/latest'))data=options.latest||state.release&&!state.release.draft&&state.release;
    else if(parsed.hostname==='uploads.github.com'&&method==='POST') {
      state.uploads++;
      if(options.failSecond&&state.uploads===2)return {ok:false,status:503};
      assert(state.release.draft,'Uploads must happen before publishing');
      const name=parsed.searchParams.get('name');
      data={name,state:'uploaded',size:init.body.length,digest:options.badDigest?'sha256:invalid':'sha256:'+hash(init.body)};
      state.release.assets.push(data);
    } else if(method==='POST'&&parsed.pathname.endsWith('/releases')) {
      const body=JSON.parse(init.body);assert.equal(body.draft,true);assert.equal(body.target_commitish,'a'.repeat(40));
      state.release={id:7,...body,assets:[],upload_url:'https://'+(options.badHost?'untrusted.example':'uploads.github.com')+'/repos/example/app/releases/7/assets{?name,label}',html_url:'https://github.com/example/app/releases/tag/v1.2.0'};data=state.release;
    } else if(method==='PATCH'&&parsed.pathname.endsWith('/releases/7')) {
      assert.equal(state.release.assets.length,3,'Both assets must exist before publishing');
      assert.equal(JSON.parse(init.body).make_latest,'true');state.publishes++;state.release.draft=false;data=state.release;
    } else if(parsed.pathname.endsWith('/releases/tags/v1.2.0')||parsed.pathname.endsWith('/releases/7'))data=state.release;
    else throw Error('Unexpected API request: '+method+' '+parsed.pathname);
    return {ok:Boolean(data),status:data?200:404,json:async()=>structuredClone(data)};
  };
  return {state,fetchImpl};
}
(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'phone-notify-release-'));
  try {
    fs.mkdirSync(path.join(root,'docs','releases'),{recursive:true});fs.mkdirSync(path.join(root,'dist'));
    fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'1.2.0'}));
    fs.writeFileSync(path.join(root,'docs','releases','1.2.0.md'),'Synthetic release notes');
    const name='PhoneNotify-1.2.0-win-x64.zip',bytes=Buffer.from('Synthetic package fixture');
    fs.writeFileSync(path.join(root,'dist',name),bytes);fs.writeFileSync(path.join(root,'dist',name+'.sha256'),hash(bytes)+'  '+name+'\n');
    const context={root,repo:'example/app',tag:'v1.2.0',sha:'a'.repeat(40),token:'synthetic-token'};
    const good=mockApi();const result=await publishRelease({...context,fetchImpl:good.fetchImpl});assert.equal(result.assets.length,3);assert.equal(good.state.uploads,3);assert.equal(good.state.publishes,1);
    await publishRelease({...context,fetchImpl:good.fetchImpl});assert.equal(good.state.uploads,3);assert.equal(good.state.publishes,1,'Published rerun must not mutate release');
    good.state.release.assets[0].digest='sha256:different';await assert.rejects(publishRelease({...context,fetchImpl:good.fetchImpl}),/differs/);assert.equal(good.state.publishes,1);
    for(const options of [{wrongCommit:true},{badHost:true},{badDigest:true},{latest:{id:8,tag_name:'v2.0.0'}}]) {
      const fixture=mockApi(options);await assert.rejects(publishRelease({...context,fetchImpl:fixture.fetchImpl}));assert.equal(fixture.state.publishes,0,'Invalid release must stay unpublished');
    }
    const retry=mockApi({failSecond:true});await assert.rejects(publishRelease({...context,fetchImpl:retry.fetchImpl}));assert.equal(retry.state.release.draft,true);assert.equal(retry.state.release.assets.length,1);
    await publishRelease({...context,fetchImpl:retry.fetchImpl});assert.equal(retry.state.uploads,4,'Retry must reuse first asset');assert.equal(retry.state.publishes,1);
    const invalid=mockApi();await assert.rejects(publishRelease({...context,tag:'v1.2.1',fetchImpl:invalid.fetchImpl}),/version/);assert.equal(invalid.state.writes,0);
    fs.writeFileSync(path.join(root,'dist',name),'changed');await assert.rejects(publishRelease({...context,fetchImpl:invalid.fetchImpl}),/checksum/);assert.equal(invalid.state.writes,0);
    assert(compareVersions('1.10.0','1.2.0')>0);
    console.log('PASS: draft upload and digest verification before publishing, tag/version, Latest, rerun/resume, no overwrite and failure stays unpublished; no network');
  } finally {assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
