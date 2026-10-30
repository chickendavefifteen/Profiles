/* Profiles v3 frontend — chat-first canvas: blank box + panes you align.
   Lite agent ALWAYS ON (local sidecar); answers land in chat, the Pi-loop
   detail lives in the Agent pane. Pack-wired, governor-enforced. */
"use strict";
window.__profilesUiLoaded=new Date().toISOString().slice(11,16)+" UTC";
function $(id){ return document.getElementById(id); }
function apiBase(){
  try{
    var hub=(localStorage.getItem("profilesHub")||"").replace(/\/$/,"");
    if(hub) return hub;
  }catch(e){}
  /* Tauri/release + file origins have no /api of their own: the sidecar
     lives on localhost:1420 (dev) — without this, release builds looked
     "agent offline" while the sidecar was fine. */
  if(location.protocol==="tauri:" || location.protocol==="file:" || /^tauri/.test(location.hostname||"")) return "http://localhost:1420";
  return "";
}
function apiUrl(p){ return apiBase()+p; }
if("serviceWorker" in navigator){ navigator.serviceWorker.register("./sw.js").catch(function(){}); }
function now(){ var d=new Date(); return d.toTimeString().slice(0,8); }

var MODE_ORDER=["babylite","chill","FOCUSMAX","Vibes","calm","xMAX"];
var MODE_ALIASES={lite:"babylite",focus:"FOCUSMAX",focused:"FOCUSMAX",lifeful:"Vibes",vibes:"Vibes",dev:"Vibes","low-sensory":"calm",lowsensory:"calm",xmax:"xMAX",XMAX:"xMAX"};
function canonicalMode(id){
  if(!id) return null;
  if(MODE_ORDER.indexOf(id)>=0) return id;
  var lower=String(id).toLowerCase();
  for(var i=0;i<MODE_ORDER.length;i++){ if(MODE_ORDER[i].toLowerCase()===lower) return MODE_ORDER[i]; }
  if(MODE_ALIASES[id]) return MODE_ALIASES[id];
  if(MODE_ALIASES[lower]) return MODE_ALIASES[lower];
  return null;
}
var MODES={
  babylite:{label:"babylite · soft + simple",   motion:60, sim:1, tick:900,  speech:"terse",
             note:"babylite — soft baby-blue, big targets, one thing, always asks. Governor: motion 60%, 1 simultaneous, flash 0/s (capped). Agent simple/asks-first, parallelism 1."},
  chill:   {label:"chill · warm and slow",      motion:35, sim:1, tick:2600, speech:"sparse",
             note:"chill — warm, slow, rest reminders. Governor: motion 35%, 1 simultaneous, flash 0/s (capped). Agent brief/checkpointed, parallelism 1."},
  FOCUSMAX:{label:"FOCUSMAX · mono-task",       motion:10, sim:1, tick:1000, speech:"terse",
             note:"FOCUSMAX — mono-task, distractions held. Governor: motion 10%, 1 simultaneous, flash 0/s (capped). Agent terse/suggest-only, parallelism 1."},
  Vibes:   {label:"Vibes · full energy",        motion:100,sim:4, tick:700,  speech:"full",
             note:"Vibes — fun, fluent, energetic, parallel agent, proactive, checkpointed before anything irreversible. Governor: motion 100%, 4 simultaneous, flash 0/s (capped). Agent detailed/act-with-checkpoint, parallelism 4."},
  calm:    {label:"calm · sensory panic button",motion:0,  sim:0, tick:4200, speech:"quiet",
             note:"calm — sensory panic button: motion stops, palette softens, agent terse and mono-task. Governor: motion 0%, 0 simultaneous, flash 0/s (capped). Agent terse/suggest-only, parallelism 1."},
  xMAX:    {label:"xMAX · parallel storm",      motion:100,sim:6, tick:450,  speech:"full",
             note:"xMAX — Vibes + FOCUSMAX hybrid: crisp, quick, heavy parallelism (Profile X only). Governor: motion 100%, 6 simultaneous, flash 0/s (capped). Agent detailed/act-with-checkpoint, parallelism 6."}
};
/* legacy aliases so old deep-links / saved metaMode values keep resolving */
MODES.lite=MODES.babylite; MODES.focus=MODES.FOCUSMAX; MODES.lifeful=MODES.Vibes; MODES["low-sensory"]=MODES.calm; MODES.dev=MODES.Vibes;
var ROUTING={babylite:"muse-spark-1.3-contributor",chill:"muse-spark-1.3-contributor",
  FOCUSMAX:"muse-spark-1.3-contributor",Vibes:"muse-spark-1.3-contributor",calm:null,xMAX:"muse-spark-1.3-contributor"};
ROUTING.lite=ROUTING.babylite; ROUTING.focus=ROUTING.FOCUSMAX; ROUTING.lifeful=ROUTING.Vibes; ROUTING["low-sensory"]=ROUTING.calm; ROUTING.dev=ROUTING.Vibes;
var livePacks={};
var BUDDIES={fox:"🦊",turtle:"🐢",rocket:"🚀",leaf:"🌿",cat:"🐱"};
var AVATAR_PATHS={
  person:"M12 3a4.2 4.2 0 1 1 0 8.4A4.2 4.2 0 0 1 12 3zm0 9.6c4.2 0 8.4 2.1 8.4 5.2V21H3.6v-3.2c0-3.1 4.2-5.2 8.4-5.2z",
  fox:"M4.5 3.5 9 6.2 12 4.4l3 1.8 4.5-2.7-1.2 7.2c-.6 4.4-3.1 7.3-6.3 7.3s-5.7-2.9-6.3-7.3L4.5 3.5z",
  turtle:"M2.5 16.5a9.5 6.5 0 0 1 19 0v1.5h-19v-1.5zm15-7.2 3.4-2.4 1 2.9-3.2 1.6-1.2-2.1zM6 20.5h2.2v1.5H6zm10 0h2.2v1.5H16z",
  rocket:"M12 1.8c3.1 2.1 4.4 6 4.4 9.4l2.8 3.9-4-.9a8.2 8.2 0 0 1-6.4 0l-4 .9 2.8-3.9c0-3.4 1.3-7.3 4.4-9.4zM12 8.2a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  leaf:"M20.2 3.8C10.4 3.8 4 10.2 3.8 20.2 13.8 20 20.2 13.6 20.2 3.8z",
  cat:"M5 2.8 9 5.6h6L19 2.8l1.1 6.1c.9 5.4-2.9 10.3-8.1 10.3S3 14.3 3.9 8.9L5 2.8z",
  robot:"M11 2h2v3h-2zM7.5 5h9A3.5 3.5 0 0 1 20 8.5v7A3.5 3.5 0 0 1 16.5 19h-9A3.5 3.5 0 0 1 4 15.5v-7A3.5 3.5 0 0 1 7.5 5zM2.8 10h1.7v5H2.8zm17.5 0h1.7v5h-1.7z",
  skull:"M12 1.8A8.2 8.2 0 0 1 20.2 10c0 2.9-.9 4.9-1.9 6v3.6h-3.8v-2.9h-4.9v2.9H5.7V16c-1-1.1-1.9-3.1-1.9-6A8.2 8.2 0 0 1 12 1.8z"
};
function setAvatar(buddy){
  var p=$("avatarPath"); if(!p) return;
  p.setAttribute("d", AVATAR_PATHS[buddy] || AVATAR_PATHS.person);
  var av=document.querySelector(".avatarCircle"); if(av) av.title="";
}
var state={mode:"Vibes", routing:false, auto:false, agentOk:false, timer:null, modeSince:Date.now(), suggestChecked:false, slot:"A", layout:{order:null,hidden:["pane-agent","pane-doc","pane-notes","pane-video","pane-setup","pane-activity"],maxed:null},
  stage:-1, runCount:0, bg:0, switches:[], cfg:null, speak:false, setupPlan:null};

/* ---- canvas v4: seamless drag-snap tiling + browser-style pane tabs ---- */
var PANES=["pane-chat","pane-agent","pane-browser","pane-doc","pane-notes","pane-video","pane-setup","pane-activity"];
var PANE_LABELS={"pane-chat":"Chat","pane-agent":"Agent detail","pane-browser":"Browser","pane-doc":"Document","pane-notes":"Notes","pane-video":"Video","pane-setup":"Setup","pane-activity":"Activity"};
var PANE_ICONS={"pane-chat":'<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="4"/><path d="M8 17l-3 4v-4"/></svg>',
"pane-agent":'<svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>',
"pane-browser":'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="3.8" ry="8.5"/><path d="M3.5 12h17"/></svg>',
"pane-doc":'<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/></svg>',
"pane-notes":'<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
"pane-video":'<svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/></svg>',
"pane-setup":'<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="17" r="2"/></svg>',
"pane-activity":'<svg viewBox="0 0 24 24"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>'};
function paneVisible(id){ return state.layout.hidden.indexOf(id)<0; }
var MAX_PER_PAGE=8;
function visibleCount(){ return PANES.filter(paneVisible).length; }
function applyLayout(){
  var canvas=$("canvas");
  if(visibleCount()>MAX_PER_PAGE){
    bubble("That is 8 panes on this page — I opened a fresh page for the rest (pages keep a canvas uncluttered; your agent can re-organise any time).", "sys");
  }
  var order=state.layout.order||PANES;
  order.forEach(function(id){ canvas.appendChild($(id)); });
  var sizes=state.layout.sizes||{};
  PANES.forEach(function(id){
    $(id).classList.toggle("hiddenPane", !paneVisible(id));
    $(id).classList.toggle("maxedPane", state.layout.maxed===id);
    /* pinned sizes persist per profile: re-apply, clear when never sized */
    var sz=sizes[id];
    $(id).style.width=""; /* widths are flex shares now, never px (px underlapped neighbours) */
    if(sz && sz.h>0){ $(id).style.height=sz.h+"px"; } else { $(id).style.height=""; }
    var g=state.layout.cols && state.layout.cols[id];
    if(g) $(id).style.flex=g+" 1 320px";
  });
  canvas.classList.toggle("maxed", !!state.layout.maxed);
  renderPaneTabs();
  persistLayout();
}
function renderPaneTabs(){
  var bar=$("paneTabs"); if(!bar) return;
  bar.textContent="";
  (state.layout.order||PANES).forEach(function(id){
    if(!paneVisible(id)) return;
    var b=document.createElement("button"); b.type="button"; b.title=PANE_LABELS[id]; b.setAttribute("aria-label",PANE_LABELS[id]);
    var lab=document.createElement("span"); lab.className="paneicon"; lab.innerHTML=PANE_ICONS[id]||PANE_LABELS[id];
    var x=document.createElement("span"); x.className="x"; x.textContent="×"; x.title="Close pane (reopen any time)";
    x.addEventListener("click", function(ev){ ev.stopPropagation(); hidePane(id); });
    b.appendChild(lab); b.appendChild(x);
    b.addEventListener("click", function(){ focusPane(id); });
    b.addEventListener("dblclick", function(){ toggleMax(id); });
    bar.appendChild(b);
  });
  var add=document.createElement("button"); add.type="button"; add.textContent="+";
  add.title="Add a pane"; add.setAttribute("aria-label","Add a pane");
  add.style.cssText="font-weight:900;font-size:1.25rem;line-height:1;padding:6px 15px";
  add.addEventListener("click", function(e){
    e.stopPropagation();
    var menu=$("addMenu"), open=menu.hidden;
    document.querySelectorAll(".pane").forEach(function(){});
    if(open){
      var r=add.getBoundingClientRect();
      menu.style.left=Math.min(r.left, innerWidth-290)+"px";
      menu.style.top=(r.bottom+8+scrollY)+"px";
      menu.hidden=false;
    } else menu.hidden=true;
  });
  bar.appendChild(add);
}
function focusPane(id){
  showPaneEl(id, true);
  var el=$(id);
  el.scrollIntoView({behavior: state.mode==="calm" ? "auto":"smooth", block:"nearest"});
  el.classList.add("dropHint");
  setTimeout(function(){ el.classList.remove("dropHint"); }, 700);
}
/* Recently closed: bottom-right bin. Retention is dumb-simple on
   purpose: newest 12 AND younger than 14 days, per profile. Older or
   overflow entries prune themselves next time anything closes. */
function pruneClosed(list){
  var cutoff=Date.now()-14*24*3600*1000;
  return (list||[]).filter(function(c){ return new Date(c.at).getTime()>cutoff; }).slice(-12);
}
function renderTrash(closed){
  var btn=$("trashBtn"), pop=$("trashPop"), listEl=$("trashList"), count=$("trashCount");
  if(!btn) return;
  closed=pruneClosed(closed||(state.cfg&&state.cfg.closedPanes)||[]);
  count.hidden=closed.length===0;
  count.textContent=closed.length||"";
  btn.style.opacity=closed.length? "1":"0.55";
  listEl.textContent="";
  if(!closed.length){ var p=document.createElement("p"); p.className="small"; p.textContent="Nothing in the bin. Closed panes land here, recoverable."; listEl.appendChild(p); }
  closed.slice().reverse().forEach(function(c){
    var b=document.createElement("button"); b.type="button";
    var when=new Date(c.at);
    b.textContent=c.title+" · "+when.toLocaleDateString()+" "+when.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})+" · recover";
    b.addEventListener("click", function(){
      var left=pruneClosed(((state.cfg&&state.cfg.closedPanes)||[]).filter(function(x){ return !(x.id===c.id && x.at===c.at); }));
      postConfig({slot:{closedPanes:left}});
      renderTrash(left);
      showPaneEl(c.id);
    });
    listEl.appendChild(b);
  });
}
if($("trashBtn")) $("trashBtn").addEventListener("click", function(){
  var pop=$("trashPop");
  pop.hidden=!pop.hidden;
  if(!pop.hidden) renderTrash();
});
document.querySelectorAll("[data-close]").forEach(function(b){
  b.addEventListener("click", function(){ hidePane(b.dataset.close); });
});
document.querySelectorAll("[data-min]").forEach(function(b){
  b.addEventListener("click", function(){
    var p=$(b.dataset.min);
    p.classList.toggle("minimised");
    b.textContent=p.classList.contains("minimised")?"+":"–";
  });
});
/* Pixel-definite view height: this engine resolves iframe percentages
   against thin air (300x150 default), so the pane measures real pixels
   and sets them explicitly. No percentages left to misread. */
