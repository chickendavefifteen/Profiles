// Profiles Day 1 Tauri shell — static frontend only, no commands yet.
// Agent loop + vault IPC lands D3–4.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Profiles");
}
