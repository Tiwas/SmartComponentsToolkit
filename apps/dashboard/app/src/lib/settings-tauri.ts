import { invoke } from "@tauri-apps/api/core";
import {
  normalizeSettings,
  type AppSettings,
} from "@homey-toolbox/dashboard-shared";

export async function loadSettings(): Promise<AppSettings> {
  const raw = await invoke<unknown>("load_settings");
  return normalizeSettings(raw);
}

export async function saveSettings(data: AppSettings): Promise<void> {
  await invoke<void>("save_settings", { data });
}
