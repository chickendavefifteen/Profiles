/* Profiles native browser bridge (loaded before main.js).
 *
 * Exposes window.ProfilesNativeBrowser over the genuine Tauri child-WebView
 * backend (src-tauri/src/browser.rs). All methods return promises resolving
 * to {ok, url?, title?, text?, ...}; failures resolve {ok:false, error}
 * and never throw. `available` is true when the Tauri IPC bridge exists
 * (__TAURI_INTERNALS__ / __TAURI__); in plain web builds every call resolves
 * {ok:false, error:'tauri unavailable'} so the principal's broker can fall
 * back to the sidecar /api/browser/native route.
 *
 * Backend commands (snake_case args): browser_ensure/resize/navigate/back/
 * current/read/zoom/visible/switch. Tauri events profiles-browser-state and
 * profiles-browser-zoom are re-dispatched as DOM CustomEvents of the same
 * name with the payload as `detail`.
 *
 * Zoom policy: Ctrl+wheel over a slot is handled exactly once by the native
 * engine (zoom_hotkeys_enabled). Never add an app-level wheel-zoom handler;
 * observe zoom via onZoom / the profiles-browser-zoom DOM event.
 */
(function () {
  'use strict';

  var active = null, selectionEpoch = 0;

  function env() { return window.__TAURI__ || null; }
  function internals() { return window.__TAURI_INTERNALS__ || null; }
  function available() { return !!(internals() || env()); }

  function invoke(cmd, args) {
    var e = env();
    if (e && e.core && typeof e.core.invoke === 'function') return e.core.invoke(cmd, args || {});
    var t = internals();
    if (t && typeof t.invoke === 'function') return t.invoke(cmd, args || {});
    return Promise.reject(new Error('tauri invoke unavailable'));
  }

  function call(cmd, args) {
    if (!available()) return Promise.resolve({ ok: false, error: 'tauri unavailable' });
    try {
      return invoke(cmd, args).then(
        function (r) { return r; },
        function (e) { return { ok: false, error: String((e && e.message) || e) }; }
      );
    } catch (e) {
      return Promise.resolve({ ok: false, error: String((e && e.message) || e) });
    }
  }

  function needActive() {
    return active
      ? null
      : { ok: false, error: 'no active slot (call ensure/switchSlot first)' };
  }

  function normBounds(b) {
    b = b || {};
    var w = b.width != null ? b.width : b.w;
    var h = b.height != null ? b.height : b.h;
    return { x: +b.x || 0, y: +b.y || 0, width: +w || 0, height: +h || 0 };
  }

  function listenTauri(name, fn) {
    var e = env();
    if (e && e.event && typeof e.event.listen === 'function') {
      return e.event.listen(name, function (ev) { fn(ev.payload); });
    }
    return Promise.resolve(function () {});
  }

  // Bridge backend events -> DOM CustomEvents (principal dispatches its own
  // profiles-browser-shortcut events for Super / latched Super+A/B/C/1..6).
  var eventReady=Promise.all(['profiles-browser-state', 'profiles-browser-zoom', 'profiles-browser-shortcut', 'profiles-open-url'].map(function (name) {
    return listenTauri(name, function (payload) {
      if(payload && payload.slot && active && payload.slot!==active) return;
      try {
        window.dispatchEvent(new CustomEvent(name, { detail: payload }));
      } catch (e) { /* ignore */ }
    });
  }));

  function settled(result, slot, requestedUrl) {
    if(!result || !result.ok) return Promise.resolve(result);
    var until=Date.now()+22000;
    return new Promise(function(resolve){
      function check(){
        call('browser_current',{slot:slot}).then(function(out){
          if(!out.ok || !out.loading || (out.title && out.url!=='about:blank' && (!requestedUrl || out.url===requestedUrl || out.url!==result.url))) return resolve(out);
          if(Date.now()>until) return resolve(out); // pending resources are not a failed navigation
          setTimeout(check,100);
        });
      }
      setTimeout(check,100);
    });
  }
  window.ProfilesNativeBrowser = {
    ready: eventReady,
    get available() { return available(); },
    get activeSlot() { return active; },

    ensure: function (slot, bounds, url) {
      var epoch=++selectionEpoch;
      var args = { slot: slot, bounds: normBounds(bounds) };
      if (url) args.url = url;
      return call('browser_ensure', args).then(function(out){if(out.ok && epoch===selectionEpoch) active=slot;return out;});
    },
    resize: function (bounds, slot) {
      slot=slot||active;
      if(!slot) return Promise.resolve(needActive());
      return call('browser_resize', { slot: slot, bounds: normBounds(bounds) });
    },
    navigate: function (url, slot, onStarted) {
      slot=slot||active;
      if(!slot) return Promise.resolve(needActive());
      return call('browser_navigate', { slot: slot, url: url }).then(function(out){
        if(out.ok && onStarted) onStarted(out);
        return settled(out,slot,url);
      });
    },
    back: function (slot) {
      slot=slot||active;
      if(!slot) return Promise.resolve(needActive());
      return call('browser_back', { slot: slot }).then(function(out){return settled(out,slot);});
    },
    current: function (slot) {
      slot=slot||active;
      if(!slot) return Promise.resolve(needActive());
      return call('browser_current', { slot: slot });
    },
    read: function (maxChars, slot) {
      slot=slot||active;
      if(!slot) return Promise.resolve(needActive());
      var args = { slot: slot };
      if (maxChars != null) args.max_chars = maxChars;
      return call('browser_read', args);
    },
    setZoom: function (z, slot) {
      slot=slot||active;
      if(!slot) return Promise.resolve(needActive());
      return call('browser_zoom', { slot: slot, zoom: z });
    },
    setVisible: function (visible, slot) {
      slot=slot||active;
      if(!slot) return Promise.resolve(needActive());
      return call('browser_visible', { slot: slot, visible: !!visible });
    },
    switchSlot: function (slot) {
      var epoch=++selectionEpoch;
      return call('browser_switch', { slot: slot }).then(function(out){if(out.ok && epoch===selectionEpoch) active=slot;return out;});
    },

    onState: function (fn) { return listenTauri('profiles-browser-state', fn); },
    onZoom: function (fn) { return listenTauri('profiles-browser-zoom', fn); }
  };
})();
