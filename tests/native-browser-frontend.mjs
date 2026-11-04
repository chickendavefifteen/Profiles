import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Execute the public bridge and pane APIs, not a reimplementation of either.
// Only the native IPC boundary, layout and event loop are simulated. Deferred
// IPC makes the races reproducible without a browser, network or wall clock.
const bridgeSource = await readFile(new URL('../src/native-browser.js', import.meta.url), 'utf8');
const paneSource = await readFile(new URL('../src/browser-pane.js', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const page = (slot, url = '', title = '') => ({ ok: true, slot, url, title, loading: false });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}
function element(tag = 'div') {
  const listeners = new Map();
  return {
    tagName: tag.toUpperCase(), children: [], style: {}, dataset: {}, hidden: false,
    className: '', textContent: '', value: '', innerHTML: '', focusCount: 0,
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
    setAttribute() {}, removeAttribute() {},
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); },
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
    dispatch(name, event = {}) { for (const fn of listeners.get(name) || []) fn(event); },
    focus() { this.focusCount++; },
    getClientRects() { return [{}]; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; },
    querySelector(selector) { return selector === '.browser-home' ? this.children.find(child => child.className === 'browser-home') : null; }
  };
}
function harness({ pane = false, invoke, initialSlot = 'A', web = false, webFetch } = {}) {
  let selected = initialSlot, now = 0, nextTimer = 0;
  const timers = new Map(), calls = [], states = [], listeners = new Map();
  const intervals = [], requests = [], webWorlds = new Map();
  function webWorld(person) {
    if (!webWorlds.has(person)) webWorlds.set(person, { tabs: [{ id: 'tab-1', url: '', title: 'New Tab' }], activeTabId: 'tab-1', next: 2 });
    return webWorlds.get(person);
  }
  function snapshot(w) { return { ok: true, activeTabId: w.activeTabId, tabs: w.tabs.map(tab => ({ ...tab })) }; }
  const pages = new Map(['A', 'B', 'C'].map(person => {
    const key = pane ? person + '--tab-1' : person;
    return [key, page(key)];
  }));
  const host = element(), tabs = element(), urlInput = element('input');
  const window = {
    __PROFILES_STANDALONE__: !web,
    __TAURI__: {
      core: { invoke(command, args) {
        calls.push({ command, args });
        const handled = invoke?.(command, args, { pages, calls });
        if (handled !== undefined) return Promise.resolve(handled);
        if (command === 'browser_switch' || command === 'browser_ensure' || command === 'browser_current') {
          if (command === 'browser_switch' && /^[ABC]--tab-[1-9]\d*$/.test(args.slot) && !pages.has(args.slot)) pages.set(args.slot, page(args.slot));
          return Promise.resolve(pages.get(args.slot) || { ok: false, error: 'Unknown profile' });
        }
        if (command === 'browser_navigate') {
          const observed = page(args.slot, args.url, 'Document ' + new URL(args.url).pathname);
          pages.set(args.slot, observed);
          return Promise.resolve({ ...observed, title: '', loading: true });
        }
        if (['browser_resize', 'browser_visible', 'browser_zoom'].includes(command)) return Promise.resolve(page(args.slot));
        if (command === 'browser_close') { pages.delete(args.slot); return Promise.resolve({ok:true,slot:args.slot,closed:true}); }
        throw new Error('Unexpected IPC: ' + command);
      } },
      event: { listen: async () => () => {} }
    },
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); }
  };
  if (web) delete window.__TAURI__;
  class Event {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  }
  const context = {
    window, Promise, URL, Event, CustomEvent: Event, location: { href: 'http://profiles.test/' },
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn, delay = 0) { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, delay) { intervals.push({ fn, delay }); return intervals.length; }, clearInterval() {},
    requestAnimationFrame(fn) { return context.setTimeout(fn, 16); },
    ResizeObserver: class { observe() {} },
    document: {
      visibilityState: 'visible', createElement: element,
      getElementById(id) { return { browserTabsList: tabs, urlInput }[id] || null; }
    },
    fetch(raw, options) {
      if (!web) throw new Error('A native-only lifecycle must not use the sidecar');
      const url = new URL(raw), body = options.body ? JSON.parse(options.body) : {};
      const w = webWorld(url.searchParams.get('profileSlot'));
      const call = { path: url.pathname.replace('/api/browser/', ''), body, tabId: url.searchParams.get('tabId'), world: w };
      requests.push(call);
      const handled = webFetch?.(call, { snapshot });
      let result = handled;
      if (handled === undefined) {
        if (call.path === 'tabs') {
          if (body.action === 'switch') w.activeTabId = body.tabId;
          if (body.action === 'create') { const tab = { id: 'tab-' + w.next++, url: body.url || '', title: 'New Tab' }; w.tabs.push(tab); w.activeTabId = tab.id; }
          if (body.action === 'close') { w.tabs = w.tabs.filter(tab => tab.id !== body.tabId); if (w.activeTabId === body.tabId) w.activeTabId = w.tabs[0].id; }
          result = snapshot(w);
        } else {
          const tab = w.tabs.find(tab => tab.id === call.tabId);
          if (call.path === 'view' && body.url) { tab.url = body.url; tab.title = body.url; }
          result = { ok: true, ...tab };
        }
      }
      return Promise.resolve(result).then(out => ({ ok: true, json: async () => out }));
    }
  };
  vm.createContext(context);
  vm.runInContext(bridgeSource, context);
  if (pane) {
    vm.runInContext(paneSource, context);
    window.ProfilesBrowserPane.init({ host, api: path => path, slot: () => selected, onState: state => states.push({ ...state }) });
  }
  return {
    browser: window.ProfilesNativeBrowser, pane: window.ProfilesBrowserPane,
    pages, calls, states, host, requests, webWorlds,
    poll() { for (const interval of intervals) if (interval.delay === 2000) interval.fn(); },
    select(slot) { selected = slot; window.ProfilesBrowserPane.switchSlot(); },
    async settle(promise) {
      let done = false, value, error;
      Promise.resolve(promise).then(out => { done = true; value = out; }, caught => { done = true; error = caught; });
      for (let step = 0; step < 500 && !done; step++) {
        await flush();
        if (done) break;
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        assert.ok(next, 'operation is blocked without pending IPC completion or a scheduled readiness poll');
        timers.delete(next[0]); now = next[1].at; next[1].fn();
      }
      assert.ok(done, 'operation did not settle within the virtual readiness deadline');
      if (error) throw error;
      await flush();
      return value;
    }
  };
}

