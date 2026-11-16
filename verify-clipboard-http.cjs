'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {ClipboardBridge}=require('./clipboard-transfer.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'phone-clipboard-http-'));
  const probe=new ClipboardBridge(__dirname,data,true);let captured=false,child;
  const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  const token=crypto.randomBytes(24).toString('base64url');const origin=`http://127.0.0.1:${port}`;
  const settings=(clipboardEnabled,receiveEnabled=false)=>fs.writeFileSync(path.join(data,'preferences.json'),JSON.stringify({clipboardEnabled,receiveEnabled}));
  fs.writeFileSync(path.join(data,'config.json'),JSON.stringify({host:'127.0.0.1',port,token,nodePath:process.execPath}));settings(false);
  async function request(route,payload,options={}){
    const response=await fetch(`${origin}/${route}/${options.token||token}${options.query||''}`,{method:options.method||'POST',headers:{'Content-Type':options.binary?'application/octet-stream':'application/json',...(options.origin?{Origin:options.origin}:{})},body:options.binary?payload:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});
    return{status:response.status,body:await response.json()};
  }
  try{
    await probe.call({kind:'snapshot'});captured=true;
    child=spawn(process.execPath,[path.join(__dirname,'receiver.cjs')],{cwd:__dirname,env:{...process.env,PHONE_NOTIFY_DATA_DIR:data},windowsHide:true,stdio:'ignore'});
    for(let i=0;i<120;i++){try{if((await(await fetch(origin+'/health')).json()).worker==='ready')break;}catch{}await delay(100);}
    assert.equal((await request('clipboard',{kind:'text',text:'blocked'})).status,403);
    settings(true);
    assert.equal((await request('clipboard',{kind:'text',text:'wrong'},{token:'wrong'})).status,404);
    assert.equal((await request('clipboard',{kind:'text',text:'origin'},{origin:'https://example.invalid'})).status,403);
    const text='HTTP clipboard 中文 📋\n原样保留空格  https://example.com';assert.equal((await request('clipboard',{kind:'text',text})).body.copied,true);assert.equal((await probe.call({kind:'inspect'})).text,text);
    const image=fs.readFileSync(path.join(__dirname,'assets','app-icon.png'));
    const batch=(await request('clipboard',{op:'begin',kind:'image',files:[{name:'图片.png',size:image.length}]})).body;
    assert.equal((await request('clipboard-upload',image,{binary:true,method:'PUT',query:`?id=${batch.id}&index=0`})).body.bytes,image.length);
    assert.equal((await request('clipboard',{op:'commit',id:batch.id})).body.copied,true);assert.equal((await probe.call({kind:'inspect'})).image,true);
    const bytes=[Buffer.from('文档原始内容'),Buffer.from([0,255,128,1])];const names=['报告.txt','data.bin'];
    const files=(await request('clipboard',{op:'begin',kind:'files',files:names.map((name,index)=>({name,size:bytes[index].length}))})).body;
    for(let index=0;index<2;index++)assert.equal((await request('clipboard-upload',bytes[index],{binary:true,method:'PUT',query:`?id=${files.id}&index=${index}`})).status,200);
    assert.equal((await request('clipboard',{op:'commit',id:files.id})).body.copied,true);
    const actual=await probe.call({kind:'inspect'});assert.equal(actual.files.length,2);for(let index=0;index<2;index++)assert.deepEqual(fs.readFileSync(actual.files[index]),bytes[index]);
    assert.equal((await request('notify',{message:'notification is disabled'})).status,403);
    settings(false);assert.equal((await request('clipboard',{kind:'text',text:'after disable'})).status,403);assert.deepEqual((await probe.call({kind:'inspect'})).files,actual.files);
    for(const file of ['receiver.log','runtime.json','clipboard-receipts.json'])assert(!fs.readFileSync(path.join(data,file),'utf8').includes(text));
    await request('stop');await delay(2200);assert(child.exitCode!==null,'all receiver workers stop');
    console.log('PASS: real authenticated HTTP text/image/multi-file to Windows clipboard, byte integrity, independent notification/clipboard switches, origin/token rejection, switch-off preserves clipboard, no text logs and clean shutdown');
  }finally{
    if(child&&child.exitCode===null){child.kill();await delay(1500);}
    try{if(captured)await probe.call({kind:'restore'});}finally{probe.close();}await delay(1800);
    assert.equal(path.dirname(fs.realpathSync(data)),fs.realpathSync(os.tmpdir()));fs.rmSync(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