function fitBrowserView(){
  var pane=$("pane-browser"), view=$("browserView");
  if(!pane || !view) return;
  var ph=pane.getBoundingClientRect().height;
  if(ph<120) return;
  var used=0;
  Array.prototype.forEach.call(pane.children, function(el){
    if(el!==view){ var r=el.getBoundingClientRect(); used+=r.height; }
  });
  var want=Math.max(160, Math.round(ph-used-28));
  var cur=parseInt(view.style.height||"0", 10);
  if(Math.abs(want-cur)>2) view.style.height=want+"px";
  /* belt and braces: HTML width/height attributes are honored even where
     CSS sizing misbehaves — set them to the same measured pixels */
  var fr=$("browserFrame");
  if(fr){
    var vw=Math.round(view.getBoundingClientRect().width);
    var vh=Math.round(view.getBoundingClientRect().height);
    if(vw>50) fr.setAttribute("width", String(vw));
    if(vh>50) fr.setAttribute("height", String(vh));
    /* viewport-stuck guard: this engine can freeze an iframe viewport at
       first-paint size; a same-origin read proves it, one reload heals it */
    try{
      var iw=fr.contentWindow.innerWidth||0;
      if(vw>50 && Math.abs(iw-vw)>8){
        fr.contentWindow.dispatchEvent(new fr.contentWindow.Event("resize"));
      }
    }catch(e){}
  }
}
if(window.ResizeObserver){
  new ResizeObserver(function(){ fitBrowserView(); }).observe(document.body);
}
/* Zoom: Ctrl/Cmd + wheel (trackpad pinch sends the same) scales the whole
   app for readability; pages inside the browser pane zoom natively.
   Per-device (localStorage), 50–200%, Ctrl+0 resets. */
var appZoom=1;
var paneZoom={};
try{ appZoom=Math.min(2, Math.max(0.5, Number(localStorage.getItem("profilesZoom")||1)||1)); }catch(e){}
try{ paneZoom=JSON.parse(localStorage.getItem("profilesPaneZoom")||"{}")||{}; }catch(e){ paneZoom={}; }
function paneEl(id){ return document.getElementById(id); }
function applyPaneZoom(id, showBadge){
  var z=paneZoom[id]||1;
  var el=paneEl(id);
  if(el) el.style.zoom=z;
  try{ localStorage.setItem("profilesPaneZoom", JSON.stringify(paneZoom)); }catch(e){}
  if(showBadge) zoomBadge((PANE_LABELS[id]||id)+" "+Math.round(z*100)+"%");
}
function applyAllPaneZooms(){ Object.keys(paneZoom).forEach(function(id){ applyPaneZoom(id, false); }); }
function applyZoom(showBadge){
  document.body.style.zoom=appZoom;
  try{ localStorage.setItem("profilesZoom", String(appZoom)); }catch(e){}
  if(showBadge) zoomBadge(Math.round(appZoom*100)+"%");
}
function zoomBadge(text){
  var b=$("zoomBadge"); if(!b) return;
  b.textContent=text;
  b.hidden=false;
  clearTimeout(b._t);
  b._t=setTimeout(function(){ b.hidden=true; }, 1200);
}
document.addEventListener("wheel", function(e){
  if(!(e.ctrlKey||e.metaKey)) return;
  var t=e.target;
  var pane=t && t.closest ? t.closest(".pane") : null;
  if(pane && pane.id==="pane-browser") return; /* pages zoom natively */
  e.preventDefault();
  var d=e.deltaY<0?0.1:(e.deltaY>0?-0.1:0);
  if(!d) return;
  if(pane && pane.id){
    var z=Math.min(2, Math.max(0.5, Math.round(((paneZoom[pane.id]||1)+d)*10)/10));
    paneZoom[pane.id]=z;
    applyPaneZoom(pane.id, true);
  } else {
    appZoom=Math.min(2, Math.max(0.5, Math.round((appZoom+d)*10)/10));
    applyZoom(true);
  }
}, {passive:false});
document.addEventListener("keydown", function(e){
  if(!(e.ctrlKey||e.metaKey)) return;
  if(e.key!=="0" && e.key!=="=" && e.key!=="+" && e.key!=="-" && e.key!=="_") return;
  var t=e.target;
  if(t && (t.tagName==="INPUT"||t.tagName==="TEXTAREA"||t.tagName==="SELECT")) return;
  e.preventDefault();
  if(e.key==="0"){ appZoom=1; paneZoom={}; applyAllPaneZooms(); try{ localStorage.setItem("profilesPaneZoom","{}"); }catch(e2){} }
  else if(e.key==="-"||e.key==="_") appZoom=Math.max(0.5,appZoom-0.1);
  else appZoom=Math.min(2,appZoom+0.1);
  applyZoom(true);
});
applyZoom(false);
window.addEventListener("resize", function(){ setTimeout(fitBrowserView, 120); });
function showPaneEl(id, silent){
  if(id==="pane-browser"){ nudgeSoon(500); setTimeout(fitBrowserView, 150); }
  state.layout.hidden=state.layout.hidden.filter(function(x){ return x!==id; });
  if(state.layout.maxed && state.layout.maxed!==id) state.layout.maxed=null;
  applyLayout();
  if(id==="pane-doc") loadStaged();
  if(id==="pane-setup") loadSetup();
}
function hidePane(id){
  /* everything closable now — including chat. Tabs + Recently closed recover it. */
  var closed=(state.cfg&&state.cfg.closedPanes)||[];
  if(!closed.some(function(c){ return c.id===id; })){
    closed.push({id:id, title:PANE_LABELS[id], at:new Date().toISOString()});
    postConfig({slot:{closedPanes:pruneClosed(closed)}});
  }
  renderTrash(closed);
  if(state.layout.hidden.indexOf(id)<0) state.layout.hidden.push(id);
  if(state.layout.maxed===id) state.layout.maxed=null;
  applyLayout();
}
function toggleMax(id){
  state.layout.maxed = state.layout.maxed===id ? null : id;
  applyLayout();
}
function showPane(id){ focusPane(id); }
document.querySelectorAll("[data-add]").forEach(function(b){
  b.addEventListener("click", function(){
    $("addMenu").hidden=true;
    showPaneEl(b.dataset.add);
    focusPane(b.dataset.add);
  });
});
document.addEventListener("pointerdown", function(e){
  if(!$("addMenu").hidden && !e.target.closest("#addMenu") && e.target.textContent!=="+") $("addMenu").hidden=true;
}, true);
document.querySelectorAll("[data-focus]").forEach(function(b){
  b.addEventListener("click", function(){ toggleMax(b.dataset.focus); });
});
/* customise lives in the brand menu now (no header cog) */
$("brandMenuBtn").addEventListener("click", function(){
  var m=$("brandMenu"), open=m.hidden;
  m.hidden=!open;
  $("brandMenuBtn").setAttribute("aria-expanded", open?"true":"false");
});
document.querySelectorAll("[data-menu]").forEach(function(b){
  b.addEventListener("click", function(){
    $("brandMenu").hidden=true;
    focusPane("pane-setup");
    if(b.dataset.menu==="about") bubble("Profiles — one calm front door over your agent, browser and work apps. A/B/C are the designed experience; X (Settings › Profiles) is the full-access power world. Everything local, per-profile, resettable.", "agent");
  });
});
document.addEventListener("pointerdown", function(e){
  if(!$("brandMenu").hidden && !e.target.closest("#brandMenu") && !e.target.closest("#brandMenuBtn")) $("brandMenu").hidden=true;
}, true);

/* Universal outside-click dismissal: ONE rule for every popup, menu, chip
   selector and preview. Open popups: #addMenu, #brandMenu, #trashPop.
   Clicking (left button, any device pointer) anywhere outside the open popup
   AND outside its trigger dismisses it immediately. Escape closes all.
   Triggers are exempt so toggle-clicks still work; everything else lands here. */
function dismissAllPopups(){
  var changed=false;
  [["addMenu"],["brandMenu"],["trashPop"]].forEach(function(pair){
    var el=$(pair[0]);
    if(el && !el.hidden){ el.hidden=true; changed=true; }
  });
  var bm=$("brandMenuBtn");
  if(bm && changed) bm.setAttribute("aria-expanded","false");
  return changed;
}
function popupDismissForEvent(e){
  if(e.button!==undefined && e.button!==0 && e.type.indexOf("key")!==0) return;
  var t=e.target;
  var inAdd=t.closest && t.closest("#addMenu");
  var addTrigger=t.closest && t.closest("#paneTabs") && t.textContent==="+";
  var inBrand=t.closest && t.closest("#brandMenu");
  var brandTrigger=t.closest && t.closest("#brandMenuBtn");
  var inTrash=t.closest && t.closest("#trashPop");
  var trashTrigger=t.closest && t.closest("#trashBtn");
  var add=$("addMenu"), brand=$("brandMenu"), trash=$("trashPop");
  if(add && !add.hidden && !inAdd && !addTrigger) add.hidden=true;
  if(brand && !brand.hidden && !inBrand && !brandTrigger){
    brand.hidden=true;
    var bb=$("brandMenuBtn"); if(bb) bb.setAttribute("aria-expanded","false");
  }
  /* recycle bin preview: clicking anywhere outside dismisses immediately */
  if(trash && !trash.hidden && !inTrash && !trashTrigger) trash.hidden=true;
}
document.addEventListener("pointerdown", popupDismissForEvent, true);
document.addEventListener("keydown", function(e){
  if(e.key==="Escape") dismissAllPopups();
});

/* pin-to-move+resize: 📌 unlocks a pane, drag to move, drag any edge/border to
   resize (left button), click 📌 again or anywhere outside to land + re-pin */