// Preserve the original slot-isolation and usable-document readiness guards.
{
  const navigation = deferred();
  const h = harness({ invoke(command, args) {
    if (command === 'browser_navigate' && args.slot === 'A') return navigation.promise;
    if (command === 'browser_screenshot') return Promise.reject(new Error('Snapshot capture failed'));
  } });
  h.pages.set('A', page('A', 'https://example.org/A', 'A document'));
  h.pages.set('B', page('B', 'https://example.org/B', 'B document'));
  await h.browser.switchSlot('A');
  const oldTurn = h.browser.navigate('https://example.org/A');
  await h.browser.switchSlot('B');
  navigation.resolve(h.pages.get('A'));
  assert.equal((await h.settle(oldTurn)).slot, 'A', 'an A turn must not poll B after a switch');
  assert.equal(h.browser.activeSlot, 'B', 'old navigation must not restore its profile');
  assert.equal((await h.browser.current()).url, 'https://example.org/B');
  await h.browser.switchSlot('invalid');
  await h.browser.ensure('invalid', { width: 800, height: 600 });
  assert.equal(h.browser.activeSlot, 'B', 'rejected selection and creation cannot poison the current profile');
  h.pages.set('A', { ...page('A', 'https://example.org/A', 'Usable main document'), loading: true });
  await h.browser.switchSlot('A');
  const usable = await h.settle(h.browser.navigate('https://example.org/A'));
  assert.equal(usable.ok, true);
  assert.equal(usable.loading, true, 'pending unrelated resources are not a fake navigation failure');
  assert.equal(usable.title, 'Usable main document');
  assert.ok(h.calls.filter(call => call.command === 'browser_current' && call.args.slot === 'A').length <= 2,
    'a usable main document must not wait out the 22-second resource deadline');
  const screenshot = await h.browser.screenshot({});
  assert.equal(screenshot.ok, false, 'failed native capture must not claim an image was captured');
  assert.match(screenshot.error, /Snapshot capture failed/);
  assert.equal(screenshot.dataUrl, undefined, 'failed capture cannot provide a fake screenshot');
}

