use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::time::Duration;

use device_query::{DeviceQuery, DeviceState};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, PhysicalPosition};
use tauri_plugin_global_shortcut::ShortcutState;

static TOAST_INIT: AtomicBool = AtomicBool::new(false);
static SNAPPING: AtomicBool = AtomicBool::new(false);
/// Configured screen edge for the hotzone trigger. 0 = disabled, 1 = left,
/// 2 = right, 3 = top, 4 = bottom. Updated from JS via `set_hotzone_edge`.
static HOTZONE_EDGE: AtomicI32 = AtomicI32::new(0);

const SNAP_THRESHOLD_PX: i32 = 24;
const HOTZONE_TRIGGER_PX: i32 = 4;

const SUCCESS_HTML: &str = r#"<!doctype html><html><head><meta charset="utf-8"><title>Signed in</title>
<style>body{font:14px system-ui;background:#14161c;color:#e8eaed;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}</style>
</head><body><div><h2>You're signed in</h2><p>You can close this tab and return to the dashboard.</p></div></body></html>"#;

const ERROR_HTML: &str = r#"<!doctype html><html><head><meta charset="utf-8"><title>Sign-in failed</title></head>
<body><h2>Sign-in failed</h2><p>No <code>code</code> parameter received.</p></body></html>"#;

/// Blocks until the browser hits http://127.0.0.1:<port>/callback?code=...
/// Returns the `code` query parameter, or an error string suitable for surfacing
/// to the frontend.
#[tauri::command]
async fn await_oauth_code(port: u16) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run_listener(port))
        .await
        .map_err(|e| format!("listener task panicked: {e}"))?
}

fn run_listener(port: u16) -> Result<String, String> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let listener = TcpListener::bind(addr).map_err(|e| format!("could not bind {addr}: {e}"))?;
    // Don't let a stray browser request hang us forever.
    listener
        .set_nonblocking(false)
        .map_err(|e| format!("set_nonblocking: {e}"))?;

    loop {
        let (mut stream, _peer) = listener
            .accept()
            .map_err(|e| format!("accept failed: {e}"))?;
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .map_err(|e| format!("set_read_timeout: {e}"))?;

        let mut reader = BufReader::new(stream.try_clone().map_err(|e| format!("clone: {e}"))?);
        let mut request_line = String::new();
        if reader.read_line(&mut request_line).is_err() {
            continue;
        }

        // Request line: "GET /callback?code=abc&state=xyz HTTP/1.1"
        let path = request_line.split_whitespace().nth(1).unwrap_or("");
        let code = extract_code(path);

        let (status, body) = if code.is_some() {
            ("HTTP/1.1 200 OK", SUCCESS_HTML)
        } else {
            ("HTTP/1.1 400 Bad Request", ERROR_HTML)
        };

        let response = format!(
            "{status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n{body}",
            len = body.len()
        );
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();

        if let Some(code) = code {
            return Ok(code);
        }
        // Otherwise keep listening — could be a favicon request or a stray probe.
    }
}

fn extract_code(path: &str) -> Option<String> {
    let query = path.split_once('?')?.1;
    for pair in query.split('&') {
        if let Some(("code", value)) = pair.split_once('=') {
            return Some(url_decode(value));
        }
    }
    None
}

fn url_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    out.push(byte as char);
                } else {
                    out.push('%');
                }
                i += 3;
            }
            b => {
                out.push(b as char);
                i += 1;
            }
        }
    }
    out
}

fn app_data_file(app: &tauri::AppHandle, filename: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {e}"))?;
    Ok(dir.join(filename))
}

fn favorites_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app_data_file(app, "favorites.json")
}

#[tauri::command]
fn load_favorites(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = favorites_path(&app)?;
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).map_err(|e| format!("parse: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::Value::Null),
        Err(e) => Err(format!("read {}: {e}", path.display())),
    }
}

