'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {imageInfo}=require('./app-icon-cache.cjs');
const {inboxBytes}=require('./inbox-storage.cjs');
const MAX_SOURCE=50*1024*1024,MAX_PIXELS=40000000,MAX_INBOX=1024*1024*1024;
function checkDimensions(width,height) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>16384||height>16384||width*height>MAX_PIXELS)throw Error('HEIC 图片尺寸过大');
}
function cachedInfo(filename) {
  if(!fs.existsSync(filename))return null;
  if(!fs.lstatSync(filename).isFile()||fs.lstatSync(filename).isSymbolicLink())throw Error('无效的图片缓存');
  const file=fs.openSync(filename,'r');
  try { const header=Buffer.alloc(32);fs.readSync(file,header);const info=imageInfo(header);checkDimensions(info.width,info.height);return info; } catch {return null;} finally {fs.closeSync(file);}
}
async function ensureHeicPng({dataRoot,id,index}) {
  if(typeof dataRoot!=='string'||!path.isAbsolute(dataRoot)||!/^[a-f0-9]{32}$/.test(id)||!Number.isInteger(index)||index<0||index>=20)throw Error('无效的 HEIC 接收记录');
  const receipts=JSON.parse(fs.readFileSync(path.join(dataRoot,'clipboard-receipts.json'),'utf8'));
  const receipt=Array.isArray(receipts)&&receipts.find(item=>item.id===id&&item.kind!=='text');
  const name=receipt&&Array.isArray(receipt.files)&&receipt.files[index];
  if(typeof name!=='string'||path.basename(name)!==name||name.includes(':')||!/\.(heic|heif)$/i.test(name))throw Error('无效的 HEIC 文件');
  const inbox=path.join(dataRoot,'inbox'),directory=path.join(inbox,id),source=path.join(directory,name),cache=path.join(directory,'.heic-cache');
  if(fs.lstatSync(directory).isSymbolicLink()||!fs.lstatSync(source).isFile()||fs.lstatSync(source).isSymbolicLink())throw Error('无效的 HEIC 文件路径');
  const size=fs.statSync(source).size;if(size<16||size>MAX_SOURCE)throw Error('HEIC 文件大小无效');
  const buffer=fs.readFileSync(source);
  if(buffer.toString('ascii',4,8)!=='ftyp')throw Error('文件不是有效的 HEIC 图片');
  const hash=crypto.createHash('sha256').update('libheif-1.23.5\0').update(buffer).digest('hex').slice(0,32);
  if(fs.existsSync(cache)&&(!fs.lstatSync(cache).isDirectory()||fs.lstatSync(cache).isSymbolicLink()))throw Error('无效的 HEIC 缓存目录');
  const destination=path.join(cache,hash+'.png');
  const saved=cachedInfo(destination);if(saved)return {ok:true,path:destination,width:saved.width,height:saved.height,cached:true};
  const heif=await require('libheif-js/wasm-bundle');
  const images=new heif.HeifDecoder().decode(buffer);
  if(!images.length)throw Error('HEIC 图片无法解码');
  try {
    const image=images.find(item=>item.is_primary())||images[0];
    const width=image.get_width(),height=image.get_height();checkDimensions(width,height);
    const rgba=await new Promise((resolve,reject)=>image.display({width,height,data:new Uint8ClampedArray(width*height*4)},result=>result?resolve(result.data):reject(Error('HEIC 图片无法解码'))));
    const {PNG}=require('pngjs');
    const png=PNG.sync.write({width,height,data:Buffer.from(rgba.buffer,rgba.byteOffset,rgba.byteLength)},{colorType:6,deflateLevel:3});
    if(inboxBytes(inbox)+png.length>MAX_INBOX)throw Error('收件箱空间不足，请清理后预览 HEIC 图片');
    fs.mkdirSync(cache,{recursive:true});
    const temporary=destination+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';
    try {fs.writeFileSync(temporary,png,{flag:'wx'});try{fs.renameSync(temporary,destination);}catch(error){if(!cachedInfo(destination))throw error;}}finally{try{fs.unlinkSync(temporary);}catch{}}
    return {ok:true,path:destination,width,height,cached:false};
  } finally {for(const image of images)image.free();}
}
module.exports={ensureHeicPng,checkDimensions};
if(require.main===module){let body='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{body+=chunk;if(body.length>65536)process.exit(1);});process.stdin.on('end',async()=>{try{process.stdout.write(JSON.stringify(await ensureHeicPng(JSON.parse(body)))+'\n');}catch{process.stdout.write(JSON.stringify({ok:false,error:'HEIC 图片无法转换，请确认文件完整或收件箱空间充足'})+'\n');process.exitCode=1;}});}
