/* =========================================================================
   REQUEST DESK — single-file Twitch song request controller + OBS overlay
   ========================================================================= */

const FONT_OPTIONS = [
  {name:"Inter", stack:"'Inter',sans-serif"},
  {name:"Poppins", stack:"'Poppins',sans-serif"},
  {name:"Montserrat", stack:"'Montserrat',sans-serif"},
  {name:"Oswald", stack:"'Oswald',sans-serif"},
  {name:"Bebas Neue", stack:"'Bebas Neue',sans-serif"},
  {name:"Roboto", stack:"'Roboto',sans-serif"},
  {name:"Nunito", stack:"'Nunito',sans-serif"},
  {name:"Space Grotesk", stack:"'Space Grotesk',sans-serif"},
  {name:"DM Sans", stack:"'DM Sans',sans-serif"},
  {name:"Sora", stack:"'Sora',sans-serif"},
  {name:"JetBrains Mono", stack:"'JetBrains Mono',monospace"},
  {name:"Playfair Display", stack:"'Playfair Display',serif"},
];
const loadedFonts = new Set();
function ensureFontLoaded(name){
  if(loadedFonts.has(name)) return;
  loadedFonts.add(name);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(name).replace(/%20/g,'+') + ':wght@400;500;600;700;800&display=swap';
  document.head.appendChild(link);
}
FONT_OPTIONS.forEach(f=>ensureFontLoaded(f.name));

/* ---------------- state ---------------- */
const DEFAULT_STATE = {
  settings:{
    twitch:{
      channel:"", command:"!sr", cooldown:10, botUsername:"", botOAuth:"", notify:true,
      confirmTemplate:'@{user} got it — "{query}" added to the request list.',
      autoRequests:false, // legacy compatibility
      autoRequestMode:null, // manual | spotify | youtube | spotify-fallback; null migrates older autoRequests setting
      nowPlayingCmd:"!song", nowPlayingCmdEnabled:true,
      queueCmd:"!queue", queueCmdEnabled:true,
      customCommands:[],
      announceNowPlaying:false,
      announceTemplate:'🎵 Now playing: {title} — {artist}',
      playbackCmdsModOnly:true,
      skipCmd:"!skip", skipCmdEnabled:false,
      pauseCmd:"!pause", pauseCmdEnabled:false,
      resumeCmd:"!resume", resumeCmdEnabled:false,
      rewindCmd:"!previous", rewindCmdEnabled:false,
      announceOnConnect:false,
      connectAnnounceTemplate:"Aetheris has now initialized 🎶",
      spotifyCommandsEnabled:true,
      youtubeCommandsEnabled:true,
      spotifyPlayback:{skip:null,pause:null,resume:null,rewind:null},
      youtubePlayback:{skip:null,pause:null,resume:null,rewind:null},
      spotifyCommandNames:{skip:'!skip',pause:'!pause',resume:'!resume',rewind:'!previous'},
      youtubeCommandNames:{skip:'!skip',pause:'!pause',resume:'!resume',rewind:'!previous'},
      streamSongLogEnabled:true,
      allowOfflineBotMessages:false // testing/troubleshooting only
    },
    spotify:{clientId:"", connected:false, access_token:"", refresh_token:"", expires_at:0},
    youtube:{apiKey:""},
    youtubeDesktop:{ enabled:false, host:"127.0.0.1", port:9863, appId:"aetheris", token:"", returnPlaylistUrl:"", returnPlaylistShuffle:false },
  },
  theme:{
      font:'JetBrains Mono',
      bg:'#332a35',
      panel:'#262626',
      accent:'#44eed1',
      accent2:'#3ff363',
      text:'#f2eee6',
      radius:10,
      compact:false,
      bgStyle:'glow',
      glowColorEnabled:false,
      glowColor:'#e8a33d',
      glowStrength:50
    },
  overlay:{
    style:"card", // card | compact | neon | cassette | minimal | glow
    font:"Inter",
    bg:"#1c1914", text:"#f2eee6", accent:"#e8a33d",
    transparency:88, // 0-100 percent opacity of bg
    padding:14, gap:14, artSize:64, radius:14, titleSize:16, barHeight:5,
    showArt:true, showProgress:true, showArtist:true, showBadge:true,
    scrollSpeed:40, // px per second
    width:550,
    coverMotion:"none", // none | zoom | spin
    canvasBackdrop:false // blurred, oversized album art filling the whole widget behind everything
  },
  queue:[],        // pending requests from chat: {id,user,query,ts}
  upNext:[],       // Aetheris-resolved tracks waiting to play
  history:[],       // approved/played log
  nowPlaying:null,  // {source,title,artist,art,progressMs,durationMs,isPlaying,uri}
};

function loadState(){
  try{
    const raw = localStorage.getItem('rd_state');
    if(!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return deepMerge(structuredClone(DEFAULT_STATE), parsed);
  }catch(e){ return structuredClone(DEFAULT_STATE); }
}
const BLOCKED_MERGE_KEYS = new Set(['__proto__','prototype','constructor']);
function isPlainObject(value){
  return !!value && typeof value==='object' && !Array.isArray(value) && Object.getPrototypeOf(value)===Object.prototype;
}
function deepMerge(base, extra){
  if(!isPlainObject(base) || !isPlainObject(extra)) return base;
  for(const k of Object.keys(extra)){
    if(BLOCKED_MERGE_KEYS.has(k)) continue;
    const value=extra[k];
    if(isPlainObject(value) && isPlainObject(base[k])) deepMerge(base[k], value);
    else if(Array.isArray(value)) base[k]=structuredClone(value);
    else if(value===null || ['string','number','boolean'].includes(typeof value)) base[k]=value;
  }
  return base;
}
let STATE = loadState();

function secretPayloadFromState(){
  return {
    twitchBotOAuth:String(STATE.settings?.twitch?.botOAuth||''),
    spotifyAccessToken:String(STATE.settings?.spotify?.access_token||''),
    spotifyRefreshToken:String(STATE.settings?.spotify?.refresh_token||''),
    youtubeApiKey:String(STATE.settings?.youtube?.apiKey||''),
    ytmdToken:String(STATE.settings?.youtubeDesktop?.token||'')
  };
}
const LEGACY_SECRETS_AT_LOAD = secretPayloadFromState();
function applySecretsToState(secrets={}){
  if(!STATE.settings) return;
  STATE.settings.twitch.botOAuth=String(secrets.twitchBotOAuth||'');
  STATE.settings.spotify.access_token=String(secrets.spotifyAccessToken||'');
  STATE.settings.spotify.refresh_token=String(secrets.spotifyRefreshToken||'');
  STATE.settings.youtube.apiKey=String(secrets.youtubeApiKey||'');
  STATE.settings.youtubeDesktop.token=String(secrets.ytmdToken||'');
}
function storageSafeState(){
  const copy=structuredClone(STATE);
  if(copy.settings?.twitch) copy.settings.twitch.botOAuth='';
  if(copy.settings?.spotify){ copy.settings.spotify.access_token=''; copy.settings.spotify.refresh_token=''; }
  if(copy.settings?.youtube) copy.settings.youtube.apiKey='';
  if(copy.settings?.youtubeDesktop) copy.settings.youtubeDesktop.token='';
  return copy;
}
function persistLocalState(){
  try{ localStorage.setItem('rd_state', JSON.stringify(storageSafeState())); }catch(_){}
}
async function persistSecretsNow(){
  if(!window.aetherisBridge?.saveSecrets) return {ok:false, unavailable:true};
  const result=await window.aetherisBridge.saveSecrets(secretPayloadFromState());
  if(result && result.ok===false) throw new Error(result.error || (result.unavailable ? 'secure-storage-unavailable' : 'secure-storage-save-failed'));
  return result || {ok:true};
}
async function hydrateSecureSecrets(){
  const legacy=LEGACY_SECRETS_AT_LOAD;
  if(!window.aetherisBridge?.loadSecrets) return;
  try{
    const result=await window.aetherisBridge.loadSecrets();
    if(result && result.ok===false && !result.secrets) throw new Error(result.error || 'secure-storage-load-failed');
    const secure=result?.secrets||{};
    // Merge field-by-field so a partially migrated secure store cannot erase a
    // still-valid legacy credential on first launch after upgrading.
    const merged={...secure};
    let changed=false;
    for(const [key,value] of Object.entries(legacy)){
      if(!String(merged[key]||'') && String(value||'')){
        merged[key]=String(value);
        changed=true;
      }
    }
    applySecretsToState(merged);
    if(changed) await persistSecretsNow();
    persistLocalState();
  }catch(e){ console.warn('Secure credential storage unavailable; keeping credentials in memory for this session.', e); }
}

function normalizeCommandTrigger(value, fallback){
  const raw=String(value||'').trim() || fallback;
  return raw.startsWith('!') ? raw : '!'+raw;
}

// Repair command triggers from older/custom configs once at startup. Keep the
// same normalization at save/match time below so imported settings are safe too.
{
  const twitch=STATE.settings.twitch;
  const normalized={
    command:normalizeCommandTrigger(twitch.command,'!sr'),
    nowPlayingCmd:normalizeCommandTrigger(twitch.nowPlayingCmd,'!song'),
    queueCmd:normalizeCommandTrigger(twitch.queueCmd,'!queue')
  };
  if(normalized.command!==twitch.command || normalized.nowPlayingCmd!==twitch.nowPlayingCmd || normalized.queueCmd!==twitch.queueCmd){
    Object.assign(twitch, normalized);
    persistLocalState();
  }
}


// v1.3.0 queue/history migration.
// Older builds wrote "Recently Played" at queue time, so a stale Up Next item
// can survive even though that same request is already shown in history. Those
// old pairs have nearly identical timestamps. Remove only those paired legacy
// entries; new builds record history only when playback actually starts.
(function reconcileLegacyUpNext(){
  try{
    const migrationKey='aetheris_upnext_playback_migration_v130_2';
    if(localStorage.getItem(migrationKey)==='1') return;
    const norm=x=>String(x||'').toLowerCase().replace(/&amp;/g,'&').replace(/[^a-z0-9]+/g,' ').replace(/\\s+/g,' ').trim();
    const src=x=>x==='ytmdesktop'?'youtube':x;
    if(Array.isArray(STATE.upNext) && Array.isArray(STATE.history)){
      STATE.upNext=STATE.upNext.filter(q=>{
        return !STATE.history.some(h=>
          src(h?.source)===src(q?.source) &&
          norm(h?.title)===norm(q?.title) &&
          Math.abs(Number(h?.ts||0)-Number(q?.ts||0))<=15000
        );
      });
      persistLocalState();
    }
    localStorage.setItem(migrationKey,'1');
  }catch(e){ console.warn('Legacy Up Next reconciliation failed:',e); }
})();

// Send renderer failures into the persistent app-wide support log.
const _consoleError=console.error.bind(console), _consoleWarn=console.warn.bind(console);
console.error=(...args)=>{ try{ window.aetherisBridge?.reportRendererError?.({level:'ERROR',message:args.map(x=>x?.stack||x?.message||String(x)).join(' ')}); }catch(_){} _consoleError(...args); };
console.warn=(...args)=>{ try{ window.aetherisBridge?.reportRendererError?.({level:'WARN',message:args.map(x=>x?.stack||x?.message||String(x)).join(' ')}); }catch(_){} _consoleWarn(...args); };
window.addEventListener('error', (e)=>{
  window.aetherisBridge?.reportRendererError?.({level:'ERROR',message:e.message||'Renderer error',detail:`${e.filename||''}:${e.lineno||''}:${e.colno||''}`});
});
window.addEventListener('unhandledrejection', (e)=>{
  const r=e.reason;
  window.aetherisBridge?.reportRendererError?.({level:'ERROR',message:'Unhandled renderer promise rejection',detail:r?.stack||r?.message||String(r||'')});
});

const SESSION = (()=>{
  const fresh = { startedAt:Date.now(), requests:0, queued:0, rejected:0, failed:0 };
  try{
    const raw=sessionStorage.getItem('aetheris_session_stats');
    if(raw){
      const parsed=JSON.parse(raw);
      return Object.assign(fresh, parsed);
    }
    sessionStorage.setItem('aetheris_session_stats', JSON.stringify(fresh));
  }catch(e){}
  return fresh;
})();
function saveSessionStats(){ try{ sessionStorage.setItem('aetheris_session_stats', JSON.stringify(SESSION)); }catch(e){} }
function bumpSessionStat(key, amount=1){ SESSION[key]=(SESSION[key]||0)+amount; saveSessionStats(); updateDashboardLive(); }
function sessionElapsedLabel(){
  const total=Math.max(0,Math.floor((Date.now()-SESSION.startedAt)/1000));
  const h=Math.floor(total/3600), m=Math.floor((total%3600)/60), sec=total%60;
  if(h) return h+'h '+String(m).padStart(2,'0')+'m';
  return m+':'+String(sec).padStart(2,'0');
}
let autoRequestBusy=false;
let saveTimer=null;
function saveState(broadcast=true){
  persistLocalState();
  try{ persistSecretsNow().catch(()=>{}); }catch(_){}
  try{ window.aetherisBridge?.publishOverlayState?.({nowPlaying:STATE.nowPlaying,overlay:STATE.overlay})?.catch?.(()=>{}); }catch(_){}
  if(broadcast) bc.postMessage({type:'state', state:storageSafeState()});
}
const bc = ('BroadcastChannel' in window) ? new BroadcastChannel('rd_channel') : {postMessage(){}, onmessage:null};
window.addEventListener('storage', (e)=>{
  if(e.key==='rd_state' && e.newValue){
    try{ { const sec=secretPayloadFromState(); STATE = deepMerge(structuredClone(DEFAULT_STATE), JSON.parse(e.newValue)); applySecretsToState(sec); onStateSync(); } }catch(err){}
  }
});
if(bc.addEventListener) bc.addEventListener('message',(e)=>{
  if(e.data && e.data.type==='state'){ { const sec=secretPayloadFromState(); STATE = deepMerge(structuredClone(DEFAULT_STATE), e.data.state); applySecretsToState(sec); onStateSync(); } }
});

let twitchSocket = null;
let aetherisBotBridgeStatus = { paired:false, connected:false, authenticated:false, connecting:false, userId:'', lastError:'', twitchAuthorizationKnown:false, twitchAuthorized:false, twitchAuthReason:'' };
let ovLastSignature = null;
let ytmdToken = null;
let ytmdPollHandle = null;
let ytmdPendingQueue = [];
// Timing watchdog for queued-song/rejoin transitions. Instead of relying on
// one long timeout (which becomes wrong if the user scrubs/seeks), this checks
// the live YTMD progress repeatedly and only fires once the track is actually
// within the final 500ms.
let ytmdEarlySwapTimer = null;
let ytmdTimingWatchHandle = null;
let ytmdLastVideoId = null;
const ytmdLog = [];
let ytmdSocket = null;
let ytmdOriginalPlaylistId = null;
let ytmdNeedsReturnToPlaylist = false;
let ytmdPollBackoffUntil = 0;
let ytmdSelfChange = null; // videoId (or '__playlist_rejoin__') we just told YTMD to switch to ourselves
let ytmdShufflePendingTarget = null; // playlist id waiting for a real YTMD shuffle toggle after rejoin

// renderSettings() is sync but the redirect URI comes from the main
// process — fetch once and cache, falling back to the old guess until then.
let cachedSpotifyRedirectUri = location.origin + location.pathname;
(async function initSpotifyRedirectUri(){
  if(window.aetherisBridge?.getSpotifyRedirectUri){
    try{
      cachedSpotifyRedirectUri = await window.aetherisBridge.getSpotifyRedirectUri();
      if(document.getElementById('view-settings')?.innerHTML) renderSettings();
    }catch(e){ /* keep the fallback */ }
  }
})();
let ytmdUsingBridge = false; // true when the realtime channel is running via the Electron main process instead of an in-page socket
let ytmdAvailabilityWatchHandle = null;
let ytmdOfflineMessageShown = false;
let ytmdAvailabilityCheckInFlight = false;

function logYtmd(msg){
  const line = '['+new Date().toLocaleTimeString()+'] '+msg;
  ytmdLog.push(line);
  if(ytmdLog.length>50) ytmdLog.shift();
  console.log('[YTMDesktop]', msg);
  const el = document.getElementById('ytmd-log');
  if(el){ el.textContent = ytmdLog.join('\n'); el.scrollTop = el.scrollHeight; }
}
let twitchChannel = null;
let twitchJoined = false;
const cmdCooldowns = new Map();
const twitchLog = [];
function logTwitch(msg){
  const line = '['+new Date().toLocaleTimeString()+'] '+msg;
  twitchLog.push(line);
  if(twitchLog.length>50) twitchLog.shift();
  console.log('[Twitch]', msg);
  const el = document.getElementById('tw-log');
  if(el){ el.textContent = twitchLog.join('\n'); el.scrollTop = el.scrollHeight; }
}
const cooldowns = new Map();
let spotifyPollHandle = null;

let activePlaybackSource = null; // 'spotify' | 'ytmdesktop' | null

function normalizePlaybackSource(source){
  return source === 'youtube' ? 'ytmdesktop' : source;
}

function preferredPlaybackSource(){
  const mode = getAutoRequestMode();
  if(mode === 'youtube') return 'ytmdesktop';
  if(mode === 'spotify' || mode === 'spotify-fallback') return 'spotify';
  return null;
}

function claimPlaybackSource(source, reason='explicit action'){
  source = normalizePlaybackSource(source);
  if(source !== 'spotify' && source !== 'ytmdesktop') return;
  if(activePlaybackSource !== source){
    console.log('[Playback] Active source -> ' + source + ' (' + reason + ')');
    activePlaybackSource = source;
  }
}

function getActivePlaybackSource(){
  const current = normalizePlaybackSource(activePlaybackSource);
  if(current) return current;

  const preferred = preferredPlaybackSource();
  if(preferred) return preferred;

  const nowPlayingSource = normalizePlaybackSource(STATE.nowPlaying?.source);
  if(nowPlayingSource === 'spotify' || nowPlayingSource === 'ytmdesktop') return nowPlayingSource;

  return null;
}

function shouldAcceptPlaybackUpdate(source){
  source = normalizePlaybackSource(source);
  if(source !== 'spotify' && source !== 'ytmdesktop') return true;

  if(!activePlaybackSource){
    const preferred = preferredPlaybackSource();
    activePlaybackSource = preferred || source;
    console.log('[Playback] Initial active source -> ' + activePlaybackSource);
  }
  return activePlaybackSource === source;
}

let currentOverlayPreviewFn = null;
const OVERLAY_PRESETS = [
  {id:'card', name:'Card'},
  {id:'compact', name:'Compact pill'},
  {id:'neon', name:'Neon glow'},
  {id:'cassette', name:'Cassette'},
  {id:'minimal', name:'Minimal'},
];

function onStateSync(){
  applyTheme();
  if(IS_OVERLAY) renderOverlay();
  else { renderDashboard(); renderQueue(); applyOverlayVarsPreviewIfOpen(); }
}

/* ---------------- toast ---------------- */
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(()=>t.classList.remove('show'), 2600);
}

/* ---------------- theme ---------------- */
function applyTheme(){
  const th = STATE.theme;
  const r = document.documentElement.style;
  r.setProperty('--bg', th.bg);
  r.setProperty('--panel', th.panel);
  r.setProperty('--panel-translucent', hexToRgba(th.panel, 88));
  r.setProperty('--panel-2', shade(th.panel, 6));
  r.setProperty('--line', shade(th.panel, 16));
  r.setProperty('--accent', th.accent);
  r.setProperty('--accent-2', th.accent2||'#4fd1c5');
  r.setProperty('--text', th.text);
  r.setProperty('--text-dim', shade(th.text, -45));
  r.setProperty('--radius', th.radius+'px');
  const fontObj = FONT_OPTIONS.find(f=>f.name===th.font) || FONT_OPTIONS[0];
  ensureFontLoaded(fontObj.name);
  r.setProperty('--font-body', fontObj.stack);
  r.setProperty('--btn-text', contrastColor(th.accent));
  document.body.classList.toggle('compact', !!th.compact);
  document.body.classList.remove('bg-grain','bg-glow','bg-flat');
  document.body.classList.add('bg-'+(th.bgStyle||'grain'));
  const glowBase = th.glowColorEnabled ? th.glowColor : th.accent;
  const glowStrength = (th.glowStrength ?? 50) / 100;
  r.setProperty('--bg-glow-color', hexToRgba(glowBase, Math.round(glowStrength*56)));
  r.setProperty('--bg-glow-color-2', hexToRgba(glowBase, Math.round(glowStrength*28)));
}
function shade(hex, percent){
  const {r,g,b} = hexToRgb(hex);
  const f = percent/100;
  const nr = Math.min(255,Math.max(0, r + (f>0?(255-r)*f:r*f)));
  const ng = Math.min(255,Math.max(0, g + (f>0?(255-g)*f:g*f)));
  const nb = Math.min(255,Math.max(0, b + (f>0?(255-b)*f:b*f)));
  return rgbToHex(nr,ng,nb);
}
function hexToRgb(hex){
  hex = hex.replace('#','');
  if(hex.length===3) hex = hex.split('').map(c=>c+c).join('');
  const num = parseInt(hex,16);
  return {r:(num>>16)&255, g:(num>>8)&255, b:num&255};
}
function rgbToHex(r,g,b){
  return '#'+[r,g,b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
}
function contrastColor(hex){
  const {r,g,b} = hexToRgb(hex);
  const yiq = (r*299+g*587+b*114)/1000;
  return yiq >= 150 ? '#14120f' : '#ffffff';
}
function hexToRgba(hex, alphaPct){
  const {r,g,b} = hexToRgb(hex);
  return `rgba(${r},${g},${b},${(alphaPct/100).toFixed(2)})`;
}

/* =========================================================================
   ROUTING / SHELL (control panel)
   ========================================================================= */
// Overlay routing accepts the new localhost relay fragment and legacy v1.3.0
// fragments for backward compatibility. New URLs never carry service credentials.
function readOverlayParams(){
  const hashStr = location.hash && location.hash.length>1 ? location.hash.slice(1) : '';
  const hashParams = new URLSearchParams(hashStr);
  if(hashParams.has('view')) return hashParams;
  return new URLSearchParams(location.search);
}
const params = readOverlayParams();
const IS_OVERLAY = params.get('view')==='overlay';

// Connection-state variables used during buildAppShell() must exist before
// the shell starts. This prevents Temporal Dead Zone startup failures.
let twitchChannelLive = null;
let twitchLiveStatusTimer = null;
let twitchLiveStatusInFlight = false;
let twitchOfflineSuppressionLogged = false;

window.aetherisBridge?.onAetherisBotStatus?.((status)=>{
  const wasAuthenticated=!!aetherisBotBridgeStatus.authenticated;
  applyAetherisBotBridgeStatus(status||{});
  if(status?.authenticated && !wasAuthenticated) logTwitch('AetherisBot cloud bridge authenticated.');
  else if(wasAuthenticated && !status?.authenticated) logTwitch('AetherisBot cloud bridge disconnected.');
});
window.aetherisBridge?.onAetherisBotChatMessage?.((event)=>{
  const username = event?.chatterUserLogin || event?.chatter_user_login || event?.chatterUserName || event?.chatter_user_name || 'unknown';
  const displayName = event?.chatterUserName || event?.chatter_user_name || username;
  const message = event?.messageText || event?.message?.text || '';
  const badges = Array.isArray(event?.badges) ? event.badges : [];
  const badgeTag = badges.map((badge)=>{
    const setId = badge?.set_id || badge?.setId || '';
    const id = badge?.id || badge?.version || '';
    return setId && id ? `${setId}/${id}` : '';
  }).filter(Boolean).join(',');
  const tags = {
    'display-name': displayName,
    'badges': badgeTag,
    'mod': badges.some((badge)=> (badge?.set_id || badge?.setId) === 'moderator') ? '1' : '0',
    'id': event?.messageId || event?.message_id || ''
  };

  logTwitch(`[cloud] ${username}: ${message}`);
  onTwitchMessage(username, tags, message);
});

async function bootstrapAetheris(){
  if(IS_OVERLAY){
    buildOverlayShell();
    return;
  }
  await hydrateSecureSecrets();
  await refreshAetherisBotBridgeStatus();

  // If this installation is already paired, give the cloud bridge a brief
  // chance to authenticate before the Settings UI is first painted. This
  // prevents the normal startup path from flashing "paired / offline" or
  // "waiting for the cloud bridge" even though the backend is healthy.
  if(aetherisBotBridgeStatus.paired && !aetherisBotBridgeStatus.authenticated){
    try{
      await Promise.race([
        window.aetherisBridge?.connectAetherisBot?.(),
        new Promise(resolve=>setTimeout(resolve, 2500))
      ]);
      await refreshAetherisBotBridgeStatus();
    }catch(e){
      console.warn('AetherisBot startup bridge connect did not finish before UI render:', e);
    }
  }

  buildAppShell();
  initSidebarVersionChangelog();
}
bootstrapAetheris().catch((err)=>{
  console.error('Aetheris startup failed:', err);
  const appEl=document.getElementById('app');
  if(appEl) appEl.textContent='Aetheris could not finish starting. Check the error log from About → Diagnostics.';
});

/* ---------------- overlay shell ---------------- */
function buildOverlayShell(){
  document.body.classList.add('overlay-mode');
  document.getElementById('app').innerHTML = `<div id="overlay-root"></div>`;

  applyTheme();
  renderOverlay();
  setInterval(renderOverlay, 500);

  if(params.get('relay')==='1'){
    const parts=location.pathname.split('/').filter(Boolean);
    const token=parts[parts.length-1]||'';
    if(!/^[a-f0-9]{64}$/i.test(token)){
      console.error('OBS relay URL is missing a valid session token.');
      return;
    }
    const eventUrl=location.origin+'/events/'+token;
    const events=new EventSource(eventUrl);
    events.onmessage=(event)=>{
      try{
        const payload=JSON.parse(event.data||'{}');
        if(payload.overlay && isPlainObject(payload.overlay)) STATE.overlay=deepMerge(structuredClone(DEFAULT_STATE.overlay), payload.overlay);
        STATE.nowPlaying=payload.nowPlaying||null;
        renderOverlay();
      }catch(e){ console.error('Could not apply OBS relay update',e); }
    };
    events.onerror=()=>{};
    return;
  }

  // Backward compatibility for old v1.3.0 Browser Source URLs. New URLs use
  // the localhost relay and never carry Spotify/YTMD credentials.
  const cfgParam = params.get('cfg');
  if(cfgParam){
    try{
      const parsed = JSON.parse(decodeURIComponent(escape(atob(cfgParam))));
      if(isPlainObject(parsed)) STATE.overlay = deepMerge(structuredClone(DEFAULT_STATE.overlay), parsed);
    }catch(e){ console.error('Could not parse embedded overlay config', e); }
  }
  // Legacy v1.3.0 URLs may still contain credentials. Honor them only so an
  // existing OBS source does not immediately break; newly generated URLs never
  // include these values and users should replace old URLs with the relay URL.
  const spClient=params.get('sp_client'), spRefresh=params.get('sp_refresh');
  if(spClient && spRefresh){
    STATE.settings.spotify.clientId=String(spClient).slice(0,200);
    STATE.settings.spotify.refresh_token=String(spRefresh).slice(0,8192);
    STATE.settings.spotify.expires_at=0;
    try{ startSpotifyPolling(); }catch(e){ console.error('Legacy overlay Spotify startup failed:',e); }
  }
  const ytmdHost=params.get('ytmd_host'), ytmdPort=params.get('ytmd_port'), ytmdTokenParam=params.get('ytmd_token');
  if(ytmdHost && ytmdTokenParam){
    STATE.settings.youtubeDesktop.host=ytmdHostAddr(ytmdHost);
    STATE.settings.youtubeDesktop.port=Math.min(65535,Math.max(1,parseInt(ytmdPort)||9863));
    STATE.settings.youtubeDesktop.token=String(ytmdTokenParam).slice(0,8192);
    STATE.settings.youtubeDesktop.enabled=true;
    try{ startYtmdRealtime(); }catch(e){ console.error('Legacy overlay YTMD startup failed:',e); }
  }
}


function startOverlayMarquee(wrap, inner, speedPxPerSec){
  if(!wrap || !inner) return;

  // Cancel any prior Web Animation when a preview/style refresh rebuilds or
  // recalculates the marquee.
  try{
    if(inner.__aetherisMarqueeAnimation){
      inner.__aetherisMarqueeAnimation.cancel();
      inner.__aetherisMarqueeAnimation = null;
    }
  }catch(_){}

  inner.style.transform='translateX(0px)';
  wrap.classList.remove('is-scrolling');

  const first=inner.querySelector('.marquee-copy');
  if(!first) return;

  // Measure after layout. The duplicated copy plus the 40px flex gap creates
  // the seamless wrap point.
  const firstWidth=Math.ceil(first.getBoundingClientRect().width);
  const viewportWidth=Math.floor(wrap.getBoundingClientRect().width);

  // Short titles do not need to move.
  if(firstWidth <= viewportWidth + 4) return;

  // Overflow confirmed: reveal the duplicate copy only while scrolling.
  wrap.classList.add('is-scrolling');

  const gap=40;
  const distance=firstWidth + gap;
  const speed=Math.max(5, Number(speedPxPerSec)||35);
  const duration=Math.max(1500, (distance/speed)*1000);

  // Web Animations API is considerably more reliable in both Electron and
  // OBS's Chromium/CEF Browser Source than the old CSS calc() transform.
  if(typeof inner.animate === 'function'){
    const anim=inner.animate(
      [
        {transform:'translateX(0px)'},
        {transform:`translateX(-${distance}px)`}
      ],
      {
        duration,
        iterations:Infinity,
        easing:'linear'
      }
    );
    inner.__aetherisMarqueeAnimation=anim;
  }else{
    // Older Chromium fallback: inject concrete keyframes with no CSS math.
    const name='aetheris-marquee-'+Math.random().toString(36).slice(2);
    const style=document.createElement('style');
    style.dataset.aetherisMarquee='1';
    style.textContent=`@keyframes ${name}{from{transform:translateX(0px)}to{transform:translateX(-${distance}px)}}`;
    document.head.appendChild(style);
    inner.style.animation=`${name} ${duration}ms linear infinite`;
  }
}

function scheduleOverlayMarquee(wrapId, innerId, speedPxPerSec){
  // Two frames ensures flex sizing/font layout has settled in Electron and OBS.
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const wrap=document.getElementById(wrapId);
    const inner=document.getElementById(innerId);
    startOverlayMarquee(wrap, inner, speedPxPerSec);
  }));
}

