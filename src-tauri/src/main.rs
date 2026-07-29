// deskpet — a gentle Tamagotchi that lives on your Dock.
//
// Privacy posture (unchanged): no network. The webview CSP sets connect-src
// 'none' and there is no http/socket crate. The only things this binary reads
// are local: the global cursor position, the frontmost app NAME (via macOS
// LaunchServices, no Accessibility permission), and two files under ~/.deskpet.
// Nothing leaves the machine.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, PhysicalPosition};

fn deskpet_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".deskpet")
}
fn state_path() -> PathBuf {
    deskpet_dir().join("state")
}
fn pet_path() -> PathBuf {
    deskpet_dir().join("pet.json")
}
fn read_trim(p: PathBuf) -> String {
    fs::read_to_string(p).unwrap_or_default().trim().to_string()
}

// ---- persistence commands (fs write stays in Rust; webview has no fs access) --
#[tauri::command]
fn load_pet() -> String {
    fs::read_to_string(pet_path()).unwrap_or_default()
}
#[tauri::command]
fn save_pet(json: String) {
    let _ = fs::create_dir_all(deskpet_dir());
    let _ = fs::write(pet_path(), json);
}

// ---- frontmost app -> coarse activity category (local, no permissions) --------
fn front_app() -> (String, String) {
    let out = Command::new("sh")
        .arg("-c")
        .arg(r#"lsappinfo info -only name "$(lsappinfo front 2>/dev/null)" 2>/dev/null"#)
        .output();
    let name = match out {
        Ok(o) => String::from_utf8_lossy(&o.stdout)
            .split('=')
            .nth(1)
            .map(|v| v.trim().trim_matches('"').to_string())
            .unwrap_or_default(),
        Err(_) => String::new(),
    };
    let n = name.to_lowercase();
    let has = |xs: &[&str]| xs.iter().any(|x| n.contains(x));
    let cat = if has(&["code", "xcode", "cursor", "zed", "intellij", "pycharm", "webstorm", "sublime", "windsurf", "nova"]) {
        "coding"
    } else if has(&["terminal", "iterm", "warp", "ghostty", "kitty", "alacritty", "wezterm", "hyper"]) {
        "terminal"
    } else if has(&["safari", "chrome", "arc", "firefox", "brave", "edge", "orion", "vivaldi"]) {
        "browsing"
    } else if has(&["figma", "sketch", "photoshop", "illustrator", "blender", "affinity"]) {
        "design"
    } else if has(&["notion", "obsidian", "notes", "word", "pages", "writer", "bear"]) {
        "writing"
    } else if has(&["slack", "discord", "messages", "mail", "telegram", "whatsapp"]) {
        "chatting"
    } else if name.is_empty() {
        "unknown"
    } else {
        "other"
    };
    (cat.to_string(), name)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![load_pet, save_pet])
        .setup(|app| {
            let _ = fs::create_dir_all(deskpet_dir());
            if read_trim(state_path()).is_empty() {
                let _ = fs::write(state_path(), "idle");
            }

            if let Some(window) = app.get_webview_window("pet") {
                let _ = window.set_always_on_top(true);
                let _ = window.set_visible_on_all_workspaces(true);
                let _ = window.set_ignore_cursor_events(true); // click-through until you hover it
                if let Ok(Some(monitor)) = window.primary_monitor() {
                    let m = monitor.size();
                    let w = window
                        .outer_size()
                        .unwrap_or(tauri::PhysicalSize { width: 280, height: 340 });
                    let x = ((m.width as i32) - (w.width as i32)) / 2;
                    let y = (m.height as i32) - (w.height as i32) - 28; // sit just above the Dock
                    let _ = window.set_position(PhysicalPosition::new(x.max(0), y.max(0)));
                }
            }

            let handle = app.handle().clone();

            // Claude Code state file -> "claude" events
            {
                let h = handle.clone();
                thread::spawn(move || {
                    let mut last = String::new();
                    loop {
                        let cur = read_trim(state_path());
                        if !cur.is_empty() && cur != last {
                            last = cur.clone();
                            let _ = h.emit("claude", cur);
                        }
                        thread::sleep(Duration::from_millis(300));
                    }
                });
            }

            // context watcher: global cursor + hover-to-grab + frontmost app -> "ctx"
            {
                let h = handle.clone();
                thread::spawn(move || {
                    let mut app_cat = String::from("unknown");
                    let mut app_name = String::new();
                    let mut last_app = Instant::now() - Duration::from_secs(10);
                    let mut hovering = false;
                    let mut ignoring = true;
                    loop {
                        if last_app.elapsed() > Duration::from_millis(1500) {
                            let (c, n) = front_app();
                            app_cat = c;
                            app_name = n;
                            last_app = Instant::now();
                        }
                        if let Some(window) = h.get_webview_window("pet") {
                            let scale = window.scale_factor().unwrap_or(1.0);
                            if let (Ok(wp), Ok(cp)) = (window.outer_position(), h.cursor_position()) {
                                let lx = (cp.x - wp.x as f64) / scale;
                                let ly = (cp.y - wp.y as f64) / scale;
                                // hover zone = creature + menu row (matches the frontend)
                                let over = (lx - 140.0).abs() < 95.0 && ly > 82.0 && ly < 330.0;
                                if over != hovering {
                                    hovering = over;
                                }
                                let want_ignore = !hovering;
                                if want_ignore != ignoring {
                                    let _ = window.set_ignore_cursor_events(want_ignore);
                                    ignoring = want_ignore;
                                }
                                let payload = serde_json::json!({
                                    "cursorX": cp.x, "cursorY": cp.y,
                                    "winX": wp.x, "winY": wp.y, "scale": scale,
                                    "hovering": hovering, "app": app_cat, "appName": app_name,
                                });
                                let _ = h.emit("ctx", payload);
                            }
                        }
                        thread::sleep(Duration::from_millis(120));
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running deskpet");
}
