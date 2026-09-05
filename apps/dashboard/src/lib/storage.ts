import { invoke } from "@tauri-apps/api/core";
import type { AthomCloudAPICtor, AthomStorageAdapter } from "@homey-toolbox/dashboard-shared";
import {
  clearLegacySensitiveStorage,
  hasLegacySensitiveStorage,
  migrateLegacyAuth,
  type StoredCredentials,
} from "./legacy-auth-storage";

async function migrateLegacyStorage(copyCredentials: boolean): Promise<void> {
  await migrateLegacyAuth(localStorage, {
    saveCredentials: async ({ clientId, clientSecret }) => {
      await invoke("save_oauth_credentials", { clientId, clientSecret });
    },
    loadCloudStore: () => invoke<string | null>("load_cloud_store"),
    saveCloudStore: (value) => invoke("save_cloud_store", { value }),
  }, copyCredentials);
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  const stored = await invoke<StoredCredentials | null>("load_oauth_credentials");
  // Always clear any legacy WebView token after the first version using the
  // keychain, including a previously interrupted migration.
  if (!stored || hasLegacySensitiveStorage(localStorage)) await migrateLegacyStorage(!stored);
  return stored ?? invoke<StoredCredentials | null>("load_oauth_credentials");
}

export async function saveCredentials(clientId: string, clientSecret: string): Promise<void> {
  await invoke("save_oauth_credentials", { clientId, clientSecret });
  clearLegacySensitiveStorage(localStorage);
}

export async function clearCredentials(): Promise<void> {
  await invoke("clear_oauth_credentials");
  clearLegacySensitiveStorage(localStorage);
}

export async function clearCloudStore(): Promise<void> {
  await invoke("clear_cloud_store");
  clearLegacySensitiveStorage(localStorage);
}

export function createSecureCloudStorage(AthomCloudAPI: AthomCloudAPICtor): AthomStorageAdapter {
  const BaseStorageAdapter = AthomCloudAPI.StorageAdapter;
  return new (class extends BaseStorageAdapter {
    async get(): Promise<object> {
      const raw = await invoke<string | null>("load_cloud_store");
      if (!raw) return {};
      try {
        return JSON.parse(raw) as object;
      } catch {
        // A corrupt credential is not usable; do not expose it to the SDK.
        await invoke("clear_cloud_store");
        return {};
      }
    }

    async set(value: object): Promise<void> {
      await invoke("save_cloud_store", { value: JSON.stringify(value) });
    }
  })();
}
