import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  register as registerShortcut,
  unregister as unregisterShortcut,
  isRegistered,
} from "@tauri-apps/plugin-global-shortcut";
import {
  AuthSession,
  DEFAULT_SETTINGS,
  defaultLanguage,
  HomeyClient,
  type AppSettings,
  type AuthCredentials,
  type HotzoneEdge,
} from "@homey-toolbox/dashboard-shared";
import { Setup } from "./components/Setup";
import { Login } from "./components/Login";
import { Dashboard } from "./components/Dashboard";
import { Settings } from "./components/Settings";
import { getAthomCloudAPI } from "./lib/cloud";
import { performLoopbackOAuth, REDIRECT_URL } from "./lib/oauth";
import { clearCredentials, loadCredentials } from "./lib/storage";
import { loadSettings, saveSettings } from "./lib/settings-tauri";
import { I18nProvider, useI18n } from "./i18n/context";

type Screen =
  | { kind: "loading" }
  | { kind: "setup" }
  | { kind: "login"; creds: AuthCredentials }
  | { kind: "dashboard"; client: HomeyClient }
  | { kind: "settings"; client: HomeyClient };

export function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  return (
    <I18nProvider lang={settings.language}>
      <AppInner settings={settings} setSettings={setSettings} />
    </I18nProvider>
  );
}

const HOTZONE_EDGE_TO_INT: Record<HotzoneEdge, number> = {
  off: 0,
  left: 1,
  right: 2,
  top: 3,
  bottom: 4,
};

