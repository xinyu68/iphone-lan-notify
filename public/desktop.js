(() => {
  const host = window.chrome && window.chrome.webview;
  const get = id => document.getElementById(id);
  const send = (action, data = {}) => host && host.postMessage({ action, ...data });
  let config = null;
  let historyKey = '';
  let feedbackTimer;
  let selectedNotificationId = null;
  let pendingFocus = false;
  let highlightTimer;
  let highlightUntil = 0;
  const feedback = text => {
    get('feedback').textContent = text;
    get('feedback').hidden = false;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { get('feedback').hidden = true; }, 3500);
  };
  function selectTab(name) {
    document.querySelectorAll('.tab').forEach(button => {
      const active = button.dataset.tab === name;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      get(button.dataset.tab).hidden = !active;
    });
  }
  document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => selectTab(button.dataset.tab)));
  get('receive-toggle').addEventListener('click', () => send('receiving', { enabled: get('receive-toggle').getAttribute('aria-checked') !== 'true' }));
  get('startup-toggle').addEventListener('click', () => send('startup', { enabled: get('startup-toggle').getAttribute('aria-checked') !== 'true' }));
  get('copy').addEventListener('click', () => send('copy', { text: get('endpoint').value }));
  get('copy-scriptable').addEventListener('click', () => send('copy', { text: get('scriptable-code').value }));
  get('copy-shortcut').addEventListener('click', () => send('copy', { text: 'https://www.icloud.com/shortcuts/f1cc45ac60934a4baa820400ed63fe2b' }));
  get('export-script').addEventListener('click', () => send('export-script', { text: get('scriptable-code').value }));
  get('test').addEventListener('click', () => { get('test').disabled = true; send('test'); });
  get('save-network').addEventListener('click', () => {
    const port = Number(get('network-port').value);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) { feedback('端口须在 1024–65535 之间'); return; }
    send('network-save', { host:get('network-host').value, port });
  });
  get('refresh-network').addEventListener('click', () => send('network-refresh'));
  get('configure-firewall').addEventListener('click', () => send('firewall'));
  let networkKey = '';
  function renderHistory(items, receiving) {
    const key = JSON.stringify([items, receiving]);
    if (key === historyKey) return;
    historyKey = key;
    const list = get('history');
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('div'); empty.className = 'empty';
      const mark = document.createElement('div'); mark.className = 'empty-mark'; mark.textContent = '◌';
      const title = document.createElement('h3'); title.textContent = receiving ? '等待第一条通知' : '接收已关闭';
      const note = document.createElement('p'); note.textContent = receiving ? '手机连接相同局域网后，收到的新通知会出现在这里' : '打开上方开关，即可继续接收手机的新通知';
      empty.append(mark, title, note); list.append(empty); return;
    }
    for (const item of items) {
      const article = document.createElement('article'); article.className = 'notification';
      article.dataset.notificationId = item.id;
      article.tabIndex = -1;
      article.classList.toggle('selected', item.id === selectedNotificationId);
      article.classList.toggle('locating', item.id === selectedNotificationId && Date.now() < highlightUntil);
      const meta = document.createElement('div'); meta.className = 'meta';
      const source = document.createElement('span'); source.className = 'source'; source.textContent = item.appName || item.source || 'iPhone';
      const badge = document.createElement('span'); badge.className = item.status === 'failed' ? 'badge failed' : 'badge';
      badge.textContent = item.status === 'shown' ? (item.isTest ? '测试通知' : '已显示') : item.status === 'failed' ? '显示失败' : '发送中';
      const time = document.createElement('span'); time.className = 'time'; time.textContent = new Date(item.at).toLocaleTimeString('zh-CN', { hour12: false });
      const title = document.createElement('h3'); title.textContent = item.title;
      const body = document.createElement('p'); body.textContent = item.body;
      meta.append(source, badge, time); article.append(meta, title, body); list.append(article);
    }
  }
  function focusNotification(id) {
    if (!/^[a-f0-9]{16}$/.test(id || '')) return;
    selectedNotificationId = id;
    pendingFocus = true;
    selectTab('notifications');
    applyNotificationFocus();
  }
  function applyNotificationFocus() {
    let target = null;
    document.querySelectorAll('.notification').forEach(article => {
      const selected = article.dataset.notificationId === selectedNotificationId;
      article.classList.toggle('selected', selected);
      article.classList.toggle('locating', selected && Date.now() < highlightUntil);
      if (selected) target = article;
    });
    if (target && pendingFocus) {
      target.scrollIntoView({ behavior: 'instant', block: 'center' });
      target.focus({ preventScroll: true });
      pendingFocus = false;
      clearTimeout(highlightTimer);
      highlightUntil = Date.now() + 1000;
      target.classList.add('locating');
      highlightTimer = setTimeout(() => {
        highlightUntil = 0;
        document.querySelectorAll('.notification.locating').forEach(article => article.classList.remove('locating'));
      }, 1000);
    }
    return Boolean(target);
  }
  function render(message) {
    const state = message.controller;
    const receiver = message.receiver || {};
    if (message.config) {
      const changed = !config || config.notifyUrl !== message.config.notifyUrl;
      config = message.config;
      if (changed) {
        get('endpoint').value = config.notifyUrl;
        get('scriptable-code').value = buildScriptableScript(config.notifyUrl);
        get('network-port').value = config.port;
      }
      const key = JSON.stringify([config.host, config.networks]);
      if (key !== networkKey) {
        const previous = get('network-host').value;
        networkKey = key;
        const networks = config.networks || [];
        const options = networks.map(item => ({ value:item.address, label:`${item.name} — ${item.address}` }));
        if (!options.some(item => item.value === config.host)) options.unshift({ value:config.host, label:`${config.host}（当前配置，未检测到在线网卡）` });
        if (!options.some(item => item.value === '127.0.0.1')) options.push({ value:'127.0.0.1', label:'127.0.0.1（仅本机测试）' });
        get('network-host').replaceChildren(...options.map(item => new Option(item.label, item.value)));
        get('network-host').value = changed || !options.some(item => item.value === previous) ? config.host : previous;
      }
      get('data-location').textContent = `本机数据目录：${config.dataDirectory}`;
    }
    for (const id of ['save-network','refresh-network','configure-firewall','network-host','network-port']) get(id).disabled = state.busy;
    get('receive-toggle').setAttribute('aria-checked', String(state.receiving));
    get('startup-toggle').setAttribute('aria-checked', String(state.startupEnabled));
    get('receive-toggle').disabled = get('startup-toggle').disabled = state.busy;
    get('status').textContent = state.busy ? '正在更新' : state.ready ? '接收已开启' : state.receiving ? '正在启动' : '接收已关闭';
    get('status').className = 'status' + (state.ready ? ' on' : state.receiving ? ' waiting' : '');
    get('receive-description').textContent = state.receiving ? '在电脑上显示来自 iPhone 的新通知' : '已停止接收，新通知将静默跳过';
    get('test').disabled = !state.ready || state.busy;
    for (const id of ['received', 'shown', 'failed']) get(id).textContent = receiver[id] || 0;
    if (message.focusNotificationId && message.focusNotificationId !== selectedNotificationId) {
      selectedNotificationId = message.focusNotificationId;
      pendingFocus = true;
      selectTab('notifications');
    }
    renderHistory(receiver.history || [], state.receiving);
    applyNotificationFocus();
    window.desktopState = { receiving: state.receiving, startupEnabled: state.startupEnabled, ready: state.ready, configured: Boolean(config) };
  }
  if (host) host.addEventListener('message', event => {
    const message = event.data;
    if (message.type === 'state') render(message);
    if (message.type === 'feedback') feedback(message.text);
    if (message.type === 'navigate') selectTab(message.tab);
    if (message.type === 'focus-notification') {
      focusNotification(message.id);
      if (!applyNotificationFocus()) { pendingFocus = false; feedback('这条通知已过期或不在本机记录中'); }
    }
  });
  send('init');
})();
