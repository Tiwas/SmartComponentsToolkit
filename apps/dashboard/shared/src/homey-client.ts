import type {
  AthomHomeyLike,
  AthomUserLike,
  Flow,
  FlowFolder,
  HomeyAPILike,
  RawApp,
  RawDevice,
  RawFlow,
  RawFlowFolder,
} from "./types.js";
import type { AuthSession } from "./auth.js";

export class HomeyClient {
  private constructor(
    readonly user: AthomUserLike,
    readonly homey: AthomHomeyLike,
    readonly api: HomeyAPILike,
  ) {}

  static async connect(session: AuthSession, homeyId?: string): Promise<HomeyClient> {
    const user = await session.cloud.getAuthenticatedUser();
    const homeys = await user.getHomeys();
    if (homeys.length === 0) throw new Error("No Homey found on this account.");
    const homey = (homeyId && homeys.find((h) => h.id === homeyId)) || homeys[0];
    if (!homey) throw new Error("Selected Homey not available; pick another one in Settings.");
    const api = await homey.authenticate();
    return new HomeyClient(user, homey, api);
  }

  /** List all Homeys on the account (for the multi-Homey picker). */
  static async listHomeys(session: AuthSession): Promise<Array<{ id: string; name: string }>> {
    const user = await session.cloud.getAuthenticatedUser();
    const homeys = await user.getHomeys();
    return homeys.map((h) => ({ id: h.id, name: h.name }));
  }

  async listFlows(): Promise<Flow[]> {
    const [std, adv] = await Promise.all([
      this.api.flow.getFlows(),
      this.api.flow.getAdvancedFlows(),
    ]);
    const out: Flow[] = [];
    for (const f of Object.values(std)) out.push(normalize(f, "standard"));
    for (const f of Object.values(adv)) out.push(normalize(f, "advanced"));
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async listFolders(): Promise<FlowFolder[]> {
    const folders = await this.api.flow.getFlowFolders();
    return Object.values(folders).map((f: RawFlowFolder) => ({
      id: f.id,
      name: f.name,
      parent: f.parent ?? null,
    }));
  }

  async triggerFlow(flow: Pick<Flow, "id" | "kind">): Promise<void> {
    if (flow.kind === "advanced") {
      await this.api.flow.triggerAdvancedFlow({ id: flow.id });
    } else {
      await this.api.flow.triggerFlow({ id: flow.id });
    }
  }

  async setFavorite(flow: Pick<Flow, "id" | "kind">, favorite: boolean): Promise<void> {
    if (flow.kind === "advanced") {
      await this.api.flow.updateAdvancedFlow({ id: flow.id, advancedflow: { favorite } });
    } else {
      await this.api.flow.updateFlow({ id: flow.id, flow: { favorite } });
    }
  }

  /** Maps deviceId → device name. Empty map if devices API not available. */
  async listDeviceNames(): Promise<Map<string, string>> {
    if (!this.api.devices?.getDevices) return new Map();
    const map = await this.api.devices.getDevices();
    const out = new Map<string, string>();
    for (const d of Object.values(map) as RawDevice[]) {
      if (d.id && d.name) out.set(d.id, d.name);
    }
    return out;
  }

  /** Maps appId → app name. Empty map if apps API not available. */
  async listAppNames(): Promise<Map<string, string>> {
    if (!this.api.apps?.getApps) return new Map();
    const map = await this.api.apps.getApps();
    const out = new Map<string, string>();
    for (const a of Object.values(map) as RawApp[]) {
      if (a.id && a.name) out.set(a.id, a.name);
    }
    return out;
  }
}

function normalize(raw: RawFlow, kind: Flow["kind"]): Flow {
  return {
    id: raw.id,
    name: raw.name,
    kind,
    folder: raw.folder ?? null,
    enabled: raw.enabled ?? true,
    broken: raw.broken ?? false,
    favorite: raw.favorite ?? false,
  };
}

export function groupByFolder(flows: Flow[], folders: FlowFolder[]): Map<string, Flow[]> {
  const folderNames = new Map(folders.map((f) => [f.id, f.name]));
  const groups = new Map<string, Flow[]>();
  for (const f of flows) {
    const key = f.folder ? (folderNames.get(f.folder) ?? "Unknown folder") : "No folder";
    const bucket = groups.get(key) ?? [];
    bucket.push(f);
    groups.set(key, bucket);
  }
  return new Map([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
