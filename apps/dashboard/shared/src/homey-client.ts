import type {
  AthomHomeyLike,
  AthomUserLike,
  CapabilityInfo,
  DeviceState,
  Flow,
  FlowFolder,
  HomeyAPILike,
  RawApp,
  RawDevice,
  RawFlow,
  RawFlowFolder,
  Zone,
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

  /** Full device list with zone id + capability values + capability metadata. */
  async listDevices(): Promise<DeviceState[]> {
    if (!this.api.devices?.getDevices) return [];
    const map = await this.api.devices.getDevices();
    const out: DeviceState[] = [];
    for (const d of Object.values(map) as RawDevice[]) {
      if (!d.id) continue;
      const capabilities: Record<string, unknown> = {};
      const capabilityInfo: Record<string, CapabilityInfo> = {};
      for (const [k, v] of Object.entries(d.capabilitiesObj ?? {})) {
        capabilities[k] = v?.value;
        capabilityInfo[k] = {
          type: v?.type,
          min: v?.min,
          max: v?.max,
          step: v?.step,
          units: v?.units,
          values: v?.values?.map((opt) => ({
            id: opt.id,
            title:
              typeof opt.title === "string"
                ? opt.title
                : (opt.title?.en ?? opt.title?.no ?? opt.id),
          })),
        };
      }
      out.push({
        id: d.id,
        name: d.name ?? d.id,
        zone: d.zone ?? null,
        capabilities,
        capabilityInfo,
      });
    }
    return out;
  }

  /** Set a capability value on a device (e.g. onoff toggle, dim level). */
  async setDeviceCapability(deviceId: string, capabilityId: string, value: unknown): Promise<void> {
    if (!this.api.devices?.setCapabilityValue) {
      throw new Error("setCapabilityValue not supported by this SDK");
    }
    await this.api.devices.setCapabilityValue({ deviceId, capabilityId, value });
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

  /** Homey zones (rooms), flat with parent links. */
  async listZones(): Promise<Zone[]> {
    if (!this.api.zones?.getZones) return [];
    const map = await this.api.zones.getZones();
    return Object.values(map).map((z) => ({
      id: z.id,
      name: z.name,
      parent: z.parent ?? null,
    }));
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

export interface FolderNode {
  /** null = the synthetic root that holds top-level flows + folders. */
  folder: FlowFolder | null;
  children: FolderNode[];
  flows: Flow[];
}

/**
 * Build a nested tree of Homey flow folders, mirroring the structure shown
 * inside the Homey mobile app. Top-level (parent === null) folders sit
 * directly under the root, along with any flows whose folder is null.
 */
export function buildFolderTree(flows: Flow[], folders: FlowFolder[]): FolderNode {
  const flowsByFolderId = new Map<string | null, Flow[]>();
  for (const flow of flows) {
    const key = flow.folder ?? null;
    if (!flowsByFolderId.has(key)) flowsByFolderId.set(key, []);
    flowsByFolderId.get(key)!.push(flow);
  }

  const nodeByFolderId = new Map<string, FolderNode>();
  for (const folder of folders) {
    nodeByFolderId.set(folder.id, {
      folder,
      children: [],
      flows: flowsByFolderId.get(folder.id) ?? [],
    });
  }

  const root: FolderNode = {
    folder: null,
    children: [],
    flows: flowsByFolderId.get(null) ?? [],
  };

  for (const folder of folders) {
    const node = nodeByFolderId.get(folder.id)!;
    if (folder.parent && nodeByFolderId.has(folder.parent)) {
      nodeByFolderId.get(folder.parent)!.children.push(node);
    } else {
      root.children.push(node);
    }
  }

  function sortNode(node: FolderNode) {
    node.children.sort((a, b) =>
      (a.folder?.name ?? "").localeCompare(b.folder?.name ?? ""),
    );
    node.flows.sort((a, b) => a.name.localeCompare(b.name));
    node.children.forEach(sortNode);
  }
  sortNode(root);

  return root;
}

/** Recursively count flows in a folder node (including descendants). */
export function countFlowsInNode(node: FolderNode): number {
  return (
    node.flows.length +
    node.children.reduce((sum, child) => sum + countFlowsInNode(child), 0)
  );
}
