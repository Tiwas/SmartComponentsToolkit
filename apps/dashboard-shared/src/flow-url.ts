import type { Flow } from "./types.js";

export function flowEditorUrl(homeyId: string, flow: Pick<Flow, "id" | "kind">): string {
  const base = `https://my.homey.app/homeys/${homeyId}`;
  return flow.kind === "advanced"
    ? `${base}/flows/advanced/${flow.id}`
    : `${base}/flows/${flow.id}`;
}
