const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, safeStorage, clipboard } = require('electron');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { io } = require('socket.io-client');
const WebSocket = require('ws');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');
const crypto = require('crypto');
const net = require('net');

let mainWindow = null;
let tray = null;
let trayRetryTimer = null;
let trayRetryAttempts = 0;
const TRAY_RETRY_MAX = 3;
const TRAY_RETRY_DELAY_MS = 1500;
let autoUpdaterSetupDone = false;
let rendererDownloadGuardInstalled = false;
let ytmdSocket = null;
let aetherisBotSocket = null;
let aetherisBotReconnectTimer = null;
let aetherisBotStatus = { connected:false, connecting:false, authenticated:false, userId:'', lastError:'', streamStatusKnown:false, streamLive:false, streamStatusSource:'', twitchAuthorizationKnown:false, twitchAuthorized:false, twitchAuthReason:'', twitchAuthCheckedAt:0 };
let aetherisBotManualDisconnect = false;

// Developer-only UI is enabled explicitly with --developer in packaged builds.
// npm start also enables it automatically for development convenience.
let developerMode = process.argv.includes('--developer') || !app.isPackaged;


// Discord Rich Presence is intentionally developer-only. It connects directly
// to the local Discord desktop client over Discord's IPC pipe; there is no bot,
// OAuth token, client secret, or AetherisBot server dependency.
const DISCORD_APPLICATION_ID = '1549003654348931102';
const DISCORD_RPC_RETRY_MS = 15000;
const DISCORD_RPC_MAX_PIPE = 9;
const discordPresenceStartedAt = Math.floor(Date.now() / 1000);
let discordRpcSocket = null;
let discordRpcReconnectTimer = null;
let discordRpcBuffer = Buffer.alloc(0);
let discordRpcConnecting = false;
let discordRpcStopped = false;

