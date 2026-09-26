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
  try{await navigator.clipboard.writeText(btn.dataset.copy);btn.textContent="Copied";setTimeout(()=>btn.textContent="Copy",1400)}catch{}
}));

// v1.0 production polish
(()=>{
  const page=(location.pathname.split("/").pop()||"index.html").toLowerCase();
  document.querySelectorAll(".nav a[href]").forEach(a=>{
    const href=(a.getAttribute("href")||"").split("#")[0].toLowerCase();
    if(href && href===page) a.classList.add("active");
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


// Keep public release information synced to GitHub. There is intentionally NO
// static version/checksum fallback: a sync failure must be visible instead of
// silently showing stale release information.
(()=>{
  const versionEls=[...document.querySelectorAll("[data-release-version], #latest-version, #verify-version, #hash-match-version")];
  const installerLink=document.getElementById("latest-installer");
  if(!versionEls.length&&!installerLink)return;
  const releasePage=document.getElementById("latest-release-page");
  const installerHash=document.getElementById("installer-hash");
  const installerHashRow=document.getElementById("installer-hash-row");
  const installedExeRow=document.getElementById("installed-exe-hash-row");
  const installerVt=document.getElementById("installer-vt");
  const installedExeVt=document.getElementById("installed-exe-vt");
  const note=document.getElementById("release-sync-note");
  const filenameEl=document.getElementById("installer-filename");
  const hashCommand=document.getElementById("hash-command");
  const hashCopy=document.getElementById("hash-copy");

  const setVersions=text=>versionEls.forEach(el=>el.textContent=text);
  const showNote=(text,isError=false)=>{
    if(!note)return;
    note.hidden=false;
    note.textContent=text;
    note.dataset.syncError=isError?"true":"false";
  };

  fetch("https://api.github.com/repos/Nyxia-Code/Aetheris/releases/latest",{
    headers:{Accept:"application/vnd.github+json"},cache:"no-store"
  })
    .then(async r=>{
      if(!r.ok){
        const remaining=r.headers.get("x-ratelimit-remaining");
        throw new Error(`GitHub API returned HTTP ${r.status}${remaining!==null?` (rate-limit remaining: ${remaining})`:""}`);
      }
      return r.json();
    })
    .then(release=>{
      const assets=Array.isArray(release.assets)?release.assets:[];
      const installer=assets.find(a=>/aetheris.*setup.*\.exe$/i.test(a.name||"")) || assets.find(a=>/\.exe$/i.test(a.name||""));
      const tagMatch=String(release.tag_name||"").match(/(\d+\.\d+\.\d+)/);
      if(!tagMatch)throw new Error(`Latest GitHub release has an unreadable tag: ${release.tag_name||"(missing)"}`);
      const version=`v${tagMatch[1]}`;
      setVersions(version);

      if(releasePage&&release.html_url)releasePage.href=release.html_url;
      if(installerLink){
        if(installer&&installer.browser_download_url){
          installerLink.href=installer.browser_download_url;
          installerLink.textContent=`Download ${version} installer ↗`;
        }else if(release.html_url){
          installerLink.href=release.html_url;
          installerLink.textContent=`Open ${version} release ↗`;
        }
      }
      if(installer){
        if(filenameEl)filenameEl.textContent=installer.name;
        const cmd=`Get-FileHash ".\\${installer.name}" -Algorithm SHA256`;
        if(hashCommand)hashCommand.textContent=cmd;
        if(hashCopy)hashCopy.dataset.copy=cmd;
      }

      const digest=installer&&typeof installer.digest==="string"&&installer.digest.toLowerCase().startsWith("sha256:")
        ? installer.digest.slice(7).toUpperCase():"";
      if(installerHash)installerHash.textContent=digest||"Not published by GitHub for this installer";
      if(installerHashRow)installerHashRow.hidden=false;
      if(installerVt){
        installerVt.hidden=!digest;
        if(digest)installerVt.href=`https://www.virustotal.com/gui/file/${digest}`;
      }

      const body=String(release.body||"");
      const exeMatch=body.match(/Installed\s+EXE(?:\s+SHA-?256)?[\s\S]{0,160}?\b([A-Fa-f0-9]{64})\b/i);
      const exeDigest=exeMatch?exeMatch[1].toUpperCase():"";
      if(installedExeRow){
        installedExeRow.hidden=false;
        const code=installedExeRow.querySelector("code");
        if(code)code.textContent=exeDigest||"Not found in GitHub release notes";
      }
      if(installedExeVt){
        installedExeVt.hidden=!exeDigest;
        if(exeDigest)installedExeVt.href=`https://www.virustotal.com/gui/file/${exeDigest}`;
      }
      showNote(`Live GitHub sync OK — ${version} (${release.tag_name}).`);
      console.info("[Aetheris release sync]",{version,tag:release.tag_name,installer:installer&&installer.name,installerDigest:!!digest,installedExeDigest:!!exeDigest});
    })
    .catch(err=>{
      setVersions("SYNC FAILED");
      if(installerHash)installerHash.textContent="Release sync failed";
      if(installedExeRow){
        installedExeRow.hidden=false;
        const code=installedExeRow.querySelector("code");
        if(code)code.textContent="Release sync failed";
      }
      if(installerVt)installerVt.hidden=true;
      if(installedExeVt)installedExeVt.hidden=true;
      showNote(`GitHub release sync failed: ${err.message}`,true);
      console.error("[Aetheris release sync]",err);
    });
})();

