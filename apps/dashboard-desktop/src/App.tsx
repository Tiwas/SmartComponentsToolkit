import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AuthSession,
  HomeyClient,
  type AuthCredentials,
} from "@homey-toolbox/dashboard-shared";
import { Setup } from "./components/Setup";
import { Login } from "./components/Login";
import { Dashboard } from "./components/Dashboard";
import { getAthomCloudAPI } from "./lib/cloud";
import { performLoopbackOAuth, REDIRECT_URL } from "./lib/oauth";
import { clearCredentials, loadCredentials } from "./lib/storage";

type Screen =
  | { kind: "loading" }
  | { kind: "setup" }
  | { kind: "login"; creds: AuthCredentials }
  | { kind: "dashboard"; client: HomeyClient };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    bootstrap().catch((e) => setFatal(e instanceof Error ? e.message : String(e)));
  }, []);

  async function bootstrap() {
    const stored = loadCredentials();
    if (!stored) {
      setScreen({ kind: "setup" });
      return;
    }
    const creds: AuthCredentials = { ...stored, redirectUrl: REDIRECT_URL };
    const AthomCloudAPI = await getAthomCloudAPI();
    const session = new AuthSession({ AthomCloudAPI, credentials: creds });
    if (await session.isLoggedIn()) {
      const client = await HomeyClient.connect(session);
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
    const client = await HomeyClient.connect(session);
    setScreen({ kind: "dashboard", client });
  }

  async function handleLogout() {
    setFatal(null);
    // AthomCloudAPI's known token keys (mirrors docs/tools/flow-doctor.html:623).
    [
      "homey-api",
      "homey_api_key",
      "homey_access_token",
      "homey_refresh_token",
      "athom_access_token",
      "athom_refresh_token",
      "athom_token_expires_at",
    ].forEach((k) => localStorage.removeItem(k));
    // Catch anything else Athom/Homey-related we might have missed.
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

  return (
    <>
      <div className="titlebar">
        <span>Smart Toolkit Widget</span>
        <div className="actions">
          <button className="icon-btn" onClick={handleLogout} title="Sign out (keep credentials)">
            ⎋
          </button>
          <button
            className="icon-btn"
            onClick={handleResetCredentials}
            title="Reset OAuth credentials"
          >
            ⚙
          </button>
          <button
            className="icon-btn close-btn"
            onClick={() => getCurrentWindow().close()}
            title="Close"
          >
            ×
          </button>
        </div>
      </div>

      {fatal && <div className="screen-centered error">{fatal}</div>}

      {!fatal && screen.kind === "loading" && <div className="screen-centered muted">Loading…</div>}
      {!fatal && screen.kind === "setup" && <Setup onSaved={() => bootstrap()} />}
      {!fatal && screen.kind === "login" && <Login onLogin={handleLogin} />}
      {!fatal && screen.kind === "dashboard" && (
        <Dashboard client={screen.client} onLogout={handleLogout} />
      )}
    </>
  );
}