function discordRpcPipePath(index) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${index}`;
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  return path.join(base, `discord-ipc-${index}`);
}

function discordRpcFrame(opcode, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(8);
  header.writeInt32LE(opcode, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function writeDiscordRpc(opcode, payload) {
  if (!discordRpcSocket || discordRpcSocket.destroyed) return false;
  try {
    discordRpcSocket.write(discordRpcFrame(opcode, payload));
    return true;
  } catch (_) {
    return false;
  }
}

function setDiscordDeveloperPresence() {
  return writeDiscordRpc(1, {
    cmd: 'SET_ACTIVITY',
    args: {
      pid: process.pid,
      activity: {
        type: 0,
        details: 'Developing Aetheris',
        state: `v${app.getVersion()} • Developer Mode`,
        timestamps: { start: discordPresenceStartedAt },
        instance: false,
      },
    },
    nonce: crypto.randomUUID(),
  });
}

function clearDiscordDeveloperPresence() {
  return writeDiscordRpc(1, {
    cmd: 'SET_ACTIVITY',
    args: { pid: process.pid, activity: null },
    nonce: crypto.randomUUID(),
  });
}

function scheduleDiscordRpcReconnect() {
  if (!developerMode || discordRpcStopped || discordRpcReconnectTimer) return;
  discordRpcReconnectTimer = setTimeout(() => {
    discordRpcReconnectTimer = null;
    connectDiscordDeveloperPresence();
  }, DISCORD_RPC_RETRY_MS);
  discordRpcReconnectTimer.unref?.();
}

function handleDiscordRpcData(chunk) {
  discordRpcBuffer = Buffer.concat([discordRpcBuffer, chunk]);
  while (discordRpcBuffer.length >= 8) {
    const opcode = discordRpcBuffer.readInt32LE(0);
    const length = discordRpcBuffer.readInt32LE(4);
    if (length < 0 || length > 1024 * 1024) {
      try { discordRpcSocket?.destroy(); } catch (_) {}
      return;
    }
    if (discordRpcBuffer.length < 8 + length) return;
    const body = discordRpcBuffer.subarray(8, 8 + length);
    discordRpcBuffer = discordRpcBuffer.subarray(8 + length);

    if (opcode === 3) {
      // Discord ping: reply with the exact same payload as a pong.
      try { discordRpcSocket?.write(discordRpcFrame(4, JSON.parse(body.toString('utf8')))); } catch (_) {}
      continue;
    }
    if (opcode !== 1) continue;

    try {
      const payload = JSON.parse(body.toString('utf8'));
      if (payload?.evt === 'READY') {
        setDiscordDeveloperPresence();
      }
    } catch (_) {}
  }
}

function tryDiscordRpcPipe(index = 0) {
  if (!developerMode || discordRpcStopped || discordRpcSocket || discordRpcConnecting) return;
  if (index > DISCORD_RPC_MAX_PIPE) {
    discordRpcConnecting = false;
    scheduleDiscordRpcReconnect();
    return;
  }

  discordRpcConnecting = true;
  const socket = net.createConnection(discordRpcPipePath(index));
  let connected = false;

  socket.once('connect', () => {
    connected = true;
    discordRpcConnecting = false;
    discordRpcSocket = socket;
    discordRpcBuffer = Buffer.alloc(0);
    socket.on('data', handleDiscordRpcData);
    writeDiscordRpc(0, { v: 1, client_id: DISCORD_APPLICATION_ID });
  });

  socket.once('error', () => {
    if (!connected) {
      try { socket.destroy(); } catch (_) {}
      discordRpcConnecting = false;
      tryDiscordRpcPipe(index + 1);
    }
  });

  socket.once('close', () => {
    if (discordRpcSocket === socket) discordRpcSocket = null;
    discordRpcConnecting = false;
    if (connected) scheduleDiscordRpcReconnect();
  });
}

function connectDiscordDeveloperPresence() {
  if (!developerMode || discordRpcStopped || discordRpcSocket || discordRpcConnecting) return;
  tryDiscordRpcPipe(0);
}

function stopDiscordDeveloperPresence() {
  discordRpcStopped = true;
  if (discordRpcReconnectTimer) {
    clearTimeout(discordRpcReconnectTimer);
    discordRpcReconnectTimer = null;
  }
  try { clearDiscordDeveloperPresence(); } catch (_) {}
  try { discordRpcSocket?.end(); } catch (_) {}
  try { discordRpcSocket?.destroy(); } catch (_) {}
  discordRpcSocket = null;
  discordRpcBuffer = Buffer.alloc(0);
  discordRpcConnecting = false;
}

const OVERLAY_RELAY_PORT = 43418;
let overlayRelayServer = null;
let overlayRelayToken = null;
let overlayRelayState = { nowPlaying: null, overlay: null };
const overlayRelayClients = new Set();

const BACKUP_OBFUSCATION_CONTEXT = 'Aetheris portable backup v1';
const BLOCKED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function clampString(value, max = 4096) {
  return String(value ?? '').slice(0, max);
}
function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function atomicPrivateWrite(filePath, data, encoding = null) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    const options = encoding ? { encoding, mode: 0o600 } : { mode: 0o600 };
    fs.writeFileSync(temp, data, options);
    try { fs.chmodSync(temp, 0o600); } catch (_) {}
    fs.renameSync(temp, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch (_) {}
  } finally {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch (_) {}
  }
}
function validPort(value, fallback = 9863) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : fallback;
}
function validLocalHost(value) {
  const host = clampString(value, 253).trim();
  if (!host) return '127.0.0.1';
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return host;
  // YTMD Companion is intentionally local-only in Aetheris.
  return '127.0.0.1';
}
function redactSecrets(value) {
  let text = String(value ?? '');
  text = text.replace(/(Authorization\s*:\s*(?:Bearer|OAuth)\s+)[^\s,;]+/gi, '$1[REDACTED]');
  text = text.replace(/(oauth:)[A-Za-z0-9_\-]+/gi, '$1[REDACTED]');
  text = text.replace(/((?:access_token|refresh_token|api[_-]?key|ytmd[_-]?token|botOAuth|token)\s*[=:]\s*["']?)[^\s,;"'}]+/gi, '$1[REDACTED]');
  return text;
}
function assertTrustedIpc(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
    throw new Error('Blocked IPC request from an untrusted renderer.');
  }
}
function trustedHandle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedIpc(event);
    return handler(...args);
  });
}

function secretsFilePath() {
  return path.join(app.getPath('userData'), 'aetheris-secrets.bin');
}
function sanitizeSecretObject(input = {}) {
  return {
    twitchBotOAuth: clampString(input.twitchBotOAuth, 4096),
    spotifyAccessToken: clampString(input.spotifyAccessToken, 8192),
    spotifyRefreshToken: clampString(input.spotifyRefreshToken, 8192),
    youtubeApiKey: clampString(input.youtubeApiKey, 4096),
    ytmdToken: clampString(input.ytmdToken, 8192),
  };
}
function saveSecretsToDisk(input) {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, unavailable: true };
  const secrets = sanitizeSecretObject(input);
  const encrypted = safeStorage.encryptString(JSON.stringify(secrets));
  atomicPrivateWrite(secretsFilePath(), encrypted);
  return { ok: true };
}
function loadSecretsFromDisk() {
  const file = secretsFilePath();
  if (!fs.existsSync(file)) return { ok: true, secrets: sanitizeSecretObject({}) };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, unavailable: true, secrets: sanitizeSecretObject({}) };
  try {
    const decoded = safeStorage.decryptString(fs.readFileSync(file));
    return { ok: true, secrets: sanitizeSecretObject(JSON.parse(decoded)) };
  } catch (err) {
    appendAppLog('ERROR', 'Could not decrypt secure credential store', err?.message || String(err));
    return { ok: false, error: 'decrypt-failed', secrets: sanitizeSecretObject({}) };
  }
}


function aetherisBotAuthFilePath() {
  return path.join(app.getPath('userData'), 'aetheris-bot-auth.bin');
}
function sanitizeAetherisBotAuth(input = {}) {
  return {
    userId: clampString(input.userId, 64).trim().replace(/[^0-9]/g, ''),
    token: clampString(input.token, 256).trim(),
  };
}
function saveAetherisBotAuth(input) {
  if (!safeStorage.isEncryptionAvailable()) return { ok:false, unavailable:true };
  const auth = sanitizeAetherisBotAuth(input);
  if (!auth.userId || !/^[a-f0-9]{64}$/i.test(auth.token)) return { ok:false, error:'invalid-auth' };
  const encrypted = safeStorage.encryptString(JSON.stringify(auth));
  atomicPrivateWrite(aetherisBotAuthFilePath(), encrypted);
  return { ok:true, userId:auth.userId };
}
function loadAetherisBotAuth() {
  const file = aetherisBotAuthFilePath();
  if (!fs.existsSync(file)) return { ok:true, auth:null };
  if (!safeStorage.isEncryptionAvailable()) return { ok:false, unavailable:true, auth:null };
  try {
    const decoded = safeStorage.decryptString(fs.readFileSync(file));
    const auth = sanitizeAetherisBotAuth(JSON.parse(decoded));
    if (!auth.userId || !/^[a-f0-9]{64}$/i.test(auth.token)) return { ok:false, error:'invalid-auth-file', auth:null };
    return { ok:true, auth };
  } catch (err) {
    appendAppLog('ERROR', 'Could not decrypt AetherisBot desktop credential', err?.message || String(err));
    return { ok:false, error:'decrypt-failed', auth:null };
  }
}
function clearAetherisBotAuth() {
  try { fs.unlinkSync(aetherisBotAuthFilePath()); } catch (err) { if (err?.code !== 'ENOENT') throw err; }
}

const AETHERIS_BOT_API_ORIGIN = 'https://api.aetherisbot.club';
const AETHERIS_BOT_WS_URL = 'wss://api.aetherisbot.club';

function aetherisBotJsonRequest(method, pathname, payload = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, AETHERIS_BOT_API_ORIGIN);
    if (url.origin !== AETHERIS_BOT_API_ORIGIN) return reject(new Error('Blocked unexpected AetherisBot API URL.'));
    const requestBody = payload == null ? null : JSON.stringify(payload);
    const headers = { 'User-Agent':'Aetheris', 'Accept':'application/json' };
    if (requestBody !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(requestBody);
    }
    const req = https.request(url, {
      method,
      timeout:10000,
      headers
    }, (res) => {
      let body='';
      res.setEncoding('utf8');
      res.on('data', chunk => { if (body.length < 65536) body += chunk; });
      res.on('end', () => {
        let data=null;
        try { data = body ? JSON.parse(body) : null; } catch (_) {}
        if ((res.statusCode||0) < 200 || (res.statusCode||0) >= 300) return reject(new Error(`AetherisBot API ${res.statusCode}: ${body.slice(0,200)}`));
        if (!data || typeof data !== 'object') return reject(new Error('AetherisBot API returned an invalid response.'));
        resolve(data);
      });
    });
    req.on('timeout', () => req.destroy(new Error('AetherisBot API request timed out')));
    req.on('error', reject);
    if (requestBody !== null) req.write(requestBody);
    req.end();
  });
}
function sendAetherisBotStatus(extra = {}) {
  aetherisBotStatus = { ...aetherisBotStatus, ...extra };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('aetheris-bot-status', { ...aetherisBotStatus });
}
function teardownAetherisBotSocket({ manual = false } = {}) {
  if (manual) aetherisBotManualDisconnect = true;
  if (aetherisBotReconnectTimer) { clearTimeout(aetherisBotReconnectTimer); aetherisBotReconnectTimer = null; }
  const socket = aetherisBotSocket;
  aetherisBotSocket = null;
  if (socket) {
    try {
      socket.removeAllListeners();
      // ws throws for BOTH close() and terminate() while the handshake is still
      // CONNECTING. Retire that socket without touching the handshake; if it
      // eventually opens, close it immediately. Keep an error listener so an
      // abandoned failed handshake can never become an uncaught exception.
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.on('error', () => {});
        socket.once('open', () => { try { socket.close(); } catch (_) {} });
      } else if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CLOSING) {
        socket.close();
      }
    } catch (err) {
      appendAppLog('WARN', 'AetherisBot socket teardown failed', err?.message || String(err));
    }
  }
  sendAetherisBotStatus({ connected:false, connecting:false, authenticated:false, streamStatusKnown:false, streamLive:false, streamStatusSource:'', twitchAuthorizationKnown:false, twitchAuthorized:false, twitchAuthReason:'', twitchAuthCheckedAt:0 });
}
function sendAetherisBotChatReply(text) {
  const message = clampString(text, 500).trim();
  if (!message) return { ok:false, reason:'empty-message' };
  const socket = aetherisBotSocket;
  if (!socket || socket.readyState !== WebSocket.OPEN || !aetherisBotStatus.authenticated) {
    return { ok:false, reason:'bridge-not-connected' };
  }
  try {
    socket.send(JSON.stringify({ type:'chat-reply', message }));
    return { ok:true };
  } catch (err) {
    appendAppLog('WARN', 'Could not send AetherisBot chat reply', err?.message || String(err));
    return { ok:false, reason:'send-failed' };
  }
}

function scheduleAetherisBotReconnect() {
  if (aetherisBotManualDisconnect || aetherisBotReconnectTimer) return;
  const auth = loadAetherisBotAuth();
  if (!auth.ok || !auth.auth) return;
  aetherisBotReconnectTimer = setTimeout(() => {
    aetherisBotReconnectTimer = null;
    connectAetherisBotSocket().catch(err => appendAppLog('WARN', 'AetherisBot reconnect failed', err?.message || String(err)));
  }, 5000);
}
async function connectAetherisBotSocket() {
  const loaded = loadAetherisBotAuth();
  if (!loaded.ok || !loaded.auth) {
    sendAetherisBotStatus({ connected:false, connecting:false, authenticated:false, userId:'', lastError:loaded.error || '' });
    return { ok:false, reason:'not-paired' };
  }
  aetherisBotManualDisconnect = false;
  teardownAetherisBotSocket();
  aetherisBotManualDisconnect = false;
  const auth = loaded.auth;
  sendAetherisBotStatus({ connecting:true, authenticated:false, userId:auth.userId, lastError:'', streamStatusKnown:false, streamLive:false, streamStatusSource:'', twitchAuthorizationKnown:false, twitchAuthorized:false, twitchAuthReason:'', twitchAuthCheckedAt:0 });
  return new Promise((resolve) => {
    let settled=false;
    const socket = new WebSocket(AETHERIS_BOT_WS_URL, { handshakeTimeout:10000 });
    aetherisBotSocket = socket;
    const finish = value => { if (!settled) { settled=true; resolve(value); } };
    socket.on('open', () => {
      sendAetherisBotStatus({ connected:true, connecting:false, userId:auth.userId });
      socket.send(JSON.stringify({ type:'authenticate', userId:auth.userId, token:auth.token }));
    });
    socket.on('message', (raw) => {
      let msg=null;
      try { msg = JSON.parse(String(raw)); } catch (_) { return; }
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'auth-ok') {
        sendAetherisBotStatus({ connected:true, connecting:false, authenticated:true, userId:auth.userId, lastError:'' });
        finish({ ok:true, userId:auth.userId });
        return;
      }
      if (msg.type === 'auth-error') {
        sendAetherisBotStatus({ connected:true, connecting:false, authenticated:false, userId:auth.userId, lastError:'authentication-failed' });
        try { socket.close(); } catch (_) {}
        finish({ ok:false, reason:'authentication-failed' });
        return;
      }
      if (msg.type === 'twitch-auth-status') {
        sendAetherisBotStatus({
          twitchAuthorizationKnown:true,
          twitchAuthorized:!!msg.authorized,
          twitchAuthReason:clampString(msg.reason || '', 120),
          twitchAuthCheckedAt:Number(msg.checkedAt || Date.now())
        });
        if (!msg.authorized) {
          appendAppLog('WARN', 'Twitch channel authorization requires re-authorization', clampString(msg.reason || 'authorization-invalid', 180));
        } else if (msg.refreshed) {
          appendAppLog('INFO', 'Twitch channel authorization refreshed by AetherisBot Cloud');
        }
        return;
      }
      if (msg.type === 'stream-status') {
        sendAetherisBotStatus({
          streamStatusKnown:true,
          streamLive:!!msg.live,
          streamStatusSource:clampString(msg.source || 'cloud', 40),
          streamStatusCheckedAt:Number(msg.checkedAt || Date.now())
        });
        return;
      }
      if (msg.type === 'stream-status-unknown') {
        sendAetherisBotStatus({
          streamStatusKnown:false,
          streamLive:false,
          streamStatusSource:clampString(msg.source || 'cloud', 40),
          streamStatusCheckedAt:Date.now()
        });
        return;
      }
      if ((msg.type === 'twitch-chat' || msg.type === 'chat-message') && mainWindow && !mainWindow.isDestroyed()) {
        const event = msg.event && typeof msg.event === 'object' ? msg.event : null;
        if (event) {
          const who = clampString(event.chatterUserLogin || event.chatter_user_login || 'unknown', 80);
          const text = clampString(event.messageText || event.message?.text || '', 180);
          mainWindow.webContents.send('aetheris-bot-chat-message', event);
        }
        return;
      }
      if (msg.type === 'chat-reply-ok') {
        appendAppLog('INFO', 'AetherisBot chat reply sent');
        return;
      }
      if (msg.type === 'chat-reply-error') {
        appendAppLog('WARN', 'AetherisBot chat reply failed', clampString(msg.error || 'unknown-error', 220));
      }
    });
    socket.on('error', (err) => {
      const message = redactSecrets(err?.message || String(err));
      sendAetherisBotStatus({ connected:false, connecting:false, authenticated:false, lastError:message });
      finish({ ok:false, reason:message });
    });
    socket.on('close', (code, reasonBuffer) => {
      if (aetherisBotSocket === socket) aetherisBotSocket = null;
      const reason = clampString(Buffer.isBuffer(reasonBuffer) ? reasonBuffer.toString('utf8') : String(reasonBuffer || ''), 160);
      const closeDetail = `code=${Number(code || 0)}${reason ? ` reason=${reason}` : ''}`;
      appendAppLog('WARN', 'AetherisBot cloud bridge disconnected', closeDetail);
      sendAetherisBotStatus({
        connected:false,
        connecting:false,
        authenticated:false,
        streamStatusKnown:false,
        streamLive:false,
        streamStatusSource:'',
        twitchAuthorizationKnown:false,
        twitchAuthorized:false,
        twitchAuthReason:'',
        twitchAuthCheckedAt:0,
        lastError:`WebSocket closed (${closeDetail})`
      });
      finish({ ok:false, reason:`closed-${Number(code || 0)}` });
      scheduleAetherisBotReconnect();
    });
    setTimeout(() => finish({ ok:aetherisBotStatus.authenticated, reason:aetherisBotStatus.authenticated ? undefined : 'timeout' }), 12000);
  });
}

// Portable backup protection: authenticated reversible obfuscation. The keying
// material ships with Aetheris so this hides casual plaintext inspection but is
// intentionally not described as password-grade encryption.
function backupKey(salt) {
  return crypto.pbkdf2Sync(BACKUP_OBFUSCATION_CONTEXT, salt, 120000, 32, 'sha256');
}
function protectBackupSecrets(input) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', backupKey(salt), iv);
  const plain = Buffer.from(JSON.stringify(sanitizeSecretObject(input)), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    format: 'aetheris-protected-v1',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ciphertext.toString('base64'),
  };
}
function decodeBackupBase64(value, maxChars, expectedBytes = null) {
  const text = clampString(value, maxChars).trim();
  if (!text || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('Protected backup contains invalid encoded data.');
  const out = Buffer.from(text, 'base64');
  if (expectedBytes !== null && out.length !== expectedBytes) throw new Error('Protected backup contains invalid cryptographic parameters.');
  return out;
}
function unprotectBackupSecrets(blob) {
  if (!isPlainObject(blob) || blob.format !== 'aetheris-protected-v1') throw new Error('Unsupported protected backup format.');
  const salt = decodeBackupBase64(blob.salt, 64, 16);
  const iv = decodeBackupBase64(blob.iv, 32, 12);
  const tag = decodeBackupBase64(blob.tag, 32, 16);
  const ciphertext = decodeBackupBase64(blob.data, 65536);
  if (ciphertext.length > 48 * 1024) throw new Error('Protected backup secret payload is too large.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', backupKey(salt), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  if (Buffer.byteLength(plain, 'utf8') > 48 * 1024) throw new Error('Protected backup secret payload is too large.');
  const parsed = JSON.parse(plain);
  if (!isPlainObject(parsed)) throw new Error('Protected backup secret payload is invalid.');
  return sanitizeSecretObject(parsed);
}

function overlayTokenFilePath() {
  return path.join(app.getPath('userData'), 'overlay-relay-token.txt');
}
function getOverlayRelayToken() {
  if (overlayRelayToken) return overlayRelayToken;
  try {
    const existing = fs.readFileSync(overlayTokenFilePath(), 'utf8').trim();
    if (/^[a-f0-9]{64}$/i.test(existing)) return (overlayRelayToken = existing);
  } catch (_) {}
  overlayRelayToken = crypto.randomBytes(32).toString('hex');
  atomicPrivateWrite(overlayTokenFilePath(), overlayRelayToken, 'utf8');
  return overlayRelayToken;
}
function overlayRelayUrl() {
  const token = getOverlayRelayToken();
  return `http://127.0.0.1:${OVERLAY_RELAY_PORT}/overlay/${token}#view=overlay&relay=1`;
}
function sanitizeOverlayPayload(payload = {}) {
  const np = payload && typeof payload.nowPlaying === 'object' && payload.nowPlaying ? payload.nowPlaying : null;
  const ov = payload && typeof payload.overlay === 'object' && payload.overlay ? payload.overlay : null;
  return {
    nowPlaying: np ? {
      source: clampString(np.source, 40), title: clampString(np.title, 500), artist: clampString(np.artist, 500),
      art: /^https?:\/\//i.test(String(np.art || '')) ? clampString(np.art, 4096) : '',
      progressMs: Math.max(0, Number(np.progressMs) || 0), durationMs: Math.max(0, Number(np.durationMs) || 0),
      // Preserve the playback sample timestamp so the OBS Browser Source can
      // extrapolate progress smoothly between state pushes instead of freezing
      // at the last sampled progress value.
      updatedAt: Math.max(0, Number(np.updatedAt) || 0),
      isPlaying: !!np.isPlaying, uri: clampString(np.uri, 2048), requester: clampString(np.requester, 200),
    } : null,
    overlay: ov ? JSON.parse(JSON.stringify(ov, (k, v) => BLOCKED_OBJECT_KEYS.has(k) ? undefined : v)) : null,
  };
}
function broadcastOverlayState() {
  const data = `data: ${JSON.stringify(overlayRelayState)}\n\n`;
  for (const res of [...overlayRelayClients]) {
    try { res.write(data); } catch (_) { overlayRelayClients.delete(res); }
  }
}
function startOverlayRelay() {
  if (overlayRelayServer) return;
  const token = getOverlayRelayToken();
  overlayRelayServer = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, `http://127.0.0.1:${OVERLAY_RELAY_PORT}`); } catch (_) { res.writeHead(400).end(); return; }
    const overlayPath = `/overlay/${token}`;
    const scriptPath = `/overlay/aetheris-renderer.js`;
    const eventsPath = `/events/${token}`;
    if (url.pathname === overlayPath) {
      try {
        const body = fs.readFileSync(obsOverlayFilePath());
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        });
        res.end(body);
      } catch (err) { res.writeHead(500).end('Overlay resource unavailable'); }
      return;
    }
    if (url.pathname === scriptPath) {
      try {
        const body = fs.readFileSync(externalResourcePath('aetheris-renderer.js'));
        res.writeHead(200, {'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        res.end(body);
      } catch (_) { res.writeHead(404).end(); }
      return;
    }
    if (url.pathname === eventsPath) {
      res.writeHead(200, {
        'Content-Type':'text/event-stream', 'Cache-Control':'no-store', 'Connection':'keep-alive',
        'Access-Control-Allow-Origin': `http://127.0.0.1:${OVERLAY_RELAY_PORT}`,
      });
      overlayRelayClients.add(res);
      res.write(`data: ${JSON.stringify(overlayRelayState)}\n\n`);
      req.on('close', () => overlayRelayClients.delete(res));
      return;
    }
    res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}).end('Not found');
  });
  overlayRelayServer.on('error', (err) => {
    appendAppLog('ERROR', 'OBS overlay relay failed to start', err?.message || String(err));
    overlayRelayServer = null;
  });
  overlayRelayServer.listen(OVERLAY_RELAY_PORT, '127.0.0.1');
}
function stopOverlayRelay() {
  for (const res of overlayRelayClients) { try { res.end(); } catch (_) {} }
  overlayRelayClients.clear();
  if (overlayRelayServer) { try { overlayRelayServer.close(); } catch (_) {} overlayRelayServer = null; }
}


