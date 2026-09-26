document.getElementById("year").textContent = new Date().getFullYear();
const apiStatus=document.getElementById("api-status");if(apiStatus){fetch("https://api.aetherisbot.com/health",{cache:"no-store"}).then(r=>{if(!r.ok)throw new Error();return r.json()}).then(d=>{if(d&&d.ok){apiStatus.textContent="OPERATIONAL";apiStatus.className="status ok"}else throw new Error()}).catch(()=>{apiStatus.textContent="UNREACHABLE";apiStatus.className="status bad"});}
// Docs table-of-contents scroll highlight
const docsToc=document.getElementById("docs-toc");
if(docsToc){
  const links=[...docsToc.querySelectorAll('a[href^="#"]')];
  const sections=links.map(a=>document.querySelector(a.getAttribute("href"))).filter(Boolean);
  const setActive=()=>{
    let current=sections[0];
    const marker=window.scrollY+180;
    sections.forEach(s=>{if(s.offsetTop<=marker)current=s});
    links.forEach(a=>a.classList.toggle("active",current&&a.getAttribute("href")==="#"+current.id));
  };
  addEventListener("scroll",setActive,{passive:true}); setActive();
}
document.querySelectorAll(".copy-code").forEach(btn=>btn.addEventListener("click",async()=>{
  if(btn.disabled||!btn.dataset.copy)return;
  try{await navigator.clipboard.writeText(btn.dataset.copy);btn.textContent="Copied";setTimeout(()=>btn.textContent="Copy",1400)}catch{}
}));