function renderOverlay(){
  const ov = STATE.overlay;
  const np = STATE.nowPlaying;
  const root = document.getElementById('overlay-root');
  if(!root) return;

  // Only rebuild the DOM (restarts the marquee animation) when the track or
  // style actually changed; otherwise just nudge the progress bar/timestamp.
  const sig = JSON.stringify([ov.style, ov.font, ov.bg, ov.text, ov.accent, ov.padding, ov.gap, ov.artSize, ov.radius, ov.titleSize, ov.barHeight, ov.width, ov.transparency, ov.scrollSpeed, ov.showArt, ov.showProgress, ov.showArtist, ov.showBadge, ov.coverMotion, ov.canvasBackdrop, np?.title, np?.artist, np?.art, np?.source, !!np]);

  if(sig === ovLastSignature && np){
    const shownProgress = displayProgressMs(np);
    const pct = np.durationMs ? Math.min(100, (shownProgress/np.durationMs)*100) : 0;
    const fill = root.querySelector('.ov-progress .fill');
    const badge = root.querySelector('.ov-badge');
    if(fill) fill.style.width = pct+'%';
    if(badge) badge.textContent = fmtTime(shownProgress)+' / '+fmtTime(np.durationMs||0)+(ov.showBadge ? ' · '+(np.source||'') : '');
    return;
  }
  ovLastSignature = sig;

  const bgAlpha = hexToRgba(ov.bg, ov.transparency);
  const styleVars = `
    --ov-bg:${bgAlpha};
    --ov-text:${ov.text};
    --ov-accent:${ov.accent};
    --ov-pad:${ov.padding}px;
    --ov-gap:${ov.gap}px;
    --ov-art:${ov.artSize}px;
    --ov-radius:${ov.radius}px;
    --ov-titlesize:${ov.titleSize}px;
    --ov-barheight:${ov.barHeight}px;
    --ov-width:${ov.width}px;
    --ov-font:${(FONT_OPTIONS.find(f=>f.name===ov.font)||FONT_OPTIONS[0]).stack};
    ${ov.canvasBackdrop && np?.art ? `--ov-backdrop-img:url('${cssUrlSafe(np.art)}');` : ''}
  `;

  if(!np){
    root.innerHTML = `<div class="ov-widget style-${ov.style}" style="${styleVars};opacity:.85">
      <div class="ov-body"><div class="ov-title" style="opacity:.6">Nothing playing</div></div>
    </div>`;
    return;
  }

  const shownProgress = displayProgressMs(np);
  const pct = np.durationMs ? Math.min(100, (shownProgress/np.durationMs)*100) : 0;
  const curT = fmtTime(shownProgress);
  const durT = fmtTime(np.durationMs||0);
  const artClass = ov.coverMotion==='zoom' ? 'motion-zoom' : (ov.coverMotion==='spin' ? 'motion-spin' : '');

  root.innerHTML = `
    <div class="ov-widget style-${ov.style}" style="${styleVars}">
      ${ov.canvasBackdrop && np.art ? `<div class="ov-backdrop"></div>` : ``}
      ${ov.showArt ? `<img class="ov-art ${artClass}" src="${escapeHtml(np.art||'')}" alt="">` : ``}
      <div class="ov-body">
        <div class="ov-marquee ov-title" id="ov-marquee"><span class="inner" id="ov-marquee-inner"><span class="marquee-copy">${escapeHtml(np.title||'Untitled')}</span><span class="marquee-copy" aria-hidden="true">${escapeHtml(np.title||'Untitled')}</span></span></div>
        ${ov.showArtist ? `<div class="ov-artist">${escapeHtml(np.artist||'')}</div>` : ``}
        ${ov.showProgress ? `
          <div class="ov-progress"><div class="fill" style="width:${pct}%"></div></div>
          <div class="ov-badge">${curT} / ${durT}${ov.showBadge ? ' · '+escapeHtml(np.source||'') : ''}</div>
        ` : (ov.showBadge ? `<div class="ov-badge">${escapeHtml(np.source||'')}</div>` : ``)}
      </div>
    </div>`;

  scheduleOverlayMarquee('ov-marquee','ov-marquee-inner',ov.scrollSpeed);
}
function fmtTime(ms){
  const s = Math.floor(ms/1000);
  const m = Math.floor(s/60);
  const rem = s%60;
  return m+':'+String(rem).padStart(2,'0');
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// For interpolating a value inside a CSS url('...') — escapes characters
// that could otherwise break out of the quoted CSS string.
function cssUrlSafe(s){
  return String(s).replace(/['"()\\]/g, c=>'\\'+c);
}

function normalizeHexColor(value, fallback='#ffffff'){
  let v=String(value||'').trim();
  if(!v.startsWith('#')) v='#'+v;
  if(/^#[0-9a-fA-F]{3}$/.test(v)){
    v='#'+v[1]+v[1]+v[2]+v[2]+v[3]+v[3];
  }
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback.toLowerCase();
}

function hexToHsv(hex){
  hex=normalizeHexColor(hex);
  const r=parseInt(hex.slice(1,3),16)/255;
  const g=parseInt(hex.slice(3,5),16)/255;
  const b=parseInt(hex.slice(5,7),16)/255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  let h=0;
  if(d!==0){
    if(max===r) h=60*(((g-b)/d)%6);
    else if(max===g) h=60*(((b-r)/d)+2);
    else h=60*(((r-g)/d)+4);
  }
  if(h<0) h+=360;
  const s=max===0?0:d/max;
  return {h,s,v:max};
}

function hsvToHex(h,s,v){
  h=((Number(h)%360)+360)%360;
  s=Math.max(0,Math.min(1,Number(s)));
  v=Math.max(0,Math.min(1,Number(v)));
  const c=v*s;
  const x=c*(1-Math.abs((h/60)%2-1));
  const m=v-c;
  let r=0,g=0,b=0;
  if(h<60){r=c;g=x;}
  else if(h<120){r=x;g=c;}
  else if(h<180){g=c;b=x;}
  else if(h<240){g=x;b=c;}
  else if(h<300){r=x;b=c;}
  else{r=c;b=x;}
  const toHex=n=>Math.round((n+m)*255).toString(16).padStart(2,'0');
  return '#'+toHex(r)+toHex(g)+toHex(b);
}

function colorSwatchControl(id,label,val){
  const hex=normalizeHexColor(val);
  return `<div class="swatch">
    <button type="button" class="color-chip" data-color-target="${id}" style="--chip-color:${hex}" aria-label="Choose ${escapeHtml(label)} color"></button>
    <input type="text" class="color-hex" id="${id}" value="${hex}" maxlength="7" spellcheck="false" autocomplete="off">
    <span>${escapeHtml(label)}</span>
  </div>`;
}

let activeAetherisColorInput=null;
let aetherisPickerState={h:0,s:0,v:1};

function ensureAetherisColorPicker(){
  let picker=document.getElementById('aetheris-color-picker');
  if(picker) return picker;

  picker=document.createElement('div');
  picker.id='aetheris-color-picker';
  picker.className='aetheris-color-picker';
  picker.hidden=true;
  picker.innerHTML=`
    <div class="cp-main">
      <div class="cp-sv" id="cp-sv"><div class="cp-marker" id="cp-marker"></div></div>
      <div class="cp-brightness-wrap">
        <input class="cp-brightness" id="cp-brightness" type="range" min="5" max="100" step="1" value="100" aria-label="Brightness">
      </div>
    </div>
    <input class="cp-hue" id="cp-hue" type="range" min="0" max="359" step="1" value="0">
    <div class="cp-row">
      <div class="cp-preview" id="cp-preview"></div>
      <input class="cp-input" id="cp-input" type="text" maxlength="7" spellcheck="false">
      <button type="button" class="btn ghost small cp-close" id="cp-close">Done</button>
    </div>`;
  document.body.appendChild(picker);

  const sv=picker.querySelector('#cp-sv');
  const hue=picker.querySelector('#cp-hue');
  const brightness=picker.querySelector('#cp-brightness');
  const input=picker.querySelector('#cp-input');
  const close=picker.querySelector('#cp-close');

  function pickSv(ev){
    const r=sv.getBoundingClientRect();
    aetherisPickerState.s=Math.max(0,Math.min(1,(ev.clientX-r.left)/r.width));
    aetherisPickerState.v=Math.max(0,Math.min(1,1-(ev.clientY-r.top)/r.height));
    applyAetherisPickerColor();
  }

  sv.addEventListener('pointerdown',ev=>{
    sv.setPointerCapture?.(ev.pointerId);
    pickSv(ev);
  });
  sv.addEventListener('pointermove',ev=>{
    if(ev.buttons) pickSv(ev);
  });
  hue.addEventListener('input',()=>{
    aetherisPickerState.h=Number(hue.value);
    applyAetherisPickerColor();
  });
  brightness.addEventListener('input',()=>{
    aetherisPickerState.v=Math.max(.05,Math.min(1,Number(brightness.value)/100));
    applyAetherisPickerColor();
  });
  input.addEventListener('change',()=>{
    const hex=normalizeHexColor(input.value, activeAetherisColorInput?.value || '#ffffff');
    aetherisPickerState=hexToHsv(hex);
    applyAetherisPickerColor();
  });
  input.addEventListener('keydown',ev=>{
    if(ev.key==='Enter'){ input.blur(); closeAetherisColorPicker(); }
  });
  close.addEventListener('click',closeAetherisColorPicker);

  document.addEventListener('pointerdown',ev=>{
    if(picker.hidden) return;
    if(picker.contains(ev.target)) return;
    if(ev.target.closest?.('[data-color-target]')) return;
    closeAetherisColorPicker();
  });

  window.addEventListener('resize',closeAetherisColorPicker);
  return picker;
}

function openAetherisColorPicker(input, trigger){
  if(!input) return;
  const picker=ensureAetherisColorPicker();
  activeAetherisColorInput=input;
  aetherisPickerState=hexToHsv(input.value);
  applyAetherisPickerColor(false);

  picker.hidden=false;
  const tr=trigger.getBoundingClientRect();
  const width=270, height=225, pad=10;
  let left=tr.left;
  let top=tr.bottom+8;
  if(left+width>window.innerWidth-pad) left=window.innerWidth-width-pad;
  if(top+height>window.innerHeight-pad) top=Math.max(pad,tr.top-height-8);
  picker.style.left=Math.max(pad,left)+'px';
  picker.style.top=Math.max(pad,top)+'px';
}

function closeAetherisColorPicker(){
  const picker=document.getElementById('aetheris-color-picker');
  if(picker) picker.hidden=true;
  activeAetherisColorInput=null;
}

function applyAetherisPickerColor(writeTarget=true){
  const picker=ensureAetherisColorPicker();
  const hex=hsvToHex(aetherisPickerState.h,aetherisPickerState.s,aetherisPickerState.v);
  picker.style.setProperty('--cp-hue',aetherisPickerState.h);
  picker.querySelector('#cp-hue').value=Math.round(aetherisPickerState.h);
  const brightness=picker.querySelector('#cp-brightness');
  if(brightness){
    brightness.value=Math.round(aetherisPickerState.v*100);
    const fullBright=hsvToHex(aetherisPickerState.h,aetherisPickerState.s,1);
    brightness.style.setProperty('--brightness-color',fullBright);
  }
  picker.querySelector('#cp-marker').style.left=(aetherisPickerState.s*100)+'%';
  picker.querySelector('#cp-marker').style.top=((1-aetherisPickerState.v)*100)+'%';
  picker.querySelector('#cp-preview').style.background=hex;
  picker.querySelector('#cp-input').value=hex;

  if(writeTarget && activeAetherisColorInput){
    activeAetherisColorInput.value=hex;
    syncColorChip(activeAetherisColorInput);
    activeAetherisColorInput.dispatchEvent(new Event('input',{bubbles:true}));
  }
}

function syncColorChip(input){
  if(!input) return;
  const hex=normalizeHexColor(input.value, '#ffffff');
  input.value=hex;
  const trigger=document.querySelector(`[data-color-target="${CSS.escape(input.id)}"]`);
  if(trigger) trigger.style.setProperty('--chip-color',hex);
}

function bindAetherisColorControls(scope=document){
  scope.querySelectorAll('[data-color-target]').forEach(trigger=>{
    if(trigger.dataset.colorBound==='1') return;
    trigger.dataset.colorBound='1';
    trigger.addEventListener('click',()=>{
      openAetherisColorPicker(document.getElementById(trigger.dataset.colorTarget),trigger);
    });
  });

  scope.querySelectorAll('.color-hex').forEach(input=>{
    if(input.dataset.colorBound==='1') return;
    input.dataset.colorBound='1';
    input.addEventListener('change',()=>{
      input.value=normalizeHexColor(input.value,'#ffffff');
      syncColorChip(input);
      input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    syncColorChip(input);
  });
}


/* =========================================================================
   MAIN CONTROL APP
   ========================================================================= */
function buildAppShell(){
  document.getElementById('app').innerHTML = `
    <div class="sidebar">
      <div class="brand">
        <div class="mark"><img src="data:image/png;base64,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" alt="Aetheris"></div>
        <div>
          <div class="name">Aetheris</div>
          <div class="app-version" id="app-version-label"></div>
        </div>
      </div>
      <button class="navbtn active" data-view="dashboard"><span class="dot"></span>Dashboard</button>
      <button class="navbtn" data-view="settings"><span class="dot"></span>Settings</button>
      <button class="navbtn" data-view="commands"><span class="dot"></span>Commands</button>
      <button class="navbtn" data-view="customize"><span class="dot"></span>Customization</button>
      <button class="navbtn" data-view="about"><span class="dot"></span>About</button>
      <div class="side-foot">
        <div class="status-row"><span class="status-led" data-service="twitch"></span>Twitch</div>
        <div class="status-row"><span class="status-led" data-service="spotify"></span>Spotify</div>
        <div class="status-row"><span class="status-led" data-service="youtube"></span>YouTube</div>
        <div class="status-row"><span class="status-led" data-service="ytmd"></span>YTM Desktop</div>
        <div style="margin-top:10px;font-size:11px;color:var(--text-dim);letter-spacing:.03em;">CodedByNyxia</div>
      </div>
    </div>
    <div class="main">
      <div class="view active" id="view-dashboard"></div>
      <div class="view" id="view-settings"></div>
      <div class="view" id="view-commands"></div>
      <div class="view" id="view-customize"></div>
      <div class="view" id="view-about"></div>
    </div>
  `;
  document.querySelectorAll('.navbtn').forEach(b=>{
    b.addEventListener('click', ()=>switchView(b.dataset.view));
  });
  const validViews = ['dashboard','settings','commands','customize','about'];
  let savedView = null;
  try{ savedView = localStorage.getItem('aetheris_lastview'); }catch(e){}
  switchView(validViews.includes(savedView) ? savedView : 'dashboard');
  applyTheme();
  renderDashboard();
  renderSettings();
  renderCommands();
  renderCustomize();
  renderAbout();
  updateLeds();

  // handle spotify oauth callback if present
  if(params.get('code')) handleSpotifyCallback(params.get('code'));

  // Start each integration independently. A failure in one service must not
  // abort initialization of the services that come after it.
  if(STATE.settings.twitch.channel){
    try{
      startTwitchLiveStatusWatch();
      // AetherisBot Cloud is the normal Twitch transport. Do not
      // automatically open the legacy IRC socket when this PC is paired
      // with the cloud bridge. Legacy IRC can still be started manually
      // from Advanced Twitch settings for troubleshooting/fallback use.
      if(!aetherisBotBridgeStatus.paired){
        connectTwitch();
      }else{
        logTwitch('Cloud pairing detected — legacy Twitch IRC auto-connect skipped.');
      }
    }catch(e){
      console.error('Twitch startup failed:', e);
    }
  }

  if(STATE.settings.spotify.access_token){
    try{
      startSpotifyPolling();
    }catch(e){
      console.error('Spotify startup failed:', e);
    }
  }

  if(isYtmdConnected()){
    try{
      startYtmdRealtime();
    }catch(e){
      console.error('YTMD startup failed:', e);
    }
  }

  // keep the dashboard's now-playing progress bar animating smoothly between polls
  setInterval(()=>{
    const slot = document.getElementById('np-slot');
    if(slot && STATE.nowPlaying) slot.innerHTML = nowPlayingHtml(STATE.nowPlaying);
    updateDashboardLive();
  }, 1000);

  // OBS receives only sanitized now-playing + style state through Aetheris's
  // localhost relay. No Spotify or YTMD credential is ever placed in the URL.
  try{ window.aetherisBridge?.publishOverlayState?.({nowPlaying:STATE.nowPlaying,overlay:STATE.overlay}); }catch(_){}
  setInterval(()=>{
    try{ window.aetherisBridge?.publishOverlayState?.({nowPlaying:STATE.nowPlaying,overlay:STATE.overlay}); }catch(_){}
  }, 750);
}

function switchView(name){
  document.querySelectorAll('.navbtn').forEach(b=>b.classList.toggle('active', b.dataset.view===name));
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active', v.id==='view-'+name));
  try{ localStorage.setItem('aetheris_lastview', name); }catch(e){}
}

function setLed(service, live){
  document.querySelectorAll('[data-service="'+service+'"]').forEach(el=>el.classList.toggle('live', !!live));
}
function setStatusText(service, text){
  document.querySelectorAll('[data-service-text="'+service+'"]').forEach(el=>{ el.textContent = text; });
}
function updateLeds(){
  const twOn = isTwitchConnected();
  const spOn = !!STATE.settings.spotify.access_token;
  const ytOn = !!STATE.settings.youtube.apiKey;
  const ytmdOn = isYtmdConnected();
  setLed('twitch', twOn);   setStatusText('twitch', twOn ? 'Connected' : 'Offline');
  setLed('spotify', spOn);  setStatusText('spotify', spOn ? 'Connected' : 'Not connected');
  setLed('youtube', ytOn);  setStatusText('youtube', ytOn ? 'API key saved' : 'No API key');
  setLed('ytmd', ytmdOn);   setStatusText('ytmd', ytmdOn ? 'Connected' : 'Not connected');
  updateDashboardLive();
}

/* ---------------- DASHBOARD ---------------- */
function getAutoRequestMode(){
  const mode=STATE.settings.twitch.autoRequestMode;
  if(['manual','spotify','youtube','spotify-fallback'].includes(mode)) return mode;
  return STATE.settings.twitch.autoRequests ? 'spotify-fallback' : 'manual';
}
function setAutoRequestMode(mode){
  if(!['manual','spotify','youtube','spotify-fallback'].includes(mode)) mode='manual';
  STATE.settings.twitch.autoRequestMode=mode;
  // Keep the old boolean synchronized so older exports/builds degrade gracefully.
  STATE.settings.twitch.autoRequests=mode!=='manual';
}
function autoRequestModeLabel(mode=getAutoRequestMode()){
  return mode==='spotify' ? 'Automatic: Spotify' : mode==='youtube' ? 'Automatic: YouTube' : mode==='spotify-fallback' ? 'Automatic: Spotify → YouTube' : 'Manual approval';
}
function readinessState(){
  const twitch=isTwitchConnected();
  const spotify=!!STATE.settings.spotify.access_token;
  const youtube=!!STATE.settings.youtube.apiKey && isYtmdConnected();
  const autoMode=getAutoRequestMode();
  const playerReady=autoMode==='spotify' ? spotify : autoMode==='youtube' ? youtube : (spotify || youtube);
  const ready=twitch && playerReady;
  let title='Aetheris needs attention';
  let sub='Connect Twitch and at least one playback source to start taking requests.';
  if(ready){
    title='Aetheris is ready for stream';
    if(autoMode!=='manual'){
      if(autoMode==='spotify') sub=spotify ? 'Auto-Request is on — Spotify only.' : 'Auto-Request is set to Spotify, but Spotify is not ready.';
      else if(autoMode==='youtube') sub=youtube ? 'Auto-Request is on — YouTube Music Desktop only.' : 'Auto-Request is set to YouTube, but YouTube Music Desktop is not ready.';
      else sub=spotify && youtube ? 'Auto-Request is on — Spotify first, YouTube fallback.' : spotify ? 'Auto-Request fallback mode is on — Spotify is ready.' : 'Auto-Request fallback mode is on — YouTube Music Desktop is ready.';
    } else {
      sub='Requests are ready — manual approval is currently enabled.';
    }
  } else if(twitch && !playerReady){
    sub='Twitch is connected, but no playback source is ready.';
  } else if(!twitch && playerReady){
    sub='Playback is ready, but Twitch chat is not connected.';
  }
  return {ready,title,sub,twitch,spotify,youtube};
}

function renderDashboard(){
  const el = document.getElementById('view-dashboard');
  if(!el) return;
  const np = STATE.nowPlaying;
  const rs=readinessState();
  el.innerHTML = `
    <div class="pagehead">
      <h1>Dashboard</h1>
      <p>Requests come in from chat with <b>${escapeHtml(STATE.settings.twitch.command)}</b>. ${getAutoRequestMode()!=='manual' ? escapeHtml(autoRequestModeLabel())+' is enabled.' : 'Approve requests manually or choose an automatic mode below.'}</p>
    </div>

    <div class="readiness-banner ${rs.ready?'ready':''}" id="readiness-banner">
      <div class="readiness-main"><span class="readiness-dot"></span><div><div class="readiness-title" id="readiness-title">${escapeHtml(rs.title)}</div><div class="readiness-sub" id="readiness-sub">${escapeHtml(rs.sub)}</div></div></div>
      <div class="readiness-services">
        <span class="service-chip ${rs.twitch?'live':''}" id="ready-twitch">Twitch</span>
        <span class="service-chip ${rs.spotify?'live':''}" id="ready-spotify">Spotify</span>
        <span class="service-chip ${rs.youtube?'live':''}" id="ready-youtube">YouTube</span>
      </div>
    </div>

    <div class="session-stats">
      <div class="session-stat"><div class="value" id="stat-requests">${SESSION.requests}</div><div class="label">Requests</div></div>
      <div class="session-stat"><div class="value" id="stat-queued">${SESSION.queued}</div><div class="label">Queued</div></div>
      <div class="session-stat"><div class="value" id="stat-pending">${STATE.queue.length}</div><div class="label">Pending</div></div>
      <div class="session-stat"><div class="value" id="stat-rejected">${SESSION.rejected}</div><div class="label">Rejected</div></div>
      <div class="session-stat"><div class="value" id="stat-time">${sessionElapsedLabel()}</div><div class="label">Session</div></div>
    </div>

    <div class="auto-request-row">
      <div class="auto-request-copy"><strong>Song request handling</strong><div>Choose manual approval, lock automatic requests to one service, or let Spotify fall back to YouTube. Failed automatic requests stay pending for manual review.</div></div>
      <select id="auto-request-mode" class="auto-request-select" style="max-width:230px;min-width:190px;">
        <option value="manual" ${getAutoRequestMode()==='manual'?'selected':''}>Manual approval</option>
        <option value="spotify" ${getAutoRequestMode()==='spotify'?'selected':''}>Automatic: Spotify</option>
        <option value="youtube" ${getAutoRequestMode()==='youtube'?'selected':''}>Automatic: YouTube</option>
        <option value="spotify-fallback" ${getAutoRequestMode()==='spotify-fallback'?'selected':''}>Automatic: Spotify → YouTube</option>
      </select>
    </div>

    <div class="dashboard-columns">
      <div class="dashboard-column">
        <div class="panel now-playing-panel">
          <h3>Now playing</h3>
          <div id="np-slot">${nowPlayingHtml(np)}</div>
          <div class="playback-controls">
            <button class="btn ghost" data-media="previous" title="Previous" aria-label="Previous"><svg class="media-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 6 4 12l7 6V6Zm9 0-7 6 7 6V6Z" fill="currentColor"/></svg></button>
            <button class="btn play-main" data-media="${!np || np.isPlaying===false?'play':'pause'}">${mediaButtonHtml(!np || np.isPlaying===false?'play':'pause')}</button>
            <button class="btn ghost" data-media="next" title="Skip" aria-label="Skip"><svg class="media-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 6 7 6-7 6V6Zm9 0 7 6-7 6V6Z" fill="currentColor"/></svg></button>
          </div>
        </div>

        <div class="panel">
          <h3>Up next <span class="pill" style="margin-left:6px;">${(STATE.upNext||[]).length}</span></h3>
          <div id="up-next-slot"></div>
        </div>

        <div class="panel">
          <h3>Pending chat requests <span class="pill" style="margin-left:6px;">${STATE.queue.length} pending</span></h3>
          <div id="queue-slot"></div>
        </div>
      </div>

      <div class="dashboard-column">
        <div class="panel">
          <h3>Add a song directly</h3>
          <div class="search-row">
            <input type="text" id="manual-search" placeholder="Search a song or paste a link...">
            <select id="manual-source" style="max-width:130px;">
              <option value="spotify">Spotify</option>
              <option value="youtube">YouTube</option>
            </select>
            <button class="btn" id="manual-search-btn">Search</button>
          </div>
          <div class="search-results" id="manual-results"></div>
        </div>

        <div class="panel">
          <h3>Recently played</h3>
          <div id="history-slot"></div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('manual-search-btn').addEventListener('click', doManualSearch);
  document.getElementById('manual-search').addEventListener('keydown', e=>{ if(e.key==='Enter') doManualSearch(); });
  document.getElementById('auto-request-mode').addEventListener('change', e=>{
    const mode=e.target.value;
    setAutoRequestMode(mode);
    if(mode==='youtube') claimPlaybackSource('ytmdesktop','auto-request mode changed');
    else if(mode==='spotify' || mode==='spotify-fallback') claimPlaybackSource('spotify','auto-request mode changed');
    else activePlaybackSource=null;
    saveState();
    renderDashboard();
    toast(mode==='manual' ? 'Manual request approval enabled' : autoRequestModeLabel(mode)+' enabled');
    if(mode!=='manual') processAutoRequestQueue();
  });
  el.querySelectorAll('[data-media]').forEach(btn=>btn.addEventListener('click', async()=>{
    const action=btn.dataset.media;
    const previousPlaying=STATE.nowPlaying?.isPlaying;

    // Flip play/pause immediately so the control never feels like it is waiting
    // on Spotify/YTMD's network round-trip before acknowledging the click.
    if((action==='play' || action==='pause') && STATE.nowPlaying){
      STATE.nowPlaying.isPlaying=(action==='play');
      STATE.nowPlaying.updatedAt=Date.now();
      btn.dataset.media=action==='play'?'pause':'play';
      btn.innerHTML=mediaButtonHtml(action==='play'?'pause':'play');
      btn.classList.add('media-flash');
      setTimeout(()=>btn.classList.remove('media-flash'),140);
    }
    try{
      await mediaCommand(action);
      toast(action==='next'?'Skipped':action==='previous'?'Previous track':action==='pause'?'Paused':'Playing');
    } catch(err){
      // Roll the optimistic state back if the player rejected the command.
      if((action==='play' || action==='pause') && STATE.nowPlaying){
        STATE.nowPlaying.isPlaying=previousPlaying;
        STATE.nowPlaying.updatedAt=Date.now();
        updateDashboardLive();
      }
      toast('Playback control failed: '+(err.message||'player unavailable'));
    }
  }));
  renderUpcomingQueue();
  renderQueue();
  renderHistory();
}

function mediaButtonHtml(action){
  if(action==='pause') return '<svg class="media-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" fill="currentColor"/></svg><span class="media-label">Pause</span>';
  return '<svg class="media-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z" fill="currentColor"/></svg><span class="media-label">Play</span>';
}

function updateDashboardLive(){
  const banner=document.getElementById('readiness-banner');
  if(banner){
    const rs=readinessState();
    banner.classList.toggle('ready',rs.ready);
    const t=document.getElementById('readiness-title'); if(t)t.textContent=rs.title;
    const sub=document.getElementById('readiness-sub'); if(sub)sub.textContent=rs.sub;
    [['ready-twitch',rs.twitch],['ready-spotify',rs.spotify],['ready-youtube',rs.youtube]].forEach(([id,on])=>document.getElementById(id)?.classList.toggle('live',!!on));
  }
  const vals={ 'stat-requests':SESSION.requests, 'stat-queued':SESSION.queued, 'stat-pending':STATE.queue.length, 'stat-rejected':SESSION.rejected, 'stat-time':sessionElapsedLabel() };
  Object.entries(vals).forEach(([id,v])=>{ const el=document.getElementById(id); if(el)el.textContent=v; });
  const playBtn=document.querySelector('#view-dashboard .play-main');
  if(playBtn){
    const shouldPlay=!STATE.nowPlaying || STATE.nowPlaying.isPlaying===false;
    playBtn.dataset.media=shouldPlay?'play':'pause';
    playBtn.innerHTML=mediaButtonHtml(shouldPlay?'play':'pause');
  }
}

// Between polls (especially the 6s YTM Desktop fallback), extrapolate progress
// locally from elapsed real time so the progress bar moves smoothly instead
// of jumping in visible steps every time a fresh poll lands.
function displayProgressMs(np){
  if(!np) return 0;
  if(!np.isPlaying || !np.updatedAt) return np.progressMs||0;
  const elapsed = Date.now() - np.updatedAt;
  return Math.min(np.durationMs||0, (np.progressMs||0) + Math.max(0, elapsed));
}

function nowPlayingHtml(np){
  if(!np){
    return `<div class="np-empty">Nothing playing yet. Connect Spotify or approve a YouTube request to get started.</div>`;
  }
  const shownProgress = displayProgressMs(np);
  const pct = np.durationMs ? Math.min(100,(shownProgress/np.durationMs)*100) : 0;
  return `
    <div class="nowplaying">
      <img src="${escapeHtml(np.art||'')}" alt="">
      <div class="np-info">
        <div class="np-title">${escapeHtml(np.title||'Untitled')}</div>
        <div class="np-artist">${escapeHtml(np.artist||'')} <span class="pill" style="margin-left:6px;">${escapeHtml(np.source||'')}</span></div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="np-time"><span>${fmtTime(shownProgress)}</span><span>${fmtTime(np.durationMs||0)}</span></div>
      </div>
    </div>
  `;
}

function renderQueue(){
  const slot = document.getElementById('queue-slot');
  if(!slot) return;
  if(STATE.queue.length===0){
    slot.innerHTML = `<div class="empty-state">No pending requests. Waiting on chat...</div>`;
    updateDashboardLive();
    return;
  }
  slot.innerHTML = STATE.queue.map(q=>`
    <div class="queue-item">
      <div class="who">${escapeHtml(q.user)}</div>
      <div class="what">${escapeHtml(q.query)}</div>
      <div class="when">${timeAgo(q.ts)}</div>
      <div class="queue-actions">
        <button class="btn small" data-act="resolve" data-id="${q.id}" data-src="spotify">Spotify</button>
        <button class="btn small ghost" data-act="resolve" data-id="${q.id}" data-src="youtube">YouTube</button>
        <button class="btn small danger" data-act="reject" data-id="${q.id}">✕</button>
      </div>
    </div>
  `).join('');
  slot.querySelectorAll('[data-act=resolve]').forEach(b=>b.addEventListener('click', ()=>resolveRequest(b.dataset.id, b.dataset.src)));
  slot.querySelectorAll('[data-act=reject]').forEach(b=>b.addEventListener('click', ()=>rejectRequest(b.dataset.id)));
  updateDashboardLive();
}

function renderUpcomingQueue(){
  const slot=document.getElementById('up-next-slot');
  if(!slot) return;
  const items=STATE.upNext||[];
  if(!items.length){ slot.innerHTML='<div class="empty-state">No Aetheris songs queued next.</div>'; return; }
  slot.innerHTML=items.slice(0,12).map((q,i)=>`<div class="queue-item"><div class="who">${i+1}</div><div class="what">${escapeHtml(q.title||'Untitled')} — ${escapeHtml(q.artist||'')}</div><div class="when">${escapeHtml(q.source==='youtube'?'YouTube':'Spotify')}</div></div>`).join('');
}
function addUpNext(track, source, user='Aetheris', requested=false){
  STATE.upNext=STATE.upNext||[];


  STATE.upNext.push({
    id:'u'+Date.now()+Math.random().toString(36).slice(2,5),
    title:track.title||'Untitled',
    artist:track.artist||'',
    source,
    // Store the service-native track ID so Up Next can be removed reliably
    // when the exact queued song becomes Now Playing.
    uri:track.uri||'',
    videoId:track.videoId||track.id||'',
    user,
    requested:!!requested,
    ts:Date.now()
  });
  saveState(); renderUpcomingQueue();
  syncUpNextWithNowPlaying(STATE.nowPlaying);
}
async function logPlayedRequest(item, np){
  if(!item?.requested || STATE.settings.twitch.streamSongLogEnabled===false) return;
  try{
    await window.aetherisBridge?.appendStreamSongLog?.({
      title:np?.title || item.title,
      artist:np?.artist || item.artist || '',
      source:(np?.source==='ytmdesktop'?'YouTube':(np?.source || item.source)),
      requester:item.user || '',
      time:new Date().toLocaleTimeString()
    });
  }catch(e){
    console.warn('Could not append requested-song log:', e);
  }
}


function recordActuallyPlayed(item, np){
  if(!item) return;
  STATE.history=STATE.history||[];
  STATE.history.unshift({
    title:np?.title || item.title || 'Untitled',
    artist:np?.artist || item.artist || '',
    user:item.user || 'Aetheris',
    ts:Date.now(),
    source:np?.source==='ytmdesktop'?'youtube':(np?.source || item.source)
  });
  if(STATE.history.length>100) STATE.history.length=100;
}

function syncUpNextWithNowPlaying(np){
  if(!np?.title || !STATE.upNext?.length) return;

  const src=np.source==='ytmdesktop'?'youtube':np.source;
  const norm=x=>String(x||'')
    .toLowerCase()
    .replace(/&amp;/g,'&')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\b(official|audio|video|lyrics|lyric|visualizer|music)\b/g,' ')
    .replace(/\s+/g,' ')
    .trim();

  const currentTitle=norm(np.title);
  const currentArtist=norm(np.artist||'');

  const i=STATE.upNext.findIndex(q=>{
    const queuedSource=q.source==='ytmdesktop'?'youtube':q.source;
    if(queuedSource!==src) return false;

    // Best match: the actual service-native ID.
    if(src==='spotify' && q.uri && np.uri && q.uri===np.uri) return true;
    if(src==='youtube' && q.videoId && np.videoId && q.videoId===np.videoId) return true;

    // Compatibility for queue entries created before IDs were stored, plus
    // minor metadata differences between YouTube API and YTMD.
    const queuedTitle=norm(q.title);
    const queuedArtist=norm(q.artist||'');
    if(!queuedTitle || !currentTitle) return false;

    const titleMatches =
      queuedTitle===currentTitle ||
      (queuedTitle.length>=8 && currentTitle.includes(queuedTitle)) ||
      (currentTitle.length>=8 && queuedTitle.includes(currentTitle));

    if(!titleMatches) return false;

    // Artist is a tie-breaker only. YTMD may report a different channel/artist
    // string than the YouTube Data API for the exact same video.
    if(!queuedArtist || !currentArtist) return true;
    return queuedArtist===currentArtist ||
           queuedArtist.includes(currentArtist) ||
           currentArtist.includes(queuedArtist) ||
           src==='youtube';
  });

  if(i>=0){
    const item=STATE.upNext[i];
    STATE.upNext.splice(i,1);
    recordActuallyPlayed(item, np);
    saveState();
    renderUpcomingQueue();
    renderHistory();
    if(item?.requested) logPlayedRequest(item, np);
  }
}

function renderHistory(){
  const slot = document.getElementById('history-slot');
  if(!slot) return;
  if(STATE.history.length===0){ slot.innerHTML = `<div class="empty-state">Nothing played yet this session.</div>`; return; }
  slot.innerHTML = STATE.history.slice(0,10).map(h=>`
    <div class="queue-item">
      <div class="who">${escapeHtml(h.user||'—')}</div>
      <div class="what">${escapeHtml(h.title)} — ${escapeHtml(h.artist||'')}</div>
      <div class="when">${timeAgo(h.ts)}</div>
    </div>
  `).join('');
}

function timeAgo(ts){
  const s = Math.floor((Date.now()-ts)/1000);
  if(s<60) return s+'s ago';
  if(s<3600) return Math.floor(s/60)+'m ago';
  return Math.floor(s/3600)+'h ago';
}

async function queueYoutubeTrack(track){
  await ytmdEnqueueOrPlay(track);
}

async function findRequestTrack(query, source){
  if(source==='spotify'){
    if(!STATE.settings.spotify.access_token) throw new Error('Spotify is not connected');
    return (await spotifySearch(query))[0] || null;
  }
  if(!STATE.settings.youtube.apiKey) throw new Error('YouTube API key is not configured');
  if(!isYtmdConnected()) throw new Error('YouTube Music Desktop is not connected');
  const directId=extractYoutubeVideoId(query);
  return directId ? await youtubeLookupById(directId) : (await youtubeSearch(query))[0] || null;
}

async function queueResolvedRequest(item, source, quiet=false){
  const track=await findRequestTrack(item.query, source);
  if(!track) throw new Error('No '+(source==='spotify'?'Spotify':'YouTube')+' result found');
  claimPlaybackSource(source,'song request queued');
  if(source==='spotify'){
    if(!track.uri) throw new Error('Spotify result is missing a track URI');
    await spotifyQueue(track.uri);
  } else {
    await queueYoutubeTrack(track);
  }
  addUpNext(track, source, item.user, true);
  STATE.queue = STATE.queue.filter(q=>q.id!==item.id);
  saveState();
  bumpSessionStat('queued');
  renderQueue();
  if(!quiet) toast('Queued: '+track.title);
  return track;
}

async function resolveRequest(id, source){
  const item = STATE.queue.find(q=>q.id===id);
  if(!item) return;
  toast('Searching '+source+'…');
  try{
    await queueResolvedRequest(item, source);
  }catch(err){
    console.error(err);
    toast('Error: '+(err.message||'could not queue song'));
  }
}

async function autoResolveRequest(item){
  if(!item || !STATE.queue.some(q=>q.id===item.id)) return false;
  const mode=getAutoRequestMode();
  if(mode==='manual') return false;

  const trySpotify=mode==='spotify' || mode==='spotify-fallback';
  const tryYoutube=mode==='youtube' || mode==='spotify-fallback';
  let lastError=null;

  if(trySpotify){
    if(STATE.settings.spotify.access_token){
      try{
        const track=await queueResolvedRequest(item,'spotify',true);
        toast('Auto-queued on Spotify: '+track.title);
        return true;
      }catch(err){ lastError=err; console.warn('Auto-request Spotify attempt failed:',err); }
    } else {
      lastError=new Error('Spotify is not connected');
      console.warn('Auto-request Spotify skipped: Spotify is not connected');
    }
  }

  if(tryYoutube){
    if(STATE.settings.youtube.apiKey && isYtmdConnected()){
      try{
        const track=await queueResolvedRequest(item,'youtube',true);
        toast('Auto-queued on YouTube: '+track.title);
        return true;
      }catch(err){ lastError=err; console.warn('Auto-request YouTube attempt failed:',err); }
    } else {
      lastError=new Error('YouTube Music Desktop is not ready');
      console.warn('Auto-request YouTube skipped: YouTube Music Desktop is not ready');
    }
  }

  bumpSessionStat('failed');
  if(lastError) console.warn('Request left pending after automatic attempt:',lastError);
  toast('Auto-request could not queue this song — left pending for review');
  return false;
}

async function processAutoRequestQueue(){
  if(autoRequestBusy || getAutoRequestMode()==='manual') return;
  autoRequestBusy=true;
  try{
    while(getAutoRequestMode()!=='manual'){
      const item=STATE.queue[0];
      if(!item) break;
      const beforeId=item.id;
      const ok=await autoResolveRequest(item);
      if(!ok || STATE.queue.some(q=>q.id===beforeId)) break;
    }
  } finally { autoRequestBusy=false; }
}

function rejectRequest(id){
  const existed=STATE.queue.some(q=>q.id===id);
  STATE.queue = STATE.queue.filter(q=>q.id!==id);
  saveState();
  if(existed) bumpSessionStat('rejected');
  renderQueue();
}

async function doManualSearch(){
  const q = document.getElementById('manual-search').value.trim();
  const src = document.getElementById('manual-source').value;
  if(!q) return;
  const resultsEl = document.getElementById('manual-results');
  resultsEl.innerHTML = `<div class="empty-state">Searching…</div>`;
  try{
    const directId = src==='youtube' ? extractYoutubeVideoId(q) : null;
    const results = directId ? [await youtubeLookupById(directId)] : (src==='spotify' ? await spotifySearch(q) : await youtubeSearch(q));
    if(results.length===0){ resultsEl.innerHTML = `<div class="empty-state">No results.</div>`; return; }
    resultsEl.innerHTML = results.map((r,i)=>`
      <div class="search-result">
        <img src="${escapeHtml(r.art||'')}" alt="">
        <div class="meta"><div class="t">${escapeHtml(r.title)}</div><div class="a">${escapeHtml(r.artist||'')}</div></div>
        <button class="btn small" data-i="${i}">Queue</button>
      </div>
    `).join('');
    resultsEl.querySelectorAll('button[data-i]').forEach(b=>{
      b.addEventListener('click', async ()=>{
        const index = Number(b.dataset.i);
        const track = results[index];
        if(!track) return;

        // Treat dashboard adds exactly like an approved Aetheris request: run
        // the actual queue command first, then record it in Recently played.
        // This avoids showing a successful-looking history entry when the
        // player command itself failed.
        const originalText = b.textContent;
        b.disabled = true;
        b.textContent = 'Queueing…';
        try{
          claimPlaybackSource(src,'manual dashboard queue');
          if(src==='spotify'){
            if(!track.uri) throw new Error('Spotify result is missing a track URI.');
            await spotifyQueue(track.uri);
            toast('Queued: '+track.title);
          }else{
            await queueYoutubeTrack(track);
          }

          addUpNext(track, src, 'Aetheris');
          saveState();
          b.textContent = 'Queued';
        }catch(e){
          b.disabled = false;
          b.textContent = originalText;
          toast('Error: '+(e.message||'failed'));
        }
      });
    });
  }catch(e){
    resultsEl.innerHTML = `<div class="empty-state">${escapeHtml(e.message||'Search failed')}</div>`;
  }
}

/* =========================================================================
   SETTINGS
   ========================================================================= */
function clampNumber(value,min,max,fallback){ const n=Number(value); return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback; }
function validHex(value,fallback){ return /^#[0-9a-f]{6}$/i.test(String(value||''))?String(value):fallback; }
function validateThemeImport(input={}){
  const d=DEFAULT_STATE.theme, out={};
  if(typeof input.font==='string' && FONT_OPTIONS.some(f=>f.name===input.font)) out.font=input.font;
  for(const k of ['bg','panel','accent','accent2','text','glowColor']) if(k in input) out[k]=validHex(input[k],d[k]);
  if('radius' in input) out.radius=clampNumber(input.radius,0,40,d.radius);
  if('compact' in input) out.compact=!!input.compact;
  if(['none','glow','grid','noise'].includes(input.bgStyle)) out.bgStyle=input.bgStyle;
  if('glowColorEnabled' in input) out.glowColorEnabled=!!input.glowColorEnabled;
  if('glowStrength' in input) out.glowStrength=clampNumber(input.glowStrength,0,100,d.glowStrength);
  return out;
}
function validateOverlayImport(input={}){
  const d=DEFAULT_STATE.overlay, out={};
  if(['card','compact','neon','cassette','minimal','glow'].includes(input.style)) out.style=input.style;
  if(typeof input.font==='string' && FONT_OPTIONS.some(f=>f.name===input.font)) out.font=input.font;
  for(const k of ['bg','text','accent']) if(k in input) out[k]=validHex(input[k],d[k]);
  for(const [k,min,max] of [['transparency',0,100],['padding',0,60],['gap',0,60],['artSize',16,300],['radius',0,60],['titleSize',8,72],['barHeight',1,30],['scrollSpeed',5,300],['width',200,1920]]) if(k in input) out[k]=clampNumber(input[k],min,max,d[k]);
  for(const k of ['showArt','showProgress','showArtist','showBadge','canvasBackdrop']) if(k in input) out[k]=!!input[k];
  if(['none','zoom','spin'].includes(input.coverMotion)) out.coverMotion=input.coverMotion;
  return out;
}
function validateSettingsImport(input={}){
  const out={};
  if(isPlainObject(input.twitch)){
    const t=input.twitch; out.twitch={};
    for(const k of ['channel','command','botUsername','botOAuth','confirmTemplate','nowPlayingCmd','queueCmd','announceTemplate','skipCmd','pauseCmd','resumeCmd','rewindCmd','connectAnnounceTemplate']) if(typeof t[k]==='string') out.twitch[k]=t[k].slice(0,1000);
    if('cooldown' in t) out.twitch.cooldown=clampNumber(t.cooldown,0,3600,10);
    for(const k of ['notify','nowPlayingCmdEnabled','queueCmdEnabled','announceNowPlaying','playbackCmdsModOnly','skipCmdEnabled','pauseCmdEnabled','resumeCmdEnabled','rewindCmdEnabled','announceOnConnect','spotifyCommandsEnabled','youtubeCommandsEnabled','streamSongLogEnabled','allowOfflineBotMessages','autoRequests']) if(k in t) out.twitch[k]=!!t[k];
    if([null,'manual','spotify','youtube','spotify-fallback'].includes(t.autoRequestMode)) out.twitch.autoRequestMode=t.autoRequestMode;
    if(Array.isArray(t.customCommands)) out.twitch.customCommands=t.customCommands.slice(0,100).map(c=>({id:String(c?.id||'').slice(0,100),trigger:String(c?.trigger||'').slice(0,100),response:String(c?.response||'').slice(0,1000),enabled:c?.enabled!==false,count:clampNumber(c?.count,0,1e9,0)}));
    for(const k of ['spotifyPlayback','youtubePlayback']) if(isPlainObject(t[k])) out.twitch[k]={skip:!!t[k].skip,pause:!!t[k].pause,resume:!!t[k].resume,rewind:!!t[k].rewind};
    for(const k of ['spotifyCommandNames','youtubeCommandNames']) if(isPlainObject(t[k])) out.twitch[k]={skip:String(t[k].skip||'').slice(0,100),pause:String(t[k].pause||'').slice(0,100),resume:String(t[k].resume||'').slice(0,100),rewind:String(t[k].rewind||'').slice(0,100)};
  }
  if(isPlainObject(input.spotify)) out.spotify={clientId:String(input.spotify.clientId||'').slice(0,200),connected:!!input.spotify.connected,expires_at:clampNumber(input.spotify.expires_at,0,Number.MAX_SAFE_INTEGER,0),access_token:String(input.spotify.access_token||'').slice(0,8192),refresh_token:String(input.spotify.refresh_token||'').slice(0,8192)};
  if(isPlainObject(input.youtube)) out.youtube={apiKey:String(input.youtube.apiKey||'').slice(0,4096)};
  if('__exportIncludeOverlay' in input) out.__exportIncludeOverlay=!!input.__exportIncludeOverlay;
  if(isPlainObject(input.youtubeDesktop)) out.youtubeDesktop={enabled:!!input.youtubeDesktop.enabled,host:['127.0.0.1','localhost','::1'].includes(String(input.youtubeDesktop.host))?String(input.youtubeDesktop.host):'127.0.0.1',port:clampNumber(input.youtubeDesktop.port,1,65535,9863),appId:String(input.youtubeDesktop.appId||'aetheris').slice(0,100),token:String(input.youtubeDesktop.token||'').slice(0,8192),returnPlaylistUrl:String(input.youtubeDesktop.returnPlaylistUrl||'').slice(0,4096),returnPlaylistShuffle:!!input.youtubeDesktop.returnPlaylistShuffle};
  return out;
}

/* =========================================================================
   CUSTOMIZATION IMPORT / EXPORT
   Theme + (optionally) the OBS overlay look, as a portable JSON file.
   Deliberately excludes STATE.settings entirely — API keys, tokens, and
   Twitch/Spotify connection info never belong in a file meant to be shared.
   ========================================================================= */
function exportCustomization(){
  const includeOverlay = STATE.settings.__exportIncludeOverlay !== false;
  const payload = {
    __aetheris: 'customization',
    version: 1,
    exportedAt: new Date().toISOString(),
    theme: STATE.theme,
    ...(includeOverlay ? { overlay: STATE.overlay } : {})
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'aetheris-customization.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Exported'+(includeOverlay ? ' (theme + overlay)' : ' (theme only)'));
}

async function importCustomizationFile(file){
  let data;
  try{
    data = JSON.parse(await file.text());
  }catch(e){
    toast('That file isn\'t valid JSON.');
    return;
  }
  if(data?.__aetheris !== 'customization'){
    toast('That doesn\'t look like an Aetheris customization export.');
    return;
  }
  let imported = [];
  if(data.theme && typeof data.theme==='object'){
    deepMerge(STATE.theme, validateThemeImport(data.theme));
    imported.push('theme');
  }
  if(data.overlay && typeof data.overlay==='object'){
    deepMerge(STATE.overlay, validateOverlayImport(data.overlay));
    imported.push('overlay');
  }
  if(imported.length===0){
    toast('That file didn\'t contain anything to import.');
    return;
  }
  saveState();
  applyTheme();
  if(document.getElementById('view-customize')?.innerHTML) renderCustomize();
  if(document.getElementById('view-settings')?.innerHTML) renderSettings();
  toast('Imported '+imported.join(' + ')+' from file');
}

/* =========================================================================
   FULL SETUP IMPORT / EXPORT
   Portable backup for moving Aetheris to a new PC or clean installation.
   Includes connection settings/credentials plus theme + overlay, but leaves
   request queue/history/now-playing runtime data behind.
   ========================================================================= */
async function exportFullSetup(){
  const safeSettings=structuredClone(STATE.settings);
  safeSettings.twitch.botOAuth='';
  safeSettings.spotify.access_token='';
  safeSettings.spotify.refresh_token='';
  safeSettings.youtube.apiKey='';
  safeSettings.youtubeDesktop.token='';
  let protectedSecrets=null;
  try{ protectedSecrets=await window.aetherisBridge?.protectBackupSecrets?.(secretPayloadFromState()); }catch(e){ console.error('Could not protect backup secrets',e); }
  if(!protectedSecrets){ toast('Could not protect credentials for backup. Export cancelled.'); return; }
  const payload = {
    __aetheris: 'full-setup',
    version: 1,
    appVersion: (window.aetherisBridge&&window.aetherisBridge.version)||'dev',
    exportedAt: new Date().toISOString(),
    settings: safeSettings,
    protectedSecrets,
    theme: STATE.theme,
    overlay: STATE.overlay
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'aetheris-full-setup.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Full Aetheris setup exported');
}

async function importFullSetupFile(file){
  let data;
  try{
    data = JSON.parse(await file.text());
  }catch(e){
    toast('That file isn\'t valid JSON.');
    return;
  }
  if(data?.__aetheris !== 'full-setup'){
    toast('That doesn\'t look like an Aetheris full setup export.');
    return;
  }

  const imported = [];
  // YTMD Companion authorization belongs to the local YTMD instance. A full
  // setup import must never replace an already-working local authorization with
  // an older token from a backup. Keep the current token when one already
  // exists; only seed YTMD auth from the backup on a fresh/unpaired profile.
  const localYtmdTokenBeforeImport=String(STATE.settings?.youtubeDesktop?.token||'');
  let importedSecrets=null;
  if(data.protectedSecrets){
    try{ importedSecrets=await window.aetherisBridge?.unprotectBackupSecrets?.(data.protectedSecrets); }
    catch(e){ toast("That backup's protected credentials could not be decoded."); return; }
  }
  if(data.settings && isPlainObject(data.settings)){
    deepMerge(STATE.settings, validateSettingsImport(data.settings));
    imported.push('connections');
  }
  // v1 backups stored credentials directly in settings. Preserve compatibility,
  // then immediately migrate them into Windows-protected local storage.
  if(importedSecrets){
    const secretsToApply={...importedSecrets};
    if(localYtmdTokenBeforeImport) secretsToApply.ytmdToken=localYtmdTokenBeforeImport;
    applySecretsToState(secretsToApply);
  }else if(localYtmdTokenBeforeImport){
    // The sanitized settings object in modern backups contains a blank token;
    // restore the existing local token after merging those settings.
    STATE.settings.youtubeDesktop.token=localYtmdTokenBeforeImport;
  }
  if(data.theme && typeof data.theme==='object'){
    deepMerge(STATE.theme, validateThemeImport(data.theme));
    imported.push('theme');
  }
  if(data.overlay && typeof data.overlay==='object'){
    deepMerge(STATE.overlay, validateOverlayImport(data.overlay));
    imported.push('overlay');
  }
  if(imported.length===0){
    toast('That setup file didn\'t contain anything to import.');
    return;
  }

  // Persist restored credentials before reporting import success. This makes
  // backup restore durable across a full app exit/restart instead of relying on
  // the fire-and-forget save used by normal UI state changes.
  try{
    await persistSecretsNow();
    const verify=await window.aetherisBridge?.loadSecrets?.();
    const stored=verify?.secrets||{};
    const expected=secretPayloadFromState();
    for(const key of Object.keys(expected)){
      if(String(expected[key]||'') !== String(stored[key]||'')) throw new Error('secure credential verification failed for '+key);
    }
  }catch(e){
    console.error('Could not durably save imported credentials', e);
    toast('Setup settings imported, but credentials could not be saved securely. Do not close Aetheris yet.');
    return;
  }
  saveState();
  applyTheme();
  updateLeds();
  if(document.getElementById('view-customize')?.innerHTML) renderCustomize();
  if(document.getElementById('view-dashboard')?.innerHTML) renderDashboard();
  renderSettings();
  toast('Full setup imported — reconnect any services that ask for authorization');
}

function renderSettings(){
  const el = document.getElementById('view-settings');
  if(!el) return;
  const s = STATE.settings;
  const redirectUri = cachedSpotifyRedirectUri;
  el.innerHTML = `
    <div class="pagehead"><h1>Settings</h1><p>Connect the services this app pulls from and configure how chat requests behave.</p></div>

    <div class="panel">
      <h3>Connection status</h3>
      <div class="conn-status-grid">
        <div class="conn-status-item"><span class="status-led" data-service="twitch"></span><div class="txt"><span class="label">Twitch</span><span class="state" data-service-text="twitch">Offline</span></div></div>
        <div class="conn-status-item"><span class="status-led" data-service="spotify"></span><div class="txt"><span class="label">Spotify</span><span class="state" data-service-text="spotify">Not connected</span></div></div>
        <div class="conn-status-item"><span class="status-led" data-service="youtube"></span><div class="txt"><span class="label">YouTube Data API</span><span class="state" data-service-text="youtube">No API key</span></div></div>
        <div class="conn-status-item"><span class="status-led" data-service="ytmd"></span><div class="txt"><span class="label">YTM Desktop</span><span class="state" data-service-text="ytmd">Not connected</span></div></div>
      </div>
    </div>

    <div class="panel-grid">
      <div class="panel">
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div>
          <h3 style="margin:0;">Twitch</h3>
          <div class="help" id="aetherisbot-cloud-help" style="margin-top:4px;">
            ${(aetherisBotBridgeStatus.authenticated && aetherisBotBridgeStatus.twitchAuthorizationKnown && !aetherisBotBridgeStatus.twitchAuthorized) ? 'Twitch authorization expired — re-authorize Twitch below.' : aetherisBotBridgeStatus.authenticated ? 'AetherisBot is connected and ready.' : aetherisBotBridgeStatus.paired ? 'Paired — waiting for the cloud bridge.' : 'Connect Twitch to get started.'}
          </div>
        </div>
        <span class="pill ${(aetherisBotBridgeStatus.authenticated && !(aetherisBotBridgeStatus.twitchAuthorizationKnown && !aetherisBotBridgeStatus.twitchAuthorized))?'on':''}" id="aetherisbot-cloud-status">${(aetherisBotBridgeStatus.authenticated && aetherisBotBridgeStatus.twitchAuthorizationKnown && !aetherisBotBridgeStatus.twitchAuthorized)?'reauthorize':aetherisBotBridgeStatus.authenticated?'connected':aetherisBotBridgeStatus.connecting?'connecting…':aetherisBotBridgeStatus.paired?'paired / offline':'not connected'}</span>
      </div>

      <div class="row" style="margin-bottom:16px;">
        ${!aetherisBotBridgeStatus.paired ? `
          <button class="btn" id="aetherisbot-pair">Connect Twitch</button>
        ` : `
          ${!aetherisBotBridgeStatus.authenticated ? `<button class="btn" id="aetherisbot-reconnect">Reconnect</button>` : ''}
          <button class="btn ghost" id="aetherisbot-forget">Disconnect</button>
        `}
      </div>

      <div class="grid2">
        <div class="field"><label>Channel name</label><input type="text" id="tw-channel" placeholder="yourchannel" value="${escapeHtml(s.twitch.channel)}"></div>
        <div class="field"><label>Request command</label><input type="text" id="tw-command" value="${escapeHtml(s.twitch.command||'!sr')}"></div>
        <div class="field"><label>Per-user cooldown (seconds)</label><input type="number" id="tw-cooldown" value="${s.twitch.cooldown}"></div>
      </div>

      <div class="row" style="margin-top:14px;">
        <button class="btn" id="tw-save">Save</button>
      </div>

      <details style="margin-top:16px;padding-top:12px;border-top:1px solid var(--line);">
        <summary style="cursor:pointer;color:var(--text-dim);font-size:12.5px;">Advanced Twitch settings</summary>

        <div style="margin-top:14px;">
          ${(aetherisBotBridgeStatus.paired && aetherisBotBridgeStatus.authenticated && aetherisBotBridgeStatus.twitchAuthorizationKnown && !aetherisBotBridgeStatus.twitchAuthorized) ? `<button class="btn ghost small" id="aetherisbot-pair">Re-authorize Twitch (required)</button>` : ''}
        </div>

        <div style="margin-top:14px;">
          <label class="pill ${s.twitch.allowOfflineBotMessages===true?'on':''}" style="cursor:pointer;display:inline-flex;" id="wrap-offline-bot-testing">
            <input type="checkbox" id="tw-offline-bot-testing" ${s.twitch.allowOfflineBotMessages===true?'checked':''} style="display:none;">
            Allow bot messages while offline (testing)
          </label>
          <span class="pill" id="tw-offline-chat-status" style="margin-left:6px;">Checking live status…</span>
        </div>

        <div style="margin-top:14px;">
          <label class="pill ${s.twitch.streamSongLogEnabled!==false?'on':''}" style="cursor:pointer;display:inline-flex;" id="wrap-stream-song-log">
            <input type="checkbox" id="stream-song-log-enabled" ${s.twitch.streamSongLogEnabled!==false?'checked':''} style="display:none;">
            Save requested songs to TXT
          </label>
          <button class="btn ghost small" id="stream-song-log-folder" style="margin-left:6px;">Open logs</button>
        </div>

        <details style="margin-top:14px;">
          <summary style="cursor:pointer;color:var(--text-dim);font-size:12px;">Legacy local Twitch fallback</summary>
          <div class="grid2" style="margin-top:12px;">
            <div class="field"><label>Bot username</label><input type="text" id="tw-bot-user" value="${escapeHtml(s.twitch.botUsername)}"></div>
            <div class="field"><label>OAuth token</label><div class="row" style="gap:8px;"><input type="password" id="tw-bot-oauth" value="${escapeHtml(s.twitch.botOAuth)}" style="flex:1;min-width:0;"><button class="btn ghost small" type="button" id="tw-copy-oauth">Copy</button></div></div>
          </div>
          <div class="row" style="margin-top:10px;">
            <button class="btn ghost small" id="tw-local-connect">Connect legacy</button>
            <button class="btn ghost small" id="tw-disconnect">Disconnect legacy</button>
            <span class="pill" id="tw-local-status">${(twitchSocket && twitchSocket.readyState === WebSocket.OPEN && twitchJoined) ? 'connected' : 'offline'}</span>
          </div>
          <div class="help" id="tw-bot-warning" style="${(s.twitch.botUsername && s.twitch.botOAuth) ? 'display:none;' : ''}"></div>
        </details>

        <div class="field" style="margin-top:14px;">
          <label>Connection log <button class="btn ghost small" id="tw-log-copy" style="margin-left:8px;padding:2px 8px;font-size:11px;">Copy</button></label>
          <pre id="tw-log" style="background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:10px 12px;font-size:11.5px;line-height:1.6;max-height:120px;overflow:auto;white-space:pre-wrap;color:var(--text-dim);margin:0;">${escapeHtml(twitchLog.join('\\n')) || 'No connection attempts yet.'}</pre>
        </div>
      </details>
    </div>

    <div class="panel">
      <h3>Spotify</h3>
      <div class="grid2">
        <div class="field"><label>Client ID</label><input type="password" id="sp-clientid" placeholder="from developer.spotify.com" autocomplete="off" value="${escapeHtml(s.spotify.clientId)}"></div>
        <div class="field"><label>Redirect URI to register in your Spotify app</label><div class="row" style="gap:8px;"><input type="password" id="sp-redirect-uri" readonly value="${escapeHtml(redirectUri)}" style="flex:1;min-width:0;"><button class="btn ghost small" type="button" id="sp-copy-redirect">Copy</button></div></div>
      </div>
      <div class="help">Create an app at developer.spotify.com/dashboard, add the redirect URI above exactly, then paste your Client ID. Aetheris uses Spotify's Authorization Code with PKCE flow for this desktop app, so a Client Secret is intentionally <b>not</b> required or stored. Clicking Connect opens Spotify's login in your default browser; the app listens on that address locally and picks up the login automatically once you approve it.</div>
      <div class="row" style="margin-top:12px;">
        <button class="btn" id="sp-connect">${s.spotify.access_token ? 'Reconnect' : 'Connect Spotify'}</button>
        <button class="btn ghost" id="sp-disconnect">Disconnect</button>
        <span class="pill ${s.spotify.access_token?'on':''}">${s.spotify.access_token ? 'connected' : 'not connected'}</span>
      </div>
    </div>

    <div class="panel">
      <h3>YouTube</h3>
      <div class="field"><label>YouTube Data API key</label><input type="password" id="yt-key" placeholder="from console.cloud.google.com" value="${escapeHtml(s.youtube.apiKey)}"></div>
      <div class="help">For a tutorial on how to create your own YouTube API key, <a href="aetheris-youtube-api-setup.html" target="_blank" rel="noopener">click here</a>.</div>
      <button class="btn" id="yt-save" style="margin-top:10px;">Save key</button>

      <div style="margin-top:22px;padding-top:18px;border-top:1px solid var(--line);">
        <h3 style="margin-bottom:10px;">YouTube Music Desktop</h3>
        <p class="help" style="margin-top:-4px;">YTMD plays YouTube requests and reports realtime playback back to Aetheris.</p>
        <div class="help" style="margin:10px 0 14px;"><b>Setup:</b> Download <a href="https://github.com/ytmdesktop/ytmdesktop/releases" target="_blank" rel="noopener">YouTube Music Desktop</a> → click the <b>cog</b> → <b>Integrations</b> → enable <b>Companion Server</b> → click <b>Connect</b> below and approve Aetheris in YTMD. Keep <code>127.0.0.1:9863</code> unless you changed it yourself.</div>
        <div class="grid2">
          <div class="field"><label>Host</label><input type="text" id="ytmd-host" value="${escapeHtml(s.youtubeDesktop.host)}"></div>
          <div class="field"><label>Port</label><input type="number" id="ytmd-port" value="${s.youtubeDesktop.port}"></div>
        </div>
        <div class="row ytmd-connection-row">
          <button class="btn" id="ytmd-connect">${isYtmdConnected() ? 'Reconnect' : 'Connect'}</button>
          <button class="btn ghost" id="ytmd-disconnect">Disconnect</button>
          <button class="btn ghost small" id="ytmd-test">Test connection</button>
          <span class="pill ${isYtmdConnected()?'on':''}" id="ytmd-status">${isYtmdConnected() ? 'connected' : 'offline'}</span>
        </div>
        <div class="field" style="margin-top:12px;">
          <label>Connection log <button class="btn ghost small" id="ytmd-log-copy" style="margin-left:8px;padding:2px 8px;font-size:11px;">Copy log</button></label>
          <pre id="ytmd-log" style="background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:10px 12px;font-size:11.5px;line-height:1.6;max-height:160px;overflow:auto;white-space:pre-wrap;color:var(--text-dim);margin:0;">${escapeHtml(ytmdLog.join('\n')) || 'No connection attempts yet.'}</pre>
        </div>

        <div style="margin-top:22px;padding-top:18px;border-top:1px solid var(--line);">
          <h3 style="margin-bottom:10px;">Return playlist (optional)</h3>
          <p class="help" style="margin-top:-4px;">Once every pending request has played, Aetheris tries to rejoin whatever was playing before. That guess isn't always reliable — pin an exact playlist here instead and it'll be used every time, guaranteed.</p>
          <div class="field"><label>Playlist link</label><input type="text" id="ytmd-return-playlist" placeholder="https://music.youtube.com/playlist?list=..." value="${escapeHtml(s.youtubeDesktop.returnPlaylistUrl)}"></div>
          <label class="pill ${s.youtubeDesktop.returnPlaylistShuffle?'on':''}" style="cursor:pointer;display:inline-flex;" id="wrap-ytmd-shuffle">
            <input type="checkbox" id="ytmd-return-shuffle" ${s.youtubeDesktop.returnPlaylistShuffle?'checked':''} style="display:none;">Shuffle when rejoining
          </label>
        </div>
      </div>
    </div>

    </div>

    <div class="panel" style="margin-top:14px;">
      <h3>Full setup backup</h3>
      <p class="help">Move Aetheris to a new PC or fresh installation with one file. Credentials are stored in a protected Aetheris blob instead of readable JSON; connection settings, theme, and OBS overlay customization are included. Runtime queues/history are not included.</p>
      <div class="help" style="margin-top:8px;"><b>Keep this file private:</b> API keys and authorization tokens are stored in readable JSON.</div>
      <div class="row" style="margin-top:12px;"><button class="btn" id="full-setup-export">Export all</button><button class="btn ghost" id="full-setup-import">Import all</button></div>
    </div>
  `;

  // The connection cards above are created with placeholder/offline text.
  // Apply the live integration states immediately, before any event-binding
  // code below can hit a transient/missing control and interrupt this render.
  updateLeds();

  document.getElementById('full-setup-export').addEventListener('click', exportFullSetup);
  document.getElementById('full-setup-import').addEventListener('click', ()=>{
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async ()=>{
      const file = input.files?.[0];
      if(file) await importFullSetupFile(file);
    }, { once:true });
    input.click();
  });

  document.getElementById('aetherisbot-pair')?.addEventListener('click', async()=>{
    const btn=document.getElementById('aetherisbot-pair');
    const help=document.getElementById('aetherisbot-cloud-help');
    btn.disabled=true;
    if(help) help.textContent='Opening Twitch authorization in your browser…';
    try{
      const result=await window.aetherisBridge?.pairAetherisBot?.();
      await refreshAetherisBotBridgeStatus();
      if(result?.ok){
        if(help) help.textContent=result.connected ? 'Paired and connected to AetherisBot Cloud.' : 'Paired successfully. The desktop credential is saved; bridge connection is still waiting for the server-side WebSocket authentication step.';
        toast(result.connected ? 'AetherisBot connected' : 'Twitch pairing saved');
      }
    }catch(e){
      console.error('AetherisBot pairing failed',e);
      if(help) help.textContent='Pairing failed: '+(e?.message||String(e));
      toast('Could not pair AetherisBot');
    }finally{ btn.disabled=false; }
  });
  document.getElementById('aetherisbot-reconnect')?.addEventListener('click', async()=>{
    const help=document.getElementById('aetherisbot-cloud-help');
    if(help) help.textContent='Connecting to AetherisBot Cloud…';
    try{
      const result=await window.aetherisBridge?.connectAetherisBot?.();
      await refreshAetherisBotBridgeStatus();
      if(help) help.textContent=result?.ok ? 'AetherisBot Cloud bridge connected.' : 'Could not authenticate the bridge yet.';
    }catch(e){ if(help) help.textContent='Bridge connection failed: '+(e?.message||String(e)); }
  });
  document.getElementById('aetherisbot-forget')?.addEventListener('click', async()=>{
    if(!confirm("Disconnect AetherisBot from this PC? This will revoke this installation's cloud credential and you will need to Connect Twitch again to use the cloud bot.")) return;
    const btn=document.getElementById('aetherisbot-forget');
    const help=document.getElementById('aetherisbot-cloud-help');
    if(btn) btn.disabled=true;
    if(help) help.textContent="Revoking this PC's AetherisBot credential…";
    try{
      const result=await window.aetherisBridge?.disconnectAetherisBot?.({forget:true});
      if(!result?.ok){
        const disconnectLocally=confirm('AetherisBot could not reach the backend to revoke this PC\'s cloud credential. Disconnect locally anyway?\n\nThis removes the Twitch/AetherisBot connection from this PC, but the server credential may remain active until it expires or is revoked later.');
        if(!disconnectLocally){
          if(help) help.textContent='Cloud credential revoke failed. Nothing was removed locally.';
          toast('Disconnect cancelled');
          return;
        }
        const localResult=await window.aetherisBridge?.disconnectAetherisBot?.({forget:true,localOnly:true});
        if(!localResult?.ok){
          if(help) help.textContent='Local disconnect failed: '+(localResult?.message||localResult?.reason||'unknown error');
          toast('Could not disconnect AetherisBot');
          return;
        }
        applyAetherisBotBridgeStatus({paired:false,connected:false,authenticated:false,connecting:false,userId:'',lastError:''});
        renderSettings();
        toast('AetherisBot disconnected locally');
        return;
      }
      applyAetherisBotBridgeStatus({paired:false,connected:false,authenticated:false,connecting:false,userId:'',lastError:''});
      renderSettings();
      toast('AetherisBot disconnected and credential revoked');
    }catch(e){
      if(help) help.textContent='Disconnect failed: '+(e?.message||String(e));
      toast('Could not disconnect AetherisBot');
    }finally{
      if(btn && document.body.contains(btn)) btn.disabled=false;
    }
  });

  document.getElementById('tw-save').addEventListener('click', ()=>{
    s.twitch.channel = val('tw-channel').trim().replace(/^#/,'');
    s.twitch.command=normalizeCommandTrigger(val('tw-command'),'!sr');
    s.twitch.cooldown = parseInt(val('tw-cooldown'))||0;
    saveState();
    startTwitchLiveStatusWatch();
    refreshTwitchLiveStatus();
    renderDashboard();
    toast('Twitch settings saved');
  });
  document.getElementById('tw-local-connect')?.addEventListener('click', ()=>{
    s.twitch.channel = val('tw-channel').trim().replace(/^#/,'');
    s.twitch.command=normalizeCommandTrigger(val('tw-command'),'!sr');
    s.twitch.cooldown = parseInt(val('tw-cooldown'))||0;
    s.twitch.botUsername = val('tw-bot-user').trim();
    s.twitch.botOAuth = normalizeOauthToken(val('tw-bot-oauth').trim());
    saveState();
    connectTwitch();
    startTwitchLiveStatusWatch();
    refreshTwitchLiveStatus();
    renderDashboard();
    toast('Legacy Twitch connection started');
  });
  document.getElementById('tw-disconnect')?.addEventListener('click', ()=>disconnectTwitch({forgetLegacy:true}));
  document.getElementById('tw-offline-bot-testing')?.addEventListener('change', e=>{
    s.twitch.allowOfflineBotMessages=!!e.target.checked;
    saveState();
    document.getElementById('wrap-offline-bot-testing')?.classList.toggle('on', !!e.target.checked);
    updateOfflineBotStatusUi();
  });
  updateOfflineBotStatusUi();
  document.getElementById('tw-copy-oauth')?.addEventListener('click', async ()=>{
    const input = document.getElementById('tw-bot-oauth');
    const token = input?.value || '';
    if(!token){ toast('No Twitch bot token to copy'); return; }
    try{
      await navigator.clipboard.writeText(token);
      toast('Twitch bot token copied');
    }catch(e){
      input?.select();
      try{ document.execCommand('copy'); toast('Twitch bot token copied'); }
      catch(err){ toast('Could not copy Twitch bot token'); }
      input?.setSelectionRange?.(0, 0);
      input?.blur?.();
    }
  });

  document.getElementById('sp-connect').addEventListener('click', ()=>{
    s.spotify.clientId = val('sp-clientid').trim();
    saveState();
    if(!s.spotify.clientId){ toast('Enter a Spotify Client ID first'); return; }
    spotifyAuthorize();
  });
  document.getElementById('sp-disconnect').addEventListener('click', ()=>{
    s.spotify.access_token=''; s.spotify.refresh_token=''; s.spotify.expires_at=0; s.spotify.connected=false;
    saveState(); stopSpotifyPolling(); renderSettings(); updateLeds();
  });
  document.getElementById('sp-copy-redirect').addEventListener('click', async ()=>{
    const redirect = document.getElementById('sp-redirect-uri')?.value || cachedSpotifyRedirectUri;
    try{
      await navigator.clipboard.writeText(redirect);
      toast('Spotify redirect URI copied');
    }catch(e){
      const input=document.getElementById('sp-redirect-uri');
      input?.select();
      try{ document.execCommand('copy'); toast('Spotify redirect URI copied'); }
      catch(err){ toast('Could not copy redirect URI'); }
    }
  });

  document.getElementById('yt-save').addEventListener('click', ()=>{
    s.youtube.apiKey = val('yt-key').trim();
    saveState(); updateLeds();
    toast('YouTube key saved');
  });

  document.getElementById('ytmd-connect').addEventListener('click', ()=>{
    s.youtubeDesktop.host = ytmdHostAddr(val('ytmd-host'));
    s.youtubeDesktop.port = parseInt(val('ytmd-port'))||9863;
    saveState();
    connectYtmd();
  });
  document.getElementById('ytmd-disconnect').addEventListener('click', ()=>{
    disconnectYtmd();
    renderSettings();
  });
  document.getElementById('ytmd-test').addEventListener('click', ()=>{
    s.youtubeDesktop.host = ytmdHostAddr(val('ytmd-host'));
    s.youtubeDesktop.port = parseInt(val('ytmd-port'))||9863;
    saveState();
    ytmdTestConnection();
  });
  document.getElementById('ytmd-log-copy').addEventListener('click', ()=>{
    const text = ytmdLog.length ? ytmdLog.join('\n') : 'No connection attempts yet.';
    navigator.clipboard?.writeText(text);
    toast('Log copied');
  });
  document.getElementById('ytmd-return-playlist').addEventListener('change', e=>{
    s.youtubeDesktop.returnPlaylistUrl = e.target.value.trim();
    saveState();
  });
  document.getElementById('ytmd-return-shuffle').addEventListener('change', e=>{
    document.getElementById('wrap-ytmd-shuffle').classList.toggle('on', e.target.checked);
    s.youtubeDesktop.returnPlaylistShuffle = e.target.checked;
    saveState();
  });

  document.getElementById('stream-song-log-enabled')?.addEventListener('change', e=>{
    document.getElementById('wrap-stream-song-log')?.classList.toggle('on',e.target.checked);
    s.twitch.streamSongLogEnabled=e.target.checked; saveState(); 
  });
  document.getElementById('stream-song-log-folder')?.addEventListener('click', async()=>{
    await window.aetherisBridge?.openStreamSongLogFolder?.();
  });

  document.getElementById('tw-log-copy').addEventListener('click', ()=>{
    const text = twitchLog.length ? twitchLog.join('\n') : 'No connection attempts yet.';
    navigator.clipboard?.writeText(text);
    toast('Log copied');
  });


  // renderSettings() recreates the connection-status cards with their
  // default offline markup. Re-apply the real integration states after every
  // render so disconnecting Twitch does not make Spotify/YouTube/YTMD appear
  // disconnected in the top status panel while the sidebar remains correct.
  updateLeds();

  function val(id){ return document.getElementById(id).value; }
}

/* =========================================================================
   ABOUT
   ========================================================================= */
async function renderAbout(){
  const el = document.getElementById('view-about');
  if(!el) return;
  const version = (window.aetherisBridge&&window.aetherisBridge.version)||'dev';
  let developerMode=false;
  try{ developerMode=!!(await window.aetherisBridge?.getDeveloperMode?.()); }catch(_){ developerMode=false; }
  el.innerHTML = `
    <div class="pagehead"><h1>About</h1><p>App information, project links, and update controls for Aetheris.</p></div>
    <div class="panel">
      <h3>About Aetheris</h3>
      <p class="help">Aetheris is a Twitch song-request control panel with Spotify, YouTube Music Desktop, and OBS overlay support.</p>
      <div class="row" style="align-items:center;">
        <span class="pill">Version ${escapeHtml(version)}</span>
        <a class="btn ghost" href="https://github.com/Nyxia-Code/Aetheris" target="_blank" rel="noopener">GitHub repository</a>
        <button class="btn" id="check-update-btn">Check for updates</button>
      </div>
      <div class="help" id="update-check-status" style="margin-top:10px;"></div>
    </div>
    <div class="panel" style="margin-top:14px;">
      <h3>Diagnostics</h3>
      <p class="help">Checks packaged resources and the current connection setup without changing playback or queues.</p>
      <div class="row" style="align-items:center;">
        <button class="btn" id="run-diagnostics-btn">Run diagnostics</button>
        <button class="btn ghost" id="download-error-log-btn">Download error log</button>
        <span class="pill" id="diagnostics-summary">Not run</span>
      </div>
      <div id="diagnostics-results" class="help" style="margin-top:12px;line-height:1.7;"></div>
    </div>
    <div class="panel" style="margin-top:14px;">
      <h3>CodedByNyxia</h3>
      <p class="help" style="margin-bottom:0;">Aetheris is coded and maintained by Nyxia.</p>
    </div>
    ${developerMode ? `<div class="panel" style="margin-top:14px;">
      <div class="row" style="align-items:center;">
        <h3 style="margin:0;">Developer Tools</h3>
        <span class="pill on">Developer Mode</span>
      </div>
      <p class="help">Developer release testing is enabled for this launch. Select a locally built Aetheris installer to update this installed copy before publishing the release.</p>
      <button class="btn ghost" id="update-from-file-btn">Update from file…</button>
    </div>` : ''}`;

  document.getElementById('download-error-log-btn')?.addEventListener('click', async()=>{ try{ const r=await window.aetherisBridge?.exportErrorLog?.(); if(r?.ok) toast('Error log saved'); }catch(e){ toast('Could not export error log'); } });

  document.getElementById('run-diagnostics-btn')?.addEventListener('click', async ()=>{
    const btn=document.getElementById('run-diagnostics-btn');
    const summary=document.getElementById('diagnostics-summary');
    const results=document.getElementById('diagnostics-results');
    btn.disabled=true; summary.textContent='Checking…'; results.textContent='';
    const rows=[];
    const add=(name,ok,detail='')=>rows.push({name,ok,detail});
    try{
      const runtime=await window.aetherisBridge.runRuntimeDiagnostics();
      (runtime?.checks||[]).forEach(c=>add(c.name,!!c.exists,c.exists ? c.path : 'Missing: '+c.path));
      add('Twitch', isTwitchConnected(), isTwitchConnected() ? 'Connected to chat' : 'Not currently connected');
      add('Spotify', !!STATE.settings.spotify.access_token, STATE.settings.spotify.access_token ? 'Authorization token present' : 'Not connected');
      add('YouTube Data API', !!STATE.settings.youtube.apiKey, STATE.settings.youtube.apiKey ? 'API key configured' : 'API key not configured');
      const yd=STATE.settings.youtubeDesktop;
      if(yd?.host && yd?.port && window.aetherisBridge?.checkYtmdReachability){
        const probe=await window.aetherisBridge.checkYtmdReachability({host:yd.host,port:yd.port});
        add('YTMD Companion Server', !!probe?.reachable, probe?.reachable ? `${yd.host}:${yd.port} reachable` : `${yd.host}:${yd.port} not reachable`);
      }else add('YTMD Companion Server', false, 'Not configured');
      const failed=rows.filter(r=>!r.ok).length;
      summary.textContent=failed ? `${failed} check${failed===1?'':'s'} need attention` : 'All checks passed';
      summary.classList.toggle('on', failed===0);
      results.innerHTML=rows.map(r=>`<div><b style="color:${r.ok?'var(--accent-2)':'var(--danger)'};">${r.ok?'PASS':'CHECK'}</b> — ${escapeHtml(r.name)}${r.detail?` <span style="opacity:.75;">(${escapeHtml(r.detail)})</span>`:''}</div>`).join('');
    }catch(e){
      summary.textContent='Diagnostics failed';
      results.textContent=e.message||String(e);
    }finally{ btn.disabled=false; }
  });

  document.getElementById('check-update-btn')?.addEventListener('click', async ()=>{
    const btn=document.getElementById('check-update-btn'), status=document.getElementById('update-check-status');
    btn.disabled=true; status.textContent='Checking for updates…';
    try{
      const result=await window.aetherisBridge.checkForUpdates();
      if(result?.available) showUpdateAvailable(result.version);
      else status.textContent='You are up to date.';
    }catch(e){ status.textContent='Could not check for updates: '+(e.message||'unknown error'); }
    finally{ btn.disabled=false; }
  });

  document.getElementById('update-from-file-btn')?.addEventListener('click', async ()=>{
    const btn=document.getElementById('update-from-file-btn');
    const status=document.getElementById('update-check-status');
    if(!window.aetherisBridge?.installUpdateFromFile){
      status.textContent='Local update testing is not available in this build.';
      return;
    }
    btn.disabled=true; status.textContent='Choose the Aetheris installer…';
    try{
      const result=await window.aetherisBridge.installUpdateFromFile();
      if(result?.canceled){ status.textContent='Local update canceled.'; btn.disabled=false; }
      else status.textContent='Launching local update…';
    }catch(e){
      status.textContent='Could not start local update: '+(e.message||'unknown error');
      btn.disabled=false;
    }
  });
}

/* =========================================================================
   COMMANDS
   ========================================================================= */
function renderCommands(){
  const el=document.getElementById('view-commands'); if(!el)return;
  const t=STATE.settings.twitch;
  const botReady=!!(t.botUsername&&t.botOAuth);
  const svcEnabled=(svc)=>svc==='spotify'?t.spotifyCommandsEnabled!==false:t.youtubeCommandsEnabled!==false;
  const getPreset=(svc,key)=>{
    const bag=t[svc+'Playback']||{};
    return bag[key]===null||bag[key]===undefined ? !!t[key+'CmdEnabled'] : !!bag[key];
  };
  const serviceCard=(svc,label,desc,vars)=>{
    const enabled=svcEnabled(svc);
    const bag=t[svc+'Playback']||{};
    const commandNames=t[svc+'CommandNames']||{};
    const defaults={skip:t.skipCmd||'!skip',pause:t.pauseCmd||'!pause',resume:t.resumeCmd||'!resume',rewind:t.rewindCmd||'!previous'};
    const rows=[['skip','Skip',commandNames.skip||defaults.skip,'Next track'],['pause','Pause',commandNames.pause||defaults.pause,'Pause playback'],['resume','Resume',commandNames.resume||defaults.resume,'Resume playback'],['rewind','Previous',commandNames.rewind||defaults.rewind,'Previous track']];
    return `<div class="service-command-card ${enabled?'':'disabled'}" id="command-card-${svc}">
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px;"><div><h3 style="margin:0;">${label}</h3><div class="help">${desc}</div></div><label class="pill ${enabled?'on':''}" style="cursor:pointer;"><input type="checkbox" data-service-toggle="${svc}" ${enabled?'checked':''} style="display:none;">${enabled?'Enabled':'Disabled'}</label></div>
      <div class="help" style="margin:10px 0 5px;"><b>Variables:</b> ${vars.map(v=>`<code>${v}</code>`).join(' ')}</div>
      <div style="margin-top:10px;">${rows.map(([key,name,trigger,help])=>`<div class="command-preset"><div class="meta" style="flex:1;"><b>${name}</b><span>${help}</span><input type="text" data-command-name-service="${svc}" data-command-name-key="${key}" value="${escapeHtml(trigger)}" style="margin-top:6px;max-width:180px;" aria-label="${label} ${name} command"></div><label class="pill ${getPreset(svc,key)?'on':''}" style="cursor:pointer;"><input type="checkbox" data-preset-service="${svc}" data-preset-key="${key}" ${getPreset(svc,key)?'checked':''} style="display:none;">${getPreset(svc,key)?'On':'Off'}</label></div>`).join('')}</div>
    </div>`;
  };
  el.innerHTML=`
    <div class="pagehead"><h1>Commands</h1><p>Choose which music services chat commands can control, then enable only the presets you want.</p></div>
    ${botReady?'':`<div class="panel span-full" style="border-color:var(--danger);"><h3 style="color:var(--danger);">No bot connected</h3><p class="help" style="margin:0;">Commands that reply in chat need a bot username and OAuth token in Settings → Twitch.</p></div>`}

    <div class="panel span-full"><h3>General commands</h3><div class="grid2">
      <div><label class="pill ${t.announceNowPlaying?'on':''}" id="wrap-cmd-announce" style="cursor:pointer;display:inline-flex;margin-bottom:8px;"><input type="checkbox" id="cmd-announce" ${t.announceNowPlaying?'checked':''} style="display:none;">Now-playing announcement</label><div class="field"><input type="text" id="cmd-announce-template" value="${escapeHtml(t.announceTemplate)}"></div><div class="help"><code>{title}</code> <code>{artist}</code> <code>{source}</code></div></div>
      <div><label class="pill ${t.announceOnConnect?'on':''}" id="wrap-cmd-connect" style="cursor:pointer;display:inline-flex;margin-bottom:8px;"><input type="checkbox" id="cmd-connect" ${t.announceOnConnect?'checked':''} style="display:none;">Startup announcement</label><div class="field"><input type="text" id="cmd-connect-template" value="${escapeHtml(t.connectAnnounceTemplate)}"></div><div class="help">Sent once after the Twitch bot connects.</div></div>
      <div><label class="pill ${t.notify?'on':''}" id="wrap-cmd-notify" style="cursor:pointer;display:inline-flex;margin-bottom:8px;"><input type="checkbox" id="cmd-notify" ${t.notify?'checked':''} style="display:none;">Request confirmation</label><div class="field"><input type="text" id="cmd-confirm-template" value="${escapeHtml(t.confirmTemplate)}"></div><div class="help"><code>{user}</code> <code>{query}</code></div></div>
      <div><div class="grid2"><div><label class="pill ${t.nowPlayingCmdEnabled?'on':''}" id="wrap-cmd-np" style="cursor:pointer;display:inline-flex;margin-bottom:8px;"><input type="checkbox" id="cmd-np-enabled" ${t.nowPlayingCmdEnabled?'checked':''} style="display:none;">Now playing command</label><input type="text" id="cmd-np-trigger" value="${escapeHtml(t.nowPlayingCmd)}"></div><div><label class="pill ${t.queueCmdEnabled?'on':''}" id="wrap-cmd-queue" style="cursor:pointer;display:inline-flex;margin-bottom:8px;"><input type="checkbox" id="cmd-queue-enabled" ${t.queueCmdEnabled?'checked':''} style="display:none;">Pending queue command</label><input type="text" id="cmd-queue-trigger" value="${escapeHtml(t.queueCmd)}"></div></div></div>
    </div></div>

    <div class="panel span-full"><div class="row" style="justify-content:space-between;align-items:center;"><div><h3 style="margin-bottom:4px;">Music service commands</h3><div class="help">The service toggle is the master switch. Preset commands only control that service when it is the active Now Playing source.</div></div><label class="pill ${t.playbackCmdsModOnly?'on':''}" id="wrap-cmd-modonly" style="cursor:pointer;"><input type="checkbox" id="cmd-modonly" ${t.playbackCmdsModOnly?'checked':''} style="display:none;">Mods & broadcaster only</label></div><div class="service-command-grid" style="margin-top:14px;">
      ${serviceCard('spotify','Spotify','Commands are routed only when Spotify is the active source.',['{title}','{artist}','{source}','{spotify_uri}','{queue}'])}
      ${serviceCard('youtube','YouTube','Commands are routed only when YouTube Music Desktop is the active source.',['{title}','{artist}','{source}','{youtube_id}','{queue}'])}
    </div></div>

    <div class="panel span-full"><h3>Custom commands</h3><div id="custom-cmd-list"></div><div class="grid2" style="margin-top:14px;"><div class="field"><label>Trigger</label><input type="text" id="new-cmd-trigger" placeholder="!discord"></div><div class="field"><label>Response</label><input type="text" id="new-cmd-response" placeholder="Join the discord: your-link-here"></div></div><button class="btn small" id="add-cmd-btn">Add command</button><div class="help">General variables: <code>{user}</code> <code>{query}</code> <code>{title}</code> <code>{artist}</code> <code>{source}</code> <code>{queue}</code> <code>{channel}</code> <code>{count}</code> <code>{time}</code></div></div>
    <button class="btn" id="cmd-save">Save command text</button>`;

  [['wrap-cmd-notify','cmd-notify','notify'],['wrap-cmd-announce','cmd-announce','announceNowPlaying'],['wrap-cmd-connect','cmd-connect','announceOnConnect'],['wrap-cmd-modonly','cmd-modonly','playbackCmdsModOnly'],['wrap-cmd-np','cmd-np-enabled','nowPlayingCmdEnabled'],['wrap-cmd-queue','cmd-queue-enabled','queueCmdEnabled']].forEach(([wrapId,boxId,field])=>{const box=document.getElementById(boxId);box?.addEventListener('change',e=>{document.getElementById(wrapId)?.classList.toggle('on',e.target.checked);t[field]=e.target.checked;saveState();});});
  el.querySelectorAll('[data-service-toggle]').forEach(box=>box.addEventListener('change',e=>{const svc=e.target.dataset.serviceToggle;t[svc+'CommandsEnabled']=e.target.checked;saveState();renderCommands();}));
  el.querySelectorAll('[data-preset-service]').forEach(box=>box.addEventListener('change',e=>{const svc=e.target.dataset.presetService,key=e.target.dataset.presetKey;t[svc+'Playback']=t[svc+'Playback']||{};t[svc+'Playback'][key]=e.target.checked;saveState();renderCommands();}));
  el.querySelectorAll('[data-command-name-service]').forEach(input=>input.addEventListener('change',e=>{const svc=e.target.dataset.commandNameService,key=e.target.dataset.commandNameKey;t[svc+'CommandNames']=t[svc+'CommandNames']||{};let trigger=e.target.value.trim();if(trigger&&!trigger.startsWith('!')) trigger='!'+trigger;const fallback={skip:'!skip',pause:'!pause',resume:'!resume',rewind:'!previous'}[key];t[svc+'CommandNames'][key]=trigger||fallback;e.target.value=t[svc+'CommandNames'][key];saveState();toast((svc==='spotify'?'Spotify':'YouTube')+' command saved');}));
  document.getElementById('add-cmd-btn')?.addEventListener('click',()=>{const trigger=document.getElementById('new-cmd-trigger').value.trim(),response=document.getElementById('new-cmd-response').value.trim();if(!trigger||!response){toast('Enter both a trigger and a response');return;}t.customCommands=t.customCommands||[];t.customCommands.push({id:'c'+Date.now(),trigger:trigger.startsWith('!')?trigger:'!'+trigger,response,enabled:true,count:0});saveState();renderCommands();toast('Command added');});
  document.getElementById('cmd-save')?.addEventListener('click',()=>{t.confirmTemplate=document.getElementById('cmd-confirm-template').value.trim()||DEFAULT_STATE.settings.twitch.confirmTemplate;t.announceTemplate=document.getElementById('cmd-announce-template').value.trim()||DEFAULT_STATE.settings.twitch.announceTemplate;t.connectAnnounceTemplate=document.getElementById('cmd-connect-template').value.trim()||DEFAULT_STATE.settings.twitch.connectAnnounceTemplate;t.nowPlayingCmd=normalizeCommandTrigger(document.getElementById('cmd-np-trigger').value,'!song');t.queueCmd=normalizeCommandTrigger(document.getElementById('cmd-queue-trigger').value,'!queue');saveState();toast('Commands saved');});
  renderCustomCommandList();
  function renderCustomCommandList(){const list=document.getElementById('custom-cmd-list'),cmds=t.customCommands||[];if(!list)return;if(!cmds.length){list.innerHTML='<div class="empty-state">No custom commands yet.</div>';return;}list.innerHTML=cmds.map(c=>`<div class="queue-item"><div class="who">${escapeHtml(c.trigger)}</div><div class="what">${escapeHtml(c.response)}</div><div class="when">used ${c.count||0}×</div><div class="queue-actions"><label class="pill ${c.enabled!==false?'on':''}" style="cursor:pointer;" data-toggle="${c.id}">${c.enabled!==false?'on':'off'}</label><button class="btn small danger" data-del="${c.id}">✕</button></div></div>`).join('');list.querySelectorAll('[data-toggle]').forEach(b=>b.addEventListener('click',()=>{const c=t.customCommands.find(x=>x.id===b.dataset.toggle);c.enabled=c.enabled===false;saveState();renderCustomCommandList();}));list.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',()=>{t.customCommands=t.customCommands.filter(x=>x.id!==b.dataset.del);saveState();renderCustomCommandList();}));}
}

/* =========================================================================
   CUSTOMIZATION
   ========================================================================= */
function renderCustomize(){
  const el = document.getElementById('view-customize');
  if(!el) return;
  let savedSub = null;
  try{ savedSub = localStorage.getItem('aetheris_lastsub'); }catch(e){}
  const startSub = (savedSub==='overlay') ? 'overlay' : 'theme';
  el.innerHTML = `
    <div class="pagehead"><h1>Customization</h1><p>Style the control panel and the on-stream overlay independently.</p></div>
    <div class="tablist">
      <button class="tabbtn ${startSub==='theme'?'active':''}" data-sub="theme">App Theme</button>
      <button class="tabbtn ${startSub==='overlay'?'active':''}" data-sub="overlay">Song Overlay</button>
    </div>
    <div class="panel" style="margin-top:14px;">
      <h3>Customization files</h3>
      <p class="help">Export your theme and optional OBS overlay settings to a portable JSON file. Connection credentials and tokens are never included.</p>
      <label class="pill ${STATE.settings.__exportIncludeOverlay!==false?'on':''}" style="cursor:pointer;display:inline-flex;margin-bottom:12px;" id="wrap-export-overlay">
        <input type="checkbox" id="export-include-overlay" ${STATE.settings.__exportIncludeOverlay!==false?'checked':''} style="display:none;">Include OBS overlay settings
      </label>
      <div class="row">
        <button class="btn" id="customization-export">Export to file</button>
        <button class="btn ghost" id="customization-import">Import from file</button>
        <input type="file" id="customization-import-file" accept="application/json,.json" style="display:none;">
      </div>
    </div>
    <div class="subview ${startSub==='theme'?'active':''}" id="sub-theme"></div>
    <div class="subview ${startSub==='overlay'?'active':''}" id="sub-overlay"></div>
  `;
  el.querySelectorAll('.tabbtn').forEach(b=>{
    b.addEventListener('click', ()=>{
      el.querySelectorAll('.tabbtn').forEach(x=>x.classList.toggle('active', x===b));
      el.querySelectorAll('.subview').forEach(v=>v.classList.toggle('active', v.id==='sub-'+b.dataset.sub));
      try{ localStorage.setItem('aetheris_lastsub', b.dataset.sub); }catch(e){}
      // the marquee measures container width, which is 0 while its tab is hidden —
      // recompute now that the overlay tab is actually visible
      if(b.dataset.sub==='overlay' && typeof refreshOverlayPreview==='function') refreshOverlayPreview();
    });
  });
  document.getElementById('export-include-overlay').addEventListener('change', e=>{
    document.getElementById('wrap-export-overlay').classList.toggle('on', e.target.checked);
    STATE.settings.__exportIncludeOverlay = e.target.checked;
    saveState();
  });
  document.getElementById('customization-export').addEventListener('click', exportCustomization);
  document.getElementById('customization-import').addEventListener('click', ()=> document.getElementById('customization-import-file').click());
  document.getElementById('customization-import-file').addEventListener('change', async e=>{
    const file = e.target.files?.[0];
    if(file) await importCustomizationFile(file);
    e.target.value = '';
  });
  renderThemeTab();
  renderOverlayTab();
  if(startSub==='overlay' && typeof refreshOverlayPreview==='function') refreshOverlayPreview();
}

function renderThemeTab(){
  const el = document.getElementById('sub-theme');
  const t = STATE.theme;
  el.innerHTML = `
    <div class="panel-grid">
      <div style="display:flex;flex-direction:column;gap:16px;min-width:0;">
        <div class="panel">
          <h3>Font</h3>
          <select id="th-font">${FONT_OPTIONS.map(f=>`<option value="${f.name}" ${f.name===t.font?'selected':''}>${f.name}</option>`).join('')}</select>
        </div>
        <div class="panel">
          <h3>Shape & density</h3>
          <div class="slider-row"><label>Corner roundness <span class="val" id="th-radius-val">${t.radius}px</span></label>
          <input type="range" id="th-radius" min="0" max="24" value="${t.radius}"></div>
          <label class="pill ${t.compact?'on':''}" style="cursor:pointer;display:inline-flex;" id="wrap-th-compact">
            <input type="checkbox" id="th-compact" ${t.compact?'checked':''} style="display:none;">Compact mode (tighter spacing)
          </label>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px;min-width:0;">
        <div class="panel">
          <h3>Colors</h3>
          <div class="swatch-row">
            ${swatch('th-bg','Background',t.bg)}
            ${swatch('th-panel','Panels',t.panel)}
            ${swatch('th-accent','Buttons / accent',t.accent)}
            ${swatch('th-accent2','Secondary accent',t.accent2)}
            ${swatch('th-text','Text',t.text)}
          </div>
          <p class="help" style="margin-top:10px;">Secondary accent shows up on "connected"-style badges and highlighted chips throughout the app.</p>
        </div>
        <div class="panel">
          <h3>Background style</h3>
          <select id="th-bgstyle">
            <option value="grain" ${t.bgStyle==='grain'?'selected':''}>Subtle grain (default)</option>
            <option value="glow" ${t.bgStyle==='glow'?'selected':''}>Glow</option>
            <option value="flat" ${t.bgStyle==='flat'?'selected':''}>Flat / plain</option>
          </select>
          <div id="bg-glow-color-section" style="margin-top:14px;${t.bgStyle==='glow'?'':'display:none;'}">
            <div class="slider-row"><label>Glow strength <span class="val" id="th-glow-strength-val">${t.glowStrength}%</span></label>
            <input type="range" id="th-glow-strength" min="5" max="100" value="${t.glowStrength}"></div>
            <label class="pill ${t.glowColorEnabled?'on':''}" style="cursor:pointer;display:inline-flex;" id="wrap-th-glow-enabled">
              <input type="checkbox" id="th-glow-enabled" ${t.glowColorEnabled?'checked':''} style="display:none;">Custom glow color
            </label>
            <div class="swatch-row" style="margin-top:10px;${t.glowColorEnabled?'':'display:none;'}" id="th-glow-color-swatch">
              ${colorSwatchControl('th-glow-color','Glow color',t.glowColor)}
            </div>
            <p class="help" style="margin-top:8px;">Off uses your accent color for the glow instead.</p>
          </div>
        </div>
      </div>
    </div>
    <div class="row">
      <button class="btn" id="th-save">Apply theme</button>
      <button class="btn ghost" id="th-reset">Reset to default</button>
    </div>
  `;
  function swatch(id,label,val){
    return colorSwatchControl(id,label,val);
  }
  bindAetherisColorControls(el);
  document.getElementById('th-radius').addEventListener('input', e=>{
    document.getElementById('th-radius-val').textContent = e.target.value+'px';
  });
  document.getElementById('th-compact').addEventListener('change', e=>{
    document.getElementById('wrap-th-compact').classList.toggle('on', e.target.checked);
  });
  document.getElementById('th-bgstyle').addEventListener('change', e=>{
    document.getElementById('bg-glow-color-section').style.display = e.target.value==='glow' ? '' : 'none';
  });
  document.getElementById('th-glow-enabled').addEventListener('change', e=>{
    document.getElementById('wrap-th-glow-enabled').classList.toggle('on', e.target.checked);
    document.getElementById('th-glow-color-swatch').style.display = e.target.checked ? '' : 'none';
  });
  document.getElementById('th-glow-strength').addEventListener('input', e=>{
    document.getElementById('th-glow-strength-val').textContent = e.target.value+'%';
  });
  document.getElementById('th-save').addEventListener('click', ()=>{
    t.font = document.getElementById('th-font').value;
    t.bg = document.getElementById('th-bg').value;
    t.panel = document.getElementById('th-panel').value;
    t.accent = document.getElementById('th-accent').value;
    t.accent2 = document.getElementById('th-accent2').value;
    t.text = document.getElementById('th-text').value;
    t.radius = parseInt(document.getElementById('th-radius').value);
    t.compact = document.getElementById('th-compact').checked;
    t.bgStyle = document.getElementById('th-bgstyle').value;
    t.glowColorEnabled = document.getElementById('th-glow-enabled').checked;
    t.glowColor = document.getElementById('th-glow-color').value;
    t.glowStrength = parseInt(document.getElementById('th-glow-strength').value);
    saveState();
    applyTheme();
    toast('Theme applied');
  });
  document.getElementById('th-reset').addEventListener('click', ()=>{
    STATE.theme = structuredClone(DEFAULT_STATE.theme);
    saveState(); applyTheme(); renderThemeTab();
  });
}

function refreshOverlayPreview(){ if(currentOverlayPreviewFn) currentOverlayPreviewFn(); }

async function renderOverlayTab(){
  const el = document.getElementById('sub-overlay');
  const o = STATE.overlay;
  let overlayUrl='';
  try{
    if(window.aetherisBridge?.getOverlayBaseUrl) overlayUrl=await window.aetherisBridge.getOverlayBaseUrl();
  }catch(e){ console.error('Could not resolve OBS overlay relay URL', e); }
  if(!overlayUrl) overlayUrl='Aetheris overlay relay unavailable';
  el.innerHTML = `
    <div class="panel span-full">
      <h3>Overlay for OBS</h3>
      <p class="help" style="margin-top:-6px;">Add this localhost URL as a Browser Source in OBS. Aetheris securely relays only now-playing data and overlay styling — service credentials are never included in the URL.</p>
      <div class="row">
        <input type="text" readonly value="${overlayUrl}" style="flex:1;min-width:260px;">
        <button class="btn ghost small" id="ov-copy">Copy URL</button>
        <button class="btn small" id="ov-preview">Open preview</button>
      </div>
      <div class="help">Recommended Browser Source size: ${o.width + 40} × 160px.</div>
      <div class="help">The URL stays stable on this Windows profile and updates automatically when playback or overlay styling changes. Keep Aetheris running while streaming; OBS does not receive your Spotify refresh token, YTMD token, Twitch token, or API keys.</div>
    </div>

    <div class="panel-grid">
    <div class="panel">
      <h3>Style</h3>
      <div class="preset-grid">
        ${OVERLAY_PRESETS.map(p=>`<div class="preset-card ${o.style===p.id?'selected':''}" data-style="${p.id}">${p.name}</div>`).join('')}
      </div>
    </div>

    <div class="panel">
      <h3>Album cover</h3>
      <div class="field"><label>Cover motion</label>
        <select id="ov-cover-motion">
          <option value="none" ${o.coverMotion==='none'?'selected':''}>None</option>
          <option value="zoom" ${o.coverMotion==='zoom'?'selected':''}>Slow zoom</option>
          <option value="spin" ${o.coverMotion==='spin'?'selected':''}>Spin (vinyl)</option>
        </select>
      </div>
      <label class="pill ${o.canvasBackdrop?'on':''}" style="cursor:pointer;display:inline-flex;margin-top:8px;" id="wrap-ov-canvas-backdrop">
        <input type="checkbox" id="ov-canvas-backdrop" ${o.canvasBackdrop?'checked':''} style="display:none;">Use album art as a blurred, moving backdrop
      </label>
      <p class="help" style="margin-top:8px;">This fills the whole widget with a soft, slowly panning blow-up of the current cover — similar effect to Spotify Canvas, built from the artwork you already have (Spotify doesn't expose real Canvas videos through its public API).</p>
    </div>

    <div class="panel">
      <h3>Layout & spacing</h3>
      <div class="grid2">
        <div class="slider-row"><label>Padding <span class="val" id="ov-padding-val">${o.padding}px</span></label><input type="range" id="ov-padding" min="4" max="36" value="${o.padding}"></div>
        <div class="slider-row"><label>Gap between art and text <span class="val" id="ov-gap-val">${o.gap}px</span></label><input type="range" id="ov-gap" min="0" max="30" value="${o.gap}"></div>
        <div class="slider-row"><label>Cover art size <span class="val" id="ov-art-val">${o.artSize}px</span></label><input type="range" id="ov-art" min="0" max="120" value="${o.artSize}"></div>
        <div class="slider-row"><label>Corner roundness <span class="val" id="ov-radius-val">${o.radius}px</span></label><input type="range" id="ov-radius" min="0" max="40" value="${o.radius}"></div>
        <div class="slider-row"><label>Title text size <span class="val" id="ov-titlesize-val">${o.titleSize}px</span></label><input type="range" id="ov-titlesize" min="10" max="28" value="${o.titleSize}"></div>
        <div class="slider-row"><label>Progress bar height <span class="val" id="ov-barheight-val">${o.barHeight}px</span></label><input type="range" id="ov-barheight" min="2" max="14" value="${o.barHeight}"></div>
        <div class="slider-row"><label>Widget width <span class="val" id="ov-width-val">${o.width}px</span></label><input type="range" id="ov-width" min="220" max="550" value="${o.width}"></div>
      </div>
    </div>

    <div class="panel">
      <h3>Color & transparency</h3>
      <div class="swatch-row">
        ${swatch('ov-bg','Background',o.bg)}
        ${swatch('ov-text','Text',o.text)}
        ${swatch('ov-accent','Progress bar',o.accent)}
      </div>
      <div class="slider-row" style="margin-top:14px;"><label>Background opacity <span class="val" id="ov-transparency-val">${o.transparency}%</span></label><input type="range" id="ov-transparency" min="0" max="100" value="${o.transparency}"></div>
    </div>

    <div class="panel">
      <h3>Rolling title text</h3>
      <div class="slider-row"><label>Scroll speed <span class="val" id="ov-speed-val">${o.scrollSpeed} px/s</span></label><input type="range" id="ov-speed" min="5" max="150" value="${o.scrollSpeed}"></div>
      <p class="help">Only scrolls when the song title is longer than the widget. Higher = faster. OBS Browser Source should be at least the widget width + 48px so the neon glow is not clipped.</p>
    </div>

    <div class="panel">
      <h3>Elements</h3>
      <div class="row">
        ${toggle('ov-showArt','Cover art', o.showArt)}
        ${toggle('ov-showProgress','Progress bar', o.showProgress)}
        ${toggle('ov-showArtist','Artist name', o.showArtist)}
        ${toggle('ov-showBadge','Source badge', o.showBadge)}
      </div>
    </div>
    </div>

    <div class="panel span-full">
      <h3>Live preview</h3>
      <div id="ov-livepreview" style="background:repeating-conic-gradient(#2a2620 0% 25%, #201d18 0% 50%) 0 0/20px 20px;border-radius:8px;overflow:auto;"></div>
    </div>

    <div class="row">
      <button class="btn" id="ov-save">Apply overlay style</button>
      <button class="btn ghost" id="ov-reset">Reset to default</button>
    </div>
  `;

  function swatch(id,label,val){ return colorSwatchControl(id,label,val); }
  bindAetherisColorControls(el);
  function toggle(id,label,checked){
    return `<label class="pill ${checked?'on':''}" style="cursor:pointer;" id="wrap-${id}">
      <input type="checkbox" id="${id}" ${checked?'checked':''} style="display:none;">${label}
    </label>`;
  }

  el.querySelectorAll('.preset-card').forEach(c=>{
    c.addEventListener('click', ()=>{
      el.querySelectorAll('.preset-card').forEach(x=>x.classList.remove('selected'));
      c.classList.add('selected');
      previewOverlayLive();
    });
  });
  document.getElementById('ov-cover-motion').addEventListener('change', previewOverlayLive);
  document.getElementById('ov-canvas-backdrop').addEventListener('change', e=>{
    document.getElementById('wrap-ov-canvas-backdrop').classList.toggle('on', e.target.checked);
    previewOverlayLive();
  });
  document.getElementById('ov-copy').addEventListener('click', ()=>{
    navigator.clipboard?.writeText(overlayUrl);
    toast('Overlay URL copied');
  });
  document.getElementById('ov-preview').addEventListener('click', ()=>{
    window.open(overlayUrl, 'rd_overlay_preview', 'width='+(STATE.overlay.width+60)+',height=220');
  });
  ['ov-showArt','ov-showProgress','ov-showArtist','ov-showBadge'].forEach(id=>{
    document.getElementById(id).addEventListener('change', e=>{
      document.getElementById('wrap-'+id).classList.toggle('on', e.target.checked);
      previewOverlayLive();
    });
  });
  [['ov-padding','px'],['ov-gap','px'],['ov-art','px'],['ov-radius','px'],['ov-titlesize','px'],['ov-barheight','px'],['ov-width','px'],['ov-transparency','%'],['ov-speed',' px/s']].forEach(([id,unit])=>{
    document.getElementById(id).addEventListener('input', e=>{
      document.getElementById(id+'-val').textContent = e.target.value+unit;
      previewOverlayLive();
    });
  });
  ['ov-bg','ov-text','ov-accent'].forEach(id=>document.getElementById(id).addEventListener('input', previewOverlayLive));

  document.getElementById('ov-save').addEventListener('click', ()=>{
    readOverlayFormInto(o);
    saveState();
    toast('Overlay style saved');
  });
  document.getElementById('ov-reset').addEventListener('click', ()=>{
    STATE.overlay = structuredClone(DEFAULT_STATE.overlay);
    saveState(); renderOverlayTab();
  });

  previewOverlayLive();
  currentOverlayPreviewFn = previewOverlayLive;

  function readOverlayFormInto(target){
    target.style = el.querySelector('.preset-card.selected')?.dataset.style || target.style;
    target.padding = parseInt(document.getElementById('ov-padding').value);
    target.gap = parseInt(document.getElementById('ov-gap').value);
    target.artSize = parseInt(document.getElementById('ov-art').value);
    target.radius = parseInt(document.getElementById('ov-radius').value);
    target.titleSize = parseInt(document.getElementById('ov-titlesize').value);
    target.barHeight = parseInt(document.getElementById('ov-barheight').value);
    target.width = parseInt(document.getElementById('ov-width').value);
    target.bg = document.getElementById('ov-bg').value;
    target.text = document.getElementById('ov-text').value;
    target.accent = document.getElementById('ov-accent').value;
    target.transparency = parseInt(document.getElementById('ov-transparency').value);
    target.scrollSpeed = parseInt(document.getElementById('ov-speed').value);
    target.showArt = document.getElementById('ov-showArt').checked;
    target.showProgress = document.getElementById('ov-showProgress').checked;
    target.showArtist = document.getElementById('ov-showArtist').checked;
    target.showBadge = document.getElementById('ov-showBadge').checked;
    target.coverMotion = document.getElementById('ov-cover-motion')?.value || 'none';
    target.canvasBackdrop = document.getElementById('ov-canvas-backdrop')?.checked || false;
  }

  function previewOverlayLive(){
    const temp = structuredClone(o);
    readOverlayFormInto(temp);
    const bgAlpha = hexToRgba(temp.bg, temp.transparency);
    const fontStack = (FONT_OPTIONS.find(f=>f.name===temp.font)||FONT_OPTIONS[0]).stack;
    const placeholderArt = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><rect width='200' height='200' fill='${temp.accent}'/><circle cx='100' cy='100' r='55' fill='${temp.accent}' opacity='.6'/></svg>`);
    const np = STATE.nowPlaying || {title:'Sample Song Title That Is Deliberately Long So You Can Preview The Rolling Text', artist:'Sample Artist', art:placeholderArt, progressMs:63000, durationMs:210000, source:'spotify'};
    const pct = np.durationMs ? Math.min(100,(np.progressMs/np.durationMs)*100):0;
    const artClass = temp.coverMotion==='zoom' ? 'motion-zoom' : (temp.coverMotion==='spin' ? 'motion-spin' : '');
    document.getElementById('ov-livepreview').innerHTML = `
      <div class="ov-preview-root">
        <div class="ov-widget style-${temp.style}" style="
          --ov-bg:${bgAlpha};--ov-text:${temp.text};--ov-accent:${temp.accent};
          --ov-pad:${temp.padding}px;--ov-gap:${temp.gap}px;--ov-art:${temp.artSize}px;
          --ov-radius:${temp.radius}px;--ov-titlesize:${temp.titleSize}px;--ov-barheight:${temp.barHeight}px;
          --ov-width:${temp.width}px;--ov-font:${fontStack};
          ${temp.canvasBackdrop ? `--ov-backdrop-img:url('${cssUrlSafe(np.art)}');` : ''}">
          ${temp.canvasBackdrop ? `<div class="ov-backdrop"></div>` : ``}
          ${temp.showArt ? `<img class="ov-art ${artClass}" src="${escapeHtml(np.art||'')}" alt="">` : ``}
          <div class="ov-body">
            <div class="ov-marquee ov-title" id="prev-marquee"><span class="inner" id="prev-marquee-inner"><span class="marquee-copy">${escapeHtml(np.title)}</span><span class="marquee-copy" aria-hidden="true">${escapeHtml(np.title)}</span></span></div>
            ${temp.showArtist ? `<div class="ov-artist">${escapeHtml(np.artist)}</div>`:``}
            ${temp.showProgress ? `<div class="ov-progress"><div class="fill" style="width:${pct}%"></div></div><div class="ov-badge">${fmtTime(np.progressMs)} / ${fmtTime(np.durationMs)}${temp.showBadge?' · '+escapeHtml(np.source||''):''}</div>` : (temp.showBadge?`<div class="ov-badge">${np.source}</div>`:``)}
          </div>
        </div>
      </div>`;

    scheduleOverlayMarquee('prev-marquee','prev-marquee-inner',temp.scrollSpeed);
  }
}
function applyOverlayVarsPreviewIfOpen(){ /* no-op placeholder for future live-link */ }

/* =========================================================================
   TWITCH  — plain WebSocket IRC client, no external library.
   Twitch's chat is just IRC-over-WebSocket: wss://irc-ws.chat.twitch.tv:443
   ========================================================================= */
function ytmdHostAddr(input){
  // The Companion Server's docs require the literal IPv4 address — on some
  // systems (notably Windows) "localhost" resolves to the IPv6 ::1 first,
  // which this server doesn't listen on, causing silent connection failures.
  const h = (input||'').trim();
  if(!h) return '127.0.0.1';
  return /^localhost$/i.test(h) ? '127.0.0.1' : h;
}

function normalizeOauthToken(t){
  if(!t) return t;
  t = t.trim().replace(/^["']+|["']+$/g,'').replace(/\s+/g,'');
  return t.startsWith('oauth:') ? t : 'oauth:'+t;
}
function fillTemplate(tpl, vars){
  return String(tpl||'').replace(/\{(\w+)\}/g, (m,k)=> vars[k]!==undefined ? vars[k] : m);
}

// Every template (confirmations, announcements, custom commands) gets this
// full set of variables merged in, regardless of which one triggered it —
// so any variable can be used anywhere it makes sense to.
function templateContext(extra={}){
  const np = STATE.nowPlaying;
  return {
    channel: twitchChannel || STATE.settings.twitch.channel || '',
    queue: String(STATE.queue.length),
    title: np?.title || '',
    artist: np?.artist || '',
    source: np?.source==='ytmdesktop' ? 'YouTube Music Desktop' : (np?.source==='spotify' ? 'Spotify' : (np?.source || '')),
    spotify_uri: np?.source==='spotify' ? (np.uri||'') : '',
    youtube_id: np?.source==='ytmdesktop' ? (np.videoId||'') : '',
    time: new Date().toLocaleTimeString(),
    ...extra
  };
}



function offlineBotTestingEnabled(){
  return STATE.settings.twitch.allowOfflineBotMessages === true;
}

async function refreshTwitchLiveStatus(){
  if(twitchLiveStatusInFlight) return twitchChannelLive;

  // Cloud mode gets live/offline state from the backend over the authenticated
  // AetherisBot WebSocket. Do not require the legacy local bot OAuth token.
  if(aetherisBotBridgeStatus.authenticated){
    if(aetherisBotBridgeStatus.streamStatusKnown){
      twitchChannelLive=!!aetherisBotBridgeStatus.streamLive;
    }else{
      twitchChannelLive=null;
    }
    updateOfflineBotStatusUi();
    return twitchChannelLive;
  }

  // Legacy fallback: retain the old local Helix polling path when cloud mode
  // is not authenticated and a legacy bot OAuth token is configured.
  const channel=(STATE.settings.twitch.channel||'').trim();
  const oauth=(STATE.settings.twitch.botOAuth||'').trim();

  if(!channel || !oauth || !window.aetherisBridge?.getTwitchLiveStatus){
    twitchChannelLive=null;
    updateOfflineBotStatusUi();
    return null;
  }

  twitchLiveStatusInFlight=true;
  try{
    const result=await window.aetherisBridge.getTwitchLiveStatus({channel,oauth});
    twitchChannelLive=result?.ok ? !!result.live : null;
  }catch(e){
    twitchChannelLive=null;
    console.warn('Could not verify Twitch live status:',e);
  }finally{
    twitchLiveStatusInFlight=false;
    updateOfflineBotStatusUi();
  }
  return twitchChannelLive;
}

function startTwitchLiveStatusWatch(){
  if(!twitchLiveStatusTimer){
    twitchLiveStatusTimer=setInterval(()=>{
      if(!aetherisBotBridgeStatus.authenticated) refreshTwitchLiveStatus();
    },60000);
  }
  refreshTwitchLiveStatus();
}

function botMaySpeakInChat(){
  return offlineBotTestingEnabled() || twitchChannelLive === true;
}

function updateOfflineBotStatusUi(){
  const el=document.getElementById('tw-offline-chat-status');
  if(!el) return;
  if(offlineBotTestingEnabled()){
    twitchOfflineSuppressionLogged=false;
    el.textContent='Testing mode: offline bot messages allowed';
    el.classList.add('on');
  }else if(twitchChannelLive===true){
    twitchOfflineSuppressionLogged=false;
    el.textContent=aetherisBotBridgeStatus.authenticated ? 'Live: bot messages allowed (cloud)' : 'Live: bot messages allowed';
    el.classList.add('on');
  }else if(twitchChannelLive===false){
    el.textContent=aetherisBotBridgeStatus.authenticated ? 'Offline: bot messages muted (cloud)' : 'Offline: bot messages muted';
    el.classList.remove('on');
  }else{
    el.textContent='Live status unknown: bot messages muted';
    el.classList.remove('on');
  }
}

function isTwitchConnected(){
  return !!aetherisBotBridgeStatus.authenticated || !!(twitchSocket && twitchSocket.readyState === WebSocket.OPEN && twitchJoined);
}

function isAetherisBotConnected(){
  return !!aetherisBotBridgeStatus.authenticated;
}

function applyAetherisBotBridgeStatus(status={}){
  aetherisBotBridgeStatus = { ...aetherisBotBridgeStatus, ...status };
  if(status.streamStatusKnown === true){
    twitchChannelLive=!!status.streamLive;
    twitchOfflineSuppressionLogged=false;
    updateOfflineBotStatusUi();
  }else if(status.streamStatusKnown === false && status.authenticated === true){
    twitchChannelLive=null;
    updateOfflineBotStatusUi();
  }else if(status.authenticated === false && !((STATE.settings.twitch.botOAuth||'').trim())){
    twitchChannelLive=null;
    updateOfflineBotStatusUi();
  }
  const paired=!!aetherisBotBridgeStatus.paired;
  const needsReauth=!!(aetherisBotBridgeStatus.authenticated && aetherisBotBridgeStatus.twitchAuthorizationKnown && !aetherisBotBridgeStatus.twitchAuthorized);
  const pill=document.getElementById('aetherisbot-cloud-status');
  if(pill){
    const text=needsReauth ? 'reauthorize' : aetherisBotBridgeStatus.authenticated ? 'connected' : aetherisBotBridgeStatus.connecting ? 'connecting…' : paired ? 'paired / offline' : 'not paired';
    pill.textContent=text;
    pill.classList.toggle('on', !!aetherisBotBridgeStatus.authenticated && !needsReauth);
  }
  const summaryPill=document.getElementById('tw-status');
  if(summaryPill){
    summaryPill.textContent=needsReauth ? 'Twitch reauthorization required' : aetherisBotBridgeStatus.authenticated ? 'AetherisBot active' : aetherisBotBridgeStatus.connecting ? 'connecting…' : paired ? 'paired / offline' : 'not paired';
    summaryPill.classList.toggle('on', !!aetherisBotBridgeStatus.authenticated && !needsReauth);
  }
  const cloudHelp=document.getElementById('aetherisbot-cloud-help');
  if(cloudHelp){
    cloudHelp.textContent=needsReauth ? 'Twitch authorization expired — use Re-authorize Twitch in Advanced Twitch settings.' : aetherisBotBridgeStatus.authenticated ? 'AetherisBot is connected and ready.' : paired ? 'Paired — waiting for the cloud bridge.' : 'Connect Twitch to get started.';
  }

  // Keep the cloud controls in sync when pairing/revocation completes without
  // requiring the entire Settings page to be rendered again. In particular,
  // Reconnect/Disconnect are initially disabled on an unpaired profile; after
  // browser OAuth finishes they must become usable immediately.
  const pairBtn=document.getElementById('aetherisbot-pair');
  const reconnectBtn=document.getElementById('aetherisbot-reconnect');
  const disconnectBtn=document.getElementById('aetherisbot-forget');
  if(pairBtn) pairBtn.textContent=paired ? (needsReauth ? 'Re-authorize Twitch (required)' : 'Re-authorize Twitch') : 'Connect Twitch';
  if(reconnectBtn) reconnectBtn.disabled=!paired;
  if(disconnectBtn) disconnectBtn.disabled=!paired;

  // The Advanced re-authorization control only exists while Twitch actually
  // requires authorization. Once the cloud confirms authorization is valid,
  // rebuild Settings so the temporary Re-authorize button disappears and the
  // normal Disconnect control is the only account action shown. Likewise, if
  // authorization becomes invalid later, render the required re-auth control.
  const settingsView=document.getElementById('view-settings');
  const pairButtonPresent=!!document.getElementById('aetherisbot-pair');
  const disconnectButtonPresent=!!document.getElementById('aetherisbot-forget');

  // OAuth/pairing can complete while Settings is already open. The unpaired
  // layout also uses #aetherisbot-pair, so simply renaming that stale button
  // turns "Connect Twitch" into a bogus persistent "Re-authorize Twitch"
  // button. Rebuild whenever the rendered paired/unpaired layout no longer
  // matches the real bridge state, then independently handle the Advanced
  // re-authorization button that is only valid while Twitch auth is expired.
  const renderedPairingStateMismatch = paired ? !disconnectButtonPresent : disconnectButtonPresent;
  const advancedReauthVisible = paired && disconnectButtonPresent && pairButtonPresent;
  const renderedAuthStateMismatch = needsReauth ? !advancedReauthVisible : advancedReauthVisible;
  if(settingsView?.innerHTML && (renderedPairingStateMismatch || renderedAuthStateMismatch)){
    renderSettings();
    return;
  }

  updateLeds();
}

async function refreshAetherisBotBridgeStatus(){
  if(!window.aetherisBridge?.getAetherisBotStatus) return;
  try{
    const status=await window.aetherisBridge.getAetherisBotStatus();
    applyAetherisBotBridgeStatus(status||{});
  }catch(e){ console.warn('Could not read AetherisBot bridge status:',e); }
}


function setTwitchStatus(text, connected){
  // Local IRC status belongs to the advanced fallback controls. Keep the
  // normal Twitch summary reserved for AetherisBot Cloud.
  const el = document.getElementById('tw-local-status') || document.getElementById('tw-status');
  if(el){ el.textContent = text; el.classList.toggle('on', !!connected); }
}

function botConfigured(){
  return !!(STATE.settings.twitch.botUsername && STATE.settings.twitch.botOAuth);
}

function canSendTwitchReplies(){
  return isAetherisBotConnected() || botConfigured();
}

function connectTwitch(){
  disconnectTwitch();
  const channel = STATE.settings.twitch.channel.trim().toLowerCase().replace(/^#/,'');
  if(!channel) return;
  twitchChannel = channel;

  const hasBot = botConfigured();
  const nick = hasBot ? STATE.settings.twitch.botUsername.trim().toLowerCase() : 'justinfan'+Math.floor(10000+Math.random()*80000);
  const pass = hasBot ? normalizeOauthToken(STATE.settings.twitch.botOAuth.trim()) : 'SCHMOOPIIE';

  if(hasBot && (nick.length<4 || !/^[a-z0-9_]+$/.test(nick))){
    logTwitch('Aborting: bot username "'+nick+'" is not a valid Twitch username (must be 4+ characters, letters/numbers/underscores only, and must match the account the token was generated for).');
    toast('That bot username doesn\'t look valid — it must be the exact Twitch login name of the account you generated the token for.');
    setTwitchStatus('invalid username', false);
    return;
  }

  setTwitchStatus('connecting…', false);
  logTwitch('Opening wss://irc-ws.chat.twitch.tv:443 as '+nick+(hasBot?' (authenticated)':' (anonymous/read-only)'));
  if(hasBot){
    // Log only the length, never any part of the token itself — this log is
    // visible on-screen in Settings and could end up on stream/screen-share.
    const looksShort = pass.length < 20;
    logTwitch('Token check: '+pass.length+' characters total'+(looksShort ? ' — that looks short for a real Twitch token ("oauth:" + ~30 characters), so something may not have copied fully.' : ', looks like a normal length.'));
  }
  let socket;
  try{
    socket = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
  }catch(e){
    logTwitch('WebSocket constructor threw: '+e.message);
    toast('Could not open a connection to Twitch chat.');
    setTwitchStatus('offline', false);
    return;
  }
  twitchSocket = socket;
  twitchJoined = false;

  const connectTimeout = setTimeout(()=>{
    if(twitchSocket===socket && !twitchJoined){
      logTwitch('Still not connected after 10s — likely blocked by a firewall, VPN, or browser extension.');
      toast('Twitch is taking a long time to connect — a firewall, VPN, or browser extension may be blocking the WebSocket.');
    }
  }, 10000);

  socket.onopen = () => {
    logTwitch('Socket opened. Sending CAP/PASS/NICK/JOIN…');
    socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    socket.send('PASS ' + pass);
    socket.send('NICK ' + nick);
    socket.send('JOIN #' + channel);
  };
  socket.onmessage = (ev) => handleTwitchRaw(ev.data);
  socket.onclose = (ev) => {
    clearTimeout(connectTimeout);
    logTwitch('Socket closed (code '+ev.code+(ev.reason?', reason: '+ev.reason:', no reason given')+')');
    if(twitchSocket === socket){ twitchSocket = null; twitchJoined = false; updateLeds(); setTwitchStatus('offline', false); }
  };
  socket.onerror = () => {
    logTwitch('WebSocket error event fired (browser hides details on error events — check the close code above/below for the real reason).');
    toast('Twitch connection error — see the connection log in Settings for details.');
  };
}

function disconnectTwitch({forgetLegacy=false}={}){
  if(twitchSocket){ try{ twitchSocket.close(); }catch(e){} }
  twitchSocket = null;
  twitchJoined = false;

  // The legacy fallback is entirely local. Its Disconnect button must never
  // call or depend on the AetherisBot cloud revoke endpoint. When the user
  // explicitly disconnects legacy Twitch, also forget the saved legacy bot
  // credentials so it cannot silently reconnect later. Internal socket resets
  // (for example connectTwitch()) leave those credentials intact.
  if(forgetLegacy){
    STATE.settings.twitch.botUsername='';
    STATE.settings.twitch.botOAuth='';
    saveState();
    const user=document.getElementById('tw-bot-user');
    const oauth=document.getElementById('tw-bot-oauth');
    if(user) user.value='';
    if(oauth) oauth.value='';
    toast('Legacy Twitch disconnected');
  }

  updateLeds();
  setTwitchStatus('offline', false);
}

function parseIrcTags(tagsRaw){
  const tags = {};
  if(!tagsRaw) return tags;
  tagsRaw.split(';').forEach(pair=>{
    const idx = pair.indexOf('=');
    if(idx<0) return;
    tags[pair.slice(0,idx)] = pair.slice(idx+1).replace(/\\s/g,' ');
  });
  return tags;
}

function handleTwitchRaw(raw){
  raw.split('\r\n').filter(Boolean).forEach(line=>{
    if(line.startsWith('PING')){
      twitchSocket?.send('PONG :tmi.twitch.tv');
      return;
    }
    if(/ 001 /.test(line)){
      twitchJoined = true;
      updateLeds();
      setTwitchStatus('connected', true);
      logTwitch('Registered with Twitch (001 welcome received).');
      toast('Connected to #'+twitchChannel);
      if(STATE.settings.twitch.announceOnConnect && canSendTwitchReplies()){
        // small delay so the JOIN has definitely landed server-side before we try to speak
        setTimeout(()=> sayTwitch(fillTemplate(STATE.settings.twitch.connectAnnounceTemplate, templateContext())), 1500);
      }
      return;
    }
    if(/^:[^ ]+ CAP \* (ACK|NAK)/.test(line)){
      logTwitch('Capability negotiation: '+line.split(':').slice(1).join(':'));
      return;
    }
    if(/^:[^ ]+ 353 /.test(line) || /^:[^ ]+ 366 /.test(line)) return; // NAMES list, ignore
    if(line.includes('NOTICE')){
      logTwitch('NOTICE: '+line);
      if(/login authentication failed|improperly formatted auth/i.test(line)){
        toast('Twitch login failed — check the bot username and token in Settings.');
        setTwitchStatus('auth failed', false);
      }
      return;
    }
    const joinMatch = line.match(/^:([^!]+)![^ ]* JOIN /);
    if(joinMatch){ logTwitch(joinMatch[1]+' joined the channel.'); return; }

    const m = line.match(/^(?:@([^ ]*) )?:([^!]+)![^ ]* PRIVMSG #[^ ]+ :(.*)$/);
    if(m){
      const tags = parseIrcTags(m[1]);
      const username = m[2];
      const message = m[3];
      onTwitchMessage(username, tags, message);
    }
  });
}

function sayTwitch(text){
  const cleanText=String(text||'').trim().slice(0,500);
  if(!cleanText) return;

  if(!canSendTwitchReplies()){
    logTwitch('Tried to send a reply but neither AetherisBot Cloud nor a local bot account is available.');
    return;
  }

  if(!botMaySpeakInChat()){
    if(!twitchOfflineSuppressionLogged){
      twitchOfflineSuppressionLogged=true;
      if(twitchChannelLive===false){
        logTwitch('Bot messages muted while the channel is offline.');
      }else{
        logTwitch('Bot messages muted until Twitch live status is verified.');
      }
    }

    // If status is unknown, refresh silently. Repeated blocked messages do not
    // create repeated log lines.
    if(twitchChannelLive===null){
      refreshTwitchLiveStatus();
    }
    return;
  }

  // Speaking is allowed again, so a future offline transition may log once.
  twitchOfflineSuppressionLogged=false;

  if(isAetherisBotConnected() && window.aetherisBridge?.sendAetherisBotChat){
    window.aetherisBridge.sendAetherisBotChat(cleanText)
      .then((result)=>{
        if(result?.ok) logTwitch('Sent via AetherisBot Cloud: '+cleanText);
        else logTwitch('AetherisBot Cloud could not send reply: '+(result?.reason||'unknown error'));
      })
      .catch((err)=> logTwitch('AetherisBot Cloud reply failed: '+(err?.message||String(err))));
    return;
  }

  if(twitchSocket && twitchSocket.readyState===WebSocket.OPEN && twitchChannel){
    twitchSocket.send('PRIVMSG #'+twitchChannel+' :'+cleanText);
    logTwitch('Sent via local Twitch connection: '+cleanText);
  } else {
    logTwitch('Tried to send a reply but no chat transport is connected.');
  }
}

function commandOnCooldown(key, seconds=5){
  const last = cmdCooldowns.get(key)||0;
  if(Date.now()-last < seconds*1000) return true;
  cmdCooldowns.set(key, Date.now());
  return false;
}

function onTwitchMessage(username, tags, message){
  const displayName = tags['display-name'] || username;

  // --- song request command ---
  const savedCmd=String(STATE.settings.twitch.command||'!sr').trim() || '!sr';
  const cmd=normalizeCommandTrigger(savedCmd,'!sr');
  if(cmd){
    const lower = message.trim().toLowerCase();
    if(lower===cmd.toLowerCase() || lower.startsWith(cmd.toLowerCase()+' ')){
      const query = message.trim().slice(cmd.length).trim();
      if(query){
        const cdSec = STATE.settings.twitch.cooldown||0;
        const last = cooldowns.get(displayName)||0;
        if(cdSec>0 && Date.now()-last < cdSec*1000) return;
        cooldowns.set(displayName, Date.now());
        const requestItem={ id:'r'+Date.now()+Math.random().toString(36).slice(2,6), user:displayName, query, ts:Date.now() };
        STATE.queue.push(requestItem);
        saveState();
        bumpSessionStat('requests');
        renderQueue();
        if(STATE.settings.twitch.notify){
          sayTwitch(fillTemplate(STATE.settings.twitch.confirmTemplate, templateContext({user:displayName, query})));
        }
        if(getAutoRequestMode()!=='manual') processAutoRequestQueue();
      }
      return;
    }
  }

  // --- built-in + custom commands ---
  const firstWord = message.trim().split(/\s+/)[0]?.toLowerCase();
  if(!firstWord) return;

  const npCmd = normalizeCommandTrigger(STATE.settings.twitch.nowPlayingCmd,'!song').toLowerCase();
  if(STATE.settings.twitch.nowPlayingCmdEnabled && npCmd && firstWord===npCmd){
    if(commandOnCooldown(npCmd)) return;
    const np = STATE.nowPlaying;
    sayTwitch(np ? `Now playing: ${np.title} — ${np.artist}` : "Nothing is playing right now.");
    return;
  }
  const qCmd = normalizeCommandTrigger(STATE.settings.twitch.queueCmd,'!queue').toLowerCase();
  if(STATE.settings.twitch.queueCmdEnabled && qCmd && firstWord===qCmd){
    if(commandOnCooldown(qCmd)) return;
    const n = STATE.queue.length;
    sayTwitch(`${n} request${n===1?'':'s'} waiting in the queue.`);
    return;
  }
  const custom = (STATE.settings.twitch.customCommands||[]).find(c=>c.enabled!==false && c.trigger && c.trigger.toLowerCase()===firstWord);
  if(custom){
    if(commandOnCooldown(custom.trigger.toLowerCase())) return;
    custom.count = (custom.count||0) + 1;
    saveState();
    sayTwitch(fillTemplate(custom.response, templateContext({user:displayName, count:String(custom.count)})));
    return;
  }

  // --- playback control commands (skip/pause/resume/rewind) ---
  const pb = STATE.settings.twitch;
  const activeService = STATE.nowPlaying?.source==='ytmdesktop' ? 'youtube' : (STATE.nowPlaying?.source==='spotify' ? 'spotify' : null);
  const serviceMasterOn = activeService==='spotify' ? pb.spotifyCommandsEnabled!==false : activeService==='youtube' ? pb.youtubeCommandsEnabled!==false : false;
  const serviceBag = activeService ? (pb[activeService+'Playback']||{}) : {};
  const enabledFor=(key)=> serviceMasterOn && (serviceBag[key]===null||serviceBag[key]===undefined ? !!pb[key+'CmdEnabled'] : !!serviceBag[key]);
  const serviceCommandNames = activeService ? (pb[activeService+'CommandNames']||{}) : {};
  const commandTrigger=(key,fallback)=>String(serviceCommandNames[key]||fallback||'').trim().toLowerCase();
  const playbackCmds = [
    { key:'skip', enabled:enabledFor('skip'), trigger:commandTrigger('skip',pb.skipCmd||'!skip'), action:'next', okMsg:'⏭️ Skipped.' },
    { key:'pause', enabled:enabledFor('pause'), trigger:commandTrigger('pause',pb.pauseCmd||'!pause'), action:'pause', okMsg:'⏸️ Paused.' },
    { key:'resume', enabled:enabledFor('resume'), trigger:commandTrigger('resume',pb.resumeCmd||'!resume'), action:'play', okMsg:'▶️ Resumed.' },
    { key:'rewind', enabled:enabledFor('rewind'), trigger:commandTrigger('rewind',pb.rewindCmd||'!previous'), action:'previous', okMsg:'⏮️ Back to the previous track.' },
  ].map(c=>({...c,triggers:[c.trigger]}));
  const matchedPb = playbackCmds.find(c=>c.enabled && c.triggers.some(t=>t && t===firstWord));
  if(matchedPb){
    if(pb.playbackCmdsModOnly && !isModOrBroadcaster(tags, username)){
      return; // silently ignore — no need to call out non-mods in chat
    }
    if(commandOnCooldown(matchedPb.trigger.toLowerCase(), 3)) return;
    mediaCommand(matchedPb.action)
      .then(()=> sayTwitch(matchedPb.okMsg+' (@'+displayName+')'))
      .catch(e=>{ logYtmd?.('Playback command \"'+matchedPb.key+'\" failed: '+e.message); sayTwitch('Could not '+matchedPb.key+' — no connected player to control.'); });
    return;
  }
}

function isModOrBroadcaster(tags, username){
  if(!tags) return false;
  if(tags['mod']==='1') return true;
  if(tags['badges'] && /broadcaster\/1/.test(tags['badges'])) return true;
  if(username && twitchChannel && username.toLowerCase()===twitchChannel.toLowerCase()) return true;
  return false;
}

// Routes a playback action to whichever backend is actually in use — YTM
// Desktop if that's the current source (or the only one connected), Spotify
// otherwise. Both APIs are already authorized for this from earlier setup.
async function mediaCommand(action){
  const owner = getActivePlaybackSource();
  let useYtmd = owner==='ytmdesktop' && isYtmdConnected();
  let useSpotify = owner==='spotify' && !!STATE.settings.spotify.access_token;

  // Safe fallback if the preferred owner isn't currently available.
  if(!useYtmd && !useSpotify){
    const np = STATE.nowPlaying;
    useYtmd = (np?.source==='ytmdesktop' && isYtmdConnected()) || (!np?.source && isYtmdConnected());
    useSpotify = !useYtmd && !!STATE.settings.spotify.access_token;
  }

  if(useYtmd){
    await ytmdApi('/command', { method:'POST', body: JSON.stringify({ command: action }) });
  } else if(useSpotify){
    const map = { next:['/me/player/next','POST'], previous:['/me/player/previous','POST'], pause:['/me/player/pause','PUT'], play:['/me/player/play','PUT'] };
    const [path, method] = map[action];
    // Player control endpoints also support an explicit Spotify Connect
    // device. Supplying it avoids the misleading NO_ACTIVE_DEVICE failure
    // when Spotify knows about the desktop player but has temporarily lost
    // the global active-device flag.
    const device = await getSpotifyPlaybackDevice();
    await spotifyApi(path+'?'+new URLSearchParams({device_id:device.id}), { method });
  } else {
    throw new Error('no connected player');
  }
}

// Announces a track change in chat once, regardless of which backend
// (Spotify or YTM Desktop) reported it — both polling loops call this.
let lastAnnouncedTrackKey = null;
function maybeAnnounceNowPlaying(np){
  if(!np || !np.title) return;
  syncUpNextWithNowPlaying(np);
  const key = np.source+':'+np.title+':'+(np.artist||'');
  if(key === lastAnnouncedTrackKey) return;
  lastAnnouncedTrackKey = key;
  if(STATE.settings.twitch.announceNowPlaying && canSendTwitchReplies()){
    sayTwitch(fillTemplate(STATE.settings.twitch.announceTemplate, templateContext({ title:np.title, artist:np.artist||'' })));
  }
}

/* =========================================================================
   SPOTIFY (Authorization Code + PKCE, no client secret)
   ========================================================================= */
function b64url(bytes){
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function sha256(str){
  const data = new TextEncoder().encode(str);
  return await crypto.subtle.digest('SHA-256', data);
}
function randomString(len){
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, b=>('0'+b.toString(16)).slice(-2)).join('').slice(0,len);
}

// Electron's loopback URI (main.js) — file:// redirects aren't accepted by
// Spotify. Fall back to the old guess only if the bridge isn't present.
async function spotifyRedirectUri(){
  if(window.aetherisBridge?.getSpotifyRedirectUri){
    return await window.aetherisBridge.getSpotifyRedirectUri();
  }
  return location.origin + location.pathname;
}

async function spotifyAuthorize(){
  const verifier = randomString(64);
  sessionStorage.setItem('sp_verifier', verifier);
  const challenge = b64url(await sha256(verifier));
  const redirectUri = await spotifyRedirectUri();
  const scope = 'user-read-currently-playing user-read-playback-state user-modify-playback-state';
  const authUrl = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    client_id: STATE.settings.spotify.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope
  });
  if(window.aetherisBridge?.startSpotifyAuth){
    // Opens the system browser for the actual Spotify login (this window is
    // frameless/file-loaded and can't show it), then waits for the code to
    // come back through the local loopback server in the main process.
    toast('Opening Spotify sign-in in your browser…');
    try{
      const code = await window.aetherisBridge.startSpotifyAuth(authUrl);
      await handleSpotifyCallback(code);
    }catch(e){
      toast('Spotify sign-in failed: '+e.message);
    }
  } else {
    // Fallback for opening this file directly in a plain browser tab.
    location.href = authUrl;
  }
}

async function handleSpotifyCallback(code){
  const verifier = sessionStorage.getItem('sp_verifier');
  const redirectUri = await spotifyRedirectUri();
  try{
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body: new URLSearchParams({
        grant_type:'authorization_code',
        code, redirect_uri: redirectUri,
        client_id: STATE.settings.spotify.clientId,
        code_verifier: verifier
      })
    });
    const data = await res.json();
    if(data.access_token){
      STATE.settings.spotify.access_token = data.access_token;
      STATE.settings.spotify.refresh_token = data.refresh_token;
      STATE.settings.spotify.expires_at = Date.now() + (data.expires_in*1000);
      STATE.settings.spotify.connected = true;
      saveState();
      toast('Spotify connected');
      startSpotifyPolling();
    } else {
      toast('Spotify auth failed: '+(data.error_description||data.error||'unknown error'));
    }
  }catch(e){
    toast('Spotify auth error');
  }
  try{ history.replaceState({}, '', location.pathname); }catch(e){}
  renderSettings();
  updateLeds();
}

async function spotifyRefreshIfNeeded(){
  const sp = STATE.settings.spotify;
  if(!sp.refresh_token) return;
  if(Date.now() < sp.expires_at - 30000) return;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams({ grant_type:'refresh_token', refresh_token: sp.refresh_token, client_id: sp.clientId })
  });
  const data = await res.json();
  if(data.access_token){
    sp.access_token = data.access_token;
    if(data.refresh_token) sp.refresh_token = data.refresh_token;
    sp.expires_at = Date.now() + (data.expires_in*1000);
    saveState();
  }
}

async function spotifyApi(path, opts={}){
  await spotifyRefreshIfNeeded();
  const url = 'https://api.spotify.com/v1'+path;
  const res = await fetch(url, {
    ...opts,
    headers:{ 'Authorization':'Bearer '+STATE.settings.spotify.access_token, ...(opts.headers||{}) }
  });

  // Spotify Player commands such as Add to Queue intentionally return 204
  // with no response body. Never try to JSON-decode those responses.
  if(res.status===204) return null;

  const text = await res.text();
  if(!res.ok){
    throw new Error('Spotify API: '+res.status+' '+text.slice(0,240));
  }

  // Spotify read endpoints return JSON, but successful Player command
  // endpoints can return either 204/no body or HTTP 200 with a short
  // non-JSON command receipt. Treat successful non-GET responses as command
  // success instead of reporting a false playback failure. GET responses
  // still require JSON so search/device/currently-playing parsing stays strict.
  if(!text.trim()) return null;
  try{
    return JSON.parse(text);
  }catch(e){
    const method = String(opts.method || 'GET').toUpperCase();
    if(method !== 'GET' || opts.allowNonJsonSuccess){
      return text;
    }
    const contentType = res.headers.get('content-type') || '';
    throw new Error('Spotify API returned non-JSON data from '+path+' (HTTP '+res.status+', '+contentType+'): '+text.slice(0,240));
  }
}

async function spotifySearch(query){
  if(!STATE.settings.spotify.access_token) throw new Error('Connect Spotify first in Settings');
  const data = await spotifyApi('/search?'+new URLSearchParams({q:query, type:'track', limit:6}));
  if(!data || typeof data !== 'object' || !data.tracks || !Array.isArray(data.tracks.items)){
    throw new Error('Spotify search returned an unexpected response. Please try the request again.');
  }
  return data.tracks.items.map(t=>({
    title:t.name, artist:(t.artists||[]).map(a=>a.name).join(', '), art:t.album?.images?.[1]?.url||t.album?.images?.[0]?.url,
    uri:t.uri, durationMs:t.duration_ms
  }));
}
async function getSpotifyPlaybackDevice(){
  const devices = await spotifyApi('/me/player/devices');
  const available = (devices?.devices||[]).filter(d=>d?.id && !d.is_restricted);
  if(!available.length){
    throw new Error('Spotify has no available playback device. Open Spotify on a device and try again.');
  }
  return available.find(d=>d.is_active) ||
         available.find(d=>/desktop|computer/i.test(d.name||'')) ||
         available[0];
}

async function spotifyQueue(uri){
  // Spotify returns 404 NO_ACTIVE_DEVICE when the account has no active
  // playback device. YTM Desktop being open can make Spotify lose its
  // active device, so explicitly discover an available Spotify Connect
  // device and target it instead of relying on the global active device.
  const device = await getSpotifyPlaybackDevice();
  // Spotify documents this endpoint as 204, but the Player API can also
  // return HTTP 200 with a short plain-text command receipt. Treat either
  // successful form as a completed queue operation.
  await spotifyApi('/me/player/queue?'+new URLSearchParams({uri, device_id:device.id}), {
    method:'POST',
    allowNonJsonSuccess:true
  });
}

function startSpotifyPolling(){
  if(spotifyPollHandle) return;
  pollSpotifyNow();
  // Spotify does not provide a realtime player-state socket, so this poll is
  // what detects track changes for the UI and Twitch now-playing announcement.
  // 1.5s keeps announcements noticeably snappier without polling every second.
  spotifyPollHandle = setInterval(pollSpotifyNow, 1500);
}
function stopSpotifyPolling(){ clearInterval(spotifyPollHandle); spotifyPollHandle=null; }
async function pollSpotifyNow(){
  try{
    const data = await spotifyApi('/me/player/currently-playing');
    if(data && data.item){
      // Queue consumption is independent of which service currently owns the
      // shared Now Playing card. This prevents an inactive player's source
      // arbitration from leaving a real queued song stuck in Up Next.
      syncUpNextWithNowPlaying({
        source:'spotify', title:data.item.name,
        artist:data.item.artists.map(a=>a.name).join(', '),
        uri:data.item.uri
      });
      if(!shouldAcceptPlaybackUpdate('spotify')) return;
      STATE.nowPlaying = {
        source:'spotify', title:data.item.name, artist:data.item.artists.map(a=>a.name).join(', '),
        art:data.item.album.images[0]?.url, progressMs:data.progress_ms, durationMs:data.item.duration_ms,
        isPlaying:data.is_playing, uri:data.item.uri, updatedAt: Date.now()
      };
      saveState();
      maybeAnnounceNowPlaying(STATE.nowPlaying);
      const slot = document.getElementById('np-slot'); if(slot) slot.innerHTML = nowPlayingHtml(STATE.nowPlaying);
    }
  }catch(e){ /* silent - likely no active playback */ }
}

/* =========================================================================
   YOUTUBE
   ========================================================================= */
// Direct YouTube links skip search (avoids covers/lyric-video mismatches,
// and videos.list costs far less quota than search.list).
function extractYoutubeVideoId(text){
  if(!text) return null;
  const m = text.match(/(?:youtube\.com\/(?:watch\?[^\s#]*\bv=|shorts\/|live\/)|music\.youtube\.com\/watch\?[^\s#]*\bv=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
async function youtubeLookupById(videoId){
  const key = STATE.settings.youtube.apiKey;
  if(!key) throw new Error('Add a YouTube API key in Settings');
  const res = await fetch('https://www.googleapis.com/youtube/v3/videos?'+new URLSearchParams({
    part:'snippet', id: videoId, key
  }));
  const data = await res.json();
  if(data.error) throw new Error(data.error.message);
  const it = (data.items||[])[0];
  if(!it) throw new Error('That YouTube link doesn\'t point to a video that exists (it may be private, deleted, or region-locked).');
  return {
    title: it.snippet.title, artist: it.snippet.channelTitle,
    art: it.snippet.thumbnails?.default?.url, videoId
  };
}
async function youtubeSearch(query){
  const key = STATE.settings.youtube.apiKey;
  if(!key) throw new Error('Add a YouTube API key in Settings');
  const res = await fetch('https://www.googleapis.com/youtube/v3/search?'+new URLSearchParams({
    part:'snippet', q:query, type:'video', maxResults:6, key
  }));
  const data = await res.json();
  if(data.error) throw new Error(data.error.message);
  return (data.items||[]).map(it=>({
    title: it.snippet.title, artist: it.snippet.channelTitle, art: it.snippet.thumbnails?.default?.url,
    videoId: it.id.videoId
  }));
}

/* =========================================================================
   YOUTUBE MUSIC DESKTOP — Companion Server integration
   Docs: https://github.com/ytmdesktop/ytmdesktop/wiki/v2-‐-Companion-Server-API-v1
   ========================================================================= */
function ytmdBaseUrl(){
  const d = STATE.settings.youtubeDesktop;
  return 'http://'+ytmdHostAddr(d.host)+':'+(d.port||9863)+'/api/v1';
}
function isYtmdConnected(){
  return !!(STATE.settings.youtubeDesktop.enabled && STATE.settings.youtubeDesktop.token);
}

async function connectYtmd(){
  const d = STATE.settings.youtubeDesktop;
  const base = ytmdBaseUrl();
  try{
    logYtmd('Requesting a pairing code from '+base+'…');
    setYtmdStatus('requesting code…', false);
    const codeRes = await fetch(base+'/auth/requestcode', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ appId:d.appId||'aetheris', appName:'Aetheris', appVersion:(window.aetherisBridge && window.aetherisBridge.version) || '1.0.0' })
    });
    if(!codeRes.ok){
      const txt = await codeRes.text().catch(()=> '');
      throw new Error('requestcode failed ('+codeRes.status+') '+txt.slice(0,120));
    }
    const { code } = await codeRes.json();
    logYtmd('Code received — check YouTube Music Desktop now and approve the request (you have ~30 seconds).');
    setYtmdStatus('waiting for approval…', false);
    toast('Check YouTube Music Desktop and approve the connection request.');

    const tokenRes = await fetch(base+'/auth/request', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ appId:d.appId||'aetheris', code })
    });
    if(!tokenRes.ok){
      const txt = await tokenRes.text().catch(()=> '');
      throw new Error('auth/request failed ('+tokenRes.status+') '+txt.slice(0,120));
    }
    const { token } = await tokenRes.json();
    d.token = token;
    d.enabled = true;
    persistLocalState();
    try{ await persistSecretsNow(); }
    catch(saveErr){
      logYtmd('Error: authorization succeeded, but the YTMD credential could not be saved securely.');
      throw saveErr;
    }
    logYtmd('Connected and authorized.');
    toast('YouTube Music Desktop connected!');
    setYtmdStatus('connected', true);
    updateLeds();
    startYtmdRealtime();
  }catch(e){
    logYtmd('Error: '+e.message);
    logYtmd('Checklist: Companion Server enabled in YTMD → Settings → Integrations? Host/port correct (default 127.0.0.1:9863)? If this page is loaded over https, your browser may be blocking the request to the local http server — try opening this control panel via plain http instead.');
    toast('Could not connect to YouTube Music Desktop — see the log in Settings for details.');
    setYtmdStatus('offline', false);
    updateLeds();
  }
}

function disconnectYtmd(){
  STATE.settings.youtubeDesktop.enabled = false;
  STATE.settings.youtubeDesktop.token = '';
  saveState();
  stopYtmdRealtime();
  stopYtmdPolling();
  stopYtmdAvailabilityWatch();
  ytmdOfflineMessageShown = false;
  ytmdSelfChange = null;
  ytmdShufflePendingTarget = null;
  ytmdPendingQueue = [];
  ytmdNeedsReturnToPlaylist = false;
  clearEarlySwapTimer();
  ytmdLastVideoId = null;
  setYtmdStatus('offline', false);
  updateLeds();
}

function setYtmdStatus(text, connected){
  const el = document.getElementById('ytmd-status');
  if(el){ el.textContent = text; el.classList.toggle('on', !!connected); }
}

async function ytmdApi(path, opts={}){
  const res = await fetch(ytmdBaseUrl()+path, {
    ...opts,
    headers:{ 'Content-Type':'application/json', 'Authorization': STATE.settings.youtubeDesktop.token, ...(opts.headers||{}) }
  });
  if(!res.ok){
    const txt = await res.text().catch(()=> '');
    throw new Error('YTMD API '+res.status+': '+txt.slice(0,140));
  }
  if(res.status===204) return null;
  return res.json();
}

// Plain, header-free GET so it never triggers a CORS preflight — this tells
// us whether the server is reachable at all, separate from whether our
// authenticated requests specifically are being blocked.
async function ytmdTestConnection(){
  const d = STATE.settings.youtubeDesktop;
  const base = 'http://'+ytmdHostAddr(d.host)+':'+(d.port||9863);
  logYtmd('Testing basic reachability at '+base+'/metadata (plain GET, no headers, no auth — this can\'t be a CORS or auth problem)…');
  try{
    const res = await fetch(base+'/metadata');
    const data = await res.json().catch(()=>null);
    logYtmd('Reachable — server responded'+(data?': '+JSON.stringify(data).slice(0,150):'.')+' If /state or /command still fail after this succeeds, the problem is specifically CORS/auth on those endpoints, not the app being closed or the wrong port.');
    toast('YTM Desktop is reachable at that address.');
  }catch(e){
    logYtmd('Not reachable at all ('+e.message+'). Since this request had no custom headers, this rules out CORS — it means either YouTube Music Desktop isn\'t running, Companion Server is toggled off, the host/port is wrong, or a firewall/VPN is blocking the connection.');
    toast('Could not reach that address at all — see the log for what to check.');
  }
}

async function isYtmdServerReachable(){
  const d = STATE.settings.youtubeDesktop;
  const host = ytmdHostAddr(d.host);
  const port = d.port || 9863;
  try{
    if(window.aetherisBridge?.checkYtmdReachability){
      const result = await window.aetherisBridge.checkYtmdReachability({ host, port });
      return !!result?.reachable;
    }
    // Browser fallback. Electron normally uses the main-process probe above.
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(), 1500);
    try{
      await fetch('http://'+host+':'+port+'/metadata', { signal:controller.signal });
      return true;
    }finally{
      clearTimeout(timer);
    }
  }catch(_){
    return false;
  }
}

