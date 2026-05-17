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
};

export function normalizeSettings(raw: unknown): AppSettings {
  if (raw == null || typeof raw !== "object") return DEFAULT_SETTINGS;
  const obj = raw as Record<string, unknown>;
  const n = (obj.notifications ?? {}) as Record<string, unknown>;
  const language =
    typeof obj.language === "string" && SUPPORTED_LANGUAGES.includes(obj.language as Language)
      ? (obj.language as Language)
      : DEFAULT_SETTINGS.language;
  return {
    language,
    autostart: typeof obj.autostart === "boolean" ? obj.autostart : DEFAULT_SETTINGS.autostart,
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
