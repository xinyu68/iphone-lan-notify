'use strict';
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {buildClipboardScript}=require('./public/clipboard-sender.js');
const endpoint='http://127.0.0.1:18766/clipboard/test-only-pairing-token-not-a-real-secret';
async function run({input,images=[],fileURLs=[],plainTexts=[],urls=[],clipboardText=null,clipboardImage=null,failure=false,denyClipboard=false,fileReadFailure=false}){
  const calls=[];const notifications=[];const fileReads=[];let completed=0,output;
  class DataValue{constructor(bytes){this.bytes=Buffer.from(bytes);}toBase64String(){return this.bytes.toString('base64');}}
  class Request{constructor(url){this.url=url;}async loadJSON(){calls.push(this);if(failure)throw Error('offline');this.response={statusCode:200};return {ok:true,id:'1'.repeat(32),copied:true};}}
  const args={shortcutParameter:input,images,fileURLs,plainTexts,urls};
  const paste=value=>{if(denyClipboard)throw Error('Direct pasteboard access unavailable');return value;};
  const context=vm.createContext({args,Request,Data:{fromPNG:image=>new DataValue(image),fromBase64String:value=>new DataValue(Buffer.from(value,'base64')),fromFile:filename=>{fileReads.push(filename);return fileReadFailure?null:new DataValue('bytes of '+filename);}},Pasteboard:{pasteString:()=>paste(clipboardText),pasteImage:()=>paste(clipboardImage)},Notification:class{async schedule(){notifications.push(this);}},Script:{setShortcutOutput:value=>{output=value;},complete:()=>{completed++;}}});
  await new vm.Script('(async()=>{'+buildClipboardScript(endpoint)+'})()').runInContext(context);
  assert.equal(completed,1);return{calls,notifications,output,fileReads};
}
(async()=>{
  const text='中文 📋\n空格  与链接 https://example.com';const first=await run({clipboardText:text});assert.equal(first.output,'sent');assert.equal(JSON.parse(first.calls[0].body).text,text);assert.equal(first.notifications.length,0);
  const parameter=await run({input:text,denyClipboard:true});assert.equal(parameter.output,'sent');assert.equal(JSON.parse(parameter.calls[0].body).text,text);assert.equal(parameter.notifications.length,0);
  const argumentText=await run({plainTexts:[text],denyClipboard:true});assert.equal(argumentText.output,'sent');assert.equal(JSON.parse(argumentText.calls[0].body).text,text);
  const picture=await run({clipboardImage:Buffer.from([137,80,78,71])});assert.equal(picture.output,'sent');assert.equal(JSON.parse(picture.calls[0].body).kind,'image');assert.equal(picture.calls[1].method,'PUT');assert(picture.calls[1].body.bytes.equals(Buffer.from([137,80,78,71])));assert.equal(JSON.parse(picture.calls[2].body).op,'commit');
  const files=await run({fileURLs:['file:///tmp/a%20b.pdf','/tmp/中文.txt']});assert.equal(files.output,'sent');assert.equal(JSON.parse(files.calls[0].body).files[0].name,'a b.pdf');assert.equal(files.calls.length,4);
  const fileURL='file:///.nofollow/private/var/mobile/tmp/com.apple.WorkflowKit.BackgroundShortcutRunner/com.apple.WorkflowKit.BackgroundShortcutRunner/Clipboard%202026%E5%B9%B411%E6%9C%8816%E6%97%A5%2012.18.png';
  const shortcutFile=await run({input:fileURL,denyClipboard:true});assert.equal(shortcutFile.output,'sent');assert.equal(JSON.parse(shortcutFile.calls[0].body).op,'begin');assert.equal(JSON.parse(shortcutFile.calls[0].body).kind,'image');assert.equal(shortcutFile.fileReads[0],decodeURIComponent(fileURL.slice('file://'.length)));assert.equal(JSON.parse(shortcutFile.calls[0].body).files[0].name,'Clipboard 2026年11月16日 12.18.png');assert.equal(shortcutFile.calls[1].method,'PUT');assert(shortcutFile.calls[1].body.bytes.equals(Buffer.from('bytes of '+shortcutFile.fileReads[0])));
  const jpegFile=await run({fileURLs:['file:///tmp/photo.JPG']});assert.equal(JSON.parse(jpegFile.calls[0].body).kind,'image');
  const parameterFiles=await run({input:['file:///tmp/a.pdf','file:///tmp/b.pdf']});assert.equal(JSON.parse(parameterFiles.calls[0].body).kind,'files');assert.equal(parameterFiles.fileReads.length,2);
  const urlArgument=await run({urls:[fileURL]});assert.equal(JSON.parse(urlArgument.calls[0].body).kind,'image');
  const missingFile=await run({input:fileURL,fileReadFailure:true});assert.equal(missingFile.output,'failed');assert.equal(missingFile.calls.length,0);assert.match(missingFile.notifications[0].body,/临时文件/);
  const remoteFile=await run({input:'file://other-computer/tmp/photo.png'});assert.equal(remoteFile.output,'failed');assert.equal(remoteFile.fileReads.length,0);
  const literal=await run({input:{kind:'text',text:fileURL}});assert.equal(JSON.parse(literal.calls[0].body).kind,'text');assert.equal(literal.fileReads.length,0);
  const passedImage=await run({images:[Buffer.from('shortcut image')],denyClipboard:true});assert.equal(passedImage.output,'sent');assert.equal(JSON.parse(passedImage.calls[0].body).kind,'image');assert.equal(passedImage.notifications.length,0);
  const multiple=await run({images:[Buffer.from('one'),Buffer.from('two')]});assert.equal(JSON.parse(multiple.calls[0].body).kind,'files');
  const explicit=await run({input:{kind:'files',files:[{name:'file.bin',base64:Buffer.from([0,255]).toString('base64')}]}});assert.equal(explicit.output,'sent');
  const shared=await run({urls:['https://example.com']});assert.equal(JSON.parse(shared.calls[0].body).text,'https://example.com');
  const empty=await run({});assert.equal(empty.output,'failed');assert.equal(empty.calls.length,0);assert.equal(empty.notifications.length,1);assert.match(empty.notifications[0].body,/获取剪贴板/);
  const offline=await run({clipboardText:'test',failure:true});assert.equal(offline.output,'failed');assert.equal(offline.notifications.length,1);
  console.log('PASS: shortcut text/image and file-URL parameters, preserved nofollow paths, decoded Unicode names, PNG/JPEG image uploads, multi-file inputs, unreadable/remote-file failures, literal text, empty-input guidance and offline failure');
})().catch(error=>{console.error(error);process.exitCode=1;});
