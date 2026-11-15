const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { buildScriptableScript } = require('./public/app.js');
const config = process.argv.includes('--live') ? require('./runtime-paths.cjs').loadConfig().config : { host:'127.0.0.1', port:18766, token:'test-only-token-not-a-real-pairing-secret' };
const endpoint = `http://${config.host}:${config.port}/notify/${config.token}`;
const code = buildScriptableScript(endpoint);

async function run(input, mode) {
  const result = { requests: 0, completed: 0, output: null };
  class MockRequest {
    constructor(url) { this.url = url; }
    async loadJSON() {
      result.requests++;
      assert.equal(this.url, endpoint);
      assert.equal(this.method, 'POST');
      assert.equal(this.timeoutInterval, 2);
      assert.equal(this.headers['Content-Type'], 'application/json');
      const payload = JSON.parse(this.body);
      assert.equal(payload.message, typeof input === 'string' ? input.trim() : input.message.trim());
      if (input && typeof input === 'object') {
        assert.equal(payload.appId, input.appId || '');
        assert.equal(payload.appName, input.appName || '');
      }
      if (mode === 'timeout') throw new Error('The request timed out');
      if (mode === 'unreachable') throw new Error('Could not connect to the server');
      if (mode === 'invalid-json') throw new SyntaxError('Invalid JSON response');
      if (mode === 'live') {
        const response = await fetch(this.url, { method: this.method, headers: this.headers, body: this.body, signal: AbortSignal.timeout(5000) });
        this.response = { statusCode: response.status };
        return response.json();
      }
      this.response = { statusCode: mode === 'http-error' ? 503 : 200 };
      return { ok: mode !== 'http-error' && mode !== 'server-rejected' };
    }
  }
  const context = vm.createContext({ args: { shortcutParameter: input }, Request: MockRequest, Script: {
    setShortcutOutput(value) { result.output = value; },
    complete() { result.completed++; },
  } });
  await new vm.Script(`(async () => { ${code}\n })()`).runInContext(context);
  assert.equal(result.completed, 1, `${mode}: Script.complete must run exactly once`);
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
  fs.mkdirSync(path.join(__dirname, 'scriptable'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'scriptable', 'iphone-notify.js'), code, 'utf8');
  if (process.argv.includes('--live')) {
    assert.equal((await run({ message: '通知样式测试\n顶部应显示微信，底部不再显示局域网同步。', appId: 'com.tencent.xin', appName: '' }, 'live')).output, 'sent');
  }
  console.log('PASS: Scriptable sender handles success, timeout, unreachable host, invalid response and empty input without propagating errors. Live receiver verified: ' + process.argv.includes('--live'));
})().catch(error => { console.error(error); process.exitCode = 1; });
