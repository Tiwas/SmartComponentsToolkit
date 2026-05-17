import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  EMPTY_FLOORPLAN,
  HomeyClient,
  validateSvg,
  type FloorplanData,
} from "@homey-toolbox/dashboard-shared";
import { loadFloorplan, saveFloorplan } from "../lib/floorplan-tauri";
import { useI18n } from "../i18n/context";

const EDITOR_HINT_URL = "https://tiwas.github.io/SmartComponentsToolkit/tools/floorplan-editor.html";

export function Floorplan({
  client: _client,
  onLogout,
  onOpenSettings,
}: {
  client: HomeyClient;
  onLogout: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<FloorplanData>(EMPTY_FLOORPLAN);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadFloorplan()
      .then(setData)
      .catch((e) => console.warn("[dashboard] loadFloorplan failed:", e))
      .finally(() => setLoading(false));
  }, []);

  async function persist(next: FloorplanData) {
    setData(next);
    try {
      await saveFloorplan(next);
    } catch (e) {
      console.warn("[dashboard] saveFloorplan failed:", e);
    }
  }

  return (
    <>
      <div className="tabs">
        <span className="tab active" style={{ cursor: "default" }}>
          {t.floorplan_title}
        </span>
        <div style={{ flex: 1 }} />
        <button className="tab" onClick={() => setShowImport(true)} title={t.floorplan_import}>
          ⤓
        </button>
        <button className="tab" onClick={onOpenSettings} title={t.tab_settings}>
          ⚙
        </button>
        <button className="tab" onClick={onLogout} title={t.settings_sign_out}>
          ⎋
        </button>
      </div>

      <div className="floorplan-stage" ref={containerRef}>
        {loading ? (
          <div className="muted">{t.loading}</div>
        ) : data.svg ? (
          <div
            className="floorplan-svg"
            dangerouslySetInnerHTML={{ __html: data.svg }}
          />
        ) : (
          <div className="floorplan-empty">
            <h3>{t.floorplan_empty_title}</h3>
            <p className="muted">{t.floorplan_empty_hint}</p>
            <button className="primary" onClick={() => setShowImport(true)}>
              {t.floorplan_import}
            </button>
            <button
              className="link-btn"
              style={{ marginTop: 12 }}
              onClick={() => openUrl(EDITOR_HINT_URL)}
            >
              {t.floorplan_open_editor} →
            </button>
          </div>
        )}
      </div>

      {showImport && (
        <ImportFloorplanModal
          onClose={() => setShowImport(false)}
          onImported={(svg) => {
            persist({ ...data, svg });
            setShowImport(false);
          }}
        />
      )}
    </>
  );
}

function ImportFloorplanModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (svg: string) => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"file" | "paste">("file");
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus the textarea every time the paste tab becomes active. This
  // also recovers focus after the window is minimized and restored, which
  // sometimes leaves the previous element in a focus-stuck state in WebView2.
  useEffect(() => {
    if (tab === "paste") {
      const id = window.setTimeout(() => textareaRef.current?.focus(), 30);
      return () => window.clearTimeout(id);
    }
  }, [tab]);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result = validateSvg(text);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onImported(result.svg);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handlePaste() {
    setError(null);
    const result = validateSvg(pasted);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onImported(result.svg);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 360 }}>
        <div className="modal-title">{t.floorplan_import}</div>
        <div className="tabs" style={{ marginBottom: 8 }}>
          <button
            className={`tab ${tab === "file" ? "active" : ""}`}
            onClick={() => setTab("file")}
            type="button"
          >
            {t.floorplan_import_file}
          </button>
          <button
            className={`tab ${tab === "paste" ? "active" : ""}`}
            onClick={() => setTab("paste")}
            type="button"
          >
            {t.floorplan_import_paste}
          </button>
        </div>

        {tab === "file" ? (
          <input
            key="file-input"
            type="file"
            accept=".svg,image/svg+xml"
            onChange={handleFile}
          />
        ) : (
          <>
            <textarea
              key="paste-textarea"
              ref={textareaRef}
              rows={8}
              placeholder="<svg …>…</svg>"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                fontFamily: "monospace",
                fontSize: 11,
                background: "rgba(255,255,255,0.04)",
                color: "var(--fg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: 8,
                resize: "vertical",
                pointerEvents: "auto",
              }}
            />
            <div className="modal-actions">
              <button type="button" className="icon-btn" onClick={onClose}>
                {t.modal_cancel}
              </button>
              <button type="button" className="primary" onClick={handlePaste} disabled={!pasted.trim()}>
                {t.floorplan_import_apply}
              </button>
            </div>
          </>
        )}

        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