/* ---------------- persistent app/error log ---------------- */
function appLogPath() {
  return path.join(app.getPath('userData'), 'aetheris-error.log');
}
function appendAppLog(level, message, detail = '') {
  try {
    const stamp = new Date().toISOString();
    const line = `[${stamp}] [${String(level||'INFO').toUpperCase()}] ${redactSecrets(message)}${detail ? ' | '+redactSecrets(detail) : ''}\n`;
    fs.mkdirSync(path.dirname(appLogPath()), { recursive: true });
    fs.appendFileSync(appLogPath(), line, 'utf8');
  } catch (_) { /* logging must never crash the app */ }
}
const originalConsoleError = console.error.bind(console);
const originalConsoleWarn = console.warn.bind(console);
console.error = (...args) => { appendAppLog('ERROR', args.map(a=>a instanceof Error?(a.stack||a.message):typeof a==='string'?a:JSON.stringify(a)).join(' ')); originalConsoleError(...args); };
console.warn = (...args) => { appendAppLog('WARN', args.map(a=>a instanceof Error?(a.stack||a.message):typeof a==='string'?a:JSON.stringify(a)).join(' ')); originalConsoleWarn(...args); };
process.on('uncaughtException', (err) => appendAppLog('FATAL', 'uncaughtException', err?.stack || err?.message || String(err)));
process.on('unhandledRejection', (reason) => appendAppLog('ERROR', 'unhandledRejection', reason?.stack || reason?.message || String(reason)));