#[tauri::command]
fn save_favorites(app: tauri::AppHandle, data: serde_json::Value) -> Result<(), String> {
    let path = favorites_path(&app)?;
    let json = serde_json::to_string(&data).map_err(|e| format!("serialize: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("write {}: {e}", path.display()))
}

#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = app_data_file(&app, "settings.json")?;
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).map_err(|e| format!("parse: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::Value::Null),
        Err(e) => Err(format!("read {}: {e}", path.display())),
    }
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, data: serde_json::Value) -> Result<(), String> {
    let path = app_data_file(&app, "settings.json")?;
    let json = serde_json::to_string_pretty(&data).map_err(|e| format!("serialize: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("write {}: {e}", path.display()))
}

#[tauri::command]
fn load_floorplan(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = app_data_file(&app, "floorplan.json")?;
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).map_err(|e| format!("parse: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::Value::Null),
        Err(e) => Err(format!("read {}: {e}", path.display())),
    }
}

#[tauri::command]
fn save_floorplan(app: tauri::AppHandle, data: serde_json::Value) -> Result<(), String> {
    let path = app_data_file(&app, "floorplan.json")?;
    let json = serde_json::to_string_pretty(&data).map_err(|e| format!("serialize: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("write {}: {e}", path.display()))
}

#[tauri::command]
fn show_toast(app: tauri::AppHandle, text: String, duration_ms: u64) -> Result<(), String> {
    let win = app
        .get_webview_window("toast")
        .ok_or_else(|| "toast window missing".to_string())?;

    // One-time setup: make the toast window click-through and position it.
    if !TOAST_INIT.swap(true, Ordering::SeqCst) {
        let _ = win.set_ignore_cursor_events(true);
        let monitor = app
            .get_webview_window("main")
            .and_then(|w| w.current_monitor().ok().flatten())
            .or_else(|| win.primary_monitor().ok().flatten());
        if let Some(monitor) = monitor {
            let m_pos = monitor.position();
            let m_size = monitor.size();
            let w_size = win.outer_size().map_err(|e| format!("outer_size: {e}"))?;
            let x = m_pos.x + ((m_size.width as i32) - (w_size.width as i32)) / 2;
            let y = m_pos.y + 96;
            let _ = win.set_position(PhysicalPosition::new(x, y));
        }
        let _ = win.show();
    }

    // Append a new toast div onto the stack. Each toast manages its own
    // entrance animation and removal, so they accumulate top-down and fade
    // independently — newer toasts push older ones DOWN in the stack
    // (newest appears at the top of the visible stack since we prepend).
    let escaped =
        serde_json::to_string(&text).map_err(|e| format!("serialize text: {e}"))?;
    let js = format!(
        r#"(function(){{
            var s=document.getElementById('stack'); if(!s) return;
            var d=document.createElement('div'); d.className='toast-msg'; d.textContent={text};
            if (s.firstChild) s.insertBefore(d, s.firstChild); else s.appendChild(d);
            requestAnimationFrame(function(){{ d.classList.add('in'); }});
            setTimeout(function(){{
              d.classList.add('out'); d.classList.remove('in');
              setTimeout(function(){{ if(d.parentNode) d.parentNode.removeChild(d); }}, 300);
            }}, {duration});
        }})();"#,
        text = escaped,
        duration = duration_ms
    );
    win.eval(&js).map_err(|e| format!("eval: {e}"))?;

    Ok(())
}

#[tauri::command]
fn set_hotzone_edge(edge: i32) -> Result<(), String> {
    if !(0..=4).contains(&edge) {
        return Err(format!("invalid edge {edge}"));
    }
    HOTZONE_EDGE.store(edge, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn set_window_mode(app: tauri::AppHandle, mode: String) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;
    match mode.as_str() {
        "widget" => {
            win.set_always_on_top(true).map_err(|e| e.to_string())?;
            win.set_decorations(false).map_err(|e| e.to_string())?;
            win.set_resizable(true).map_err(|e| e.to_string())?;
            win.set_size(tauri::LogicalSize::new(320.0, 480.0))
                .map_err(|e| e.to_string())?;
        }
        "dashboard" => {
            win.set_always_on_top(false).map_err(|e| e.to_string())?;
            win.set_decorations(false).map_err(|e| e.to_string())?;
            win.set_resizable(true).map_err(|e| e.to_string())?;
            win.set_size(tauri::LogicalSize::new(1200.0, 800.0))
                .map_err(|e| e.to_string())?;
        }
        _ => return Err(format!("unknown mode: {mode}")),
    }
    let _ = win.set_focus();
    Ok(())
}

#[tauri::command]
fn toggle_window(app: tauri::AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;
    let visible = win.is_visible().unwrap_or(true);
    if visible {
        win.hide().map_err(|e| e.to_string())?;
    } else {
        win.show().map_err(|e| e.to_string())?;
        let _ = win.set_focus();
    }
    Ok(())
}

fn snap_window_to_edges(window: &tauri::WebviewWindow) {
    if SNAPPING.swap(true, Ordering::SeqCst) {
        return;
    }
    let result: Result<(), Box<dyn std::error::Error>> = (|| {
        let monitor = window.current_monitor()?.ok_or("no monitor")?;
        let m_pos = monitor.position();
        let m_size = monitor.size();
        let outer = window.outer_position()?;
        let size = window.outer_size()?;

        let left_edge = m_pos.x;
        let right_edge = m_pos.x + (m_size.width as i32) - (size.width as i32);
        let top_edge = m_pos.y;
        let bottom_edge = m_pos.y + (m_size.height as i32) - (size.height as i32);

        let mut new_x = outer.x;
        let mut new_y = outer.y;

        if (outer.x - left_edge).abs() < SNAP_THRESHOLD_PX {
            new_x = left_edge;
        } else if (outer.x - right_edge).abs() < SNAP_THRESHOLD_PX {
            new_x = right_edge;
        }
        if (outer.y - top_edge).abs() < SNAP_THRESHOLD_PX {
            new_y = top_edge;
        } else if (outer.y - bottom_edge).abs() < SNAP_THRESHOLD_PX {
            new_y = bottom_edge;
        }

        if new_x != outer.x || new_y != outer.y {
            window.set_position(PhysicalPosition::new(new_x, new_y))?;
        }
        Ok(())
    })();
    let _ = result;
    SNAPPING.store(false, Ordering::SeqCst);
}

/// Spawn a thread that polls the system cursor position and emits a
/// `hotzone-trigger` event to the main webview when the cursor sits within
/// HOTZONE_TRIGGER_PX of the configured edge. Debounced so consecutive frames
/// at the edge don't spam the channel.
fn spawn_hotzone_watcher(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let device_state = DeviceState::new();
        let mut last_in_zone = false;
        loop {
            std::thread::sleep(Duration::from_millis(80));
            let edge = HOTZONE_EDGE.load(Ordering::SeqCst);
            if edge == 0 {
                last_in_zone = false;
                continue;
            }
            let mouse = device_state.get_mouse();
            let (cx, cy) = (mouse.coords.0, mouse.coords.1);

            let Some(win) = app.get_webview_window("main") else {
                continue;
            };
            let Ok(Some(monitor)) = win.current_monitor() else {
                continue;
            };
            let m_pos = monitor.position();
            let m_size = monitor.size();

            let in_zone = match edge {
                1 => cx <= m_pos.x + HOTZONE_TRIGGER_PX,
                2 => cx >= m_pos.x + (m_size.width as i32) - HOTZONE_TRIGGER_PX,
                3 => cy <= m_pos.y + HOTZONE_TRIGGER_PX,
                4 => cy >= m_pos.y + (m_size.height as i32) - HOTZONE_TRIGGER_PX,
                _ => false,
            };

            if in_zone && !last_in_zone {
                let _ = app.emit("hotzone-trigger", edge);
            }
            last_in_zone = in_zone;
        }
    });
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Show / Hide", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &quit])?;

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Smart (Components) Toolkit Widget")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => {
                let _ = toggle_window(app.clone());
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = toggle_window(tray.app_handle().clone());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = toggle_window(app.clone());
                    }
                })
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();

            // Start minimized? Read settings.json synchronously and hide window
            // before it ever paints if the user opted in.
            if let Ok(path) = app_data_file(&handle, "settings.json") {
                if let Ok(contents) = fs::read_to_string(&path) {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&contents) {
                        let start_minimized = value
                            .get("startMinimized")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        if start_minimized {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.hide();
                            }
                        }
                    }
                }
            }

            // Snap-to-edges on move
            if let Some(win) = app.get_webview_window("main") {
                let win_clone = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::Moved(_) = event {
                        snap_window_to_edges(&win_clone);
                    }
                });
            }
            build_tray(&handle)?;
            spawn_hotzone_watcher(handle.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            await_oauth_code,
            load_favorites,
            save_favorites,
            load_settings,
            save_settings,
            load_floorplan,
            save_floorplan,
            show_toast,
            set_hotzone_edge,
            set_window_mode,
            toggle_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_simple_code() {
        assert_eq!(
            extract_code("/callback?code=abc123&state=x"),
            Some("abc123".to_string())
        );
    }

    #[test]
    fn extracts_urlencoded_code() {
        assert_eq!(
            extract_code("/callback?code=ab%2Bcd"),
            Some("ab+cd".to_string())
        );
    }

    #[test]
    fn returns_none_without_code() {
        assert_eq!(extract_code("/callback?state=x"), None);
        assert_eq!(extract_code("/callback"), None);
    }
}
