'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const MAX_FILE = 50 * 1024 * 1024;
const MAX_BATCH = 100 * 1024 * 1024;
const MAX_TEXT = 1024 * 1024;
const TEXT_PREVIEW = 4000;
const MAX_STORAGE = 1024 * 1024 * 1024;
const statusError = (message, status = 400) => Object.assign(Error(message), { status });
function settings(dataRoot) {
  try { return JSON.parse(fs.readFileSync(path.join(dataRoot, 'preferences.json'), 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { return error.code === 'ENOENT' ? { receiveEnabled:true, clipboardEnabled:false } : { receiveEnabled:false, clipboardEnabled:false }; }
}
function safeName(value, index) {
  let name = String(value || `file-${index + 1}`).normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/[. ]+$/g, '').slice(0, 120).replace(/[. ]+$/g, '');
  if (!name || name === '.' || name === '..') name = `file-${index + 1}`;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name;
}
class ClipboardBridge {
  constructor(root, dataRoot, diagnostics = false) { this.root=root; this.dataRoot=dataRoot; this.diagnostics=diagnostics; this.pending=new Map(); this.child=null; this.starting=null; this.closed=false; }
  async start() {
    if (this.closed) throw statusError('接收程序已关闭', 503);
    if (this.child && !this.child.killed && this.child.exitCode === null && !this.starting) return;
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      const child = spawn(path.join(this.root, 'ClipboardWorker.exe'), this.diagnostics ? ['--diagnostics'] : [], { cwd:this.root, env:{...process.env,PHONE_NOTIFY_DATA_DIR:this.dataRoot}, windowsHide:true, stdio:['pipe','pipe','ignore'] });
      this.child=child;
      const timer=setTimeout(()=>{ child.kill(); reject(statusError('剪贴板进程启动超时',503)); },5000);
      child.stdin.on('error',()=>{});
      readline.createInterface({input:child.stdout}).on('line', line=>{
        let reply; try { reply=JSON.parse(line); } catch { return; }
        if (reply.op==='ready') { clearTimeout(timer); resolve(); return; }
        const waiting=this.pending.get(reply.id);
        if (waiting) { this.pending.delete(reply.id); clearTimeout(waiting.timer); reply.ok ? waiting.resolve(reply) : waiting.reject(statusError(reply.error+(this.diagnostics?' ['+waiting.kind+': '+reply.diagnostic+']':''),503)); }
      });
      const failed=()=>{clearTimeout(timer);reject(statusError('剪贴板进程不可用',503));if(this.child!==child)return;for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(statusError('剪贴板进程退出，请重新发送',503));}this.pending.clear();this.child=null;};
      child.once('error',failed); child.once('exit',failed);
    }).finally(()=>{this.starting=null;});
    return this.starting;
  }
  async call(message) {
    await this.start();
    if(this.pending.size>=8) throw statusError('剪贴板忙，请稍后重试',429);
    const id=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        const error=statusError('剪贴板写入超时，请重试',503);
        for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(error);}this.pending.clear();
        const child=this.child;this.child=null;if(child)child.kill();
      },message.kind==='image'||message.kind==='restore'?15000:5000);
      this.pending.set(id,{resolve,reject,timer,kind:message.kind});
      this.child.stdin.write(Buffer.from(JSON.stringify({...message,id})).toString('base64')+'\n', error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(statusError('剪贴板进程不可用',503));}});
    });
  }
  close() { this.closed=true; if(this.child){const child=this.child;child.stdin.end();const timer=setTimeout(()=>{if(child.exitCode===null)child.kill();},1500);timer.unref();} }
}
class ClipboardTransfer {
  constructor({root,dataRoot,bridge,now=Date.now}) {
    this.root=root;this.dataRoot=dataRoot;this.now=now;this.bridge=bridge||new ClipboardBridge(root,dataRoot);this.sessions=new Map();this.receipts=[];this.reserved=0;this.closed=false;
    this.inbox=path.join(dataRoot,'inbox');this.staging=path.join(dataRoot,'.incoming');this.textRoot=path.join(dataRoot,'clipboard-text');
    fs.mkdirSync(this.inbox,{recursive:true});fs.mkdirSync(this.staging,{recursive:true});fs.mkdirSync(this.textRoot,{recursive:true});
    try { const history=JSON.parse(fs.readFileSync(path.join(dataRoot,'clipboard-receipts.json'),'utf8'));if(Array.isArray(history))this.receipts=history.filter(item=>item&&/^[a-f0-9]{32}$/.test(item.id)&&['text','image','files'].includes(item.kind)&&Array.isArray(item.files)&&item.files.every(file=>typeof file==='string')&&Number.isFinite(Date.parse(item.at))).slice(0,50); } catch {}
    this.used=0;
    for(const entry of fs.readdirSync(this.inbox,{withFileTypes:true})) {
      if(entry.isDirectory()&&!entry.isSymbolicLink()&&/^[a-f0-9]{32}$/.test(entry.name))for(const file of fs.readdirSync(path.join(this.inbox,entry.name),{withFileTypes:true}))if(file.isFile())this.used+=fs.statSync(path.join(this.inbox,entry.name,file.name)).size;
    }
    this.timer=setInterval(()=>this.expire(),30000);this.timer.unref();
  }
  cleanupStaging() {
    // Call only after owning the listening port; duplicate launches must not touch active uploads.
    for(const entry of fs.readdirSync(this.staging,{withFileTypes:true}))if(entry.isDirectory()&&!entry.isSymbolicLink()&&/^[a-f0-9]{32}$/.test(entry.name))fs.rmSync(path.join(this.staging,entry.name),{recursive:true,force:true});
    this.cleanupText();
  }
  cleanupText() {
    const retained=new Set(this.receipts.filter(item=>item.kind==='text'&&item.textTruncated===true).map(item=>item.id+'.txt'));
    for(const entry of fs.readdirSync(this.textRoot,{withFileTypes:true}))if(entry.isFile()&&/^[a-f0-9]{32}\.txt$/.test(entry.name)&&!retained.has(entry.name))fs.unlinkSync(path.join(this.textRoot,entry.name));
  }
  enabled() { return !this.closed && settings(this.dataRoot).clipboardEnabled === true; }
  check() { if(!this.enabled())throw statusError('电脑未开启“接收手机剪贴板”',403); }
  status() {return {enabled:this.enabled(),history:this.receipts,inbox:this.inbox,maxFileBytes:MAX_FILE,maxBatchBytes:MAX_BATCH,maxTextBytes:MAX_TEXT,maxFiles:20};}
  storageBytes() {
    let bytes=0;
    for(const entry of fs.readdirSync(this.inbox,{withFileTypes:true}))if(entry.isDirectory()&&!entry.isSymbolicLink()&&/^[a-f0-9]{32}$/.test(entry.name))for(const file of fs.readdirSync(path.join(this.inbox,entry.name),{withFileTypes:true}))if(file.isFile())bytes+=fs.statSync(path.join(this.inbox,entry.name,file.name)).size;
    return bytes;
  }
  record(item) {this.receipts.unshift({...item,at:new Date(this.now()).toISOString()});this.receipts.length=Math.min(this.receipts.length,50);fs.writeFileSync(path.join(this.dataRoot,'clipboard-receipts.json.tmp'),JSON.stringify(this.receipts));fs.renameSync(path.join(this.dataRoot,'clipboard-receipts.json.tmp'),path.join(this.dataRoot,'clipboard-receipts.json'));this.cleanupText();}
  expire() {for(const [id,session] of this.sessions)if(session.expires<this.now()&&!session.uploading&&!session.committing){this.sessions.delete(id);if(!session.moved){this.reserved-=session.total;fs.rmSync(path.join(this.staging,id),{recursive:true,force:true});}}}
  async command(input) {
    this.check();this.expire();
    if(!input||typeof input!=='object')throw statusError('剪贴板请求格式错误');
    if(input.kind==='text') {
      if(typeof input.text!=='string'||!input.text.length||input.text.includes('\0')||Buffer.byteLength(input.text)>MAX_TEXT)throw statusError('文字为空、包含无效字符或超过 1 MiB');
      await this.bridge.call({kind:'text',text:input.text});
      const id=crypto.randomBytes(16).toString('hex');
      let text=input.text.slice(0,TEXT_PREVIEW);if(/[\uD800-\uDBFF]$/.test(text))text=text.slice(0,-1);
      const textTruncated=text.length<input.text.length;
      if(textTruncated)fs.writeFileSync(path.join(this.textRoot,id+'.txt'),input.text,'utf8');
      this.record({id,kind:'text',bytes:Buffer.byteLength(input.text),files:[],text,textTruncated});
      return {ok:true,id,copied:true,kind:'text'};
    }
    if(input.op==='begin') {
      if(!['image','files'].includes(input.kind)||!Array.isArray(input.files)||input.files.length<1||input.files.length>20||(input.kind==='image'&&input.files.length!==1))throw statusError('文件类型或数量无效');
      if([...this.sessions.values()].filter(session=>!session.committed).length>=8)throw statusError('等待中的发送任务过多，请稍后重试',429);
      const names=new Set();
      const files=input.files.map((file,index)=>{
        if(!file||!Number.isSafeInteger(file.size)||file.size<0||file.size>MAX_FILE)throw statusError('每个文件最多 50 MiB',413);
        const original=safeName(file.name,index);let name=original,suffix=2;while(names.has(name.toLowerCase()))name=`${suffix++}-`+original;names.add(name.toLowerCase());
        return {name,size:file.size,ready:false};
      });
      const total=files.reduce((sum,file)=>sum+file.size,0);
      if(total>MAX_BATCH)throw statusError('一次发送合计最多 100 MiB',413);
      if(this.used+this.reserved+total>MAX_STORAGE){this.used=this.storageBytes();if(this.used+this.reserved+total>MAX_STORAGE)throw statusError('收件箱已达到 1 GiB，请在电脑清理后重试',507);}
      const id=crypto.randomBytes(16).toString('hex');fs.mkdirSync(path.join(this.staging,id));
      this.sessions.set(id,{id,kind:input.kind,files,total,expires:this.now()+10*60000,uploading:0,committed:false});this.reserved+=total;
      return {ok:true,id,files:files.map(file=>({name:file.name,size:file.size}))};
    }
    if(input.op==='commit') {
      const session=this.sessions.get(input.id);
      if(!session)throw statusError('上传任务不存在或已过期',404);
      if(session.committed)return {ok:true,id:session.id,copied:true,kind:session.kind};
      if(session.committing||session.uploading||session.files.some(file=>!file.ready))throw statusError('文件尚未上传完成',409);
      session.committing=true;
      try {
        this.check();
        const directory=path.join(this.inbox,session.id);
        if(!session.moved){fs.renameSync(path.join(this.staging,session.id),directory);session.moved=true;this.reserved-=session.total;this.used+=session.total;}
        const files=session.files.map(file=>path.join(directory,file.name));
        if(session.kind==='image') {
          const file=fs.openSync(files[0],'r');
          try {
            const header=Buffer.alloc(Math.min(65536,session.files[0].size));fs.readSync(file,header);
            const dimensions=require('./app-icon-cache.cjs').imageInfo(header);
            if(dimensions.width>16384||dimensions.height>16384||dimensions.width*dimensions.height>40000000)throw statusError('图片尺寸过大');
          }catch(error){throw statusError(error.status?error.message:'不支持的图片格式，请转为 PNG 或 JPEG 后重试');}finally{fs.closeSync(file);}
        }
        await this.bridge.call({kind:session.kind,files});
        session.committed=true;session.expires=this.now()+10*60000;
        if(this.sessions.size>128)for(const [id,older] of this.sessions){if(this.sessions.size<=128)break;if(older.committed&&id!==session.id)this.sessions.delete(id);}
        this.record({id:session.id,kind:session.kind,bytes:session.total,files:session.files.map(file=>file.name)});
        return {ok:true,id:session.id,copied:true,kind:session.kind,files:session.files.map(file=>file.name)};
      }finally{session.committing=false;}
    }
    throw statusError('不支持的剪贴板操作');
  }
  async upload(request, id, index) {
    this.check();this.expire();
    const session=this.sessions.get(id);
    if(!session||!Number.isInteger(index)||!session.files[index])throw statusError('上传任务不存在',404);
    const file=session.files[index];
    if(session.committed||session.moved||file.ready||file.uploading)throw statusError('文件已上传或正在处理',409);
    if(session.uploading>=2)throw statusError('同时上传的文件过多',429);
    const declared=Number(request.headers['content-length']);if(request.headers['content-length']!==undefined&&declared!==file.size)throw statusError('文件长度不匹配',400);
    const target=path.join(this.staging,id,file.name);let bytes=0;
    const limiter=new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;if(bytes>file.size)callback(statusError('文件超过声明长度',413));else callback(null,chunk);}});
    file.uploading=true;session.uploading++;
    try {
      await pipeline(request,limiter,fs.createWriteStream(target,{flags:'wx'}));
      if(bytes!==file.size)throw statusError('文件上传不完整',400);
      this.check();file.ready=true;session.expires=this.now()+10*60000;
      return {ok:true,bytes};
    } catch(error) {try{fs.unlinkSync(target);}catch{}throw error;}
    finally {file.uploading=false;session.uploading--;}
  }
  close() {this.closed=true;clearInterval(this.timer);this.bridge.close();}
}
module.exports={ClipboardTransfer,ClipboardBridge,settings,safeName,MAX_FILE,MAX_BATCH,MAX_TEXT,TEXT_PREVIEW};
