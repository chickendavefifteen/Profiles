// Profiles shell owns its Node sidecar and native browser views.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod browser;

use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{Manager, Emitter};

struct Sidecar(Mutex<Option<Child>>);

fn sidecar_port() -> Result<u16, Box<dyn std::error::Error>> {
  if let Ok(raw) = std::env::var("PROFILES_PORT") {
    let port: u16 = raw.parse()?;
    if port == 0 { return Err("PROFILES_PORT must be nonzero".into()); }
    let _available=std::net::TcpListener::bind(("127.0.0.1",port))?;
    return Ok(port);
  }
  Ok(std::net::TcpListener::bind(("127.0.0.1", 0))?.local_addr()?.port())
}

fn repo_home() -> Option<String> {
  if let Ok(home) = std::env::var("PROFILES_HOME") {
    if std::path::Path::new(&format!("{home}/server.mjs")).exists() {
      return Some(home);
    }
    eprintln!("[profiles] PROFILES_HOME={home:?} has no server.mjs");
    return None;
  }
  // dev: exe lives in src-tauri/target/{debug,release}/ -> repo root is 4 up.
  let exe = std::env::current_exe().ok()?;
  let root = exe
    .parent()?
    .parent()?
    .parent()?
    .parent()?;
  let home = root.to_string_lossy().to_string();
  if std::path::Path::new(&format!("{home}/server.mjs")).exists() {
    Some(home)
  } else {
    eprintln!("[profiles] no server.mjs under {home:?}; sidecar disabled");
    None
  }
}

fn spawn_sidecar(port: u16) -> Option<Child> {
  if std::env::var("PROFILES_NO_SIDECAR").as_deref()==Ok("1") { return None; }
  let home = repo_home()?;
  let server = format!("{home}/server.mjs");
  Command::new("node")
    .args([server.as_str(), "--port", &port.to_string()])
    .current_dir(&home)
    .env("PROFILES_NATIVE_SHELL","1")
    .stdin(std::process::Stdio::null())
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::inherit())
    .spawn()
    .map_err(|e| eprintln!("[profiles] sidecar spawn failed: {e}"))
    .ok()
}

fn wait_for_sidecar(child: &mut Child, port: u16) -> Result<(), Box<dyn std::error::Error>> {
  use std::io::{Read, Write};
  #[derive(serde::Deserialize)]
  struct Health { pid:u32 }
  let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
  while std::time::Instant::now() < deadline {
    if child.try_wait()?.is_some() { return Err("Profiles sidecar exited during startup".into()); }
    if let Ok(mut stream) = std::net::TcpStream::connect_timeout(
      &std::net::SocketAddr::from(([127, 0, 0, 1], port)), std::time::Duration::from_millis(100)) {
      stream.set_read_timeout(Some(std::time::Duration::from_millis(200)))?;
      stream.write_all(b"GET /api/health HTTP/1.0\r\nHost: localhost\r\n\r\n")?;
      let mut response=[0u8;2048];
      let mut used=0;
      while used<response.len() {
        match stream.read(&mut response[used..]) {
          Ok(0)|Err(_) => break,
          Ok(n) => used+=n,
        }
      }
      if response[..used].starts_with(b"HTTP/1.1 200") {
        if let Some(end)=response[..used].windows(4).position(|v|v==b"\r\n\r\n") {
          if serde_json::from_slice::<Health>(&response[end+4..used]).is_ok_and(|h|h.pid==child.id()) { return Ok(()); }
        }
      }
    }
    std::thread::sleep(std::time::Duration::from_millis(50));
  }
  let _ = child.kill();
  Err("Profiles sidecar did not become ready within 10 seconds".into())
}

fn main() {
  tauri::Builder::default()
    .setup(|app| {
      let backend=sidecar_port().ok().and_then(|port| {
        let mut child=spawn_sidecar(port)?;
        match wait_for_sidecar(&mut child,port) {
          Ok(())=>Some((port,child)),
          Err(error)=>{eprintln!("[profiles] standalone tools: {error}");let _=child.kill();let _=child.wait();None}
        }
      });
      let (api_base,child)=match backend {
        Some((port,child))=>(format!("http://localhost:{port}"),Some(child)),
        None=>(String::new(),None),
      };
      let standalone=child.is_none();
      app.manage(Sidecar(Mutex::new(child)));
      app.manage(browser::BrowserManager::default());
      let window = tauri::WindowBuilder::from_config(app, &app.config().app.windows[0])?.build()?;
      let size = window.inner_size()?.to_logical::<f64>(window.scale_factor()?);
      let navigation_app=app.handle().clone();
      let popup_app=app.handle().clone();
      let main_view = tauri::webview::WebviewBuilder::new("main", tauri::WebviewUrl::App("index.html".into()))
        .initialization_script(format!("window.__PROFILES_API_BASE__='{api_base}';window.__PROFILES_STANDALONE__={standalone};"))
        .on_navigation(move |url| {
          if browser::trusted_app_url(url) { return true; }
          if matches!(url.scheme(),"http"|"https") {
            let _=navigation_app.emit_to("main","profiles-open-url",serde_json::json!({"url":url.as_str()}));
          }
          false
        })
        .on_new_window(move |url,_| {
          if matches!(url.scheme(),"http"|"https") {
            let _=popup_app.emit_to("main","profiles-open-url",serde_json::json!({"url":url.as_str()}));
          }
          tauri::webview::NewWindowResponse::Deny
        })
        .auto_resize();
      let main = window.add_child(main_view, tauri::LogicalPosition::new(0.0, 0.0), size)?;
      browser::prepare_container(&main)?;
      browser::hook_app_shortcuts(app.handle(),&main);
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      browser::browser_ensure,
      browser::browser_resize,
      browser::browser_navigate,
      browser::browser_back,
      browser::browser_current,
      browser::browser_read,
      browser::browser_zoom,
      browser::browser_visible,
      browser::browser_switch
    ])
    .build(tauri::generate_context!())
    .expect("error while building Profiles")
    .run(|app, event| {
      if let tauri::RunEvent::Exit = event {
        // Only our own spawned child is ever killed; foreign PIDs untouched.
        if let Some(state) = app.try_state::<Sidecar>() {
          if let Ok(mut slot) = state.0.lock() {
            if let Some(mut child) = slot.take() {
              let _ = child.kill();
              let _ = child.wait();
            }
          }
        }
      }
    });
}
