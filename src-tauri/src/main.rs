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
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, PhysicalPosition};

fn seed_now() -> u32 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(1)
        .max(1)
}
fn rnd(seed: u32, lo: i32, hi: i32) -> i32 {
    if hi <= lo {
        lo
    } else {
        lo + (seed % ((hi - lo) as u32)) as i32
    }
}

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
fn pos_path() -> PathBuf {
    deskpet_dir().join("pos")
}
fn read_trim(p: PathBuf) -> String {
    fs::read_to_string(p).unwrap_or_default().trim().to_string()
}
fn save_pos(x: i32, y: i32) {
    let _ = fs::create_dir_all(deskpet_dir());
    let _ = fs::write(pos_path(), format!("{},{}", x, y));
}
fn load_pos() -> Option<(i32, i32)> {
    let s = read_trim(pos_path());
    let mut it = s.split(',');
    Some((it.next()?.parse().ok()?, it.next()?.parse().ok()?))
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

// ---- system vibe: CPU load + battery (local, no permissions) ------------------
fn sysctl_s(key: &str) -> String {
    Command::new("sysctl")
        .arg("-n")
        .arg(key)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}
fn cpu_busy() -> f64 {
    // 1-minute load average / core count -> roughly 0..1 (can exceed when slammed)
    let la = sysctl_s("vm.loadavg"); // "{ 1.23 1.10 0.95 }"
    let load1 = la
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);
    let ncpu = sysctl_s("hw.ncpu").parse::<f64>().unwrap_or(8.0).max(1.0);
    (load1 / ncpu).min(1.5)
}
fn battery() -> (i32, bool) {
    let s = Command::new("pmset")
        .arg("-g")
        .arg("batt")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    let pct = s
        .split('%')
        .next()
        .and_then(|left| left.rsplit(|c: char| !c.is_ascii_digit()).next())
        .and_then(|d| d.parse::<i32>().ok())
        .unwrap_or(100);
    let charging = s.contains("AC Power") || s.contains("charging") || s.contains("charged");
    (pct, charging)
}

// Re-launch ourselves inside the bundled sandbox profile so that even a
// double-clicked .app is network-denied by the kernel — not just the scripted
// install. No-op when running loose (dev) or once already sandboxed.
#[cfg(target_os = "macos")]
fn ensure_sandboxed() {
    use std::os::unix::process::CommandExt;
    if std::env::var_os("DESKPET_SANDBOXED").is_some() {
        return;
    }
    if let Ok(exe) = std::env::current_exe() {
        // .../Contents/MacOS/deskpet -> .../Contents/Resources/deskpet.sb
        if let Some(prof) = exe
            .parent()
            .and_then(|p| p.parent())
            .map(|c| c.join("Resources/deskpet.sb"))
        {
            if prof.exists() {
                let _ = Command::new("/usr/bin/sandbox-exec")
                    .arg("-f")
                    .arg(&prof)
                    .arg(&exe)
                    .env("DESKPET_SANDBOXED", "1")
                    .exec(); // replaces this process; only returns on error
            }
        }
    }
}

