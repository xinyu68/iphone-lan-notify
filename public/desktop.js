(() => {
  const host = window.chrome && window.chrome.webview;
  const get = id => document.getElementById(id);
  const send = (action, data = {}) => host && host.postMessage({ action, ...data });
  let updatePhase = 'idle';
  const updateDialog = get('update-dialog');
  const openUpdate = () => { if (!updateDialog.open) updateDialog.showModal(); if (!['checking','downloading','installing'].includes(updatePhase)) send('check-update'); };
  get('check-update').addEventListener('click', openUpdate);
  get('retry-update').addEventListener('click', () => send('check-update'));
  get('install-update').addEventListener('click', () => { if(updatePhase==='available')send('install-update'); });
  get('close-update').addEventListener('click', () => updateDialog.close());
  get('open-releases').addEventListener('click', () => send('open-releases'));
  function renderUpdate(update) {
    if (!update) return;
    updatePhase=update.phase;
    const waiting=['checking','downloading','installing'].includes(updatePhase);
    get('app-version').textContent='v'+update.current;
    get('check-update').disabled=false;
    get('check-update').textContent=updatePhase==='available'?'发现新版本':waiting?'更新中…':'检查更新';
    get('update-versions').textContent='当前版本 v'+update.current+(updatePhase!=='error'&&update.latest?' · 最新正式版 v'+update.latest:'');
    get('update-status').textContent=updatePhase==='checking'?'正在检查 GitHub Releases…':updatePhase==='available'?'有新版本可用':updatePhase==='current'?'已是最新版本':updatePhase==='downloading'?'正在下载安装包 '+(update.percent||0)+'%':updatePhase==='installing'?'正在校验和准备安装，即将自动重启…':updatePhase==='error'?update.error:'点击检查更新，获取最新正式版';
    if(updatePhase==='updated')get('update-status').textContent='已完成更新，当前版本 v'+update.current;
    get('update-progress').hidden=updatePhase!=='downloading';get('update-progress').value=update.percent||0;
    get('update-notes').hidden=!update.notes;get('update-notes').textContent=update.notes||'';
    get('install-update').hidden=updatePhase!=='available';get('install-update').disabled=waiting;
    get('retry-update').disabled=waiting;
  }
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
  function selectSetupTab(name) {
    document.querySelectorAll('[data-setup-tab]').forEach(button => {
      const active = button.dataset.setupTab === name;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      get(button.getAttribute('aria-controls')).hidden = !active;
    });
  }
  const setupChoices = [...document.querySelectorAll('[data-setup-tab]')];
  setupChoices.forEach((button, index) => {
    button.addEventListener('click', () => selectSetupTab(button.dataset.setupTab));
    button.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = (index + (event.key === 'ArrowRight' ? 1 : -1) + setupChoices.length) % setupChoices.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = setupChoices.length - 1;
      else return;
      event.preventDefault();
      selectSetupTab(setupChoices[next].dataset.setupTab);
      setupChoices[next].focus();
    });
  });
  document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => selectTab(button.dataset.tab)));
  get('receive-toggle').addEventListener('click', () => send('receiving', { enabled: get('receive-toggle').getAttribute('aria-checked') !== 'true' }));
  get('startup-toggle').addEventListener('click', () => send('startup', { enabled: get('startup-toggle').getAttribute('aria-checked') !== 'true' }));
  get('clipboard-toggle').addEventListener('click', () => send('clipboard-enabled', { enabled:get('clipboard-toggle').getAttribute('aria-checked') !== 'true' }));
  get('open-inbox').addEventListener('click', () => send('open-inbox'));
  get('open-clipboard-setup').addEventListener('click', () => {
    selectTab('setup');
    selectSetupTab('clipboard');
    document.querySelector('.setup-navigation').scrollIntoView({behavior:'smooth',block:'start'});
  });
  get('copy-clipboard-script').addEventListener('click', () => send('copy', {text:get('clipboard-script').value}));
  get('export-clipboard-script').addEventListener('click', () => send('export-clipboard-script', {text:get('clipboard-script').value}));
  let clipboardHistoryKey = '';
  const clipboardTextState = new Map();
  const clipboardTextViews = new Map();
  let clipboardCopyPending = null;
  let clipboardCopiedKey = null;
  let clipboardCopyTimer;
  function updateClipboardCopyButtons() {
    document.querySelectorAll('[data-clipboard-copy]').forEach(button=>{
      const key = button.dataset.clipboardCopy;
      const unavailable = button.dataset.unavailable === 'true';
      button.disabled = unavailable || Boolean(clipboardCopyPending);
      button.textContent = unavailable ? '无法复制' : clipboardCopyPending === key ? '复制中…' : clipboardCopiedKey === key ? '已复制' : button.dataset.copyLabel || '复制';
    });
  }
  function copyClipboardReceipt(id,index=-1) {
    if (clipboardCopyPending) return;
    clipboardCopyPending = id + ':' + index;
    updateClipboardCopyButtons();
    send('clipboard-copy',{id,index});
  }
  const clipboardImageState = new Map();
  const clipboardImageViews = new Map();
  let clipboardImageSelection = null;
  const imageViewer = get('clipboard-image-viewer');
  const imageObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { requestClipboardThumbnail(entry.target.dataset.imageKey); imageObserver.unobserve(entry.target); }
  },{rootMargin:'160px'}) : null;
  function requestClipboardThumbnail(key) {
    const state = clipboardImageState.get(key);
    if (state && !state.data && !state.pending && !state.error) { state.pending = true; send('clipboard-image',{id:state.id,index:state.index,large:false}); }
  }
  function showClipboardImage(item, index) {
    clipboardImageSelection = item.id + ':' + index;
    get('copy-clipboard-image').dataset.clipboardCopy = clipboardImageSelection;
    get('copy-clipboard-image').dataset.copyLabel = '复制图片';
    updateClipboardCopyButtons();
    get('clipboard-image-title').textContent = item.files[index];
    get('clipboard-image-status').textContent = '正在读取图片…';
    get('clipboard-image-full').hidden = true;
    get('clipboard-image-full').removeAttribute('src');
    if (!imageViewer.open) imageViewer.showModal();
    get('copy-clipboard-image').dataset.clipboardCopy = clipboardImageSelection;
    get('copy-clipboard-image').dataset.copyLabel = '复制图片'; updateClipboardCopyButtons();
    send('clipboard-image',{id:item.id,index,large:true});
  }
  get('copy-clipboard-image').addEventListener('click',()=>{if(clipboardImageSelection){const [id,index]=clipboardImageSelection.split(':');copyClipboardReceipt(id,Number(index));}});
  get('close-clipboard-image').addEventListener('click',()=>imageViewer.close());
  get('copy-clipboard-image').addEventListener('click',()=>{
    if (!clipboardImageSelection) return;
    const [id,index] = clipboardImageSelection.split(':'); copyClipboardReceipt(id,Number(index));
  });
  imageViewer.addEventListener('click',event=>{if(event.target===imageViewer)imageViewer.close();});
  imageViewer.addEventListener('close',()=>{clipboardImageSelection=null;get('clipboard-image-full').removeAttribute('src');});
  function appendClipboardImages(row,item) {
    const images = (item.files || []).map((name,index)=>({name,index})).filter(file=>/\.(png|jpe?g|heic|heif)$/i.test(file.name)).slice(0,4);
    if (!images.length) return;
    const list = document.createElement('div'); list.className = 'clipboard-image-list'; row.append(list);
    for (const file of images) {
      const key = item.id + ':' + file.index;
      const state = clipboardImageState.get(key) || {id:item.id,index:file.index,data:null,pending:false,error:false};
      clipboardImageState.set(key,state);
      const button = document.createElement('button'); button.className = 'clipboard-image-button'; button.dataset.imageKey = key; button.setAttribute('aria-label','放大查看：'+file.name); button.title = '点击放大';
      const update = () => {
        button.replaceChildren(); button.disabled = state.error;
        if (state.data) { const image = document.createElement('img'); image.src = state.data; image.alt = file.name; button.append(image); }
        else { const label = document.createElement('span'); label.textContent = state.error ? '图片无法预览' : '读取预览…'; button.append(label); }
      };
      button.addEventListener('click',()=>showClipboardImage(item,file.index));
      clipboardImageViews.set(key,update); update(); list.append(button);
      if (!state.data && !state.error) { if (imageObserver) imageObserver.observe(button); else requestClipboardThumbnail(key); }
    }
  }
  function appendClipboardText(row, item) {
    const body = document.createElement('p'); body.className = 'clipboard-text'; row.append(body);
    const state = clipboardTextState.get(item.id) || {expanded:false,fullText:null,loading:false};
    clipboardTextState.set(item.id,state);
    const expandable = item.textTruncated || item.text.length > 160 || item.text.split('\n').length > 3;
    const toggle = expandable ? document.createElement('button') : null;
    const update = () => {
      body.textContent = state.fullText === null ? item.text : state.fullText;
      body.classList.toggle('expanded',state.expanded);
      if (toggle) { toggle.textContent = state.loading ? '正在读取…' : state.expanded ? '收起' : '展开全文'; toggle.disabled = state.loading; toggle.setAttribute('aria-expanded',String(state.expanded)); }
    };
    if (toggle) {
      toggle.className = 'clipboard-text-toggle';
      toggle.addEventListener('click', () => {
        if (!state.expanded && item.textTruncated && state.fullText === null) { state.loading = true; send('clipboard-text',{id:item.id}); }
        else state.expanded = !state.expanded;
        update();
      });
      row.append(toggle);
    }
    clipboardTextViews.set(item.id,update); update();
  }
  get('copy').addEventListener('click', () => send('copy', { text: get('endpoint').value }));
  get('copy-scriptable').addEventListener('click', () => send('copy', { text: get('scriptable-code').value }));
  get('copy-shortcut').addEventListener('click', () => send('copy', { text: 'https://www.icloud.com/shortcuts/f1cc45ac60934a4baa820400ed63fe2b' }));
  get('copy-clipboard-shortcut').addEventListener('click', () => send('copy', { text: 'https://www.icloud.com/shortcuts/154c82177e5a45c295d1c8419607f8ed' }));
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
    renderUpdate(message.update);
    const state = message.controller;
    const receiver = message.receiver || {};
    if (message.config) {
      const changed = !config || config.notifyUrl !== message.config.notifyUrl;
      config = message.config;
      if (changed) {
        get('endpoint').value = config.notifyUrl;
        get('scriptable-code').value = buildScriptableScript(config.notifyUrl);
        get('clipboard-script').value = buildClipboardScript(config.clipboardUrl || config.notifyUrl.replace('/notify/','/clipboard/'));
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
      get('connection-summary').textContent = `${config.host}:${config.port} · 两项功能共用`;
    }
    for (const id of ['save-network','refresh-network','configure-firewall','network-host','network-port']) get(id).disabled = state.busy;
    get('receive-toggle').setAttribute('aria-checked', String(state.receiving));
    get('startup-toggle').setAttribute('aria-checked', String(state.startupEnabled));
    get('receive-toggle').disabled = get('startup-toggle').disabled = state.busy;
    get('clipboard-toggle').setAttribute('aria-checked', String(state.clipboardEnabled === true));
    get('clipboard-toggle').disabled = state.busy;
    get('clipboard-description').textContent = state.clipboardReady ? '已就绪，收到后替换电脑当前剪贴板' : state.clipboardEnabled ? '正在启动剪贴板接收' : '已关闭，文字、图片和文件均不会写入';
    const receipts = receiver.clipboard?.history || [];
    const key = JSON.stringify(receipts);
    if (key !== clipboardHistoryKey) {
      clipboardHistoryKey = key;
      const list = get('clipboard-history'); list.replaceChildren();
      clipboardTextViews.clear();
      clipboardImageViews.clear(); if (imageObserver) imageObserver.disconnect();
      const retained = new Set(receipts.map(item=>item.id));
      for (const id of clipboardTextState.keys()) if (!retained.has(id)) clipboardTextState.delete(id);
      for (const [key,state] of clipboardImageState) if (!retained.has(state.id)) clipboardImageState.delete(key);
      if (!receipts.length) { const empty=document.createElement('p');empty.className='clipboard-note';empty.textContent='等待手机发送文字、图片或文件';list.append(empty); }
      for (const item of receipts) {
        const row=document.createElement('div');row.className='clipboard-receipt';
        const title=document.createElement('strong'); title.textContent=item.kind==='text'?'文字已复制':item.kind==='image'?'图片已复制':'文件已接收，可在文件夹中粘贴';
        row.append(title);
        if (item.kind === 'text' && typeof item.text === 'string') appendClipboardText(row,item);
        else { const detail=document.createElement('span');detail.textContent=item.kind==='text'?'旧记录未保存文字内容':(item.files||[]).join('、');row.append(detail); }
        if (item.kind !== 'text') appendClipboardImages(row,item);
        const time=document.createElement('time');time.textContent=new Date(item.at).toLocaleString();row.append(time);list.append(row);
        const actions=document.createElement('div');actions.className='button-row clipboard-receipt-actions';
        const copy=document.createElement('button');copy.className='secondary';copy.dataset.clipboardCopy=item.id+':-1';copy.setAttribute('aria-label','复制这条'+(item.kind==='text'?'文字':item.kind==='image'?'图片':'文件'));
        if(item.kind==='text'&&typeof item.text!=='string'){copy.dataset.unavailable='true';copy.title='旧记录未保存原文，无法复制';}
        copy.addEventListener('click',()=>copyClipboardReceipt(item.id));actions.append(copy);
        if (item.kind !== 'text') { const open=document.createElement('button');open.className='secondary';open.textContent='打开文件位置';open.addEventListener('click',()=>send('open-clipboard-item',{id:item.id}));actions.append(open); }
        row.append(actions);
      }
      updateClipboardCopyButtons();
    }
    get('status').textContent = state.busy ? '正在更新' : state.ready ? '通知接收已开启' : state.clipboardReady ? '剪贴板接收已开启' : state.receiving || state.clipboardEnabled ? '正在启动' : '接收已关闭';
    get('status').className = 'status' + (state.ready || state.clipboardReady ? ' on' : state.receiving || state.clipboardEnabled ? ' waiting' : '');
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
    if (message.type === 'clipboard-copy') {
      const key = message.id + ':' + message.index;
      if (clipboardCopyPending !== key) return;
      clipboardCopyPending = null;
      if (message.ok) {
        clipboardCopiedKey = key; clearTimeout(clipboardCopyTimer);
        clipboardCopyTimer = setTimeout(()=>{clipboardCopiedKey=null;updateClipboardCopyButtons();},2000);
        feedback(message.kind === 'files' ? '文件已复制，可在文件夹中粘贴' : message.kind === 'image' ? '图片已复制，可直接粘贴' : '文字已复制，可直接粘贴');
      } else feedback(message.error || '复制失败，请重试');
      updateClipboardCopyButtons();
    }
    if (message.type === 'clipboard-image') {
      const key = message.id + ':' + message.index;
      const data = typeof message.data === 'string' && message.data.startsWith('data:image/png;base64,') ? message.data : null;
      if (message.large) {
        if (key === clipboardImageSelection && imageViewer.open) {
          get('clipboard-image-status').textContent = data ? '' : message.error || '图片暂时无法预览';
          get('clipboard-image-full').hidden = !data;
          if (data) get('clipboard-image-full').src = data;
        }
      } else {
        const state = clipboardImageState.get(key);
        if (state) { state.pending = false; state.data = data; state.error = !data; const update = clipboardImageViews.get(key); if (update) update(); }
      }
    }
    if (message.type === 'clipboard-text') {
      const state = clipboardTextState.get(message.id);
      if (state) {
        state.loading = false;
        if (typeof message.text === 'string') { state.fullText = message.text; state.expanded = true; }
        else feedback(message.error || '文字内容暂时无法读取，请重试');
        const update = clipboardTextViews.get(message.id); if (update) update();
      }
    }
    if (message.type === 'navigate') selectTab(message.tab);
    if (message.type === 'focus-notification') {
      focusNotification(message.id);
      if (!applyNotificationFocus()) { pendingFocus = false; feedback('这条通知已过期或不在本机记录中'); }
    }
  });
  send('init');
})();
