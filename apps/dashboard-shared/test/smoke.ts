import assert from "node:assert/strict";
import {
  AuthSession,
  HomeyClient,
  buildAuthorizeUrl,
  extractCodeFromUrl,
  flowEditorUrl,
  groupByFolder,
  toggleFavorite,
} from "../src/index.js";
import type {
  AthomCloudAPILike,
  AthomCloudAPICtor,
  AthomHomeyLike,
  AthomUserLike,
  AuthCredentials,
  HomeyAPILike,
  RawFlow,
  RawFlowFolder,
} from "../src/types.js";

const flows: Record<string, RawFlow> = {
  f1: { id: "f1", name: "Movie night", folder: "fl-living", enabled: true, favorite: true },
  f2: { id: "f2", name: "All off", folder: null, enabled: true, favorite: false },
};
const advancedFlows: Record<string, RawFlow> = {
  a1: { id: "a1", name: "Wake up", folder: "fl-bed", enabled: true, favorite: false },
};
const folders: Record<string, RawFlowFolder> = {
  "fl-living": { id: "fl-living", name: "Living room", parent: null },
  "fl-bed": { id: "fl-bed", name: "Bedroom", parent: null },
};

const triggered: string[] = [];
const triggeredAdvanced: string[] = [];
const updatedFlow: { id?: string; favorite?: boolean } = {};
const updatedAdvanced: { id?: string; favorite?: boolean } = {};

const fakeApi: HomeyAPILike = {
  flow: {
    getFlows: async () => flows,
    getAdvancedFlows: async () => advancedFlows,
    getFlowFolders: async () => folders,
    triggerFlow: async ({ id }) => {
      triggered.push(id);
    },
    triggerAdvancedFlow: async ({ id }) => {
      triggeredAdvanced.push(id);
    },
    updateFlow: async ({ id, flow }) => {
      updatedFlow.id = id;
      updatedFlow.favorite = flow.favorite;
    },
    updateAdvancedFlow: async ({ id, advancedflow }) => {
      updatedAdvanced.id = id;
      updatedAdvanced.favorite = advancedflow.favorite;
    },
  },
};

const fakeHomey: AthomHomeyLike = {
  id: "homey-abc",
  name: "Home",
  authenticate: async () => fakeApi,
};

const fakeUser: AthomUserLike = {
  id: "u1",
  nickname: "lars",
  getHomeys: async () => [fakeHomey],
};

class FakeCloud implements AthomCloudAPILike {
  constructor(public readonly creds: AuthCredentials) {}
  async isLoggedIn() {
    return true;
  }
  async authenticateWithAuthorizationCode() {
    /* noop */
  }
  async getAuthenticatedUser() {
    return fakeUser;
  }
  async logout() {
    /* noop */
  }
}

async function main() {
  const credentials: AuthCredentials = {
    clientId: "cid",
    clientSecret: "csecret",
    redirectUrl: "http://127.0.0.1:53117/callback",
  };

  const url = buildAuthorizeUrl(credentials, "xyz");
  assert.ok(url.startsWith("https://api.athom.com/oauth2/authorise?"));
  assert.ok(url.includes("client_id=cid"));
  assert.ok(url.includes("state=xyz"));
  assert.ok(url.includes("redirect_uri=http%3A%2F%2F127.0.0.1%3A53117%2Fcallback"));
  assert.ok(!url.includes("scope="), "scope is intentionally omitted so Athom grants client-configured scopes");

  assert.equal(extractCodeFromUrl("http://127.0.0.1:53117/callback?code=abc123"), "abc123");
  assert.equal(extractCodeFromUrl("not a url"), null);

  const session = new AuthSession({
    AthomCloudAPI: FakeCloud as unknown as AthomCloudAPICtor,
    credentials,
  });
  assert.equal(await session.isLoggedIn(), true);

  const client = await HomeyClient.connect(session);
  assert.equal(client.homey.id, "homey-abc");

  const allFlows = await client.listFlows();
  assert.equal(allFlows.length, 3);
  assert.deepEqual(allFlows.map((f) => f.name), ["All off", "Movie night", "Wake up"]);
  const adv = allFlows.find((f) => f.id === "a1")!;
  assert.equal(adv.kind, "advanced");

  const favs = allFlows.filter((f) => f.favorite);
  assert.deepEqual(favs.map((f) => f.id), ["f1"], "favorite flows surfaced from raw data");

  const folderList = await client.listFolders();
  const groups = groupByFolder(allFlows, folderList);
  assert.deepEqual([...groups.keys()], ["Bedroom", "Living room", "No folder"]);
  assert.equal(groups.get("Living room")?.[0]?.name, "Movie night");
  assert.equal(groups.get("No folder")?.[0]?.name, "All off");

  await client.triggerFlow(allFlows.find((f) => f.id === "f1")!);
  await client.triggerFlow(adv);
  assert.deepEqual(triggered, ["f1"]);
  assert.deepEqual(triggeredAdvanced, ["a1"]);

  await client.setFavorite({ id: "f2", kind: "standard" }, true);
  assert.equal(updatedFlow.id, "f2");
  assert.equal(updatedFlow.favorite, true);
  await client.setFavorite({ id: "a1", kind: "advanced" }, true);
  assert.equal(updatedAdvanced.id, "a1");
  assert.equal(updatedAdvanced.favorite, true);

  assert.equal(
    flowEditorUrl("homey-abc", { id: "f1", kind: "standard" }),
    "https://my.homey.app/homeys/homey-abc/flows/f1",
  );
  assert.equal(
    flowEditorUrl("homey-abc", { id: "a1", kind: "advanced" }),
    "https://my.homey.app/homeys/homey-abc/flows/advanced/a1",
  );

  assert.deepEqual(toggleFavorite([], "f1"), ["f1"]);
  assert.deepEqual(toggleFavorite(["f1"], "f1"), []);

  console.log("OK — all assertions passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
