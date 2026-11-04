/* One live document per browser tab. Native child WebViews and web actor
   pages retain their own forms/history; switching never re-navigates. */
(function () {
  'use strict';
  var host, api, slot, onState, native, home;
  var worlds = {}, generation = 0, selection = Promise.resolve();
  var nativeToken, bridgeTimer, syncTimer, sizing;
  var image, input, streamKey, streamRevision = 0, inputQueue = Promise.resolve();
  var visible = true, adjusting = false;
  function standalone() { return window.__PROFILES_STANDALONE__ === true; }
  function world(person) {
    person = person || slot();
    if (!worlds[person]) worlds[person] = { tabs: [blank('tab-1')], active: 'tab-1', next: 2, revision: 0, selectionRevision: 0, snapshotNext: 0, snapshotApplied: 0 };
    return worlds[person];
  }
  function blank(id) { return { id: id, url: '', title: 'New Tab', zoom: 1, loading: false, epoch: 0 }; }
  function currentTabs() { return world().tabs; }
  function getActiveTab() { var w = world(); return w.tabs.find(function (t) { return t.id === w.active; }); }
  function context(tabId, person) {
    person = person || slot();
    var w = world(person), tab = w.tabs.find(function (t) { return t.id === (tabId || w.active); });
    var epochs = {};
    w.tabs.forEach(function (t) { epochs[t.id] = t.epoch; });
    return { person: person, tab: tab, key: person + '--' + (tab && tab.id), generation: generation, revision: w.revision, selectionRevision: w.selectionRevision, epochs: epochs };
  }
  function current(c) { return c.generation === generation && c.person === slot() && c.tab && getActiveTab() === c.tab; }
  function alive(c) { return c.tab && world(c.person).tabs.indexOf(c.tab) >= 0; }
  function ownsRevision(c) { return c.generation === generation && c.person === slot() && c.revision === world(c.person).revision; }
  function ownsSelection(c) { return current(c) && c.selectionRevision === world(c.person).selectionRevision; }
  function report(out) { if (onState) onState(out); return out; }
  function failed(error) { return { ok: false, error: String(error.message || error) }; }
  function bounds() { var r = host.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }
  function request(path, body, c, method) {
    c = c || context();
    if (path === 'tabs') c.snapshot = ++world(c.person).snapshotNext;
    var url = new URL(api('/api/browser/' + path), location.href);
    url.searchParams.set('profileSlot', c.person);
    if (c.tab) url.searchParams.set('tabId', c.tab.id);
    return fetch(url.href, { method: method || 'POST', headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body || {}) }).then(function (r) {
      return r.json().then(function (out) { if (!r.ok) throw new Error(out.error || 'Browser HTTP ' + r.status); return out; });
    });
  }
  function normalize(out, c) {
    if (!out) return failed('Browser returned no result.');
    return Object.assign({}, out, { slot: c.person, tabId: c.tab.id });
  }
  function renderTabs() {
    var list = document.getElementById('browserTabsList');
    if (!list) return;
    list.textContent = '';
    var active = getActiveTab();
    currentTabs().forEach(function (tab) {
      var row = document.createElement('div');
      row.className = 'browser-tab' + (tab === active ? ' active' : '');
      row.dataset.tabId = tab.id;
      row.setAttribute('role', 'tab'); row.setAttribute('aria-selected', String(tab === active));
      row.tabIndex = tab === active ? 0 : -1;
      var title = document.createElement('span'); title.className = 'browser-tab-title';
      title.textContent = tab.title || tab.url || 'New Tab'; row.title = title.textContent;
      row.appendChild(title);
      var close = document.createElement('button'); close.type = 'button'; close.className = 'browser-tab-close';
      close.textContent = '×'; close.title = 'Close tab (Ctrl+W)'; close.setAttribute('aria-label', 'Close ' + title.textContent);
      close.addEventListener('click', function (e) { e.stopPropagation(); closeTab(tab.id); });
      row.appendChild(close);
      row.addEventListener('click', function () { if (tab !== getActiveTab()) switchTab(tab.id); });
      row.addEventListener('auxclick', function (e) { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } });
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab(tab.id); }
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); cycleTab(e.key === 'ArrowLeft' ? -1 : 1); }
      });
      list.appendChild(row);
    });
  }
  function stopStream() {
    streamRevision++; inputQueue = Promise.resolve();
    if (image) { image.removeAttribute('src'); image.remove(); }
    if (input) input.remove();
    image = input = null; streamKey = null;
  }
  function stream(c) {
    if (native || !current(c) || !visible || adjusting || !c.tab.url) return;
    if (streamKey === c.key && image) return;
    stopStream(); streamKey = c.key;
    var revision = streamRevision;
    function ownsStream() { return revision === streamRevision && image === img && input === text && current(c) && visible && !adjusting; }
    var img = document.createElement('img'), text = document.createElement('textarea');
    image = img; input = text;
    img.alt = 'Live browser page'; img.draggable = false;
    img.style.cssText = 'display:block;width:100%;height:100%;object-fit:fill;touch-action:pan-y';
    var url = new URL(api('/api/browser/stream'), location.href);
    url.searchParams.set('profileSlot', c.person); url.searchParams.set('tabId', c.tab.id);
    img.src = url.href; host.appendChild(img);
    text.setAttribute('aria-label', 'Type in the web page'); text.autocomplete = 'off';
    text.style.cssText = 'position:absolute;left:0;bottom:0;width:1px;height:1px;opacity:0'; host.appendChild(text);
    function enqueue(kind, body) {
      inputQueue = inputQueue.catch(function () {}).then(function () {
        if (!ownsStream()) return;
        return request(kind, body, c);
      }).catch(function (e) { if (ownsStream()) report(Object.assign(failed(e), { visible: false })); });
    }
    img.addEventListener('click', function (e) {
      if (!ownsStream()) return;
      var r = img.getBoundingClientRect();
      enqueue('mouse', { kind: 'click', fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height });
      text.focus({ preventScroll: true });
    });
    img.addEventListener('wheel', function (e) {
      if (!ownsStream()) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) window.dispatchEvent(new CustomEvent('profiles-browser-zoom-step', { detail: e.deltaY < 0 ? 0.1 : -0.1 }));
      else enqueue('mouse', { kind: 'wheel', fy: e.deltaY });
    }, { passive: false });
    text.addEventListener('input', function () { var value = text.value; text.value = ''; if (value) enqueue('keys', { kind: 'type', text: value }); });
    text.addEventListener('keydown', function (e) {
      if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey) return;
      if (e.key.length > 1 && !/^(Shift|Control|Alt|Meta|OS)$/.test(e.key)) { e.preventDefault(); enqueue('keys', { kind: 'press', key: e.key }); }
    });
    img.addEventListener('error', function () { if (current(c) && image === img) report(failed('Live browser connection interrupted. Retry to reconnect.')); });
  }
  function display(c) {
    if (!current(c)) return Promise.resolve();
    home.hidden = !!c.tab.url;
    if (!c.tab.url || !visible || adjusting) {
      stopStream();
      return native && native.activeSlot === c.key ? native.setVisible(false, c.key) : Promise.resolve();
    }
    if (!native) { stream(c); return resize(); }
    if (!host.getClientRects().length || native.activeSlot !== c.key) return Promise.resolve();
    var box = bounds();
    if (box.width < 1 || box.height < 1) return Promise.resolve();
    return native.resize(box, c.key).then(function () {
      if (current(c) && visible && !adjusting && native.activeSlot === c.key) return native.setVisible(true, c.key);
    });
  }
  function present(out, c, fromEvent) {
    if (!out) return out;
    if (!c) {
      if (out.slot && out.slot !== slot()) return out;
      c = context(out.tabId);
    }
    if (!alive(c)) return out;
    if (Object.prototype.hasOwnProperty.call(out, 'url')) c.tab.url = out.url === 'about:blank' ? '' : out.url;
    if (Object.prototype.hasOwnProperty.call(out, 'title')) c.tab.title = out.title || c.tab.url || 'New Tab';
    if (typeof out.zoom === 'number') c.tab.zoom = out.zoom;
    if (typeof out.loading === 'boolean') c.tab.loading = out.loading;
    if (c.person === slot()) renderTabs();
    var result = normalize(out, c);
    if (current(c)) {
      report(Object.assign({ url: c.tab.url, title: c.tab.title, zoom: c.tab.zoom }, result));
      if (!fromEvent) display(c).catch(function (e) { if (current(c)) report(failed(e)); });
    }
    return result;
  }
  function reconcile(out, c) {
    if (!out || !out.ok || !Array.isArray(out.tabs) || !ownsRevision(c)) return out;
    var w = world(c.person);
    if (c.snapshot < w.snapshotApplied) return out;
    w.snapshotApplied = c.snapshot;
    w.tabs = out.tabs.map(function (t) {
      var existing = w.tabs.find(function (old) { return old.id === t.id; });
      if (existing && c.epochs[t.id] !== existing.epoch) return existing;
      return Object.assign(existing || blank(t.id), t, { url: t.url === 'about:blank' ? '' : t.url });
    });
    w.active = out.activeTabId;
    renderTabs();
    var active = context();
    if (active.tab) present(Object.assign({}, out, active.tab), active);
    return out;
  }
  function scheduleSelection(fn) {
    selection = selection.catch(function () {}).then(fn);
    return selection;
  }
  function selectNative(c) {
    return scheduleSelection(async function () {
      await native.ready;
      if (!ownsSelection(c)) return failed('Tab selection was superseded.');
      var out = await native.switchSlot(c.key);
      if (ownsSelection(c) && c.tab.epoch === c.epochs[c.tab.id]) present(out, c);
      return out;
    });
  }
  async function nativeReady(c, epoch) {
    await selection;
    if (!ownsSelection(c) || c.tab.epoch !== epoch) throw new Error('Profile, tab or navigation changed before navigation.');
    if (!host.getClientRects().length) window.dispatchEvent(new Event('profiles-browser-activate'));
    for (var frame = 0; frame < 30; frame++) {
      if (!ownsSelection(c) || c.tab.epoch !== epoch) throw new Error('Profile, tab or navigation changed before navigation.');
      var box = bounds();
      if (box.width >= 1 && box.height >= 1) {
        var out = await native.ensure(c.key, box);
        if (!ownsSelection(c) || c.tab.epoch !== epoch) throw new Error('Profile, tab or navigation changed before navigation.');
        if (!out.ok && out.slot !== c.key) throw new Error(out.error);
        return out;
      }
      await new Promise(requestAnimationFrame);
    }
    throw new Error('Restore the browser pane before browsing.');
  }
  async function navigate(url) {
    var c = context(), epoch = ++c.tab.epoch;
    c.tab.requestedUrl = url; c.tab.url = url; c.tab.title = url; renderTabs();
    try {
      var out;
      if (native) {
        await nativeReady(c, epoch);
        if (!ownsSelection(c) || c.tab.epoch !== epoch) return normalize(failed('Navigation was superseded.'), c);
        out = await native.navigate(url, c.key, function (started) {
          if (ownsSelection(c) && c.tab.epoch === epoch && started.ok) present(Object.assign({}, started, { url: url, title: '', loading: true }), c);
        });
      } else {
        await selection;
        if (!ownsSelection(c) || c.tab.epoch !== epoch) return normalize(failed('Navigation was superseded.'), c);
        out = await request('view', { url: url }, c);
      }
      return c.tab.epoch === epoch && alive(c) ? present(out, c) : normalize(out, c);
    } catch (e) { var error = normalize(failed(e), c); if (ownsSelection(c) && c.tab.epoch === epoch) report(error); return error; }
  }
  async function action(kind, args, tabId) {
    var c = context(tabId);
    if (!c.tab || !current(c)) return failed('The requested tab is no longer displayed.');
    try {
      await selection;
      if (!current(c)) return failed('Profile or tab changed before action.');
      var out;
      if (native) {
        if (native.activeSlot !== c.key) return failed('Browser tab is not selected.');
        if (kind === 'read') out = await native.read(args && args.maxChars, c.key);
        else if (kind === 'zoom') out = await native.setZoom(args.zoom, c.key);
        else if (kind === 'dark') out = await native.dark(args && args.on, c.key);
        else if (kind === 'cursor') out = await native.cursor(args || {}, c.key);
        else if (kind === 'resize') out = await native.resize(bounds(), c.key);
        else if (['click', 'type', 'press', 'screenshot'].includes(kind)) out = await native[kind](args || {}, c.key);
        else out = await native[kind](c.key);
      } else out = await request(kind === 'current' ? 'view' : kind, args, c);
      if (['current', 'back', 'forward', 'reload'].includes(kind)) return present(out, c);
      return normalize(out, c);
    } catch (e) { return normalize(failed(e), c); }
  }
  function switchTab(id) {
    var w = world();
    if (!w.tabs.some(function (t) { return t.id === id; })) return Promise.resolve(failed('Unknown tab.'));
    w.active = id; w.revision++; w.selectionRevision++;
    var c = context(id);
    stopStream(); renderTabs();
    report({ ok: true, slot: c.person, tabId: id, url: c.tab.url, title: c.tab.title, zoom: c.tab.zoom });
    if (native) return selectNative(c);
    return scheduleSelection(function () {
      if (!current(c) || !ownsRevision(c)) return failed('Tab selection superseded.');
      return request('tabs', { action: 'switch', tabId: id }, c).then(function (out) { return reconcile(out, c); });
    });
  }
  async function createTab(url) {
    var c = context();
    if (native) {
      var w = world(), tab = blank('tab-' + w.next++); w.tabs.push(tab);
      await switchTab(tab.id);
      if (url && slot() === c.person && getActiveTab() === tab) await navigate(url);
    } else {
      world().revision++; c = context();
      stopStream();
      await scheduleSelection(function () {
        if (c.person !== slot() || c.generation !== generation) return;
        return request('tabs', { action: 'create', url: url }, c).then(function (out) { return reconcile(out, c); });
      });
    }
    if (slot() === c.person) { var address = document.getElementById('urlInput'); if (address) { address.value = getActiveTab().url || ''; if (!url) address.focus(); } }
    return getActiveTab();
  }
  async function closeTab(id) {
    var c = context(id), w = world();
    if (!c.tab) return failed('Unknown tab.');
    w.revision++; c = context(id);
    if (w.active === id) stopStream();
    if (!native) return scheduleSelection(function () { return request('tabs', { action: 'close', tabId: id }, c).then(function (out) { return reconcile(out, c); }); });
    var out = await native.close(c.key);
    if (!out.ok) return out;
    var index = w.tabs.indexOf(c.tab); if (index < 0) return out;
    w.tabs.splice(index, 1);
    if (!w.tabs.length) w.tabs.push(blank('tab-' + w.next++));
    if (w.active === id) {
      w.active = w.tabs[Math.min(index, w.tabs.length - 1)].id;
      if (c.person === slot()) return switchTab(w.active);
    }
    if (c.person === slot()) renderTabs();
    return out;
  }
  function cycleTab(delta) { var tabs = currentTabs(), i = tabs.indexOf(getActiveTab()); return switchTab(tabs[(i + delta + tabs.length) % tabs.length].id); }
  function resize() {
    if (!host || !getActiveTab().url || !visible || adjusting || !host.getClientRects().length) return Promise.resolve();
    var c = context();
    if (native) return display(c);
    clearTimeout(sizing);
    sizing = setTimeout(function () { if (current(c)) request('size', { w: host.clientWidth, h: host.clientHeight }, c).catch(function () {}); }, 80);
    return Promise.resolve();
  }
  function bridge() {
    if (standalone() || !native || nativeToken) return;
    var person = slot(), gen = generation, c = context();
    request('native/register', { tabId: c.tab.id }, c).then(function (r) {
      if (gen !== generation) return;
      var token = nativeToken = r.token;
      async function poll() {
        if (gen !== generation) return;
        try {
          var commands = await request('native/poll', { token: token, tabId: getActiveTab().id }, context());
          for (var command of commands.commands) {
            if (gen !== generation) return;
            var out;
            if (command.action === 'tabs') {
              var a = command.args || {};
              if (a.action === 'create') await createTab(a.url);
              else if (a.action === 'close') await closeTab(a.tabId);
              else if (a.action === 'switch') await switchTab(a.tabId);
              out = Object.assign({ ok: true, slot: person, activeTabId: world().active, tabs: currentTabs().map(function (t) { return Object.assign({}, t); }) }, getActiveTab(), { tabId: getActiveTab().id });
            } else if (command.tabId && command.tabId !== getActiveTab().id) out = failed('The requested browser tab is no longer displayed.');
            else out = command.action === 'navigate' ? await navigate(command.args.url) : await action(command.action, command.args, command.tabId);
            await request('native/result', { token: token, id: command.id, result: out }, context());
          }
        } catch (_) { if (gen === generation) nativeToken = null; }
        if (gen === generation) bridgeTimer = setTimeout(nativeToken ? poll : bridge, nativeToken ? 250 : 1000);
      }
      poll();
    }).catch(function () { if (gen === generation) bridgeTimer = setTimeout(bridge, 1000); });
  }
  function syncTabs() {
    if (native || standalone() || document.visibilityState === 'hidden') return;
    var c = context();
    selection.then(function () { if (ownsRevision(c)) return request('tabs', {}, c, 'GET'); }).then(function (out) { reconcile(out, c); }).catch(function () {});
  }
  function switchSlot() {
    generation++; clearTimeout(bridgeTimer); nativeToken = null; stopStream(); renderTabs();
    var c = context();
    home.hidden = !!c.tab.url;
    if (native) selectNative(c).then(function () { if (current(c)) bridge(); });
    else scheduleSelection(function () { return request('tabs', {}, c, 'GET').then(function (out) { return reconcile(out, c); }); });
  }
  window.ProfilesBrowserPane = {
    init: function (options) {
      host = options.host; api = options.api; slot = options.slot; onState = options.onState;
      native = window.ProfilesNativeBrowser && window.ProfilesNativeBrowser.available ? window.ProfilesNativeBrowser : null;
      home = document.createElement('div'); home.className = 'browser-home';
      var heading = document.createElement('h2'); heading.textContent = 'Browse';
      var help = document.createElement('p'); help.textContent = 'Search or enter an address above. Your agent uses this same tab.';
      home.appendChild(heading); home.appendChild(help); host.appendChild(home);
      switchSlot();
      new ResizeObserver(resize).observe(host);
      window.addEventListener('resize', resize); window.addEventListener('scroll', resize, { passive: true, capture: true });
      window.addEventListener('profiles-browser-state', function (e) {
        if (!native || !e.detail || !e.detail.slot) return;
        var parts = e.detail.slot.split('--');
        if (parts.length !== 2) return;
        var c = context(parts[1], parts[0]);
        if (alive(c)) present(e.detail, c, true);
      });
      var button = document.getElementById('browserTabNew'); if (button) button.addEventListener('click', function () { createTab(); });
      syncTimer = setInterval(syncTabs, 2000);
      window.addEventListener('pagehide', function () { clearInterval(syncTimer); clearTimeout(bridgeTimer); stopStream(); });
      return this;
    },
    navigate: navigate, present: present, resize: resize, switchSlot: switchSlot,
    createTab: createTab, switchTab: switchTab, closeTab: closeTab,
    closeActiveTab: function () { return closeTab(getActiveTab().id); }, cycleTab: cycleTab,
    getTabs: currentTabs, getActiveTab: getActiveTab, renderTabs: renderTabs,
    back: function () { return action('back'); }, forward: function () { return action('forward'); }, reload: function () { return action('reload'); },
    retry: function () { var tab = getActiveTab(); return tab.requestedUrl || tab.url ? navigate(tab.requestedUrl || tab.url) : Promise.resolve(failed('No address to retry.')); },
    read: function (maxChars) { return action('read', { maxChars: maxChars }); }, current: function () { return action('current'); },
    click: function (args) { return action('click', args); }, type: function (args) { return action('type', args); }, press: function (args) { return action('press', args); },
    setZoom: function (value) {
      var c = context(); c.tab.zoom = value;
      if (!c.tab.url) return Promise.resolve();
      return selection.then(function () { if (current(c)) return native ? native.setZoom(value, c.key) : request('zoom', { zoom: value }, c); });
    },
    setDark: function (on) {
      var c = context();
      if (!c.tab || !c.tab.url || !native) return Promise.resolve({ ok: false, error: 'no live page' });
      return action('dark', { on: !!on });
    },
    setVisible: function (value) { visible = !!value; return display(context()); },
    setAdjusting: function (value) { adjusting = !!value; return display(context()); }
  };
})();