ipcMain.on('app-get-version-sync', (event) => {
  // This IPC runs from preload while BrowserWindow is still being constructed.
  // At that exact moment `mainWindow` has not necessarily been assigned yet, so
  // validating against mainWindow.webContents can incorrectly return an empty
  // string and leave the sidebar version / What's New pill blank. The app
  // version is non-sensitive metadata, so return it directly and keep every
  // privileged/action IPC channel sender-validated as before.
  event.returnValue = app.getVersion();
});

trustedHandle('app-log-renderer-error', (payload = {}) => {
  payload = isPlainObject(payload) ? payload : {};
  appendAppLog(clampString(payload.level || 'ERROR', 16), clampString(payload.message || 'Renderer error', 2000), clampString(payload.detail || '', 8000));
  return { ok: true };
});

trustedHandle('app-export-error-log', async () => {
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const result = await dialog.showSaveDialog(owner, {
    title: 'Save Aetheris error log',
    defaultPath: path.join(app.getPath('downloads'), `Aetheris-Error-Log-${new Date().toISOString().slice(0,10)}.txt`),
    filters: [{ name: 'Text file', extensions: ['txt'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const src = appLogPath();
  const header = `Aetheris ${app.getVersion()} Error Log\nGenerated: ${new Date().toLocaleString()}\n\n`;
  const body = fs.existsSync(src) ? fs.readFileSync(src, 'utf8') : 'No errors have been recorded yet.\n';
  fs.writeFileSync(result.filePath, header + body, 'utf8');
  return { ok: true, filePath: result.filePath };
});

trustedHandle('app-save-json-export', async (payload = {}) => {
  if (!isPlainObject(payload)) throw new Error('Invalid export payload.');
  const fileName = clampString(payload.fileName, 120).replace(/[^A-Za-z0-9._-]/g, '-') || 'aetheris-export.json';
  const contents = String(payload.contents ?? '');
  if (!contents) throw new Error('Export data is empty.');
  if (Buffer.byteLength(contents, 'utf8') > 5 * 1024 * 1024) throw new Error('Export data is too large.');
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const result = await dialog.showSaveDialog(owner, {
    title: clampString(payload.title || 'Save Aetheris export', 120),
    defaultPath: path.join(app.getPath('downloads'), fileName),
    filters: [{ name: 'JSON file', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { canceled:true };
  atomicPrivateWrite(result.filePath, contents, 'utf8');
  return { ok:true, filePath:result.filePath };
});

trustedHandle('app-copy-log', (text) => {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 1024 * 1024) throw new Error('Invalid log text.');
  clipboard.writeText(text);
  return { ok:true };
});

/* ---------------- played-song daily logs ----------------
   No Twitch API dependency. Create a timestamped log on the first requested
   song of each local day. Keep at most 10 logs, deleting the oldest first.
*/
let currentSongLogPath = null;
let currentSongLogDate = '';
function songLogDir() {
  const dir = path.join(app.getPath('documents'), 'Aetheris', 'Song Logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function rotateSongLogs() {
  const dir = songLogDir();
  const files = fs.readdirSync(dir)
    .filter(name => /^Aetheris-Songs-.*\.txt$/i.test(name))
    .map(name => {
      const full = path.join(dir, name);
      let stat = null;
      try { stat = fs.statSync(full); } catch (_) {}
      return { full, time: stat?.birthtimeMs || stat?.mtimeMs || 0 };
    })
    .sort((a,b) => a.time - b.time);
  while (files.length > 10) {
    const oldest = files.shift();
    try { fs.unlinkSync(oldest.full); } catch (err) {
      appendAppLog('WARN', 'Could not delete oldest song log', err?.message || String(err));
      break;
    }
  }
}
function ensureCurrentSongLog() {
  const now = new Date();
  const dateKey = [
    now.getFullYear(),
    String(now.getMonth()+1).padStart(2,'0'),
    String(now.getDate()).padStart(2,'0')
  ].join('-');
  if (currentSongLogPath && currentSongLogDate === dateKey && fs.existsSync(currentSongLogPath)) return currentSongLogPath;
  const stamp = [
    now.getFullYear(),
    String(now.getMonth()+1).padStart(2,'0'),
    String(now.getDate()).padStart(2,'0')
  ].join('-') + '_' + [
    String(now.getHours()).padStart(2,'0'),
    String(now.getMinutes()).padStart(2,'0'),
    String(now.getSeconds()).padStart(2,'0')
  ].join('-');
  currentSongLogPath = path.join(songLogDir(), `Aetheris-Songs-${stamp}.txt`);
  currentSongLogDate = dateKey;
  const header = [
    'Aetheris Song Log',
    '=================',
    `Started: ${now.toLocaleString()}`,
    '',
  ].join('\n');
  fs.writeFileSync(currentSongLogPath, header, 'utf8');
  rotateSongLogs();
  return currentSongLogPath;
}
trustedHandle('song-log-append', (song = {}) => {
  const logPath = ensureCurrentSongLog();
  const time = clampString(song.time || new Date().toLocaleTimeString(), 64).replace(/[\r\n]/g, ' ');
  const title = clampString(song.title || 'Untitled', 500).replace(/[\r\n]/g, ' ');
  const artist = clampString(song.artist, 500).replace(/[\r\n]/g, ' ');
  const requester = clampString(song.requester, 200).replace(/[\r\n]/g, ' ');
  const source = clampString(song.source, 80).replace(/[\r\n]/g, ' ');
  const line = `${time} | ${title}${artist ? ' — '+artist : ''}${requester ? ' | Requested by: '+requester : ''}${source ? ' ['+source+']' : ''}\n`;
  fs.appendFileSync(logPath, line, 'utf8');
  return { ok: true, path: logPath };
});
trustedHandle('song-log-info', () => ({ path: currentSongLogPath, folder: songLogDir(), exists: !!currentSongLogPath && fs.existsSync(currentSongLogPath) }));
trustedHandle('song-log-open-folder', async () => {
  const dir = songLogDir();
  const error = await shell.openPath(dir);
  if (error) throw new Error(error);
  return { ok: true, path: dir };
});


function externalResourcePath(fileName) {
  return path.join(app.isPackaged ? process.resourcesPath : __dirname, fileName);
}

function mainUiFilePath() {
  // electron-builder may place files referenced by extraResources outside app.asar.
  // Load the packaged UI from an explicit external resource so the installed app
  // never depends on aetheris.html also being duplicated inside app.asar.
  return app.isPackaged
    ? externalResourcePath('aetheris-ui.html')
    : path.join(__dirname, 'aetheris.html');
}

function obsOverlayFilePath() {
  return app.isPackaged
    ? externalResourcePath('aetheris-overlay.html')
    : path.join(__dirname, 'aetheris.html');
}

trustedHandle('app-get-overlay-base-url', () => overlayRelayUrl());

trustedHandle('app-get-developer-mode', () => developerMode);
trustedHandle('secrets-load', () => loadSecretsFromDisk());
trustedHandle('secrets-save', (payload = {}) => {
  if (!isPlainObject(payload)) throw new Error('Invalid secret-store payload.');
  return saveSecretsToDisk(payload);
});
trustedHandle('backup-protect-secrets', (payload = {}) => {
  if (!isPlainObject(payload)) throw new Error('Invalid backup secret payload.');
  return protectBackupSecrets(payload);
});
trustedHandle('backup-unprotect-secrets', (payload = {}) => unprotectBackupSecrets(payload));
trustedHandle('overlay-state-update', (payload = {}) => {
  if (!isPlainObject(payload)) throw new Error('Invalid overlay state payload.');
  let payloadSize = 0;
  try { payloadSize = Buffer.byteLength(JSON.stringify(payload), 'utf8'); } catch (_) { throw new Error('Overlay state is not serializable.'); }
  if (payloadSize > 128 * 1024) throw new Error('Overlay state payload is too large.');
  overlayRelayState = sanitizeOverlayPayload(payload);
  broadcastOverlayState();
  return { ok: true };
});


trustedHandle('app-runtime-diagnostics', () => {
  const checks = [];
  const pushPath = (name, p, required = true) => {
    let exists = false;
    try { exists = fs.existsSync(p); } catch (_) { exists = false; }
    checks.push({ name, ok: exists || !required, exists, path: p, required });
  };

  pushPath('Main UI', mainUiFilePath());
  pushPath('Preload bridge', path.join(__dirname, 'preload.js'));
  pushPath('YouTube API tutorial', externalResourcePath('aetheris-youtube-api-setup.html'));
  pushPath('OBS overlay resource', obsOverlayFilePath());

  return {
    ok: checks.every((c) => c.ok),
    packaged: app.isPackaged,
    version: app.getVersion(),
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    overlayBaseUrl: overlayRelayUrl(),
    checks,
  };
});


// Loopback redirect for Spotify PKCE — Spotify won't redirect to file://,
// but a local http(s) loopback is the supported pattern for desktop apps.
const SPOTIFY_LOOPBACK_PORT = 43417;
const SPOTIFY_REDIRECT_URI = `http://127.0.0.1:${SPOTIFY_LOOPBACK_PORT}/callback`;
let spotifyAuthServer = null;
let aetherisExitCleanupDone = false;

function cleanupBeforeExit() {
  if (aetherisExitCleanupDone) return;
  aetherisExitCleanupDone = true;
  if (trayRetryTimer) { clearTimeout(trayRetryTimer); trayRetryTimer = null; }
  if (aetherisBotReconnectTimer) { clearTimeout(aetherisBotReconnectTimer); aetherisBotReconnectTimer = null; }
  try { teardownAetherisBotSocket({ manual:true }); } catch (_) {}
  try { teardownYtmdSocket(); } catch (_) {}
  try { teardownSpotifyAuthServer(); } catch (_) {}
  try { stopOverlayRelay(); } catch (_) {}
}


// Single-instance lock: without it, a second launch = a second process
// polling Twitch/YTM Desktop, doubling requests and tripping rate limits.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    // If an installed/tray Aetheris instance is already running and the user
    // launches Aetheris.exe --developer, promote the live instance into
    // Developer Mode instead of discarding the flag with the second process.
    if (Array.isArray(commandLine) && commandLine.includes('--developer') && !developerMode) {
      developerMode = true;
      discordRpcStopped = false;
      connectDiscordDeveloperPresence();
    }
    showMainWindow();
  });

  app.whenReady().then(() => {
    // Developer builds advertise a local-only Discord Rich Presence. Failure to
    // reach Discord is non-fatal and retried quietly while Developer Mode runs.
    connectDiscordDeveloperPresence();
    // Start the localhost OBS relay before the UI so copied Browser Source URLs are immediately live.
    startOverlayRelay();
    // Always create the main window first. A tray/icon problem must never block the UI.
    createWindow();
    createTray();
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    stopDiscordDeveloperPresence();
    cleanupBeforeExit();
  });

  // Aetheris normally stays alive in the system tray. A full app.quit()
  // (tray Exit, updater, installer, OS shutdown) still tears everything down.
  app.on('window-all-closed', () => {
    // If the tray is unavailable there is no way to restore a hidden/headless
    // process. Quit instead of leaving Aetheris running invisibly.
    if (!tray) {
      app.isQuitting = true;
      app.quit();
      return;
    }
    if (app.isQuitting) cleanupBeforeExit();
  });

  app.on('activate', () => {
    showMainWindow();
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray || app.isQuitting) return;

  try {
    const trayIconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'icon.ico')
      : path.join(__dirname, 'icon.ico');

    if (!fs.existsSync(trayIconPath)) throw new Error(`Tray icon not found: ${trayIconPath}`);

    tray = new Tray(trayIconPath);
    trayRetryAttempts = 0;
    if (trayRetryTimer) { clearTimeout(trayRetryTimer); trayRetryTimer = null; }
    tray.setToolTip('Aetheris');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Aetheris', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: 'Exit Aetheris',
        click: () => { app.isQuitting = true; app.quit(); },
      },
    ]));
    tray.on('click', () => showMainWindow());
    tray.on('double-click', () => showMainWindow());
  } catch (err) {
    tray = null;
    trayRetryAttempts += 1;
    appendAppLog('ERROR', 'System tray initialization failed', err?.stack || err?.message || String(err));
    console.error('[tray] Failed to initialize system tray:', err);

    // A failed tray must never strand Aetheris as an invisible background process.
    showMainWindow();
    if (trayRetryAttempts < TRAY_RETRY_MAX && !trayRetryTimer) {
      trayRetryTimer = setTimeout(() => {
        trayRetryTimer = null;
        createTray();
      }, TRAY_RETRY_DELAY_MS);
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    title: 'Aetheris',
    // backgroundColor + show:false together kill the white-flash-on-launch.
    backgroundColor: '#14120f',
    show: false,
    icon: path.join(__dirname, 'icon.ico'), // cosmetic in dev; build.win.icon sets the real .exe icon
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // renderer is sandboxed; privileged work stays behind the validated preload IPC bridge
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: developerMode,
    },
  });

  // Aetheris uses its own UI and tray menu; remove Electron's native
  // application menu entirely so pressing Alt cannot reveal it.
  mainWindow.setMenu(null);

  mainWindow.loadFile(mainUiFilePath());

  // Aetheris does not need browser-level camera, microphone, geolocation,
  // notifications, MIDI, clipboard-read, or other Chromium permissions.
  // Deny them centrally so a renderer compromise cannot silently escalate.
  const rendererSession = mainWindow.webContents.session;
  rendererSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  rendererSession.setPermissionCheckHandler(() => false);

  // The renderer never needs to download arbitrary web content. Updates are
  // handled by electron-updater and local installers use a native file dialog.
  if (!rendererDownloadGuardInstalled) {
    rendererDownloadGuardInstalled = true;
    rendererSession.on('will-download', (event, item, webContents) => {
      if (webContents && webContents.id === mainWindow?.webContents?.id) {
        event.preventDefault();
        appendAppLog('WARN', 'Blocked renderer-initiated download', item?.getURL?.() || 'unknown');
      }
    });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    setupAutoUpdater();
    // The renderer may already have started the paired cloud bridge during
    // bootstrap so its first visible status is accurate. Avoid tearing down
    // that healthy/in-progress socket with a duplicate startup connection.
    if (!aetherisBotStatus.authenticated && !aetherisBotStatus.connecting) {
      connectAetherisBotSocket().catch(err => appendAppLog('WARN', 'AetherisBot startup connect failed', err?.message || String(err)));
    }
  });

  // Prevent the privileged Aetheris renderer from ever navigating away from
  // its own local UI. External pages open in the user's normal browser instead.
  const trustedUiUrl = pathToFileURL(mainUiFilePath()).href;
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== trustedUiUrl) {
      event.preventDefault();
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
          shell.openExternal(url);
        }
      } catch (_) {}
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'file:') {
        const requestedPath = fileURLToPath(url);
        const fileName = path.basename(requestedPath);
        if (fileName === 'aetheris-youtube-api-setup.html') {
          const localPath = externalResourcePath(fileName);
          shell.openPath(localPath).then((error) => {
            if (error) console.error('[link] Could not open local tutorial:', error);
          });
        } else {
          appendAppLog('WARN', 'Blocked unapproved local file open request', requestedPath);
        }
      } else if (parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
        shell.openExternal(url);
      } else {
        appendAppLog('WARN', 'Blocked unapproved external URL scheme', parsed.protocol);
      }
    } catch (err) {
      appendAppLog('WARN', 'Blocked malformed external URL', String(url));
    }
    return { action: 'deny' };
  });

  // Lock the title bar — Electron overwrites it with <title> otherwise.
  mainWindow.on('page-title-updated', (event) => event.preventDefault());

  // Clicking the window X hides Aetheris to the tray instead of stopping it.
  // This keeps Twitch/YTMD processing alive until the user explicitly exits.
  mainWindow.on('close', (event) => {
    if (!app.isQuitting && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Checks GitHub Releases on launch. Updates are never downloaded without
// the user's approval. The renderer shows the update prompt when a newer
// release is found, then explicitly asks the updater to download it.
function setupAutoUpdater() {
  if (!app.isPackaged || autoUpdaterSetupDone) return;
  autoUpdaterSetupDone = true;

  autoUpdater.autoDownload = false;
  autoUpdater.disableWebInstaller = true;

  autoUpdater.on('error', (err) => {
    console.error('[auto-update] error:', err && (err.stack || err.message) || err);
  });

  autoUpdater.on('update-available', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available-event', { version: info.version });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded-event', { version: info.version });
    }
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[auto-update] check failed:', err);
  });
}

