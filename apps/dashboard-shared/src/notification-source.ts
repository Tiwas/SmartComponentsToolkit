export interface NameLookups {
  device?(id: string): string | undefined;
  app?(id: string): string | undefined;
}

/**
 * Build a human-readable source label for a Homey notification ownerUri.
 *
 * Examples:
 *   "homey:manager:flow"             → "Flow"
 *   "homey:manager:notifications"    → "Notifications"
 *   "homey:device:abc123"            → "Stuelyset"           (if lookups.device returns it)
 *                                    → "Device"              (fallback)
 *   "homey:app:com.example.weather"  → "Weather"             (if lookups.app returns it)
 *                                    → "App com.example..."  (fallback)
 */
export function formatOwnerUri(
  uri: string | undefined,
  lookups: NameLookups = {},
): string | null {
  if (!uri) return null;

  const mgr = uri.match(/^homey:manager:([^:]+)/i);
  if (mgr) {
    const name = mgr[1]!;
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  const device = uri.match(/^homey:device:([^:]+)/i);
  if (device) {
    const id = device[1]!;
    return lookups.device?.(id) ?? "Device";
  }

  const app = uri.match(/^homey:app:([^:]+)/i);
  if (app) {
    const id = app[1]!;
    return lookups.app?.(id) ?? `App ${id}`;
  }

  return uri;
}
