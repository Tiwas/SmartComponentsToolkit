const KEYS = {
  clientId: "dashboard_client_id",
  clientSecret: "dashboard_client_secret",
  favorites: "homey_dashboard_favorites",
} as const;

export function loadCredentials(): { clientId: string; clientSecret: string } | null {
  const id = localStorage.getItem(KEYS.clientId);
  const secret = localStorage.getItem(KEYS.clientSecret);
  if (!id || !secret) return null;
  return { clientId: id, clientSecret: secret };
}

export function saveCredentials(clientId: string, clientSecret: string): void {
  localStorage.setItem(KEYS.clientId, clientId);
  localStorage.setItem(KEYS.clientSecret, clientSecret);
}

export function clearCredentials(): void {
  localStorage.removeItem(KEYS.clientId);
  localStorage.removeItem(KEYS.clientSecret);
}
