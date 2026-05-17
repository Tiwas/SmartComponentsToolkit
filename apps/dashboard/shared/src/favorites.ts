export interface FavoritesStore {
  load(): Promise<string[]>;
  save(flowIds: string[]): Promise<void>;
}

export class LocalStorageFavorites implements FavoritesStore {
  constructor(private readonly key = "homey_dashboard_favorites") {}

  async load(): Promise<string[]> {
    const raw = localStorage.getItem(this.key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  async save(flowIds: string[]): Promise<void> {
    localStorage.setItem(this.key, JSON.stringify(flowIds));
  }
}

export function toggleFavorite(current: string[], flowId: string): string[] {
  const set = new Set(current);
  if (set.has(flowId)) set.delete(flowId);
  else set.add(flowId);
  return [...set];
}
