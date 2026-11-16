'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const REPO='xinyu68/iphone-lan-notify',API='https://api.github.com/repos/'+REPO;
const MAX_PACKAGE=200*1024*1024;
function version(value){if(!/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value)||value.split('.').some(n=>+n>65534))throw Error('版本号无效');return value.split('.').map(Number);}
function newer(left,right){const a=version(left),b=version(right);for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i];return false;}
function releaseInfo(data,current){
  version(current);
  if(!data||data.draft||data.prerelease||typeof data.tag_name!=='string'||!data.tag_name.startsWith('v'))throw Error('未找到正式版本');
  const latest=data.tag_name.slice(1);version(latest);
  const prefix=`https://github.com/${REPO}/releases/download/v${latest}/`,name=`PhoneNotify-${latest}-win-x64.zip`;
  const asset=filename=>{const a=(data.assets||[]).find(x=>x.name===filename);if(!a||a.state!=='uploaded'||!Number.isSafeInteger(a.size)||a.size<1||a.size>MAX_PACKAGE||!/^sha256:[a-f0-9]{64}$/.test(a.digest)||a.browser_download_url!==prefix+filename)throw Error('新版安装包或校验文件不完整');return {name:a.name,size:a.size,sha256:a.digest.slice(7),url:a.browser_download_url};};
  const zip=asset(name),checksum=asset(name+'.sha256');if(checksum.size>4096)throw Error('校验文件大小异常');
  return {available:newer(latest,current),version:latest,notes:typeof data.body==='string'?data.body.slice(0,20000):'',zip,checksum};
}
async function getRelease(current,tag,fetchImpl=fetch){
  if(tag)version(tag);
  const response=await fetchImpl(API+(tag?'/releases/tags/v'+tag:'/releases/latest'),{headers:{'User-Agent':'PhoneNotify-Updater',Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(response.status===403||response.status===429)throw Error('GitHub 暂时限制访问，请稍后重试');
  if(!response.ok)throw Error('检查更新失败（HTTP '+response.status+'）');
  const text=await response.text();if(text.length>1024*1024)throw Error('更新响应过大');
  return releaseInfo(JSON.parse(text),current);
}
async function downloadAsset(asset,destination,progress,fetchImpl=fetch){
  const response=await fetchImpl(asset.url,{signal:AbortSignal.timeout(180000)});
  if(!response.ok||!response.body)throw Error('安装包下载失败，请稍后重试');
  const fd=fs.openSync(destination,'wx'),hash=crypto.createHash('sha256');let size=0,last=-1;
  try {for await(const chunk of response.body){size+=chunk.length;if(size>asset.size)throw Error('下载大小异常');hash.update(chunk);for(let written=0;written<chunk.length;){const count=fs.writeSync(fd,chunk,written,chunk.length-written);if(!count)throw Error("Could not write update package");written+=count;}const percent=Math.floor(size/asset.size*100);if(percent!==last){last=percent;if(progress)progress(percent);}}} finally {fs.closeSync(fd);}
  if(size!==asset.size||hash.digest('hex')!==asset.sha256)throw Error('下载校验失败，未安装任何文件');
}
async function prepareUpdate({current,target,dataRoot},progress,fetchImpl=fetch){
  const release=await getRelease(current,target,fetchImpl);if(release.version!==target||!release.available)throw Error('目标版本不是较新的正式版本');
  if(typeof dataRoot!=='string'||!path.isAbsolute(dataRoot)||!fs.statSync(dataRoot).isDirectory())throw Error('更新数据目录无效');
  const updates=path.join(dataRoot,'.updates');fs.mkdirSync(updates,{recursive:true});if(fs.lstatSync(updates).isSymbolicLink())throw Error('更新目录不能是链接');
  const stage=path.join(updates,crypto.randomBytes(16).toString('hex'));fs.mkdirSync(stage);
  await downloadAsset(release.checksum,path.join(stage,'checksum.txt'),null,fetchImpl);
  const sum=fs.readFileSync(path.join(stage,'checksum.txt'),'utf8').replace(/^\uFEFF/,'').trim();
  if(sum!==release.zip.sha256+'  '+release.zip.name)throw Error('安装包与校验清单不一致');
  await downloadAsset(release.zip,path.join(stage,'package.zip'),progress,fetchImpl);
  fs.writeFileSync(path.join(stage,'download.json'),JSON.stringify({version:release.version,sha256:release.zip.sha256,size:release.zip.size}));
  return {stage,version:release.version};
}
module.exports={newer,releaseInfo,getRelease,prepareUpdate,downloadAsset};
if(require.main===module){let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{input+=chunk;if(input.length>65536)process.exit(1);});process.stdin.on('end',async()=>{const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');try{const request=JSON.parse(input);const result=request.action==='check'?await getRelease(request.current):request.action==='download'?await prepareUpdate(request,p=>emit({type:'progress',percent:p})):null;if(!result)throw Error('更新操作无效');emit({type:'result',ok:true,...result});}catch(error){emit({type:'result',ok:false,error:error.message||'更新失败，请稍后重试'});process.exitCode=1;}});}