fn main() {
    #[cfg(target_os = "macos")]
    ensure_sandboxed();

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

                // macOS: let him ride along over other apps' fullscreen Spaces.
                // canJoinAllSpaces(1) | stationary(16) | fullScreenAuxiliary(256)
                #[cfg(target_os = "macos")]
                {
                    use objc2::msg_send;
                    use objc2::runtime::AnyObject;
                    if let Ok(ptr) = window.ns_window() {
                        let ns = ptr as *mut AnyObject;
                        let behavior: usize = 1 | 16 | 256;
                        unsafe {
                            let _: () = msg_send![ns, setCollectionBehavior: behavior];
                            // ride above fullscreen apps' content (well above normal + floating)
                            let _: () = msg_send![ns, setLevel: 100i64];
                        }
                    }
                }

                // Restore the last dragged spot, else park bottom-center above the Dock.
                if let Some((x, y)) = load_pos() {
                    let _ = window.set_position(PhysicalPosition::new(x, y));
                } else if let Ok(Some(monitor)) = window.primary_monitor() {
                    let m = monitor.size();
                    let w = window
                        .outer_size()
                        .unwrap_or(tauri::PhysicalSize { width: 280, height: 340 });
                    let x = ((m.width as i32) - (w.width as i32)) / 2;
                    let y = (m.height as i32) - (w.height as i32) - 28;
                    let _ = window.set_position(PhysicalPosition::new(x.max(0), y.max(0)));
                }

                // Remember where you drag it to.
                window.on_window_event(|e| {
                    if let tauri::WindowEvent::Moved(p) = e {
                        save_pos(p.x, p.y);
                    }
                });
            }

            let handle = app.handle().clone();

            // coding agent state file -> "task" events
            {
                let h = handle.clone();
                thread::spawn(move || {
                    let mut last = String::new();
                    loop {
                        let cur = read_trim(state_path());
                        if !cur.is_empty() && cur != last {
                            last = cur.clone();
                            let _ = h.emit("task", cur);
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
                    let mut cpu = 0.0f64;
                    let mut batt = 100i32;
                    let mut charging = true;
                    let mut last_sys = Instant::now() - Duration::from_secs(20);
                    let mut hovering = false;
                    let mut ignoring = true;
                    let mut last_interact = Instant::now();
                    let mut next_roam = Instant::now() + Duration::from_secs(10);
                    let mut roam_goal: Option<(i32, i32)> = None;
                    let mut nap_until: Option<Instant> = None;
                    let mut screen = (2560i32, 1440i32);
                    if let Some(win) = h.get_webview_window("pet") {
                        if let Ok(Some(mon)) = win.primary_monitor() {
                            let s = mon.size();
                            screen = (s.width as i32, s.height as i32);
                        }
                    }
                    loop {
                        if last_app.elapsed() > Duration::from_millis(1500) {
                            let (c, n) = front_app();
                            app_cat = c;
                            app_name = n;
                            last_app = Instant::now();
                        }
                        if last_sys.elapsed() > Duration::from_secs(5) {
                            cpu = cpu_busy();
                            let (p, c) = battery();
                            batt = p;
                            charging = c;
                            last_sys = Instant::now();
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

                                // scurry home: if abandoned floating mid-screen, scoot to a corner
                                let mut roam_pose = "";
                                if hovering {
                                    last_interact = Instant::now();
                                    roam_goal = None;
                                    nap_until = None;
                                } else {
                                    let (ww, wh) = window
                                        .outer_size()
                                        .map(|s| (s.width as i32, s.height as i32))
                                        .unwrap_or((560, 680));
                                    let idle = last_interact.elapsed() > Duration::from_secs(6);

                                    if let Some(until) = nap_until {
                                        // napping on the menu bar; wake after a while
                                        if Instant::now() > until {
                                            nap_until = None;
                                            next_roam = Instant::now() + Duration::from_secs(6);
                                        }
                                    } else if idle {
                                        match roam_goal {
                                            None => {
                                                if Instant::now() > next_roam {
                                                    let s = seed_now();
                                                    let maxx = (screen.0 - ww - 16).max(16);
                                                    let midy_hi = (screen.1 - wh - 140).max(80);
                                                    // weight the Dock, then the side walls, then a menu-bar nap
                                                    roam_goal = Some(match s % 6 {
                                                        0 | 1 | 2 => (rnd(s >> 3, 16, maxx), screen.1 - wh - 28),
                                                        3 => (0, rnd(s >> 3, 60, midy_hi)),
                                                        4 => (screen.0 - ww, rnd(s >> 3, 60, midy_hi)),
                                                        _ => (rnd(s >> 3, 40, maxx), 2),
                                                    });
                                                }
                                            }
                                            Some((gx, gy)) => {
                                                let dx = gx - wp.x;
                                                let dy = gy - wp.y;
                                                if dx.abs() <= 3 && dy.abs() <= 3 {
                                                    roam_goal = None;
                                                    if gy < 40 {
                                                        nap_until = Some(Instant::now() + Duration::from_secs(24));
                                                    } else {
                                                        next_roam = Instant::now() + Duration::from_secs(9);
                                                    }
                                                } else {
                                                    let sx = dx.signum() * dx.abs().min(3);
                                                    let sy = dy.signum() * dy.abs().min(3);
                                                    let _ = window
                                                        .set_position(PhysicalPosition::new(wp.x + sx, wp.y + sy));
                                                }
                                            }
                                        }
                                    }

                                    // tell the frontend how to pose while roaming
                                    let near_top = wp.y < 60;
                                    roam_pose = if nap_until.is_some() || (near_top && roam_goal.is_none()) {
                                        "nap"
                                    } else if wp.x < 60 {
                                        "climb-l"
                                    } else if wp.x > screen.0 - ww - 60 {
                                        "climb-r"
                                    } else {
                                        ""
                                    };
                                }
                                let payload = serde_json::json!({
                                    "cursorX": cp.x, "cursorY": cp.y,
                                    "winX": wp.x, "winY": wp.y, "scale": scale,
                                    "hovering": hovering, "app": app_cat, "appName": app_name,
                                    "cpu": cpu, "batt": batt, "charging": charging,
                                    "roam": roam_pose,
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