function stopYtmdAvailabilityWatch(){
  if(ytmdAvailabilityWatchHandle){
    clearInterval(ytmdAvailabilityWatchHandle);
    ytmdAvailabilityWatchHandle = null;
  }
}

function enterYtmdOfflineWait(){
  stopYtmdPolling();
  stopYtmdRealtime();
  setYtmdStatus('waiting for YTMD…', false);
  updateLeds();

  if(!ytmdOfflineMessageShown){
    logYtmd("YouTube Music Desktop isn't running. Please open YouTube Music Desktop.");
    ytmdOfflineMessageShown = true;
  }

  if(ytmdAvailabilityWatchHandle || !isYtmdConnected()) return;
  ytmdAvailabilityWatchHandle = setInterval(async()=>{
    if(ytmdAvailabilityCheckInFlight || !isYtmdConnected()) return;
    ytmdAvailabilityCheckInFlight = true;
    try{
      if(await isYtmdServerReachable()){
        stopYtmdAvailabilityWatch();
        ytmdOfflineMessageShown = false;
        logYtmd('YouTube Music Desktop detected — reconnecting automatically.');
        startYtmdRealtime();
      }
    }finally{
      ytmdAvailabilityCheckInFlight = false;
    }
  }, 5000);
}

async function ytmdChangeVideo(videoId, playlistId=null){
  await ytmdApi('/command', { method:'POST', body: JSON.stringify({ command:'changeVideo', data:{ videoId, playlistId } }) });
}

