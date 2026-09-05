use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::time::{Duration, Instant};

#[cfg(test)]
use std::sync::Mutex;

use device_query::{DeviceQuery, DeviceState};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, PhysicalPosition};
use tauri_plugin_global_shortcut::ShortcutState;

static TOAST_INIT: AtomicBool = AtomicBool::new(false);
static SNAPPING: AtomicBool = AtomicBool::new(false);
/// Configured screen edge for the hotzone trigger. 0 = disabled, 1 = left,
/// 2 = right, 3 = top, 4 = bottom. Updated from JS via `set_hotzone_edge`.
static HOTZONE_EDGE: AtomicI32 = AtomicI32::new(0);
static OAUTH_CANCELLED: AtomicBool = AtomicBool::new(false);
#[cfg(test)]
static OAUTH_TEST_LOCK: Mutex<()> = Mutex::new(());

const SNAP_THRESHOLD_PX: i32 = 24;
const HOTZONE_TRIGGER_PX: i32 = 4;
const KEYRING_SERVICE: &str = "no.tiwas.homeytoolbox.dashboard";
const OAUTH_CREDENTIAL_ACCOUNT: &str = "oauth-credentials";
const CLOUD_STORE_ACCOUNT: &str = "athom-cloud-store";
const CLOUD_STORE_CHUNK_BYTES: usize = 2_000;
const CLOUD_STORE_MAX_CHUNKS: usize = 16;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OAuthCredentials {
    client_id: String,
    client_secret: String,
}

fn keyring_entry(account: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, account)
        .map_err(|error| format!("could not access OS credential store: {error}"))
}

fn load_secret(account: &str) -> Result<Option<String>, String> {
    match keyring_entry(account)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("could not read OS credential store: {error}")),
    }
}

fn clear_secret(account: &str) -> Result<(), String> {
    match keyring_entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("could not clear OS credential store: {error}")),
    }
}

#[derive(Clone, Copy)]
struct CloudStoreManifest {
    generation: usize,
    chunk_count: usize,
}

fn cloud_store_chunk_account(generation: usize, index: usize) -> String {
    format!("{CLOUD_STORE_ACCOUNT}-{generation}-{index}")
}

fn split_utf8_chunks(value: &str) -> Vec<&str> {
    let mut chunks = Vec::new();
    let mut start = 0;
    let mut size = 0;
    for (index, character) in value.char_indices() {
        let character_size = character.len_utf8();
        if size + character_size > CLOUD_STORE_CHUNK_BYTES {
            chunks.push(&value[start..index]);
            start = index;
            size = 0;
        }
        size += character_size;
    }
    if start < value.len() {
        chunks.push(&value[start..]);
    }
    chunks
}

fn cloud_store_manifest() -> Result<Option<CloudStoreManifest>, String> {
    let Some(manifest) = load_secret(CLOUD_STORE_ACCOUNT)? else {
        return Ok(None);
    };
    let (generation, chunk_count) = manifest
        .split_once(':')
        .and_then(|(generation, count)| Some((generation.parse().ok()?, count.parse().ok()?)))
        .filter(|(generation, count): &(usize, usize)| {
            *generation < 2 && (1..=CLOUD_STORE_MAX_CHUNKS).contains(count)
        })
        .ok_or_else(|| "stored cloud credential manifest is invalid".to_string())?;
    Ok(Some(CloudStoreManifest {
        generation,
        chunk_count,
    }))
}

fn load_cloud_store_secret() -> Result<Option<String>, String> {
    let Some(manifest) = cloud_store_manifest()? else {
        return Ok(None);
    };
    let mut store = String::new();
    for index in 0..manifest.chunk_count {
        let Some(chunk) = load_secret(&cloud_store_chunk_account(manifest.generation, index))?
        else {
            // A partial clear is equivalent to a logged-out session. Leave
            // best-effort cleanup for now, but never let a stale manifest
            // prevent the dashboard from reaching its login screen.
            let _ = clear_cloud_store_secret();
            return Ok(None);
        };
        store.push_str(&chunk);
    }
    Ok(Some(store))
}

