export type FlowKind = "standard" | "advanced";

export interface Flow {
  id: string;
  name: string;
  kind: FlowKind;
  folder: string | null;
  enabled: boolean;
  broken: boolean;
  favorite: boolean;
}

export interface FlowFolder {
  id: string;
  name: string;
  parent: string | null;
}

export interface AuthCredentials {
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface TokenStorage {
  load(): Promise<TokenSet | null>;
  save(tokens: TokenSet): Promise<void>;
  clear(): Promise<void>;
}

export interface AthomCloudAPILike {
  isLoggedIn(): Promise<boolean>;
  authenticateWithAuthorizationCode(opts: { code: string; redirectUrl: string }): Promise<unknown>;
  getAuthenticatedUser(): Promise<AthomUserLike>;
  logout(): Promise<void>;
}

export interface AthomUserLike {
  id: string;
  nickname?: string;
  firstname?: string;
  getHomeys(): Promise<AthomHomeyLike[]>;
}

export interface AthomHomeyLike {
  id: string;
  name: string;
  authenticate(): Promise<HomeyAPILike>;
}

export interface HomeyAPILike {
  flow: {
    getFlows(): Promise<Record<string, RawFlow>>;
    getAdvancedFlows(): Promise<Record<string, RawFlow>>;
    getFlowFolders(): Promise<Record<string, RawFlowFolder>>;
    triggerFlow(opts: { id: string }): Promise<void>;
    triggerAdvancedFlow(opts: { id: string }): Promise<void>;
    updateFlow(opts: { id: string; flow: Partial<RawFlow> }): Promise<void>;
    updateAdvancedFlow(opts: { id: string; advancedflow: Partial<RawFlow> }): Promise<void>;
  };
  devices?: {
    getDevices(opts?: { $skipCache?: boolean }): Promise<Record<string, RawDevice>>;
  };
  apps?: {
    getApps(opts?: { $skipCache?: boolean }): Promise<Record<string, RawApp>>;
  };
  zones?: {
    getZones(opts?: { $skipCache?: boolean }): Promise<Record<string, RawZone>>;
  };
}

export interface RawZone {
  id: string;
  name: string;
  parent?: string | null;
}

export interface Zone {
  id: string;
  name: string;
  parent: string | null;
}

export interface RawDevice {
  id: string;
  name?: string;
  zone?: string | null;
}

export interface RawApp {
  id: string;
  name?: string;
}

export interface RawFlow {
  id: string;
  name: string;
  folder?: string | null;
  enabled?: boolean;
  broken?: boolean;
  favorite?: boolean;
}

export interface RawFlowFolder {
  id: string;
  name: string;
  parent?: string | null;
}

export type AthomCloudAPICtor = new (opts: AuthCredentials) => AthomCloudAPILike;
