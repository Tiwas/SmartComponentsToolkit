# Smart (Components) Toolkit Widget

A small floating, always-on-top desktop widget for triggering Homey flows and watching notifications. Sits next to your editor or browser without stealing focus.

> **Status: v0.0.1 — experimental.** API surface and storage shape may change.

## What it does

- **★ Favorites tab** — flows you've starred, optionally organized into custom local folders. Right-click to move flows between folders or create new ones. Favorites persist across restarts in `<app-data-dir>/favorites.json`.
- **Folders tab** — flows grouped by their Homey flow folder (read-only, mirrors what's in the Homey app).
- **All tab** — flat alphabetical list.
- **Click** a flow → triggers it (with toast feedback).
- **Right-click** → context menu: run, manage favorites, edit in browser (opens `my.homey.app`).
- **Live notifications** from Homey appear as toasts in the dashboard while it's running.
- **Search** filters the current tab.

> ⚠️ Homey's public API doesn't expose the "Favorites" you set in the mobile app, so this dashboard's favorites list is local. Use the *Folders* tab for synced grouping, or organize your dashboard favorites independently.

## Get the code

Either:

**Option A — clone with git** *(recommended; lets you pull updates with `git pull`)*

```sh
git clone https://github.com/Tiwas/SmartComponentsToolkit.git
cd SmartComponentsToolkit/apps/dashboard
```

**Option B — download a ZIP**

1. Go to <https://github.com/Tiwas/SmartComponentsToolkit>
2. Click the green **Code** button → **Download ZIP**
3. Extract, then `cd <extracted-folder>/apps/dashboard`

Either way, everything you need to build and run the widget lives under `apps/dashboard/`.

## Prerequisites

| Tool | Why | Install |
|---|---|---|
| **Node.js 18+** | builds the frontend | https://nodejs.org/ |
| **Rust toolchain** | builds the native shell | https://rustup.rs/ |
| **MSVC Build Tools** (Windows) | Tauri needs the MSVC linker | "Desktop development with C++" in the Visual Studio Build Tools installer (rustup will offer this) |
| **WebView2** (Windows) | renders the UI | pre-installed on Windows 11 |
| **webkit2gtk + libssl** (Linux) | renders the UI | `sudo apt install libwebkit2gtk-4.1-dev libssl-dev` (Debian/Ubuntu) |

Sanity check after installing Rust:

```sh
cargo --version
rustc --version
```

## Athom OAuth setup

You need an OAuth client at https://developer.athom.com/ → **API Settings**.

1. Create a client (or reuse the one you use for Flow Doctor — see scope note below).
2. Add this redirect URL to it: `http://127.0.0.1:53117/callback`
3. Enable at least these scopes on the client:
   - `homey.flow.readonly`
   - `homey.flow.start` *(required for triggering flows — Flow Doctor's client doesn't have this by default)*
   - `homey.zone.readonly`, `homey.device.readonly` *(harmless to leave on)*
   - `homey.notifications.readonly` *(for live notification toasts)*
4. Copy the **Client ID** and **Client Secret** — you'll paste them on first launch.

> **Important:** do **not** pass `scope=...` in the authorize URL. Athom grants whatever scopes are configured on the client when the parameter is omitted; passing a non-matching scope string degrades you to login/email only.

## Running in development

From this directory:

```sh
npm install
npm run tauri:dev
```

> First-run install also bootstraps the `shared/` subpackage automatically (it's linked via `file:./shared`).

The first run compiles the Rust side (slow, ~2–5 min). Subsequent runs are fast — the frontend hot-reloads.

First launch flow:
1. Paste Client ID + Secret → **Save**
2. **Sign in** → opens system browser → consent → returns to app
3. Dashboard loads your flows

## Building installers

From this directory:

```sh
# Windows: produces .msi + .exe under src-tauri/target/release/bundle/
npm run release:windows

# macOS: .dmg + .app
npm run release:macos

# Linux: .deb + .AppImage
npm run release:linux

# Or just `npm run tauri:build` for the platform defaults.
```

There are convenience wrappers under `scripts/`:

| Platform | Command |
|---|---|
| Windows | `pwsh -File scripts/build.ps1` |
| macOS / Linux | `bash scripts/build.sh` |

Both run a silent `npm install` if needed and then build for the host platform.

## Architecture

```
apps/dashboard/
├─ shared/                # framework-agnostic TS: auth, Homey client wrapper,
│                         #   favorites + folders data model, settings model,
│                         #   notification-source resolver, smoke test
├─ src/                   # React frontend (Vite)
│  ├─ App.tsx             # screen state machine: setup → login → dashboard ↔ settings
│  ├─ components/         # Dashboard, FlowRow, ContextMenu, PromptModal, Settings, …
│  └─ lib/                # cloud (loads AthomCloudAPI from CDN),
│                         #   oauth (Tauri loopback handler),
│                         #   favorites-tauri + settings-tauri (file-backed)
├─ public/toast.html      # standalone screen-toast page (yellow-orange, stacked)
└─ src-tauri/             # Rust shell (Tauri 2)
   ├─ src/lib.rs          # loopback OAuth + favorites/settings I/O + show_toast
   ├─ tauri.conf.json     # main window + toast window
   └─ capabilities/       # plugin permissions
```

`shared/` is a standalone TypeScript package linked via `file:./shared`. It deliberately has no Tauri/React/Vite dependencies so its smoke tests (`apps/dashboard/shared/test/smoke.ts`) can run with `npx tsx` in plain Node.

Key design choices:
- **AthomCloudAPI loaded from CDN** (same `cdn.athom.com/homey-api/3.14.8.js` as the `docs/tools/` web apps) — avoids version drift with the npm package.
- **Loopback OAuth** at `127.0.0.1:53117` — Rust spins up a one-shot HTTP listener, opens the system browser, captures the redirect, hands the code back to JS.
- **Favorites in `app_data_dir`** — `%APPDATA%\no.tiwas.homeytoolbox.dashboard\favorites.json` on Windows, equivalent on macOS/Linux. Survives WebView2 storage resets.

## Known limits

- **Single Homey only** — uses the first one returned by `getHomeys()`.
- **No drag-and-drop** for favorites — use the right-click context menu.
- **No iOS yet** — planned via PWA, since Apple disallows actual floating widgets outside WidgetKit.
- **No app icon customization** — built-in placeholder. Run `npx tauri icon path/to/source.png` from this directory to swap it.
- **Tokens in localStorage** — managed by Athom's SDK. OS keychain integration is on the list.
