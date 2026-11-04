//! Profiles native browser pane.
//!
//! Genuine in-pane browsing: each pane slot owns a Tauri child [`Webview`]
//! hosted by the main window (WRY / WebKitGTK on Omarchy). No HTML rewriting,
//! no proxy fetch, no silent substitute pages.
//!
//! Trust boundary: every command requires the caller to be the `main` WebView
//! (`require_main`). Child tab WebViews share `data_directory` within the
//! composite slot's profile prefix, isolated from other profiles. They are
//! created unfocused and may load http/https or the exact blank page only.
//! Popups are denied natively and requested as new in-pane tabs through main.
//!
//! Events are emitted to `main` only (`emit_to("main", …)`):
//! - `profiles-browser-state` {ok,slot,url,title,zoom,visible,loading}
//! - `profiles-browser-zoom`  {ok,slot,zoom}
//! The frontend (`src/native-browser.js`) bridges these to DOM CustomEvents
//! of the same name. GTK consumes app shortcuts before DOM dispatch, including
//! Meta down/up; ordinary native input is observed without consuming it.
//!
//! Frontend contract (shared with the principal's broker):
//! commands `browser_ensure/resize/navigate/back/forward/reload/close/current/
//! read/zoom/visible/switch`. There is NO generic eval command: history and
//! reload run fixed allowlisted scripts only.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowResponse, PageLoadEvent, Url, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, Webview};
#[cfg(not(target_os = "linux"))]
use tauri::{Position, Size};

pub const STATE_EVENT: &str = "profiles-browser-state";
pub const ZOOM_EVENT: &str = "profiles-browser-zoom";

const LABEL_PREFIX: &str = "profiles-browser-";
const READ_TIMEOUT_SECS: u64 = 8;
const READ_DEFAULT_MAX: usize = 20_000;
const READ_HARD_MAX: usize = 100_000;

/// Fixed allowlisted reader. Runs on the slot WebView only; no caller script.
const READ_SCRIPT: &str = r#"(function(){if(document.readyState==="loading")return JSON.stringify({ready:false});var links=Array.from(document.querySelectorAll('a[href]')).map(function(a){return {title:(a.innerText||a.textContent||'').trim().slice(0,300),href:a.href};}).filter(function(a){return a.title&&/^https?:\/\//i.test(a.href);}).slice(0,100);return JSON.stringify({ready:true,title:document.title||"",text:((document.body&&document.body.innerText)||"").slice(0,100000),links:links});})()"#;
/// Fixed allowlisted history step. No caller script.
const BACK_SCRIPT: &str = "history.back()";
const FORWARD_SCRIPT: &str = "history.forward()";
const RELOAD_SCRIPT: &str = "location.reload()";

#[derive(Debug, Clone, Deserialize)]
pub struct PaneBounds {
  pub x: f64,
  pub y: f64,
  #[serde(alias = "w")]
  pub width: f64,
  #[serde(alias = "h")]
  pub height: f64,
}

impl PaneBounds {
  fn check(&self) -> Result<(), String> {
    for v in [self.x, self.y, self.width, self.height] {
      if !v.is_finite() {
        return Err("bad bounds: non-finite number".into());
      }
    }
    if self.width < 1.0 || self.height < 1.0 {
      return Err("bad bounds: width/height must be >= 1".into());
    }
    Ok(())
  }
}

// Wry's Linux GtkBox backend ignores child coordinates. An overlay keeps the
// app filling the window while browser children occupy only their pane.
#[cfg(target_os = "linux")]
pub fn prepare_container(view: &Webview) -> tauri::Result<()> {
  view.with_webview(|handle| {
    use gtk::prelude::*;
    let engine = handle.inner();
    if let Some(parent) = engine.parent().and_then(|p| p.downcast::<gtk::Box>().ok()) {
      let overlay = gtk::Overlay::new();
      parent.remove(&engine);
      engine.set_size_request(-1, -1);
      overlay.add(&engine);
      parent.pack_start(&overlay, true, true, 0);
      let main_engine = engine.clone();
      overlay.connect_size_allocate(move |_, a| {
        main_engine.size_allocate(&gtk::Allocation::new(0, 0, a.width(), a.height()));
      });
      overlay.show_all();
    }
  })
}

#[cfg(not(target_os = "linux"))]
pub fn prepare_container(_view: &Webview) -> tauri::Result<()> { Ok(()) }