function extractPlaylistId(value){
  if(!value) return null;
  const raw = String(value).trim();
  const m = raw.match(/[?&]list=([^&#]+)/i);
  if(m){
    try{ return decodeURIComponent(m[1]); }catch(e){ return m[1]; }
  }
  // Also accept a bare playlist ID in the setting field.
  return /^[A-Za-z0-9_-]{10,}$/.test(raw) ? raw : null;
}

function isGeneratedRadioPlaylistId(playlistId){
  // YouTube Music radio/mix sessions use RD... IDs (including RDAMVM...).
  // These are ephemeral autoplay contexts, not a stable playlist to return to.
  return typeof playlistId==='string' && /^RD/i.test(playlistId.trim());
}

function isStableReturnPlaylistId(playlistId){
  return !!playlistId && !isGeneratedRadioPlaylistId(playlistId);
}

function clearEarlySwapTimer(){
  if(ytmdEarlySwapTimer){ clearTimeout(ytmdEarlySwapTimer); ytmdEarlySwapTimer = null; }
  if(ytmdTimingWatchHandle){ clearInterval(ytmdTimingWatchHandle); ytmdTimingWatchHandle = null; }
}

function ytmdHasRealtime(){
  return !!(ytmdUsingBridge || ytmdSocket?.connected);
}

// Actively follow the live playhead so seeking/scrubbing cannot leave an old
// "song ends at X" timeout armed. With realtime connected, progress updates
// from YTMD continually re-anchor STATE.nowPlaying; this lightweight watchdog
// checks that moving anchor every 100ms. If realtime is unavailable, retain a
// conservative timeout fallback so 6-second REST polling still works.
function scheduleEarlySwap(){
  clearEarlySwapTimer();
  // Never arm another end-of-song action while a changeVideo/rejoin command is
  // still landing. Realtime can emit one or more updates for the old track in
  // its final 500ms; without this guard those updates can immediately trigger
  // the playlist rejoin and skip the requested song we just started loading.
  if(ytmdSelfChange) return;
  if(ytmdPendingQueue.length===0 && !ytmdNeedsReturnToPlaylist) return;

  const checkNow = ()=>{
    if(ytmdSelfChange) return false;
    const np = STATE.nowPlaying;
    if(!np || np.source!=='ytmdesktop' || !np.durationMs || !np.updatedAt || !np.isPlaying) return false;
    const elapsedSinceUpdate = Date.now() - np.updatedAt;
    const estimatedProgress = Math.max(0, np.progressMs + elapsedSinceUpdate);
    const remaining = np.durationMs - estimatedProgress;

    // With realtime, don't make an end-of-song decision from stale data. A
    // seek causes a new state-update which refreshes progressMs/updatedAt.
    if(ytmdHasRealtime() && elapsedSinceUpdate > 2000) return false;

    if(remaining <= 500 && remaining >= -250){
      clearEarlySwapTimer();
      performEarlySwap();
      return true;
    }
    return false;
  };

  if(checkNow()) return;

  if(ytmdHasRealtime()){
    ytmdTimingWatchHandle = setInterval(checkNow, 100);
    return;
  }

  // REST-only fallback: preserve the old prediction path. It is less seek-
  // aware, but avoids hammering the Companion Server's rate-limited /state.
  const np = STATE.nowPlaying;
  if(!np || !np.durationMs || !np.updatedAt) return;
  const elapsedSinceUpdate = np.isPlaying ? (Date.now() - np.updatedAt) : 0;
  const estimatedProgress = np.progressMs + elapsedSinceUpdate;
  const fireIn = (np.durationMs - estimatedProgress) - 500;
  if(fireIn > 20*60*1000) return;
  if(fireIn <= 0){ performEarlySwap(); return; }
  const forVideoId = ytmdLastVideoId;
  ytmdEarlySwapTimer = setTimeout(()=>{
    ytmdEarlySwapTimer = null;
    if(ytmdLastVideoId !== forVideoId) return;
    performEarlySwap();
  }, fireIn);
}

function performEarlySwap(){
  if(ytmdPendingQueue.length>0){
    const next = ytmdPendingQueue.shift();
    ytmdSelfChange = next.videoId;
    ytmdChangeVideo(next.videoId).catch(()=>{ ytmdSelfChange=null; });
    return;
  }
  if(ytmdNeedsReturnToPlaylist) ytmdReturnToPlaylist();
}

async function ytmdReturnToPlaylist(){
  if(!ytmdNeedsReturnToPlaylist) return;
  const manualId = extractPlaylistId(STATE.settings.youtubeDesktop.returnPlaylistUrl);
  const originalId = isStableReturnPlaylistId(ytmdOriginalPlaylistId) ? ytmdOriginalPlaylistId : null;
  const configuredId = isStableReturnPlaylistId(manualId) ? manualId : null;
  // Prefer the real playlist we positively captured before the request detour.
  // If YTMD only gave us an RD... radio/mix context (or nothing at all), fall
  // back to the user's configured playlist instead of rejoining that radio.
  const targetId = originalId || configuredId;
  if(!targetId){
    if(isGeneratedRadioPlaylistId(ytmdOriginalPlaylistId)){
      logYtmd('The detected return context was a YouTube Music radio/mix, and no valid configured fallback playlist is available — staying on whatever plays next.');
    }else{
      logYtmd('All requests have played, but there\'s no stable playlist on record or configured fallback to rejoin — staying on whatever plays next.');
    }
    ytmdNeedsReturnToPlaylist = false;
    return;
  }

  ytmdNeedsReturnToPlaylist = false;
  ytmdSelfChange = '__playlist_rejoin__';
  ytmdShufflePendingTarget = STATE.settings.youtubeDesktop.returnPlaylistShuffle ? targetId : null;
  const returnSource = originalId ? 'the original playlist' : 'your configured fallback playlist';
  if(!originalId && isGeneratedRadioPlaylistId(ytmdOriginalPlaylistId)){
    logYtmd('Ignoring detected radio/mix '+ytmdOriginalPlaylistId+' and using your configured fallback playlist instead.');
  }
  logYtmd('Final request has 500ms left — rejoining '+returnSource+' before autoplay can advance.');
  try{
    await ytmdChangeVideo(null, targetId);
  }catch(e){
    logYtmd('Could not rejoin the playlist: '+e.message);
    ytmdSelfChange = null;
    ytmdShufflePendingTarget = null;
  }
}

// No queue-add endpoint exists, so we fake one: check YTMD's LIVE state at
// approval time and hold the track until the current song actually ends.
async function ytmdEnqueueOrPlay(track){
  if(!isYtmdConnected()){
    toast('Connect YouTube Music Desktop in Settings to play YouTube requests.');
    return;
  }
  try{
    // Avoid an extra /state call when the regular poll (every 6s) already
    // gives us a trustworthy recent answer — stacking an extra request on
    // top of that loop is what was tripping the rate limit.
    const cacheFresh = STATE.nowPlaying?.source==='ytmdesktop' && STATE.nowPlaying?.updatedAt && (Date.now() - STATE.nowPlaying.updatedAt < 8000);
    let active, playlistId = ytmdOriginalPlaylistId;
    if(cacheFresh){
      active = !!STATE.nowPlaying.isPlaying;
    } else {
      const state = await ytmdApi('/state');
      active = !!(state?.player && state.player.trackState===1);
      if(state?.playlistId) playlistId = state.playlistId;
    }
    if(active){
      if(!ytmdOriginalPlaylistId && isStableReturnPlaylistId(playlistId)){
        ytmdOriginalPlaylistId = playlistId;
      }
      ytmdNeedsReturnToPlaylist = true;
      ytmdPendingQueue.push(track);
      scheduleEarlySwap();
      logYtmd('Holding "'+track.title+'" — will play once the current song ends (Companion Server has no add-to-queue endpoint).');
      toast('On deck — "'+track.title+'" plays once the current song ends.');
    } else {
      if(!ytmdOriginalPlaylistId && isStableReturnPlaylistId(playlistId)){
        ytmdOriginalPlaylistId = playlistId;
      }
      ytmdNeedsReturnToPlaylist = true;
      ytmdSelfChange = track.videoId;
      await ytmdChangeVideo(track.videoId);
      toast('Playing now on YouTube Music Desktop.');
    }
  }catch(e){
    logYtmd('Could not queue on YTM Desktop: '+e.message);
    toast('Could not reach YouTube Music Desktop.');
  }
}

function applyYtmdState(state){
  const v = state && state.video;
  const p = state && state.player;
  if(!v) return;

  // Once realtime confirms the target playlist is loaded, let the player settle
  // before doing anything else. Rapid back-to-back changeVideo + shuffle calls can
  // make YTMD briefly lose its player UI, so the rejoin flow is intentionally paced:
  //   1) join playlist
  //   2) wait for queue/player to settle
  //   3) jump to a random non-first queue index
  //   4) confirm that jump
  //   5) wait a little longer, then toggle YTMD's native shuffle
  if(ytmdShufflePendingTarget && state.playlistId===ytmdShufflePendingTarget){
    const shuffledTarget = ytmdShufflePendingTarget;
    ytmdShufflePendingTarget = null;
    (async()=>{
      try{
        // Give YTMD time to fully build/render the playlist player before sending
        // another playback command. Realtime already confirms the playlist loaded, so this only needs a short settle window.
        await new Promise(r=>setTimeout(r, 550));

        let freshState = await ytmdApi('/state');
        if(freshState?.playlistId!==shuffledTarget){
          logYtmd('Shuffle rejoin: playlist was not fully settled yet; skipping the extra jump/shuffle commands this time.');
          return;
        }

        let items = freshState?.player?.queue?.items || [];
        // If the queue is still being generated, allow it a few seconds to settle.
        for(let attempt=0; attempt<6 && (items.length<=1 || freshState?.player?.queue?.isGenerating===true); attempt++){
          await new Promise(r=>setTimeout(r, 500));
          freshState = await ytmdApi('/state');
          if(freshState?.playlistId!==shuffledTarget) return;
          items = freshState?.player?.queue?.items || [];
        }

        if(items.length<=1){
          logYtmd('Shuffle rejoin: playlist queue never settled enough for a safe random jump; leaving playback alone.');
          return;
        }

        const currentVideoId = freshState?.video?.id;
        const candidates = items
          .map((item,index)=>({item,index}))
          .filter(({item,index})=>item?.videoId && index!==0 && item.videoId!==currentVideoId);
        if(!candidates.length){
          logYtmd('Shuffle rejoin: no safe non-first playlist track was available; leaving playback alone.');
          return;
        }

        const chosen = candidates[Math.floor(Math.random()*candidates.length)];
        // Use playQueueIndex here instead of a second changeVideo call. changeVideo
        // immediately after joining a playlist is what could make YTMD's player vanish.
        await ytmdApi('/command', { method:'POST', body: JSON.stringify({ command:'playQueueIndex', data: chosen.index }) });
        logYtmd('Shuffle rejoin: random jump command sent for playlist position '+(chosen.index+1)+' of '+items.length+'.');

        // The queue index command can work before /state reports the newly selected
        // video. Requiring that confirmation caused Aetheris to skip the native shuffle
        // toggle even when the random jump visibly succeeded. Give the player a generous
        // moment to settle, then toggle shuffle as a separate action.
        await new Promise(r=>setTimeout(r, 1400));

        // Only abandon the toggle if YTMD has genuinely left the playlist entirely.
        // Otherwise the user's "Shuffle when rejoining" option should always toggle
        // the real YouTube Music Desktop shuffle control after the random jump.
        try{
          const settledState = await ytmdApi('/state');
          if(settledState?.playlistId && settledState.playlistId!==shuffledTarget){
            logYtmd('Shuffle rejoin: playback left the target playlist before native shuffle could be toggled.');
            return;
          }
        }catch(_){
          // Realtime is authoritative here; a transient REST state failure should not
          // prevent the requested native shuffle toggle.
        }

        await ytmdApi('/command', { method:'POST', body: JSON.stringify({ command:'shuffle' }) });
        logYtmd('Shuffle rejoin: native YouTube Music Desktop shuffle toggle command sent.');
      }catch(e){
        logYtmd('Could not finish the paced shuffle rejoin: '+e.message);
      }
    })();
  }

  const videoChanged = ytmdLastVideoId && ytmdLastVideoId !== v.id;

  // This ID change is one WE just caused (queueing a request, or rejoining
  // the playlist afterward) — recognize it up front, before anything else.
  const isSelfChange = videoChanged && ytmdSelfChange && (ytmdSelfChange===v.id || ytmdSelfChange==='__playlist_rejoin__');

  // changeVideo can briefly report YouTube Music's own autoplay/transition
  // track before the requested video actually lands. While we're waiting for
  // a specific queued video, ignore those intermediate IDs completely. The
  // old fallback saw that transition after we'd already shifted the request
  // out of ytmdPendingQueue and immediately returned to the playlist, which
  // made the queued song appear to be skipped.
  const awaitingQueuedTarget = videoChanged && ytmdSelfChange && ytmdSelfChange!=='__playlist_rejoin__' && ytmdSelfChange!==v.id;

  // A transitional video: YTMD's own autoplay advanced to something that
  // isn't our self-change and we're about to swap it for a held request —
  // don't announce it, it's on screen for a fraction of a second.
  const isTransitional = awaitingQueuedTarget || (videoChanged && !isSelfChange && !ytmdSelfChange && ytmdPendingQueue.length>0);

  // Keep track of whatever playlist is actually playing right now, so we
  // know what to return to later — but only while we're not already
  // mid-detour for a queued request (otherwise this would overwrite the
  // real original with context from the request itself, or with nothing).
  if(!ytmdNeedsReturnToPlaylist && isStableReturnPlaylistId(state.playlistId)){
    ytmdOriginalPlaylistId = state.playlistId;
  }

  if(!isTransitional){
    // Use Companion Server's confirmed video ID to consume the matching Up
    // Next item even if another service currently owns the shared player UI.
    syncUpNextWithNowPlaying({
      source:'ytmdesktop', title:v.title, artist:v.author, videoId:v.id
    });
    if(shouldAcceptPlaybackUpdate('ytmdesktop')){
      STATE.nowPlaying = {
        source:'ytmdesktop', title:v.title, artist:v.author, videoId:v.id,
        art: v.thumbnails?.[v.thumbnails.length-1]?.url || v.thumbnails?.[0]?.url,
        progressMs: (p?.videoProgress||0)*1000, durationMs:(v.durationSeconds||0)*1000,
        isPlaying: p?.trackState===1, updatedAt: Date.now()
      };
      saveState();
      maybeAnnounceNowPlaying(STATE.nowPlaying);
      const slot = document.getElementById('np-slot'); if(slot) slot.innerHTML = nowPlayingHtml(STATE.nowPlaying);
      scheduleEarlySwap();
    }
  }

  if(isSelfChange){
    const completedChange = ytmdSelfChange;
    ytmdSelfChange = null;
    ytmdLastVideoId = v.id;
    // STATE.nowPlaying above now belongs to the song/playlist we deliberately
    // switched to. Arm the next 500ms transition only after that target has
    // actually been confirmed by realtime.
    if(completedChange!=='__playlist_rejoin__') scheduleEarlySwap();
    return;
  }

  if(videoChanged && !ytmdSelfChange){
    if(ytmdPendingQueue.length>0){
      // Normally scheduleEarlySwap() already fires this ~500ms before this
      // point — this branch is the fallback for if the prediction was off
      // (e.g. a duration reading that didn't match reality) and the video
      // genuinely changed on its own first.
      clearEarlySwapTimer();
      performEarlySwap();
    } else if(ytmdNeedsReturnToPlaylist){
      // Fallback only: normally the 500ms early timer already returned us
      // before YTMD autoplay had a chance to show the next radio/playlist song.
      // Never run this while a changeVideo request is still in flight, or an
      // intermediate YTMD transition can cancel the queued song.
      clearEarlySwapTimer();
      ytmdReturnToPlaylist();
    }
  }
  ytmdLastVideoId = v.id;
}

// Inside Electron, the realtime socket is opened by main.js in a plain Node
// process so the renderer does not have to own the local Socket.IO connection.
// Before treating a socket failure as a real connection error, Aetheris checks
// whether the Companion Server is reachable at all. If YTMD is closed, it logs
// one clean message and quietly waits for the server to return.
if(window.aetherisBridge){
  let ytmdBridgeFails = 0;
  let ytmdBridgeErrorCheckInFlight = false;
  window.aetherisBridge.onConnect(()=>{
    stopYtmdAvailabilityWatch();
    ytmdOfflineMessageShown = false;
    logYtmd('Realtime connected (via desktop app background process) — no more polling needed.');
    ytmdBridgeFails = 0;
    stopYtmdPolling();
    setYtmdStatus('connected', true);
    updateLeds();
    ytmdApi('/state').then(applyYtmdState).catch(()=>{});
  });
  window.aetherisBridge.onState((state)=> applyYtmdState(state));
  window.aetherisBridge.onConnectError(async(detail)=>{
    if(ytmdBridgeErrorCheckInFlight) return;
    ytmdBridgeErrorCheckInFlight = true;
    try{
      if(!(await isYtmdServerReachable())){
        enterYtmdOfflineWait();
        ytmdBridgeFails = 0;
        return;
      }

      // The server itself is alive, so this is a genuine realtime/auth issue.
      logYtmd('Realtime connect error: '+(detail||'(no further detail given)'));
      startYtmdPolling();
      ytmdBridgeFails++;
      if(ytmdBridgeFails===3){
        logYtmd('Giving up on the realtime channel after repeated failures — staying on 6-second polling instead. Since this is the desktop app (not a browser tab), this points to the Companion Server connection or saved token rather than YTMD simply being closed.');
        window.aetherisBridge.stopRealtime();
        ytmdUsingBridge = false;
      }
    }finally{
      ytmdBridgeErrorCheckInFlight = false;
    }
  });
  window.aetherisBridge.onDisconnect(async(reason)=>{
    // A manual stop/offline transition also emits disconnect; don't turn that
    // into another visible error. Only report it if the server is still alive.
    if(!isYtmdConnected()) return;
    if(!(await isYtmdServerReachable())){
      enterYtmdOfflineWait();
      return;
    }
    logYtmd('Realtime disconnected ('+reason+'). Will retry automatically.');
  });
}

// Preferred path: the Companion Server's Socket.IO channel has no rate limit
// and pushes updates instantly. REST polling remains a fallback for genuine
// socket/auth trouble, but not for the simple case where YTMD is closed.
async function startYtmdRealtime(){
  stopYtmdPolling();
  stopYtmdAvailabilityWatch();
  const d = STATE.settings.youtubeDesktop;
  if(!isYtmdConnected()) return;

  // Do not even start Socket.IO while the Companion Server is unavailable.
  // This is what prevents ECONNREFUSED + /state fetch spam on startup.
  if(!(await isYtmdServerReachable())){
    enterYtmdOfflineWait();
    return;
  }

  ytmdOfflineMessageShown = false;
  if(window.aetherisBridge){
    logYtmd('Opening realtime channel via the desktop app\'s background process…');
    ytmdUsingBridge = true;
    window.aetherisBridge.startRealtime({ host: ytmdHostAddr(d.host), port: d.port||9863, token: d.token });
    return;
  }
  if(typeof io === 'undefined'){
    logYtmd('Realtime library did not load — falling back to slower, rate-limited polling.');
    startYtmdPolling();
    return;
  }
  stopYtmdRealtime();
  logYtmd('Opening realtime channel…');
  let socket;
  try{
    socket = io('http://'+ytmdHostAddr(d.host)+':'+(d.port||9863)+'/api/v1/realtime', {
      transports: ['websocket'],
      auth: { token: d.token }
    });
  }catch(e){
    logYtmd('Realtime setup failed: '+e.message+' — falling back to polling.');
    startYtmdPolling();
    return;
  }
  ytmdSocket = socket;
  let ytmdRealtimeFails = 0;
  let ytmdRealtimeErrorCheckInFlight = false;
  socket.on('connect', ()=>{
    stopYtmdAvailabilityWatch();
    ytmdOfflineMessageShown = false;
    logYtmd('Realtime connected — no more polling needed.');
    ytmdRealtimeFails = 0;
    stopYtmdPolling();
    setYtmdStatus('connected', true);
    updateLeds();
    ytmdApi('/state').then(applyYtmdState).catch(()=>{});
  });
  socket.on('state-update', (state)=> applyYtmdState(state));
  socket.on('connect_error', async(err)=>{
    if(ytmdRealtimeErrorCheckInFlight) return;
    ytmdRealtimeErrorCheckInFlight = true;
    try{
      if(!(await isYtmdServerReachable())){
        enterYtmdOfflineWait();
        ytmdRealtimeFails = 0;
        return;
      }
      const detail = [
        err?.message,
        err?.description!==undefined ? 'description: '+JSON.stringify(err.description).slice(0,200) : null,
        err?.context?.message ? 'context: '+err.context.message : null
      ].filter(Boolean).join(' | ');
      logYtmd('Realtime connect error: '+(detail||'(no further detail given — Socket.IO hides most error info in the browser)'));
      startYtmdPolling();
      ytmdRealtimeFails++;
      if(ytmdRealtimeFails===3){
        logYtmd('Giving up on the realtime channel after repeated failures — staying on 6-second polling instead, which is safe and won\'t hit the rate limit.');
        stopYtmdRealtime();
      }
    }finally{
      ytmdRealtimeErrorCheckInFlight = false;
    }
  });
  socket.on('disconnect', async(reason)=>{
    if(!isYtmdConnected()) return;
    if(!(await isYtmdServerReachable())){
      enterYtmdOfflineWait();
      return;
    }
    logYtmd('Realtime disconnected ('+reason+'). Will retry automatically.');
  });
}
function stopYtmdRealtime(){
  if(ytmdUsingBridge && window.aetherisBridge){
    window.aetherisBridge.stopRealtime();
    ytmdUsingBridge = false;
  }
  if(ytmdSocket){ try{ ytmdSocket.disconnect(); }catch(e){} ytmdSocket=null; }
}

function startYtmdPolling(){
  if(ytmdPollHandle) return;
  pollYtmdState();
  ytmdPollHandle = setInterval(pollYtmdState, 6000);
}
function stopYtmdPolling(){ clearInterval(ytmdPollHandle); ytmdPollHandle=null; }

async function pollYtmdState(){
  if(Date.now() < ytmdPollBackoffUntil) return;
  try{
    const state = await ytmdApi('/state');
    applyYtmdState(state);
  }catch(e){
    const m = /retry in (\d+)/i.exec(e.message);
    if(m) ytmdPollBackoffUntil = Date.now() + (parseInt(m[1])+1)*1000;

    // If the whole Companion Server disappeared, leave polling mode and enter
    // the quiet availability watcher instead of logging the same fetch failure.
    if(e.message === 'Failed to fetch' && !(await isYtmdServerReachable())){
      enterYtmdOfflineWait();
      return;
    }
    logYtmd('State poll failed: '+e.message);
  }
}

/* ---------------- init theme immediately (covers overlay + app) ---------------- */
applyTheme();

/* ---------------- app version label / changelog (sidebar) ---------------- */
// Update this list each time a version ships — it's the source for the
// in-app "What's new" panel. Sorted newest-first automatically below, so
// entries can be added in any order.
const CHANGELOG = [
  { version:'1.4.2', title:'Twitch commands, cloud reliability & stability', notes:[
    'Fixed custom Twitch song-request commands failing to match when older or imported settings stored the command without a leading !, including automatic repair of existing saved command settings.',
    'Hardened request, Now Playing, and Queue command normalization so custom command names remain compatible across saved settings and Full Setup restores.',
    'Improved AetherisBot Cloud live-status handling so paired channels correctly recognize when the broadcaster is live and no longer require the offline-testing override for normal bot replies.',
    'Improved AetherisBot Cloud connection stability and WebSocket lifecycle handling, including safer reconnect behavior when a connection is still being established.',
    'Fixed Twitch disconnect behavior for cloud and legacy connections, including secure revoke handling and a local-only fallback when the cloud revoke endpoint cannot be reached.',
    'Fixed Developer Mode Update from File hanging by handing the installer off to a detached launcher so Aetheris can exit before the installer starts.',
    'Improved Developer Mode launching so the included launcher supports both Program Files and per-user Local AppData Aetheris installations.',
    'Removed Electron\'s hidden native application menu so pressing Alt no longer reveals an unintended menu bar.',
    'Hardened tray and shutdown behavior so tray initialization retries safely, failed tray startup cannot leave an invisible background process, and pending sockets, timers, OAuth, YTMD, and OBS resources are cleaned up on exit.',
    'Hardened the Windows development build script by cleaning stale Aetheris/NSIS build state and automatically retrying once after transient electron-builder failures.'
  ]},
  { version:'1.4.1', title:'Playback controls, commands & OBS polish', notes:[
    'Fixed Spotify playback controls incorrectly treating successful HTTP 200 responses with empty or non-JSON bodies as failures.',
    'Fixed false Twitch replies such as “Could not pause — no connected player to control” when Spotify had actually accepted the playback command.',
    'Applied the Spotify response fix across playback actions including Play, Pause, Skip/Next, Previous, and related non-GET player commands.',
    'Added customizable playback command names for Spotify and YouTube Music Desktop so each service can use its own Skip, Pause, Resume, and Previous commands.',
    'Saved custom Spotify and YouTube command names with Aetheris settings and Full Setup backup/restore while preserving the existing defaults for users who do not customize them.',
    'Included the latest OBS overlay fix and polish that had not yet shipped in the public v1.4.0 release.'
  ]},
  { version:'1.4.0', title:'AetherisBot Cloud, security & reliability', notes:[
    'Introduced AetherisBot Cloud, a centralized Twitch chatbot architecture that receives chat through Twitch EventSub and securely forwards requests to each paired Aetheris desktop app.',
    'Added browser-based Twitch OAuth and secure desktop pairing so normal users can connect Twitch without entering a bot username or bot OAuth token.',
    'Added cloud Twitch replies, AetherisBot self-message filtering, initial live/offline state, offline message suppression by default, and an optional offline testing override.',
    'Hardened Twitch OAuth lifecycle handling with token validation, refresh support, reauthorization status reporting, secure disconnect/revoke behavior, and pairing credential rotation.',
    'Improved cloud reliability with WebSocket heartbeat/reconnect diagnostics, payload and message limits, request rate limits, replay/duplicate protection, and stricter protocol validation.',
    'Completed Security Phases 1, 2A, and 2B, including sandboxing, navigation and IPC restrictions, protected secret storage, safer Full Setup backups, atomic private writes, security headers, and stricter import/input validation.',
    'Secured OBS Browser Source integration behind a localhost relay so service credentials are no longer exposed in OBS URLs while preserving compatibility with older v1.3.0 URLs.',
    'Fixed Twitch connection UI state so healthy paired accounts show Disconnect, Re-authorize appears only when authorization actually needs attention, and top/bottom connection indicators stay synchronized.',
    'Improved startup cloud-bridge state handling so an already paired and healthy Twitch connection reports its real authenticated status instead of lingering on a waiting state.',
    'Improved Spotify playback controls so Skip and related player commands target an available Spotify Connect device when Spotify does not report an active player.',
    "Restored and hardened the clickable version / What's New pill, including keyboard access and the theme-aware animated unseen-notes indicator, while fixing startup ordering that could leave it blank or missing.",
    'Preserved the known-good YouTube Music Desktop realtime integration, Windows tray behavior, packaged UI resources, Developer Mode, secure setup backup/restore, requested-song logging, diagnostics, and existing request/queue behavior.'
  ]},
  { version:'1.3.0', title:'Requests, playback, OBS, customization & reliability', notes:[
    'Added automatic request modes for Manual, Spotify only, YouTube only, and Spotify → YouTube fallback handling directly from the Dashboard.',
    'Improved automatic request safety so requests that cannot be resolved remain pending instead of disappearing.',
    'Added the Dashboard Up Next queue and improved persistence/playback tracking so it reflects songs Aetheris successfully queues and what is actually coming next.',
    'Made Now Playing more compact while keeping Previous, Play/Pause, and Skip controls, and added stream-readiness plus session request/queue statistics.',
    'Redesigned Commands with separate Spotify and YouTube command groups, toggles, variables, and presets while keeping general announcements shared.',
    'Streamlined YouTube setup by grouping YouTube Data API and YouTube Music Desktop settings together and fixed the bundled YouTube API tutorial so it opens correctly in development and installed builds.',
    'Improved YouTube Music Desktop handling with cleaner offline detection, quieter reconnect behavior, playlist-return/shuffle improvements, better connection status handling, and safer isolated startup.',
    'Improved Twitch reliability with isolated startup, live/offline status awareness, bot-message suppression while the channel is offline, an optional offline testing override, and quieter suppression logging.',
    'Added requested-song TXT logs that record requested songs only after they actually begin playing and automatically retain the newest 10 logs.',
    'Improved OBS overlay behavior with packaged external overlay resources, preview/browser-source matching, stable sizing, 1:1 behavior, shorter-title handling, and rebuilt scrolling text.',
    'Added runtime diagnostics, downloadable app-wide error logs, Developer Mode/local update tools, and safer packaged-resource handling for troubleshooting and releases.',
    'Added a Twitch OAuth copy button and cleaned up Settings by moving Full Setup Backup to the bottom and removing duplicate request-handling controls.',
    "Added a new fresh-install default theme without changing existing users\' saved appearance.",
    'Replaced native color inputs with an Aetheris-styled custom color picker, including exact hex editing and a vertical brightness control inside the picker.',
    "Added a theme-aware animated update indicator on the version button when new What\'s New notes are available.",
    'Added Windows system tray support: closing the window hides Aetheris to the tray so requests can keep running, clicking the tray icon restores it, and Exit Aetheris fully shuts it down.'
  ]},
  { version:'1.2.1', title:'Full setup backup & tutorial fix', notes:[
    'Added Export all / Import all in Settings so API keys, service credentials/tokens, connection settings, theme, and OBS overlay customization can be moved to a new PC or clean Aetheris installation.',
    'Full setup backups leave request queue, history, and now-playing runtime data behind; credentials are now stored in a protected portable blob rather than readable JSON.',
    'Fixed the YouTube API tutorial link so the bundled aetheris-youtube-api-setup.html guide is included with packaged builds and opens correctly from the installed desktop app.'
  ]},
  { version:'1.2.0', title:'Playback, updates, customization & support', notes:[
    'Redesigned the Dashboard into independent left/right columns for cleaner card spacing.',
    'Moved customization import/export into the Customization tab and cleaned up Customization section spacing.',
    'Fixed Add a song directly so Aetheris only records the song after queueing succeeds and labels manual requests as Aetheris.',
    'Switched Spotify desktop authorization to Authorization Code + PKCE, with no Client Secret required.',
    'Improved Spotify queueing by selecting an available Spotify Connect device and handling successful plain-text player responses.',
    'Added realtime YouTube Music Desktop Companion Server playback updates instead of relying on polling when realtime is available.',
    'Improved YouTube request transitions with seek-aware 500ms switching and safeguards that prevent queued songs from being skipped.',
    'Improved playlist rejoin and shuffle behavior, including a random non-first playlist jump followed by the native YTMD shuffle toggle.',
    'Added stable playlist fallback handling so generated YouTube Music radio/mix playlists are ignored in favor of the configured fallback playlist.',
    'Added an Aetheris YouTube Data API setup tutorial with step-by-step screenshots and linked it below the masked YouTube API key field.',
    'Updates now ask for permission before downloading and installing instead of downloading silently.',
    'Added an About section with the GitHub repository, manual update check, version information, and CodedByNyxia branding.',
    'Added a support/feedback email to the "What\'s new" panel.'
  ]},
  { version:'1.1.1', title:'Stability, polish & changelog', notes:[
    'Fixed opening the app while it was already running launching a duplicate instance.',
    'Fixed the window appearing to freeze for a moment when restarting to finish an update.',
    'Added a subtle animated glow to the app logo in the sidebar.',
    'Added this "What\'s new" panel — click the version number in the sidebar to see recent changes.'
  ]},
  { version:'1.1.0', title:'Custom branding', notes:[
    'Replaced the default Electron icon everywhere — the app, installer, uninstaller, shortcuts, and taskbar.',
    'Themed the installer with a custom banner instead of the default blue sidebar.',
    'The sidebar logo and browser tab icon now match the real app icon.',
    'Cleaner title bar — just "Aetheris" instead of "Aetheris — Twitch Song Requests".'
  ]},
  { version:'1.0.3', title:'Themed update prompt', notes:[
    'The "update ready" dialog now matches the app\u2019s own look instead of a plain Windows popup.',
    'Updates install completely silently and automatically restart into the new version.'
  ]},
  { version:'1.0.2', title:'Version display', notes:[
    'Added a version number under the app name in the sidebar.'
  ]},
  { version:'1.0.1', title:'Automatic updates', notes:[
    'Aetheris can now check for and install new versions on its own.'
  ]},
];

function compareVersions(a, b){
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for(let i=0;i<Math.max(pa.length,pb.length);i++){
    const x = pa[i]||0, y = pb[i]||0;
    if(x!==y) return x-y;
  }
  return 0;
}

function renderChangelog(){
  const body = document.getElementById('changelog-modal-body');
  if(!body) return;
  const sorted = [...CHANGELOG].sort((a,b)=>compareVersions(b.version,a.version));
  body.innerHTML = sorted.map(entry => `
    <div class="changelog-entry">
      <div class="changelog-entry-head">
        <span class="changelog-entry-version">v${escapeHtml(entry.version)}</span>
        <span class="changelog-entry-title">${escapeHtml(entry.title)}</span>
      </div>
      <ul>${entry.notes.map(n=>`<li>${escapeHtml(n)}</li>`).join('')}</ul>
    </div>
  `).join('');
}

function initSidebarVersionChangelog(){
  const el = document.getElementById('app-version-label');
  const hasVersion = el && window.aetherisBridge && window.aetherisBridge.version;
  if(hasVersion){
    el.textContent = 'v'+window.aetherisBridge.version;
    // Glow the version pill when this build has patch notes the user has not opened yet.
    // The glow follows the active theme via --accent / --accent-2 and clears after opening What's new.
    const currentVersion = String(window.aetherisBridge.version);
    const lastSeenVersion = localStorage.getItem('aetheris_last_seen_changelog_version');
    if(!lastSeenVersion || compareVersions(currentVersion, lastSeenVersion) > 0){
      el.classList.add('has-new-notes');
    }
  } else if(el){
    // No version to show (e.g. opened outside the packaged Electron app,
    // where preload.js never runs) — hide it instead of leaving an empty,
    // broken-looking pill with nothing in it.
    el.style.display = 'none';
  }
  const backdrop = document.getElementById('changelog-modal-backdrop');
  const closeBtn = document.getElementById('changelog-close-btn');
  if(hasVersion){
    el.setAttribute('role','button');
    el.setAttribute('tabindex','0');
    el.title = "What's new";
    const open = ()=>{
      renderChangelog();
      if(backdrop) backdrop.classList.add('show');
      localStorage.setItem('aetheris_last_seen_changelog_version', String(window.aetherisBridge.version));
      el.classList.remove('has-new-notes');
    };
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); open(); } });
  }
  if(closeBtn) closeBtn.addEventListener('click', ()=>{ if(backdrop) backdrop.classList.remove('show'); });
  if(backdrop) backdrop.addEventListener('click', (e)=>{ if(e.target===backdrop) backdrop.classList.remove('show'); });
}

