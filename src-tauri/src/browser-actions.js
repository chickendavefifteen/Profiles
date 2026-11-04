(function (action, args) {
  'use strict';
  function target(selector, focused) {
    var el;
    if (selector) {
      try { el = document.querySelector(selector); } catch (_) { /* A control label need not be CSS. */ }
      if (!el && !/[#.[\]>+~:]/.test(selector)) {
        var label = selector.trim().toLowerCase();
        var controls = document.querySelectorAll(focused ? 'input,textarea,[contenteditable=true]' : 'button,a[href],input[type=submit],input[type=button],[role=button]');
        el = Array.from(controls).find(function (item) {
          return [item.getAttribute('aria-label'), item.getAttribute('placeholder'), item.getAttribute('name'), item.innerText, item.value].some(function (name) {
            return typeof name === 'string' && name.trim().toLowerCase() === label;
          });
        });
      }
    } else if (focused) el = document.activeElement;
    else if (Number.isFinite(args.fx) && Number.isFinite(args.fy) && args.fx >= 0 && args.fx <= 1 && args.fy >= 0 && args.fy <= 1) {
      el = document.elementFromPoint(window.innerWidth * args.fx, window.innerHeight * args.fy);
    }
    if (!el || el === document.body || el === document.documentElement) throw new Error('No matching page control');
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') throw new Error('Page control is disabled');
    if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') throw new Error('Page control is not visible');
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    el.focus();
    return el;
  }
  function enter(el) {
    var down = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
    if (el.dispatchEvent(down)) {
      if (el.form && el.tagName !== 'TEXTAREA') el.form.requestSubmit();
      else if (el.matches('button,a[href],input[type=submit],input[type=button]')) el.click();
    }
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
  }
  try {
    if (action === 'dark') {
      var on = !!args.on, id = 'profiles-web-dark', old = document.getElementById(id);
      if (old) old.remove();
      if (on) {
        var css = 'html.profiles-webdark{filter:invert(1) hue-rotate(180deg)!important;background:#fff!important}'
          + 'html.profiles-webdark img,html.profiles-webdark video,html.profiles-webdark picture,html.profiles-webdark canvas,html.profiles-webdark svg,html.profiles-webdark [style*=background-image]{filter:invert(1) hue-rotate(180deg)!important}';
        var st = document.createElement('style');
        st.id = id; st.textContent = css;
        (document.head || document.documentElement).appendChild(st);
        document.documentElement.classList.add('profiles-webdark');
      } else {
        document.documentElement.classList.remove('profiles-webdark');
      }
      return JSON.stringify({ ok: true, dark: on });
    }
    if (action === 'cursor') {
      var cid = 'profiles-cursor', cur = document.getElementById(cid);
      if (args.show === false) { if (cur) cur.remove(); return JSON.stringify({ ok: true, cursor: false }); }
      if (!cur) {
        cur = document.createElement('div'); cur.id = cid; cur.setAttribute('aria-hidden', 'true');
        cur.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:26px;height:26px;margin:-13px 0 0 -13px;border:2.5px solid #22d3ee;border-radius:50%;box-shadow:0 0 0 2px rgba(0,0,0,.55),0 0 14px rgba(34,211,238,.8);transition:left .18s ease-out,top .18s ease-out,opacity .3s;';
        (document.documentElement || document.body).appendChild(cur);
      }
      if (Number.isFinite(args.fx) && Number.isFinite(args.fy)) {
        cur.style.left = (Math.min(1, Math.max(0, args.fx)) * 100) + '%';
        cur.style.top = (Math.min(1, Math.max(0, args.fy)) * 100) + '%';
      }
      cur.style.opacity = '1';
      return JSON.stringify({ ok: true, cursor: true });
    }
    var el = target(args.selector, action !== 'click');
    var result = { ok: true };
    if (action === 'click') {
      if (typeof el.click !== 'function') throw new Error('Page target cannot be clicked');
      var rr = (el.getClientRects && el.getClientRects()[0]) || null;
      var cfx = args.fx, cfy = args.fy;
      if ((!Number.isFinite(cfx) || !Number.isFinite(cfy)) && rr) {
        cfx = (rr.left + rr.width / 2) / window.innerWidth;
        cfy = (rr.top + rr.height / 2) / window.innerHeight;
      }
      el.click();
      result.clicked = args.selector || { fx: args.fx, fy: args.fy };
      if (Number.isFinite(cfx) && Number.isFinite(cfy)) {
        result.fx = Math.min(1, Math.max(0, cfx));
        result.fy = Math.min(1, Math.max(0, cfy));
      }
    } else if (action === 'type') {
      if (el.readOnly || !el.matches('input:not([type=hidden]):not([type=password]):not([type=file]),textarea,[contenteditable=true]')) throw new Error('Page target is not an editable text control');
      if (args.press && args.press !== 'Enter') throw new Error('Unsupported type key: ' + args.press);
      var text = String(args.text || '');
      if (el.isContentEditable) {
        if (args.clear) el.textContent = '';
        el.textContent += text;
      } else {
        var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, (args.clear ? '' : el.value) + text);
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if (args.press === 'Enter') enter(el);
      result.typed = text;
    } else if (action === 'press') {
      if (args.key === 'Enter') enter(el);
      else if (args.key === 'Tab' || args.key === 'Shift+Tab') {
        var controls = Array.from(document.querySelectorAll('a[href],button,input,textarea,select,[tabindex]')).filter(function (item) { return !item.disabled && item.tabIndex >= 0 && item.getClientRects().length; });
        var index = controls.indexOf(el), step = args.key === 'Tab' ? 1 : -1;
        var next = controls[(index + step + controls.length) % controls.length];
        if (!next) throw new Error('No focusable page control');
        next.focus();
      } else if (args.key === 'Escape') {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }));
        el.blur();
      } else throw new Error('Unsupported native page key: ' + args.key);
      result.pressed = args.key;
    } else throw new Error('Unknown page action');
    return JSON.stringify(result);
  } catch (error) {
    return JSON.stringify({ ok: false, error: String(error.message || error) });
  }
})