export interface FavoriteFolder {
  id: string;
  name: string;
  flowIds: string[];
}

export interface FavoritesData {
  /** Favorites not inside any custom folder ("Quick" group). */
  flowIds: string[];
  folders: FavoriteFolder[];
}

export const EMPTY_FAVORITES: FavoritesData = { flowIds: [], folders: [] };

/**
 * Coerce any persisted blob (including the legacy `string[]` shape) into the
 * current FavoritesData structure. Drops any malformed entries silently.
 */
export function normalizeFavoritesData(raw: unknown): FavoritesData {
  if (raw == null) return { flowIds: [], folders: [] };
  if (Array.isArray(raw)) {
    return { flowIds: raw.filter((x): x is string => typeof x === "string"), folders: [] };
  }
  if (typeof raw !== "object") return { flowIds: [], folders: [] };
  const obj = raw as Record<string, unknown>;
  const flowIds = Array.isArray(obj.flowIds)
    ? obj.flowIds.filter((x): x is string => typeof x === "string")
    : [];
  const folders = Array.isArray(obj.folders)
    ? (obj.folders.map(normalizeFolder).filter((f) => f !== null) as FavoriteFolder[])
    : [];
  return { flowIds, folders };
}

function normalizeFolder(raw: unknown): FavoriteFolder | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== "string" || typeof obj.name !== "string") return null;
  const flowIds = Array.isArray(obj.flowIds)
    ? obj.flowIds.filter((x): x is string => typeof x === "string")
    : [];
  return { id: obj.id, name: obj.name, flowIds };
}

export function isFavorite(data: FavoritesData, flowId: string): boolean {
  if (data.flowIds.includes(flowId)) return true;
  return data.folders.some((f) => f.flowIds.includes(flowId));
}

/** Removes the flow from every list. */
function removeFlowEverywhere(data: FavoritesData, flowId: string): FavoritesData {
  return {
    flowIds: data.flowIds.filter((id) => id !== flowId),
    folders: data.folders.map((f) => ({ ...f, flowIds: f.flowIds.filter((id) => id !== flowId) })),
  };
}

/** Adds flow to the ungrouped "Quick" list. No-op if already in any group. */
export function addFavorite(data: FavoritesData, flowId: string): FavoritesData {
  if (isFavorite(data, flowId)) return data;
  return { ...data, flowIds: [...data.flowIds, flowId] };
}

export function removeFavorite(data: FavoritesData, flowId: string): FavoritesData {
  return removeFlowEverywhere(data, flowId);
}

/** Moves a flow to the ungrouped "Quick" list. If folderId is provided, moves into that folder. */
export function moveFavorite(
  data: FavoritesData,
  flowId: string,
  folderId: string | null,
): FavoritesData {
  const cleaned = removeFlowEverywhere(data, flowId);
  if (folderId === null) {
    return { ...cleaned, flowIds: [...cleaned.flowIds, flowId] };
  }
  return {
    ...cleaned,
    folders: cleaned.folders.map((f) =>
      f.id === folderId ? { ...f, flowIds: [...f.flowIds, flowId] } : f,
    ),
  };
}

export function createFolder(data: FavoritesData, name: string): FavoritesData {
  const trimmed = name.trim();
  if (!trimmed) return data;
  const id = `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return { ...data, folders: [...data.folders, { id, name: trimmed, flowIds: [] }] };
}

export function renameFolder(data: FavoritesData, folderId: string, name: string): FavoritesData {
  const trimmed = name.trim();
  if (!trimmed) return data;
  return {
    ...data,
    folders: data.folders.map((f) => (f.id === folderId ? { ...f, name: trimmed } : f)),
  };
}

export function deleteFolder(data: FavoritesData, folderId: string): FavoritesData {
  const target = data.folders.find((f) => f.id === folderId);
  if (!target) return data;
  // Move its flows back to the ungrouped "Quick" list rather than dropping them.
  return {
    flowIds: [...data.flowIds, ...target.flowIds],
    folders: data.folders.filter((f) => f.id !== folderId),
  };
}