/* ---------------- update modal ---------------- */
function showUpdateAvailable(version){
  const backdrop = document.getElementById('update-modal-backdrop');
  const title = document.getElementById('update-modal-title');
  const text = document.getElementById('update-modal-text');
  const updateBtn = document.getElementById('update-restart-btn');
  const laterBtn = document.getElementById('update-later-btn');
  if(title) title.textContent = 'Update available';
  if(text) text.innerHTML = 'Aetheris <b>v'+escapeHtml(version||'')+'</b> is available. Would you like to update now?';
  if(updateBtn){ updateBtn.textContent='Update now'; updateBtn.disabled=false; }
  if(laterBtn){ laterBtn.textContent='Later'; laterBtn.disabled=false; }
  if(backdrop) backdrop.classList.add('show');
}
(function(){
  if(!window.aetherisBridge) return;
  const backdrop = document.getElementById('update-modal-backdrop');
  const title = document.getElementById('update-modal-title');
  const text = document.getElementById('update-modal-text');
  const updateBtn = document.getElementById('update-restart-btn');
  const laterBtn = document.getElementById('update-later-btn');
  window.aetherisBridge.onUpdateAvailable((info)=> showUpdateAvailable(info?.version));
  window.aetherisBridge.onUpdateDownloaded((info)=>{
    if(title) title.textContent='Installing update';
    if(text) text.innerHTML='Aetheris <b>v'+escapeHtml((info&&info.version)||'')+'</b> has downloaded. Restarting to finish the update…';
    if(updateBtn){ updateBtn.textContent='Installing…'; updateBtn.disabled=true; }
    if(laterBtn) laterBtn.style.display='none';
    setTimeout(()=>window.aetherisBridge.restartAndInstallUpdate(), 350);
  });
  if(updateBtn) updateBtn.addEventListener('click', async ()=>{
    updateBtn.textContent='Downloading…';
    updateBtn.disabled=true;
    if(laterBtn) laterBtn.disabled=true;
    if(text) text.textContent='Downloading the update. Aetheris will restart automatically when it is ready.';
    try{ await window.aetherisBridge.downloadUpdate(); }
    catch(e){
      if(text) text.textContent='Update failed: '+(e.message||'unknown error');
      updateBtn.textContent='Retry update'; updateBtn.disabled=false;
      if(laterBtn){ laterBtn.disabled=false; laterBtn.style.display=''; }
    }
  });
  if(laterBtn) laterBtn.addEventListener('click', ()=>{ if(backdrop) backdrop.classList.remove('show'); });
})();
