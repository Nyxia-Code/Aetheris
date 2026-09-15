document.getElementById("year").textContent = new Date().getFullYear();
const apiStatus=document.getElementById("api-status");if(apiStatus){fetch("https://api.aetherisbot.club/health",{cache:"no-store"}).then(r=>{if(!r.ok)throw new Error();return r.json()}).then(d=>{if(d&&d.ok){apiStatus.textContent="OPERATIONAL";apiStatus.className="status ok"}else throw new Error()}).catch(()=>{apiStatus.textContent="UNREACHABLE";apiStatus.className="status bad"});}
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