// Latest requested profile wins even if older selection/creation resolves last.
for (const olderCommand of ['browser_switch', 'browser_ensure']) {
  const older = deferred(), newer = deferred();
  const h = harness({ invoke(command, args) {
    if (command === olderCommand && args.slot === 'A') return older.promise;
    if (command === 'browser_switch' && args.slot === 'B') return newer.promise;
  } });
  h.pages.set('A', page('A', 'https://example.org/A', 'A'));
  h.pages.set('B', page('B', 'https://example.org/B', 'B'));
  const first = olderCommand === 'browser_ensure'
    ? h.browser.ensure('A', { width: 800, height: 600 }) : h.browser.switchSlot('A');
  const second = h.browser.switchSlot('B');
  newer.resolve(h.pages.get('B')); await second;
  older.resolve(h.pages.get('A')); await first;
  assert.equal((await h.browser.current()).url, 'https://example.org/B', olderCommand + ' completion cannot undo a newer selection');
}

// Selecting another profile before initial event registration completes must
// not let the delayed initial selection steal the active browser back.
{
  const h = harness({ pane: true });
  h.select('B');
  await flush();
  await h.settle(h.pane.navigate('https://example.org/selected-B'));
  assert.equal((await h.browser.current()).url, 'https://example.org/selected-B',
    'delayed initial selection cannot take over the newly selected profile');
  assert.equal(h.browser.activeSlot, 'B--tab-1');
  assert.equal(h.pane.getActiveTab().url, 'https://example.org/selected-B');
  assert.ok(h.states.every(state => !state.slot || state.slot === 'B'),
    'initial profile state must not appear after the user selects B');
}

// Recover a failed first navigation: Retry must load the requested URL, not
// inspect about:blank/current (which cannot recover a failed network load).
{
  let attempts = 0;
  const target = 'https://example.org/Recover/Case?Q=AbC';
  const h = harness({ pane: true, invoke(command, args, { pages }) {
    if (command === 'browser_navigate' && ++attempts === 1) {
      const failed = { ...page(args.slot, args.url), ok: false, error: 'Connection refused' };
      pages.set(args.slot, failed);
      return failed;
    }
  } });
  await flush();
  await h.settle(h.pane.navigate(target));
  assert.equal(h.states.at(-1).ok, false, 'first network failure must be visible');
  await h.settle(h.pane.retry());
  assert.equal(h.states.at(-1).url, target, 'Retry must recover the failed first requested URL with its exact case');
  assert.equal(h.states.at(-1).ok, true);
  assert.equal(h.pane.getActiveTab().url, target);
  assert.equal(h.host.querySelector('.browser-home').hidden, true, 'recovered document replaces the new-tab placeholder');
  assert.equal(attempts, 2, 'Retry must perform a second real navigation');
}

// An existing failed page snapshot is not a failure to create/size the view.
// ensure must permit a new navigation to clear that previous load error.
{
  const h = harness({ pane: true });
  await flush();
  h.pages.set('A--tab-1', { ...page('A--tab-1', 'https://example.org/failed'), ok: false, error: 'Previous load failed' });
  const target = 'https://example.org/Recovered';
  await h.settle(h.pane.navigate(target));
  assert.equal(h.states.at(-1).url, target, 'a previous page error must not prevent issuing a fresh navigation');
  assert.equal(h.states.at(-1).ok, true);
}

