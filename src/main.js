/* Profiles v3 frontend — chat-first canvas: blank box + panes you align.
   Lite agent ALWAYS ON (local sidecar); answers land in chat, the Pi-loop
   detail lives in the Agent pane. Pack-wired, governor-enforced. */
"use strict";
window.__profilesUiLoaded=new Date().toISOString().slice(11,16)+" UTC";
function $(id){ return document.getElementById(id); }
function apiBase(){
  if(window.__PROFILES_STANDALONE__===true) return "";
  if(window.__PROFILES_API_BASE__) return window.__PROFILES_API_BASE__;
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
function apiUrl(p){
  var person=typeof state!=="undefined" && state && (state.expectSlot||state.slot);
  var url=apiBase()+p+(person?(p.indexOf("?")<0?"?":"&")+"profileSlot="+encodeURIComponent(person):"");
  if(/^\/api\/ask(?:\/|$)/.test(p) && window.ProfilesBrowserPane && browserPaneReady){
    url+=(url.indexOf("?")<0?"?":"&")+"tabId="+encodeURIComponent(ProfilesBrowserPane.getActiveTab().id);
  }
  return url;
}
/* ---- standalone portability: parent Rust injects window.__PROFILES_STANDALONE__ when the Node/project backend is missing. Full backend path stays unchanged; every branch below is standalone-only. ---- */
function isStandalone(){ return window.__PROFILES_STANDALONE__===true; }
function standaloneDefaults(){ return {name:"",buddy:"person",metaMode:"Vibes",guided:true,kids:false,advanced:false,brain:"lite",agentModel:"lite",cloudEnabled:false,cloudModel:"muse-spark-1.3-contributor",voiceOut:false,intensity:"full",privateMode:false,wholeMachine:false,piBrain:false,agentTraces:true,agentTools:false,layout:null,closedPanes:[]}; }
function standaloneKey(s){ return "profilesStandaloneCfg_"+(s||"A"); }
function standaloneRead(s){ try{ var raw=localStorage.getItem(standaloneKey(s)); if(raw) return Object.assign(standaloneDefaults(),JSON.parse(raw)); }catch(e){} return standaloneDefaults(); }
function standaloneWrite(s,cfg){ try{ localStorage.setItem(standaloneKey(s),JSON.stringify(cfg||{})); }catch(e){} }
function standaloneAppRead(){ try{ var raw=localStorage.getItem("profilesStandaloneApp"); if(raw) return Object.assign({showX:false,extraSlots:[]},JSON.parse(raw)); }catch(e){} return {showX:false,extraSlots:[]}; }
function standaloneAppWrite(app){ try{ localStorage.setItem("profilesStandaloneApp",JSON.stringify(app||{})); }catch(e){} }
function standalonePostApp(patch){ standaloneAppWrite(Object.assign(standaloneAppRead(),patch)); standaloneLoadApp(); return Promise.resolve(state.appCfg); }
function standaloneUnavailable(what){ bubble((what||"That")+" needs the optional Node backend (npm start) — Basic browsing + read work now; nothing simulated.", "sys"); }
function standaloneLoadConfig(){ var s=state.expectSlot||state.slot||"A"; var cfg=standaloneRead(s); applyConfig({profile:cfg,slot:s}); }
function standalonePostConfig(patch){ var target=state.slot||"A"; var cfg=standaloneRead(target); if(patch&&patch.reset){ cfg=standaloneDefaults(); } if(patch&&patch.slot){ cfg=Object.assign({},cfg,patch.slot); } standaloneWrite(target,cfg); var res={profile:cfg,slot:target}; if(state.slot===target&&!state.expectSlot) applyConfig(res); return Promise.resolve(res); }
function standaloneSwitchSlot(s){ if(s===state.slot&&!state.expectSlot) return; state.expectSlot=s; try{ localStorage.setItem("profilesStandaloneSlot",s); }catch(e){} var cfg=standaloneRead(s); applyConfig({profile:cfg,slot:s}); }
function standaloneLoadApp(){ var ac=standaloneAppRead(); state.appCfg=ac; if($("slotX")) $("slotX").hidden=!ac.showX; if($("showXToggle")) $("showXToggle").checked=!!ac.showX; var extra=ac.extraSlots||[]; if($("slotD")) $("slotD").hidden=extra.indexOf("D")<0; if($("slotE")) $("slotE").hidden=extra.indexOf("E")<0; if($("extraSlotsToggle")) $("extraSlotsToggle").checked=extra.length>0; if(typeof updateAdvancedVisibility==="function") updateAdvancedVisibility(); if(typeof refreshProfileXStatus==="function") refreshProfileXStatus(); }
function standaloneIsCurrentPageAsk(q){ return /\b(?:this|current|the)\s+(?:web\s*)?page\b/i.test(String(q||""))&&!/\b(?:open|navigate|visit|go to|search the web)\b/i.test(String(q||"")); }
async function runStandalone(q){
  state.runCount++; askBusy=true;
  var runSlot=state.slot, startedAt=Date.now();
  var activity=document.createElement("div"); activity.className="bubble agent agent-activity";
  if($("chatLog")) $("chatLog").appendChild(activity);
  if($("agentStatus")) $("agentStatus").classList.add("working");
  if($("agentStatusText")) $("agentStatusText").textContent="Working — Basic tools";
  function said(text,kind){ if(state.slot!==runSlot) return; clearThinking(); if(text) bubble(text,"agent"); if(kind) logLine(kind,"tool"); if($("chatLog")) $("chatLog").scrollTop=$("chatLog").scrollHeight; }
  try{
    var routing=null;
    try{ routing=await import("./agent-routing.mjs"); }
    catch(e){ said("Basic tools router is not bundled yet (agent-routing.mjs missing) — I can still open an exact URL from the address bar, or read the current page. No model was called.","router unavailable"); return; }
    var decision=routing.decideTool(q);
    if(!decision&&standaloneIsCurrentPageAsk(q)){ decision={tool:"browser_read",args:{}}; }
    if(!decision){
      said("Basic tools only (Node backend missing — no model called). I can open a site or exact URL, read the current page, or search the web and show it in the Browser pane. Models, notes, staging, and setup need npm start.","basic tools — no model");
      return;
    }
    if(decision.tool==="browser_open"){
      showPaneEl("pane-browser",true);
      var out=await ProfilesBrowserPane.navigate(decision.args.url);
      if(state.slot!==runSlot) return;
      if(out&&out.ok){ said("Opened "+(out.url||decision.args.url)+" — live in the Browser pane. Say \u201cread this page\u201d and I will read what is actually displayed.","opened "+(out.url||decision.args.url)); }
      else{ said("I could not open "+decision.args.url+" ("+((out&&out.error)||"unavailable")+"). The page was not replaced.","open failed"); }
      return;
    }
    if(decision.tool==="browser_click"){
      showPaneEl("pane-browser",true);
      var out=await ProfilesBrowserPane.click(decision.args||{});
      if(state.slot!==runSlot) return;
      if(out&&out.ok){ said("Clicked "+(decision.args&&(decision.args.selector||""))+" — live in the Browser pane.","clicked "+((out&&out.clicked)||"page")); }
      else{ said("I could not click that ("+((out&&out.error)||"unavailable")+").","click failed"); }
      return;
    }
    if(decision.tool==="browser_read"||decision.tool==="browser_current"){
      var cur=decision.tool==="browser_current"?await ProfilesBrowserPane.current():await ProfilesBrowserPane.read();
      if(state.slot!==runSlot) return;
      if(cur&&cur.ok){ var head=(cur.title?cur.title+" — ":"")+(cur.url||""); var body=String((cur.text||"")).slice(0,900); said((decision.tool==="browser_current"?"Browser is on "+head+". ":"Currently displayed page "+head+". ")+(body||"No readable text yet — the page may still be loading."),"read current page"); }
      else{ said("I could not read the current page ("+((cur&&cur.error)||"unavailable")+"). Open a site first, then ask again.","read failed"); }
      return;
    }
    if(decision.tool==="web_search"){
      var url=searchUrl(decision.args.query);
      showPaneEl("pane-browser",true);
      var nav=await ProfilesBrowserPane.navigate(url);
      if(state.slot!==runSlot) return;
      if(nav&&nav.ok){ said("Searching \u201c"+decision.args.query+"\u201d — live in the Browser pane ("+(nav.url||url)+"). Tell me which result fits, or say open <site/URL>; I never auto-open the first hit.","searched "+decision.args.query); }
      else{ said("Web search \u201c"+decision.args.query+"\u201d could not run ("+((nav&&nav.error)||"unavailable")+"). Try opening a site directly.","search failed"); }
      return;
    }
    if(decision.tool==="open_result"){ said("Numbered results need the Node backend to list safely — the search page is showing in the Browser pane. Tell me the site name or exact URL and I will open it; I will not auto-open the top hit.","open_result needs backend"); return; }
    if(decision.tool==="doc_open"){var docResult=await readDocument({url:decision.args.url});said(docResult.ok?"Opened "+docResult.title+" in the Document reader.":docResult.error,"local document reader");return;}
    if(decision.tool==="doc_paste_hint"){showPaneEl("pane-doc",true);said("Choose a local document, enter its link, or paste text in the Document pane.","document input required");return;}
    said("Basic tools only (Node backend missing — no model called). I can open a site or exact URL, read the current page, or search the web and show it in the Browser pane.","basic tools — no model");
  }finally{
    askBusy=false;
    if($("agentStatus")) $("agentStatus").classList.remove("working");
    if(state.slot===runSlot){ state.lastLatency=Date.now()-startedAt; if($("agentStatusText")) $("agentStatusText").textContent="Finished — Basic tools (no model)"; if(activity&&!activity.children.length) activity.remove(); }
  }
}
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
  babylite:{label:"babylite · soft + simple",   motion:0,  sim:0, tick:900,  speech:"terse",
             note:"babylite — soft baby-blue, big targets, one thing, always asks. Governor: motion 0%, 0 simultaneous, flash 0/s (capped). Agent simple/asks-first, parallelism 1."},
  chill:   {label:"chill · warm and slow",      motion:35, sim:1, tick:2600, speech:"sparse",
             note:"chill — warm, slow, rest reminders. Governor: motion 35%, 1 simultaneous, flash 0/s (capped). Agent brief/checkpointed, parallelism 1."},
  FOCUSMAX:{label:"FOCUSMAX · mono-task",       motion:10, sim:1, tick:1000, speech:"terse",
             note:"FOCUSMAX — mono-task, distractions held. Governor: motion 10%, 1 simultaneous, flash 0/s (capped). Agent terse/suggest-only, parallelism 1."},
  Vibes:   {label:"Vibes · full energy",        motion:100,sim:4, tick:700,  speech:"full",
             note:"Vibes — fun, fluent, energetic, parallel agent, proactive, checkpointed before anything irreversible. Governor: motion 100%, 4 simultaneous, flash 0/s (capped). Agent verbose/act-with-checkpoint, parallelism 4."},
  calm:    {label:"calm · sensory panic button",motion:0,  sim:0, tick:4200, speech:"quiet",
             note:"calm — sensory panic button: motion stops, palette softens, agent terse and mono-task. Governor: motion 0%, 0 simultaneous, flash 0/s (capped). Agent terse/suggest-only, parallelism 1."},
  xMAX:    {label:"xMAX · parallel storm",      motion:100,sim:6, tick:450,  speech:"full",
             note:"xMAX — Vibes + FOCUSMAX hybrid: crisp, quick, heavy parallelism (Profile X only). Governor: motion 100%, 6 simultaneous, flash 0/s (capped). Agent verbose/act-with-checkpoint, parallelism 6."}
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
var state={mode:"Vibes", routing:false, auto:false, agentOk:false, timer:null, modeSince:Date.now(), suggestChecked:false, slot:"A", expectSlot:null, layout:{order:null,hidden:["pane-agent","pane-doc","pane-notes","pane-video","pane-setup","pane-activity"],maxed:null},
  stage:-1, runCount:0, bg:0, switches:[], cfg:null, speak:false, setupPlan:null, traces:true, tools:false, model:null, demoMode:false, reasoningEffort:null, lastLatency:0, lastTier:""};
if(isStandalone()){try{var savedSlot=localStorage.getItem("profilesStandaloneSlot");if(/^[ABCDEX]$/.test(savedSlot||"")) state.slot=savedSlot;}catch(e){}}

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
    $(id).style.flex=g ? g+" 1 0px" : "";
  });
  canvas.classList.toggle("maxed", !!state.layout.maxed);
  renderPaneTabs();
  if(browserPaneReady) {
    ProfilesBrowserPane.setVisible(paneVisible("pane-browser") && (!state.layout.maxed || state.layout.maxed==="pane-browser"));
    ProfilesBrowserPane.resize();
  }
  persistLayout();
}
function renderPaneTabs(){
  var bar=$("paneTabs"); if(!bar) return;
  bar.textContent="";
  var minimised=state.layout.minimised||[];
  (state.layout.order||PANES).forEach(function(id){
    var isMin=minimised.indexOf(id)>=0;
    var isVis=paneVisible(id);
    if(!isVis && !isMin) return;
    var b=document.createElement("button"); b.type="button";
    b.title=PANE_LABELS[id]+(isMin?" (minimised — click to restore)":"");
    b.setAttribute("aria-label",PANE_LABELS[id]);
    b.classList.toggle("minTab",isMin);
    b.setAttribute("aria-selected",isVis?"true":"false");
    var lab=document.createElement("span"); lab.className="paneicon"; lab.innerHTML=PANE_ICONS[id]||PANE_LABELS[id];
    var x=document.createElement("span"); x.className="x"; x.textContent="×"; x.title="Close pane (reopen any time)";
    x.addEventListener("click", function(ev){ ev.stopPropagation(); hidePane(id); });
    b.appendChild(lab); b.appendChild(x);
    b.style.zIndex=String(1000-bar.children.length);
    b.addEventListener("click", function(){
      if(isMin) unminimisePane(id);
      else focusPane(id);
    });
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
  add.style.zIndex="1";
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
if($("darkBtn")) $("darkBtn").addEventListener("click", function(){ toggleWebDark(false); });
paintDarkBtn();
if($("trashBtn")) $("trashBtn").addEventListener("click", function(){
  var pop=$("trashPop");
  pop.hidden=!pop.hidden;
  if(!pop.hidden) renderTrash();
});
document.querySelectorAll("[data-close]").forEach(function(b){
  b.addEventListener("click", function(){ hidePane(b.dataset.close); });
});
/* Browser content zoom never changes the surface's layout bounds. */
var browserPaneReady=false, appZoom=1, paneZoom={}, pageZoom=1, activePane=null;
function fitBrowserView(){ if(browserPaneReady) ProfilesBrowserPane.resize(); }
try{ appZoom=Math.min(2,Math.max(0.5,Number(localStorage.getItem("profilesZoom"))||1)); }catch(e){}
try{ paneZoom=JSON.parse(localStorage.getItem("profilesPaneZoom")||"{}")||{}; }catch(e){}
try{ pageZoom=Math.min(2,Math.max(0.5,Number(localStorage.getItem("profilesPageZoom"))||1)); }catch(e){}
paneZoom["pane-browser"]=pageZoom;
function paneEl(id){ return $(id); }
function clampZoom(z){ return Math.min(2,Math.max(0.5,Math.round(z*10)/10)); }
function zoomBadge(text){
  var b=$("zoomBadge"); if(!b) return;
  b.textContent=text; b.hidden=false; clearTimeout(b._t);
  b._t=setTimeout(function(){ b.hidden=true; },1200);
}
function applyPageZoom(showBadge){
  paneZoom["pane-browser"]=pageZoom;
  try{
    localStorage.setItem("profilesPageZoom",String(pageZoom));
    localStorage.setItem("profilesPaneZoom",JSON.stringify(paneZoom));
  }catch(e){}
  if(browserPaneReady) ProfilesBrowserPane.setZoom(pageZoom);
  if(showBadge) zoomBadge("Browser "+Math.round(pageZoom*100)+"%");
}
function applyPaneZoom(id,showBadge){
  if(id==="pane-browser"){ pageZoom=clampZoom(paneZoom[id]||pageZoom); applyPageZoom(showBadge); return; }
  var el=$(id), z=clampZoom(paneZoom[id]||1);
  if(el) el.style.zoom=z;
  try{ localStorage.setItem("profilesPaneZoom",JSON.stringify(paneZoom)); }catch(e){}
  if(showBadge) zoomBadge((PANE_LABELS[id]||id)+" "+Math.round(z*100)+"%");
}
function applyAllPaneZooms(){ Object.keys(paneZoom).forEach(function(id){ applyPaneZoom(id,false); }); }
function applyZoom(showBadge){
  document.body.style.zoom=appZoom;
  try{ localStorage.setItem("profilesZoom",String(appZoom)); }catch(e){}
  if(showBadge) zoomBadge("App "+Math.round(appZoom*100)+"%");
  fitBrowserView();
}
function stepZoom(id,step,reset){
  if(id==="pane-browser"){ pageZoom=reset?1:clampZoom(pageZoom+step); applyPageZoom(true); }
  else if(id){ paneZoom[id]=reset?1:clampZoom((paneZoom[id]||1)+step); applyPaneZoom(id,true); }
  else { appZoom=reset?1:clampZoom(appZoom+step); applyZoom(true); }
}
document.addEventListener("wheel",function(e){
  if(e.defaultPrevented || !(e.ctrlKey||e.metaKey) || !e.deltaY) return;
  e.preventDefault();
  var pane=e.target.closest && e.target.closest(".pane");
  stepZoom(pane?pane.id:null,e.deltaY<0?0.1:-0.1,false);
},{passive:false});
document.addEventListener("keydown",function(e){
  if(e.defaultPrevented || !(e.ctrlKey||e.metaKey) || !/^(0|=|\+|-|_)$/.test(e.key)) return;
  e.preventDefault();
  var pane=e.target.closest && e.target.closest(".pane");
  stepZoom(pane?pane.id:activePane,(e.key==="-"||e.key==="_")?-0.1:0.1,e.key==="0");
});
document.addEventListener("pointerdown",function(e){
  var pane=e.target.closest && e.target.closest(".pane"); activePane=pane?pane.id:null;
},true);
document.addEventListener("focusin",function(e){
  var pane=e.target.closest && e.target.closest(".pane"); activePane=pane?pane.id:null;
});
window.addEventListener("profiles-browser-zoom-step",function(e){
  if(e.detail===0.1||e.detail===-0.1) stepZoom("pane-browser",e.detail,false);
});
window.addEventListener("profiles-browser-zoom",function(e){
  var value=Number(e.detail && (e.detail.zoom || e.detail));
  if(Number.isFinite(value)){ pageZoom=clampZoom(value); paneZoom["pane-browser"]=pageZoom; try{localStorage.setItem("profilesPageZoom",String(pageZoom));localStorage.setItem("profilesPaneZoom",JSON.stringify(paneZoom));}catch(e){} }
});
applyZoom(false);
function showPaneEl(id, silent){
  if(id==="pane-browser") setTimeout(fitBrowserView,0);
  state.layout.hidden=state.layout.hidden.filter(function(x){ return x!==id; });
  state.layout.minimised=(state.layout.minimised||[]).filter(function(x){ return x!==id; });
  var el=$(id);
  if(el){ el.classList.remove("minimised"); el.classList.remove("hiddenPane"); }
  if(state.layout.maxed && state.layout.maxed!==id) state.layout.maxed=null;
  applyLayout();
  if(id==="pane-doc") loadStaged();
  if(id==="pane-setup") loadSetup();
}
function hidePane(id){
  state.layout.minimised=(state.layout.minimised||[]).filter(function(x){ return x!==id; });
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
function minimisePane(id){
  state.layout.minimised = state.layout.minimised || [];
  if(state.layout.minimised.indexOf(id)<0) state.layout.minimised.push(id);
  if(state.layout.hidden.indexOf(id)<0) state.layout.hidden.push(id);
  if(state.layout.maxed===id) state.layout.maxed=null;
  applyLayout();
  bubble((PANE_LABELS[id]||id)+" minimised to tabs above. Tap its tab to reopen.", "sys");
  stream("layout — " + (PANE_LABELS[id]||id) + " minimised to tabs");
}
function unminimisePane(id){
  state.layout.minimised = (state.layout.minimised||[]).filter(function(x){ return x!==id; });
  showPaneEl(id, true);
  focusPane(id);
  stream("layout — " + (PANE_LABELS[id]||id) + " restored from tabs");
}
function toggleMax(id){
  state.layout.maxed = state.layout.maxed===id ? null : id;
  applyLayout();
}
function showPane(id){ focusPane(id); }
document.querySelectorAll("[data-min]").forEach(function(b){
  b.addEventListener("click", function(e){
    e.stopPropagation();
    minimisePane(b.dataset.min);
  });
});
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
    if(b.dataset.menu==="controls"){ var p=$("controlsPop"); if(p){ if(p.hidden) renderControls(); p.hidden=!p.hidden; } return; }
    if(b.dataset.menu==="webdark"){ toggleWebDark(false); return; }
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
  [["addMenu"],["brandMenu"],["trashPop"],["controlsPop"]].forEach(function(pair){
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
  var inControls=t.closest && t.closest("#controlsPop");
  var add=$("addMenu"), brand=$("brandMenu"), trash=$("trashPop"), controls=$("controlsPop");
  if(add && !add.hidden && !inAdd && !addTrigger) add.hidden=true;
  if(brand && !brand.hidden && !inBrand && !brandTrigger){
    brand.hidden=true;
    var bb=$("brandMenuBtn"); if(bb) bb.setAttribute("aria-expanded","false");
  }
  /* recycle bin preview: clicking anywhere outside dismisses immediately */
  if(trash && !trash.hidden && !inTrash && !trashTrigger) trash.hidden=true;
  if(controls && !controls.hidden && !inControls) controls.hidden=true;
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
  var adjustMode=false;
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
      var row=resizing && resizing.row;
      if(row && row.length>1){
        var delta=(dir.indexOf("e")>=0 ? dx : -dx);
        var total=resizing.rowWidth, peerWidth=total-startW;
        var target=Math.max(Math.min(400,startW),Math.min(total-400*(row.length-1),startW+delta));
        state.layout.cols=state.layout.cols||{};
        row.forEach(function(peer){
          var weight=peer.id===el.id ? target : peer.width*(total-target)/peerWidth;
          $(peer.id).style.flex=weight+" 1 0px";
          state.layout.cols[peer.id]=weight;
        });
      }
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
    resizing.row=Array.from(document.querySelectorAll(".canvas > .pane")).map(function(peer){
      var box=peer.getBoundingClientRect();return {id:peer.id,width:box.width,top:box.top};
    }).filter(function(peer){return peer.width>0 && Math.abs(peer.top-r.top)<4;});
    resizing.rowWidth=resizing.row.reduce(function(sum,peer){return sum+peer.width;},0);
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
  function enterAdjustMode(){
    if(unpinned) land();
    adjustMode = true;
    document.body.classList.add("adjusting-layout");
    moved=false; dragId=null;
    if(browserPaneReady) ProfilesBrowserPane.setAdjusting(true);
    var all = Array.from(document.querySelectorAll(".canvas > .pane")).filter(function(p){ return paneVisible(p.id); });
    all.forEach(function(pane){
      pane.classList.add("unpinned");
      addHandles(pane);
    });
    bubble("Adjust mode active — drag boxes to move, drag edges to resize. Press any key or click to lock.", "sys");
    stream("layout — adjust mode active via Super key");
  }
  function landAll(){
    if(!adjustMode) return;
    adjustMode = false;
    document.body.classList.remove("adjusting-layout");
    var all = document.querySelectorAll(".canvas > .pane");
    all.forEach(function(pane){
      removeHandles(pane);
      pane.style.cursor = "";
      if(paneVisible(pane.id)) rememberSize(pane.id);
      pane.classList.remove("unpinned");
    });
    unpinned = null; dragId = null; resizing = null;
    state.layout.order = Array.prototype.slice.call($("canvas").children).map(function(el){ return el.id; })
      .filter(function(id){ return PANES.indexOf(id)>=0; });
    applyLayout();
    if(browserPaneReady) ProfilesBrowserPane.setAdjusting(false);
    bubble("All boxes pinned. Layout remembered for this profile.", "sys");
    stream("layout — all boxes locked");
  }
  function toggleAdjustMode(){
    if(adjustMode) landAll();
    else enterAdjustMode();
  }
  window.toggleAdjustMode = toggleAdjustMode;
  window.isAdjustMode = function(){ return adjustMode; };
  window.dismissAdjustMode = landAll;
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
      if((unpinned!==pane.id && !adjustMode) || resizing) return;
      if(e.button!==undefined && e.button!==0) return; /* left button only */
      if(adjustMode && e.target.closest(".panehead") && !e.target.closest("button,a,input,select,textarea")){
        e.preventDefault(); dragId=pane.id; moved=false;
        try{pane.setPointerCapture(e.pointerId);}catch(err){}
        return;
      }
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
      if(unpinned!==pane.id && !adjustMode) return;
      if(resizing && resizing.id===pane.id){
        var dx=e.clientX-resizing.startX, dy=e.clientY-resizing.startY;
        applyResize(pane, resizing.dir, dx, dy, resizing.startW, resizing.startH);
        e.stopPropagation();
        return;
      }
      if(adjustMode && (dragId!==pane.id || !(e.buttons&1))) return;
      if((!e.buttons || (e.buttons&1)===0) && (!e.pointerType || e.pointerType==="mouse")){
        /* hover affordance: show the resize cursor on any edge/border */
        var hov=(!e.target.classList || isInteractive(e.target)) ? "" : edgeDir(pane, e.clientX, e.clientY);
        pane.style.cursor=hov ? (CURSORS[hov]||"nwse-resize") : "";
      }
      dragId=pane.id;
      if(!moved){ startX=e.clientX; startY=e.clientY; moved=true; return; } /* anchor first: no FLIP churn on hover jitter */
      if(Math.hypot(e.clientX-startX, e.clientY-startY)<7) return; /* 7px glide threshold — small-screen friendly */
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
    pane.addEventListener("pointerup",function(e){
      try{if(pane.hasPointerCapture(e.pointerId)) pane.releasePointerCapture(e.pointerId);}catch(err){}
      if(adjustMode) landAll();
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
  /* outside-land: mouse re-pins on press (instant); touch/pen re-pins on
     tap (press + lift within 12px) so a scroll gesture starting outside
     never yanks a just-unlocked pane away on small touchscreens. */
  var downPos=null, consumeAdjustClick=false;
  document.addEventListener("pointerdown", function(e){
    consumeAdjustClick=false;
    if(resizing) return; /* let the resize finish on pointerup, don't re-pin mid-drag */
    if(adjustMode){
      var pane = e.target.closest && e.target.closest(".pane");
      var onHandle = e.target.classList && e.target.classList.contains("resize-handle");
      var onEdge = pane && edgeDir(pane, e.clientX, e.clientY) && !e.target.closest("button,a,input,select,textarea");
      var onHeader=e.target.closest && e.target.closest(".panehead") && !e.target.closest("button,a,input,select,textarea");
      if(!onHandle && !onEdge && !onHeader){
        landAll();
        consumeAdjustClick=true;
        e.preventDefault(); e.stopImmediatePropagation();
        return;
      }
    }
    downPos={x:e.clientX, y:e.clientY, type:e.pointerType||"mouse"};
    var outside=!(e.target.closest && e.target.closest("#"+unpinned));
    if(unpinned && outside && downPos.type==="mouse") land();
  }, true);
  document.addEventListener("click",function(e){
    if(!consumeAdjustClick) return;
    consumeAdjustClick=false;
    e.preventDefault(); e.stopImmediatePropagation();
  },true);
  document.addEventListener("pointerup", function(e){
    if(resizing || !unpinned){ downPos=null; return; }
    var t=e.pointerType||(downPos&&downPos.type)||"mouse";
    var outsideUp=!(e.target.closest && e.target.closest("#"+unpinned));
    if(t!=="mouse" && downPos && Math.hypot(e.clientX-downPos.x, e.clientY-downPos.y)<12 && outsideUp) land();
    downPos=null;
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
  postConfig({slot:{layout:state.layout}}).catch(function(){});
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
  var explicit=!!(opts&&opts.explicit);
  if(explicit) state.modeExplicit=true;
  /* STICKY-CALM: calm is a manual panic button. Leaving it takes an explicit
     hand (pill click / keys 1-6); adaptive, learned-auto, slot-settle,
     pack-engine and boot-restore never pull out. Entering calm always works. */
  if(state.mode==="calm" && mode!==state.mode && !explicit) return; /* sticky-calm: guard */
  var prevMode=state.mode;
  if(segway){ document.body.classList.add("segwaying"); }
  if(invitesAllowed() || mode==="calm" || mode==="babylite" || mode==="chill"){
    var still=(mode==="calm"||mode==="babylite");
    document.body.classList.toggle("mode-cut", still);
    document.body.classList.toggle("mode-settle", mode==="chill");
    if(!still && mode!=="chill" && !document.hidden){
      var vis=(state.layout.order||PANES).filter(paneVisible);
      vis.forEach(function(id, i){
        var el=$(id); if(!el) return;
        /* Vibes-class celebration, capped: first 4 panes stagger at most 270ms,
           hidden tabs never animate (Chromebook envelope). */
        setTimeout(function(){ el.classList.add("celebrate"); setTimeout(function(){ el.classList.remove("celebrate"); }, 650); }, Math.min(i,3)*90);
      });
      var tabs=$("paneTabs"); if(tabs){ tabs.classList.add("shimmer"); setTimeout(function(){ tabs.classList.remove("shimmer"); }, 900); }
    }
    if(still || mode==="chill") setTimeout(function(){ document.body.classList.remove("mode-cut"); document.body.classList.remove("mode-settle"); }, 1300);
  }
  state.mode=mode;
  var m=MODES[mode];
  document.body.dataset.mode=mode;
  document.body.dataset.intensity = mode==="calm" ? "soft" : ((state.cfg&&state.cfg.intensity)||"full");
  document.body.classList.toggle("gov-freeze", still || m.motion===0);
  document.querySelectorAll(".pills button").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.profile===mode ? "true":"false");
  });
  document.body.style.setProperty("--motion-pct", m.motion+"%"); /* implied, unlabelled */
  $("govNote").textContent=m.note;
  stream("profile → "+m.label+(why?" ("+why+")":"")+" — budget motion "+m.motion+"%, flash 0/s, simult "+m.sim);
  updateModelLine();
  updateXmaxVisibility();
  learnStay(mode, prevMode);
  /* STICKY-PERSIST: an explicit hand owns the slot's memory — save it so
     reload / loadConfig / pack-engine settle restores the pick, not Vibes. */
  if(explicit && mode!==prevMode) postConfig({slot:{metaMode:mode}}); /* sticky-calm: persist */
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
  b.addEventListener("click", function(){ setMode(b.dataset.profile, "you switched", {explicit:true}); });
});
function profileShortcut(key){
  var k=String(key||"").toLowerCase();
  var map={"1":"babylite","2":"chill","3":"FOCUSMAX","4":"Vibes","5":"calm","6":"xMAX"}, slots={a:"A",b:"B",c:"C",x:"X"};
  if(map[k]){
    if(map[k]==="xMAX" && !profileXOn()) return false;
    setMode(map[k],"keyboard",{segway:true,explicit:true}); return true;
  }
  if(slots[k]){
    var button=$("slot"+slots[k]); if(!button || button.hidden) return false;
    switchSlot(slots[k]); return true;
  }
  return false;
}
var superAlone=false, ignoreSuperRelease=false;
function finishSuper(){
  var toggle=superAlone && !ignoreSuperRelease;
  superAlone=false; ignoreSuperRelease=false;
  if(toggle && window.toggleAdjustMode) window.toggleAdjustMode();
}
function dismissAdjust(){
  if(window.isAdjustMode && window.isAdjustMode()){window.dismissAdjustMode();return true;}
  return false;
}
function tabShortcut(key){
  if(!window.ProfilesBrowserPane || !browserPaneReady) return false;
  if(key==="NewTab"){showPaneEl("pane-browser",true);ProfilesBrowserPane.createTab();return true;}
  if(key==="CloseTab"){ProfilesBrowserPane.closeActiveTab();return true;}
  if(key==="NextTab" || key==="PreviousTab"){ProfilesBrowserPane.cycleTab(key==="NextTab"?1:-1);return true;}
  if(key==="Location"){showPaneEl("pane-browser",true);$("urlInput").focus();$("urlInput").select();return true;}
  return false;
}
document.addEventListener("keydown",function(e){
  if(e.repeat && (e.key==="Meta"||e.key==="OS")) return;
  var wasAdjusting=dismissAdjust();
  if(e.key==="Meta"||e.key==="OS"){
    superAlone=!wasAdjusting;ignoreSuperRelease=wasAdjusting;
    return;
  }
  if(wasAdjusting){superAlone=false;e.preventDefault();e.stopImmediatePropagation();return;}
  if(e.metaKey && profileShortcut(e.key)){
    superAlone=false;e.preventDefault();e.stopPropagation();return;
  }
  superAlone=false;
  if(e.ctrlKey||e.metaKey){
    var key=e.key.toLowerCase();
  if(e.metaKey && key==="f1"){superAlone=false;toggleWebDark(false);e.preventDefault();e.stopPropagation();return;}
    var action=key==="t"?"NewTab":key==="w"?"CloseTab":key==="l"?"Location":
      key==="tab"?(e.shiftKey?"PreviousTab":"NextTab"):null;
    if(action && tabShortcut(action)){e.preventDefault();e.stopPropagation();return;}
  }
  if(e.key==="F1"){e.preventDefault();toggleWebDark(false);return;}
  if(e.ctrlKey||e.altKey||e.metaKey||e.defaultPrevented) return;
  if(e.target && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
  if(profileShortcut(e.key)){e.preventDefault();return;}
  if(e.key==="/"){e.preventDefault();focusPane("pane-chat");$("ask").focus();}
},true);
document.addEventListener("keyup",function(e){if(e.key==="Meta"||e.key==="OS") finishSuper();},true);
window.addEventListener("blur",function(){superAlone=false;ignoreSuperRelease=false;});
window.addEventListener("profiles-browser-shortcut",function(e){
  var d=e.detail||{},key=d.key||d;
  if((key==="Meta"||key==="OS") && d.phase==="up"){finishSuper();return;}
  if(d.slot && d.slot.split("--")[0]!==state.slot) return;
  var wasAdjusting=dismissAdjust();
  if(key==="Meta"||key==="OS"){
    superAlone=!wasAdjusting;ignoreSuperRelease=wasAdjusting;return;
  }
  superAlone=false;
  if(wasAdjusting) return;
  if(key==="F1"){superAlone=false;toggleWebDark(false);return;}
  if(!tabShortcut(key)) profileShortcut(key);
});
window.addEventListener("profiles-browser-input",function(e){
  var d=e.detail||{};
  // Native chrome duplicates DOM input; only child views need this bridge.
  if(!d.slot || d.slot.split("--")[0]!==state.slot) return;
  if(d.kind==="key"){ superAlone=false; if(d.key==="F1"){ toggleWebDark(false); return; } }
  dismissAdjust();
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
  followLatestChat();
  if(who==="agent" && state.speak) speakText(text);
}
var chatFollow=true, chatWidth=$("chatLog").clientWidth, chatHeight=$("chatLog").clientHeight;
function followLatestChat(){chatFollow=true;var log=$("chatLog");log.scrollTop=log.scrollHeight;}
$("chatLog").addEventListener("scroll",function(){
  var log=$("chatLog");
  if(log.clientWidth===chatWidth && log.clientHeight===chatHeight)
    chatFollow=log.scrollHeight-log.scrollTop-log.clientHeight<24;
},{passive:true});
new ResizeObserver(function(){
  var log=$("chatLog");
  if(chatFollow) log.scrollTop=log.scrollHeight;
  chatWidth=log.clientWidth;chatHeight=log.clientHeight;
}).observe($("chatLog"));
var STAGES=["sense","plan","act","verify","remember"];
function paintStages(cur){
  document.querySelectorAll("#stages span").forEach(function(c){
    var i=STAGES.indexOf(c.dataset.stage);
    c.classList.toggle("hit", i===cur);
    c.classList.toggle("past", i<cur || cur===99);
  });
}
function lineKind(text){
  var t=String(text||"");
  if(/^\s*(→|!)/.test(t)) return "info";
  if(/tool|browser_open|browser_read|doc_open|doc_paste|web_search|staged|macro|opened .*pane|live in (the )?(browser|document)/i.test(t)) return "tool";
  return "trace";
}
function logLine(text, kind){
  var li=document.createElement("li");
  var k=kind||lineKind(text);
  li.dataset.kind=k;
  if(k==="tool") li.className="tool-line";
  var t=document.createElement("time"); t.textContent=now();
  li.appendChild(t); li.appendChild(document.createTextNode(text));
  var log=$("agentLog");
  log.appendChild(li);
  while(log.children.length>40) log.removeChild(log.firstChild);
  log.scrollTop=log.scrollHeight;
  applyToggleVisibility();
}

/* Events are painted when received, never replayed as simulated thinking. */
var askCtrl=null, askBusy=false;
function selectedModelKey(){var c=state.cfg||{};return JSON.stringify([c.agentModel,c.cloudEnabled,c.cloudModel,c.cloudBase,c.localBase,c.localModel,c.modelFile,c.localSource]);}
async function runReal(q){
  if(isStandalone()) return;
  state.runCount++; askBusy=true;
  var runSlot=state.slot, startedAt=Date.now(), controller=new AbortController();
  var runModelKey=selectedModelKey();
  var runDocGeneration=docRequestGeneration;
  askCtrl=controller;
  var timer=setTimeout(function(){ controller.abort(); },120000);
  var activity=document.createElement("div"); activity.className="bubble agent agent-activity";
  $("chatLog").appendChild(activity);
  $("agentStatus").classList.add("working");
  $("agentStatusText").textContent="Working — "+((state.model&&state.model.name)||"basic tools");
  function eventReceived(ev){
    if(state.slot!==runSlot) return;
    clearThinking();
    var kind=ev.kind || (ev.type==="tool"?"tool":"trace");
    logLine(ev.text,kind); paintStages(STAGES.indexOf(ev.stage));
    var row=document.createElement("div"); row.dataset.kind=kind; row.className="agent-event";
    row.textContent=ev.text; activity.appendChild(row);
    followLatestChat();
  }
  try{
    if(window.ProfilesNativeBrowser && ProfilesNativeBrowser.available){
      var browserReady=false, readyUntil=Date.now()+5000;
      while(Date.now()<readyUntil){
        if(state.slot!==runSlot) return;
        var health=await fetch(apiUrl("/api/health"),{signal:controller.signal}).then(function(r){return r.json();});
        if(health.nativeBrowserReady){browserReady=true;break;}
        await new Promise(function(resolve){setTimeout(resolve,100);});
      }
      if(!browserReady) throw new Error("The displayed browser has not connected yet. No action was sent.");
    }
    var response=await fetch(apiUrl("/api/ask/stream"),{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({query:q,mode:state.mode,device:"desktop"}),signal:controller.signal});
    if(!response.ok) throw new Error("HTTP "+response.status);
    var finalReply=null, buffer="";
    function consume(line){
      if(!line.trim()) return;
      var item=JSON.parse(line);
      if(item.type==="event") eventReceived(item.event);
      if(item.type==="result") finalReply=item.result;
      if(item.type==="error") throw new Error(item.error);
    }
    if(response.body && response.body.getReader){
      var reader=response.body.getReader(), decoder=new TextDecoder();
      for(;;){
        var chunk=await reader.read();
        if(chunk.done) break;
        buffer+=decoder.decode(chunk.value,{stream:true});
        var lines=buffer.split("\n"); buffer=lines.pop(); lines.forEach(consume);
      }
      buffer+=decoder.decode(); if(buffer) consume(buffer);
    }else (await response.text()).split("\n").forEach(consume);
    if(!finalReply) throw new Error("Agent connection ended without a result");
    if(state.slot!==runSlot) return;
    var res=finalReply;
    paintStages(99);
    bubble(res.chat || res.result || res.error || "No answer was returned.","agent");
    if((res.selectedModel || res.model) && runModelKey===selectedModelKey()) paintBadge(res.selectedModel || res.model);
    state.lastLatency=Date.now()-startedAt; state.lastTier=(res.pick&&res.pick.tier)||"";
    if(res.ui && res.ui.showPane) showPaneEl(res.ui.showPane,true);
    if(res.ui && res.ui.browser) browserShow(res.ui.browser);
    if(res.ui && res.ui.doc && runDocGeneration===docRequestGeneration){ renderDocPreview(res.ui.doc); loadStaged(); }
    if(res.setup){ renderSetup(res.setup,res.capabilities); showPane("pane-setup"); }
    if(res.staged) loadStaged();
    if(res.macroCreated) loadMacros();
    $("agentStatusText").textContent="Finished — "+((res.model&&res.model.name)||"basic tools");
  }catch(error){
    if(state.slot===runSlot){
      clearThinking();
      bubble(error.name==="AbortError"?"The connection timed out. Check the current page before retrying; an action may already have completed.":"Agent error: "+error.message,"agent");
      $("agentStatusText").textContent="Stopped — "+(error.message||"connection error");
    }
  }finally{
    clearTimeout(timer); askBusy=false;
    $("agentStatus").classList.remove("working");
    if(!activity.children.length) activity.remove();
  }
}
function ask(q){
  if(isStandalone()){
    q=(q||"").trim();
    if(!q) return;
    if(askBusy){ bubble("The current request is still running. Its activity is shown below.","sys"); return; }
    bubble(q,"me");
    var think0=document.createElement("div");
    think0.className="bubble agent thinking"; think0.id="thinkingBubble"; think0.textContent="thinking";
    $("chatLog").appendChild(think0); $("chatLog").scrollTop=$("chatLog").scrollHeight;
    if(/\b(re-?organi[sz]e|tidy|sort out)\b.*\b(this|canvas|layout|panes|page)\b/i.test(q)||/^re-?organi[sz]e this/i.test(q)){ reorganise(); return; }
    if(/^open (browse|browsing)$/i.test(q)||/^let'?s browse/i.test(q)){ goHome("browse"); return; }
    if(/^open work/i.test(q)||/^work mode/i.test(q)){ goHome("work"); return; }
    if(layoutCommand(q)) return;
    if(/^save all this/i.test(q)||/^save.*for another day/i.test(q)){ standaloneUnavailable("Snapshots"); clearThinking(); return; }
    runStandalone(q); return;
  }
  q=(q||"").trim();
  if(!q) return;
  if(askBusy){ bubble("The current request is still running. Its activity is shown below.","sys"); return; }
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
  runReal(q);
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
  if(isStandalone()){ standaloneUnavailable("Setup steps"); btn.textContent="Run step"; btn.disabled=false; return; }
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
  if(isStandalone()){ var bx=$("setupSteps"); if(bx) bx.innerHTML="<p class=\"small\">Setup needs the optional Node backend (npm start). Basic browsing and read work now; nothing is simulated.</p>"; if($("capLine")) $("capLine").textContent="Standalone — Node backend missing."; return; }
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
  /* STALE-SLOT RACE: a loadConfig/postConfig round-trip started under slot A
     may land after the user switched to B — never let it clobber B's world. */
  if(state.expectSlot && res.slot && res.slot!==state.expectSlot) return; /* sticky-calm: stale-slot */
  if(res.slot && res.slot===state.expectSlot) state.expectSlot=null;
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
  if(typeof slot.agentTraces==="boolean") state.traces=slot.agentTraces;
  else if(slot.agentDetail){ state.traces=slot.agentDetail!=="sleek"; postConfig({slot:{agentTraces:state.traces}}); }
  if(typeof slot.agentTools==="boolean") state.tools=slot.agentTools;
  else { state.tools=false; if(slot.agentDetail) postConfig({slot:{agentTools:false}}); }
  applyToggleVisibility();
  /* Persisted layout applies ONCE (first load / world switch). Re-applying
     it on every config save was the trash-recover data-loss bug: recover
     un-hid the pane locally, then the save response clobbered it back. */
  if(slotChanged || !state.layoutAppliedOnce){
    var savedLayout=slot.layout||{};
    state.layout={
      order:savedLayout.order||null,
      hidden:(savedLayout.hidden||["pane-agent","pane-doc","pane-notes","pane-video","pane-setup","pane-activity"]).slice(),
      minimised:(savedLayout.minimised||[]).slice(), maxed:savedLayout.maxed||null,
      sizes:savedLayout.sizes||{}, cols:savedLayout.cols||{}
    };
    state.layoutAppliedOnce=true;
    applyLayout();
  }
  var canonMeta=canonicalMode(slot.metaMode);
  /* BOOT ORDER: ?mode= wins once (one-shot), then the slot's own persisted
     memory, then the Vibes default. calm is sticky — slot-settle never
     pulls out of it, even on a world switch. */
  if(canonMeta && canonMeta!==state.mode && !state.urlMode && (!state.modeExplicit || slotChanged) && state.mode!=="calm") setMode(canonMeta,"this profile settles here");
  state.urlMode=false; /* sticky-calm: one-shot — ?mode= is consumed by the first config sighting */
  updateXmaxVisibility();
  var selected=slot.agentModel || (slot.cloudEnabled?"cloud":((slot.localBase||slot.modelFile||slot.brain==="local-model")?"local":"lite"));
  paintBadge({name:selected==="cloud"?(slot.cloudModel||"muse-spark-1.3-contributor"):selected==="local"?(slot.localSource==="file"?(slot.modelFile||"Local model"):(slot.localModel||slot.modelFile||"Local model")):"Basic tools (no model)",via:selected});
  if(slotChanged) resetWorldView(slot);
  if(slotChanged && state.slot==="X") bubble("⚡ Profile X — ringfenced power world. Extensible pi + durable, deeper access where this device allows, advised brain: PC-standard or better. A and B cannot see or touch any of this, and X cannot touch them.", "agent");
}
/* zero carry-across: a slot switch rebuilds every pane from that slot only */
function resetWorldView(slot){
  docRequestGeneration++;
  if(window.ProfilesDocumentReader) ProfilesDocumentReader.close();
  ["docUrl","docPaste","docFile"].forEach(function(id){if($(id)) $(id).value="";});
  if($("docPreview")) $("docPreview").textContent="";
  $("chatLog").textContent=""; $("agentLog").textContent=""; $("stream").textContent=""; $("ledger").textContent="";
  paintStages(-1);
  bubble("This is a different person's Profiles — own name, own vault, own memory, own macros. Nothing carried across. "+(slot.name?("Hello, "+slot.name+"."):"Tell me your name and pick a buddy, and this side is yours."), "agent");
  seed(); loadStaged(); loadMacros(); loadSnaps(); loadNotes();
  if(browserPaneReady) ProfilesBrowserPane.switchSlot();
  lastBrowserUrl=""; $("urlInput").value="";
  $("agentStatusText").textContent="Ready — this profile only";
}
function loadConfig(){
  if(isStandalone()){ standaloneLoadConfig(); return; }
  fetch(apiUrl("/api/config")).then(function(r){ return r.json(); }).then(applyConfig).catch(function(){});
}
var configQueue=Promise.resolve();
function postConfig(patch){
  if(isStandalone()) return standalonePostConfig(patch);
  var targetSlot=state.slot;
  var payload=JSON.stringify(Object.assign({},patch,{slotId:targetSlot}));
  configQueue=configQueue.catch(function(){}).then(function(){
    return fetch(apiUrl("/api/config"),{method:"POST",headers:{"content-type":"application/json"},body:payload})
      .then(function(r){ if(!r.ok) throw new Error("Could not save profile"); return r.json(); })
      .then(function(res){ if(state.slot===targetSlot && !state.expectSlot) applyConfig(res); return res; });
  });
  return configQueue;
}
function switchSlot(slot){
  if(isStandalone()){ standaloneSwitchSlot(slot); return; }
  if(slot===state.slot && !state.expectSlot) return;
  state.expectSlot=slot; /* sticky-calm: stale-slot */
  state.modeExplicit=false;
  fetch(apiUrl("/api/slot"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({slot:slot})})
    .then(function(r){ return r.json(); }).then(function(){ loadConfig(); })
    .catch(function(){ state.expectSlot=null; bubble("Could not switch profiles — is npm start running?", "sys"); });
}
["A","B","C","D","E","X"].forEach(function(L){
  var b=$("slot"+L); if(b) b.addEventListener("click", function(){ switchSlot(L); });
});
function loadAppConfig(){
  if(isStandalone()){ standaloneLoadApp(); return; }
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
  if(isStandalone()) return standalonePostApp(patch);
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
  if(isStandalone()){ var elx=$("profileXStatus"); if(elx) elx.textContent="Advanced power tools are hidden until you opt in (needs Node backend)."; if(typeof updateAdvancedVisibility==="function") updateAdvancedVisibility(); return; }
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
  if(isStandalone()){ standaloneUnavailable("Profile X"); return; }
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
  if(isStandalone()){ standaloneUnavailable("Profile X"); btn.textContent="I understand — turn everything on"; btn.disabled=false; return; }
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
  if(isStandalone()){ e.target.checked=false; standaloneUnavailable("Whole-machine reach"); return; }
  postConfig({slot:{wholeMachine:e.target.checked}});
  bubble(e.target.checked
    ? "Whole-machine reach ON for Profile X only. Pi's desk is now your home directory inside X. A/B/C remain ringfenced. Turn it off the moment you are done."
    : "Whole-machine reach off — X is ringfenced to its vault again.", "sys");
});
if($("piBrainToggle")) $("piBrainToggle").addEventListener("change", function(e){
  if(isStandalone()){ e.target.checked=false; standaloneUnavailable("Pi brain"); return; }
  postConfig({slot:{piBrain:e.target.checked}});
  bubble(e.target.checked?"Pi brain enabled for this profile — only works inside Profile X, where it belongs.":"Pi brain off — lite agent only.", "sys");
});
$("advancedToggle").addEventListener("change", function(e){
  if(isStandalone()){ e.target.checked=false; if($("advancedLine")) $("advancedLine").textContent="Off — advanced tools need the optional Node backend."; standaloneUnavailable("Advanced tools"); return; }
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
  if(isStandalone()){ bubble("Reset done — this slot is back to local defaults (no backend snapshot in standalone).", "agent"); return; }
  bubble("Reset done — a snapshot was taken first, so nothing is lost. This slot is back to cosy defaults.", "agent");
  loadSnaps();
});
$("snapNow").addEventListener("click", function(){
  if(isStandalone()){ standaloneUnavailable("Snapshots"); return; }
  fetch(apiUrl("/api/snapshots"),{method:"POST"}).then(function(r){ return r.json(); }).then(function(){ bubble("Snapshot saved.", "sys"); loadSnaps(); });
});
function loadSnaps(){
  if(isStandalone()){ var nb=$("snapList"); if(nb) nb.textContent=""; return; }
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
  if(isStandalone()){ renderSessions([]); return; }
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
  if(isStandalone()){ standaloneUnavailable("Saved sessions"); return; }
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
  if(isStandalone()){ var sb=$("stageList"); if(sb) sb.innerHTML="<p class=\"empty\">Staging needs the optional Node backend — nothing staged offline.</p>"; return; }
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
      var pv=document.createElement("button"); pv.className="sbtn ghost"; pv.type="button"; pv.textContent="Preview";
      pv.addEventListener("click", (function(draft){ return function(){
        renderDocPreview({title:draft.title, html:"<pre>"+escHtml((draft.sections||[]).map(function(x){ return x.heading+"\n\n"+x.body; }).join("\n\n---\n\n"))+"</pre>"});
      }; })(d));
      div.appendChild(h); div.appendChild(pre); div.appendChild(a1); div.appendChild(a2); div.appendChild(pv);
      box.appendChild(div);
    });
  }).catch(function(){});
}
$("stageRefresh").addEventListener("click", loadStaged);
/* Local reading uses real PDF/Office/text parsers. Pasted writing still
   stages through the backend for Markdown/DOCX export when available. */
var docRequestGeneration=0;
function readDocument(options){
  docRequestGeneration++;
  showPaneEl("pane-doc",true);
  options.preview=$("docPreview"); options.status=$("docStatus"); options.apiUrl=apiUrl;
  return ProfilesDocumentReader.read(options);
}
function renderDocPreview(doc){
  if(!doc) return;
  showPaneEl("pane-doc", true);
  if(doc.sourceUrl && doc.binary){readDocument({url:doc.sourceUrl});return;}
  docRequestGeneration++;
  if(window.ProfilesDocumentReader) ProfilesDocumentReader.close();
  var pv=$("docPreview"); if(pv) pv.innerHTML=doc.html||"";
  var st=$("docStatus");
  if(st) st.textContent="\u201c"+(doc.title||"document")+"\u201d previewing — staged below, export .md/.docx when happy.";
}
function escHtml(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function docExtKind(u){
  var m=/\.([a-z0-9]+)([?#]|$)/i.exec(String(u||"").split(/[?#]/)[0] || String(u||""));
  var ext=(m&&m[1]||"").toLowerCase();
  if(/^(md|markdown|txt|text|html?)$/.test(ext)) return "text";
  if(/^(pdf|docx|pptx|ppt|xls|xlsx)$/.test(ext)) return "binary";
  return "other";
}
function stageDocPayload(payload, st){
  if(isStandalone()){ if(st) st.textContent="Staging needs the optional Node backend — nothing staged, nothing faked."; return; }
  var requestSlot=state.slot, requestGeneration=++docRequestGeneration;
  fetch(apiUrl("/api/doc/stage"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)})
  .then(function(r){ return r.json().then(function(j){ return {ok:r.ok, j:j}; }); })
  .then(function(r){
    if(requestSlot!==state.slot || requestGeneration!==docRequestGeneration) return;
    if(!r.ok || !r.j || !r.j.ok){ if(st) st.textContent="That did not stage ("+((r.j&&r.j.error)||"unknown")+") — nothing filed, nothing faked."; return; }
    renderDocPreview({title:r.j.staged.title, html:r.j.html});
    loadStaged();
  }).catch(function(){ if(requestSlot===state.slot && requestGeneration===docRequestGeneration && st) st.textContent="The sidecar is unreachable — is npm start running? Nothing staged."; });
}
if($("docFile")) $("docFile").addEventListener("change",function(){
  var file=this.files && this.files[0];
  if(file) { $("docUrl").value=""; readDocument({file:file}); }
});
if($("docLoad")) $("docLoad").addEventListener("click",function(){
  var st=$("docStatus"), pasted=(($("docPaste")||{}).value||"").trim(), link=(($("docUrl")||{}).value||"").trim();
  if(link && ProfilesDocumentReader.supports(link)){readDocument({url:link});return;}
  if(pasted && !link){
    if(isStandalone()){
      readDocument({file:new File([pasted],pasted.charAt(0)==="<"?"Pasted.html":"Pasted.md",{type:"text/plain"})});
    }else stageDocPayload({title:"Pasted document",text:pasted,format:pasted.charAt(0)==="<"?"html":"markdown"},st);
    return;
  }
  if(!link){if(st) st.textContent="Choose a file, paste text, or enter a document link.";return;}
  if(isStandalone()){readDocument({url:link});return;}
  if(docExtKind(link)==="binary"){if(st) st.textContent="This legacy format needs conversion to PDF, DOCX, XLSX or PPTX before reading.";return;}
  var requestSlot=state.slot, requestGeneration=++docRequestGeneration;
  if(st) st.textContent="Reading…";
  fetch(proxyFor(link)).then(function(r){
    if(!r.ok) throw new Error("Document server returned HTTP "+r.status);
    var ct=(r.headers.get("content-type")||"").toLowerCase();
    if(!/text\/|markdown|json|xml/.test(ct)) throw new Error("Unsupported document type. Choose PDF, DOCX, ODT, XLSX, PPTX or text.");
    return r.text();
  }).then(function(text){
    if(requestSlot!==state.slot || requestGeneration!==docRequestGeneration) return;
    if(!text.trim()) throw new Error("The document was empty.");
    stageDocPayload({title:link.split("/").pop().slice(0,120),text:text.slice(0,60000),format:text.trim().charAt(0)==="<"?"html":"markdown",sourceUrl:link},st);
  }).catch(function(error){if(requestSlot===state.slot && requestGeneration===docRequestGeneration && st) st.textContent=error.message;});
});
if($("docOpenExt")) $("docOpenExt").addEventListener("click", function(){
  var u=(($("docUrl")||{}).value||"").trim();
  if(u) window.open(u, "_blank");
});

/* The displayed native/streamed page is the page the agent operates. */
var browserLoaded=false, lastBrowserUrl="";
/* WEBDARK — universal web dark mode. Pure rules mirror engine/webdark.mjs. */
var webDarkGlobal=true, webDarkSites={}, lastDarkKey="";
try{
  if(localStorage.getItem("profiles.webDark")==="0") webDarkGlobal=false;
  var _wds=JSON.parse(localStorage.getItem("profiles.webDarkSites")||"{}");
  if(_wds && typeof _wds==="object") webDarkSites=_wds;
}catch(e){ webDarkSites={}; }
function webDarkHost(url){ try{ var u=new URL(String(url||"")); if(u.protocol!=="http:"&&u.protocol!=="https:") return ""; return u.hostname.toLowerCase(); }catch(e){ return ""; } }
function webDarkFor(url){ var h=webDarkHost(url); if(h&&Object.prototype.hasOwnProperty.call(webDarkSites,h)) return !!webDarkSites[h]; return !!webDarkGlobal; }
function saveWebDark(){ try{ localStorage.setItem("profiles.webDark",webDarkGlobal?"1":"0"); localStorage.setItem("profiles.webDarkSites",JSON.stringify(webDarkSites)); }catch(e){} }
function paintDarkBtn(){ var b=$("darkBtn"); if(!b) return; var on=webDarkFor(lastBrowserUrl); b.setAttribute("aria-pressed",on?"true":"false"); b.classList.toggle("on",on); b.title=on?"Web dark mode is ON — Super+F1 or click flips this site":"Web dark mode is OFF for this site — Super+F1 or click flips it"; }
/* SEARCHENG_MIRROR of engine/searcheng.mjs. Headed user search only — the
   headless agent passes stay Bing-first so Google never bot-walls this IP. */
var searchEnginePref="google";
try{ var _se=String(localStorage.getItem("profiles.searchEngine")||"").toLowerCase(); if(_se==="google"||_se==="bing"||_se==="duckduckgo") searchEnginePref=_se; }catch(e){}
function searchUrl(q){ q=encodeURIComponent(String(q||"")); if(searchEnginePref==="bing") return "https://www.bing.com/search?q="+q; if(searchEnginePref==="duckduckgo") return "https://html.duckduckgo.com/html/?q="+q; return "https://www.google.com/search?q="+q; }
function setSearchEngine(e){ searchEnginePref=(e==="bing"||e==="duckduckgo")?e:"google"; try{ localStorage.setItem("profiles.searchEngine",searchEnginePref); }catch(x){} }
function applyWebDark(){
  if(!window.ProfilesBrowserPane || !browserPaneReady || !window.ProfilesNativeBrowser || !ProfilesNativeBrowser.available) return;
  var tab=null; try{ tab=ProfilesBrowserPane.getActiveTab(); }catch(e){}
  if(!tab || !tab.url) return;
  var on=webDarkFor(tab.url), key=state.slot+"--"+tab.id+"--"+tab.url+"--"+(on?"1":"0");
  if(key===lastDarkKey) return; lastDarkKey=key;
  paintDarkBtn();
  ProfilesBrowserPane.setDark(on).catch(function(){});
}
function toggleWebDark(globalFlip){
  var host=webDarkHost(lastBrowserUrl);
  if(globalFlip){ webDarkGlobal=!webDarkGlobal; webDarkSites={}; }
  else if(host){ webDarkSites[host]=!webDarkFor(lastBrowserUrl); }
  else webDarkGlobal=!webDarkGlobal;
  lastDarkKey="";
  saveWebDark(); paintDarkBtn(); applyWebDark();
  var on=webDarkFor(lastBrowserUrl);
  bubble("Web dark "+(on?"ON":"OFF")+(globalFlip?" everywhere":host?(" for "+host):"")+" — Super+F1 flips it. Pages with their own dark mode can be exempted per site from ⌨ Controls.", "sys");
}
function renderControls(){
  var list=$("controlsList"); if(!list) return; list.textContent="";
  function group(t){ var g=document.createElement("div"); g.className="cgrow"; g.textContent=t; list.appendChild(g); }
  function row(keys,text){
    var d=document.createElement("div"); d.className="crow";
    var k=document.createElement("span"); k.innerHTML=keys.map(function(x){ return "<kbd>"+x+"</kbd>"; }).join(" ");
    var s=document.createElement("span"); s.textContent=text;
    d.appendChild(k); d.appendChild(s); list.appendChild(d);
  }
  var site=webDarkHost(lastBrowserUrl)||"this site", on=webDarkFor(lastBrowserUrl);
  group("Web dark");
  var d=document.createElement("div"); d.className="crow";
  var cur=document.createElement("span"); cur.textContent=(on?"ON":"OFF")+" for "+site;
  var f1=document.createElement("button"); f1.type="button"; f1.className="sbtn"; f1.textContent="Flip this site";
  f1.addEventListener("click",function(){ toggleWebDark(false); renderControls(); });
  var f2=document.createElement("button"); f2.type="button"; f2.className="sbtn"; f2.textContent="Use for all sites";
  f2.addEventListener("click",function(){ toggleWebDark(true); renderControls(); });
  d.appendChild(cur); d.appendChild(f1); d.appendChild(f2); list.appendChild(d);
  group("Headed search");
  var s=document.createElement("div"); s.className="crow";
  var lab=document.createElement("span"); lab.textContent="You search with "+searchEnginePref+" — background agent search stays Bing-first (Google bot-walls headless IPs).";
  s.appendChild(lab);
  ["google","bing","duckduckgo"].forEach(function(e){ var b=document.createElement("button"); b.type="button"; b.className="sbtn"; b.textContent=e[0].toUpperCase()+e.slice(1)+(e===searchEnginePref?" ✓":""); b.addEventListener("click",function(){ setSearchEngine(e); renderControls(); }); s.appendChild(b); });
  list.appendChild(s);
  group("Keys");
  row(["Tap Super"],"move + resize panes (tap again or click to lock)");
  row(["Super","A / B / C"],"jump to profile (D arrives with slots)");
  row(["Super","1 – 6"],"modes: babylite, chill, FOCUSMAX, Vibes, calm, xMAX");
  row(["Super","T / W / L"],"new tab / close tab / address bar");
  row(["Super","F1"],"web dark on/off for this site");
  row(["/"],"jump to chat");
  group("Zoom");
  row(["A-","A+"],"app text size (buttons in Chat pane)");
  row(["Ctrl","wheel"],"browser page zoom, per tab");
}
function normUrl(u){
  u=String(u||"").trim();
  if(!u) return "";
  if(/^https?:\/\//i.test(u)) return u;
  if(/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(u)) return "https://"+u;
  return searchUrl(u);
}
function proxyFor(url){ return apiUrl("/api/proxy?url="+encodeURIComponent(url)); }
function showFallback(msg){
  $("browserFallback").hidden=false; $("browserFallbackText").textContent=msg;
}
function hideFallback(){ $("browserFallback").hidden=true; }
var addressTabKey=null;
function updateBrowserState(out){
  if(!out) return;
  if(out.slot && out.slot!==state.slot) return;
  if(out.tabId && out.tabId!==ProfilesBrowserPane.getActiveTab().id) return;
  var tabKey=state.slot+"--"+ProfilesBrowserPane.getActiveTab().id;
  var selectionChanged=addressTabKey!==tabKey;
  addressTabKey=tabKey;
  if(typeof out.zoom==="number"){pageZoom=out.zoom;paneZoom["pane-browser"]=out.zoom;}
  if(Object.prototype.hasOwnProperty.call(out,"url")){
    lastBrowserUrl=out.url||"";
    if(selectionChanged || document.activeElement!==$("urlInput")) $("urlInput").value=lastBrowserUrl;
  }
  if(typeof applyWebDark==="function") applyWebDark();
  if(out.ok===false){
    if(out.visible!==false && window.ProfilesNativeBrowser && ProfilesNativeBrowser.available) ProfilesNativeBrowser.setVisible(false);
    showFallback(out.error || "The site could not load. Your page has not been replaced."); return;
  }
  hideFallback(); browserLoaded=true;
}
ProfilesBrowserPane.init({host:$("browserSurface"),api:apiUrl,slot:function(){return state.slot;},onState:updateBrowserState});
window.addEventListener("profiles-open-url",function(e){
  var d=e.detail||{},url=d.url;
  if(d.slot && d.slot.split("--")[0]!==state.slot) return;
  if(/^https?:\/\//i.test(url||"")){
    showPaneEl("pane-browser",true);
    if(d.newTab) ProfilesBrowserPane.createTab(url);else ProfilesBrowserPane.navigate(url);
  }
});
browserPaneReady=true;
ProfilesBrowserPane.setZoom(pageZoom);
window.addEventListener("profiles-browser-activate",function(){showPaneEl("pane-browser",true);});
function browserShow(out){
  if(!out) return;
  showPaneEl("pane-browser",true);
  if(out.ok===false){updateBrowserState(out);return;}
  if(out.native || Object.prototype.hasOwnProperty.call(out,"title")) ProfilesBrowserPane.present(out);
  else if(out.url) ProfilesBrowserPane.navigate(normUrl(out.url));
  else updateBrowserState(out);
}
$("urlForm").addEventListener("submit",function(e){
  e.preventDefault();
  var url=normUrl($("urlInput").value);
  if(!url) return;
  hideFallback(); $("urlInput").value=url;
  ProfilesBrowserPane.navigate(url).then(function(){ applyPageZoom(false); });
});
$("browserBack").addEventListener("click",function(){ ProfilesBrowserPane.back(); });
$("browserForward").addEventListener("click",function(){ProfilesBrowserPane.forward();});
document.querySelectorAll("[data-zoom]").forEach(function(b){
  b.addEventListener("click",function(){ stepZoom("pane-browser",Number(b.dataset.zoom),false); });
});
$("fallbackRetry").addEventListener("click",function(){
  hideFallback();
  ProfilesBrowserPane.retry();
});
$("fallbackOpen").addEventListener("click",function(){
  if(lastBrowserUrl) window.open(lastBrowserUrl,"_blank","noopener");
});
if(window.ProfilesNativeBrowser && ProfilesNativeBrowser.available){
  $("fallbackOpen").hidden=true;
  $("openExternal").textContent="↻";
  $("openExternal").title="Reload this address in the Browser pane";
}

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
function learnStay(newMode, prevMode){
  if(isStandalone()){ state.modeSince=Date.now(); return; }
  /* prevMode is captured in setMode BEFORE state.mode flips; falling back to
     state.mode keeps the invariant (prev!==new) when called directly. */
  var prev=(typeof prevMode==="string")?prevMode:state.mode, dwell=Math.round((Date.now()-(state.modeSince||Date.now()))/1000);
  state.modeSince=Date.now();
  if(dwell>=30 && prev && prev!==newMode){
    fetch(apiUrl("/api/learn"),{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({type:"mode-stay",mode:prev,dwellSec:dwell})}).catch(function(){});
  }
}
var pendingSuggest=null;
function checkLearned(){
  if(isStandalone()) return;
  if(state.suggestChecked) return;
  if(state.mode==="calm") return; /* sticky-calm: learned — never suggest away from the panic button */
  state.suggestChecked=true;
  try{
    var until=Number(localStorage.getItem("profilesSuggestSilenceUntil")||0);
    if(Date.now()<until) return; /* dismissed recently: silence, respected */
  }catch(e){}
  fetch(apiUrl("/api/preferences?current="+encodeURIComponent(state.mode))).then(function(r){ return r.json(); }).then(function(res){
    var sug=res && res.suggestion;
    if(!sug || sug.to===state.mode) return;
    if(state.mode==="calm") return; /* sticky-calm: learned — mode changed under the fetch */
    if(state.auto){ if(canonicalMode(sug.to)==="calm") return; stream("auto profile → "+MODES[sug.to].label+" ("+sug.why+")"); setMode(sug.to,"learned auto: "+sug.why); return; }
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
  if(isStandalone()){ bubble("Noted — quiet for a day.", "sys"); return; }
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
  try{ if(document.hidden) return false; }catch(e){} /* hidden tab: zero invite work (Chromebook envelope) */
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
  if(isStandalone()) return;
  if(document.hidden) return; /* hidden tab: no network wakeups for a nudge feed */
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
  if(isStandalone()) return;
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
  if(isStandalone()){ var mb=$("macroChips"); if(mb) mb.textContent=""; return; }
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
    ? "Routing: Astra reviews each hop, Muse Spark 1.3 Contributor xhigh for heavy lifts."
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
  if(isStandalone()){ var el0=$("buildLine"); if(el0) el0.textContent="UI bundle "+(el0.getAttribute("data-bundle")||"dev-live")+" · standalone (Node backend missing)"; return; }
  fetch(apiUrl("/api/health")).then(function(r){ return r.json(); }).then(function(h){
    var el=$("buildLine");
    if(el && h) el.textContent="UI bundle "+(el.getAttribute("data-bundle")||"dev-live")+" · sidecar "+(h.build||"?")+" · up "+String(h.startedAt||"").slice(11,16)+" UTC";
  }).catch(function(){});
}
function refreshCloud(){
  if(isStandalone()){ if($("cloudLine")) $("cloudLine").textContent="Off — needs optional Node backend (npm start). No automatic cloud substitution."; if($("googleLine")) $("googleLine").textContent="Google connect needs the optional Node backend."; return; }
  fetch(apiUrl("/api/cloud/status")).then(function(r){ return r.json(); }).then(function(st){
    $("cloudToggle").checked=!!st.enabled;
    if($("cloudModel") && st.model) $("cloudModel").value=st.model;
    $("cloudLine").textContent = st.enabled
      ? ("On — "+st.model+" via "+st.base+". Key "+(st.hasKey?"stored in your OS keyring":"missing")+". Model errors stay visible; no silent substitutions.")
      : "Off. Store your own key and choose a model above the chat. Contributor prompts may be used for training.";
  }).catch(function(){});
  fetch(apiUrl("/api/oauth/google/status")).then(function(r){ return r.json(); }).then(function(st){
    $("googleLine").textContent = st.connected ? "Google connected — staged drafts get a Push button." :
      st.clientConfigured ? "Google not connected for this profile." :
      "Needs your own Google Cloud OAuth client (see Setup note in the agent docs) — then this button works.";
  }).catch(function(){});
}
if($("cloudToggle")) $("cloudToggle").addEventListener("change", function(e){
  if(isStandalone()){ e.target.checked=false; standaloneUnavailable("API models"); return; }
  postConfig({slot:{cloudEnabled:e.target.checked,agentModel:e.target.checked?"cloud":"lite"}});
  bubble(e.target.checked?"Cloud selected for this profile.":"Basic tools selected; cloud calls are off.","sys");
  setTimeout(refreshCloud, 300);
});
if($("cloudKeySave")) $("cloudKeySave").addEventListener("click", function(){
  if(isStandalone()){ standaloneUnavailable("API keys"); return; }
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
  if(isStandalone()){ standaloneUnavailable("Google connect"); return; }
  fetch(apiUrl("/api/oauth/google/start")).then(function(r){ return r.json(); }).then(function(out){
    if(!out.ok){ bubble("Google connect not ready: "+out.error, "agent"); return; }
    window.open(out.url, "_blank");
    bubble("Google sign-in opened in your browser. Approve there, then come back — staged drafts will gain a Push to Google Docs button.", "agent");
  }).catch(function(){ bubble("Google connect unreachable.", "agent"); });
});
$("routingToggle").addEventListener("change", function(e){
  if(isStandalone()){ e.target.checked=false; state.routing=false; updateModelLine(); standaloneUnavailable("Routing"); return; }
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
  if(state.mode==="calm") return; /* sticky-calm: adaptive — Adaptive never pulls out of the panic button */
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
    show:["pane-chat","pane-agent"], msg:"Search / Ask — ask box front and centre, agent receipts beside it (Traces on) or quiet (both toggles off, in the chat header)."},
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
  if(!isStandalone()) fetch(apiUrl("/api/learn"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({type:"home",kind:kind})}).catch(function(){});
}
document.querySelectorAll("[data-home]").forEach(function(b){
  b.addEventListener("click", function(){ goHome(b.dataset.home); });
});
document.querySelectorAll("[data-app]").forEach(function(b){
  b.addEventListener("click", function(){
    /* shell links land in the Browser pane (framing proxy, honest fallback
       + open-external escape if the app refuses to embed) */
    var app=b.dataset.app;
    showPaneEl("pane-browser", true);
    lastBrowserUrl=app; $("urlInput").value=app;
    ProfilesBrowserPane.navigate(app);
    hideFallback();
  });
});
if($("driveBtn")) $("driveBtn").addEventListener("click", function(){
  if(isStandalone()){ standaloneUnavailable("Browser-act driving"); return; }
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
  ProfilesBrowserPane.reload();
});
/* ---- agent detail: two explicit toggles, Traces ON + Tools OFF by default.
   Traces = reasoning chain lines; Tools = tool calls + extras. Tool lines
   carry .tool-line + data-kind at render; CSS hides per toggle. ---- */
function applyToggleVisibility(){
  var showTr=state.traces!==false, showTo=state.tools===true;
  document.body.dataset.traces=showTr?"on":"off";
  document.body.dataset.tools=showTo?"on":"off";
  ["tracesToggle","agentTracesToggle"].forEach(function(id){ var b=$(id); if(b) b.setAttribute("aria-pressed", showTr?"true":"false"); });
  ["toolsToggle","agentToolsToggle"].forEach(function(id){ var b=$(id); if(b) b.setAttribute("aria-pressed", showTo?"true":"false"); });
  var log=$("agentLog"); if(!log) return;
  Array.prototype.forEach.call(log.children, function(li){
    var k=li.dataset?li.dataset.kind:"";
    if(k==="trace") li.style.display=showTr?"":"none";
    else if(k==="tool") li.style.display=showTo?"":"none";
    else li.style.display="";
  });
}
function setTraces(on){
  state.traces=!!on; applyToggleVisibility();
  postConfig({slot:{agentTraces:state.traces}});
  bubble(on?"Traces on — available provider summaries and live progress are shown.":"Traces off — answers still appear normally.","sys");
}
function setTools(on){
  state.tools=!!on; applyToggleVisibility();
  postConfig({slot:{agentTools:state.tools}});
  bubble(on?"Tools on — tool calls and extras show in the Agent pane as they happen.":"Tools off — tool calls are tucked away; answers still land here.", "sys");
}
function paintBadge(model){
  var b=$("brainBadge"); if(!b) return;
  var m=state.demoMode ? {name:"muse-spark-1.3-contributor ("+(state.reasoningEffort||"xhigh")+")",via:"cloud"} :
    model||state.model||{name:"muse-spark-1.3-contributor (xhigh)",via:"cloud"};
  state.model=m;
  b.textContent=m.name||"muse-spark-1.3-contributor (xhigh)";
  b.title=(m.name||"muse-spark-1.3-contributor (xhigh)")+" · "+(m.via||"cloud")+" — choose model or view availability";
}
function closeModelMenu(){ var menu=$("modelMenu"); if(menu) menu.remove(); $("brainBadge").setAttribute("aria-expanded","false"); }
if($("brainBadge")) $("brainBadge").addEventListener("click",function(){
  if($("modelMenu")){ closeModelMenu(); return; }
  if(isStandalone()){
    var sm=document.createElement("div"); sm.id="modelMenu"; sm.setAttribute("role","dialog"); sm.setAttribute("aria-label","Choose agent model");
    var rr=$("brainBadge").getBoundingClientRect();
    sm.style.left=Math.max(12,Math.min(rr.left,innerWidth-392))+"px"; sm.style.top=(rr.bottom+8)+"px"; document.body.appendChild(sm);
    $("brainBadge").setAttribute("aria-expanded","true");
    var t0=document.createElement("strong"); t0.textContent="Agent model (Basic tools — Node backend missing)"; sm.appendChild(t0);
    var b0=document.createElement("button"); b0.type="button"; b0.textContent="✓ Basic tools (no model)";
    var d0=document.createElement("small"); d0.textContent="Offline navigation and read. No model calls. Works now."; d0.style.display="block"; b0.appendChild(d0);
    b0.addEventListener("click",closeModelMenu); sm.appendChild(b0);
    [["API model","Needs optional Node backend (npm start) — not simulated, no automatic cloud substitution."],["Local model","Needs optional Node backend + configured endpoint/file — not simulated."]].forEach(function(row){
      var b=document.createElement("button"); b.type="button"; b.disabled=true; b.textContent=row[0];
      var d=document.createElement("small"); d.textContent=row[1]; d.style.display="block"; b.appendChild(d); sm.appendChild(b);
    });
    return;
  }
  var menu=document.createElement("div"); menu.id="modelMenu"; menu.setAttribute("role","dialog"); menu.setAttribute("aria-label","Choose agent model");
  var r=$("brainBadge").getBoundingClientRect();
  menu.style.left=Math.max(12,Math.min(r.left,innerWidth-392))+"px"; menu.style.top=(r.bottom+8)+"px";
  menu.textContent="Loading available models…"; document.body.appendChild(menu);
  $("brainBadge").setAttribute("aria-expanded","true");
  fetch(apiUrl("/api/agent/models")).then(function(res){if(!res.ok) throw new Error("Model availability could not be loaded");return res.json();}).then(function(data){
    if(!menu.isConnected) return;
    menu.textContent="";
    var title=document.createElement("strong"); title.textContent="Agent model"; menu.appendChild(title);
    (data.choices||[]).forEach(function(choice){
      var button=document.createElement("button"); button.type="button"; button.disabled=!choice.available;
      var selected=data.selected===choice.id && (choice.id!=="local" || (choice.modelFile ? data.selectedFile===choice.modelFile : !data.selectedFile));
      button.textContent=(selected?"✓ ":"")+choice.name; button.title=choice.detail;
      var detail=document.createElement("small"); detail.textContent=choice.detail; detail.style.display="block"; button.appendChild(detail);
      button.addEventListener("click",function(){
        var patch={agentModel:choice.id,cloudEnabled:choice.id==="cloud"};
        if(choice.modelFile) { patch.modelFile=choice.modelFile; patch.localBase=""; patch.localModel=""; patch.localSource="file"; }
        else if(choice.id==="local") { patch.modelFile=""; patch.localSource="endpoint"; }
        postConfig({slot:patch}).then(closeModelMenu).catch(function(){button.disabled=false;});
      }); menu.appendChild(button);
    });
    var setup=document.createElement("button"); setup.type="button"; setup.textContent=data.demoMode?"Configure Contributor API key…":"Configure API key or local model…";
    setup.addEventListener("click",function(){closeModelMenu();showPane("pane-setup");}); menu.appendChild(setup);
  }).catch(function(){menu.textContent="Could not load model choices. Check the sidecar connection.";});
});
document.addEventListener("pointerdown",function(e){ if(!e.target.closest("#modelMenu,#brainBadge")) closeModelMenu(); },true);
document.addEventListener("keydown",function(e){ if(e.key==="Escape") closeModelMenu(); });
["tracesToggle","agentTracesToggle"].forEach(function(id){
  if($(id)) $(id).addEventListener("click", function(){ setTraces(state.traces===false); });
});
["toolsToggle","agentToolsToggle"].forEach(function(id){
  if($(id)) $(id).addEventListener("click", function(){ setTools(state.tools!==true); });
});

/* ---- smart reorganise: learned linkage first, best practice second ---- */
function reorganise(){
  if(isStandalone()){ standaloneUnavailable("Smart reorganise"); return; }
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
    if(isStandalone()){ if($("notesLine")) $("notesLine").textContent="Notes need the optional Node backend — nothing is saved offline."; return; }
    clearTimeout(notesTimer);
    notesTimer=setTimeout(function(){
      fetch(apiUrl("/api/notes"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:$("notesArea").value})})
        .then(function(){ $("notesLine").textContent="Saved · "+now()+" · this profile only"; }).catch(function(){});
    }, 600);
  });
}
function loadNotes(){
  if(isStandalone()){ if($("notesLine")) $("notesLine").textContent="Notes need the optional Node backend — nothing is saved offline."; loadSketch(); return; }
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
  if(isStandalone()) return;
  if(document.visibilityState!=="visible" || !state.agentOk) return;
  fetch(apiUrl("/api/learn"),{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({type:"context", panes:PANES.filter(paneVisible), mode:state.mode})}).catch(function(){});
}, 20000);

/* ---- agent presence: always on, no toggle, honest badge ---- */
/* boot handled above (proxied home); nothing to fetch */
var bootBuild=null;
if($("updatePill")) $("updatePill").addEventListener("click", function(){ location.reload(); });
function checkBuild(h){
  if(h && typeof h.demoMode==="boolean"){
    state.demoMode=h.demoMode;
    state.reasoningEffort=h.reasoningEffort||null;
    if(state.demoMode) paintBadge();
  }
  if(!h || !h.build) return;
  if(!bootBuild){ bootBuild=h.build; return; }
  if(h.build!==bootBuild){
    var pill=$("updatePill");
    if(pill){ pill.hidden=false; }
    stream("update available ("+h.build+") — reload to run the newest build");
  }
}
setInterval(function(){
  if(isStandalone()) return;
  if(document.visibilityState!=="visible") return;
  fetch(apiUrl("/api/health")).then(function(r){ return r.json(); }).then(checkBuild).catch(function(){});
}, 30000);
function bootAgent(){
  if(isStandalone()){
    state.agentOk=true;
    paintBadge({name:"Basic tools (no model)",via:"lite"});
    if($("agentStatusText")) $("agentStatusText").textContent="Ready — Basic tools (Node backend missing)";
    bubble("Ready — Basic tools only (Node backend missing). I can open a site, read the current page, or search the web natively. No model was called; models and staging need npm start.","agent");
    stream("Basic tools ready — Node backend missing");
    return;
  }
  fetch(apiUrl("/api/health")).then(function(r){ return r.json(); }).then(function(h){
    checkBuild(h);
    state.agentOk=true;
    if(state.demoMode || !state.model) paintBadge();
    $("agentStatusText").textContent="Ready";
    bubble("Ready. Ask me to open a website or read the current page. Choose a model above for conversation and multi-step requests.", "agent");
    stream("Agent connection ready");
  }).catch(function(){
    state.agentOk=false;
    $("agentStatusText").textContent="Connecting to the agent…";
    setTimeout(bootAgent, 4000);
  });
}

/* ---- boot ---- */
seed();
applyLayout();
applyToggleVisibility();
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