fn serialize_secure_cloud_store(value: &str) -> Result<String, String> {
    let store = serde_json::from_str::<serde_json::Value>(&value)
        .map_err(|error| format!("cloud storage payload must be JSON: {error}"))?;
    // AthomCloudAPI persists a `user` cache alongside the OAuth token. It is
    // not needed to resume a session, so keep only the token and avoid putting
    // an unbounded cache into the platform credential store.
    let persisted = store
        .get("token")
        .cloned()
        .map(|token| serde_json::json!({ "token": token }))
        .unwrap_or_else(|| serde_json::json!({}));
    serde_json::to_string(&persisted)
        .map_err(|error| format!("could not serialize cloud credential: {error}"))
}

fn save_cloud_store_secret(value: String) -> Result<(), String> {
    let serialized = serialize_secure_cloud_store(&value)?;
    let chunks = split_utf8_chunks(&serialized);
    if chunks.len() > CLOUD_STORE_MAX_CHUNKS {
        return Err("cloud credential exceeds the secure storage limit".to_string());
    }

    let previous = cloud_store_manifest()?;
    let generation = previous.map_or(0, |manifest| manifest.generation ^ 1);
    for (index, chunk) in chunks.iter().enumerate() {
        keyring_entry(&cloud_store_chunk_account(generation, index))?
            .set_password(chunk)
            .map_err(|error| format!("could not save OS credential: {error}"))?;
    }
    keyring_entry(CLOUD_STORE_ACCOUNT)?
        .set_password(&format!("{generation}:{}", chunks.len()))
        .map_err(|error| format!("could not save OS credential manifest: {error}"))?;
    if let Some(previous) = previous {
        for index in 0..previous.chunk_count {
            // The new manifest is already durable; stale chunks are cleaned
            // opportunistically and can never become active again.
            let _ = clear_secret(&cloud_store_chunk_account(previous.generation, index));
        }
    }
    Ok(())
}

fn clear_cloud_store_secret() -> Result<(), String> {
    // Scan both bounded generations so a retry cleans up even when an earlier
    // sign-out failed halfway through deleting credential-store entries.
    for generation in 0..2 {
        for index in 0..CLOUD_STORE_MAX_CHUNKS {
            clear_secret(&cloud_store_chunk_account(generation, index))?;
        }
    }
    clear_secret(CLOUD_STORE_ACCOUNT)
}

#[tauri::command]
async fn load_oauth_credentials() -> Result<Option<OAuthCredentials>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        load_secret(OAUTH_CREDENTIAL_ACCOUNT)?
            .map(|value| {
                serde_json::from_str(&value)
                    .map_err(|error| format!("stored OAuth credentials are invalid: {error}"))
            })
            .transpose()
    })
    .await
    .map_err(|error| format!("credential task panicked: {error}"))?
}

#[tauri::command]
async fn save_oauth_credentials(client_id: String, client_secret: String) -> Result<(), String> {
    if client_id.trim().is_empty() || client_secret.trim().is_empty() {
        return Err("OAuth client ID and secret must not be empty".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let payload = serde_json::to_string(&OAuthCredentials {
            client_id,
            client_secret,
        })
        .map_err(|error| format!("could not serialize OAuth credentials: {error}"))?;
        keyring_entry(OAUTH_CREDENTIAL_ACCOUNT)?
            .set_password(&payload)
            .map_err(|error| format!("could not save OS credential: {error}"))
    })
    .await
    .map_err(|error| format!("credential task panicked: {error}"))?
}

#[tauri::command]
async fn clear_oauth_credentials() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| clear_secret(OAUTH_CREDENTIAL_ACCOUNT))
        .await
        .map_err(|error| format!("credential task panicked: {error}"))?
}

