/* Profiles v3 frontend — chat-first canvas: blank box + panes you align.
   Lite agent ALWAYS ON (local sidecar); answers land in chat, the Pi-loop
   detail lives in the Agent pane. Pack-wired, governor-enforced. */
"use strict";
function $(id){ return document.getElementById(id); }
function apiBase(){ try{ return (localStorage.getItem("profilesHub")||"").replace(/\/$/,""); }catch(e){ return ""; } }
function apiUrl(p){ return apiBase()+p; }
if("serviceWorker" in navigator){ navigator.serviceWorker.register("./sw.js").catch(function(){}); }
function now(){ var d=new Date(); return d.toTimeString().slice(0,8); }

var MODES={
  lite:    {label:"Lite · big targets",         motion:60, sim:1, tick:900,  speech:"terse",
             note:"Lite — big targets, one thing, always asks. Governor: motion 60%, 1 simultaneous, flash 0/s (capped). Agent simple/asks-first, parallelism 1."},
  chill:   {label:"Chill · warm and slow",      motion:35, sim:1, tick:2600, speech:"sparse",
             note:"Chill — warm, slow, rest reminders. Governor: motion 35%, 1 simultaneous, flash 0/s (capped). Agent brief/checkpointed, parallelism 1."},
  focus:   {label:"Focus · mono-task",          motion:10, sim:1, tick:1000, speech:"terse",
             note:"Focus — mono-task, distractions held. Governor: motion 10%, 1 simultaneous, flash 0/s (capped). Agent terse/suggest-only, parallelism 1."},
  lifeful: {label:"Vibes · full energy",            motion:100,sim:4, tick:700,  speech:"full",
             note:"Dev/Heavy — parallel agent, proactive, checkpointed before anything irreversible. Governor: motion 100%, 4 simultaneous, flash 0/s (capped). Agent detailed/act-with-checkpoint, parallelism 4."},
  calm:    {label:"Low-Sensory · ND calm",      motion:0,  sim:0, tick:4200, speech:"quiet",
             note:"Low-Sensory — motion stops, palette softens, agent terse and mono-task. Governor: motion 0%, 0 simultaneous, flash 0/s (capped). Agent terse/suggest-only, parallelism 1."}
};
var ROUTING={lite:"muse-spark-1.3-contributor",chill:"muse-spark-1.3-contributor",
  focus:"muse-spark-1.3-contributor",lifeful:"muse-spark-1.3-contributor",calm:null};
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
var state={mode:"lifeful", routing:false, auto:false, agentOk:false, timer:null, modeSince:Date.now(), suggestChecked:false, slot:"A", layout:{order:null,hidden:["pane-agent","pane-notes","pane-video","pane-setup","pane-activity"],maxed:null},
  stage:-1, runCount:0, bg:0, switches:[], cfg:null, speak:false, setupPlan:null};

