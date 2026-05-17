import type { AthomCloudAPICtor, AthomCloudAPILike, AuthCredentials } from "./types.js";

const ATHOM_AUTHORIZE = "https://api.athom.com/oauth2/authorise";

/**
 * Athom grants whatever scopes are configured on the OAuth client when no
 * `scope` query parameter is supplied. Passing an explicit scope string that
 * doesn't match the client's enabled scopes causes Athom to fall back to a
 * minimum set (login/email), so we deliberately omit it.
 */
export function buildAuthorizeUrl(creds: AuthCredentials, state?: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: creds.clientId,
    redirect_uri: creds.redirectUrl,
  });
  if (state) params.set("state", state);
  return `${ATHOM_AUTHORIZE}?${params.toString()}`;
}

export interface AuthSessionOpts {
  AthomCloudAPI: AthomCloudAPICtor;
  credentials: AuthCredentials;
}

export class AuthSession {
  readonly cloud: AthomCloudAPILike;
  private readonly creds: AuthCredentials;

  constructor(opts: AuthSessionOpts) {
    this.cloud = new opts.AthomCloudAPI(opts.credentials);
    this.creds = opts.credentials;
  }

  authorizeUrl(state?: string): string {
    return buildAuthorizeUrl(this.creds, state);
  }

  async exchangeCode(code: string): Promise<void> {
    await this.cloud.authenticateWithAuthorizationCode({
      code,
      redirectUrl: this.creds.redirectUrl,
    });
  }

  isLoggedIn(): Promise<boolean> {
    return this.cloud.isLoggedIn();
  }

  async logout(): Promise<void> {
    try {
      await this.cloud.logout();
    } catch {
      // ignore — caller will clear local state regardless
    }
  }
}

export function extractCodeFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get("code");
  } catch {
    return null;
  }
}