#[tauri::command]
async fn load_cloud_store() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(load_cloud_store_secret)
        .await
        .map_err(|error| format!("credential task panicked: {error}"))?
}

#[tauri::command]
async fn save_cloud_store(value: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || save_cloud_store_secret(value))
        .await
        .map_err(|error| format!("credential task panicked: {error}"))?
}

#[tauri::command]
async fn clear_cloud_store() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(clear_cloud_store_secret)
        .await
        .map_err(|error| format!("credential task panicked: {error}"))?
}

const SUCCESS_HTML: &str = r#"<!doctype html><html><head><meta charset="utf-8"><title>Signed in</title>
<style>body{font:14px system-ui;background:#14161c;color:#e8eaed;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}</style>
</head><body><div><h2>You're signed in</h2><p>You can close this tab and return to the dashboard.</p></div></body></html>"#;

const ERROR_HTML: &str = r#"<!doctype html><html><head><meta charset="utf-8"><title>Sign-in failed</title></head>
<body><h2>Sign-in failed</h2><p>No <code>code</code> parameter received.</p></body></html>"#;

/// Blocks until the browser hits http://127.0.0.1:<port>/callback?code=...&state=...
/// Returns the `code` query parameter, or an error string suitable for surfacing
/// to the frontend.
#[tauri::command]
async fn await_oauth_code(
    port: u16,
    state: String,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    OAUTH_CANCELLED.store(false, Ordering::SeqCst);
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(120_000).clamp(1_000, 300_000));
    tauri::async_runtime::spawn_blocking(move || run_listener(port, &state, timeout))
        .await
        .map_err(|e| format!("listener task panicked: {e}"))?
}

#[tauri::command]
fn cancel_oauth_listener() {
    OAUTH_CANCELLED.store(true, Ordering::SeqCst);
}

fn run_listener(port: u16, expected_state: &str, timeout: Duration) -> Result<String, String> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let listener = TcpListener::bind(addr).map_err(|e| format!("could not bind {addr}: {e}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("set_nonblocking: {e}"))?;
    let deadline = Instant::now() + timeout;

    loop {
        if OAUTH_CANCELLED.load(Ordering::SeqCst) {
            return Err("OAuth sign-in cancelled".to_string());
        }
        if Instant::now() >= deadline {
            return Err("OAuth sign-in timed out".to_string());
        }

        let (mut stream, _peer) = match listener.accept() {
            Ok(connection) => connection,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(25));
                continue;
            }
            Err(error) => return Err(format!("accept failed: {error}")),
        };
        stream
            .set_read_timeout(Some(Duration::from_secs(1)))
            .map_err(|e| format!("set_read_timeout: {e}"))?;

        let mut reader = BufReader::new(stream.try_clone().map_err(|e| format!("clone: {e}"))?);
        let mut request_line = String::new();
        if reader.read_line(&mut request_line).is_err() {
            continue;
        }

        let callback = parse_callback_request(&request_line, expected_state);

        let (status, body) = match &callback {
            Ok(_) => ("HTTP/1.1 200 OK", SUCCESS_HTML),
            Err(_) => ("HTTP/1.1 400 Bad Request", ERROR_HTML),
        };

        let response = format!(
            "{status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n{body}",
            len = body.len()
        );
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();

        if let Ok(code) = callback {
            return Ok(code);
        }
        // Keep listening after malformed or stray requests until the valid
        // callback, cancellation, or overall deadline closes the listener.
    }
}