(function pinTiles(){
  var unpinned=null, dragId=null, startX=0, startY=0, moved=false;
  var resizing=null; /* {id, dir, startX, startY, startW, startH} while edge-dragging */
  var EDGE=34, MIN_W=280, MIN_H=180; /* 34px grab zone: no pixel-hunting */
  var CURSORS={e:"ew-resize",w:"ew-resize",n:"ns-resize",s:"ns-resize",
    ne:"nesw-resize",sw:"nesw-resize",nw:"nwse-resize",se:"nwse-resize"};
  function flip(mutate){
    var rects={};
    PANES.forEach(function(id){ rects[id]=$(id).getBoundingClientRect(); });
    mutate();
    PANES.forEach(function(id){
      var el=$(id), r=rects[id], n=el.getBoundingClientRect();
      var dx=r.left-n.left, dy=r.top-n.top;
      if(dx||dy){ el.style.transform="translate("+dx+"px,"+dy+"px)"; el.style.transition="none";
        requestAnimationFrame(function(){ el.style.transition="transform .3s cubic-bezier(.22,1,.36,1)"; el.style.transform=""; }); }
    });
  }
  function rememberSize(id){
    var el=$(id); if(!el) return;
    var r=el.getBoundingClientRect();
    state.layout.sizes=state.layout.sizes||{};
    state.layout.sizes[id]={w:Math.round(r.width), h:Math.round(r.height)};
  }
  function applyResize(el, dir, dx, dy, startW, startH){
    /* Horizontal: grow/shrink THIS pane's flex share; neighbours in the
       row adapt (that is the whole point of flex). Never a fixed px
       width — that is what underlapped the next pane. */
    if(dir.indexOf("e")>=0 || dir.indexOf("w")>=0){
      var delta=(dir.indexOf("e")>=0 ? dx : -dx);
      var grow=Math.max(.45, Math.min(4.2, (startW+delta)/420));
      el.style.flex=grow.toFixed(2)+" 1 320px";
      state.layout.cols=state.layout.cols||{};
      state.layout.cols[el.id]=Number(grow.toFixed(2));
    }
    var h=startH;
    if(dir.indexOf("s")>=0) h=startH+dy;
    if(dir.indexOf("n")>=0) h=startH-dy;
    h=Math.max(MIN_H, Math.min(h, Math.max(MIN_H, innerHeight-40)));
    if(dir.indexOf("s")>=0 || dir.indexOf("n")>=0) el.style.height=h+"px";
    var r=el.getBoundingClientRect();
    return {w:Math.round(r.width), h:Math.round(r.height)};
  }
  /* which border zone (if any) is this left-button point on? */
  function edgeDir(pane, clientX, clientY){
    var r=pane.getBoundingClientRect();
    var dl=clientX-r.left, dr=r.right-clientX, dt=clientY-r.top, db=r.bottom-clientY;
    if(dl<0||dr<0||dt<0||db<0) return "";
    var w=dl<EDGE, e=dr<EDGE, n=dt<EDGE, s=db<EDGE;
    if(n&&w) return "nw"; if(n&&e) return "ne"; if(s&&w) return "sw"; if(s&&e) return "se";
    if(w) return "w"; if(e) return "e"; if(n) return "n"; if(s) return "s";
    return "";
  }
  function isInteractive(t){
    return !!(t && t.closest && t.closest("button,a,input,select,textarea,iframe,video,.resize-handle"));
  }
  function addHandles(pane){
    removeHandles(pane);
    ["n","s","e","w","ne","nw","se","sw"].forEach(function(dir){
      var h=document.createElement("div");
      h.className="resize-handle"; h.dataset.dir=dir;
      h.setAttribute("aria-hidden","true");
      h.addEventListener("pointerdown", function(e){
        if(e.button!==undefined && e.button!==0) return; /* left button only */
        e.preventDefault(); e.stopPropagation();
        startResize(pane, dir, e);
      });
      pane.appendChild(h);
    });
  }
  function removeHandles(pane){
    Array.prototype.slice.call(pane.querySelectorAll(".resize-handle")).forEach(function(h){ h.remove(); });
  }
  function startResize(pane, dir, e){
    var r=pane.getBoundingClientRect();
    resizing={id:pane.id, dir:dir, startX:e.clientX, startY:e.clientY, startW:r.width, startH:r.height};
    dragId=null;
    try{ pane.setPointerCapture(e.pointerId); }catch(err){}
    pane.style.cursor=CURSORS[dir]||"nwse-resize";
  }
  function land(){
    if(resizing){ /* finish an in-flight resize first, keep the size */
      var rid=resizing.id; resizing=null;
      rememberSize(rid);
    }
    if(!unpinned) return;
    var el=$(unpinned);
    removeHandles(el);
    el.style.cursor="";
    rememberSize(unpinned);
    el.classList.remove("unpinned");
    bubble(PANE_LABELS[unpinned]+" pinned there. Layout remembered for this profile.", "sys");
    stream("layout — "+unpinned+" re-pinned by hand");
    unpinned=null; dragId=null;
    state.layout.order=Array.prototype.slice.call($("canvas").children).map(function(el){ return el.id; })
      .filter(function(id){ return PANES.indexOf(id)>=0; });
    applyLayout();
  }
  document.querySelectorAll(".pane").forEach(function(pane){
    var pin=pane.querySelector(".pinbtn");
    if(pin){ pin.title="Pin: click to unlock and move/resize this pane"; pin.setAttribute("aria-label","Pin or unpin pane");
    pin.addEventListener("click", function(e){
      e.stopPropagation();
      if(unpinned===pane.id){ land(); return; }
      if(unpinned) land();
      unpinned=pane.id;
      moved=false; dragId=null; resizing=null;
      pane.classList.add("unpinned");
      addHandles(pane);
      bubble(PANE_LABELS[pane.id]+" unlocked — drag to move, or left-drag any edge/border to resize smoothly. Click 📌 again (or anywhere outside) to lock it in.", "sys");
    }); }
    /* border resize takes precedence over move: left-button press on any
       edge/border of the highlighted box starts a smooth drag-resize */
    pane.addEventListener("pointerdown", function(e){
      if(unpinned!==pane.id || resizing) return;
      if(e.button!==undefined && e.button!==0) return; /* left button only */
      if(e.target!==pane && isInteractive(e.target) && !e.target.classList.contains("panehead")){
        /* let buttons/inputs/links work normally — except a bare edge click */
        if(!e.target.classList.contains("resize-handle") && !edgeDir(pane, e.clientX, e.clientY)) return;
        if(e.target.closest("button,a,input,select,textarea") && !e.target.classList.contains("resize-handle")) return;
      }
      var dir=edgeDir(pane, e.clientX, e.clientY);
      if(dir){ e.preventDefault(); startResize(pane, dir, e); }
    });
    /* as soon as the pin is clicked the pane is LIVE: just moving the
       mouse (no holding) glides it across its neighbours; click lands it.
       While edge-resizing, the same motion resizes instead of moving. */
    pane.addEventListener("pointermove", function(e){
      if(unpinned!==pane.id) return;
      if(resizing && resizing.id===pane.id){
        var dx=e.clientX-resizing.startX, dy=e.clientY-resizing.startY;
        applyResize(pane, resizing.dir, dx, dy, resizing.startW, resizing.startH);
        return;
      }
      if((!e.buttons || (e.buttons&1)===0) && (!e.pointerType || e.pointerType==="mouse")){
        /* hover affordance: show the resize cursor on any edge/border */
        var hov=(!e.target.classList || isInteractive(e.target)) ? "" : edgeDir(pane, e.clientX, e.clientY);
        pane.style.cursor=hov ? (CURSORS[hov]||"nwse-resize") : "";
      }
      dragId=pane.id;
      if(!moved){ startX=e.clientX; startY=e.clientY; moved=true; }
      if(!moved && Math.hypot(e.clientX-startX, e.clientY-startY)<7) return;
      moved=true;
      var under=document.elementFromPoint(e.clientX, e.clientY);
      var target=under && under.closest ? under.closest(".pane") : null;
      if(target && target.id!==dragId && paneVisible(target.id)){
        var canvas=$("canvas");
        flip(function(){
          var children=Array.prototype.slice.call(canvas.children);
          var di=children.indexOf($(dragId)), ti=children.indexOf(target);
          canvas.insertBefore($(dragId), di<ti ? target.nextSibling : target);
        });
      }
    });
    pane.addEventListener("pointerup", function(e){
      if(resizing && resizing.id===pane.id){
        var done=resizing; resizing=null;
        pane.style.cursor="";
        try{ if(e && e.pointerId!==undefined && pane.releasePointerCapture) pane.releasePointerCapture(e.pointerId); }catch(err){}
        var r=pane.getBoundingClientRect();
        state.layout.sizes=state.layout.sizes||{};
        state.layout.sizes[pane.id]={w:Math.round(r.width), h:Math.round(r.height)};
        persistLayout();
        stream("layout — "+pane.id+" resized to "+Math.round(r.width)+"×"+Math.round(r.height));
        void done;
      }
      dragId=null;
    });
    pane.addEventListener("pointercancel", function(){ if(resizing && resizing.id===pane.id){ rememberSize(pane.id); resizing=null; pane.style.cursor=""; persistLayout(); } dragId=null; });
  });
  document.addEventListener("pointermove", function(e){
    if(!resizing) return;
    var el=$(resizing.id); if(!el) return;
    applyResize(el, resizing.dir, e.clientX-resizing.startX, e.clientY-resizing.startY, resizing.startW, resizing.startH);
  });
  document.addEventListener("pointerup", function(){
    if(!resizing) return;
    var el=$(resizing.id);
    var rid=resizing.id; resizing=null;
    if(el){ el.style.cursor=""; rememberSize(rid); }
    persistLayout();
  }, true);
  document.addEventListener("pointerdown", function(e){
    if(resizing) return; /* let the resize finish on pointerup, don't re-pin mid-drag */
    if(unpinned && !e.target.closest("#"+unpinned)) land();
  }, true);
})();

/* agent layout commands: "move browser next to chat", "maximise doc"… */
var PANE_WORDS={chat:"pane-chat",agent:"pane-agent",browser:"pane-browser",web:"pane-browser",doc:"pane-doc",document:"pane-doc",stage:"pane-doc",setup:"pane-setup",activity:"pane-activity",ledger:"pane-activity",notes:"pane-notes",note:"pane-notes",video:"pane-video"};
function layoutCommand(q){
  var m=q.toLowerCase();
  var verbMax=/\b(maximi[sz]e|fullscreen|focus on|open up)\b/.test(m);
  var verbHide=/\b(hide|close)\b/.test(m);
  var verbShow=/\b(show|open|bring)\b/.test(m);
  var found=null;
  Object.keys(PANE_WORDS).forEach(function(w){ if(new RegExp("\\b"+w+"\\b").test(m)) found=PANE_WORDS[w]; });
  if(!found) return false;
  if(verbHide){ hidePane(found); bubble("Closed the "+PANE_LABELS[found]+" pane — reopen it from + Pane any time.", "agent"); return true; }
  if(verbMax){ showPaneEl(found, true); state.layout.maxed=found; applyLayout(); bubble(PANE_LABELS[found]+" maximised. Double-click its tab to put it back in the tiles.", "agent"); return true; }
  if(verbShow || /\b(move|put|place|tile)\b/.test(m)){
    showPaneEl(found, true);
    state.layout.maxed=null;
    var order=(state.layout.order||PANES).filter(function(id){ return id!==found; });
    var chatIdx=order.indexOf("pane-chat");
    order.splice(chatIdx+1, 0, found);
    state.layout.order=order; applyLayout();
    focusPane(found);
    bubble(PANE_LABELS[found]+" is on the canvas, right next to Chat. Drag headers to fine-tune — tiles snap.", "agent");
    return true;
  }
  return false;
}
function persistLayout(){
  if(!state.cfg) return;
  fetch(apiUrl("/api/config"),{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({slot:{layout:state.layout}})}).catch(function(){});
}

/* ---- profiles: instant var swap, nothing reflows ---- */
function profileXOn(){ return state.slot==="X" || (state.appCfg && state.appCfg.showX); }
function setMode(mode, why, opts){
  mode=canonicalMode(mode)||mode;
  if(!MODES[mode]) return;
  if(mode==="xMAX" && !profileXOn()){
    bubble("xMAX lives inside Profile X only — turn on Profile X (Settings › Profiles) to unlock the parallel storm.", "sys");
    return;
  }
  var segway=opts&&opts.segway;
  if(segway){ document.body.classList.add("segwaying"); }
  if(invitesAllowed() || mode==="calm" || mode==="babylite" || mode==="chill"){
    var still=(mode==="calm"||mode==="babylite");
    document.body.classList.toggle("mode-cut", still);
    document.body.classList.toggle("mode-settle", mode==="chill");
    if(!still && mode!=="chill"){
      var vis=(state.layout.order||PANES).filter(paneVisible);
      vis.forEach(function(id, i){
        var el=$(id); if(!el) return;
        setTimeout(function(){ el.classList.add("celebrate"); setTimeout(function(){ el.classList.remove("celebrate"); }, 650); }, i*90);
      });
      var tabs=$("paneTabs"); if(tabs){ tabs.classList.add("shimmer"); setTimeout(function(){ tabs.classList.remove("shimmer"); }, 900); }
    }
    if(still || mode==="chill") setTimeout(function(){ document.body.classList.remove("mode-cut"); document.body.classList.remove("mode-settle"); }, 1300);
  }
  state.mode=mode;
  var m=MODES[mode];
  document.body.dataset.mode=mode;
  document.body.dataset.intensity = mode==="calm" ? "soft" : ((state.cfg&&state.cfg.intensity)||"full");
  document.body.classList.toggle("gov-freeze", m.motion===0);
  document.querySelectorAll(".pills button").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.profile===mode ? "true":"false");
  });
  document.body.style.setProperty("--motion-pct", m.motion+"%"); /* implied, unlabelled */
  $("govNote").textContent=m.note;
  stream("profile → "+m.label+(why?" ("+why+")":"")+" — budget motion "+m.motion+"%, flash 0/s, simult "+m.sim);
  updateModelLine();
  updateXmaxVisibility();
  learnStay(mode);
  if(segway){ setTimeout(function(){ document.body.classList.remove("segwaying"); }, 700); }
  if(why && why.indexOf("opening")!==0 && why.indexOf("pack engine")!==0 && why.indexOf("learned")!==0 && why.indexOf("adaptive")!==0) checkLearned();
}
function updateXmaxVisibility(){
  var btn=document.querySelector('.pills button[data-profile="xMAX"]');
  if(!btn) return;
  var on=profileXOn();
  btn.hidden=!on;
  if(!on && state.mode==="xMAX") setMode("Vibes","xMAX hidden — Profile X off, back to Vibes");
}
document.querySelectorAll(".pills button").forEach(function(b){
  b.addEventListener("click", function(){ setMode(b.dataset.profile, "you switched"); });
});
document.addEventListener("keydown", function(e){
  if(e.target && (e.target.tagName==="INPUT"||e.target.tagName==="TEXTAREA"||e.target.tagName==="SELECT")) return;
  if(e.metaKey||e.ctrlKey||e.altKey) return;
  var map={"1":"babylite","2":"chill","3":"FOCUSMAX","4":"Vibes","5":"calm","6":"xMAX"};
  if(map[e.key]){ setMode(map[e.key], "key "+e.key, {segway:true}); return; }
  var k=String(e.key||"").toLowerCase();
  var slotMap={a:"A",b:"B",c:"C",x:"X"};
  if(slotMap[k]){ switchSlot(slotMap[k]); stream("profile → "+slotMap[k]+" (key "+k+")"); return; }
  if(e.key==="/"){ e.preventDefault(); focusPane("pane-chat"); $("ask").focus(); }
});

/* ---- chat: answers are bubbles; agent log is detail ---- */
function clearThinking(){ var t=$("thinkingBubble"); if(t) t.remove(); }
function bubble(text, who){
  if(who==="agent") clearThinking();
  var d=document.createElement("div");
  d.className="bubble "+who;
  d.textContent=text;
  var log=$("chatLog");
  log.appendChild(d);
  while(log.children.length>60) log.removeChild(log.firstChild);
  log.scrollTop=log.scrollHeight;
  if(who==="agent" && state.speak) speakText(text);
}
var STAGES=["sense","plan","act","verify","remember"];
function paintStages(cur){
  document.querySelectorAll("#stages span").forEach(function(c){
    var i=STAGES.indexOf(c.dataset.stage);
    c.classList.toggle("hit", i===cur);
    c.classList.toggle("past", i<cur || cur===99);
  });
}
function logLine(text){
  var li=document.createElement("li");
  var t=document.createElement("time"); t.textContent=now();
  li.appendChild(t); li.appendChild(document.createTextNode(text));
  var log=$("agentLog");
  log.appendChild(li);
  while(log.children.length>40) log.removeChild(log.firstChild);
  log.scrollTop=log.scrollHeight;
}

/* simulated fallback (labelled) — only when the sidecar is unreachable */
/* Honest failure path: the agent NEVER fakes an answer. On a failed
   ask it says so, retries once by itself, and only then asks you to
   retry. Nothing is filed, nothing staged, no invented reply. */
var askRetries={};
function askFailed(q, err){
  clearThinking();
  paintStages(-1);
  $("agentStatus").classList.remove("working");
  var n=(askRetries[q]||0)+1; askRetries[q]=n;
  logLine("! ask failed ("+String((err&&err.message)||err||"unknown").slice(0,120)+") — attempt "+n);
  if(n<=1){
    $("agentStatusText").textContent="connection hiccup — retrying…";
    bubble("Connection hiccup — retrying your ask by itself…", "sys");
    setTimeout(function(){
      state.agentOk=true;
      runReal(q, true);
    }, 2500);
    return;
  }
  askRetries[q]=0; /* terminal: fresh budget for future asks */
  $("agentStatusText").textContent="idle — that ask did not go through";
  bubble("That one did not go through — the connection dropped it, and I did not file or stage anything. Tap Go again to retry.", "agent");
  stream("ask failed honestly — nothing filed, nothing faked");
}
/* ---- real sidecar: always on, chat-first ----
   Smooth by design: one in-flight ask at a time (abort + replace),
   30s timeout, busy lock on Go, tool results paint instantly. */
