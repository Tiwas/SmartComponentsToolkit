import assert from "node:assert/strict";
import {
  LEGACY_CLOUD_STORE_KEY,
  LEGACY_CREDENTIAL_KEYS,
  hasLegacySensitiveStorage,
  legacySensitiveKeys,
  migrateLegacyAuth,
  type LegacyStorage,
} from "../../src/lib/legacy-auth-storage.js";

class MemoryStorage implements LegacyStorage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const storage = new MemoryStorage();
storage.setItem(LEGACY_CREDENTIAL_KEYS.clientId, "client-id");
storage.setItem(LEGACY_CREDENTIAL_KEYS.clientSecret, "client-secret");
storage.setItem(LEGACY_CLOUD_STORE_KEY, '{"token":{"access_token":"secret"}}');
storage.setItem("athom_session", "secret");
storage.setItem("homey_dashboard_favorites", '["safe-public-preference"]');

assert.deepEqual(
  new Set(legacySensitiveKeys(storage)),
  new Set([
    LEGACY_CREDENTIAL_KEYS.clientId,
    LEGACY_CREDENTIAL_KEYS.clientSecret,
    LEGACY_CLOUD_STORE_KEY,
    "homey_api_key",
    "homey_access_token",
    "homey_refresh_token",
    "athom_access_token",
    "athom_refresh_token",
    "athom_token_expires_at",
    "athom_session",
  ]),
);
assert.equal(hasLegacySensitiveStorage(storage), true);

let savedCredentials: { clientId: string; clientSecret: string } | undefined;
let savedCloudStore: string | undefined;
await migrateLegacyAuth(storage, {
  saveCredentials: async (credentials) => {
    savedCredentials = credentials;
  },
  loadCloudStore: async () => null,
  saveCloudStore: async (value) => {
    savedCloudStore = value;
  },
});

assert.deepEqual(savedCredentials, { clientId: "client-id", clientSecret: "client-secret" });
assert.equal(savedCloudStore, '{"token":{"access_token":"secret"}}');
assert.equal(storage.getItem(LEGACY_CREDENTIAL_KEYS.clientId), null);
assert.equal(storage.getItem(LEGACY_CLOUD_STORE_KEY), null);
assert.equal(storage.getItem("homey_dashboard_favorites"), '["safe-public-preference"]');
assert.equal(hasLegacySensitiveStorage(storage), false);

const interruptedMigration = new MemoryStorage();
interruptedMigration.setItem(LEGACY_CREDENTIAL_KEYS.clientId, "stale-client-id");
interruptedMigration.setItem(LEGACY_CREDENTIAL_KEYS.clientSecret, "stale-client-secret");
interruptedMigration.setItem(LEGACY_CLOUD_STORE_KEY, '{"token":{"access_token":"legacy"}}');
let overwrittenCredentials = false;
await migrateLegacyAuth(
  interruptedMigration,
  {
    saveCredentials: async () => {
      overwrittenCredentials = true;
    },
    loadCloudStore: async () => '{"token":{"access_token":"secure"}}',
    saveCloudStore: async () => {
      throw new Error("an existing secure token must not be overwritten");
    },
  },
  false,
);
assert.equal(overwrittenCredentials, false);
assert.equal(hasLegacySensitiveStorage(interruptedMigration), false);
console.log("OK — legacy auth storage migration assertions passed");
