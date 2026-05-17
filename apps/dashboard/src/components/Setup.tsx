import { useState } from "react";
import { saveCredentials } from "../lib/storage";
import { REDIRECT_URL } from "../lib/oauth";
import { useI18n } from "../i18n/context";

export function Setup({ onSaved }: { onSaved: () => void }) {
  const { t } = useI18n();
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!id.trim() || !secret.trim()) return;
    saveCredentials(id.trim(), secret.trim());
    onSaved();
  }

  return (
    <div className="screen-centered">
      <h3 style={{ margin: 0 }}>{t.setup_title}</h3>
      <p className="muted">{t.setup_intro}</p>
      <input type="text" readOnly value={REDIRECT_URL} onClick={(e) => e.currentTarget.select()} />
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input
          type="text"
          placeholder={t.setup_client_id}
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <input
          type="password"
          placeholder={t.setup_client_secret}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
        <button className="primary" type="submit">
          {t.setup_save}
        </button>
      </form>
    </div>
  );
}
