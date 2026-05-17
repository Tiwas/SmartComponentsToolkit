import { useState } from "react";
import { useI18n } from "../i18n/context";

export function Login({ onLogin }: { onLogin: () => Promise<void> }) {
  const { t } = useI18n();
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
      <h3 style={{ margin: 0 }}>{t.login_title}</h3>
      <p className="muted">{t.login_hint}</p>
      <button className="primary" onClick={go} disabled={busy}>
        {busy ? t.login_waiting : t.login_button}
      </button>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