// v1.0 production polish
(()=>{
  const route=value=>(value.split("/").filter(Boolean).pop()||"index").toLowerCase().replace(/\.html$/, "");
  const page=route(location.pathname);
  document.querySelectorAll(".nav a[href]").forEach(a=>{
    const href=(a.getAttribute("href")||"").split("#")[0].toLowerCase();
    if(href && route(href)===page) a.classList.add("active");
  });

  const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
  const reveal=[...document.querySelectorAll("main section > *, .card, .feature-card")].filter(el=>!el.closest(".hash-guide .step"));
  reveal.forEach(el=>el.classList.add("reveal"));
  if(reduced || !("IntersectionObserver" in window)){
    reveal.forEach(el=>el.classList.add("is-visible"));
  }else{
    const io=new IntersectionObserver(entries=>entries.forEach(e=>{
      if(e.isIntersecting){e.target.classList.add("is-visible");io.unobserve(e.target)}
    }),{threshold:.08});
    reveal.forEach(el=>io.observe(el));
  }

  // Homepage product demo: intentionally fictional sample state, never a user's live session.
  const title=document.getElementById("demo-title"), sub=document.getElementById("demo-sub"),
        source=document.getElementById("demo-source"), sourceIcon=document.getElementById("demo-source-icon"),
        coverIcon=document.getElementById("demo-cover-icon"), cover=document.getElementById("demo-cover"),
        trackCopy=document.getElementById("demo-track-copy"), bar=document.getElementById("demo-progress"),
        cur=document.getElementById("demo-current"), dur=document.getElementById("demo-duration");
  if(title&&source&&bar&&cur&&dur){
    const demos=[
      {title:"Midnight Drive",sub:"Neon Skyline • Requested by @nightowl",source:"Spotify",icon:"assets/spotify.svg",duration:222},
      {title:"Afterglow",sub:"Luna Harbor • Requested by @pixelpilot",source:"YouTube Music Desktop",icon:"assets/youtube-music.svg",duration:248},
      {title:"Static Hearts",sub:"Glass Avenue • Requested by @vibechaser",source:"Spotify",icon:"assets/spotify.svg",duration:201},
      {title:"City Lights",sub:"Nova Echo • Requested by @latecheckin",source:"YouTube Music Desktop",icon:"assets/youtube-music.svg",duration:236}
    ];
    let di=0,elapsed=0,timer=null;
    const fmt=s=>`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
    const paint=()=>{const d=demos[di];cur.textContent=fmt(elapsed);dur.textContent=fmt(d.duration);bar.style.width=`${Math.min(100,elapsed/d.duration*100)}%`};
    const loadSong=(index)=>{
      di=index%demos.length;elapsed=0;const d=demos[di];
      if(trackCopy)trackCopy.classList.add("is-changing");if(cover)cover.classList.add("is-changing");
      setTimeout(()=>{title.textContent=d.title;if(sub)sub.textContent=d.sub;source.textContent=d.source;
        if(sourceIcon)sourceIcon.src=d.icon;if(coverIcon)coverIcon.src=d.icon;paint();
        if(trackCopy)trackCopy.classList.remove("is-changing");if(cover)cover.classList.remove("is-changing");
      },220);
    };
    paint();
    if(!reduced)timer=setInterval(()=>{elapsed++;if(elapsed>=demos[di].duration||elapsed>=12)loadSong(di+1);else paint()},1000);
  }

})();


// Shared GitHub release client for current labels, downloads and the changelog.
// Public data only. Cached notes are never treated as HTML or executable content.
(()=>{
  const API='https://api.github.com/repos/Nyxia-Code/Aetheris/releases';
  const RELEASES='https://github.com/Nyxia-Code/Aetheris/releases';
  const CACHE='aetheris.github-releases.v2', TTL=5*60*1000, MAX_STALE=7*24*60*60*1000;
  const versions=[...document.querySelectorAll('[data-release-version]')];
  const shipped=document.querySelector('[data-release-shipped]');
  const timeline=document.getElementById('release-timeline');
  const installerLink=document.getElementById('latest-installer');
  if(!versions.length&&!shipped&&!timeline&&!installerLink)return;
  const byId=id=>document.getElementById(id);
  const normalize=tag=>/^v?(\d+\.\d+\.\d+)$/i.exec(String(tag))?.[1]||null;
  const safeUrl=(value,prefix)=>{
    try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.origin==='https://github.com'&&u.pathname.startsWith(prefix)?u.href:null}catch{return null}
  };
  function validateRelease(r){
    if(!r||r.draft!==false||r.prerelease!==false||typeof r.tag_name!=='string'||r.tag_name.length>128)return null;
    const version=normalize(r.tag_name),url=safeUrl(r.html_url,'/Nyxia-Code/Aetheris/releases/tag/');
    if(!version||!url||typeof r.published_at!=='string'||!Number.isFinite(Date.parse(r.published_at)))return null;
    return {tag_name:r.tag_name,version,html_url:url,name:String(r.name||r.tag_name).slice(0,300),
      published_at:new Date(r.published_at).toISOString(),body:String(r.body||'').slice(0,32768),
      draft:false,prerelease:false,assets:(Array.isArray(r.assets)?r.assets:[]).slice(0,100).flatMap(a=>{
        if(!a||typeof a.name!=='string'||!/^[a-z0-9][a-z0-9._ ()-]{0,179}$/i.test(a.name))return [];
        const download=safeUrl(a.browser_download_url,'/Nyxia-Code/Aetheris/releases/download/');
        if(!download)return [];
        return [{name:a.name,browser_download_url:download,digest:typeof a.digest==='string'&&/^sha256:[a-f0-9]{64}$/i.test(a.digest)?a.digest:null}];
      })};
  }
  function stableList(rows){
    if(!Array.isArray(rows)||rows.length>500)throw Error('Invalid release listing');
    const unique=new Map();
    for(const r of rows.map(validateRelease).filter(Boolean).sort((a,b)=>b.published_at.localeCompare(a.published_at)||a.tag_name.localeCompare(b.tag_name))){
      if(!unique.has(r.version))unique.set(r.version,r);
    }
    if(!unique.size)throw Error('No published stable releases returned');
    return [...unique.values()];
  }
  let cache={};
  try{const raw=localStorage.getItem(CACHE);if(raw&&raw.length<2*1024*1024){const parsed=JSON.parse(raw);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))cache=parsed}}catch{}
  const pending=new Map();
  function cached(key){
    try{const c=cache[key],age=Date.now()-c.at;if(!Number.isFinite(c.at)||age<0||age>MAX_STALE)return null;
      const data=key==='latest'?validateRelease(c.data):stableList(c.data);return data?{data,at:c.at,age}:null;
    }catch{return null}
  }
  function persist(key,data){
    cache[key]={at:Date.now(),data};try{localStorage.setItem(CACHE,JSON.stringify(cache))}catch{}
  }
  let blockedUntil=0;
  async function request(url){
    if(Date.now()<blockedUntil)throw Error('GitHub rate limit: retry after '+new Date(blockedUntil).toLocaleTimeString());
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetch(url,{headers:{Accept:'application/vnd.github+json'},signal:controller.signal});
      if(!response.ok){
        if(response.status===429||response.status===403){
          const retry=response.headers.get('retry-after'),reset=Number(response.headers.get('x-ratelimit-reset'))*1000;
          const retryAt=retry?(Number.isFinite(Number(retry))?Date.now()+Number(retry)*1000:Date.parse(retry)):0;
          blockedUntil=Math.max(Date.now()+60000,Math.min(Math.max(retryAt||0,reset||0),Date.now()+24*60*60*1000));
        }
        throw Error('GitHub API returned HTTP '+response.status);
      }
      // Bound both streamed bytes and parse size; timeout covers body reading too.
      const reader=response.body.getReader(),parts=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024*1024){await reader.cancel();throw Error('GitHub response exceeded size limit')}parts.push(value)}
      const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength}
      return {data:JSON.parse(new TextDecoder().decode(bytes)),link:response.headers.get('link')};
    }finally{clearTimeout(timer)}
  }
  async function load(key){
    const old=cached(key);if(old&&old.age<TTL)return {...old,source:'cache',stale:false};
    if(pending.has(key))return pending.get(key);
    const promise=(async()=>{
      try{
        let data;
        if(key==='latest'){
          data=validateRelease((await request(API+'/latest')).data);if(!data)throw Error('Invalid latest stable release');
        }else{
          let url=API+'?per_page=100',rows=[];const visited=new Set();
          while(url){
            if(visited.has(url)||visited.size>=5)throw Error('Release pagination limit reached');visited.add(url);
            const response=await request(url);if(!Array.isArray(response.data))throw Error('Invalid release listing');
            rows.push(...response.data);
            const next=response.link?.match(/<([^>]+)>\s*;\s*rel="next"/)?.[1];url=null;
            if(next){const u=new URL(next);if(u.origin!=='https://api.github.com'||u.pathname!=='/repos/Nyxia-Code/Aetheris/releases'||u.username||u.password)throw Error('Unexpected pagination URL');url=u.href}
          }
          data=stableList(rows);
        }
        persist(key,data);return {data,at:cache[key].at,source:'network',stale:false};
      }catch(error){if(old)return {...old,source:'cache',stale:true,error};throw error}
    })();
    pending.set(key,promise);try{return await promise}finally{pending.delete(key)}
  }
  const text=(id,value)=>{const el=byId(id);if(el)el.textContent=value};
  const note=(value,error=false)=>{const el=byId('release-sync-note');if(el){el.hidden=false;el.textContent=value;el.dataset.syncError=String(error)}};
  function unavailable(){
    versions.forEach(el=>el.textContent='Release unavailable');if(shipped)shipped.textContent='Release unavailable';
    text('installer-filename','Release metadata unavailable');text('hash-command','Checksum command unavailable until release metadata loads.');
    const copy=byId('hash-copy');if(copy){copy.disabled=true;delete copy.dataset.copy}
    for(const id of ['installer-vt','installed-exe-vt']){const el=byId(id);if(el){el.hidden=true;el.removeAttribute('href')}}
    if(installerLink){installerLink.href=RELEASES+'/latest';installerLink.textContent='View latest release on GitHub ↗'}
    text('installer-hash','Current checksum unavailable');
    const exe=byId('installed-exe-hash-row')?.querySelector('code');if(exe)exe.textContent='Current checksum unavailable';
  }
  function renderCurrent(result){
    if(result.stale)throw Error('Cached release metadata is stale; current checksums were not verified.');
    const r=result.data,version='v'+r.version;
    versions.forEach(el=>el.textContent=version);if(shipped)shipped.textContent=version+' shipped';
    const releasePage=byId('latest-release-page');if(releasePage)releasePage.href=r.html_url;
    const installer=r.assets.find(a=>/aetheris.*setup.*\.exe$/i.test(a.name))||r.assets.find(a=>/\.exe$/i.test(a.name));
    if(installerLink){installerLink.href=installer?.browser_download_url||r.html_url;installerLink.textContent=installer?'Download '+version+' installer ↗':'View '+version+' release on GitHub ↗'}
    if(installer){
      text('installer-filename',installer.name);
      // Validated filename plus single-quoted PowerShell literal prevents substitution.
      const command="Get-FileHash -LiteralPath '.\\"+installer.name+"' -Algorithm SHA256";
      text('hash-command',command);const copy=byId('hash-copy');if(copy){copy.dataset.copy=command;copy.disabled=false}
    }
    const digest=installer?.digest?.slice(7).toUpperCase()||'';
    text('installer-hash',digest||'Not published by GitHub for this installer');
    const exeMatch=r.body.match(/Installed\s+(?:EXE(?:\s+SHA-?256)?|Aetheris\.exe|Application)[\s\S]{0,300}?\b([a-f0-9]{64})\b/i);
    const exeDigest=exeMatch?exeMatch[1].toUpperCase():'';
    const exe=byId('installed-exe-hash-row')?.querySelector('code');if(exe)exe.textContent=exeDigest||'Not found in GitHub release notes';
    for(const [id,d] of [['installer-vt',digest],['installed-exe-vt',exeDigest]]){const el=byId(id);if(el){el.hidden=!d;if(d)el.href='https://www.virustotal.com/gui/file/'+d}}
    note('GitHub release metadata — '+version+'. Checked '+new Date(result.at).toLocaleString()+(result.source==='cache'?' (five-minute cache).':'.'));
  }
  function element(tag,value,className){const el=document.createElement(tag);if(value!==undefined)el.textContent=value;if(className)el.className=className;return el}
  // Deliberately small Markdown subset. Raw HTML, inline Markdown and links stay text.
  function renderNotes(parent,body){
    let list=null,kind=null,code=null,paragraph=null;
    for(const line of (body||'No release notes provided.').split(/\r?\n/).slice(0,1200)){
      if(/^\s*```/.test(line)){list=paragraph=null;kind=null;if(code){code=null}else{const pre=element('pre');code=element('code','');pre.append(code);parent.append(pre)}continue}
      if(code){code.textContent+=line+'\n';continue}
      if(!line.trim()){list=paragraph=null;kind=null;continue}
      const heading=/^#{1,6}\s+(.+)$/.exec(line),bullet=/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.*)$/.exec(line);
      if(heading){parent.append(element('h3',heading[1]));list=paragraph=null;kind=null}
      else if(bullet){const nextKind=/^\s*\d/.test(line)?'ol':'ul';if(!list||nextKind!==kind){list=element(nextKind);parent.append(list);kind=nextKind}list.append(element('li',bullet[1]));paragraph=null}
      else{list=null;kind=null;if(!paragraph){paragraph=element('p',line);parent.append(paragraph)}else paragraph.textContent+='\n'+line}
    }
  }
  function renderHistory(result,latest){
    const fragment=document.createDocumentFragment(),seen=new Set();
    const rows=stableList(latest&&!latest.stale?[latest.data,...result.data]:result.data);
    const latestVersion=latest&&!latest.stale&&!result.stale?latest.data.version:null;
    for(const r of rows){
      seen.add(r.version);const article=element('article',undefined,'release glass');article.dataset.releaseVersion=r.version;
      const meta=element('div');if(r.version===latestVersion)meta.append(element('span','LATEST'));
      meta.append(element('h2','v'+r.version),element('small',r.name),element('small','Tag: '+r.tag_name,'release-tag'));
      const date=element('time',r.published_at.slice(0,10)+' UTC');date.dateTime=r.published_at;meta.append(date);
      const notes=element('div',undefined,'release-notes');renderNotes(notes,r.body);
      const link=element('a','View Release on GitHub ↗');link.href=r.html_url;link.target='_blank';link.rel='noopener noreferrer';notes.append(link);article.append(meta,notes);fragment.append(article);
    }
    timeline.replaceChildren(fragment);
    for(const entry of document.querySelectorAll('[data-static-release]'))entry.hidden=seen.has(normalize(entry.dataset.staticRelease));
    text('release-archive-heading','Historical archive — releases not included above');
  }
  const status=byId('changelog-status'),retry=byId('changelog-retry');let running=false;
  async function refresh(){
    if(running)return;running=true;if(retry){retry.hidden=true;retry.disabled=true}
    if(status){status.dataset.state='loading';status.textContent='Loading GitHub releases. Historical notes remain available below.'}
    unavailable();
    try{
      const currentPromise=load('latest');
      // Download/current-label updates never wait for the changelog list.
      const currentResult=currentPromise.then(value=>{try{renderCurrent(value)}catch(error){unavailable();note(error.message,true)}return value},error=>{unavailable();note('GitHub release sync failed: '+error.message,true);return null});
      const historyResult=timeline?load('list').then(value=>({value}),error=>({error})):Promise.resolve(null);
      const [latest,history]=await Promise.all([currentResult,historyResult]);
      if(timeline){
        if(history.error){
          timeline.replaceChildren();for(const entry of document.querySelectorAll('[data-static-release]'))entry.hidden=false;
          text('release-archive-heading','Historical archive — not a current release listing');
          status.dataset.state='error';status.textContent='GitHub releases unavailable. Showing preserved historical notes; this is not the latest release list. '+history.error.message;
        }else{
          renderHistory(history.value,latest);
          const stale=history.value.stale||!latest||latest.stale;
          status.dataset.state=stale?'stale':'ok';status.textContent=stale?'Showing release history checked '+new Date(history.value.at).toLocaleString()+'. Current latest could not be verified; no LATEST badge is shown.':'Stable GitHub releases. Checked '+new Date(history.value.at).toLocaleString()+'.';
        }
        if(retry)retry.hidden=status.dataset.state==='ok';
      }
    }finally{running=false;if(retry)retry.disabled=false}
  }
  retry?.addEventListener('click',()=>{void refresh()});
  void refresh();
})();