trustedHandle('update-check', async () => {
  if (!app.isPackaged) return { available: false, dev: true };
  const result = await autoUpdater.checkForUpdates();
  if (result?.updateInfo?.version && result.updateInfo.version !== app.getVersion()) {
    return { available: true, version: result.updateInfo.version };
  }
  return { available: false, version: app.getVersion() };
});

trustedHandle('update-download', async () => {
  if (!app.isPackaged) throw new Error('Updates are only available in a packaged build.');
  await autoUpdater.downloadUpdate();
  return { ok: true };
});

function launchLocalUpdateInstaller(installerPath) {
  const psQuote = value => `'${String(value).replace(/'/g, "''")}'`;
  // Start-Process returns after launch, not after installation. Waiting for
  // the installer itself would deadlock while NSIS waits for Aetheris to exit.
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    `$installer = Start-Process -FilePath ${psQuote(installerPath)} -ArgumentList @('--updated', '/S', '--force-run') -PassThru -ErrorAction Stop`,
    "if ($null -eq $installer) { throw 'Windows returned no installer process.' }",
    "[Console]::Out.WriteLine('AETHERIS_INSTALLER_STARTED:' + $installer.Id)",
    'exit 0',
    '} catch {',
    '[Console]::Error.WriteLine($_.Exception.Message)',
    'exit 1',
    '}',
  ].join('\r\n');
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let timer;
    let child;
    const finish = (error, pid) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(pid);
    };
    try {
      child = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
      ], { windowsHide:true, stdio:['ignore', 'pipe', 'pipe'] });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-8192); });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
      child.once('error', error => finish(new Error('PowerShell could not start: ' + error.message)));
      child.once('close', code => {
        const match = stdout.match(/(?:^|\r?\n)AETHERIS_INSTALLER_STARTED:(\d+)(?:\r?\n|$)/);
        if (code === 0 && match && Number(match[1]) > 0) finish(null, Number(match[1]));
        else finish(new Error(stderr.trim() || `Installer launch was not confirmed (launcher exit ${code}).`));
      });
      timer = setTimeout(() => {
        finish(new Error('Installer launch confirmation timed out. Check for a Windows approval prompt or running installer before retrying.'));
        try { child.kill(); } catch (_) {}
      }, 120000);
    } catch (error) { finish(error); }
  });
}

