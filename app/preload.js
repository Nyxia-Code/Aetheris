const { contextBridge, ipcRenderer } = require('electron');
const version = ipcRenderer.sendSync('app-get-version-sync');

const listeners = { state: [], connect: [], connectError: [], disconnect: [], aetherisBotStatus: [], aetherisBotChat: [] };

// Demux main.js's single realtime channel into the separate callbacks the
// renderer registers via window.aetherisBridge.onX(...).
ipcRenderer.on('ytmd-realtime-event', (_event, payload) => {
  if (!payload || !payload.type) return;
  switch (payload.type) {
    case 'connect':
      listeners.connect.forEach((cb) => cb());
      break;
    case 'state-update':
      listeners.state.forEach((cb) => cb(payload.state));
      break;
    case 'connect_error':
    case 'setup_error': {
      const detail = [
        payload.message,
        payload.description !== undefined && payload.description !== null
          ? 'description: ' + JSON.stringify(payload.description)
          : null,
        payload.context ? 'context: ' + payload.context : null,
      ].filter(Boolean).join(' | ');
      listeners.connectError.forEach((cb) => cb(detail));
      break;
    }
    case 'disconnect':
      listeners.disconnect.forEach((cb) => cb(payload.reason));
      break;
  }
});


ipcRenderer.on('aetheris-bot-status', (_event, payload) => {
  listeners.aetherisBotStatus.forEach((cb) => cb(payload));
});
ipcRenderer.on('aetheris-bot-chat-message', (_event, payload) => {
  listeners.aetherisBotChat.forEach((cb) => cb(payload));
});

contextBridge.exposeInMainWorld('aetherisBridge', {
  startRealtime: (opts) => ipcRenderer.invoke('ytmd-realtime-start', opts),
  stopRealtime: () => ipcRenderer.invoke('ytmd-realtime-stop'),
  checkYtmdReachability: (opts) => ipcRenderer.invoke('ytmd-reachability-check', opts),
  onState: (cb) => listeners.state.push(cb),
  onConnect: (cb) => listeners.connect.push(cb),
  onConnectError: (cb) => listeners.connectError.push(cb),
  onDisconnect: (cb) => listeners.disconnect.push(cb),
  version, // from package.json — always matches whatever was actually built
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available-event', (_e, info) => cb(info)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded-event', (_e, info) => cb(info)),
  checkForUpdates: () => ipcRenderer.invoke('update-check'),
  downloadUpdate: () => ipcRenderer.invoke('update-download'),
  installUpdateFromFile: () => ipcRenderer.invoke('update-install-from-file'),
  restartAndInstallUpdate: () => ipcRenderer.invoke('update-restart-now'),
  getSpotifyRedirectUri: () => ipcRenderer.invoke('spotify-get-redirect-uri'),
  startSpotifyAuth: (authUrl) => ipcRenderer.invoke('spotify-auth-start', authUrl),
  getOverlayBaseUrl: () => ipcRenderer.invoke('app-get-overlay-base-url'),
  publishOverlayState: (payload) => ipcRenderer.invoke('overlay-state-update', payload),
  loadSecrets: () => ipcRenderer.invoke('secrets-load'),
  saveSecrets: (payload) => ipcRenderer.invoke('secrets-save', payload),
  protectBackupSecrets: (payload) => ipcRenderer.invoke('backup-protect-secrets', payload),
  unprotectBackupSecrets: (payload) => ipcRenderer.invoke('backup-unprotect-secrets', payload),
  getDeveloperMode: () => ipcRenderer.invoke('app-get-developer-mode'),
  getTwitchLiveStatus: (payload) => ipcRenderer.invoke('twitch-live-status', payload),
  getAetherisBotStatus: () => ipcRenderer.invoke('aetheris-bot-status'),
  pairAetherisBot: () => ipcRenderer.invoke('aetheris-bot-pair'),
  connectAetherisBot: () => ipcRenderer.invoke('aetheris-bot-connect'),
  sendAetherisBotChat: (text) => ipcRenderer.invoke('aetheris-bot-send-chat', text),
  disconnectAetherisBot: (opts) => ipcRenderer.invoke('aetheris-bot-disconnect', opts || {}),
  onAetherisBotStatus: (cb) => listeners.aetherisBotStatus.push(cb),
  onAetherisBotChatMessage: (cb) => listeners.aetherisBotChat.push(cb),
  runRuntimeDiagnostics: () => ipcRenderer.invoke('app-runtime-diagnostics'),
  reportRendererError: (payload) => ipcRenderer.invoke('app-log-renderer-error', payload),
  exportErrorLog: () => ipcRenderer.invoke('app-export-error-log'),
  saveJsonExport: (payload) => ipcRenderer.invoke('app-save-json-export', payload),
  copyLog: (text) => ipcRenderer.invoke('app-copy-log', text),
  appendStreamSongLog: (song) => ipcRenderer.invoke('song-log-append', song),
  getStreamSongLogInfo: () => ipcRenderer.invoke('song-log-info'),
  openStreamSongLogFolder: () => ipcRenderer.invoke('song-log-open-folder'),
});
