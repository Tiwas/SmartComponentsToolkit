import type {
  AthomHomeyLike,
  AthomUserLike,
  Flow,
  FlowFolder,
  HomeyAPILike,
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

  static async connect(session: AuthSession, homeyIndex = 0): Promise<HomeyClient> {
    const user = await session.cloud.getAuthenticatedUser();
    const homeys = await user.getHomeys();
    const homey = homeys[homeyIndex];
    if (!homey) throw new Error("No Homey found on this account.");
    const api = await homey.authenticate();
    return new HomeyClient(user, homey, api);
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
