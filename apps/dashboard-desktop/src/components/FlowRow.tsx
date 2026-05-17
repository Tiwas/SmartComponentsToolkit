import type { Flow } from "@homey-toolbox/dashboard-shared";

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
        title={isFavorite ? "Remove from favorites" : "Add to favorites"}
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
