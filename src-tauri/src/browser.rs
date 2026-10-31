//! Profiles native browser pane.
//!
//! Genuine in-pane browsing: each pane slot owns a Tauri child [`Webview`]
//! hosted by the main window (WRY / WebKitGTK on Omarchy). No HTML rewriting,
//! no proxy fetch, no silent substitute pages.
//!
//! Trust boundary: every command requires the caller to be the `main` WebView
//! (`require_main`). Child slot WebViews use per-slot isolated `data_directory`
//! values under the app local-data dir, are created unfocused, and may only
//! load http/https — the navigation and new-window handlers enforce this and
//! anything else is refused with an honest error, never rewritten.
//!
//! Events are emitted to `main` only (`emit_to("main", …)`):
//! - `profiles-browser-state` {ok,slot,url,title,zoom,visible,loading}
//! - `profiles-browser-zoom`  {ok,slot,zoom}
//! The frontend (`src/native-browser.js`) bridges these to DOM CustomEvents
//! of the same name. App-level shortcuts (Super / latched Super+A/B/C/1..6)
//! stay in the main page; the child never takes host focus.
//!
//! Frontend contract (shared with the principal's broker):
//! commands `browser_ensure/resize/navigate/back/current/read/zoom/visible/switch`
//! with snake_case args. There is NO generic eval command: `back` and `read`
//! run fixed allowlisted scripts only.

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
const READ_SCRIPT: &str = r#"(function(){try{var links=Array.from(document.querySelectorAll('a[href]')).map(function(a){return {title:(a.innerText||a.textContent||'').trim().slice(0,300),href:a.href};}).filter(function(a){return a.title&&/^https?:\/\//i.test(a.href);}).slice(0,100);return JSON.stringify({title:document.title||"",text:((document.body&&document.body.innerText)||"").slice(0,100000),links:links});}catch(e){return JSON.stringify({title:"",text:"",links:[]});}})()"#;
/// Fixed allowlisted history step. No caller script.
const BACK_SCRIPT: &str = "history.back()";

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
    scheme => Err(format!("refused non-http(s) url (scheme={scheme})")),
  }
}

fn slot_label(slot: &str) -> String {
  format!("{LABEL_PREFIX}{slot}")
}

fn slot_data_dir(app: &AppHandle, slot: &str) -> Option<std::path::PathBuf> {
  app
    .path()
    .app_local_data_dir()
    .ok()
    .map(|d| d.join("browser-slots").join(slot))
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
  let allowed = matches!(url.scheme(), "http" | "https");
  let text = url.to_string();
  let view = mutate(app, slot, |meta| {
    if allowed {
      meta.url = text.clone();
      meta.loading = true;
    }
  });
  if let Some(v) = view {
    emit_state(app, &v);
  }
  allowed
}

#[cfg(target_os = "linux")]
fn dispatch_shortcut(app:&AppHandle,event:&gdk::EventKey,armed:&std::cell::Cell<Option<std::time::Instant>>)->bool {
  let key=event.keyval();
  if key==gdk::keys::constants::Super_L || key==gdk::keys::constants::Super_R {
    armed.set(Some(std::time::Instant::now()));
    return true;
  }
  let ch=key.to_unicode().map(|c|c.to_ascii_lowercase());
  let held=event.state().intersects(gdk::ModifierType::SUPER_MASK | gdk::ModifierType::META_MASK);
  let latched=armed.get().is_some_and(|t|t.elapsed().as_millis()<1500);
  if (held || latched) && ch.is_some_and(|c|"abcx123456".contains(c)){
    armed.set(None);
    let _=app.emit_to("main","profiles-browser-shortcut",serde_json::json!({"key":ch.unwrap().to_string()}));
    return true;
  }
  false
}

#[cfg(target_os = "linux")]
pub fn hook_app_shortcuts(app:&AppHandle,view:&Webview){
  use gtk::prelude::WidgetExt;
  use webkit2gtk::glib::Propagation;
  let app=app.clone();
  let _=view.with_webview(move |handle|{
    let armed=std::cell::Cell::new(None::<std::time::Instant>);
    handle.inner().connect_key_press_event(move |_wv,event|{
      if dispatch_shortcut(&app,event,&armed){Propagation::Stop}else{Propagation::Proceed}
    });
  });
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
    let shortcut_app = app_h.clone();
    let armed = std::cell::Cell::new(None::<std::time::Instant>);
    engine.connect_key_press_event(move |wv, event| {
      if dispatch_shortcut(&shortcut_app,event,&armed){return Propagation::Stop;}
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
    place_view(&view, &bounds)?;
    if let Some(u) = target {
      let current = view.url().map(|x| x.to_string()).unwrap_or_default();
      if current != u {
        view
          .navigate(check_url(&u)?)
          .map_err(|e| format!("navigate failed: {e}"))?;
      }
    }
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
  if let Some(dir) = slot_data_dir(&app, &slot) {
    let _ = std::fs::create_dir_all(&dir);
    builder = builder.data_directory(dir);
  }
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
    let popup_label = label.clone();
    builder = builder.on_new_window(move |url, _features| {
      if matches!(url.scheme(), "http" | "https") {
        if let Some(view) = popup_app.get_webview(&popup_label) { let _ = view.navigate(url); }
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

fn parse_read(out: &str) -> (String, String, Vec<ReadLink>) {
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
  (title, text, links)
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
  let (tx, rx) = tokio::sync::oneshot::channel::<String>();
  let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
  view
    .eval_with_callback(READ_SCRIPT, move |out| {
      if let Ok(mut guard) = tx.lock() {
        if let Some(sender) = guard.take() {
          let _ = sender.send(out);
        }
      }
    })
    .map_err(|e| format!("read failed: {e}"))?;
  let raw = tokio::time::timeout(std::time::Duration::from_secs(READ_TIMEOUT_SECS), rx)
    .await
    .map_err(|_| "read timed out (page busy or unreachable)".to_string())?
    .map_err(|e| format!("read cancelled: {e}"))?;
  let (title, mut text, links) = parse_read(&raw);
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
