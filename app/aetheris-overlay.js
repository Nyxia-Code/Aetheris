'use strict';
(() => {
  const DEFAULT_OVERLAY={style:'card',font:'Inter',bg:'#1c1914',text:'#f2eee6',accent:'#e8a33d',transparency:88,padding:14,gap:14,artSize:64,radius:14,titleSize:16,barHeight:5,showArt:true,showProgress:true,showArtist:true,showBadge:true,scrollSpeed:40,width:550,coverMotion:'none',canvasBackdrop:false};
  const FONT_STACKS={'Inter':'Inter, Segoe UI, Arial, sans-serif','JetBrains Mono':'Consolas, Cascadia Mono, monospace','Roboto':'Roboto, Segoe UI, Arial, sans-serif','Poppins':'Poppins, Segoe UI, Arial, sans-serif','Montserrat':'Montserrat, Segoe UI, Arial, sans-serif'};
  const root=document.getElementById('overlay-root');
  const token=location.pathname.split('/').filter(Boolean).pop()||'';
  const validToken=/^[a-f0-9]{64}$/i.test(token);
  let overlay={...DEFAULT_OVERLAY}, nowPlaying=null, eventSource=null, lastStateAt=0, signature='';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cssUrl=s=>String(s??'').replace(/['"()\\]/g,c=>'\\'+c);
  const rgba=(hex,pct)=>{const m=/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex||''));if(!m)return 'rgba(28,25,20,.88)';return `rgba(${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)},${Math.max(0,Math.min(100,Number(pct)||0))/100})`};
  const fmt=ms=>{const s=Math.max(0,Math.floor((Number(ms)||0)/1000));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`};
  const shownProgress=()=>{if(!nowPlaying)return 0;let p=Math.max(0,Number(nowPlaying.progressMs)||0);if(nowPlaying.isPlaying&&nowPlaying.updatedAt)p+=Math.max(0,Date.now()-Number(nowPlaying.updatedAt));return nowPlaying.durationMs?Math.min(p,Number(nowPlaying.durationMs)):p};
  function marquee(){requestAnimationFrame(()=>requestAnimationFrame(()=>{const wrap=document.getElementById('ov-marquee'),inner=document.getElementById('ov-marquee-inner');if(!wrap||!inner)return;const copies=inner.querySelectorAll('.marquee-copy');const first=copies[0];if(!first||first.scrollWidth<=wrap.clientWidth){wrap.classList.remove('is-scrolling');inner.style.transform='translateX(0)';return}wrap.classList.add('is-scrolling');const distance=first.getBoundingClientRect().width+40;const speed=Math.max(10,Number(overlay.scrollSpeed)||40);inner.animate([{transform:'translateX(0)'},{transform:`translateX(-${distance}px)`}],{duration:(distance/speed)*1000,iterations:Infinity,easing:'linear'});}));}
  function render(){
    const o={...DEFAULT_OVERLAY,...overlay}; const np=nowPlaying;
    const sig=JSON.stringify([o.style,o.font,o.bg,o.text,o.accent,o.padding,o.gap,o.artSize,o.radius,o.titleSize,o.barHeight,o.width,o.transparency,o.scrollSpeed,o.showArt,o.showProgress,o.showArtist,o.showBadge,o.coverMotion,o.canvasBackdrop,np?.title,np?.artist,np?.art,np?.source,!!np]);
    if(sig===signature){if(np){const p=shownProgress(),pct=np.durationMs?Math.min(100,p/np.durationMs*100):0;const fill=root.querySelector('.ov-progress .fill'),badge=root.querySelector('.ov-badge');if(fill)fill.style.width=pct+'%';if(badge)badge.textContent=o.showProgress?`${fmt(p)} / ${fmt(np.durationMs)}${o.showBadge?' · '+(np.source||''):''}`:(np.source||'');}return}
    signature=sig;
    const vars=`--ov-bg:${rgba(o.bg,o.transparency)};--ov-text:${o.text};--ov-accent:${o.accent};--ov-pad:${o.padding}px;--ov-gap:${o.gap}px;--ov-art:${o.artSize}px;--ov-radius:${o.radius}px;--ov-titlesize:${o.titleSize}px;--ov-barheight:${o.barHeight}px;--ov-width:${o.width}px;--ov-font:${FONT_STACKS[o.font]||FONT_STACKS.Inter};${o.canvasBackdrop&&np?.art?`--ov-backdrop-img:url('${cssUrl(np.art)}');`:''}`;
    if(!np){root.innerHTML=`<div class="ov-widget style-${esc(o.style)}" style="${vars};opacity:.85"><div class="ov-body"><div class="ov-title" style="opacity:.6">Nothing playing</div></div></div>`;return}
    const p=shownProgress(),pct=np.durationMs?Math.min(100,p/np.durationMs*100):0,artClass=o.coverMotion==='zoom'?'motion-zoom':o.coverMotion==='spin'?'motion-spin':'';
    root.innerHTML=`<div class="ov-widget style-${esc(o.style)}" style="${vars}">${o.canvasBackdrop&&np.art?'<div class="ov-backdrop"></div>':''}${o.showArt?`<img class="ov-art ${artClass}" src="${esc(np.art||'')}" alt="">`:''}<div class="ov-body"><div class="ov-marquee ov-title" id="ov-marquee"><span class="inner" id="ov-marquee-inner"><span class="marquee-copy">${esc(np.title||'Untitled')}</span><span class="marquee-copy" aria-hidden="true">${esc(np.title||'Untitled')}</span></span></div>${o.showArtist?`<div class="ov-artist">${esc(np.artist||'')}</div>`:''}${o.showProgress?`<div class="ov-progress"><div class="fill" style="width:${pct}%"></div></div><div class="ov-badge">${fmt(p)} / ${fmt(np.durationMs)}${o.showBadge?' · '+esc(np.source||''):''}</div>`:o.showBadge?`<div class="ov-badge">${esc(np.source||'')}</div>`:''}</div></div>`;
    marquee();
  }
  function applyState(data){if(!data||typeof data!=='object')return;overlay={...DEFAULT_OVERLAY,...(data.overlay||{})};nowPlaying=data.nowPlaying||null;lastStateAt=Date.now();render()}
  async function refreshState(){if(!validToken)return;try{const r=await fetch(`/state/${token}`,{cache:'no-store'});if(r.ok)applyState(await r.json())}catch(_){} }
  function connect(){if(!validToken)return;try{eventSource?.close()}catch(_){};eventSource=new EventSource(`/events/${token}`);eventSource.onmessage=e=>{try{applyState(JSON.parse(e.data||'{}'))}catch(_){}};eventSource.onerror=()=>{setTimeout(refreshState,250)}}
  render();
  if(!validToken){console.error('Invalid Aetheris overlay token');return}
  refreshState(); connect();
  // Independent state polling makes OBS resilient even if Chromium/SSE stalls.
  setInterval(refreshState,1000);
  setInterval(render,250);
  setInterval(()=>{if(Date.now()-lastStateAt>5000)refreshState()},2000);
  window.addEventListener('online',()=>{refreshState();connect()});
})();