fn parse_callback_request(
    request_line: &str,
    expected_state: &str,
) -> Result<String, &'static str> {
    let mut parts = request_line.split_whitespace();
    if parts.next() != Some("GET") {
        return Err("callback must use GET");
    }
    let target = parts.next().ok_or("missing request target")?;
    if !matches!(parts.next(), Some(version) if version.starts_with("HTTP/"))
        || parts.next().is_some()
    {
        return Err("malformed request line");
    }
    let (path, query) = target.split_once('?').ok_or("missing callback query")?;
    if path != "/callback" {
        return Err("unexpected callback path");
    }

    let mut code = None;
    let mut state = None;
    for pair in query.split('&') {
        if let Some((key, value)) = pair.split_once('=') {
            match key {
                "code" => code = Some(url_decode(value)),
                "state" => state = Some(url_decode(value)),
                _ => {}
            }
        }
    }
    let code = code
        .filter(|value| !value.is_empty())
        .ok_or("missing code")?;
    if state.as_deref() != Some(expected_state) {
        return Err("invalid OAuth state");
    }
    Ok(code)
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
    let escaped = serde_json::to_string(&text).map_err(|e| format!("serialize text: {e}"))?;
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
            load_oauth_credentials,
            save_oauth_credentials,
            clear_oauth_credentials,
            load_cloud_store,
            save_cloud_store,
            clear_cloud_store,
            await_oauth_code,
            cancel_oauth_listener,
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
    fn cloud_store_discards_the_unbounded_user_cache() {
        let input = serde_json::json!({
            "token": { "access_token": "token", "refresh_token": "refresh" },
            "user": { "large": "x".repeat(CLOUD_STORE_CHUNK_BYTES * 2) },
        })
        .to_string();
        let stored = serialize_secure_cloud_store(&input).expect("valid cloud store");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&stored)
                .expect("valid stored JSON")
                .get("token")
                .and_then(|token| token.get("access_token"))
                .and_then(serde_json::Value::as_str),
            Some("token")
        );
        assert!(stored.len() < CLOUD_STORE_CHUNK_BYTES);
    }

    #[test]
    fn cloud_store_chunks_on_utf8_boundaries() {
        let input = "å".repeat(CLOUD_STORE_CHUNK_BYTES);
        let chunks = split_utf8_chunks(&input);
        assert!(chunks
            .iter()
            .all(|chunk| chunk.len() <= CLOUD_STORE_CHUNK_BYTES));
        assert_eq!(chunks.concat(), input);
    }

    #[test]
    fn accepts_callback_with_matching_state() {
        assert_eq!(
            parse_callback_request("GET /callback?code=abc123&state=x HTTP/1.1", "x"),
            Ok("abc123".to_string())
        );
    }

    #[test]
    fn decodes_callback_code() {
        assert_eq!(
            parse_callback_request("GET /callback?code=ab%2Bcd&state=x HTTP/1.1", "x"),
            Ok("ab+cd".to_string())
        );
    }

    #[test]
    fn rejects_missing_or_wrong_state() {
        assert!(parse_callback_request("GET /callback?code=abc HTTP/1.1", "x").is_err());
        assert!(parse_callback_request("GET /callback?code=abc&state=y HTTP/1.1", "x").is_err());
    }

    #[test]
    fn rejects_wrong_path_or_method() {
        assert!(parse_callback_request("GET /wrong?code=abc&state=x HTTP/1.1", "x").is_err());
        assert!(parse_callback_request("POST /callback?code=abc&state=x HTTP/1.1", "x").is_err());
        assert!(parse_callback_request("GET /callback?code=abc&state=x malformed", "x").is_err());
    }

    #[test]
    fn listener_times_out_without_a_callback() {
        let _lock = OAUTH_TEST_LOCK.lock().unwrap();
        OAUTH_CANCELLED.store(false, Ordering::SeqCst);
        let error = run_listener(0, "state", Duration::from_millis(1)).unwrap_err();
        assert_eq!(error, "OAuth sign-in timed out");
    }

    #[test]
    fn listener_can_be_cancelled_without_leaving_the_port_open() {
        let _lock = OAUTH_TEST_LOCK.lock().unwrap();
        OAUTH_CANCELLED.store(true, Ordering::SeqCst);
        let error = run_listener(0, "state", Duration::from_secs(1)).unwrap_err();
        OAUTH_CANCELLED.store(false, Ordering::SeqCst);
        assert_eq!(error, "OAuth sign-in cancelled");
    }
}
