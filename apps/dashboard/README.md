# Smart (Components) Toolkit Widget

Cross-platform dashboard for triggering Homey flows and surfacing Homey notifications as on-screen toasts.

## Folder structure

| Folder | What lives here |
|---|---|
| **`shared/`** | Framework-agnostic TypeScript: OAuth URL builder, `HomeyClient` (wraps `AthomCloudAPI`), favorites + folders data model, settings normalization, notification-source resolver, smoke tests. No Tauri / React / Vite dependencies. |
| **`app/`** | Desktop shell built with [Tauri 2](https://v2.tauri.app/) + React + Vite + TypeScript. Floating, always-on-top widget for Windows, macOS, Linux. Imports `shared/` via `file:`-link. See [`app/README.md`](app/README.md) for setup. |
| `pwa/` *(planned)* | Browser-installable PWA for iOS, since Apple doesn't allow floating widgets outside WidgetKit. Will reuse `shared/`. |

## Why the split?

`shared/` knows nothing about *where* it runs. That means the same `HomeyClient`, OAuth flow, favorites model and notification source resolver work in any future shell — desktop today, PWA tomorrow, native iOS later if WidgetKit ever becomes interesting — without duplicating logic.

## Quick start

Most workflows happen inside `app/`:

```sh
cd apps/dashboard/app
npm install
npm run tauri:dev      # development with hot reload
npm run release:windows # or release:macos / release:linux
```

Full setup including OAuth scopes lives in [`app/README.md`](app/README.md).
