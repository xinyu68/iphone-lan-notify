const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { buildScriptableScript } = require('./public/app.js');
const config = process.argv.includes('--live') ? require('./runtime-paths.cjs').loadConfig().config : { host:'127.0.0.1', port:18766, token:'test-only-token-not-a-real-pairing-secret' };
const endpoint = `http://${config.host}:${config.port}/notify/${config.token}`;
const code = buildScriptableScript(endpoint);

async function run(input, mode, options = {}) {
  const result = { requests: 0, completed: 0, output: null, alerts:[] };
  class MockRequest {
    constructor(url) { this.url = url; }
    async loadString() {
      result.requests++;
      assert.equal(this.url, options.manual ? endpoint.replace('/notify/','/test/') : endpoint);
      assert.equal(this.method, 'POST');
      assert.equal(this.timeoutInterval, options.manual ? 10 : 2);
      assert.equal(this.headers['Content-Type'], 'application/json');
      const payload = JSON.parse(this.body);
      if (options.manual) assert.deepEqual(payload,{});
      else assert.equal(payload.message, typeof input === 'string' ? input.trim() : input.message.trim());
      if (input && typeof input === 'object') {
        assert.equal(payload.appId, input.appId || '');
        assert.equal(payload.appName, input.appName || '');
      }
      if (mode === 'timeout') throw new Error('The request timed out');
      if (mode === 'unreachable') throw new Error('Could not connect to the server');
      if (mode === 'private-error') throw new Error('Could not connect to '+endpoint);
      if (mode === 'live') {
        const response = await fetch(this.url, { method: this.method, headers: this.headers, body: this.body, signal: AbortSignal.timeout(5000) });
        this.response = { statusCode: response.status };
        return response.text();
      }
      this.response = { statusCode: mode === 'http-error' ? 503 : mode === 'bad-token' ? 404 : mode === 'disabled' ? 403 : 200 };
      if (mode === 'invalid-json') return '<html>Unexpected response</html>';
      return JSON.stringify({ ok: !['http-error','server-rejected','bad-token','disabled'].includes(mode), ...(mode==='disabled'?{error:'通知接收已关闭'}:{}) });
    }
    async loadJSON() { return JSON.parse(await this.loadString()); }
  }
  class MockAlert {
    constructor(){this.actions=[];}
    addAction(value){this.actions.push(value);}
    addCancelAction(value){this.cancel=value;}
    async presentAlert(){result.alerts.push({title:this.title,message:this.message,actions:this.actions});return options.cancel&&this.cancel?-1:0;}
  }
  const context = vm.createContext({ args: { shortcutParameter: input }, config:options.manual ? {runsInApp:true} : options.context, Alert:MockAlert, Request: MockRequest, Script: {
    setShortcutOutput(value) { result.output = value; },
    complete() { result.completed++; },
  } });
  await new vm.Script(`(async () => { ${code}\n })()`).runInContext(context);
  assert.equal(result.completed, 1, `${mode}: Script.complete must run exactly once`);
  if (!options.manual) assert.equal(result.alerts.length,0,'Automatic forwarding must never show UI');
  return result;
}

(async () => {
  const message = '脚本验证 📱\n中文与特殊字符 <>&';
  assert.equal((await run(message, 'success')).output, 'sent');
  const sourcedInput = { message, appId: 'com.tencent.xin', appName: '' };
  assert.equal((await run(sourcedInput, 'success')).output, 'sent');
  assert.equal((await run(sourcedInput, 'timeout')).output, 'skipped');
  for (const mode of ['timeout', 'unreachable', 'invalid-json', 'http-error', 'server-rejected']) {
    assert.equal((await run(message, mode)).output, 'skipped', mode);
  }
  for (const input of [undefined, null, '', '   ', { unexpected: true }]) {
    const result = await run(input, 'empty');
    assert.equal(result.output, 'skipped');
    assert.equal(result.requests, 0);
  }
  const manual = await run(undefined,'success',{manual:true});
  assert.equal(manual.output,'sent');assert.equal(manual.requests,1);assert.equal(manual.alerts.length,2);
  assert.match(manual.alerts[1].title,/已接收/);assert.match(manual.alerts[1].message,/不代表 Windows/);
  const cancelled=await run(undefined,'success',{manual:true,cancel:true});assert.equal(cancelled.requests,0);assert.equal(cancelled.output,'skipped');
  for(const mode of ['timeout','unreachable','invalid-json','http-error','server-rejected','bad-token','disabled','private-error']){
    const result=await run(undefined,mode,{manual:true});assert.equal(result.output,'skipped');assert.equal(result.alerts.length,2);
    const message=result.alerts[1].message;
    assert(!message.includes(config.token),'Diagnostics must not expose the pairing token');
    if(mode==='bad-token')assert.match(message,/404.*\n.*令牌/);
    if(mode==='disabled')assert.match(message,/403.*\n.*开启/);
    if(mode==='timeout')assert.match(message,/本地网络权限/);
  }
  for(const context of [{runsInApp:false},{runsInApp:true,runsWithSiri:true},{runsInApp:true,runsInActionExtension:true}]){
    const empty=await run(undefined,'empty',{context});assert.equal(empty.requests,0);
  }
  assert.equal((await run(sourcedInput,'success',{context:{runsInApp:true}})).output,'sent');
  fs.mkdirSync(path.join(__dirname, 'scriptable'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'scriptable', 'iphone-notify.js'), code, 'utf8');
  if (process.argv.includes('--live')) {
    assert.equal((await run({ message: '通知样式测试\n顶部应显示微信，底部不再显示局域网同步。', appId: 'com.tencent.xin', appName: '' }, 'live')).output, 'sent');
    assert.equal((await run(undefined, 'live', {manual:true})).output, 'sent');
  }
  console.log('PASS: automatic forwarding stays silent; in-app manual test, cancel, HTTP/token/disabled/error feedback, credential redaction, separate timeout and context guards. Live receiver verified: ' + process.argv.includes('--live'));
})().catch(error => { console.error(error); process.exitCode = 1; });
