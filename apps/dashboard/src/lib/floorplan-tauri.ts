import { invoke } from "@tauri-apps/api/core";
import {
  normalizeFloorplan,
  type FloorplanData,
} from "@homey-toolbox/dashboard-shared";

export async function loadFloorplan(): Promise<FloorplanData> {
  const raw = await invoke<unknown>("load_floorplan");
  return normalizeFloorplan(raw);
}

export async function saveFloorplan(data: FloorplanData): Promise<void> {
  await invoke<void>("save_floorplan", { data });
}
