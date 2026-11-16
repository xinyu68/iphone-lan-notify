async function sendClipboardToComputer(endpoint) {
  let status = 'failed';
  try {
    const limit = 50 * 1024 * 1024;
    const input = args.shortcutParameter;
    const files = [];
    let kind = 'files';
    let text = null;
    const dataSize = data => {
      const encoded = data.toBase64String();
      return encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
    };
    const addData = (name, data) => {
      if (!data) throw Error('无法读取分享的文件或图片');
      const size = dataSize(data);
      if (size > limit) throw Error('每个文件最多 50 MiB，请分开发送');
      files.push({ name, size, data });
    };
    const addFile = url => {
      const filename = String(url).startsWith('file://') ? decodeURIComponent(String(url).replace(/^file:\/\//, '')) : String(url);
      addData(filename.split('/').pop() || 'file', Data.fromFile(filename));
    };
    if (input && typeof input === 'object' && input.kind === 'text') text = input.text;
    else if (input && typeof input === 'object' && ['image','files'].includes(input.kind) && Array.isArray(input.files)) {
      kind = input.kind;
      for (const file of input.files) addData(file.name || 'file', Data.fromBase64String(file.base64));
    } else if ((args.fileURLs || []).length) {
      for (const url of args.fileURLs) addFile(url);
    } else if ((args.images || []).length) {
      kind = args.images.length === 1 ? 'image' : 'files';
      for (let i = 0; i < args.images.length; i++) addData('image-' + (i + 1) + '.png', Data.fromPNG(args.images[i]));
    } else if (typeof input === 'string' && input.length) text = input;
    else if ((args.plainTexts || []).length || (args.urls || []).length) text = [...(args.plainTexts || []), ...(args.urls || [])].join('\n');
    else {
      let image = null;
      try { image = Pasteboard.pasteImage(); } catch (_) {}
      if (image) { kind = 'image'; addData('image.png', Data.fromPNG(image)); }
      else text = Pasteboard.pasteString();
    }
    const command = async payload => {
      const request = new Request(endpoint);
      request.method = 'POST'; request.headers = { 'Content-Type':'application/json' };
      request.body = JSON.stringify(payload); request.timeoutInterval = payload.op === 'commit' ? 30 : 10;
      const reply = await request.loadJSON();
      if (!request.response || request.response.statusCode < 200 || request.response.statusCode >= 300 || !reply.ok) throw Error(reply.error || '电脑未能接收，请检查局域网连接和接收开关');
      return reply;
    };
    if (text !== null && text !== undefined) {
      if (typeof text !== 'string' || text.length === 0) throw Error('未读取到文字。请先在快捷指令中添加「获取剪贴板」，将结果传给「运行脚本」的参数');
      await command({ kind:'text', text });
    } else {
      if (!files.length) throw Error('未读取到内容。请先在快捷指令中添加「获取剪贴板」，将结果传给「运行脚本」的参数；文件请从分享菜单发送');
      if (files.length > 20 || files.reduce((sum,file) => sum + file.size, 0) > 100 * 1024 * 1024) throw Error('一次最多 20 个文件，合计最多 100 MiB');
      const batch = await command({ op:'begin', kind, files:files.map(file => ({name:file.name,size:file.size})) });
      for (let index = 0; index < files.length; index++) {
        const request = new Request(endpoint.replace('/clipboard/', '/clipboard-upload/') + '?id=' + encodeURIComponent(batch.id) + '&index=' + index);
        request.method = 'PUT'; request.headers = {'Content-Type':'application/octet-stream'};
        request.body = files[index].data; request.timeoutInterval = 120;
        const reply = await request.loadJSON();
        if (!request.response || request.response.statusCode < 200 || request.response.statusCode >= 300 || !reply.ok) throw Error(reply.error || '文件上传失败，请重新发送');
      }
      await command({ op:'commit', id:batch.id });
    }
    status = 'sent';
  } catch (error) {
    const notification = new Notification();
    notification.title = '发送到电脑失败';
    notification.body = error && error.message ? String(error.message) : '请确认电脑接收已开启，并且手机与电脑在同一局域网';
    try { await notification.schedule(); } catch (_) {}
  }
  Script.setShortcutOutput(status);
  Script.complete();
}
function buildClipboardScript(endpoint) {
  return '// 发送到电脑：文字、图片和分享的文件。\n// 在 Scriptable 脚本设置中允许 Text、URLs、Images、File URLs 分享输入。\nawait (' + sendClipboardToComputer.toString() + ')(' + JSON.stringify(endpoint) + ');\n';
}
if (typeof module !== 'undefined' && module.exports) module.exports = { buildClipboardScript };
