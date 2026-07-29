// deskpet — a private, offline desktop creature.
//
// Design goals, in priority order:
//   1. Never touch the network. There is no http/reqwest/socket crate here, and
//      the webview CSP sets connect-src 'none'. This binary physically cannot
//      phone home.
//   2. Tiny, auditable surface. Just tauri + serde. The only thing it reads is
//      one local file: ~/.deskpet/state. The only thing it writes is that same
//      file's initial value.
//
// How it works: Claude Code hooks write a single mood word (idle / thinking /
// working / celebrate / alert) into ~/.deskpet/state. A background thread polls
// that file and emits a "mood" event to the webview, which animates the creature.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager, PhysicalPosition};

fn state_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".deskpet").join("state")
}

fn read_state() -> String {
    fs::read_to_string(state_path())
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Make sure ~/.deskpet exists and has a starting mood.
            if let Some(dir) = state_path().parent() {
                let _ = fs::create_dir_all(dir);
            }
            if read_state().is_empty() {
                let _ = fs::write(state_path(), "idle");
            }

            if let Some(window) = app.get_webview_window("pet") {
                // Park the creature bottom-center, just above the Dock.
                if let Ok(Some(monitor)) = window.current_monitor() {
                    let m = monitor.size();
                    let w = window
                        .outer_size()
                        .unwrap_or(tauri::PhysicalSize { width: 180, height: 200 });
                    let x = ((m.width as i32) - (w.width as i32)) / 2;
                    let y = (m.height as i32) - (w.height as i32) - 130;
                    let _ = window.set_position(PhysicalPosition::new(x.max(0), y.max(0)));
                }
            }

            // Poll the state file; emit "mood" only when it changes.
            let handle = app.handle().clone();
            thread::spawn(move || {
                let mut last = String::new();
                loop {
                    let cur = read_state();
                    if !cur.is_empty() && cur != last {
                        last = cur.clone();
                        let _ = handle.emit("mood", cur);
                    }
                    thread::sleep(Duration::from_millis(350));
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running deskpet");
}
