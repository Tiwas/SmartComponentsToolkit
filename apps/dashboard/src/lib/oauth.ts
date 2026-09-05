import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { buildAuthorizeUrl, type AuthCredentials } from "@homey-toolbox/dashboard-shared";

export const REDIRECT_PORT = 53117;
export const REDIRECT_URL = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
export const OAUTH_TIMEOUT_MS = 120_000;

function createOAuthState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export interface LoopbackOAuthOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Starts a local loopback listener via the Rust side, opens the system browser
 * at Athom's authorize endpoint, and resolves with the authorization code once
 * the browser is redirected back to 127.0.0.1.
 */
export async function performLoopbackOAuth(
  credentials: Omit<AuthCredentials, "redirectUrl">,
  options: LoopbackOAuthOptions = {},
): Promise<string> {
  if (options.signal?.aborted) {
    throw new DOMException("OAuth sign-in cancelled", "AbortError");
  }

  const creds: AuthCredentials = { ...credentials, redirectUrl: REDIRECT_URL };
  const state = createOAuthState();
  const url = buildAuthorizeUrl(creds, state);
  const timeoutMs = options.timeoutMs ?? OAUTH_TIMEOUT_MS;

  // Start listener first so the redirect can't race the browser opening.
  const codePromise = invoke<string>("await_oauth_code", {
    port: REDIRECT_PORT,
    state,
    timeoutMs,
  });
  const cancel = () => void invoke("cancel_oauth_listener").catch(() => {});
  options.signal?.addEventListener("abort", cancel, { once: true });

  try {
    await openUrl(url);
    return await codePromise;
  } catch (error) {
    cancel();
    await codePromise.catch(() => {});
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", cancel);
  }
}
