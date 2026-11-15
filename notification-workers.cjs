'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { AppIconCache } = require('./app-icon-cache.cjs');
const notificationHistory = require('./notification-history.cjs');

class NotificationWorkers {
  constructor({ root, dataRoot = root, onState, log, diagnostics = false }) {
    this.root = root;
    this.dataRoot = dataRoot;
    this.onState = onState;
    this.log = log;
    this.diagnostics = diagnostics;
    this.channels = new Map();
    this.pending = new Map();
    this.generation = 0;
    this.stopped = false;
    this.ready = false;
    this.restartTimer = null;
    this.icons = new AppIconCache({ root, dataRoot, log });
  }

  start() {
    if (this.stopped) return;
    const generation = ++this.generation;
    this.ready = false;
    this.onState('starting');
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const specs = [
      ['center', powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', path.join(this.root, 'toast-worker.ps1')]],
      ['popup', path.join(this.root, 'NotificationPopup.exe'), this.diagnostics ? ['--diagnostics'] : []],
    ];
    for (const [name, command, args] of specs) {
      const child = spawn(command, args, { cwd: this.root, env: { ...process.env, PHONE_NOTIFY_DATA_DIR:this.dataRoot }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const channel = { child, ready: false };
      this.channels.set(name, channel);
      child.stdin.on('error', error => {
        if (generation === this.generation && !this.stopped) this.restart(generation, name, error.message);
      });
      readline.createInterface({ input: child.stdout }).on('line', line => {
        if (generation !== this.generation || this.stopped) return;
        let reply;
        try { reply = JSON.parse(line); } catch { return; }
        if (name === 'popup' && reply.op === 'notification-opened') {
          void this.dismissSystemNotification(reply.notificationId, reply.notifierAppId).catch(error => {
            this.log('notification-center-remove-failed', { notificationId: reply.notificationId, error: error.message });
          });
          return;
        }
        if (reply.op === 'ready') {
          channel.ready = reply.ok === true;
          if (name === 'center') this.nativeCenter = reply.nativeActivation === true;
          this.log('notification-worker-ready', { channel: name, ok: channel.ready, error: reply.error });
          if (!channel.ready) { this.restart(generation, name, 'Worker initialization failed'); return; }
          this.ready = this.channels.size === 2 && [...this.channels.values()].every(item => item.ready);
          this.onState(this.ready ? 'ready' : 'starting');
          if (this.ready) void this.upgradeExistingHistory().catch(() => this.log('notification-history-upgrade-failed', {}));
          return;
        }
        const key = `${name}:${reply.id}`;
        const request = this.pending.get(key);
        if (!request) return;
        clearTimeout(request.timeout);
        this.pending.delete(key);
        reply.ok ? request.resolve(reply) : request.reject(new Error(reply.error || `${name} notification failed`));
      });
      child.stderr.on('data', chunk => this.log('notification-worker-stderr', { channel: name, error: chunk.toString('utf8').slice(0, 1000) }));
      child.on('error', error => this.restart(generation, name, error.message));
      child.on('exit', code => this.restart(generation, name, `Worker exited (${code})`));
    }
  }

  restart(generation, channel, reason) {
    if (this.stopped || generation !== this.generation) return;
    ++this.generation;
    this.ready = false;
    this.log('notification-worker-restarting', { channel, error: reason });
    this.rejectPending(new Error('Notification display worker restarted'));
    this.closeChildren();
    this.onState('offline');
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => this.start(), 1500);
  }

  call(message, name = 'center') {
    return new Promise((resolve, reject) => {
      const channel = this.channels.get(name);
      if (!this.ready || !channel?.ready || channel.child.killed || channel.child.exitCode !== null) {
        reject(new Error('Notification display worker is not ready'));
        return;
      }
      const id = message.id || crypto.randomUUID().replaceAll('-', '').slice(0, 16);
      const key = `${name}:${id}`;
      if (this.pending.has(key)) { reject(new Error('Duplicate notification request')); return; }
      const timeout = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error('Notification display timed out'));
        this.restart(this.generation, name, 'Worker response timeout');
      }, 8000);
      this.pending.set(key, { resolve, reject, timeout });
      channel.child.stdin.write(Buffer.from(JSON.stringify({ ...message, id }), 'utf8').toString('base64') + '\n');
    });
  }

  async notify(message) {
    // Keep one system-history entry and one custom popup; no native banner.
    const icon = await this.icons.resolve(message);
    const center = await this.call({ ...message, ...icon }, 'center');
    const popup = await this.call({ ...message, ...icon }, 'popup');
    return { ...popup, iconSource: popup.iconSource || icon.iconSource, iconBuiltin: icon.iconBuiltin === true && (popup.iconSource || icon.iconSource) === 'appstore', iconCacheHit: icon.iconCacheHit === true, nativePopupSuppressed: center.nativePopupSuppressed === true };
  }

  async upgradeExistingHistory() {
    const saved = new Map(notificationHistory.load(this.dataRoot).map(item => [item.id, item]));
    if (!saved.size) return;
    const existing = await this.call({ op: 'history' }, 'center');
    for (const entry of existing.details || []) {
      const item = saved.get(entry.id);
      const currentLayout = entry.activationType === (this.nativeCenter ? 'foreground' : 'protocol') && entry.hasAppIcon !== true;
      if (!item || currentLayout || !entry.expiresAt || Date.parse(entry.expiresAt) <= Date.now() || this.stopped || !this.ready) continue;
      const icon = await this.icons.resolve(item);
      await this.call({ ...item, ...icon, op: 'refresh', expirationTime: entry.expiresAt, silent: true }, 'center');
    }
  }

  dismissSystemNotification(notificationId, notifierAppId) {
    if (!/^[a-f0-9]{16}$/.test(notificationId || '') || !/^Xinyu\.IPhoneLanNotify(?:\.Source\.[a-f0-9]{24})?$/.test(notifierAppId || '')) {
      return Promise.reject(new Error('Invalid notification removal identity'));
    }
    return this.call({ op: 'remove', notificationId, notifierAppId }, 'center');
  }

  rejectPending(error) {
    for (const request of this.pending.values()) { clearTimeout(request.timeout); request.reject(error); }
    this.pending.clear();
  }

  closeChildren() {
    for (const { child } of this.channels.values()) {
      child.stdin.end();
      // Only children owned by this receiver are eligible for the exit deadline.
      const deadline = setTimeout(() => { if (child.exitCode === null && !child.killed) child.kill(); }, 1000);
      deadline.unref();
    }
    this.channels.clear();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    ++this.generation;
    this.ready = false;
    clearTimeout(this.restartTimer);
    this.rejectPending(new Error('Notification receiver stopped'));
    this.icons.close();
    this.closeChildren();
  }
}

module.exports = { NotificationWorkers };