fn place_view(view: &Webview, bounds: &PaneBounds) -> Result<(), String> {
  #[cfg(target_os = "linux")]
  {
    let b = bounds.clone();
    view.with_webview(move |handle| {
      use gtk::prelude::*;
      let engine = handle.inner();
      if let Some(parent) = engine.parent() {
        if let Ok(container) = parent.clone().downcast::<gtk::Box>() {
          let overlay = container.children().into_iter()
            .find_map(|child| child.downcast::<gtk::Overlay>().ok());
          if let Some(overlay) = overlay {
            container.remove(&engine);
            overlay.add_overlay(&engine);
          }
        }
      }
      // Four margins constrain the actual allocation. A size request alone
      // is only a minimum: WebKit's natural size can otherwise overflow.
      engine.set_halign(gtk::Align::Fill);
      engine.set_valign(gtk::Align::Fill);
      engine.set_margin_start(b.x.round().max(0.0) as i32);
      engine.set_margin_top(b.y.round().max(0.0) as i32);
      if let Some(parent) = engine.parent() {
        engine.set_margin_end((parent.allocated_width() as f64-b.x-b.width).round().max(0.0) as i32);
        engine.set_margin_bottom((parent.allocated_height() as f64-b.y-b.height).round().max(0.0) as i32);
      }
      engine.set_size_request(1, 1);
      engine.queue_resize();
    }).map_err(|e| format!("resize failed: {e}"))?;
  }
  #[cfg(not(target_os = "linux"))]
  {
    view.set_position(Position::Logical(LogicalPosition::new(bounds.x, bounds.y)))
      .map_err(|e| format!("resize failed: {e}"))?;
    view.set_size(Size::Logical(LogicalSize::new(bounds.width, bounds.height)))
      .map_err(|e| format!("resize failed: {e}"))?;
  }
  Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct SlotView {
  pub ok: bool,
  pub slot: String,
  pub url: String,
  pub title: String,
  pub zoom: f64,
  pub visible: bool,
  pub loading: bool,
  pub error: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReadOut {
  pub ok: bool,
  pub slot: String,
  pub url: String,
  pub title: String,
  pub text: String,
  pub links: Vec<ReadLink>,
  pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadLink { pub title: String, pub href: String }

#[derive(Debug, Clone, Serialize)]
struct ZoomPayload {
  pub ok: bool,
  pub slot: String,
  pub zoom: f64,
}

#[derive(Debug, Clone)]
struct SlotMeta {
  label: String,
  url: String,
  title: String,
  zoom: f64,
  visible: bool,
  loading: bool,
  error: String,
}

impl SlotMeta {
  fn view(&self, slot: &str) -> SlotView {
    SlotView {
      ok: self.error.is_empty(),
      slot: slot.to_string(),
      url: self.url.clone(),
      title: self.title.clone(),
      zoom: self.zoom,
      visible: self.visible,
      loading: self.loading,
      error: self.error.clone(),
    }
  }
}

#[derive(Debug, Default)]
struct BrowserInner {
  active: Option<String>,
  slots: HashMap<String, SlotMeta>,
  #[cfg(target_os = "linux")]
  meta_down: bool,
}

#[derive(Debug, Default)]
pub struct BrowserManager {
  inner: Mutex<BrowserInner>,
}

pub fn trusted_app_url(url: &Url) -> bool {
  (url.scheme()=="tauri" && url.host_str()==Some("localhost"))
    || (matches!(url.scheme(),"http"|"https") && url.host_str()==Some("tauri.localhost"))
    || (cfg!(debug_assertions) && url.scheme()=="http" && url.host_str()==Some("localhost") && url.port()==Some(1420))
}

fn require_main(caller: &Webview) -> Result<(), String> {
  if caller.label()=="main" && caller.url().is_ok_and(|url|trusted_app_url(&url)) { Ok(()) }
  else { Err("denied: browser commands require trusted app chrome".into()) }
}

fn check_slot(slot: &str) -> Result<(), String> {
  if slot.is_empty()
    || slot.len() > 40
    || !slot
      .chars()
      .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
  {
    return Err("bad slot id (alphanumeric, -, _; max 40)".into());
  }
  Ok(())
}

fn check_url(raw: &str) -> Result<Url, String> {
  let url: Url = raw
    .parse()
    .map_err(|_| format!("bad url: {raw}"))?;
  match url.scheme() {
    "http" | "https" => Ok(url),
    "about" if url.as_str() == "about:blank" => Ok(url),
    scheme => Err(format!("refused non-http(s) url (scheme={scheme})")),
  }
}

fn slot_label(slot: &str) -> String {
  format!("{LABEL_PREFIX}{slot}")
}

fn slot_data_dir(app: &AppHandle, slot: &str) -> Result<std::path::PathBuf, String> {
  let profile = slot.split_once("--").map_or(slot, |(profile, _)| profile);
  if profile.is_empty() { return Err("bad browser profile id".into()); }
  app.path().app_local_data_dir()
    .map(|d| d.join("browser-slots").join(profile))
    .map_err(|e| format!("browser profile storage unavailable: {e}"))
}

fn mutate(app: &AppHandle, slot: &str, f: impl FnOnce(&mut SlotMeta)) -> Option<SlotView> {
  let mgr = app.try_state::<BrowserManager>()?;
  let mut guard = mgr.inner.lock().ok()?;
  let meta = guard.slots.get_mut(slot)?;
  f(meta);
  Some(meta.view(slot))
}

fn emit_state(app: &AppHandle, view: &SlotView) {
  let _ = app.emit_to("main", STATE_EVENT, view);
}

fn snapshot(app: &AppHandle, slot: &str) -> Result<SlotView, String> {
  let label = slot_label(slot);
  let live_url = app.get_webview(&label).and_then(|v| v.url().ok());
  mutate(app, slot, |meta| {
    if let Some(u) = live_url {
      meta.url = u.to_string();
    }
  })
  .ok_or_else(|| format!("unknown browser slot: {slot}"))
}

fn nav_allowed(app: &AppHandle, slot: &str, url: &Url) -> bool {
  let allowed = matches!(url.scheme(), "http" | "https") || url.as_str() == "about:blank";
  let text = url.to_string();
  let view = mutate(app, slot, |meta| {
    if allowed {
      meta.url = text.clone();
      meta.loading = true;
      meta.error.clear();
    }
  });
  if let Some(v) = view {
    emit_state(app, &v);
  }
  allowed
}

#[cfg(target_os = "linux")]
fn emit_input(app: &AppHandle, slot: Option<&str>, kind: &str, key: Option<String>) {
  let _ = app.emit_to("main", "profiles-browser-input", serde_json::json!({
    "slot": slot, "kind": kind, "key": key
  }));
}

#[cfg(target_os = "linux")]
fn dispatch_shortcut(app: &AppHandle, event: &gdk::EventKey, slot: Option<&str>, pressed: bool) -> bool {
  let key = event.keyval();
  let is_meta = key == gdk::keys::constants::Super_L || key == gdk::keys::constants::Super_R
    || key == gdk::keys::constants::Meta_L || key == gdk::keys::constants::Meta_R;
  let mgr = app.state::<BrowserManager>();
  let Ok(mut guard) = mgr.inner.lock() else { return false; };
  if is_meta {
    // Shared across chrome and children: main may receive the release after
    // Meta-down hides a native overlay. Repeated downs must not toggle twice.
    if pressed == guard.meta_down { return true; }
    guard.meta_down = pressed;
    drop(guard);
    let _ = app.emit_to("main", "profiles-browser-shortcut", serde_json::json!({
      "key": "Meta", "phase": if pressed { "down" } else { "up" }, "slot": slot
    }));
    return true;
  }
  if !pressed { return false; }
  let ch = key.to_unicode().map(|c| c.to_ascii_lowercase());
  let held = guard.meta_down || event.state().intersects(gdk::ModifierType::SUPER_MASK | gdk::ModifierType::META_MASK);
  let shortcut = if held && ch.is_some_and(|c| "abcx123456".contains(c)) {
    ch.map(|c| c.to_string())
  } else if !held && event.state().contains(gdk::ModifierType::CONTROL_MASK)
    && !event.state().contains(gdk::ModifierType::MOD1_MASK) {
    match ch {
      Some('t') => Some("NewTab".into()),
      Some('w') => Some("CloseTab".into()),
      Some('l') => Some("Location".into()),
      _ if key == gdk::keys::constants::Tab || key == gdk::keys::constants::ISO_Left_Tab =>
        Some(if event.state().contains(gdk::ModifierType::SHIFT_MASK) || key == gdk::keys::constants::ISO_Left_Tab {
          "PreviousTab"
        } else { "NextTab" }.into()),
      _ => None,
    }
  } else { None };
  drop(guard);
  if let Some(key) = shortcut {
    let _ = app.emit_to("main", "profiles-browser-shortcut", serde_json::json!({
      "key": key, "phase": "down", "slot": slot
    }));
    return true;
  }
  emit_input(app, slot, "key", key.name().map(|name| name.to_string()));
  false
}

#[cfg(target_os = "linux")]
fn hook_input(app: &AppHandle, engine: &webkit2gtk::WebView, slot: Option<&str>) {
  use gtk::prelude::WidgetExt;
  use webkit2gtk::glib::Propagation;
  let press_app = app.clone();
  let press_slot = slot.map(str::to_string);
  engine.connect_key_press_event(move |_wv, event| {
    if dispatch_shortcut(&press_app, event, press_slot.as_deref(), true) {
      Propagation::Stop
    } else { Propagation::Proceed }
  });
  let release_app = app.clone();
  let release_slot = slot.map(str::to_string);
  engine.connect_key_release_event(move |_wv, event| {
    if dispatch_shortcut(&release_app, event, release_slot.as_deref(), false) {
      Propagation::Stop
    } else { Propagation::Proceed }
  });
  let pointer_app = app.clone();
  let pointer_slot = slot.map(str::to_string);
  engine.connect_button_press_event(move |_wv, _event| {
    emit_input(&pointer_app, pointer_slot.as_deref(), "pointer", None);
    Propagation::Proceed
  });
}

#[cfg(target_os = "linux")]
pub fn hook_app_shortcuts(app: &AppHandle, view: &Webview) {
  let app = app.clone();
  let _ = view.with_webview(move |handle| hook_input(&app, &handle.inner(), None));
}

#[cfg(not(target_os = "linux"))]
pub fn hook_app_shortcuts(_app:&AppHandle,_view:&Webview){}

#[cfg(target_os = "linux")]
fn hook_engine_zoom(app: &AppHandle, view: &tauri::Webview, slot: &str) {
  use webkit2gtk::WebViewExt;
  use gtk::prelude::WidgetExt;
  use webkit2gtk::glib::Propagation;
  let app_h = app.clone();
  let slot = slot.to_string();
  let _ = view.with_webview(move |handle| {
    let engine = handle.inner();
    let failure_app = app_h.clone();
    let failure_slot = slot.clone();
    engine.connect_load_failed(move |_wv, _event, url, error| {
      // WebKit cancels the previous provisional load during redirects and
      // replacement navigations. That is not a failure of the new document.
      if error.matches(webkit2gtk::NetworkError::Cancelled) { return true; }
      if let Some(state) = mutate(&failure_app, &failure_slot, |meta| {
        meta.url = url.to_string(); meta.loading = false; meta.error = error.to_string();
      }) { emit_state(&failure_app, &state); }
      false
    });
    engine.connect_scroll_event(|wv, event| {
      if !event.state().contains(gdk::ModifierType::CONTROL_MASK) { return Propagation::Proceed; }
      let delta = match event.direction() {
        gdk::ScrollDirection::Up => -1.0,
        gdk::ScrollDirection::Down => 1.0,
        _ => event.delta().1,
      };
      if delta != 0.0 {
        let step = if delta < 0.0 { 0.1 } else { -0.1 };
        wv.set_zoom_level(((wv.zoom_level() + step) * 10.0).round().clamp(5.0, 20.0) / 10.0);
      }
      Propagation::Stop
    });
    hook_input(&app_h, &engine, Some(&slot));
    engine.connect_key_press_event(move |wv, event| {
      let ch=event.keyval().to_unicode().map(|c|c.to_ascii_lowercase());
      if event.state().contains(gdk::ModifierType::CONTROL_MASK) {
        let next = match ch {
          Some('+' | '=') => Some(wv.zoom_level() + 0.1),
          Some('-' | '_') => Some(wv.zoom_level() - 0.1),
          Some('0') => Some(1.0),
          _ => None,
        };
        if let Some(z) = next { wv.set_zoom_level((z * 10.0).round().clamp(5.0,20.0) / 10.0); return Propagation::Stop; }
      }
      Propagation::Proceed
    });
    handle
      .inner()
      .connect_zoom_level_notify(move |wv| {
        let zoom = wv.zoom_level();
        if !zoom.is_finite() {
          return;
        }
        let payload = app_h.try_state::<BrowserManager>().and_then(|mgr| {
          let mut guard = mgr.inner.lock().ok()?;
          let meta = guard.slots.get_mut(&slot)?;
          meta.zoom = zoom;
          Some(ZoomPayload {
            ok: true,
            slot: slot.clone(),
            zoom,
          })
        });
        if let Some(p) = payload {
          let _ = app_h.emit_to("main", ZOOM_EVENT, p);
        }
      });
  });
}

#[cfg(not(target_os = "linux"))]
fn hook_engine_zoom(_app: &AppHandle, _view: &tauri::Webview, _slot: &str) {}

#[tauri::command]
pub fn browser_ensure(
  caller: Webview,
  app: AppHandle,
  slot: String,
  bounds: PaneBounds,
  url: Option<String>,
) -> Result<SlotView, String> {
  require_main(&caller)?;
  check_slot(&slot)?;
  bounds.check()?;
  {
    let mgr=app.state::<BrowserManager>();
    let guard=mgr.inner.lock().map_err(|_|"browser state lock poisoned")?;
    if guard.active.as_deref()!=Some(slot.as_str()) {return Err("browser slot is not selected".into());}
  }
  let target = url.map(|u| check_url(&u)).transpose()?.map(|u| u.to_string());
  let window = app.get_window("main").ok_or("no main window")?;
  let label = slot_label(&slot);
  let pos = LogicalPosition::new(bounds.x, bounds.y);
  let size = LogicalSize::new(bounds.width, bounds.height);

  if let Some(view) = app.get_webview(&label) {
    // An existing tab is a live session. Ensure only places it; navigation is
    // exclusively browser_navigate so selection cannot reset forms/history.
    place_view(&view, &bounds)?;
    view.hide().map_err(|e|format!("hide failed: {e}"))?;
    let visible=false;
    let out = mutate(&app, &slot, |meta| {
      if let Some(u) = view.url().ok() {
        meta.url = u.to_string();
      }
      meta.visible = visible;
    })
    .ok_or_else(|| format!("unknown browser slot: {slot}"))?;
    emit_state(&app, &out);
    return Ok(out);
  }

  let start = target.unwrap_or_else(|| "about:blank".to_string());
  let start_url = if start == "about:blank" {
    start
      .parse::<Url>()
      .map_err(|_| "bad url: about:blank".to_string())?
  } else {
    check_url(&start)?
  };
  let mut builder = WebviewBuilder::new(label.clone(), WebviewUrl::External(start_url))
    .focused(false)
    .zoom_hotkeys_enabled(false);
  let dir = slot_data_dir(&app, &slot)?;
  std::fs::create_dir_all(&dir).map_err(|e| format!("browser profile storage unavailable: {e}"))?;
  builder = builder.data_directory(dir);
  {
    let app_h = app.clone();
    let slot_c = slot.clone();
    builder = builder.on_navigation(move |nav_url| nav_allowed(&app_h, &slot_c, nav_url));
  }
  {
    let app_h = app.clone();
    let slot_c = slot.clone();
    builder = builder.on_page_load(move |_wv, payload| {
      let finished = matches!(payload.event(), PageLoadEvent::Finished);
      let url = payload.url().to_string();
      let view = mutate(&app_h, &slot_c, |meta| {
        meta.url = url.clone();
        meta.loading = !finished;
      });
      if let Some(v) = view {
        emit_state(&app_h, &v);
      }
    });
  }
  {
    let app_h = app.clone();
    let slot_c = slot.clone();
    builder = builder.on_document_title_changed(move |_wv, title| {
      let view = mutate(&app_h, &slot_c, |meta| {
        meta.title = title.clone();
      });
      if let Some(v) = view {
        emit_state(&app_h, &v);
      }
    });
  }
  {
    let popup_app = app.clone();
    let popup_slot = slot.clone();
    builder = builder.on_new_window(move |url, _features| {
      if matches!(url.scheme(), "http" | "https") {
        let _ = popup_app.emit_to("main", "profiles-open-url", serde_json::json!({
          "slot": popup_slot, "url": url.as_str(), "newTab": true
        }));
      }
      NewWindowResponse::Deny
    });
  }

  window
    .add_child(builder, pos, size)
    .map_err(|e| format!("create browser view failed: {e}"))?;

  if let Some(mgr) = app.try_state::<BrowserManager>() {
    if let Ok(mut guard) = mgr.inner.lock() {
      guard.slots.insert(
        slot.clone(),
        SlotMeta {
          label: label.clone(),
          url: start.clone(),
          title: String::new(),
          zoom: 1.0,
          visible: false,
          loading: start != "about:blank",
          error: String::new(),
        },
      );
    }
  }
  if let Some(view) = app.get_webview(&label) {
    view.hide().map_err(|e| format!("hide failed: {e}"))?;
    place_view(&view, &bounds)?;
    hook_engine_zoom(&app, &view, &slot);
  }
  let out = snapshot(&app, &slot)?;
  emit_state(&app, &out);
  Ok(out)
}

#[tauri::command]
pub fn browser_resize(
  caller: Webview,
  app: AppHandle,
  slot: String,
  bounds: PaneBounds,
) -> Result<SlotView, String> {
  require_main(&caller)?;
  check_slot(&slot)?;
  bounds.check()?;
  let view = app
    .get_webview(&slot_label(&slot))
    .ok_or_else(|| format!("unknown browser slot: {slot}"))?;
  place_view(&view, &bounds)?;
  Ok(snapshot(&app, &slot)?)
}

#[tauri::command]
pub fn browser_navigate(
  caller: Webview,
  app: AppHandle,
  slot: String,
  url: String,
) -> Result<SlotView, String> {
  require_main(&caller)?;
  check_slot(&slot)?;
  let target = check_url(&url)?;
  let view = app
    .get_webview(&slot_label(&slot))
    .ok_or_else(|| format!("unknown browser slot: {slot}"))?;
  let _ = mutate(&app, &slot, |meta| { meta.loading = true; meta.title.clear(); meta.error.clear(); });
  view.navigate(target).map_err(|e| format!("navigate failed: {e}"))?;
  Ok(snapshot(&app, &slot)?)
}

#[tauri::command]
pub fn browser_back(caller: Webview, app: AppHandle, slot: String) -> Result<SlotView, String> {
  require_main(&caller)?;
  check_slot(&slot)?;
  let view = app
    .get_webview(&slot_label(&slot))
    .ok_or_else(|| format!("unknown browser slot: {slot}"))?;
  view.eval(BACK_SCRIPT).map_err(|e| format!("back failed: {e}"))?;
  Ok(snapshot(&app, &slot)?)
}

#[tauri::command]
pub fn browser_forward(caller: Webview, app: AppHandle, slot: String) -> Result<SlotView, String> {
  require_main(&caller)?;
  check_slot(&slot)?;
  let view = app.get_webview(&slot_label(&slot))
    .ok_or_else(|| format!("unknown browser slot: {slot}"))?;
  view.eval(FORWARD_SCRIPT).map_err(|e| format!("forward failed: {e}"))?;
  snapshot(&app, &slot)
}

#[tauri::command]
pub fn browser_reload(caller: Webview, app: AppHandle, slot: String) -> Result<SlotView, String> {
  require_main(&caller)?;
  check_slot(&slot)?;
  let view = app.get_webview(&slot_label(&slot))
    .ok_or_else(|| format!("unknown browser slot: {slot}"))?;
  view.eval(RELOAD_SCRIPT).map_err(|e| format!("reload failed: {e}"))?;
  snapshot(&app, &slot)
}

#[tauri::command]
pub fn browser_close(caller: Webview, app: AppHandle, slot: String) -> Result<serde_json::Value, String> {
  require_main(&caller)?;
  check_slot(&slot)?;
  if let Some(view) = app.get_webview(&slot_label(&slot)) {
    view.close().map_err(|e| format!("close failed: {e}"))?;
  }
  let mgr = app.state::<BrowserManager>();
  let mut guard = mgr.inner.lock().map_err(|_| "browser state lock poisoned")?;
  guard.slots.remove(&slot);
  if guard.active.as_deref() == Some(slot.as_str()) { guard.active = None; }
  Ok(serde_json::json!({ "ok": true, "slot": slot, "closed": true }))
}
async fn page_action(app: &AppHandle, slot: &str, action: &str, args: serde_json::Value) -> Result<serde_json::Value, String> {
  let view = app.get_webview(&slot_label(slot))
    .ok_or_else(|| format!("unknown browser slot: {slot}"))?;
  let script = format!("{}({},{})", include_str!("browser-actions.js"), serde_json::to_string(action).map_err(|e|e.to_string())?, args);
  let (tx, rx) = tokio::sync::oneshot::channel();
  let tx = std::sync::Arc::new(Mutex::new(Some(tx)));
  view.eval_with_callback(&script, move |out| {
    if let Ok(mut sender) = tx.lock() {
      if let Some(sender) = sender.take() { let _ = sender.send(out); }
    }
  }).map_err(|e| format!("{action} failed: {e}"))?;
  let raw = tokio::time::timeout(std::time::Duration::from_secs(READ_TIMEOUT_SECS), rx).await
    .map_err(|_| format!("{action} timed out; inspect the page before retrying"))?
    .map_err(|e| format!("{action} result unavailable: {e}"))?;
  let mut result: serde_json::Value = serde_json::from_str(&raw).map_err(|e| format!("invalid {action} result: {e}"))?;
  if let Some(inner) = result.as_str() { result = serde_json::from_str(inner).map_err(|e|format!("invalid {action} result: {e}"))?; }
  if result.get("ok").and_then(|v|v.as_bool()) != Some(true) {
    return Err(result.get("error").and_then(|v|v.as_str()).unwrap_or("page action failed").to_string());
  }
  let state = snapshot(app, slot)?;
  result["slot"] = slot.into();
  result["url"] = state.url.into();
  result["title"] = state.title.into();
  result["loading"] = state.loading.into();
  Ok(result)
}

#[tauri::command]
pub async fn browser_click(
  caller: Webview,
  app: AppHandle,
  slot: String,
  selector: Option<String>,
  fx: Option<f64>,
  fy: Option<f64>,
) -> Result<serde_json::Value, String> {
  require_main(&caller)?;
  check_slot(&slot)?;
  page_action(&app, &slot, "click", serde_json::json!({"selector":selector,"fx":fx,"fy":fy})).await
}

#[tauri::command]
pub async fn browser_type(
  caller: Webview,
  app: AppHandle,
  slot: String,
  text: String,
  selector: Option<String>,
  press: Option<String>,
  clear: Option<bool>,
) -> Result<serde_json::Value, String> {
  require_main(&caller)?;
  check_slot(&slot)?;
  page_action(&app, &slot, "type", serde_json::json!({"text":text,"selector":selector,"press":press,"clear":clear.unwrap_or(false)})).await
}

#[tauri::command]
pub async fn browser_press(
  caller: Webview,
  app: AppHandle,
  slot: String,
  key: String,
) -> Result<serde_json::Value, String> {
  require_main(&caller)?;
  check_slot(&slot)?;
  page_action(&app, &slot, "press", serde_json::json!({"key":key})).await
}

#[tauri::command]
pub async fn browser_dark(
  caller: Webview,
  app: AppHandle,
  slot: String,
  on: bool,
) -> Result<serde_json::Value, String> {
  require_main(&caller)?;
  check_slot(&slot)?;
  page_action(&app, &slot, "dark", serde_json::json!({"on":on})).await
}

#[tauri::command]
pub async fn browser_cursor(
  caller: Webview,
  app: AppHandle,
  slot: String,
  show: Option<bool>,
  fx: Option<f64>,
  fy: Option<f64>,
) -> Result<serde_json::Value, String> {
  require_main(&caller)?;
  check_slot(&slot)?;
  page_action(&app, &slot, "cursor", serde_json::json!({"show":show.unwrap_or(true),"fx":fx,"fy":fy})).await
}

#[tauri::command]
pub async fn browser_screenshot(caller: Webview, app: AppHandle, slot: String) -> Result<serde_json::Value, String> {
  require_main(&caller)?;
  check_slot(&slot)?;
  let view = app.get_webview(&slot_label(&slot)).ok_or_else(|| format!("unknown browser slot: {slot}"))?;
  #[cfg(target_os = "linux")]
  {
    let (tx, rx) = tokio::sync::oneshot::channel();
    view.with_webview(move |handle| {
      use gtk::prelude::*;
      use webkit2gtk::WebViewExt;
      let engine = handle.inner();
      let width = engine.allocated_width();
      let height = engine.allocated_height();
      engine.snapshot(webkit2gtk::SnapshotRegion::Visible, webkit2gtk::SnapshotOptions::empty(),
        None::<&gtk::gio::Cancellable>, move |surface| {
          let result = surface.map_err(|e|e.to_string()).and_then(|surface| {
            let pixels = gdk::pixbuf_get_from_surface(&surface, 0, 0, width, height).ok_or("Page snapshot has no pixels")?;
            let png = pixels.save_to_bufferv("png", &[]).map_err(|e|e.to_string())?;
            Ok(serde_json::json!({"ok":true,"dataUrl":format!("data:image/png;base64,{}",gtk::glib::base64_encode(&png)),"mime":"image/png","width":width,"height":height,"fullPage":false}))
          });
          let _ = tx.send(result);
        });
    }).map_err(|e|format!("snapshot failed: {e}"))?;
    let mut result = tokio::time::timeout(std::time::Duration::from_secs(READ_TIMEOUT_SECS), rx).await
      .map_err(|_|"Page snapshot timed out")?.map_err(|_|"Page snapshot cancelled")??;
    let state = snapshot(&app, &slot)?;
    result["slot"] = slot.into();
    result["url"] = state.url.into();
    result["title"] = state.title.into();
    Ok(result)
  }
  #[cfg(not(target_os = "linux"))]
  { let _ = view; Err("Page screenshots are not supported on this platform".into()) }
}

#[tauri::command]
pub fn browser_current(
  caller: Webview,
  app: AppHandle,
  slot: String,
) -> Result<SlotView, String> {
  require_main(&caller)?;
  check_slot(&slot)?;
  if app.get_webview(&slot_label(&slot)).is_none() {
    return Err(format!("unknown browser slot: {slot}"));
  }
  snapshot(&app, &slot)
}

fn parse_read(out: &str) -> (String, String, Vec<ReadLink>, bool) {
  let value: serde_json::Value = serde_json::from_str(out).unwrap_or(serde_json::Value::Null);
  let inner = match value {
    serde_json::Value::String(s) => {
      serde_json::from_str::<serde_json::Value>(&s).unwrap_or(serde_json::Value::Null)
    }
    other => other,
  };
  let title = inner
    .get("title")
    .and_then(|t| t.as_str())
    .unwrap_or("")
    .to_string();
  let text = inner
    .get("text")
    .and_then(|t| t.as_str())
    .unwrap_or("")
    .to_string();
  let links = inner.get("links").and_then(|v| serde_json::from_value::<Vec<ReadLink>>(v.clone()).ok())
    .unwrap_or_default().into_iter().filter(|link| check_url(&link.href).is_ok()).take(100).collect();
  (title, text, links, inner.get("ready").and_then(|v|v.as_bool())==Some(true))
}

#[tauri::command]
pub async fn browser_read(
  caller: Webview,
  app: AppHandle,
  slot: String,
  max_chars: Option<usize>,
) -> Result<ReadOut, String> {
  require_main(&caller)?;
  check_slot(&slot)?;
  let view = app
    .get_webview(&slot_label(&slot))
    .ok_or_else(|| format!("unknown browser slot: {slot}"))?;
  let limit = max_chars.unwrap_or(READ_DEFAULT_MAX).clamp(1, READ_HARD_MAX);
  // A title can arrive before the body has even been parsed. Wait for DOM
  // readiness, not all resources: unfinished images must not block reading.
  let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(READ_TIMEOUT_SECS);
  let (title, mut text, links) = loop {
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let tx = std::sync::Arc::new(Mutex::new(Some(tx)));
    view.eval_with_callback(READ_SCRIPT, move |out| {
      if let Ok(mut guard) = tx.lock() {
        if let Some(sender) = guard.take() { let _ = sender.send(out); }
      }
    }).map_err(|e| format!("read failed: {e}"))?;
    let raw = tokio::time::timeout_at(deadline, rx).await
      .map_err(|_| "read timed out waiting for the page document".to_string())?
      .map_err(|e| format!("read cancelled: {e}"))?;
    let (title, text, links, ready) = parse_read(&raw);
    if ready { break (title, text, links); }
    if tokio::time::Instant::now() >= deadline { return Err("page document is still loading; try reading again".into()); }
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
  };
  let truncated = text.chars().count() > limit;
  if truncated {
    text = text.chars().take(limit).collect();
  }
  let url = view.url().map(|u| u.to_string()).unwrap_or_default();
  if !title.is_empty() {
    let t = title.clone();
    let _ = mutate(&app, &slot, |meta| {
      meta.title = t.clone();
    });
  }
  Ok(ReadOut {
    ok: true,
    slot,
    url,
    title,
    text,
    links,
    truncated,
  })
}

#[tauri::command]
pub fn browser_zoom(
  caller: Webview,
  app: AppHandle,
  slot: String,
  zoom: f64,
) -> Result<SlotView, String> {
  require_main(&caller)?;
  check_slot(&slot)?;
  if !zoom.is_finite() || zoom < 0.5 || zoom > 2.0 {
    return Err("bad zoom (range 0.5..=2.0)".into());
  }
  let view = app
    .get_webview(&slot_label(&slot))
    .ok_or_else(|| format!("unknown browser slot: {slot}"))?;
  view
    .set_zoom(zoom)
    .map_err(|e| format!("zoom failed: {e}"))?;
  let out = mutate(&app, &slot, |meta| {
    meta.zoom = zoom;
  })
  .ok_or_else(|| format!("unknown browser slot: {slot}"))?;
  let _ = app.emit_to(
    "main",
    ZOOM_EVENT,
    ZoomPayload {
      ok: true,
      slot: slot.clone(),
      zoom,
    },
  );
  emit_state(&app, &out);
  Ok(out)
}

#[tauri::command]
pub fn browser_visible(
  caller: Webview,
  app: AppHandle,
  slot: String,
  visible: bool,
) -> Result<SlotView, String> {
  require_main(&caller)?;
  check_slot(&slot)?;
  let view = app
    .get_webview(&slot_label(&slot))
    .ok_or_else(|| format!("unknown browser slot: {slot}"))?;
  if visible {
    let mgr=app.state::<BrowserManager>();
    let guard=mgr.inner.lock().map_err(|_|"browser state lock poisoned")?;
    if guard.active.as_deref()!=Some(slot.as_str()) {return Err("cannot show an inactive browser profile".into());}
    view.show().map_err(|e| format!("show failed: {e}"))?;
  } else {
    view.hide().map_err(|e| format!("hide failed: {e}"))?;
  }
  // Never close(): hidden slots stay alive and restore live.
  let out = mutate(&app, &slot, |meta| {
    meta.visible = visible;
  })
  .ok_or_else(|| format!("unknown browser slot: {slot}"))?;
  emit_state(&app, &out);
  Ok(out)
}

#[tauri::command]
pub fn browser_switch(
  caller: Webview,
  app: AppHandle,
  slot: String,
) -> Result<SlotView, String> {
  require_main(&caller)?;
  check_slot(&slot)?;
  let label = slot_label(&slot);
  if let Some(mgr) = app.try_state::<BrowserManager>() {
    if let Ok(guard) = mgr.inner.lock() {
      for meta in guard.slots.values() {
        if meta.label == label {
          continue;
        }
        if let Some(v) = app.get_webview(&meta.label) {
          let _ = v.hide();
        }
      }
    }
  }
  if app.get_webview(&label).is_none() {
    if let Some(mgr) = app.try_state::<BrowserManager>() {
      if let Ok(mut guard) = mgr.inner.lock() {
        for meta in guard.slots.values_mut() { meta.visible = false; }
        guard.active = Some(slot.clone());
      }
    }
    return Ok(SlotView { ok: true, slot, url: String::new(), title: String::new(), zoom: 1.0, visible: false, loading: false, error: String::new() });
  }
  let view = app
    .get_webview(&label)
    .ok_or_else(|| format!("unknown browser slot: {slot}"))?;
  view.hide().map_err(|e| format!("hide failed: {e}"))?;
  let out = mutate(&app, &slot, |meta| {
    meta.visible = false;
  })
  .ok_or_else(|| format!("unknown browser slot: {slot}"))?;
  if let Some(mgr) = app.try_state::<BrowserManager>() {
    if let Ok(mut guard) = mgr.inner.lock() {
      for (name, meta) in guard.slots.iter_mut() {
        if name != &slot {
          meta.visible = false;
        }
      }
      guard.active = Some(slot.clone());
    }
  }
  emit_state(&app, &out);
  Ok(out)
}
