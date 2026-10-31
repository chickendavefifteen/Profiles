/* One displayed session: native WebView on desktop, the same Playwright page
   as the agent over an on-demand stream on web. Never rewrite site HTML. */
(function () {
  'use strict';
  var host, api, slot, onState, native, started = false, image, input, queue = Promise.resolve();
  function standalone(){ return window.__PROFILES_STANDALONE__===true; }
  var zoom = 1, nativeToken = null, bridgeTimer, generation = 0, sizing;
  var selection=Promise.resolve();
  function request(path, body) {
    return fetch(api('/api/browser/' + path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().then(function (out) { if (!r.ok) throw new Error(out.error || 'Browser HTTP ' + r.status); return out; }); });
  }
  function report(out) { if (onState) onState(out); return out; }
  function failure(e) { return report({ ok: false, error: String(e.message || e) }); }
  function bounds() { var r = host.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }
  async function nativeReady() {
    var gen=generation, targetSlot=slot();
    await native.ready;
    await selection;
    if(!host.getClientRects().length) window.dispatchEvent(new Event('profiles-browser-activate'));
    for(var frame=0;frame<30;frame++){
      if(gen!==generation) throw new Error('Profile changed before navigation.');
      var box=bounds();
      if(box.width>=1 && box.height>=1){
        var out=await native.ensure(targetSlot,box);
        if(!out.ok) throw new Error(out.error);
        return out;
      }
      await new Promise(requestAnimationFrame);
    }
    throw new Error('The browser pane is not visible. Restore it and retry.');
  }
  function bridge() {
    if (standalone()) return; /* standalone: native view only, never poll the Node bridge */
    if (!native || nativeToken) return;
    var gen = generation;
    var targetSlot=slot();
    request('native/register').then(function (r) {
      if (gen !== generation) return;
      nativeToken = r.token;
      function poll() {
        if (gen !== generation) return;
        request('native/poll', { token: nativeToken }).then(function (r) {
          return r.commands.reduce(function (p, command) {
            return p.then(function () {
              if(gen!==generation) return;
              var method = command.action === 'navigate'
                ? function () { return nativeReady().then(function () { if(gen!==generation) return {ok:false,error:'Profile changed.'}; return nativeNavigate(command.args.url,targetSlot,gen); }); }
                : function () { return command.action==='read' ? native.read(undefined,targetSlot) : native[command.action](targetSlot); };
              return Promise.resolve().then(method).catch(function (e) { return { ok: false, error: String(e.message || e) }; }).then(function (out) {
                if (gen !== generation) return;
                if(command.action==='navigate' || command.action==='back') present(out);
                else report(out);
                return request('native/result', { token: nativeToken, id: command.id, result: out });
              });
            });
          }, Promise.resolve());
        }).catch(function () { if(gen===generation) nativeToken = null; }).finally(function () {
          if (gen !== generation) return;
          if (nativeToken) bridgeTimer = setTimeout(poll, 250);
          else bridgeTimer = setTimeout(bridge, 1000);
        });
      }
      poll();
    }).catch(function () { if (gen === generation) bridgeTimer = setTimeout(bridge, 1000); });
  }
  function enqueue(kind, body) {
    queue = queue.catch(function () {}).then(function () { return request(kind, body); }).catch(failure);
    return queue;
  }
  function stream() {
    if (native || image) return;
    image = document.createElement('img'); image.alt = 'Live browser page'; image.draggable = false;
    image.style.cssText = 'display:block;width:100%;height:100%;object-fit:fill;touch-action:pan-y';
    image.src = api('/api/browser/stream'); host.appendChild(image);
    input = document.createElement('textarea'); input.setAttribute('aria-label', 'Type in the web page');
    input.autocomplete = 'off'; input.style.cssText = 'position:absolute;left:0;bottom:0;width:1px;height:1px;opacity:0'; host.appendChild(input);
    image.addEventListener('click', function (e) {
      var r = image.getBoundingClientRect();
      enqueue('mouse', { kind: 'click', fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height });
      input.focus({ preventScroll: true });
    });
    image.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) window.dispatchEvent(new CustomEvent('profiles-browser-zoom-step', { detail: e.deltaY < 0 ? 0.1 : -0.1 }));
      else enqueue('mouse', { kind: 'wheel', fy: e.deltaY });
    }, { passive: false });
    input.addEventListener('input', function () { var text = input.value; input.value = ''; if (text) enqueue('keys', { kind: 'type', text: text }); });
    input.addEventListener('keydown', function (e) {
      if (e.defaultPrevented || e.isComposing) return;
      if (e.key.length > 1 && !/^(Shift|Control|Alt|Meta|OS)$/.test(e.key)) {
        e.preventDefault(); enqueue('keys', { kind: 'press', key: e.key });
      }
    });
    image.addEventListener('error', function () { failure(new Error('Live browser connection was interrupted. Retry to reconnect without losing the page.')); });
  }
  function resize() {
    if (!host || !started || !host.getClientRects().length) return Promise.resolve();
    if (standalone() && !native) return Promise.resolve();
    if (native) {
      var box=bounds();
      var gen=generation,targetSlot=slot();
      if(box.width>=1 && box.height>=1) return native.resize(box,targetSlot).then(function(out){if(gen!==generation) return;return out.ok===false ? failure(new Error(out.error)) : out;}).catch(function(e){if(gen===generation) return failure(e);});
      return Promise.resolve();
    }
    clearTimeout(sizing);
    sizing = setTimeout(function () { request('size', { w: host.clientWidth, h: host.clientHeight }).catch(failure); }, 80);
  }
  function present(out) {
    if (!out) return;
    if(out.slot && out.slot!==slot()) return;
    if (out.ok && out.url && out.url!=='about:blank') {
      started = true; host.querySelector('.browser-home').hidden = true;
      if (native) {
        var gen=generation,targetSlot=slot();
        resize().then(function(resized){
          if(gen!==generation || !host.getClientRects().length || (resized && resized.ok===false)) return;
          return native.setVisible(true,targetSlot).then(function(shown){
            if(gen===generation && shown.ok) return native.setZoom(zoom,targetSlot);
          });
        }).catch(function(e){if(gen===generation) failure(e);});
      }
      else { stream(); resize(); }
    }
    return report(out);
  }
  function nativeNavigate(url,targetSlot,gen){
    return native.navigate(url,targetSlot,function(out){
      if(gen===generation && out.ok) present(Object.assign({},out,{slot:targetSlot,url:url,title:'',loading:true}));
    });
  }
  function navigate(url) {
    var gen=generation, targetSlot=slot();
    if (standalone() && !native) return Promise.resolve(failure(new Error("Browsing needs the native view — Node backend missing.")));
    return (native ? nativeReady().then(function () { if(gen!==generation) return {ok:false,error:'Profile changed.'}; return nativeNavigate(url,targetSlot,gen); }) : request('view', { url: url }))
      .then(function(out){ if(gen===generation) return present(out); }).catch(function(e){if(gen===generation) return failure(e);});
  }
  window.ProfilesBrowserPane = {
    init: function (options) {
      host = options.host; api = options.api; slot = options.slot; onState = options.onState;
      native = window.ProfilesNativeBrowser && window.ProfilesNativeBrowser.available ? window.ProfilesNativeBrowser : null;
      var home = document.createElement('div'); home.className = 'browser-home';
      var heading = document.createElement('h2'); heading.textContent = 'Browse';
      var help = document.createElement('p'); help.textContent = 'Search or enter a web address above. Your agent uses this same page.';
      home.appendChild(heading); home.appendChild(help); host.appendChild(home);
      if (native) {
        var gen=generation,targetSlot=slot();
        selection=native.ready.then(function(){return native.switchSlot(targetSlot);});
        selection.then(function(out){if(gen!==generation) return;if(out.ok && out.url) present(out);if(!standalone()) bridge();}).catch(failure);
      }
      new ResizeObserver(resize).observe(host);
      window.addEventListener('resize', resize);
      window.addEventListener('scroll', resize, { passive: true, capture: true });
      window.addEventListener('profiles-browser-state', function (e) { if(!e.detail.slot || e.detail.slot===slot()) report(e.detail); });
      return this;
    },
    navigate: navigate, present: present, resize: resize,
    back: function () { if (standalone() && !native) return Promise.resolve(failure(new Error("Browsing needs the native view — Node backend missing."))); return (native ? native.back() : request('back')).then(present).catch(failure); },
    setZoom: function (value) {
      zoom = value;
      if (!started) return Promise.resolve();
      if (standalone() && !native) return Promise.resolve();
      var gen=generation,targetSlot=slot();
      return (native ? native.setZoom(zoom,targetSlot) : request('zoom', { zoom: zoom })).catch(function(e){if(gen===generation) return failure(e);});
    },
    setVisible: function (visible) {
      if (native && started) {
        var gen=generation,targetSlot=slot();
        if(visible) resize().then(function(out){if(gen===generation && host.getClientRects().length && (!out || out.ok!==false)) return native.setVisible(true,targetSlot);}).catch(function(e){if(gen===generation) failure(e);});
        else native.setVisible(false,targetSlot).catch(function(e){if(gen===generation) failure(e);});
      }
      if (!native && image) { if (visible) image.src = api('/api/browser/stream'); else image.removeAttribute('src'); }
    },
    switchSlot: function () {
      generation++; clearTimeout(bridgeTimer); nativeToken = null; started = false;
      if (image) image.remove(); if (input) input.remove(); image = input = null;
      host.querySelector('.browser-home').hidden = false;
      var gen=generation;
      if (native) {
        selection=native.switchSlot(slot());
        selection.then(function(out){if(gen!==generation) return;if(out.ok && out.url) present(out);if(!standalone()) bridge();}).catch(function(e){if(gen===generation) failure(e);});
      }
    },
    read: function (maxChars) {
      var gen=generation, targetSlot=slot();
      if (!native) return Promise.resolve(failure(new Error("Reading needs the native view — Node backend missing.")));
      return native.read(maxChars, targetSlot).then(function(out){ if(gen===generation) return present(out); }).catch(function(e){ if(gen===generation) return failure(e); });
    },
    current: function () {
      var gen=generation, targetSlot=slot();
      if (!native) return Promise.resolve(failure(new Error("No page is displayed yet — open a site first.")));
      return native.current(targetSlot).then(function(out){ if(gen===generation) return present(out); }).catch(function(e){ if(gen===generation) return failure(e); });
    },
    retry: function () { if (standalone() && !native) return Promise.resolve(failure(new Error("Browsing needs the native view — Node backend missing."))); if (native) return native.current().then(present).catch(failure); if (image) image.src = api('/api/browser/stream'); }
  };
})();
