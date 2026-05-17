use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{Manager, PhysicalPosition};

static TOAST_INIT: AtomicBool = AtomicBool::new(false);

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

fn favorites_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {e}"))?;
    Ok(dir.join("favorites.json"))
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            await_oauth_code,
            load_favorites,
            save_favorites,
            show_toast
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