// Developer/manual release testing: choose a locally built NSIS installer and
// run it with the same update-style flags electron-updater uses. This lets the
// developer validate the exact installer before publishing it to GitHub.
trustedHandle('update-install-from-file', async () => {
  if (!developerMode) {
    throw new Error('Developer Mode is required to install an update from a local file.');
  }

  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const result = await dialog.showOpenDialog(owner, {
    title: 'Select Aetheris update installer',
    properties: ['openFile'],
    filters: [{ name: 'Aetheris installer', extensions: ['exe'] }],
  });

  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };

  const installerPath = result.filePaths[0];
  if (path.extname(installerPath).toLowerCase() !== '.exe' || !/^Aetheris-Setup-[0-9][A-Za-z0-9._-]*\.exe$/i.test(path.basename(installerPath))) {
    throw new Error('Please select an Aetheris-Setup-<version>.exe installer.');
  }

  // Keep the app visible until Windows confirms that it created the installer
  // process. A launcher error is returned to the existing About-page UI.
  try {
    if (!fs.statSync(installerPath).isFile()) throw new Error('The selected installer is not a file.');
    appendAppLog('INFO', 'Launching local update installer', path.basename(installerPath));
    const pid = await launchLocalUpdateInstaller(installerPath);
    appendAppLog('INFO', 'Local update installer launch confirmed', `pid=${pid}`);
  } catch (err) {
    appendAppLog('ERROR', 'Local update installer launch failed', err?.message || String(err));
    throw new Error('Could not launch the selected installer: ' + (err?.message || err));
  }

  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  setTimeout(() => app.quit(), 100);
  return { ok: true, installerPath };
});