// A real setup rejection still blocks browsing and is visible. Treating every
// failed ensure as an old page error would silently conceal missing views.
{
  const h = harness({ pane: true, invoke(command) {
    if (command === 'browser_ensure') return Promise.reject(new Error('Browser view creation failed'));
  } });
  await flush();
  await h.settle(h.pane.navigate('https://example.org/unavailable-view'));
  assert.equal(h.states.at(-1).ok, false);
  assert.match(h.states.at(-1).error, /Browser view creation failed/);
  assert.equal(h.calls.some(call => call.command === 'browser_navigate'), false,
    'navigation must not proceed when the native view could not be created');
}

// A newer same-profile navigation owns the pane. Old failures AND old success
// callbacks must not flash the previous URL, overwrite tabs or show an error.
for (const completion of ['failure', 'success']) {
  const old = deferred();
  const h = harness({ pane: true, invoke(command, args) {
    if (command === 'browser_navigate' && args.url.endsWith('/old')) return old.promise;
  } });
  await flush();
  const pending = h.pane.navigate('https://example.org/old');
  await flush();
  await h.settle(h.pane.navigate('https://example.org/new'));
  const stateCount = h.states.length;
  old.resolve(completion === 'failure'
    ? { ok: false, slot: 'A', error: 'Cancelled old navigation' }
    : page('A', 'https://example.org/old', 'Old document'));
  await h.settle(pending);
  assert.ok(h.states.slice(stateCount).every(state => state.ok !== false && state.url !== 'https://example.org/old'),
    'superseded ' + completion + ' cannot be reported over the newer document');
  assert.equal(h.pane.getActiveTab().url, 'https://example.org/new');
  assert.equal(h.host.querySelector('.browser-home').hidden, true);
}

// A profile switch while ensure is pending must neither navigate the previous
// profile nor display its eventual failure in the selected profile.
{
  const ensure = deferred();
  const h = harness({ pane: true, invoke(command, args) {
    if (command === 'browser_ensure' && args.slot === 'A--tab-1') return ensure.promise;
  } });
  await flush();
  const pending = h.pane.navigate('https://example.org/private-A');
  await flush();
  h.select('B'); await flush();
  await h.settle(h.pane.navigate('https://example.org/public-B'));
  const stateCount = h.states.length;
  ensure.reject(new Error('Old A view failed'));
  await h.settle(pending);
  assert.equal(h.browser.activeSlot, 'B--tab-1');
  assert.equal(h.pane.getActiveTab().url, 'https://example.org/public-B');
  assert.equal(h.states.length, stateCount, 'old-profile readiness failure cannot replace the selected profile state');
  assert.equal(h.calls.some(call => call.command === 'browser_navigate' && call.args.slot === 'A--tab-1'), false,
    'navigation waiting for old-profile readiness must be abandoned');
}

// Retry belongs to the selected profile, not the last globally attempted URL.
{
  const h = harness({ pane: true });
  await flush();
  await h.settle(h.pane.navigate('https://example.org/private-A'));
  h.select('B'); await flush();
  await h.settle(h.pane.navigate('https://example.org/public-B'));
  h.select('A'); await flush();
  const before = h.calls.filter(call => call.command === 'browser_navigate').length;
  await h.settle(h.pane.retry());
  const navigations = h.calls.filter(call => call.command === 'browser_navigate');
  assert.equal(navigations.length, before + 1, 'Retry must reload the selected profile document');
  assert.equal(navigations.at(-1).args.slot, 'A--tab-1');
  assert.equal(h.states.at(-1).url, 'https://example.org/private-A', 'Retry cannot leak another profile URL');
}

