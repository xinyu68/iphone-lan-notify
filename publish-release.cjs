'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function compareVersions(left,right) {
  const a=left.split('.').map(Number),b=right.split('.').map(Number);
  for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i]?1:-1;
  return 0;
}
async function publishRelease({root=__dirname,repo,tag,sha,token,fetchImpl=fetch}) {
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo||'')||!/^v\d+\.\d+\.\d+$/.test(tag||'')||!(/^[a-f0-9]{40}$/).test(sha||'')||!token)throw Error('Invalid release context');
  const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
  if(tag!=='v'+version)throw Error('Tag does not match package.json version');
  const notes=fs.readFileSync(path.join(root,'docs','releases',version+'.md'),'utf8');
  const zipName=`PhoneNotify-${version}-win-x64.zip`,checksumName=zipName+'.sha256';
  const assets=[zipName,checksumName].map(name=>{const bytes=fs.readFileSync(path.join(root,'dist',name));return {name,bytes,size:bytes.length,digest:'sha256:'+hash(bytes)};});
  if(!assets[0].size||assets[1].bytes.toString('utf8').replace(/^\uFEFF/,'').trim()!==assets[0].digest.slice(7)+'  '+zipName)throw Error('ZIP checksum does not match');
  const updateBytes=Buffer.from(JSON.stringify({schemaVersion:1,tag_name:tag,draft:false,prerelease:false,commit:sha,body:notes,assets:assets.map(asset=>({name:asset.name,size:asset.size,state:'uploaded',digest:asset.digest,browser_download_url:`https://github.com/${repo}/releases/download/${tag}/${asset.name}`}))},null,2)+'\n');
  assets.push({name:'update.json',bytes:updateBytes,size:updateBytes.length,digest:'sha256:'+hash(updateBytes)});
  const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'PhoneNotify-Release'};
  const base='https://api.github.com/repos/'+repo;
  async function request(url,method='GET',body,raw=false) {
    const response=await fetchImpl(url,{method,headers:{...headers,...(body?{'Content-Type':raw?'application/octet-stream':'application/json'}:{})},...(body?{body:raw?body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(raw?180000:30000)});
    if(response.status===404&&method==='GET')return null;
    if(!response.ok)throw Error('GitHub release request failed: '+method+' HTTP '+response.status);
    return response.json();
  }
  const ref=await request(base+'/git/ref/tags/'+encodeURIComponent(tag));
  let target=ref&&ref.object;
  for(let depth=0;target&&target.type==='tag'&&depth<5;depth++){const annotated=await request(base+'/git/tags/'+target.sha);target=annotated&&annotated.object;}
  if(!target||target.type!=='commit'||target.sha!==sha)throw Error('Remote tag does not point to the release commit');
  const latest=await request(base+'/releases/latest');
  if(latest&&latest.tag_name!==tag&&(/^v\d+\.\d+\.\d+$/).test(latest.tag_name)&&compareVersions(version,latest.tag_name.slice(1))<=0)throw Error('Refusing to replace Latest with an older version');
  let release=await request(base+'/releases/tags/'+encodeURIComponent(tag));
  if(release&&release.prerelease)throw Error('Existing release is a prerelease');
  if(!release)release=await request(base+'/releases','POST',{tag_name:tag,target_commitish:sha,name:'手机通知 '+tag,body:notes,draft:true,prerelease:false});
  if(release.tag_name!==tag||!Number.isSafeInteger(release.id))throw Error('Unexpected release identity');
  const releaseUrl=base+'/releases/'+release.id;
  const same=(remote,asset)=>remote&&remote.state==='uploaded'&&remote.size===asset.size&&remote.digest===asset.digest;
  for(const asset of assets) {
    const existing=(release.assets||[]).find(item=>item.name===asset.name);
    if(existing){if(!same(existing,asset))throw Error('Existing release asset differs: '+asset.name);continue;}
    if(!release.draft)throw Error('Published release is missing expected assets');
    const upload=new URL(release.upload_url.replace(/\{.*$/,''));
    if(upload.origin!=='https://uploads.github.com'||upload.pathname!==`/repos/${repo}/releases/${release.id}/assets`)throw Error('Unexpected asset upload URL');
    upload.searchParams.set('name',asset.name);
    const saved=await request(upload.href,'POST',asset.bytes,true);
    if(!same(saved,asset))throw Error('Uploaded asset verification failed: '+asset.name);
  }
  release=await request(releaseUrl);
  if(!release||release.tag_name!==tag||!assets.every(asset=>same((release.assets||[]).find(item=>item.name===asset.name),asset)))throw Error('Release assets did not verify');
  if(release.draft)await request(releaseUrl,'PATCH',{draft:false,prerelease:false,make_latest:'true'});
  const published=await request(releaseUrl),current=await request(base+'/releases/latest');
  if(!published||published.draft||published.prerelease||published.tag_name!==tag||!current||current.id!==release.id||!assets.every(asset=>same((published.assets||[]).find(item=>item.name===asset.name),asset)))throw Error('Published Release or Latest verification failed');
  return {url:published.html_url,tag,sha,assets:assets.map(({name,size,digest})=>({name,size,digest}))};
}
module.exports={publishRelease,compareVersions};
if(require.main===module){
  const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:__dirname,encoding:'utf8'}).trim();
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REF!=='refs/tags/'+process.env.GITHUB_REF_NAME||process.env.GITHUB_SHA!==sha)throw Error('Release publishing requires the matching GitHub tag workflow');
  publishRelease({repo:process.env.GITHUB_REPOSITORY,tag:process.env.GITHUB_REF_NAME,sha,token:process.env.GH_TOKEN}).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
