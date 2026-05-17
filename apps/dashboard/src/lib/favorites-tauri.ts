import { invoke } from "@tauri-apps/api/core";
import {
  normalizeFavoritesData,
  type FavoritesData,
} from "@homey-toolbox/dashboard-shared";

export async function loadFavorites(): Promise<FavoritesData> {
  const raw = await invoke<unknown>("load_favorites");
  return normalizeFavoritesData(raw);
}

export async function saveFavorites(data: FavoritesData): Promise<void> {
  await invoke<void>("save_favorites", { data });
}