// Hide the window immediately on "Restart now" — quitAndInstall() still has
// to verify + tear down, hiding first avoids a frozen-window gap.
trustedHandle('update-restart-now', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  autoUpdater.quitAndInstall(true, true);
});



trustedHandle('aetheris-bot-status', () => {
  const loaded = loadAetherisBotAuth();
  return {
    ok:true,
    paired:!!loaded.auth,
    userId:loaded.auth?.userId || '',
    connected:!!aetherisBotStatus.connected,
    authenticated:!!aetherisBotStatus.authenticated,
    connecting:!!aetherisBotStatus.connecting,
    lastError:aetherisBotStatus.lastError || '',
    streamStatusKnown:!!aetherisBotStatus.streamStatusKnown,
    streamLive:!!aetherisBotStatus.streamLive,
    streamStatusSource:aetherisBotStatus.streamStatusSource || '',
    streamStatusCheckedAt:Number(aetherisBotStatus.streamStatusCheckedAt || 0),
    twitchAuthorizationKnown:!!aetherisBotStatus.twitchAuthorizationKnown,
    twitchAuthorized:!!aetherisBotStatus.twitchAuthorized,
    twitchAuthReason:aetherisBotStatus.twitchAuthReason || '',
    twitchAuthCheckedAt:Number(aetherisBotStatus.twitchAuthCheckedAt || 0)
  };
});

trustedHandle('aetheris-bot-pair', async () => {
  const start = await aetherisBotJsonRequest('POST', '/desktop/pair/start');
  const pairId = clampString(start.pairId, 128);
  const pairSecret = clampString(start.pairSecret, 128);
  const authorizeUrl = clampString(start.authorizeUrl, 4096);
  if (!/^[a-f0-9]{48}$/i.test(pairId)) throw new Error('AetherisBot returned an invalid pairing ID.');
  if (!/^[a-f0-9]{64}$/i.test(pairSecret)) throw new Error('AetherisBot returned an invalid pairing secret.');
  const parsed = new URL(authorizeUrl);
  if (parsed.origin !== AETHERIS_BOT_API_ORIGIN || parsed.pathname !== '/auth/twitch/connect' || parsed.searchParams.get('pair') !== pairId) {
    throw new Error('AetherisBot returned an unexpected authorization URL.');
  }
  await shell.openExternal(authorizeUrl);
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1800));
    let status;
    try { status = await aetherisBotJsonRequest('POST', '/desktop/pair/status', { pairId, pairSecret }); }
    catch (err) {
      if (/404/.test(err?.message || '')) throw new Error('AetherisBot pairing expired. Please try again.');
      continue;
    }
    if (status.status === 'pending') continue;
    if (status.status !== 'complete') throw new Error('AetherisBot pairing did not complete.');
    const auth = sanitizeAetherisBotAuth({ userId:status.userId, token:status.token });
    if (!auth.userId || !/^[a-f0-9]{64}$/i.test(auth.token)) throw new Error('AetherisBot returned an invalid desktop credential.');
    const saved = saveAetherisBotAuth(auth);
    if (!saved.ok) throw new Error(saved.unavailable ? 'Secure credential storage is unavailable.' : 'Could not securely save the AetherisBot credential.');
    const connected = await connectAetherisBotSocket();
    return { ok:true, userId:auth.userId, connected:!!connected.ok };
  }
  throw new Error('Timed out waiting for Twitch authorization.');
});

trustedHandle('aetheris-bot-connect', async () => connectAetherisBotSocket());
trustedHandle('aetheris-bot-send-chat', async (text) => sendAetherisBotChatReply(text));
trustedHandle('aetheris-bot-disconnect', async (options = {}) => {
  options = isPlainObject(options) ? options : {};
  const forget = options.forget === true;
  const localOnly = options.localOnly === true;
  if (!forget) {
    teardownAetherisBotSocket({ manual:true });
    return { ok:true, paired:true };
  }

  // A failed server revoke must never trap the user in a connected state.
  // localOnly is used only after the renderer gets explicit confirmation.
  if (localOnly) {
    teardownAetherisBotSocket({ manual:true });
    clearAetherisBotAuth();
    appendAppLog('WARN', 'AetherisBot disconnected locally without server revoke');
    return { ok:true, paired:false, revoked:false, localOnly:true };
  }

  const loaded = loadAetherisBotAuth();
  if (!loaded.ok) return { ok:false, reason:loaded.error || 'credential-unavailable' };
  if (!loaded.auth) {
    teardownAetherisBotSocket({ manual:true });
    return { ok:true, paired:false };
  }

  const auth = loaded.auth;
  let revoked;
  try {
    revoked = await aetherisBotJsonRequest('POST', '/desktop/revoke', {
      userId:auth.userId,
      token:auth.token
    });
  } catch (err) {
    appendAppLog('WARN', 'Could not revoke AetherisBot desktop credential', err?.message || String(err));
    return { ok:false, reason:'server-revoke-failed', message:redactSecrets(err?.message || String(err)) };
  }

  if (!revoked?.ok) return { ok:false, reason:'server-revoke-failed' };
  teardownAetherisBotSocket({ manual:true });
  clearAetherisBotAuth();
  return { ok:true, paired:false, revoked:true };
});

