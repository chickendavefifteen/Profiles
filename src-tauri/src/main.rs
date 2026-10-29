// Profiles Tauri shell — the agent sidecar is PART of the app.
// On startup the shell spawns `node server.mjs --port 1420` (repo root
// resolved relative to the executable in dev, PROFILES_HOME in release)
// and kills it on exit. The agent therefore ALWAYS works in the native
// app — "sidecar not reachable" is architecturally impossible here.
// Web/PWA builds still talk to whatever sidecar serves them.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command};
use tauri::Manager;
use std::sync::Mutex;

struct Sidecar(Mutex<Option<Child>>);

fn spawn_sidecar() -> Option<Child> {
    let home = match std::env::var("PROFILES_HOME") {
        Ok(h) => h,
        Err(_) => {
            // dev: exe lives in src-tauri/target/{debug,release}/ -> repo root is ../../../..
            let exe = std::env::current_exe().ok()?;
            let root = exe.parent().and_then(|p| p.parent()).and_then(|p| p.parent()).and_then(|p| p.parent()).ok_or(()) .ok()?;
            root.to_string_lossy().to_string()
        }
    };
    let server = format!("{home}/server.mjs");
    if !std::path::Path::new(&server).exists() { return None; }
    // bash -lc so mise/nvm node installs resolve like the user's shell.
    Command::new("/bin/bash")
        .args(["-lc", &format!("exec node '{server}' --port 1420")])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let child = spawn_sidecar();
            app.manage(Sidecar(Mutex::new(child)));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Profiles")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<Sidecar>() {
                    if let Ok(mut slot) = state.0.lock() {
                        if let Some(mut child) = slot.take() { let _ = child.kill(); }
                    }
                }
            }
        });
}