// Successful late readiness is just as stale as a rejected ensure. Exercise
// profile, same-profile tab and same-tab newer-navigation ownership separately.
for (const change of ['profile', 'tab', 'navigation']) {
  const ensure = deferred();
  let ensures = 0;
  const h = harness({ pane: true, invoke(command, args) {
    if (command === 'browser_ensure' && args.slot === 'A--tab-1' && ++ensures === 1) return ensure.promise;
  } });
  await flush();
  const pending = h.pane.navigate('https://example.org/stale-before-ensure');
  await flush();
  if (change === 'profile') h.select('B');
  if (change === 'tab') await h.pane.createTab();
  await flush();
  await h.settle(h.pane.navigate('https://example.org/latest-after-ensure'));
  const count = h.states.length;
  ensure.resolve(page('A--tab-1'));
  await h.settle(pending);
  assert.equal(h.calls.some(call => call.command === 'browser_navigate' && call.args.url.endsWith('/stale-before-ensure')), false,
    change + ': readiness cannot authorize a superseded navigation');
  assert.equal(h.pane.getActiveTab().url, 'https://example.org/latest-after-ensure');
  assert.equal(h.states.length, count, change + ': stale successful readiness cannot repaint the selected page');
}

// An already-sent T2 selection cannot overwrite a later T1 request and cause
// the serialized latest selection to be discarded.
{
  const delayed = deferred();
  let delaySwitch = false;
  const h = harness({ pane: true, web: true, webFetch(call, { snapshot }) {
    if (delaySwitch && call.path === 'tabs' && call.body.action === 'switch' && call.body.tabId === 'tab-2') {
      call.world.activeTabId = 'tab-2';
      return delayed.promise.then(() => snapshot(call.world));
    }
  } });
  await flush(); await h.pane.createTab();
  await h.pane.switchTab('tab-1');
  delaySwitch = true;
  const t2 = h.pane.switchTab('tab-2'); await flush();
  const t1 = h.pane.switchTab('tab-1'); await flush();
  delayed.resolve(); await t2; await t1; await flush();
  assert.equal(h.pane.getActiveTab().id, 'tab-1');
  assert.equal(h.webWorlds.get('A').activeTabId, 'tab-1', 'latest desired selection must reach the real actor boundary');
  assert.equal(h.requests.filter(call => call.body.action === 'switch').at(-1).body.tabId, 'tab-1');
}

// A poll which started before a mutation cannot undo selection, remove a new
// tab, or resurrect a closed tab. Snapshot the response before delaying it.
for (const mutation of ['switch', 'create', 'close']) {
  const poll = deferred();
  let delayPoll = false;
  const h = harness({ pane: true, web: true, webFetch(call, { snapshot }) {
    if (delayPoll && call.path === 'tabs' && !call.body.action) {
      delayPoll = false;
      const old = snapshot(call.world);
      return poll.promise.then(() => old);
    }
  } });
  await flush(); await h.pane.createTab();
  delayPoll = true; h.poll(); await flush();
  if (mutation === 'switch') await h.pane.switchTab('tab-1');
  if (mutation === 'create') await h.pane.createTab();
  if (mutation === 'close') await h.pane.closeTab('tab-2');
  const expected = JSON.stringify({ active: h.pane.getActiveTab().id, tabs: h.pane.getTabs().map(tab => tab.id) });
  poll.resolve(); await flush();
  assert.equal(JSON.stringify({ active: h.pane.getActiveTab().id, tabs: h.pane.getTabs().map(tab => tab.id) }), expected,
    mutation + ': stale poll cannot reconcile an old world');
}