function AppInner({
  settings,
  setSettings,
}: {
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
}) {
  const { t } = useI18n();
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [fatal, setFatal] = useState<string | null>(null);
  const [homeys, setHomeys] = useState<Array<{ id: string; name: string }>>([]);
  const [activeShortcut, setActiveShortcut] = useState<string>("");

  useEffect(() => {
    bootstrap().catch((e) => setFatal(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push hotzone edge into Rust whenever the setting changes.
  useEffect(() => {
    invoke("set_hotzone_edge", { edge: HOTZONE_EDGE_TO_INT[settings.hotzone] }).catch((e) =>
      console.warn("[dashboard] set_hotzone_edge failed:", e),
    );
  }, [settings.hotzone]);

  // Listen for hotzone triggers from Rust. If the widget was already visible
  // we just focus it. If it was hidden, we show it and start a recurring
  // auto-hide check: after `hotzoneAutoHideSec` seconds, if the cursor is
  // currently over the widget we restart the check (5s re-checks); if not,
  // we hide. So the widget stays as long as you keep your cursor on it.
  useEffect(() => {
    const initialSec = settings.hotzoneAutoHideSec;
    const recheckSec = 5;
    let activeTimer: number | null = null;

    function clearTimer() {
      if (activeTimer !== null) {
        window.clearTimeout(activeTimer);
        activeTimer = null;
      }
    }

    function scheduleCheck(delayMs: number, win: ReturnType<typeof getCurrentWindow>) {
      activeTimer = window.setTimeout(() => {
        activeTimer = null;
        const hovered = document.body.matches(":hover");
        if (hovered) {
          scheduleCheck(recheckSec * 1000, win);
        } else {
          win.hide().catch(() => {});
        }
      }, delayMs);
    }

    const promise = listen<number>("hotzone-trigger", async () => {
      try {
        const win = getCurrentWindow();
        const wasVisible = await win.isVisible();
        await win.show();
        await win.setFocus();
        if (wasVisible) return;
        clearTimer();
        scheduleCheck(initialSec * 1000, win);
      } catch (e) {
        console.warn("[dashboard] show on hotzone failed:", e);
      }
    });
    return () => {
      promise.then((unlisten) => unlisten()).catch(() => {});
      clearTimer();
    };
  }, [settings.hotzoneAutoHideSec]);

  // (Re-)register the global shortcut whenever the setting changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (activeShortcut && activeShortcut !== settings.hotkey) {
          if (await isRegistered(activeShortcut)) await unregisterShortcut(activeShortcut);
        }
        const next = settings.hotkey.trim();
        if (!next) {
          if (!cancelled) setActiveShortcut("");
          return;
        }
        if (!(await isRegistered(next))) {
          await registerShortcut(next, async () => {
            await invoke("toggle_window");
          });
        }
        if (!cancelled) setActiveShortcut(next);
      } catch (e) {
        console.warn("[dashboard] hotkey register failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.hotkey, activeShortcut]);

  async function bootstrap() {
    const [stored, loadedSettings] = await Promise.all([
      Promise.resolve(loadCredentials()),
      loadSettings().catch(() => null),
    ]);
    const effective = loadedSettings
      ? loadedSettings
      : { ...DEFAULT_SETTINGS, language: defaultLanguage(navigator.language) };
    setSettings(effective);
    if (!loadedSettings) saveSettings(effective).catch(() => {});

    if (!stored) {
      setScreen({ kind: "setup" });
      return;
    }
    const creds: AuthCredentials = { ...stored, redirectUrl: REDIRECT_URL };
    const AthomCloudAPI = await getAthomCloudAPI();
    const session = new AuthSession({ AthomCloudAPI, credentials: creds });
    if (await session.isLoggedIn()) {
      const homeyList = await HomeyClient.listHomeys(session).catch(() => []);
      setHomeys(homeyList);
      const client = await HomeyClient.connect(session, effective.homeyId || undefined);
      // If settings.homeyId was empty, persist the actual one we connected to
      // so the user has something selectable later.
      if (!effective.homeyId && client.homey.id) {
        const next = { ...effective, homeyId: client.homey.id };
        setSettings(next);
        saveSettings(next).catch(() => {});
      }
      setScreen({ kind: "dashboard", client });
    } else {
      setScreen({ kind: "login", creds });
    }
  }

  async function handleLogin() {
    if (screen.kind !== "login") return;
    const code = await performLoopbackOAuth({
      clientId: screen.creds.clientId,
      clientSecret: screen.creds.clientSecret,
    });
    const AthomCloudAPI = await getAthomCloudAPI();
    const session = new AuthSession({ AthomCloudAPI, credentials: screen.creds });
    await session.exchangeCode(code);
    const homeyList = await HomeyClient.listHomeys(session).catch(() => []);
    setHomeys(homeyList);
    const client = await HomeyClient.connect(session, settings.homeyId || undefined);
    setScreen({ kind: "dashboard", client });
  }

  async function handleLogout() {
    setFatal(null);
    [
      "homey-api",
      "homey_api_key",
      "homey_access_token",
      "homey_refresh_token",
      "athom_access_token",
      "athom_refresh_token",
      "athom_token_expires_at",
    ].forEach((k) => localStorage.removeItem(k));
    Object.keys(localStorage)
      .filter((k) => /^(homey|athom)[-_]/i.test(k))
      .forEach((k) => localStorage.removeItem(k));
    const stored = loadCredentials();
    setScreen(
      stored
        ? { kind: "login", creds: { ...stored, redirectUrl: REDIRECT_URL } }
        : { kind: "setup" },
    );
  }

  function handleResetCredentials() {
    setFatal(null);
    clearCredentials();
    handleLogout();
  }

  async function persistSettings(next: AppSettings) {
    setSettings(next);
    try {
      await saveSettings(next);
    } catch (e) {
      console.warn("[dashboard] saveSettings failed:", e);
    }
  }

  function openSettings() {
    if (screen.kind === "dashboard") {
      setScreen({ kind: "settings", client: screen.client });
    }
  }

  function backToDashboard() {
    if (screen.kind === "settings") {
      setScreen({ kind: "dashboard", client: screen.client });
    }
  }

  return (
    <>
      <div className="titlebar">
        <span>Smart (Components) Toolkit Widget</span>
        <div className="actions">
          <button
            className="icon-btn close-btn"
            onClick={() => getCurrentWindow().close()}
            title={t.tb_close}
          >
            ×
          </button>
        </div>
      </div>

      {fatal && <div className="screen-centered error">{fatal}</div>}

      {!fatal && screen.kind === "loading" && (
        <div className="screen-centered muted">{t.loading}</div>
      )}
      {!fatal && screen.kind === "setup" && <Setup onSaved={() => bootstrap()} />}
      {!fatal && screen.kind === "login" && <Login onLogin={handleLogin} />}
      {!fatal && screen.kind === "dashboard" && (
        <Dashboard
          client={screen.client}
          settings={settings}
          onLogout={handleLogout}
          onOpenSettings={openSettings}
        />
      )}
      {!fatal && screen.kind === "settings" && (
        <Settings
          settings={settings}
          homeys={homeys}
          onChange={persistSettings}
          onBack={backToDashboard}
          onResetCredentials={handleResetCredentials}
          onSignOut={handleLogout}
        />
      )}
    </>
  );
}