var askCtrl=null, askBusy=false;
function runReal(q, isRetry){
  state.runCount++;
  if(askCtrl){ try{ askCtrl.abort(); }catch(e){} }
  askCtrl=(typeof AbortController!=="undefined") ? new AbortController() : null;
  var askTimer=setTimeout(function(){ if(askCtrl){ try{ askCtrl.abort(); }catch(e){} } }, 30000);
  askBusy=true;
  var goBtn=$("askGo"); if(goBtn) goBtn.disabled=true;
  $("agentStatus").classList.add("working");
  $("agentStatusText").textContent="working on \u201c"+q+"\u201d — lite agent \u00b7 "+MODES[state.mode].label;
  paintStages(-1);
  logLine("\u2192 \u201c"+q+"\u201d \u00b7 "+MODES[state.mode].label+" \u00b7 lite agent");
  fetch(apiUrl("/api/ask"),{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({query:q,mode:state.mode,device:"desktop"}),signal:askCtrl?askCtrl.signal:undefined})
  .then(function(r){ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
  .then(function(res){
    clearTimeout(askTimer);
    askBusy=false; if(goBtn) goBtn.disabled=false;
    if(!res || !res.events){ throw new Error("bad agent reply"); }
    var i=0, tickMs=MODES[state.mode].motion===0?500:220;
    if(res.ui && res.ui.browser){ try{ browserShow(res.ui.browser, res.ui.browser.url); }catch(e){} }
    (function next(){
      if(i>=res.events.length){
        paintStages(99);
        $("agentStatus").classList.remove("working");
        $("agentStatusText").textContent="done \u2713 — answer in chat, detail here";
        askRetries[q]=0;
        bubble(res.chat || res.result || "Done.", "agent");
        if(res.ui && res.ui.showPane){
          showPaneEl(res.ui.showPane, true);
          if(!res.ui.browser) setTimeout(function(){ if(!browserLoaded) browserShow({ok:true, url:"https://www.bing.com"}); }, 600);
          else { try{ browserShow(res.ui.browser, res.ui.browser.url); }catch(e){} }
        }
        if(res.setup){ renderSetup(res.setup, res.capabilities); showPane("pane-setup"); }
        if(res.staged){ bubble("Staged \u201c"+res.staged.title+"\u201d — see the Document pane.", "sys"); loadStaged(); }
        if(res.macroCreated){ bubble("You have asked that 3 times, so I scripted it: \u201c"+res.macroCreated.id+"\u201d is now a one-tap macro below the chat — instant, no thinking loop. Delete its file in vault/macros/ any time to unlearn.", "sys"); loadMacros(); }
        try{ stream("run #"+state.runCount+" \u2713 \u201c"+q+"\u201d — "+res.pick.tier+" \u00b7 "+res.intent.kind); }catch(e){}
        return;
      }
      var ev=res.events[i++];
      paintStages(STAGES.indexOf(ev.stage));
      if(MODES[state.mode].speech!=="quiet" || ev.stage==="remember") logLine(ev.text);
      setTimeout(next, tickMs);
    })();
  })
  .catch(function(err){
    clearTimeout(askTimer);
    askBusy=false; if(goBtn) goBtn.disabled=false;
    if(err && err.name==="AbortError"){
      $("agentStatus").classList.remove("working");
      $("agentStatusText").textContent="that took too long — try a shorter ask";
      bubble("That took too long (30s) so I stopped it — nothing was filed twice. Try a shorter ask, or “open browser on bbc news” for a quick tool check.", "agent");
      logLine("! ask timed out after 30s — aborted cleanly");
      return;
    }
    $("agentStatus").classList.remove("working");
    askFailed(q, err);
  });
}
function ask(q){
  q=(q||"").trim();
  if(!q) return;
  bubble(q, "me");
  var think=document.createElement("div");
  think.className="bubble agent thinking"; think.id="thinkingBubble"; think.textContent="thinking";
  $("chatLog").appendChild(think); $("chatLog").scrollTop=$("chatLog").scrollHeight;
  if(/\b(re-?organi[sz]e|tidy|sort out)\b.*\b(this|canvas|layout|panes|page)\b/i.test(q) || /^re-?organi[sz]e this/i.test(q)){ reorganise(); return; }
  if(/^open (browse|browsing)$/i.test(q) || /^let'?s browse/i.test(q)){ goHome("browse"); return; }
  if(/^open work/i.test(q) || /^work mode/i.test(q)){ goHome("work"); return; }
  if(layoutCommand(q)) return; /* deterministic UI move, no model involved */
  /* deterministic, no-model intents handled in plain sight */
  if(/^save all this/i.test(q) || /^save.*for another day/i.test(q)){
    fetch(apiUrl("/api/snapshots"),{method:"POST"}).then(function(r){ return r.json(); }).then(function(s){
      bubble("Saved. Snapshot "+(s.id||"")+" holds your config + ledger, so you can close everything and reopen exactly this later — or roll back to it from Setup. Now swap to Chill or Low-Sensory and read something nice.", "agent");
      stream("snapshot ✓ saved for another day");
      loadSnaps();
    }).catch(function(){ bubble("I tried to snapshot but the sidecar is unreachable — run npm start and ask again.", "agent"); });
    return;
  }
  runReal(q); /* askFailed() owns every failure — never a fake answer */
}
$("askForm").addEventListener("submit", function(e){
  e.preventDefault();
  var q=$("ask").value.trim();
  $("ask").value="";
  if((state.mode==="Vibes"||state.mode==="xMAX") && state.mode!=="calm"){
    var r=document.createElement("span"); r.className="rippleFx";
    r.style.width="90px"; r.style.height="90px"; r.style.right="30px"; r.style.bottom="24px";
    $("pane-chat").appendChild(r); setTimeout(function(){ r.remove(); }, 750);
  }
  ask(q);
});
document.querySelectorAll("[data-chip]").forEach(function(b){
  b.addEventListener("click", function(){
    var c=b.dataset.chip;
    if(c==="setup") ask("help me get a better agent plugged in");
    else if(c==="chat") ask("are you agentic now?");
    else if(c==="draft"){ $("ask").value="Draft a letter about "; $("ask").focus(); }
    else if(c==="save") ask("save all this for another day");
  });
});

/* ---- setup wizard: deterministic steps, tap to run ---- */
function renderSetup(plan, caps){
  window.__capsModels=(caps&&caps.modelsPresent)||[];
  state.setupPlan=plan;
  var box=$("setupSteps"); box.textContent="";
  var h=document.createElement("p"); h.className="small";
  h.textContent="Setting up your agent — each step is a script, nothing runs without your tap:";
  box.appendChild(h);
  (plan||[]).forEach(function(st, i){
    var row=document.createElement("div"); row.className="step"+(st.done?" done":"");
    var n=document.createElement("span"); n.className="n"; n.textContent=st.done?"✓":String(i+1);
    var mid=document.createElement("div");
    var lab=document.createElement("div"); lab.textContent=st.label;
    var btn=document.createElement("button"); btn.className="sbtn"; btn.type="button";
    btn.textContent=st.done?"Done":"Run step";
    btn.disabled=!!st.done;
    btn.addEventListener("click", function(){ runSetupStep(st.id, btn); });
    mid.appendChild(lab); mid.appendChild(btn);
    row.appendChild(n); row.appendChild(mid);
    box.appendChild(row);
  });
  if(caps) $("capLine").textContent="This device: "+caps.deviceClass+" · "+caps.cpus+" CPUs · "+caps.ramGB+"GB RAM"+
    (caps.gpu&&caps.gpu.length?(" · "+caps.gpu.map(function(g){return g.name;}).join(" + ")):" · no GPU")+
    " · llama.cpp "+(caps.llamaCpp?"found":"missing")+" · models: "+(caps.modelsPresent.join(", ")||"none yet");
}
function runSetupStep(id, btn){
  btn.textContent="running…"; btn.disabled=true;
  fetch(apiUrl("/api/setup/run/"+id),{method:"POST"}).then(function(r){ return r.json(); }).then(function(res){
    if(res && res.ok===false) bubble("Step "+id+" could not finish: "+(res.error||"unknown")+" — nothing was changed.", "agent");
    else {
      bubble("Step "+id+" done."+(res.note?(" "+res.note):"")+(res.tier?(" Tier picked: "+res.tier+"."):"")+(res.modelFile?(" Brain wired to "+res.modelFile+". Ask me anything."):""), "agent");
      stream("setup step ✓ "+id);
    }
    loadSetup();
  }).catch(function(){ bubble("Setup step failed — is npm start running?", "agent"); loadSetup(); });
}
function loadSetup(){
  fetch(apiUrl("/api/setup/plan")).then(function(r){ return r.json(); }).then(function(res){
    renderSetup(res.plan, res.capabilities);
  }).catch(function(){});
  fetch(apiUrl("/api/models")).then(function(r){ return r.json(); }).then(function(m){
    var box=$("setupSteps"); if(!box) return;
    var h=document.createElement("p"); h.className="small";
    h.textContent="Brains you can plug in — my recommendation is a starting point, you decide:";
    box.appendChild(h);
    (m.tiers||[]).concat(m["researched2026-10-28-v2"] ? m["researched2026-10-28-v2"].litePacked.map(function(x){ return {label:x.model, sizeMB:x.sizeMB, status:x.status}; }) : []).forEach(function(t){
      var row=document.createElement("div"); row.className="tierline";
      row.textContent="• "+(t.label||t.id)+" — "+(t.sizeMB?("~"+t.sizeMB+"MB · "):"")+(t.status||t.role||"");
      box.appendChild(row);
    });
    ((window.__capsModels)||[]).forEach(function(f){
      var row=document.createElement("div"); row.className="tierline";
      var b=document.createElement("button"); b.className="sbtn"; b.type="button"; b.textContent="Use "+f+" as this profile's brain";
      b.addEventListener("click", function(){
        postConfig({slot:{brain:"local-model", modelFile:f}});
        bubble("Brain set for this profile only: "+f+". Other profiles keep theirs.", "agent");
      });
      row.appendChild(b); box.appendChild(row);
    });
    var v=document.createElement("p"); v.className="small";
    v.textContent="Voice: browser speech today · Parakeet 0.6B + NeuDecide 43MB-class are staged adapter options (agent/models.json). New models appear here as the app updates — recommendations, never silent swaps.";
    box.appendChild(v);
  }).catch(function(){});
  loadConfig(); loadSnaps(); refreshCloud();
}

/* ---- meta-profiles: slots, reset, snapshots (easy unstitch/rollback) ---- */
function applyConfig(res){
  if(!res || !res.profile) return;
  var slotChanged = state.slot && res.slot && res.slot!==state.slot;
  state.slot=res.slot || state.slot;
  state.cfg=res.profile;
  var slot=res.profile;
  ["A","B","C","D","E","X"].forEach(function(L){
    var b=$("slot"+L); if(!b) return;
    var active=state.slot===L;
    b.setAttribute("aria-pressed", active?"true":"false");
    b.textContent = active ? ("Profile "+L+(slot.name?(" · "+slot.name):"")) : L;
  });
  setAvatar(slot.buddy||"person");
  $("guidedToggle").checked=!!slot.guided;
  if($("privateToggle")) $("privateToggle").checked=!!slot.privateMode;
  $("kidsToggle").checked=!!slot.kids;
  $("advancedToggle").checked=!!slot.advanced;
  if($("piBrainToggle")) $("piBrainToggle").checked=!!slot.piBrain;
  if($("wholeMachineToggle")) $("wholeMachineToggle").checked=!!slot.wholeMachine;
  if($("intensitySel")) $("intensitySel").value=slot.intensity||"full";
  document.body.dataset.intensity = state.mode==="calm" ? "soft" : (slot.intensity||"full");
  state.speak=!!slot.voiceOut;
  if($("speakBtn")) if($("speakBtn")) $("speakBtn").setAttribute("aria-pressed", state.speak?"true":"false");
  document.body.classList.toggle("kids", !!slot.kids);
  document.body.dataset.slotx = state.slot==="X" ? "1" : "0";
  if(typeof updateAdvancedVisibility==="function") updateAdvancedVisibility();
  $("nameInput").value=slot.name||"";
  $("buddyInput").value=slot.buddy||"fox";
  renderTrash(slot.closedPanes||[]);
  if(slot.agentDetail){ document.body.dataset.detail=slot.agentDetail; if($("detailToggle")) $("detailToggle").textContent=slot.agentDetail==="sleek"?"Sleek":"Detailed"; }
  /* Persisted layout applies ONCE (first load / world switch). Re-applying
     it on every config save was the trash-recover data-loss bug: recover
     un-hid the pane locally, then the save response clobbered it back. */
  if(!state.layoutInit){ state.layoutInit=true; state.layoutAppliedOnce=true; } /* first config sighting: local layout is authoritative from here */
  if(slot.layout && (slotChanged || !state.layoutAppliedOnce)){
    state.layout={order:slot.layout.order||null, hidden:slot.layout.hidden||["pane-agent","pane-doc","pane-notes","pane-video","pane-setup","pane-activity"], maxed:null, sizes:slot.layout.sizes||null};
    state.layoutAppliedOnce=true;
    applyLayout();
  }
  var canonMeta=canonicalMode(slot.metaMode);
  if(canonMeta && canonMeta!==state.mode && !state.urlMode) setMode(canonMeta, "this profile settles here");
  updateXmaxVisibility();
  if(slotChanged) resetWorldView(slot);
  if(slotChanged && state.slot==="X") bubble("⚡ Profile X — ringfenced power world. Extensible pi + durable, deeper access where this device allows, advised brain: PC-standard or better. A and B cannot see or touch any of this, and X cannot touch them.", "agent");
}
/* zero carry-across: a slot switch rebuilds every pane from that slot only */
function resetWorldView(slot){
  $("chatLog").textContent=""; $("agentLog").textContent=""; $("stream").textContent=""; $("ledger").textContent="";
  paintStages(-1);
  bubble("This is a different person's Profiles — own name, own vault, own memory, own macros. Nothing carried across. "+(slot.name?("Hello, "+slot.name+"."):"Tell me your name and pick a buddy, and this side is yours."), "agent");
  seed(); loadStaged(); loadMacros(); loadSnaps(); loadNotes();
  $("agentStatusText").textContent="lite agent on — this profile only";
}
function loadConfig(){
  fetch(apiUrl("/api/config")).then(function(r){ return r.json(); }).then(applyConfig).catch(function(){});
}
function postConfig(patch){
  fetch(apiUrl("/api/config"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(patch)})
    .then(function(r){ return r.json(); }).then(applyConfig).catch(function(){});
}
function switchSlot(slot){
  if(slot===state.slot) return;
  fetch(apiUrl("/api/slot"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({slot:slot})})
    .then(function(r){ return r.json(); }).then(function(){ loadConfig(); })
    .catch(function(){ bubble("Could not switch profiles — is npm start running?", "sys"); });
}
["A","B","C","D","E","X"].forEach(function(L){
  var b=$("slot"+L); if(b) b.addEventListener("click", function(){ switchSlot(L); });
});
function loadAppConfig(){
  fetch(apiUrl("/api/appconfig")).then(function(r){ return r.json(); }).then(function(ac){
    state.appCfg=ac;
    $("slotX").hidden=!ac.showX;
  state.appCfg=ac; updateXmaxVisibility();
    $("showXToggle").checked=!!ac.showX;
    var extra=ac.extraSlots||[];
    $("slotD").hidden=extra.indexOf("D")<0;
    $("slotE").hidden=extra.indexOf("E")<0;
    $("extraSlotsToggle").checked=extra.length>0;
    if(typeof updateAdvancedVisibility==="function") updateAdvancedVisibility();
    if(typeof refreshProfileXStatus==="function") refreshProfileXStatus();
  }).catch(function(){});
}
function postAppConfig(patch){
  fetch(apiUrl("/api/appconfig"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(patch)})
    .then(function(){ loadAppConfig(); }).catch(function(){});
}
$("showXToggle").addEventListener("change", function(e){
  postAppConfig({showX:e.target.checked});
  bubble(e.target.checked
    ? "Profile X is now on the strip (far right, inverted). Remember: inside X the agent can reach the whole machine — that is the point, and why it is opt-in. A/B/C stay cosy and untouched."
    : "Profile X hidden again. It still exists, ringfenced, whenever you opt back in.", "sys");
});
$("extraSlotsToggle").addEventListener("change", function(e){
  postAppConfig({extraSlots:e.target.checked?["D","E"]:[]});
});
/* ---- Profile X: single gated opt-in, all-on, private git rollback ----
   Advanced power tools stay hidden until the explicit disclaimer is
   accepted. One switch turns everything on — no sub-checkbox maze.
   Activation never touches vault/A|B|C (server proves isolation). */
function updateAdvancedVisibility(){
  var on=!!(state.appCfg&&state.appCfg.showX) || state.slot==="X";
  document.body.dataset.advanced=on?"1":"0";
  var btn=$("profileXEnable");
  if(btn) btn.style.display=on?"none":"";
  var st=$("profileXStatus");
  if(st && on) st.textContent="Profile X is on — all power features enabled, private rollback repo ready. A/B/C stay sandboxed.";
}
function refreshProfileXStatus(){
  fetch(apiUrl("/api/profilex/status")).then(function(r){ return r.json(); }).then(function(st){
    var el=$("profileXStatus");
    if(!el) return;
    if(st.showX){
      el.textContent="Profile X is on — all power features enabled"+(st.git&&st.git.commit?" · rollback "+String(st.git.commit).slice(0,7):"")+". A/B/C stay sandboxed.";
    } else {
      el.textContent="Advanced power tools are hidden until you opt in.";
    }
    updateAdvancedVisibility();
  }).catch(function(){});
}
if($("profileXEnable")) $("profileXEnable").addEventListener("click", function(){
  fetch(apiUrl("/api/profilex/disclaimer")).then(function(r){ return r.json(); }).then(function(out){
    if(out&&out.disclaimer) $("profileXText").textContent=out.disclaimer;
  }).catch(function(){});
  $("profileXDisclaimer").hidden=false;
});
if($("profileXCancel")) $("profileXCancel").addEventListener("click", function(){
  $("profileXDisclaimer").hidden=true;
  bubble("Kept you on A/B/C — nothing changed, nothing installed.", "sys");
});
if($("profileXConfirm")) $("profileXConfirm").addEventListener("click", function(){
  var btn=$("profileXConfirm");
  btn.textContent="Turning on…"; btn.disabled=true;
  fetch(apiUrl("/api/profilex/activate"),{method:"POST"}).then(function(r){ return r.json(); }).then(function(out){
    btn.textContent="I understand — turn everything on"; btn.disabled=false;
    $("profileXDisclaimer").hidden=true;
    if(!out||!out.ok){ bubble("Profile X could not turn on: "+((out&&out.error)||"unknown")+" — A/B/C untouched, nothing half-enabled.", "agent"); return; }
    bubble("⚡ Profile X is on — everything enabled in one switch. Private rollback repo ready"+(out.git&&out.git.commit?(" ("+String(out.git.commit).slice(0,7)+")"):"")+". A/B/C remain strictly sandboxed and untouched.", "agent");
    stream("profile X ON — all-on, git rollback "+(out.git&&out.git.commit?String(out.git.commit).slice(0,7):"ok")+" · A/B/C unchanged");
    loadAppConfig(); loadConfig();
  }).catch(function(){
    btn.textContent="I understand — turn everything on"; btn.disabled=false;
    bubble("Profile X activation unreachable — is npm start running? Nothing changed.", "agent");
  });
});
$("welcomeSave").addEventListener("click", function(){
  var name=$("nameInput").value.trim(), buddy=$("buddyInput").value;
  postConfig({slot:{name:name, buddy:buddy}});
  bubble("Lovely — hello"+(name?(" "+name):"")+". I saved that to this profile. Swap slots any time; each keeps its own name, buddy and calm.", "agent");
});
$("guidedToggle").addEventListener("change", function(e){ postConfig({slot:{guided:e.target.checked}}); });
$("privateToggle").addEventListener("change", function(e){
  postConfig({slot:{privateMode:e.target.checked}});
  bubble(e.target.checked?"Private mode on — I stop recording learning events for this profile. Macros and preferences freeze as they are.":"Private mode off — quiet learning resumes (local files only, always).", "sys");
});
$("kidsToggle").addEventListener("change", function(e){ postConfig({slot:{kids:e.target.checked}}); bubble(e.target.checked?"Kids mode on — simpler, advanced bits hidden.":"Kids mode off.", "sys"); });
if($("wholeMachineToggle")) $("wholeMachineToggle").addEventListener("change", function(e){
  postConfig({slot:{wholeMachine:e.target.checked}});
  bubble(e.target.checked
    ? "Whole-machine reach ON for Profile X only. Pi's desk is now your home directory inside X. A/B/C remain ringfenced. Turn it off the moment you are done."
    : "Whole-machine reach off — X is ringfenced to its vault again.", "sys");
});
if($("piBrainToggle")) $("piBrainToggle").addEventListener("change", function(e){
  postConfig({slot:{piBrain:e.target.checked}});
  bubble(e.target.checked?"Pi brain enabled for this profile — only works inside Profile X, where it belongs.":"Pi brain off — lite agent only.", "sys");
});
$("advancedToggle").addEventListener("change", function(e){
  postConfig({slot:{advanced:e.target.checked}});
  $("advancedLine").textContent=e.target.checked
    ? "ON — power tools unlocked, still checkpointed and confirmed per action. Whole-machine access lives here, never in day-to-day panes."
    : "Off. On unlocks (still checkpointed, still confirmed): local shell scripts you stage, SSH/fleet agents via your own keys, browser-act with Playwright/CUA+vision.";
});
if($("intensitySel")) $("intensitySel").addEventListener("change", function(e){
  postConfig({slot:{intensity:e.target.value}});
  document.body.dataset.intensity = state.mode==="calm" ? "soft" : e.target.value;
  bubble("Energy set to "+e.target.value+" for this profile."+(state.mode==="calm"?" (Low-Sensory stays static regardless — that is the promise.)":""), "sys");
});
$("resetSlot").addEventListener("click", function(){
  postConfig({reset:true});
  bubble("Reset done — a snapshot was taken first, so nothing is lost. This slot is back to cosy defaults.", "agent");
  loadSnaps();
});
$("snapNow").addEventListener("click", function(){
  fetch(apiUrl("/api/snapshots"),{method:"POST"}).then(function(r){ return r.json(); }).then(function(){ bubble("Snapshot saved.", "sys"); loadSnaps(); });
});
function loadSnaps(){
  fetch(apiUrl("/api/snapshots")).then(function(r){ return r.json(); }).then(function(res){
    var box=$("snapList"); box.textContent="";
    (res.snapshots||[]).slice(0,5).forEach(function(s){
      var row=document.createElement("div");
      row.appendChild(document.createTextNode("↩ "+s.id+" ("+(s.label||"snapshot")+") "));
      var b=document.createElement("button"); b.className="sbtn ghost"; b.type="button"; b.textContent="Roll back";
      b.addEventListener("click", function(){
        fetch(apiUrl("/api/snapshots/"+s.id+"/restore"),{method:"POST"}).then(function(r){ return r.json(); }).then(function(){
          bubble("Rolled back to "+s.id+" (a safety snapshot of the pre-rollback state was taken too).", "agent");
          loadConfig(); loadSnaps();
        });
      });
      row.appendChild(b); box.appendChild(row);
    });
  }).catch(function(){});
}

/* ---- past sessions: named saves grouped by project, restore safely ---- */
function sessGroup(label){
  var i=(label||"").indexOf(":");
  return i>0 ? label.slice(0,i).trim() : "moments";
}
function renderSessions(list){
  var box=$("sessList"); if(!box) return;
  box.textContent="";
  if(!list.length){
    var p=document.createElement("p"); p.className="small";
    p.textContent="No saved sessions yet — name this moment above and tap Save.";
    box.appendChild(p); return;
  }
  var groups={};
  list.forEach(function(sn){ var g=sessGroup(sn.label||""); (groups[g]=groups[g]||[]).push(sn); });
  Object.keys(groups).sort().forEach(function(g){
    var h=document.createElement("div"); h.className="sessgroup"; h.textContent=g;
    box.appendChild(h);
    groups[g].forEach(function(sn){
      var b=document.createElement("button"); b.type="button";
      b.textContent=(sn.label||sn.id)+" · "+String(sn.id).slice(5,16).replace("T"," ");
      b.title="Restore (a safety copy of now is taken first)";
      b.addEventListener("click", function(){
        fetch(apiUrl("/api/snapshots/"+sn.id+"/restore"),{method:"POST"}).then(function(r){ return r.json(); }).then(function(){
          bubble("Restored “"+(sn.label||sn.id)+"”.", "agent");
          loadConfig(); loadSnaps(); renderSessions([]);
          $("sessPop").hidden=true;
        });
      });
      box.appendChild(b);
    });
  });
}
function loadSessions(){
  fetch(apiUrl("/api/snapshots")).then(function(r){ return r.json(); }).then(function(res){
    renderSessions(res.snapshots||[]);
  }).catch(function(){});
}
if($("sessBtn")) $("sessBtn").addEventListener("click", function(){
  var pop=$("sessPop"), open=pop.hidden;
  document.querySelectorAll("#trashPop").forEach(function(p){ p.hidden=true; });
  pop.hidden=!open;
  if(open) loadSessions();
});
if($("sessSave")) $("sessSave").addEventListener("click", function(){
  var name=$("nameInput") ? $("nameInput").value : "";
  var label=($("sessName").value||"").trim() || ("moment "+new Date().toLocaleString());
  fetch(apiUrl("/api/snapshots"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({label:label})})
    .then(function(r){ return r.json(); }).then(function(){
      $("sessName").value="";
      bubble("Saved “"+label+"” — find it here any time, grouped and restorable.", "sys");
      loadSessions();
    });
});

/* ---- staged docs ---- */
function loadStaged(){
  fetch(apiUrl("/api/stage")).then(function(r){ return r.json(); }).then(function(res){
    var box=$("stageList"); if(!box) return;
    box.textContent="";
    if(!res.staged || !res.staged.length){
      var p=document.createElement("p"); p.className="empty";
      p.textContent="No staged drafts yet — ask “draft a letter about…” or “slides for…”";
      box.appendChild(p); return;
    }
    res.staged.forEach(function(d){
      var div=document.createElement("div"); div.className="stageitem";
      var h=document.createElement("h3"); h.textContent=d.title+"  ("+d.kind+")";
      var pre=document.createElement("pre");
      pre.textContent=(d.sections||[]).map(function(x){ return x.heading+": "+x.body; }).join("\n");
      var a1=document.createElement("a"); a1.href="/api/stage/"+d.id+"/export?format=md"; a1.textContent="Export .md";
      var a2=document.createElement("a"); a2.href="/api/stage/"+d.id+"/export?format=docx"; a2.textContent="Export .docx (Word / Google Docs)";
      div.appendChild(h); div.appendChild(pre); div.appendChild(a1); div.appendChild(a2); div.appendChild(pb);
      box.appendChild(div);
    });
  }).catch(function(){});
}
$("stageRefresh").addEventListener("click", loadStaged);

/* ---- browser pane: pass-through — one row, then just the page ---- */
var browserLoaded=false;
function normUrl(u){
  u=String(u||"").trim();
  if(!u) return "https://www.bing.com";
  if(/^https?:\/\//i.test(u)) return u;
  if(/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(u)) return "https://"+u;
  return apiUrl("/api/search?q="+encodeURIComponent(u));
}
var lastBrowserUrl="";
var browserLoaded=false;
function proxyFor(url){ return apiUrl("/api/proxy?url="+encodeURIComponent(url)); }
function homeUrl(){ return apiUrl("/api/home"); }
function frameRealUrl(){
  try{
    var h=$("browserFrame").contentWindow.location.href || "";
    var m=/[?&]url=([^&]+)/.exec(h);
    if(m){ try{ return decodeURIComponent(m[1]); }catch(e){ return h; } }
    return h;
  }catch(e){ return ""; }
}
/* Agent navigations land here: the native frame shows the proxied page. */
function browserShow(out){
  if(!out || !out.ok) return;
  if(!out.url){ lastBrowserUrl=""; $("urlInput").value=""; $("browserFrame").src=homeUrl(); hideFallback(); browserLoaded=true; return; }
  lastBrowserUrl=out.url;
  $("urlInput").value=out.url;
  var f=$("browserFrame");
  var want=proxyFor(out.url);
  try{ if(f.contentWindow.location.href!==want) f.src=want; }catch(e){ f.src=want; }
  hideFallback();
  browserLoaded=true;
}
function showFallback(msg, realUrl){
  var fb=$("browserFallback"); if(!fb) return;
  fb.hidden=false;
  $("browserFallbackText").textContent=msg;
  var open=$("fallbackOpen");
  if(open) open.onclick=function(){ if(realUrl) window.open(realUrl,"_blank"); };
}
function hideFallback(){ var fb=$("browserFallback"); if(fb) fb.hidden=true; }
$("browserFrame").addEventListener("load", function(){
  nudgeSoon(900);
  /* proxy errors come back tiny: surface the escape instead of a void */
  hideFallback();
  try{
    var doc=$("browserFrame").contentDocument;
    var t=(doc && doc.body && doc.body.innerText || "").trim();
    if(/^\{"error"/.test(t) || /^(too many redirects|page too large)/i.test(t)){
      showFallback("This page would not embed ("+t.slice(0,120)+").", lastBrowserUrl);
    }
  }catch(e){}
});
/* URL bar follows real in-frame navigation (same-origin through proxy) */
setInterval(function(){
  if(document.visibilityState!=="visible" || !paneVisible("pane-browser")) return;
  try{
    var real=frameRealUrl();
    if(real && real.indexOf("http")===0 && real!==lastBrowserUrl){
      lastBrowserUrl=real;
      $("urlInput").value=/\/api\/home$/.test(real)?"":real;
    }
  }catch(e){}
}, 2000);
function nudgeFrame(){
  /* some pages (Bing) measure their width once at first paint — if the
     pane was still animating open, they lay out squashed and stick. A
     resize event makes them measure again. */
  try{
    var f=$("browserFrame");
    f.contentWindow.dispatchEvent(new f.contentWindow.Event("resize"));
  }catch(e){}
}
var nudgeTimer=null;
function nudgeSoon(ms){
  clearTimeout(nudgeTimer);
  nudgeTimer=setTimeout(nudgeFrame, ms||400);
}
window.addEventListener("resize", function(){ nudgeSoon(400); });
$("urlForm").addEventListener("submit", function(e){
  e.preventDefault();
  var raw=$("urlInput").value.trim();
  var f=$("browserFrame");
  hideFallback();
  if(!raw){ lastBrowserUrl=""; f.src=homeUrl(); browserLoaded=true; return; }
  var u=normUrl(raw);
  lastBrowserUrl=u;
  $("urlInput").value=u;
  try{
    if(f.contentWindow.location.href===proxyFor(u)) f.contentWindow.location.reload();
    else f.src=proxyFor(u);
  }catch(err){ f.src=proxyFor(u); }
  setTimeout(nudgeFrame, 1200);
  browserLoaded=true;
});
$("browserBack").addEventListener("click", function(){
  try{ $("browserFrame").contentWindow.history.back(); }catch(e){}
});
if($("openExternal")) $("openExternal").addEventListener("click", function(){
  var u=$("urlInput").value.trim()||lastBrowserUrl;
  if(u) window.open(u, "_blank");
});
if($("fallbackOpen")) $("fallbackOpen").addEventListener("click", function(){
  var u=$("urlInput").value.trim()||lastBrowserUrl;
  if(u) window.open(u, "_blank");
});
if($("fallbackRetry")) $("fallbackRetry").addEventListener("click", function(){
  var f=$("browserFrame");
  var u=$("urlInput").value.trim()||lastBrowserUrl;
  if(!u) u="https://www.bing.com";
  lastBrowserUrl=u;
  f.src=proxyFor(normUrl(u));
  hideFallback();
});
/* boot: clean proxied Google, ready to type in */
fitBrowserView();
setTimeout(function(){
  if(browserLoaded) return;
  lastBrowserUrl="";
  $("urlInput").value="";
  fitBrowserView();
  $("browserFrame").src=homeUrl();
  browserLoaded=true;
}, 1200);
setTimeout(fitBrowserView, 900);

/* ---- voice: talk -> it listens; answers spoken back in a natural voice ---- */
function pickVoice(){
  try{
    var vs=speechSynthesis.getVoices()||[];
    var pref=vs.filter(function(v){ return /en[-_]GB/i.test(v.lang) && /natural|neural|google/i.test(v.name); })[0]
      || vs.filter(function(v){ return /Google UK English/i.test(v.name); })[0]
      || vs.filter(function(v){ return /en[-_]GB/i.test(v.lang); })[0]
      || vs.filter(function(v){ return /^en/i.test(v.lang); })[0];
    return pref||null;
  }catch(e){ return null; }
}
function speakText(text){
  if(!window.speechSynthesis) return;
  try{
    speechSynthesis.cancel();
    var u=new SpeechSynthesisUtterance(String(text).slice(0,240));
    var v=pickVoice(); if(v) u.voice=v;
    u.rate=1.0; u.pitch=1.0;
    speechSynthesis.speak(u);
    if(speechSynthesis.paused) speechSynthesis.resume();
  }catch(e){}
}
if(window.speechSynthesis && speechSynthesis.onvoiceschanged!==undefined){
  speechSynthesis.onvoiceschanged=function(){};
}
/* ---- quiet learning: dwell is recorded, suggestions are learned + rare ---- */
function learnStay(newMode){
  var prev=state.mode, dwell=Math.round((Date.now()-(state.modeSince||Date.now()))/1000);
  state.modeSince=Date.now();
  if(dwell>=30 && prev && prev!==newMode){
    fetch(apiUrl("/api/learn"),{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({type:"mode-stay",mode:prev,dwellSec:dwell})}).catch(function(){});
  }
}
var pendingSuggest=null;
function checkLearned(){
  if(state.suggestChecked) return;
  state.suggestChecked=true;
  try{
    var until=Number(localStorage.getItem("profilesSuggestSilenceUntil")||0);
    if(Date.now()<until) return; /* dismissed recently: silence, respected */
  }catch(e){}
  fetch(apiUrl("/api/preferences?current="+encodeURIComponent(state.mode))).then(function(r){ return r.json(); }).then(function(res){
    var sug=res && res.suggestion;
    if(!sug || sug.to===state.mode) return;
    if(state.auto){ stream("auto profile → "+MODES[sug.to].label+" ("+sug.why+")"); setMode(sug.to,"learned auto: "+sug.why); return; }
    pendingSuggest=sug.to;
    $("suggestText").textContent="Suggestion: switch to "+MODES[sug.to].label.split(" ·")[0]+"? "+sug.why+".";
    $("suggestBar").hidden=false;
  }).catch(function(){});
}
$("suggestYes").addEventListener("click", function(){
  $("suggestBar").hidden=true;
  if(pendingSuggest) setMode(pendingSuggest,"learned: you accepted");
  pendingSuggest=null;
});
$("suggestNo").addEventListener("click", function(){
  $("suggestBar").hidden=true; pendingSuggest=null;
  try{ localStorage.setItem("profilesSuggestSilenceUntil", String(Date.now()+24*3600*1000)); }catch(e){}
  fetch(apiUrl("/api/learn"),{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({type:"suggest-dismissed"})}).catch(function(){});
  bubble("Noted — I will keep suggestions quiet for a day, and I learn from what you stay with, not from clicks.", "sys");
});
$("autoToggle").addEventListener("change", function(e){
  state.auto=e.target.checked;
  stream("auto profile "+(state.auto?"ON — learned suggestions apply, announced":"OFF — learned suggestions only"));
});

/* ---- invite engine: pills breathe, jiggle and lure — unless stillness rules ----
   Calm and babylite modes mean stillness: no invite animations at all there.
   Everywhere else the pills gently remind you they exist. */
function invitesAllowed(){
  if(state.mode==="calm" || state.mode==="babylite") return false;
  if(document.body.classList.contains("gov-freeze")) return false;
  try{ if(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return false; }catch(e){}
  return true;
}
function pillFor(profile){
  return document.querySelector('.pills button[data-profile="'+profile+'"]');
}
/* Calm... breathes: every 30s the dots cycle none -> . -> .. -> ... over ~3s */
setInterval(function(){
  var dots=$("calmDots"); if(!dots) return;
  if(!invitesAllowed() || state.mode==="calm"){ dots.textContent=""; return; }
  var steps=["", ".", "..", "..."], i=0;
  dots.textContent="";
  var t=setInterval(function(){
    i++;
    if(i>=steps.length){ clearInterval(t); return; }
    if(!invitesAllowed()){ clearInterval(t); dots.textContent=""; return; }
    dots.textContent=steps[i];
  }, 750);
}, 30000);
/* babylite jiggles playfully when you are not on it (nor calm) — and means
   it extra when the machine is busy (RAM/CPU over 80%). */
setInterval(function(){
  var b=pillFor("babylite"); if(!b) return;
  if(!invitesAllowed() || state.mode==="babylite"){ b.classList.remove("invite"); return; }
  b.classList.add("invite");
  b.title = state.busy
    ? "babylite — soft + simple (your machine is working hard right now: lighter is kinder)"
    : "babylite — soft + simple (key 1)";
  setTimeout(function(){ b.classList.remove("invite"); }, 2600);
}, 45000);
/* machine-busy poll (feeds the babylite nudge, nothing else) */
setInterval(function(){
  fetch(apiUrl("/api/capabilities")).then(function(r){ return r.json(); }).then(function(c){
    state.busy = !!(c && c.busy);
  }).catch(function(){});
}, 60000);
/* Vibes rotates through 5 pre-planned vibrant schemes: the button every
   60s, the whole theme every 5 minutes while you live in it. */
var VIBES_BTN=[["#ff3ea5","#22d3ee"],["#22d3ee","#ff3ea5"],["#a78bfa","#22d3ee"],["#fb7185","#fbbf24"],["#34d399","#22d3ee"]];
var VIBES_FULL=[["#ff3ea5","#22d3ee","#f0efff"],["#22d3ee","#a78bfa","#f0efff"],["#f472b6","#fb923c","#fff7ed"],["#fb7185","#fbbf24","#fffbeb"],["#34d399","#22d3ee","#ecfdf5"]];
var vibesIdx=0, vibesMinCount=0;
setInterval(function(){
  var btn=pillFor("Vibes"); if(!btn) return;
  if(!invitesAllowed()) return;
  vibesIdx=(vibesIdx+1)%VIBES_BTN.length;
  btn.style.setProperty("--pill", VIBES_BTN[vibesIdx][0]);
  btn.style.setProperty("box-shadow", "0 0 0 1px "+VIBES_BTN[vibesIdx][0]+", 2.5px 2.5px 0 0 "+VIBES_BTN[vibesIdx][1]);
  if(state.mode==="Vibes"){
    vibesMinCount++;
    if(vibesMinCount>=5){
      vibesMinCount=0;
      var f=VIBES_FULL[vibesIdx%VIBES_FULL.length];
      document.body.style.setProperty("--deck1", f[0]);
      document.body.style.setProperty("--deck2", f[1]);
      document.body.style.setProperty("--front", f[2]);
      document.body.style.setProperty("--accent", f[0]);
      stream("vibes rotated to a new vibrant scheme");
    }
  } else {
    vibesMinCount=0;
    document.body.style.removeProperty("--deck1"); document.body.style.removeProperty("--deck2");
    document.body.style.removeProperty("--front"); document.body.style.removeProperty("--accent");
  }
}, 60000);
/* Learned invites: even without Adaptive on, quiet polling steers a gentle
   glow toward the mode you actually settle into — never a popup, never a
   sound, at most once every half hour, and silence (24h) kills them all. */
var lastLearnedInvite=0;
setInterval(function(){
  if(!invitesAllowed()) return;
  if(Date.now()-lastLearnedInvite < 30*60*1000) return;
  try{ if(Number(localStorage.getItem("profilesSuggestSilenceUntil")||0) > Date.now()) return; }catch(e){}
  fetch(apiUrl("/api/preferences?current="+encodeURIComponent(state.mode))).then(function(r){ return r.json(); }).then(function(res){
    var sug=res && res.suggestion;
    if(!sug || !sug.to || sug.to===state.mode) return;
    var btn=pillFor(sug.to==="lifeful"?"Vibes":sug.to==="low-sensory"?"calm":sug.to);
    if(!btn || btn.hidden) return;
    lastLearnedInvite=Date.now();
    btn.classList.add("invite");
    setTimeout(function(){ btn.classList.remove("invite"); }, 4000);
    stream("learned invite → "+sug.to+" (pill glow only, from your dwell patterns)");
  }).catch(function(){});
}, 60000);
/* FOCUSMAX pulses to get your attention, then locks crispy */
setInterval(function(){
  var btn=pillFor("FOCUSMAX"); if(!btn) return;
  if(!invitesAllowed() || state.mode==="FOCUSMAX") return;
  btn.classList.add("lure");
  setTimeout(function(){ btn.classList.remove("lure"); }, 2100);
}, 75000);

/* ---- macros: repeated asks become one-tap deterministic scripts ---- */
function loadMacros(){
  fetch(apiUrl("/api/macros")).then(function(r){ return r.json(); }).then(function(res){
    var box=$("macroChips"); if(!box) return;
    box.textContent="";
    (res.macros||[]).forEach(function(m){
      var b=document.createElement("button"); b.type="button";
      b.textContent="⚡ "+m.phrase;
      b.title="Deterministic macro — same steps every time, no model loop. Delete vault/macros/"+m.id+".json to unlearn.";
      b.addEventListener("click", function(){ ask(m.phrase); });
      box.appendChild(b);
    });
  }).catch(function(){});
}

/* ---- activity + ledger ---- */
function stream(text){
  var ul=$("stream"); if(!ul) return;
  var li=document.createElement("li");
  var t=document.createElement("time"); t.textContent=now();
  li.appendChild(t); li.appendChild(document.createTextNode(text));
  ul.insertBefore(li, ul.firstChild);
  while(ul.children.length>20) ul.removeChild(ul.lastChild);
}
function addLedger(q){
  var box=$("ledger");
  var div=document.createElement("div");
  div.className="ledgerline";
  var b=document.createElement("b"); b.textContent="✓ checkpoint ";
  div.appendChild(b);
  div.appendChild(document.createTextNode("“"+q+"” · state filed · next: review · "+now()));
  box.insertBefore(div, box.firstChild);
}
function seed(){
  var box=$("ledger");
  [["Pay library fine before Friday","sense ✓ inbox scan · next: plan"],
   ["Summarise school newsletter","checkpoint ✓ remembered + filed"]].forEach(function(r){
    var div=document.createElement("div"); div.className="ledgerline";
    var b=document.createElement("b"); b.textContent="✓ checkpoint ";
    div.appendChild(b); div.appendChild(document.createTextNode("“"+r[0]+"” · "+r[1]));
    box.appendChild(div);
  });
}

/* ---- routing: opt-in, OFF, cost preview ---- */
function updateModelLine(){
  var on=state.routing, fixed=ROUTING[state.mode]||"muse-spark-1.3-contributor";
  $("modelLine").textContent = on
    ? "Routing: Astra reviews each hop, Muse Spark 1.3 Contributor xhigh for heavy reasoning."
    : "Fixed model: "+fixed+" (concept). Local lite agent answers day-to-day.";
  var c=$("costLine");
  if(on){ c.classList.add("on"); c.textContent="Cost preview: ~10 light hops ≈ pennies · 1 heavy ≈ ~$0.02 · cap $2/mo — over cap, tasks queue quietly."; }
  else{ c.classList.remove("on"); c.textContent="Opt in to let Astra pick per hop, with that same cap. Agent suggests, never auto-switches."; }
}
function renderBuild(){
  fetch("./bundle.json").then(function(r){ return r.json(); }).then(function(b){
    var el=$("buildLine");
    if(el && b && b.build) el.setAttribute("data-bundle", b.build+" "+(b.at||""));
  }).catch(function(){});
  fetch(apiUrl("/api/health")).then(function(r){ return r.json(); }).then(function(h){
    var el=$("buildLine");
    if(el && h) el.textContent="UI bundle "+(el.getAttribute("data-bundle")||"dev-live")+" · sidecar "+(h.build||"?")+" · up "+String(h.startedAt||"").slice(11,16)+" UTC";
  }).catch(function(){});
}
function refreshCloud(){
  fetch(apiUrl("/api/cloud/status")).then(function(r){ return r.json(); }).then(function(st){
    $("cloudToggle").checked=!!st.enabled;
    if($("cloudModel") && st.model) $("cloudModel").value=st.model;
    $("cloudLine").textContent = st.enabled
      ? ("On — cloud model "+st.model+" via "+st.base+", key "+(st.hasKey?"stored in your OS keyring":"MISSING (save one above)")+". Local brain still answers if cloud is unreachable, and says so.")
      : "Off. On + a key = questions can go to your cloud model instead of the local one. Per profile, always labelled in chat.";
  }).catch(function(){});
  fetch(apiUrl("/api/oauth/google/status")).then(function(r){ return r.json(); }).then(function(st){
    $("googleLine").textContent = st.connected ? "Google connected — staged drafts get a Push button." :
      st.clientConfigured ? "Google not connected for this profile." :
      "Needs your own Google Cloud OAuth client (see Setup note in the agent docs) — then this button works.";
  }).catch(function(){});
}
if($("cloudToggle")) $("cloudToggle").addEventListener("change", function(e){
  postConfig({slot:{cloudEnabled:e.target.checked}});
  bubble(e.target.checked?"Cloud brain on for this profile only — answers will say when they used it.":"Cloud off — local only.", "sys");
  setTimeout(refreshCloud, 300);
});
if($("cloudKeySave")) $("cloudKeySave").addEventListener("click", function(){
  var key=$("cloudKey").value.trim(); if(!key){ bubble("Paste a key first.", "sys"); return; }
  var model=$("cloudModel").value.trim();
  if(model) postConfig({slot:{cloudModel:model}});
  fetch(apiUrl("/api/cloud/key"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:key})})
  .then(function(r){ return r.json(); }).then(function(out){
    $("cloudKey").value="";
    bubble(out.ok ? "Key saved to your OS keyring (never in plain files). Cloud is "+($("cloudToggle").checked?"live for this profile":"ready — flip Cloud brain on to use it")+"."
                 : "Could not save the key: "+(out.error||"unknown"), "agent");
    refreshCloud();
  }).catch(function(){ bubble("Key save failed — is npm start running?", "agent"); });
});
if($("googleConnect")) $("googleConnect").addEventListener("click", function(){
  fetch(apiUrl("/api/oauth/google/start")).then(function(r){ return r.json(); }).then(function(out){
    if(!out.ok){ bubble("Google connect not ready: "+out.error, "agent"); return; }
    window.open(out.url, "_blank");
    bubble("Google sign-in opened in your browser. Approve there, then come back — staged drafts will gain a Push to Google Docs button.", "agent");
  }).catch(function(){ bubble("Google connect unreachable.", "agent"); });
});
$("routingToggle").addEventListener("change", function(e){
  state.routing=e.target.checked;
  updateModelLine();
  stream("routing "+(state.routing?"ON — cost preview shown":"OFF — fixed model"));
});

/* ---- Adaptive switcher: gentle segways, context triggers (2026-10-29 modes lane) ----
   Triggers: AFK/idle (>=90s) -> chill · single-pane focus -> FOCUSMAX ·
   rapid pane swapping (>=5/min) -> Vibes · CPU/RAM pressure -> babylite.
   calm is a manual panic button: Adaptive never selects it and never
   pulls you out of it. xMAX never auto-selected (Profile X manual only). */
state.adaptive=false; state.lastActivity=Date.now(); state.paneSwitchTimes=[];
function decideAdaptiveLocal(ctx){
  var idleSec=ctx.idleSec||0, swapRate=ctx.swapRate||0, cpu=ctx.cpuLoad||0, mem=ctx.memPressure||0, focused=!!ctx.focusedSinglePane, cur=ctx.current;
  if(cur==="calm") return null; /* panic button is sticky */
  if((cpu>=0.85||mem>=0.85)&&cur!=="babylite") return {to:"babylite",why:"resource pressure: CPU/RAM struggling \u2014 soft downshift to babylite"};
  if(idleSec>=90&&cur!=="chill") return {to:"chill",why:"idle/AFK \u2014 gentle segway to chill"};
  if(swapRate>=5&&cur!=="Vibes"&&cur!=="xMAX") return {to:"Vibes",why:"rapid task swapping \u2014 segway to Vibes"};
  if(focused&&cur!=="FOCUSMAX"&&cur!=="xMAX") return {to:"FOCUSMAX",why:"sustained single-pane focus \u2014 segway to FOCUSMAX"};
  return null;
}
function adaptiveContext(){
  var idleSec=Math.round((Date.now()-(state.lastActivity||Date.now()))/1000);
  var cutoff=Date.now()-60000;
  state.paneSwitchTimes=(state.paneSwitchTimes||[]).filter(function(t){ return t>cutoff; });
  var swapRate=state.paneSwitchTimes.length;
  var focused=!!state.layout.maxed;
  var cpuLoad=0, memPressure=0;
  try{
    var nav=navigator||{};
    if(typeof nav.hardwareConcurrency==="number"&&nav.hardwareConcurrency<=4) cpuLoad=Math.max(cpuLoad,0.5);
    if(typeof nav.deviceMemory==="number"&&nav.deviceMemory<=4) memPressure=Math.max(memPressure,0.9);
    if(performance&&performance.memory&&performance.memory.jsHeapSizeLimit){
      var ratio=performance.memory.usedJSHeapSize/performance.memory.jsHeapSizeLimit;
      if(ratio>0.85) memPressure=Math.max(memPressure,0.9);
    }
  }catch(e){}
  return {idleSec:idleSec,swapRate:swapRate,cpuLoad:cpuLoad,memPressure:memPressure,focusedSinglePane:focused,current:state.mode};
}
function adaptiveTick(){
  if(!state.adaptive||document.visibilityState!=="visible") return;
  var d=decideAdaptiveLocal(adaptiveContext());
  if(!d||d.to===state.mode) return;
  if(d.to==="xMAX"||d.to==="calm") return; /* never auto-select these */
  setMode(d.to,"adaptive: "+d.why,{segway:true});
  stream("adaptive \u2192 "+MODES[d.to].label+" ("+d.why+")");
}
["pointerdown","keydown","wheel"].forEach(function(ev){
  document.addEventListener(ev,function(){ state.lastActivity=Date.now(); },{passive:true,capture:true});
});
var _origShowPaneEl=showPaneEl;
showPaneEl=function(id,silent){
  state.paneSwitchTimes.push(Date.now());
  return _origShowPaneEl(id,silent);
};
setInterval(adaptiveTick,15000);
function bindAdaptive(){
  var t=$("adaptiveToggle"); if(!t||t.dataset.bound) return; t.dataset.bound="1";
  try{ state.adaptive=localStorage.getItem("profilesAdaptive")==="1"; }catch(e){}
  t.checked=!!state.adaptive;
  $("adaptiveWrap").classList.toggle("on",!!state.adaptive);
  t.addEventListener("change",function(){
    state.adaptive=t.checked;
    $("adaptiveWrap").classList.toggle("on",!!state.adaptive);
    try{ localStorage.setItem("profilesAdaptive",state.adaptive?"1":"0"); }catch(e){}
    stream("adaptive "+(state.adaptive?"ON \u2014 segways announced, calm stays manual":"OFF"));
    bubble(state.adaptive?"Adaptive on \u2014 I segway gently (idle \u2192 chill, focus \u2192 FOCUSMAX, swapping \u2192 Vibes, strain \u2192 babylite). calm stays your panic button.":"Adaptive off \u2014 modes only change when you tap, press 1\u20136, or a/b/c/x.", "sys");
  });
}

/* ---- pack engine wiring ---- */
function packToMode(p, fb){
  var b=(p.sensory_budget||{}), out={label:p.name||fb.label, motion:fb.motion, sim:fb.sim,
    tick:fb.tick, speech:fb.speech, note:fb.note};
  if(typeof b.max_animation==="number") out.motion=Math.round(b.max_animation*100);
  if(typeof b.max_simultaneous==="number") out.sim=b.max_simultaneous;
  out.note=(p.description||"")+" Governor: motion "+out.motion+"%, "+out.sim+" simultaneous, flash 0/s (capped). "+
    "Agent "+((p.agent||{}).verbosity||"")+"/"+((p.agent||{}).autonomy||"")+", parallelism "+((p.agent||{}).parallelism||"")+".";
  return out;
}
function fetchPack(file){
  return fetch("../packs/"+file+".json").then(function(r){
    if(!r.ok) throw new Error("HTTP "+r.status);
    return r.json();
  }).catch(function(){
    return fetch("./vendor-packs/"+file+".json").then(function(r){
      if(!r.ok) throw new Error("HTTP "+r.status);
      return r.json();
    });
  });
}
function bootPacks(){
  var files={babylite:"babylite",chill:"chill",FOCUSMAX:"FOCUSMAX",Vibes:"Vibes",calm:"low-sensory",xMAX:"xmax"};
  var jobs=Object.keys(files).map(function(mode){
    return fetchPack(files[mode]).then(function(p){ livePacks[mode]=p; MODES[mode]=packToMode(p, MODES[mode]); })
    .catch(function(){});
  });
  return Promise.all(jobs).then(function(){
    if(Object.keys(livePacks).length){
      stream("pack engine: live packs loaded ("+Object.keys(livePacks).join(", ")+") — governor budgets from packs/*.json");
      setMode(state.mode,"pack engine loaded");
    }
  });
}

/* ---- front door: Browse / Search-Ask / Work arrange the canvas ----
   Unified + minimalist: browser, agent chat and notes/sketch share one
   canvas; Video/Activity live on only if the user re-opens them. */
var HOME_LAYOUTS={
  browse:{order:["pane-chat","pane-browser","pane-notes","pane-doc","pane-agent","pane-video","pane-activity","pane-setup"],
    show:["pane-browser","pane-chat"], msg:"Browse — web front and centre, chat alongside for questions. Everything else is a tab away."},
  ask:{order:["pane-chat","pane-agent","pane-browser","pane-doc","pane-notes","pane-video","pane-activity","pane-setup"],
    show:["pane-chat","pane-agent"], msg:"Search / Ask — ask box front and centre, agent receipts beside it (Detailed) or hidden (Sleek, in the Agent header)."},
  work:{order:["pane-chat","pane-doc","pane-notes","pane-browser","pane-agent","pane-video","pane-activity","pane-setup"],
    show:["pane-doc","pane-notes","pane-browser","pane-chat"], msg:"Work — staged documents + notes/sketch + your usual apps (Docs, Word, Slides) in the browser pane. Agent drafts land in Document, export when happy."}
};
function goHome(kind){
  var h=HOME_LAYOUTS[kind]; if(!h) return;
  state.layout.order=h.order;
  state.layout.hidden=PANES.filter(function(id){ return h.show.indexOf(id)<0; });
  state.layout.maxed=null;
  applyLayout();
  document.querySelectorAll("[data-home]").forEach(function(b){ b.setAttribute("aria-pressed", b.dataset.home===kind?"true":"false"); });
  bubble(h.msg, "agent");
  stream("home → "+kind+" (canvas arranged, remembered)");
  fetch(apiUrl("/api/learn"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({type:"home",kind:kind})}).catch(function(){});
}
document.querySelectorAll("[data-home]").forEach(function(b){
  b.addEventListener("click", function(){ goHome(b.dataset.home); });
});
document.querySelectorAll("[data-app]").forEach(function(b){
  b.addEventListener("click", function(){
    window.open(b.dataset.app, "_blank");
    bubble(b.textContent+" opened in your real browser — Profiles stays on top as your layer (ask, notes, staging all still work). If you would rather keep it inside, paste the address into the Browser pane instead.", "agent");
  });
});
if($("driveBtn")) $("driveBtn").addEventListener("click", function(){
  var u=$("urlInput").value.trim();
  if(u && !/^https?:\/\//i.test(u)) u="https://"+u;
  $("driveLine").textContent="preparing…";
  fetch(apiUrl("/api/browser/prepare"),{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({url:u, actions:[{type:"goto"},{type:"title"},{type:"screenshot"}]})})
  .then(function(r){ return r.json(); }).then(function(prep){
    if(!prep.ok){ $("driveLine").textContent=""; bubble("Browser-act refused: "+prep.error, "agent"); return; }
    $("driveLine").textContent="";
    if(!window.confirm("Let the agent drive?\n\n"+prep.summary+"\n\nToken expires in 60 seconds.")) { bubble("Cancelled — nothing drove anywhere.", "sys"); return; }
    bubble("Driving (confirmed): "+prep.summary, "agent");
    fetch(apiUrl("/api/browser/run"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:prep.token})})
    .then(function(r){ return r.json(); }).then(function(out){
      if(!out.ok){ bubble("Browser-act failed: "+out.error, "agent"); return; }
      var title=(out.results.find(function(x){ return x.type==="title"; })||{}).title||"";
      var shot=(out.results.find(function(x){ return x.type==="screenshot"; })||{}).path||"";
      bubble("Drove it. Page title: “"+title+"”."+(shot?(" Screenshot receipt: "+shot+" (Document pane shows staged items; receipts live with them)."):""), "agent");
      stream("browser-act ✓ "+u+" — title “"+title+"”"+(shot?(" · "+shot):""));
      loadStaged();
    }).catch(function(){ bubble("Browser-act unreachable — is npm start running?", "agent"); });
  }).catch(function(){ $("driveLine").textContent=""; bubble("Could not prepare browser-act.", "agent"); });
});
if($("openExternal")) $("openExternal").addEventListener("click", function(){
  var u=$("urlInput").value.trim();
  if(u && !/^https?:\/\//i.test(u)) u="https://"+u;
  if(u) window.open(u, "_blank");
});
function setDetail(sleek){
  document.body.dataset.detail=sleek?"sleek":"detailed";
  ["detailToggle","chatDetailToggle"].forEach(function(id){ var b=$(id); if(b) b.textContent=sleek?"Sleek":"Detailed"; });
  postConfig({slot:{agentDetail:sleek?"sleek":"detailed"}});
}
if($("chatDetailToggle")) $("chatDetailToggle").addEventListener("click", function(){
  setDetail(document.body.dataset.detail!=="sleek");
});
if($("detailToggle")) $("detailToggle").addEventListener("click", function(){
  var sleek=document.body.dataset.detail!=="sleek";
  document.body.dataset.detail=sleek?"sleek":"detailed";
  $("detailToggle").textContent=sleek?"Sleek":"Detailed";
  postConfig({slot:{agentDetail:sleek?"sleek":"detailed"}});
  bubble(sleek?"Sleek — reasoning and tool calls tucked away; you see the answer and the status, nothing dirty.":"Detailed — full chain: stages, reasoning lines and tool calls, as they happen.", "sys");
});

/* ---- smart reorganise: learned linkage first, best practice second ---- */
function reorganise(){
  fetch(apiUrl("/api/preferences?current="+encodeURIComponent(state.mode))).then(function(r){ return r.json(); }).then(function(res){
    var prefs=(res&&res.preferences)||{};
    var groups=prefs.linkedGroups||[];
    var order, why;
    if(groups.length){
      var linked=[]; groups.forEach(function(g){ g.panes.forEach(function(id){ if(linked.indexOf(id)<0) linked.push(id); }); });
      order=["pane-chat"].concat(linked.filter(function(id){ return id!=="pane-chat"; }));
      PANES.forEach(function(id){ if(order.indexOf(id)<0) order.push(id); });
      why="based on what you actually use together (learned locally: "+groups.map(function(g){ return g.panes.map(function(id){ return PANE_LABELS[id]; }).join(" + "); }).join("; ")+")";
    } else {
      order=["pane-chat","pane-browser","pane-doc","pane-notes","pane-agent","pane-activity","pane-setup","pane-video"];
      why="best practice: chat first, content you are consuming next, your notes beside it, agent receipts after";
    }
    state.layout.order=order;
    state.layout.hidden=state.layout.hidden.filter(function(id){ return id==="pane-notes" ? false : true; });
    /* reveal the linked set, keep the rest a tab away */
    var keep=order.slice(0,5);
    state.layout.hidden=PANES.filter(function(id){ return keep.indexOf(id)<0; });
    state.layout.maxed=null;
    applyLayout();
    bubble("Re-organised — "+why+". Drag with 📌 to override me; I learn from where things stay.", "agent");
    stream("layout — smart reorganise ("+(groups.length?"learned linkage":"best practice")+")");
  }).catch(function(){ bubble("I could not read my local memory just now — is npm start running? Nothing moved.", "agent"); });
}

/* ---- notes pane: per-slot scratch, saved as you type ---- */
var notesTimer=null;
if($("notesArea")){
  $("notesArea").addEventListener("input", function(){
    clearTimeout(notesTimer);
    notesTimer=setTimeout(function(){
      fetch(apiUrl("/api/notes"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:$("notesArea").value})})
        .then(function(){ $("notesLine").textContent="Saved · "+now()+" · this profile only"; }).catch(function(){});
    }, 600);
  });
}
function loadNotes(){
  fetch(apiUrl("/api/notes")).then(function(r){ return r.json(); }).then(function(res){ if($("notesArea")) $("notesArea").value=res.text||""; }).catch(function(){});
  loadSketch();
}

/* ---- sketch: native paint pass-through, out of the box ----
   Minimal + persistent: ink + size, undo, clear, Export PNG.
   Strokes persist per profile on this device (localStorage) so a
   reload keeps the drawing; Export downloads it for documents. */
var sketchStrokes=[], sketchDrawing=false, sketchLast=null, sketchTimer=null;
function sketchKey(){ return "profilesSketch_"+(state.slot||"A"); }
function sketchCtx(){
  var c=$("sketchCanvas"); if(!c) return null;
  return c.getContext("2d");
}
function sketchSetupCanvas(){
  var c=$("sketchCanvas"); if(!c || c._setup) return;
  c._setup=true;
  var ratio=1;
  try{ ratio=Math.min(2, window.devicePixelRatio||1); }catch(e){}
  var w=c.width, h=c.height;
  c.width=w*ratio; c.height=h*ratio;
  c.style.aspectRatio=w+"/"+h;
  var ctx=c.getContext("2d"); ctx.scale(ratio, ratio);
  ctx.lineCap="round"; ctx.lineJoin="round";
  redrawSketch();
}
function sketchPos(e){
  var c=$("sketchCanvas"), r=c.getBoundingClientRect();
  var x=(e.clientX-r.left)*(c.width/(window.devicePixelRatio>1?Math.min(2,window.devicePixelRatio||1):1))/r.width;
  var y=(e.clientY-r.top)*(c.height/(window.devicePixelRatio>1?Math.min(2,window.devicePixelRatio||1):1))/r.height;
  return {x:x, y:y};
}
function redrawSketch(){
  var c=$("sketchCanvas"), ctx=sketchCtx(); if(!c||!ctx) return;
  var ratio=1; try{ ratio=Math.min(2, window.devicePixelRatio||1); }catch(e){}
  ctx.save(); ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,c.width,c.height);
  ctx.restore();
  ctx.save(); try{ ctx.scale(ratio,ratio); }catch(e){}
  var cssW=c.width/ratio, cssH=c.height/ratio;
  ctx.fillStyle="#ffffff"; ctx.fillRect(0,0,cssW,cssH);
  sketchStrokes.forEach(function(s){
    ctx.strokeStyle=s.color||"#155eef"; ctx.lineWidth=s.size||3;
    ctx.beginPath();
    s.pts.forEach(function(pt,idx){ if(idx===0) ctx.moveTo(pt.x,pt.y); else ctx.lineTo(pt.x,pt.y); });
    if(s.pts.length===1){ ctx.lineTo(s.pts[0].x+0.5, s.pts[0].y+0.5); }
    ctx.stroke();
  });
  ctx.restore();
}
function persistSketch(){
  clearTimeout(sketchTimer);
  sketchTimer=setTimeout(function(){
    try{ localStorage.setItem(sketchKey(), JSON.stringify(sketchStrokes.slice(-400))); }catch(e){}
    var l=$("sketchLine"); if(l) l.textContent="Sketch saved on this device · "+now()+" · Export downloads it for documents.";
  }, 500);
}
function loadSketch(){
  sketchSetupCanvas();
  try{
    var raw=localStorage.getItem(sketchKey());
    sketchStrokes=raw?JSON.parse(raw):[];
    if(!Array.isArray(sketchStrokes)) sketchStrokes=[];
  }catch(e){ sketchStrokes=[]; }
  redrawSketch();
}
(function initSketch(){
  var c=null;
  function bind(){
    c=$("sketchCanvas"); if(!c){ setTimeout(bind, 500); return; }
    sketchSetupCanvas(); loadSketch();
    var color=$("sketchColor"), size=$("sketchSize");
    function cur(){ return {color:color?color.value:"#155eef", size:size?Number(size.value):3}; }
    c.addEventListener("pointerdown", function(e){
      e.preventDefault();
      try{ c.setPointerCapture(e.pointerId); }catch(err){}
      sketchDrawing=true;
      var p=sketchPos(e), s=cur();
      sketchLast={color:s.color, size:s.size, pts:[p]};
      sketchStrokes.push(sketchLast);
      redrawSketch();
    });
    c.addEventListener("pointermove", function(e){
      if(!sketchDrawing || !sketchLast) return;
      e.preventDefault();
      sketchLast.pts.push(sketchPos(e));
      redrawSketch();
    });
    function endStroke(){ if(sketchDrawing){ sketchDrawing=false; sketchLast=null; persistSketch(); } }
    c.addEventListener("pointerup", endStroke);
    c.addEventListener("pointercancel", endStroke);
    c.addEventListener("pointerleave", endStroke);
    if($("sketchUndo")) $("sketchUndo").addEventListener("click", function(){
      sketchStrokes.pop(); redrawSketch(); persistSketch();
    });
    if($("sketchClear")) $("sketchClear").addEventListener("click", function(){
      if(!sketchStrokes.length) return;
      sketchStrokes=[]; redrawSketch(); persistSketch();
      var l=$("sketchLine"); if(l) l.textContent="Sketch cleared.";
    });
    if($("sketchSave")) $("sketchSave").addEventListener("click", function(){
      try{
        var url=c.toDataURL("image/png");
        var a=document.createElement("a");
        a.href=url; a.download="profiles-sketch-"+(state.slot||"A")+".png";
        document.body.appendChild(a); a.click(); a.remove();
        var l2=$("sketchLine"); if(l2) l2.textContent="Exported PNG — attach it to any document.";
      }catch(e){
        var l3=$("sketchLine"); if(l3) l3.textContent="Export failed in this browser — screenshot the canvas instead.";
      }
    });
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();


/* ---- video pane ---- */
if($("videoForm")) $("videoForm").addEventListener("submit", function(e){
  e.preventDefault();
  var u=$("videoInput").value.trim(); if(!u) return;
  var box=$("videoBox"); box.textContent="";
  var yt=u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  if(yt){
    var f=document.createElement("iframe");
    f.src="https://www.youtube-nocookie.com/embed/"+yt[1];
    f.className="browserframe"; f.title="Video"; f.setAttribute("allowfullscreen","");
    box.appendChild(f);
  } else if(/\.mp4($|\?)/i.test(u)){
    var v=document.createElement("video"); v.src=u; v.controls=true; v.style.width="100%"; box.appendChild(v);
  } else {
    var f2=document.createElement("iframe"); f2.src=u; f2.className="browserframe"; f2.title="Video page"; box.appendChild(f2);
  }
  showPaneEl("pane-notes", true); /* notes belong beside video */
  bubble("Playing. Your notes pane is beside it — ask me questions while it runs; I notice video + notes + chat belong together (locally only).", "agent");
});

/* ---- linkage polling: light, local, only while you look (20s) ---- */
setInterval(function(){
  if(document.visibilityState!=="visible" || !state.agentOk) return;
  fetch(apiUrl("/api/learn"),{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({type:"context", panes:PANES.filter(paneVisible), mode:state.mode})}).catch(function(){});
}, 20000);

/* ---- agent presence: always on, no toggle, honest badge ---- */
/* boot handled above (proxied home); nothing to fetch */
var bootBuild=null;
if($("updatePill")) $("updatePill").addEventListener("click", function(){ location.reload(); });
function checkBuild(h){
  if(!h || !h.build) return;
  if(!bootBuild){ bootBuild=h.build; return; }
  if(h.build!==bootBuild){
    var pill=$("updatePill");
    if(pill){ pill.hidden=false; }
    stream("update available ("+h.build+") — reload to run the newest build");
  }
}
setInterval(function(){
  if(document.visibilityState!=="visible") return;
  fetch(apiUrl("/api/health")).then(function(r){ return r.json(); }).then(checkBuild).catch(function(){});
}, 30000);
function bootAgent(){
  fetch(apiUrl("/api/health")).then(function(r){ return r.json(); }).then(function(h){
    checkBuild(h);
    state.agentOk=true;
    $("brainBadge").textContent="agent on · local";
    $("agentStatusText").textContent="lite agent on — ask in chat; detail lands here";
    bubble("Hello. I am your lite agent — always on, local, and I answer here in chat. Ask me anything: chat, search, open pages, draft documents.", "agent");
    stream("lite agent ON — "+h.brain);
  }).catch(function(){
    /* never dead, never apologising about plumbing: retry quietly and
       answer with the in-page lite brain meanwhile */
    state.agentOk=false;
    $("brainBadge").textContent="agent · lite";
    setTimeout(bootAgent, 4000);
  });
}

/* ---- boot ---- */
seed();
applyLayout();
(function(){
  var sp=new URLSearchParams(location.search);
  var raw=sp.get("mode")||"Vibes";
  if(sp.get("mode")) state.urlMode=true;
  var m=canonicalMode(raw)||"Vibes";
  if(!MODES[m]) m="Vibes";
  setMode(m,"opening demo");
  updateModelLine();
  bindAdaptive(); updateXmaxVisibility();
  bootPacks();
  bootAgent();
  loadConfig(); loadAppConfig(); loadMacros(); loadNotes(); renderBuild(); applyZoom(false); applyAllPaneZooms();
  var pane=sp.get("pane"); if(pane && PANES.indexOf("pane-"+pane)>=0) showPane("pane-"+pane);
  var q=sp.get("ask");
  if(q) setTimeout(function(){ ask(q.slice(0,120)); }, 600);
})();