// Polls with unchanged membership still cannot overwrite a newer local
// navigation, nor can an older poll overwrite a newer completed snapshot.
{
  let poll = deferred();
  let delayPoll = false;
  const h = harness({ pane: true, web: true, webFetch(call, { snapshot }) {
    if (delayPoll && call.path === 'tabs') {
      delayPoll = false;
      const old = snapshot(call.world);
      return poll.promise.then(() => old);
    }
  } });
  await flush();
  delayPoll = true; h.poll(); await flush();
  await h.pane.navigate('https://example.org/new-local-navigation');
  poll.resolve(); await flush();
  assert.equal(h.pane.getActiveTab().url, 'https://example.org/new-local-navigation',
    'same-tab navigation metadata is newer than the pending poll');
  poll = deferred();
  delayPoll = true; h.poll(); await flush();
  h.webWorlds.get('A').tabs[0].title = 'Newest server title';
  h.poll(); await flush();
  poll.resolve(); await flush();
  assert.equal(h.pane.getActiveTab().title, 'Newest server title',
    'an older completed snapshot cannot overwrite a newer reconciled snapshot');
}

for (const invalidate of ['switch', 'adjust', 'hide']) {
  const input = deferred();
  const h = harness({ pane: true, web: true, webFetch(call) {
    if (call.path === 'mouse') return input.promise;
  } });
  await flush(); await h.pane.navigate('https://example.org/stream');
  const image = h.host.children.find(child => child.tagName === 'IMG');
  const text = h.host.children.find(child => child.tagName === 'TEXTAREA');
  assert.ok(image && text, 'real pane creates the stream and its input target');
  image.dispatch('click', { clientX: 10, clientY: 10 }); await flush();
  text.value = 'must not reach old page'; text.dispatch('input');
  if (invalidate === 'switch') await h.pane.createTab();
  if (invalidate === 'adjust') await h.pane.setAdjusting(true);
  if (invalidate === 'hide') await h.pane.setVisible(false);
  const focuses = text.focusCount;
  image.dispatch('click', { clientX: 10, clientY: 10 });
  input.resolve({ ok: true }); await flush();
  assert.equal(h.requests.filter(call => call.path === 'mouse').length, 1,
    invalidate + ': disposed stream events cannot enqueue another click');
  assert.equal(h.requests.some(call => call.path === 'keys'), false,
    invalidate + ': already queued old-stream typing must be invalidated');
  assert.equal(text.focusCount, focuses, 'disposed stream must not steal input focus');
}

