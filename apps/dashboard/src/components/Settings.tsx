import { useEffect, useState } from "react";
import {
  enable as enableAutostart,
  disable as disableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  SUPPORTED_LANGUAGES,
  type AppSettings,
  type Language,
} from "@homey-toolbox/dashboard-shared";
import { useI18n } from "../i18n/context";
import { LANGUAGE_LABELS } from "../i18n/strings";

const LINKS = {
  github: "https://github.com/Tiwas/SmartComponentsToolkit",
  docs: "https://tiwas.github.io/SmartComponentsToolkit/",
  homeyStore: "https://homey.app/en-no/app/no.tiwas.booleantoolbox/",
};

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
  const { t } = useI18n();
  const [autostartActual, setAutostartActual] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isAutostartEnabled()
      .then(setAutostartActual)
      .catch((e) => setError(`autostart check failed: ${e}`));
  }, []);

  async function update(
    patch: Partial<AppSettings> | { notifications: Partial<AppSettings["notifications"]> },
  ) {
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
        text: t.settings_test_toast_text,
        durationMs: settings.notifications.durationMs,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="screen settings-screen">
      <div className="settings-header">
        <button className="icon-btn" onClick={onBack} title={t.settings_back}>
          ←
        </button>
        <h3>{t.settings_title}</h3>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="settings-section">
        <div className="settings-row">
          <label className="settings-label" htmlFor="language">
            {t.settings_language}
          </label>
          <select
            id="language"
            value={settings.language}
            onChange={(e) => update({ language: e.target.value as Language })}
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {LANGUAGE_LABELS[lang]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-row">
          <label className="settings-label" htmlFor="autostart">
            {t.settings_autostart}
          </label>
          <input
            id="autostart"
            type="checkbox"
            checked={!import.meta.env.DEV && (autostartActual ?? settings.autostart)}
            disabled={import.meta.env.DEV}
            onChange={(e) => toggleAutostart(e.target.checked)}
          />
        </div>
        <div className="settings-hint">
          {import.meta.env.DEV ? t.settings_autostart_dev_disabled : t.settings_autostart_hint}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t.settings_notifications}</div>
        <div className="settings-row">
          <label className="settings-label" htmlFor="notif-enabled">
            {t.settings_show_toasts}
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
            {t.settings_show_source}
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
            {t.settings_toast_duration}
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
            {t.settings_poll_interval}
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
          {t.settings_test_toast}
        </button>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t.settings_account}</div>
        <div style={{ display: "flex", gap: 6, flexDirection: "column" }}>
          <button className="icon-btn" onClick={onSignOut}>
            {t.settings_sign_out}
          </button>
          <button className="icon-btn" onClick={onResetCredentials}>
            {t.settings_reset_creds}
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t.settings_about}</div>
        <div style={{ display: "flex", gap: 6, flexDirection: "column" }}>
          <button className="link-btn" onClick={() => openUrl(LINKS.homeyStore)}>
            {t.settings_homey_store}
          </button>
          <button className="link-btn" onClick={() => openUrl(LINKS.docs)}>
            {t.settings_docs}
          </button>
          <button className="link-btn" onClick={() => openUrl(LINKS.github)}>
            {t.settings_github}
          </button>
        </div>
      </div>
    </div>
  );
}
