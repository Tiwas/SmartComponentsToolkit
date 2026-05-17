import { useState } from "react";
import { saveCredentials } from "../lib/storage";
import { REDIRECT_URL } from "../lib/oauth";

export function Setup({ onSaved }: { onSaved: () => void }) {
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
      <h3 style={{ margin: 0 }}>Connect your Homey</h3>
      <p className="muted">
        Create an OAuth application at <code>developer.athom.com</code> and paste the credentials
        here. Add this redirect URL to your app:
      </p>
      <input type="text" readOnly value={REDIRECT_URL} onClick={(e) => e.currentTarget.select()} />
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input
          type="text"
          placeholder="Client ID"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <input
          type="password"
          placeholder="Client Secret"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
        <button className="primary" type="submit">
          Save
        </button>
      </form>
    </div>
  );
}
