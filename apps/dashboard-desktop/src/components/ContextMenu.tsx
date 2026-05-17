import { useEffect } from "react";

export type ContextMenuEntry =
  | { kind: "item"; label: string; onClick: () => void; disabled?: boolean }
  | { kind: "header"; label: string }
  | { kind: "divider" };

export type ContextMenuItem = ContextMenuEntry;

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}) {
  useEffect(() => {
    const off = () => onClose();
    window.addEventListener("click", off);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("click", off);
      window.removeEventListener("blur", off);
    };
  }, [onClose]);

  return (
    <div className="context-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      {items.map((entry, i) => {
        if (entry.kind === "divider") return <div key={i} className="context-menu-divider" />;
        if (entry.kind === "header")
          return (
            <div key={i} className="context-menu-header">
              {entry.label}
            </div>
          );
        return (
          <div
            key={i}
            className="context-menu-item"
            style={entry.disabled ? { opacity: 0.4, pointerEvents: "none" } : undefined}
            onClick={() => {
              if (entry.disabled) return;
              entry.onClick();
              onClose();
            }}
          >
            {entry.label}
          </div>
        );
      })}
    </div>
  );
}
