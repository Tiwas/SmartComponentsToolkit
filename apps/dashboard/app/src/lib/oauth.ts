import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { buildAuthorizeUrl, type AuthCredentials } from "@homey-toolbox/dashboard-shared";

export const REDIRECT_PORT = 53117;
export const REDIRECT_URL = `http://127.0.0.1:${REDIRECT_PORT}/callback`;

/**
 * Starts a local loopback listener via the Rust side, opens the system browser
 * at Athom's authorize endpoint, and resolves with the authorization code once
 * the browser is redirected back to 127.0.0.1.
 */
export async function performLoopbackOAuth(
  credentials: Omit<AuthCredentials, "redirectUrl">,
): Promise<string> {
  const creds: AuthCredentials = { ...credentials, redirectUrl: REDIRECT_URL };
  const url = buildAuthorizeUrl(creds);

  // Start listener first so the redirect can't race the browser opening.
  const codePromise = invoke<string>("await_oauth_code", { port: REDIRECT_PORT });
  await openUrl(url);
  return codePromise;
}
