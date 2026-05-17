export interface NotificationSettings {
  enabled: boolean;
  durationMs: number;
  /** Poll interval in seconds. */
  pollIntervalSec: number;
  /** If true, show source label ("Flow — ..." / "Stuelyset — ...") in toasts. */
  showSource: boolean;
}

export interface AppSettings {
  autostart: boolean;
  notifications: NotificationSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
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
  return {
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
