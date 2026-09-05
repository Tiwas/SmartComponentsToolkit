export type LegacyStorage = Pick<Storage, "getItem" | "removeItem" | "key" | "length">;

export type StoredCredentials = { clientId: string; clientSecret: string };

export const LEGACY_CREDENTIAL_KEYS = {
  clientId: "dashboard_client_id",
  clientSecret: "dashboard_client_secret",
} as const;

export const LEGACY_CLOUD_STORE_KEY = "homey-api";

const LEGACY_TOKEN_KEYS = [
  "homey_api_key",
  "homey_access_token",
  "homey_refresh_token",
  "athom_access_token",
  "athom_refresh_token",
  "athom_token_expires_at",
];

export function readLegacyCredentials(storage: Pick<Storage, "getItem">): StoredCredentials | null {
  const clientId = storage.getItem(LEGACY_CREDENTIAL_KEYS.clientId);
  const clientSecret = storage.getItem(LEGACY_CREDENTIAL_KEYS.clientSecret);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function legacySensitiveKeys(storage: LegacyStorage): string[] {
  const keys = new Set([
    LEGACY_CREDENTIAL_KEYS.clientId,
    LEGACY_CREDENTIAL_KEYS.clientSecret,
    LEGACY_CLOUD_STORE_KEY,
    ...LEGACY_TOKEN_KEYS,
  ]);
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && /^(?:homey|athom)[-_].*(?:token|session|api[-_]?key|expires)/i.test(key)) {
      keys.add(key);
    }
  }
  return [...keys];
}

export function clearLegacySensitiveStorage(storage: LegacyStorage): void {
  legacySensitiveKeys(storage).forEach((key) => storage.removeItem(key));
}

export function hasLegacySensitiveStorage(storage: LegacyStorage): boolean {
  return legacySensitiveKeys(storage).some((key) => storage.getItem(key) !== null);
}

export async function migrateLegacyAuth(
  storage: LegacyStorage,
  secure: {
    saveCredentials(credentials: StoredCredentials): Promise<void>;
    loadCloudStore(): Promise<string | null>;
    saveCloudStore(value: string): Promise<void>;
  },
  copyCredentials = true,
): Promise<void> {
  const credentials = readLegacyCredentials(storage);
  if (copyCredentials && credentials) await secure.saveCredentials(credentials);

  const legacyCloudStore = storage.getItem(LEGACY_CLOUD_STORE_KEY);
  if (legacyCloudStore) {
    const secureCloudStore = await secure.loadCloudStore();
    if (!secureCloudStore || secureCloudStore === "{}") await secure.saveCloudStore(legacyCloudStore);
  }

  clearLegacySensitiveStorage(storage);
}