function twitchJsonGet(url, token, authScheme, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const cleanToken = String(token || '').trim().replace(/^oauth:/i, '');
    const headers = {
      'Authorization': `${authScheme} ${cleanToken}`,
      'User-Agent': 'Aetheris',
      ...extraHeaders,
    };
    const req = https.get(url, { headers, timeout: 5000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        let data = null;
        try { data = body ? JSON.parse(body) : null; } catch (_) {}
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Twitch API ${res.statusCode}: ${body.slice(0, 220)}`));
          return;
        }
        resolve(data);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Twitch API request timed out')));
    req.on('error', reject);
  });
}

trustedHandle('twitch-live-status', async ({ channel, oauth } = {}) => {
  const login = clampString(channel, 64).trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9_]/g, '');
  const token = clampString(oauth, 4096).trim().replace(/^oauth:/i, '');
  if (!login || !token) return { ok:false, live:false, reason:'missing-channel-or-token' };

  try {
    const validation = await twitchJsonGet(
      'https://id.twitch.tv/oauth2/validate',
      token,
      'OAuth'
    );
    const clientId = validation?.client_id;
    if (!clientId) return { ok:false, live:false, reason:'token-validation-failed' };

    const streams = await twitchJsonGet(
      'https://api.twitch.tv/helix/streams?user_login=' + encodeURIComponent(login),
      token,
      'Bearer',
      { 'Client-Id': clientId }
    );

    return {
      ok:true,
      live:Array.isArray(streams?.data) && streams.data.length > 0,
      checkedAt:Date.now()
    };
  } catch (err) {
    console.warn('[twitch-live-status]', err?.message || err);
    return { ok:false, live:false, reason:err?.message || 'request-failed' };
  }
});

function teardownYtmdSocket() {
  if (ytmdSocket) {
    try { ytmdSocket.disconnect(); } catch (e) { /* ignore */ }
    ytmdSocket = null;
  }
}

// Error/close objects don't survive JSON.stringify (useful fields are
// non-enumerable) — pull them out explicitly so the real reason reaches the log.
function describeErrorLike(d) {
  if (d === null || d === undefined) return null;
  if (d instanceof Error) {
    return { message: d.message, code: d.code, errno: d.errno, syscall: d.syscall, name: d.name };
  }
  if (typeof d === 'object') {
    const out = {};
    for (const k of ['message', 'code', 'errno', 'syscall', 'type', 'status', 'statusCode', 'reason']) {
      if (d[k] !== undefined) out[k] = d[k];
    }
    return Object.keys(out).length ? out : String(d);
  }
  return d;
}

function sendToRenderer(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ytmd-realtime-event', payload);
  }
}

// Opened from the main process (real Node), so no browser Origin header
// gets attached — that header is what YTM Desktop's Companion Server rejects.
trustedHandle('ytmd-realtime-start', ({ host, port, token } = {}) => {
  teardownYtmdSocket();
  host = validLocalHost(host);
  port = validPort(port, 9863);
  token = clampString(token, 8192);

  let socket;
  try {
    // /api/v1/realtime is a Socket.IO namespace, not the Engine.IO path.
    // Passing it as `path` makes the websocket handshake hit the wrong
    // endpoint and YTM Desktop closes the connection (socket hang up).
    socket = io(`http://${host}:${port}/api/v1/realtime`, {
      transports: ['websocket'],
      auth: { token },
      perMessageDeflate: false,
    });
  } catch (e) {
    sendToRenderer({ type: 'setup_error', message: e.message });
    return { ok: false, error: e.message };
  }

  ytmdSocket = socket;

  socket.on('connect', () => sendToRenderer({ type: 'connect' }));
  socket.on('state-update', (state) => sendToRenderer({ type: 'state-update', state }));
  socket.on('connect_error', (err) => {
    sendToRenderer({
      type: 'connect_error',
      message: err && err.message,
      description: describeErrorLike(err && err.description),
      context: err && err.context && err.context.message ? err.context.message : null,
    });
  });
  socket.on('disconnect', (reason) => sendToRenderer({ type: 'disconnect', reason }));
  socket.on('error', (err) => { // some low-level transport failures only surface here
    sendToRenderer({ type: 'connect_error', message: 'socket error', description: describeErrorLike(err) });
  });

  return { ok: true };
});

trustedHandle('ytmd-realtime-stop', () => {
  teardownYtmdSocket();
  return { ok: true };
});

// Lightweight reachability probe used before/retrying realtime. This runs in
// Electron's main process so browser CORS/mixed-content rules cannot turn an
// offline YTMD instance into a stream of misleading renderer fetch errors.
trustedHandle('ytmd-reachability-check', ({ host, port } = {}) => {
  return new Promise((resolve) => {
    const req = http.get({
      hostname: validLocalHost(host),
      port: validPort(port, 9863),
      path: '/metadata',
      timeout: 1500,
    }, (res) => {
      res.resume();
      resolve({ reachable: true, status: res.statusCode || 0 });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ reachable: false, reason: 'timeout' });
    });
    req.on('error', (err) => {
      resolve({ reachable: false, reason: err && (err.code || err.message) });
    });
  });
});

trustedHandle('spotify-get-redirect-uri', () => SPOTIFY_REDIRECT_URI);

function teardownSpotifyAuthServer() {
  if (spotifyAuthServer) {
    try { spotifyAuthServer.close(); } catch (e) { /* ignore */ }
    spotifyAuthServer = null;
  }
}

// Opens the Spotify login in the system browser, listens on the loopback
// server for the redirect, and resolves with the code (or rejects on
// denial/timeout).
trustedHandle('spotify-auth-start', async (authUrl) => {
  const parsedAuthUrl = new URL(clampString(authUrl, 16384));
  if (parsedAuthUrl.protocol !== 'https:' || parsedAuthUrl.hostname !== 'accounts.spotify.com' || !parsedAuthUrl.pathname.startsWith('/authorize')) {
    throw new Error('Blocked an unexpected Spotify authorization URL.');
  }
  authUrl = parsedAuthUrl.toString();
  teardownSpotifyAuthServer();

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      teardownSpotifyAuthServer();
      fn(value);
    };

    const timeout = setTimeout(() => {
      finish(reject, new Error('Timed out waiting for the Spotify login to complete.'));
    }, 120000);

    spotifyAuthServer = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${SPOTIFY_LOOPBACK_PORT}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;background:#14120f;color:#f2eee6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><p>${error ? 'Spotify sign-in failed — you can close this tab and try again.' : 'Spotify connected — you can close this tab and go back to Aetheris.'}</p></body></html>`);
      if (error) finish(reject, new Error('Spotify auth error: ' + error));
      else if (code) finish(resolve, code);
      else finish(reject, new Error('Spotify redirected back without a code or an error.'));
    });

    spotifyAuthServer.on('error', (err) => {
      finish(reject, new Error('Could not start the local auth server: ' + err.message));
    });

    spotifyAuthServer.listen(SPOTIFY_LOOPBACK_PORT, '127.0.0.1', () => {
      shell.openExternal(authUrl);
    });
  });
});