/* ---- canvas v4: seamless drag-snap tiling + browser-style pane tabs ---- */
var PANES=["pane-chat","pane-agent","pane-browser","pane-doc","pane-notes","pane-video","pane-setup","pane-activity"];
var PANE_LABELS={"pane-chat":"💬 Chat","pane-agent":"🤖 Agent","pane-browser":"🌐 Browser","pane-doc":"📄 Document","pane-notes":"📝 Notes","pane-video":"🎬 Video","pane-setup":"🧭 Setup","pane-activity":"📜 Activity"};
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
  PANES.forEach(function(id){
    $(id).classList.toggle("hiddenPane", !paneVisible(id));
    $(id).classList.toggle("maxedPane", state.layout.maxed===id);
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
    var b=document.createElement("button"); b.type="button";
    var lab=document.createElement("span"); lab.textContent=PANE_LABELS[id];
    var x=document.createElement("span"); x.className="x"; x.textContent="×"; x.title="Close pane (reopen any time)";
    x.addEventListener("click", function(ev){ ev.stopPropagation(); hidePane(id); });
    b.appendChild(lab); b.appendChild(x);
    b.addEventListener("click", function(){ focusPane(id); });
    b.addEventListener("dblclick", function(){ toggleMax(id); });
    bar.appendChild(b);
  });
  var add=document.createElement("button"); add.type="button"; add.textContent="+ Pane";
  add.title="Reopen a closed pane";
  add.addEventListener("click", function(){
    var closed=PANES.filter(function(id){ return !paneVisible(id); });
    if(closed.length) showPaneEl(closed[0]);
    else bubble("All panes are already on the canvas. Drag their headers to rearrange; double-click a tab to maximise.", "sys");
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
function showPaneEl(id, silent){
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
document.querySelectorAll("[data-focus]").forEach(function(b){
  b.addEventListener("click", function(){ toggleMax(b.dataset.focus); });
});
$("customiseBtn").addEventListener("click", function(){ focusPane("pane-setup"); });
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

/* pin-to-move: 📌 unlocks a pane, drag it, click anywhere to land + re-pin */
(function pinTiles(){
  var unpinned=null, dragId=null, startX=0, startY=0, moved=false;
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
  function land(){
    if(!unpinned) return;
    $(unpinned).classList.remove("unpinned");
    bubble(PANE_LABELS[unpinned]+" pinned there. Layout remembered for this profile.", "sys");
    stream("layout — "+unpinned+" re-pinned by hand");
    unpinned=null; dragId=null;
    state.layout.order=Array.prototype.slice.call($("canvas").children).map(function(el){ return el.id; })
      .filter(function(id){ return PANES.indexOf(id)>=0; });
    applyLayout();
  }
  document.querySelectorAll(".pane").forEach(function(pane){
    var pin=pane.querySelector(".pinbtn");
    if(pin) pin.addEventListener("click", function(e){
      e.stopPropagation();
      if(unpinned===pane.id){ land(); return; }
      if(unpinned) land();
      unpinned=pane.id;
      pane.classList.add("unpinned");
      bubble(PANE_LABELS[pane.id]+" unlocked — drag it where you want, then click anywhere and it lands and re-pins.", "sys");
    });
    /* as soon as the pin is clicked the pane is LIVE: just moving the
       mouse (no holding) glides it across its neighbours; click lands it */
    pane.addEventListener("pointermove", function(e){
      if(unpinned!==pane.id) return;
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
    pane.addEventListener("pointerup", function(){ dragId=null; });
  });
  document.addEventListener("pointerdown", function(e){
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
function setMode(mode, why){
  if(!MODES[mode]) return;
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
  learnStay(mode);
  if(why && why.indexOf("opening")!==0 && why.indexOf("pack engine")!==0 && why.indexOf("learned")!==0) checkLearned();
}
document.querySelectorAll(".pills button").forEach(function(b){
  b.addEventListener("click", function(){ setMode(b.dataset.profile, "you switched"); });
});
document.addEventListener("keydown", function(e){
  if(e.target && (e.target.tagName==="INPUT"||e.target.tagName==="TEXTAREA"||e.target.tagName==="SELECT")) return;
  var map={"1":"lite","2":"chill","3":"focus","4":"lifeful","5":"calm"};
  if(map[e.key]) setMode(map[e.key], "key "+e.key);
  if(e.key==="c"||e.key==="C"){ focusPane("pane-chat"); $("ask").focus(); }
});

/* ---- chat: answers are bubbles; agent log is detail ---- */
function bubble(text, who){
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
function stageLine(stage, q){
  var m=MODES[state.mode], sp=m.speech;
  if(sp==="quiet") return null;
  if(sp==="sparse" && (stage==="sense"||stage==="plan"||stage==="remember")) return null;
  switch(stage){
    case "sense": return "sense ✓ inbox scan";
    case "plan":  return "plan → \""+q+"\" first";
    case "act":   return "act ✓ filed → tasks";
    case "verify":return "verify ✓ checkpoint #"+(state.runCount+1);
    case "remember": return "remember ✓ ledger remembers";
  }
  return null;
}
function startRun(q){
  if(state.timer){ clearInterval(state.timer); state.timer=null; }
  state.runCount++; state.stage=-1;
  paintStages(-1);
  $("agentStatus").classList.add("working");
  $("agentStatusText").textContent="simulating “"+q+"” — sidecar unreachable, labelled honestly";
  logLine("→ “"+q+"” · simulated (sidecar down)");
  state.timer=setInterval(function(){ tick(q); }, MODES[state.mode].tick);
}
function tick(q){
  state.stage++;
  if(state.stage>=STAGES.length){
    clearInterval(state.timer); state.timer=null;
    paintStages(99);
    $("agentStatus").classList.remove("working");
    $("agentStatusText").textContent="done ✓ (simulated) — start npm start for the real agent";
    bubble("The agent sidecar is not reachable, so that was a simulation. Run npm start and I will do it for real — file it, stage it, remember it.", "agent");
    addLedger(q);
    stream("simulated run #"+state.runCount+" ✓ “"+q+"” (sidecar down)");
    return;
  }
  var s=STAGES[state.stage];
  paintStages(state.stage);
  var line=stageLine(s,q);
  if(line) logLine(line);
}

/* ---- real sidecar: always on, chat-first ---- */
function runReal(q){
  state.runCount++;
  $("agentStatus").classList.add("working");
  $("agentStatusText").textContent="working on “"+q+"” — lite agent · "+MODES[state.mode].label;
  paintStages(-1);
  logLine("→ “"+q+"” · "+MODES[state.mode].label+" · lite agent");
  fetch(apiUrl("/api/ask"),{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({query:q,mode:state.mode,device:"desktop"})})
  .then(function(r){ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
  .then(function(res){
    var i=0, tickMs=MODES[state.mode].motion===0?700:320;
    (function next(){
      if(i>=res.events.length){
        paintStages(99);
        $("agentStatus").classList.remove("working");
        $("agentStatusText").textContent="done ✓ — answer in chat, detail here";
        bubble(res.chat || res.result, "agent");
        if(res.setup){ renderSetup(res.setup, res.capabilities); showPane("pane-setup"); }
        if(res.staged){ bubble("Staged “"+res.staged.title+"” — see the Document pane.", "sys"); loadStaged(); }
        if(res.macroCreated){ bubble("You have asked that 3 times, so I scripted it: “"+res.macroCreated.id+"” is now a one-tap macro below the chat — instant, no thinking loop. Delete its file in vault/macros/ any time to unlearn.", "sys"); loadMacros(); }
        stream("run #"+state.runCount+" ✓ “"+q+"” — "+res.pick.tier+" · "+res.intent.kind);
        return;
      }
      var ev=res.events[i++];
      paintStages(STAGES.indexOf(ev.stage));
      if(MODES[state.mode].speech!=="quiet" || ev.stage==="remember") logLine(ev.text);
      setTimeout(next, tickMs);
    })();
  })
  .catch(function(err){
    $("agentStatus").classList.remove("working");
    logLine("! sidecar unreachable ("+err.message+") — labelled simulation instead");
    startRun(q);
  });
}
function ask(q){
  q=(q||"").trim();
  if(!q) return;
  bubble(q, "me");
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
  if(state.agentOk) runReal(q); else startRun(q);
}
$("askForm").addEventListener("submit", function(e){
  e.preventDefault();
  var q=$("ask").value.trim();
  $("ask").value="";
  if(state.mode==="lifeful" && state.mode!=="calm"){
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
  $("speakBtn").setAttribute("aria-pressed", state.speak?"true":"false");
  document.body.classList.toggle("kids", !!slot.kids);
  document.body.dataset.slotx = state.slot==="X" ? "1" : "0";
  $("nameInput").value=slot.name||"";
  $("buddyInput").value=slot.buddy||"fox";
  renderTrash(slot.closedPanes||[]);
  if(slot.agentDetail){ document.body.dataset.detail=slot.agentDetail; if($("detailToggle")) $("detailToggle").textContent=slot.agentDetail==="sleek"?"Sleek":"Detailed"; }
  /* Persisted layout applies ONCE (first load / world switch). Re-applying
     it on every config save was the trash-recover data-loss bug: recover
     un-hid the pane locally, then the save response clobbered it back. */
  if(!state.layoutInit){ state.layoutInit=true; state.layoutAppliedOnce=true; } /* first config sighting: local layout is authoritative from here */
  if(slot.layout && (slotChanged || !state.layoutAppliedOnce)){
    state.layout={order:slot.layout.order||null, hidden:slot.layout.hidden||["pane-agent","pane-notes","pane-video","pane-setup","pane-activity"], maxed:null};
    state.layoutAppliedOnce=true;
    applyLayout();
  }
  if(slot.metaMode && slot.metaMode!==state.mode && !state.urlMode) setMode(slot.metaMode, "this profile settles here");
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
    $("showXToggle").checked=!!ac.showX;
    var extra=ac.extraSlots||[];
    $("slotD").hidden=extra.indexOf("D")<0;
    $("slotE").hidden=extra.indexOf("E")<0;
    $("extraSlotsToggle").checked=extra.length>0;
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

/* ---- browser pane: a real browser, driven by your clicks ---- */
var browserLoaded=false;
function browserShow(out){
  if(!out || !out.ok) { $("browserStatus").textContent="Could not load — try Go again."; return; }
  $("browserImg").src=apiUrl("/api/browser/shot/"+out.shot)+"?t="+Date.now();
  $("browserHint").style.display="none";
  $("urlInput").value=out.url||$("urlInput").value;
  $("browserStatus").textContent=(out.title?("“"+out.title+"” · "):"")+ "live — click the picture to interact";
  browserLoaded=true;
}
function browserCall(path, body){
  $("browserStatus").textContent="working…";
  fetch(apiUrl(path),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body||{})})
    .then(function(r){ return r.json(); }).then(browserShow)
    .catch(function(){ $("browserStatus").textContent="Browser unreachable — is npm start running?"; });
}
$("urlForm").addEventListener("submit", function(e){
  e.preventDefault();
  browserCall("/api/browser/view", {url:$("urlInput").value.trim()});
});
$("browserHome").addEventListener("click", function(){ browserCall("/api/browser/home", {}); });
$("browserBack").addEventListener("click", function(){ browserCall("/api/browser/back", {}); });
$("browserImg").addEventListener("click", function(e){
  var r=$("browserImg").getBoundingClientRect();
  browserCall("/api/browser/click", {fx:(e.clientX-r.left)/r.width, fy:(e.clientY-r.top)/r.height});
});
$("typeForm").addEventListener("submit", function(e){
  e.preventDefault();
  var t=$("typeInput").value; $("typeInput").value="";
  browserCall("/api/browser/type", {text:t, enter:true});
});
if($("openExternal")) $("openExternal").addEventListener("click", function(){
  var u=$("urlInput").value.trim();
  if(u && !/^https?:\/\//i.test(u)) u="https://"+u;
  if(u) window.open(u, "_blank");
});

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
var recog=null;
$("micBtn").addEventListener("click", function(){
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){
    $("voiceLine").textContent="no speech engine in this browser";
    bubble("This browser/webview has no speech recognition built in. The upgrade path is Parakeet (local, in Models) — typing works everywhere meanwhile, and Firefox/Chrome on desktop include engines on some platforms.", "agent");
    return;
  }
  if(recog){ try{ recog.stop(); }catch(e){} recog=null; $("micBtn").setAttribute("aria-pressed","false"); $("voiceLine").textContent=""; return; }
  recog=new SR(); recog.lang=(pickVoice()&&pickVoice().lang)||"en-GB"; recog.interimResults=false; recog.maxAlternatives=1;
  $("micBtn").setAttribute("aria-pressed","true");
  $("voiceLine").textContent="listening…";
  bubble("Listening — talk to me, then I will answer out loud.", "sys");
  recog.onresult=function(ev){
    var t=ev.results[0][0].transcript;
    $("voiceLine").textContent="";
    state.speak=true; $("speakBtn").setAttribute("aria-pressed","true"); /* talk to it -> it talks back */
    ask(t);
  };
  recog.onend=function(){ recog=null; $("micBtn").setAttribute("aria-pressed","false"); $("voiceLine").textContent=""; };
  recog.onerror=function(ev){
    recog=null; $("micBtn").setAttribute("aria-pressed","false"); $("voiceLine").textContent="";
    bubble("Mic hiccup ("+(ev.error||"unknown")+"). If the Tauri webview has no mic engine, use the browser build for voice, or type — Parakeet-local is the installable fix in Models.", "agent");
  };
  try{ recog.start(); }catch(e){ recog.onerror(e); }
});
$("speakBtn").addEventListener("click", function(){
  state.speak=!state.speak;
  $("speakBtn").setAttribute("aria-pressed", state.speak?"true":"false");
  postConfig({slot:{voiceOut:state.speak}});
  $("voiceLine").textContent=state.speak?"voice on":"";
  if(state.speak) speakText("Voice on. I will read my answers aloud.");
  bubble(state.speak?"I will read my answers aloud now (natural local voice).":"Quiet again — text only.", "sys");
});

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
  var files={lite:"lite",chill:"chill",focus:"focus",lifeful:"dev",calm:"low-sensory"};
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

/* ---- front door: Browse / Search-Ask / Work arrange the canvas ---- */
var HOME_LAYOUTS={
  browse:{order:["pane-chat","pane-browser","pane-notes","pane-agent","pane-video","pane-doc","pane-activity","pane-setup"],
    show:["pane-browser","pane-chat"], msg:"Browse — web front and centre, chat alongside for questions. Everything else is a tab away."},
  ask:{order:["pane-chat","pane-agent","pane-browser","pane-doc","pane-notes","pane-video","pane-activity","pane-setup"],
    show:["pane-chat","pane-agent"], msg:"Search / Ask — ask box front and centre, agent receipts beside it (Detailed) or hidden (Sleek, in the Agent header)."},
  work:{order:["pane-chat","pane-doc","pane-notes","pane-browser","pane-agent","pane-video","pane-activity","pane-setup"],
    show:["pane-doc","pane-notes","pane-browser","pane-chat"], msg:"Work — staged documents + notes + your usual apps (Docs, Word, Slides) in the browser pane. Agent drafts land in Document, export when happy."}
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
      order=["pane-chat","pane-video","pane-browser","pane-doc","pane-notes","pane-agent","pane-activity","pane-setup"];
      why="best practice: chat first, content you are consuming next, your notes beside it, agent receipts after";
    }
    state.layout.order=order;
    state.layout.hidden=state.layout.hidden.filter(function(id){ return ["pane-video","pane-notes"].indexOf(id)>=0 ? false : true; });
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
}

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
setTimeout(function(){ if(!browserLoaded && paneVisible("pane-browser")) browserCall("/api/browser/home", {}); }, 1200);
function bootAgent(){
  fetch(apiUrl("/api/health")).then(function(r){ return r.json(); }).then(function(h){
    state.agentOk=true;
    $("brainBadge").textContent="agent on · local";
    $("agentStatusText").textContent="lite agent on — ask in chat; detail lands here";
    bubble("Hello. I am your lite agent — always on, local, and I answer here in chat. Ask me anything, or tap “Help me get a better agent plugged in” and I will upgrade myself with you, step by step.", "agent");
    stream("lite agent ON — "+h.brain);
  }).catch(function(){
    state.agentOk=false;
    $("brainBadge").textContent="agent offline";
    bubble("I cannot reach my sidecar right now, so I will simulate and say so. Run npm start and I am real.", "agent");
  });
}

/* ---- boot ---- */
seed();
applyLayout();
(function(){
  var sp=new URLSearchParams(location.search);
  var m=(sp.get("mode")||"lifeful").toLowerCase();
  if(sp.get("mode")) state.urlMode=true;
  if(m==="dev") m="lifeful"; if(m==="low-sensory") m="calm";
  setMode(MODES[m]?m:"lifeful","opening demo");
  updateModelLine();
  bootPacks();
  bootAgent();
  loadConfig(); loadAppConfig(); loadMacros(); loadNotes();
  var pane=sp.get("pane"); if(pane && PANES.indexOf("pane-"+pane)>=0) showPane("pane-"+pane);
  var q=sp.get("ask");
  if(q) setTimeout(function(){ ask(q.slice(0,120)); }, 600);
})();