// Evaluate the actual chrome handlers in a minimal DOM context. This proves
// DOM ownership and click consumption, not delivery by GTK itself.
function mainFragment(start, end) {
  const from = mainSource.indexOf(start), to = mainSource.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'frontend source anchors must remain explicit');
  return mainSource.slice(from, to);
}
{
  let adjusting = true, dismissals = 0;
  const listeners = new Map();
  const context = vm.createContext({
    state: { slot: 'A' }, superAlone: true, dismissAdjust() { if (!adjusting) return false; adjusting = false; dismissals++; return true; },
    window: { addEventListener(name, fn) { listeners.set(name, fn); } }
  });
  vm.runInContext(mainFragment('window.addEventListener("profiles-browser-input"', '/* ---- chat:'), context);
  const input = listeners.get('profiles-browser-input');
  input({ detail: { slot: null, kind: 'pointer' } });
  assert.equal(adjusting, true, 'slot-less native chrome notification cannot cancel a DOM header/edge gesture');
  input({ detail: { slot: 'B--tab-1', kind: 'key' } });
  assert.equal(adjusting, true, 'another profile cannot dismiss this profile layout');
  input({ detail: { slot: 'A--tab-1', kind: 'key' } });
  assert.equal(dismissals, 1, 'displayed child-browser input still dismisses adjust');
}
{
  const listeners = new Map(), pane = { id: 'pane-browser' };
  let lands = 0;
  const context = vm.createContext({
    adjustMode: true, resizing: null, unpinned: null,
    edgeDir(pane, x) { return x === 0 ? 'w' : ''; }, landAll() { lands++; context.adjustMode = false; }, land() {},
    document: { addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); } }
  });
  vm.runInContext(mainFragment('  var downPos=null', '})();\n\n/* agent layout commands:'), context);
  function target(kind) {
    return { classList: { contains() { return false; } }, closest(selector) {
      if (selector === '.pane') return pane;
      if (selector === '.panehead') return kind === 'header' ? {} : null;
      if (selector === 'button,a,input,select,textarea') return kind === 'pin' ? {} : null;
      return null;
    } };
  }
  function event(kind) {
    return { target: target(kind), clientX: 100, clientY: 100, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  }
  const header = event('header');
  listeners.get('pointerdown')[0](header);
  assert.equal(lands, 0, 'header press stays available for the real pane drag handler');
  const edge = event('body'); edge.clientX = 0;
  listeners.get('pointerdown')[0](edge);
  assert.equal(lands, 0, 'bare pane edges stay available for the real resize handler');
  const pin = event('pin');
  listeners.get('pointerdown')[0](pin);
  assert.equal(lands, 1);
  assert.equal(pin.prevented && pin.stopped, true, 'dismissal press cannot reach the pin handler');
  const click = event('pin');
  listeners.get('click')[0](click);
  assert.equal(click.prevented && click.stopped, true, 'follow-on click cannot re-unpin the locked pane');
}
{
  const listeners = new Map();
  let adjusting = true, shortcuts = 0;
  const context = vm.createContext({
    state: { slot: 'A' },
    profileShortcut() { shortcuts++; return true; },
    document: { addEventListener(name, fn) { listeners.set(name, fn); } },
    window: {
      addEventListener() {}, isAdjustMode() { return adjusting; },
      dismissAdjustMode() { adjusting = false; }
    }
  });
  vm.runInContext(mainFragment('var superAlone=', '/* ---- chat:'), context);
  const event = { key: 'a', prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  listeners.get('keydown')(event);
  assert.equal(adjusting, false);
  assert.equal(shortcuts, 0, 'ordinary dismissal key cannot activate a profile shortcut');
  assert.equal(event.prevented && event.stopped, true);
}
{
  const address = element('input'), badge = element();
  const context = vm.createContext({
    state: { slot: 'A', model: { name: 'Saved local model', via: 'local' } }, addressTabKey: null,
    $: id => id === 'urlInput' ? address : id === 'brainBadge' ? badge : null,
    document: { activeElement: address }, paneZoom: {}, pageZoom: 1, lastBrowserUrl: '', browserLoaded: false,
    hideFallback() {}, showFallback() {}, stream() {}, bootBuild: null,
    ProfilesBrowserPane: { getActiveTab: () => ({ id: context.activeId }) }, activeId: 'tab-1'
  });
  vm.runInContext(mainFragment('function updateBrowserState(out)', 'ProfilesBrowserPane.init('), context);
  vm.runInContext(mainFragment('function paintBadge(model)', 'function closeModelMenu()'), context);
  vm.runInContext(mainFragment('function checkBuild(h)', 'setInterval(function(){\n  if(isStandalone())'), context);
  context.updateBrowserState({ ok: true, slot: 'A', tabId: 'tab-1', url: 'https://example.org/one' });
  address.value = 'my unfinished edit';
  context.updateBrowserState({ ok: true, slot: 'A', tabId: 'tab-1', url: 'https://example.org/one-new-state' });
  assert.equal(address.value, 'my unfinished edit', 'same-tab state does not erase an active address edit');
  context.activeId = 'tab-2';
  context.updateBrowserState({ ok: true, slot: 'A', tabId: 'tab-2', url: 'https://example.org/two' });
  assert.equal(address.value, 'https://example.org/two', 'Ctrl+L then tab selection must show the new tab address even while focused');
  context.checkBuild({ demoMode: true, reasoningEffort: 'xhigh' });
  assert.equal(badge.textContent, 'muse-spark-1.3-contributor (xhigh)', 'health policy replaces the persisted local-model badge at boot');
  context.paintBadge({ name: 'Another saved local model', via: 'local' });
  assert.equal(badge.textContent, 'muse-spark-1.3-contributor (xhigh)', 'subsequent config/profile paints cannot override demo policy');
}

console.log('frontend: native readiness, web selection/poll/input ownership, chrome adjust and demo badge guards passed');
