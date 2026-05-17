import type { AthomCloudAPICtor } from "@homey-toolbox/dashboard-shared";

declare global {
  interface Window {
    AthomCloudAPI?: AthomCloudAPICtor;
    HomeyLibrariesReady?: Promise<void>;
  }
}

export async function getAthomCloudAPI(): Promise<AthomCloudAPICtor> {
  if (window.HomeyLibrariesReady) await window.HomeyLibrariesReady;
  if (!window.AthomCloudAPI) {
    throw new Error("AthomCloudAPI not loaded from CDN. Check network connection.");
  }
  return window.AthomCloudAPI;
}
