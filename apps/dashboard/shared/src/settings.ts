export type Language = "en" | "no" | "de" | "nl";

export const SUPPORTED_LANGUAGES: Language[] = ["en", "no", "de", "nl"];

/**
 * Pick a default language from a BCP-47 tag like "nb-NO" / "de-DE" / "nl".
 * Falls back to English if no match. Norwegian Bokmål and Nynorsk both map to "no".
 */
export function defaultLanguage(navigatorLang: string | undefined): Language {
  const tag = (navigatorLang ?? "en").toLowerCase();
  if (tag.startsWith("nb") || tag.startsWith("nn") || tag.startsWith("no")) return "no";
  if (tag.startsWith("de")) return "de";
  if (tag.startsWith("nl")) return "nl";
  return "en";
}

export type HotzoneEdge = "off" | "left" | "right" | "top" | "bottom";

export const HOTZONE_EDGES: HotzoneEdge[] = ["off", "left", "right", "top", "bottom"];

export type AppMode = "widget" | "dashboard";

export const APP_MODES: AppMode[] = ["widget", "dashboard"];

export interface NotificationSettings {
  enabled: boolean;
  durationMs: number;
  /** Poll interval in seconds. */
  pollIntervalSec: number;
  /** If true, show source label ("Flow — ..." / "Stuelyset — ...") in toasts. */
  showSource: boolean;
}

export interface AppSettings {
  language: Language;
  autostart: boolean;
  notifications: NotificationSettings;
  /** Active Homey id; empty string means "use first one found". */
  homeyId: string;
  /** Widget = small always-on-top tooltip; dashboard = full floorplan view. */
  mode: AppMode;
  /** Global shortcut (Tauri-style accelerator, e.g. "CommandOrControl+Shift+H"). Empty = unregistered. */
  hotkey: string;
  /** Screen edge to use as a hotzone (move cursor to edge to pop the widget out). */
  hotzone: HotzoneEdge;
  /** If a hotzone-triggered show is ignored (cursor never reaches the widget), auto-hide after this many seconds. */
  hotzoneAutoHideSec: number;
  /** If true, the widget starts hidden and only appears on tray click / hotkey / hotzone. */
  startMinimized: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: "en",
  autostart: false,
  notifications: {
    enabled: true,
    durationMs: 6000,
    pollIntervalSec: 10,
    showSource: true,
  },
  homeyId: "",
  mode: "widget",
  hotkey: "CommandOrControl+Shift+H",
  hotzone: "off",
  hotzoneAutoHideSec: 10,
  startMinimized: false,
};

export function normalizeSettings(raw: unknown): AppSettings {
  if (raw == null || typeof raw !== "object") return DEFAULT_SETTINGS;
  const obj = raw as Record<string, unknown>;
  const n = (obj.notifications ?? {}) as Record<string, unknown>;
  const language =
    typeof obj.language === "string" && SUPPORTED_LANGUAGES.includes(obj.language as Language)
      ? (obj.language as Language)
      : DEFAULT_SETTINGS.language;
  const hotzone = HOTZONE_EDGES.includes(obj.hotzone as HotzoneEdge)
    ? (obj.hotzone as HotzoneEdge)
    : DEFAULT_SETTINGS.hotzone;
  return {
    language,
    autostart: typeof obj.autostart === "boolean" ? obj.autostart : DEFAULT_SETTINGS.autostart,
    homeyId: typeof obj.homeyId === "string" ? obj.homeyId : DEFAULT_SETTINGS.homeyId,
    mode: APP_MODES.includes(obj.mode as AppMode) ? (obj.mode as AppMode) : DEFAULT_SETTINGS.mode,
    hotkey: typeof obj.hotkey === "string" ? obj.hotkey : DEFAULT_SETTINGS.hotkey,
    hotzone,
    hotzoneAutoHideSec:
      typeof obj.hotzoneAutoHideSec === "number" && obj.hotzoneAutoHideSec >= 1
        ? Math.min(obj.hotzoneAutoHideSec, 120)
        : DEFAULT_SETTINGS.hotzoneAutoHideSec,
    startMinimized:
      typeof obj.startMinimized === "boolean"
        ? obj.startMinimized
        : DEFAULT_SETTINGS.startMinimized,
    notifications: {
      enabled:
        typeof n.enabled === "boolean" ? n.enabled : DEFAULT_SETTINGS.notifications.enabled,
      durationMs:
        typeof n.durationMs === "number" && n.durationMs > 500
          ? Math.min(n.durationMs, 60_000)
          : DEFAULT_SETTINGS.notifications.durationMs,
      pollIntervalSec:
        typeof n.pollIntervalSec === "number" && n.pollIntervalSec >= 3
          ? Math.min(n.pollIntervalSec, 300)
          : DEFAULT_SETTINGS.notifications.pollIntervalSec,
      showSource:
        typeof n.showSource === "boolean"
          ? n.showSource
          : DEFAULT_SETTINGS.notifications.showSource,
    },
  };
}
