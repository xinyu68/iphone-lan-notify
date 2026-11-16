function buildScriptableScript(endpoint) {
  return `const ENDPOINT = ${JSON.stringify(endpoint)};\nawait (${forwardNotification.toString()})(ENDPOINT);\n`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildScriptableScript };
}

async function forwardNotification(endpoint) {
  const input = args.shortcutParameter;
  const manual = typeof config !== 'undefined' && config.runsInApp === true
    && !config.runsWithSiri && !config.runsInActionExtension && input == null;
  let status = 'skipped';
  const host = (endpoint.match(/^https?:\/\/([^/]+)/) || [])[1] || '当前电脑';
  const safeError = value => String(value || '').split(endpoint).join('当前接收地址')
    .split(endpoint.split('/').pop()).join('[配对令牌]').slice(0, 240);
  const show = async (title, message) => {
    const alert = new Alert(); alert.title = title; alert.message = message;
    alert.addAction('好'); await alert.presentAlert();
  };
  try {
    let payload;
    if (manual) {
      const menu = new Alert();
      menu.title = '通知同步测试';
      menu.message = '向 ' + host + ' 发送一条测试通知，检查 Scriptable 到电脑的连接。正常自动转发不会显示此窗口。';
      menu.addAction('发送测试通知'); menu.addCancelAction('取消');
      if (await menu.presentAlert() !== 0) return;
      payload = {};
    } else {
      const text = value => typeof value === 'string' ? value.trim() : '';
      payload = typeof input === 'string' ? { message: text(input) }
        : { message: text(input && input.message), appId: text(input && input.appId), appName: text(input && input.appName) };
      if (!payload.message) return;
    }
    const request = new Request(manual ? endpoint.replace(/\/notify\/([^/?#]+)$/, '/test/$1') : endpoint);
    request.method = 'POST';
    request.headers = { 'Content-Type': 'application/json' };
    request.body = JSON.stringify(payload);
    request.timeoutInterval = manual ? 10 : 2;
    let reply;
    if (manual) {
      const response = await request.loadString();
      const code = request.response ? request.response.statusCode : 0;
      try { reply = JSON.parse(response); } catch (_) { }
      if (code >= 200 && code < 300 && reply && reply.ok === true) {
        status = 'sent';
        await show('电脑已接收测试通知', '请查看电脑的通知卡片和「通知记录」。请求已被接收，不代表 Windows 已完成显示。');
      } else {
        const reason = code === 404 ? '接收地址或配对令牌不匹配，请从这台电脑重新复制脚本。'
          : code === 403 && reply && reply.error === '通知接收已关闭' ? '请在电脑应用开启「接收手机通知」。'
          : reply && typeof reply.error === 'string' ? safeError(reply.error)
          : '电脑返回了无法识别的结果，请核对接收地址和程序状态。';
        await show('测试未成功', 'HTTP ' + code + '\n' + reason);
      }
    } else {
      reply = await request.loadJSON();
      const code = request.response ? request.response.statusCode : 0;
      if (code >= 200 && code < 300 && reply && reply.ok === true) status = 'sent';
    }
  } catch (error) {
    status = 'skipped';
    if (manual) await show('未确认电脑收到测试通知', safeError(error && error.message || error)
      + '\n请检查 Wi-Fi、电脑接收状态，以及 iPhone 设置中 Scriptable 的本地网络权限。若电脑已有这条记录，请以电脑记录为准。');
  } finally {
    Script.setShortcutOutput(status);
    Script.complete();
  }
}
