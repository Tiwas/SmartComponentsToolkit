import { useState } from "react";

export function Login({ onLogin }: { onLogin: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await onLogin();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen-centered">
      <h3 style={{ margin: 0 }}>Sign in to Homey</h3>
      <p className="muted">The system browser will open Athom’s OAuth page.</p>
      <button className="primary" onClick={go} disabled={busy}>
        {busy ? "Waiting for browser…" : "Sign in"}
      </button>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
