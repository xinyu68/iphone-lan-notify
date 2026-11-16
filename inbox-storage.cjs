'use strict';
const fs=require('node:fs');
const path=require('node:path');
function inboxBytes(root) {
  let bytes=0;
  for(const entry of fs.readdirSync(root,{withFileTypes:true})) {
    if(!entry.isDirectory()||entry.isSymbolicLink()||!/^[a-f0-9]{32}$/.test(entry.name))continue;
    const directory=path.join(root,entry.name);
    for(const item of fs.readdirSync(directory,{withFileTypes:true})) {
      if(item.isFile())bytes+=fs.statSync(path.join(directory,item.name)).size;
      else if(item.name==='.heic-cache'&&item.isDirectory()&&!item.isSymbolicLink())for(const image of fs.readdirSync(path.join(directory,item.name),{withFileTypes:true}))if(image.isFile())bytes+=fs.statSync(path.join(directory,item.name,image.name)).size;
    }
  }
  return bytes;
}
module.exports={inboxBytes};
