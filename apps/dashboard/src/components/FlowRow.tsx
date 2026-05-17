import type { Flow } from "@homey-toolbox/dashboard-shared";
import { useI18n } from "../i18n/context";

export function FlowRow({
  flow,
  isFavorite,
  onRun,
  onToggleFavorite,
  onContextMenu,
}: {
  flow: Flow;
  isFavorite: boolean;
  onRun: () => void;
  onToggleFavorite: () => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="flow-row"
      onClick={onRun}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
    >
      <button
        className={`star ${isFavorite ? "on" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        title={isFavorite ? t.fr_remove_fav : t.fr_add_fav}
      >
        {isFavorite ? "★" : "☆"}
      </button>
      <span className="name" title={flow.name}>
        {flow.name}
      </span>
      {flow.kind === "advanced" && <span className="kind">ADV</span>}
    </div>
  );
}
