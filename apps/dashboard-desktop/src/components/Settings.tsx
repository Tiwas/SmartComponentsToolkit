import { useEffect, useState } from "react";
import { enable as enableAutostart, disable as disableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "@homey-toolbox/dashboard-shared";

export function Settings({
  settings,
  onChange,
  onBack,
  onResetCredentials,
  onSignOut,
}: {
  settings: AppSettings;
  onChange: (next: AppSettings) => Promise<void>;
  onBack: () => void;
  onResetCredentials: () => void;
  onSignOut: () => void;
}) {
  const [autostartActual, setAutostartActual] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isAutostartEnabled()
      .then(setAutostartActual)
      .catch((e) => setError(`autostart check failed: ${e}`));
  }, []);

  async function update(patch: Partial<AppSettings> | { notifications: Partial<AppSettings["notifications"]> }) {
    const next: AppSettings = {
      ...settings,
      ...patch,
      notifications: {
        ...settings.notifications,
        ...("notifications" in patch ? patch.notifications : {}),
      },
    };
    await onChange(next);
  }

  async function toggleAutostart(enabled: boolean) {
    setError(null);
    try {
      if (enabled) await enableAutostart();
      else await disableAutostart();
      const actual = await isAutostartEnabled();
      setAutostartActual(actual);
      await update({ autostart: actual });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function testToast() {
    try {
      await invoke("show_toast", {
        text: "Test toast — this is what notifications will look like",
        durationMs: settings.notifications.durationMs,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="screen settings-screen">
      <div className="settings-header">
        <button className="icon-btn" onClick={onBack} title="Back">
          ←
        </button>
        <h3>Settings</h3>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="settings-section">
        <div className="settings-row">
          <label className="settings-label" htmlFor="autostart">
            Start with system
          </label>
          <input
            id="autostart"
            type="checkbox"
            checked={autostartActual ?? settings.autostart}
            onChange={(e) => toggleAutostart(e.target.checked)}
          />
        </div>
        <div className="settings-hint">
          When enabled, the widget launches automatically when you sign in to your computer.
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Notifications</div>
        <div className="settings-row">
          <label className="settings-label" htmlFor="notif-enabled">
            Show toasts
          </label>
          <input
            id="notif-enabled"
            type="checkbox"
            checked={settings.notifications.enabled}
            onChange={(e) => update({ notifications: { enabled: e.target.checked } })}
          />
        </div>

        <div className="settings-row">
          <label className="settings-label" htmlFor="notif-source">
            Show source ("Flow — …")
          </label>
          <input
            id="notif-source"
            type="checkbox"
            checked={settings.notifications.showSource}
            onChange={(e) => update({ notifications: { showSource: e.target.checked } })}
          />
        </div>

        <div className="settings-row">
          <label className="settings-label" htmlFor="notif-duration">
            Toast duration (seconds)
          </label>
          <input
            id="notif-duration"
            type="number"
            min={1}
            max={60}
            step={1}
            value={Math.round(settings.notifications.durationMs / 1000)}
            onChange={(e) => {
              const sec = Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 6));
              update({ notifications: { durationMs: sec * 1000 } });
            }}
            style={{ width: 64 }}
          />
        </div>

        <div className="settings-row">
          <label className="settings-label" htmlFor="notif-interval">
            Poll interval (seconds)
          </label>
          <input
            id="notif-interval"
            type="number"
            min={3}
            max={300}
            step={1}
            value={settings.notifications.pollIntervalSec}
            onChange={(e) => {
              const sec = Math.max(3, Math.min(300, parseInt(e.target.value, 10) || 10));
              update({ notifications: { pollIntervalSec: sec } });
            }}
            style={{ width: 64 }}
          />
        </div>

        <button className="icon-btn" onClick={testToast} style={{ marginTop: 6 }}>
          Send test toast
        </button>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Account</div>
        <div style={{ display: "flex", gap: 6, flexDirection: "column" }}>
          <button className="icon-btn" onClick={onSignOut}>
            Sign out (keep credentials)
          </button>
          <button className="icon-btn" onClick={onResetCredentials}>
            Reset OAuth credentials
          </button>
        </div>
      </div>
    </div>
  );
}
