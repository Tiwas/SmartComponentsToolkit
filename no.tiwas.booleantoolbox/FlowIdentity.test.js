"use strict";

const FlowIdentity = require("./lib/FlowIdentity");

const APP_ID = "no.tiwas.booleantoolbox";
const CARD_URI = `homey:app:${APP_ID}:flow_whoami`;

function createLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function whoamiCard(cardId) {
  const card = { id: CARD_URI, type: "action", x: 0, y: 0, args: {} };
  if (cardId !== undefined) card.args.flow = { id: cardId, name: "this Flow" };
  return card;
}

function otherCard() {
  return { id: "homey:manager:notifications:create_notification", type: "action", x: 0, y: 0, args: { text: "hi" } };
}

function createFlowManager(flows, folders = {}) {
  const store = new Map(Object.entries(flows).map(([id, flow]) => [id, { id, ...flow }]));
  return {
    store,
    getAdvancedFlows: jest.fn(async () => Object.fromEntries(
      [...store.entries()].map(([id, flow]) => [id, JSON.parse(JSON.stringify(flow))]),
    )),
    getFlowFolder: jest.fn(async ({ id }) => {
      if (!folders[id]) throw new Error("Not Found");
      return { id, name: folders[id] };
    }),
  };
}

function createIdentity(flowManager, options = {}) {
  return new FlowIdentity({
    appId: APP_ID,
    getApi: async () => ({ flow: flowManager }),
    logger: createLogger(),
    translate: (key) => key,
    ...options,
  });
}

describe("FlowIdentity card matching", () => {
  test("recognises the card by full URI and by owner + short id", () => {
    const identity = createIdentity(createFlowManager({}));
    expect(identity.isOwnCard({ id: CARD_URI })).toBe(true);
    expect(identity.isOwnCard({ id: "flow_whoami", ownerUri: `homey:app:${APP_ID}` })).toBe(true);
    expect(identity.isOwnCard({ id: "flow_whoami", ownerUri: "homey:app:other.app" })).toBe(false);
    expect(identity.isOwnCard({ id: "homey:app:other.app:flow_whoami" })).toBe(false);
    expect(identity.isOwnCard(null)).toBe(false);
  });

  test("reads the card id only from a picked choice", () => {
    const identity = createIdentity(createFlowManager({}));
    expect(identity.cardIdFromArgs({ flow: { id: "card-1", name: "this Flow" } })).toBe("card-1");
    expect(identity.cardIdFromArgs({ flow: { name: "this Flow" } })).toBeNull();
    expect(identity.cardIdFromArgs({ flow: "card-1" })).toBeNull();
    expect(identity.cardIdFromArgs({})).toBeNull();
    expect(identity.cardIdFromArgs(undefined)).toBeNull();
  });
});

describe("FlowIdentity autocomplete", () => {
  test("offers one choice with a new id each time", () => {
    let counter = 0;
    const identity = createIdentity(createFlowManager({}), { createId: () => `id-${++counter}` });

    const first = identity.autocompleteResults();
    const second = identity.autocompleteResults();

    expect(first).toEqual([
      {
        id: "id-1",
        name: "flow_identity.choice_name",
        description: "flow_identity.choice_description",
      },
    ]);
    expect(second[0].id).toBe("id-2");
  });

  test("uses random UUIDs by default", () => {
    const identity = createIdentity(createFlowManager({}));
    const [choice] = identity.autocompleteResults();
    expect(choice.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("FlowIdentity resolve", () => {
  test("returns the name, id and folder of the Flow holding the card", async () => {
    const manager = createFlowManager(
      {
        "flow-a": { name: "Lights", folder: "folder-1", cards: { one: whoamiCard("card-1"), two: otherCard() } },
        "flow-b": { name: "Heating", cards: { one: whoamiCard("card-2") } },
      },
      { "folder-1": "Living room" },
    );
    const identity = createIdentity(manager);

    await expect(identity.resolve({ flow: { id: "card-1" } })).resolves.toEqual({
      flow_name: "Lights",
      flow_id: "flow-a",
      folder_name: "Living room",
      has_error: false,
      error_message: "",
    });
    expect(manager.getAdvancedFlows).toHaveBeenCalledWith({ $cache: false });
  });

  test("accepts the same card id twice in one Flow", async () => {
    const manager = createFlowManager({
      "flow-a": { name: "Lights", cards: { one: whoamiCard("card-1"), two: whoamiCard("card-1") } },
    });
    const identity = createIdentity(manager);

    await expect(identity.resolve({ flow: { id: "card-1" } })).resolves.toMatchObject({ flow_id: "flow-a" });
  });

  test("returns the new name on the next run after a rename", async () => {
    const manager = createFlowManager({ "flow-a": { name: "Lights", cards: { one: whoamiCard("card-1") } } });
    const identity = createIdentity(manager);

    await expect(identity.resolve({ flow: { id: "card-1" } })).resolves.toMatchObject({ flow_name: "Lights" });
    manager.store.get("flow-a").name = "Lights (renamed)";

    await expect(identity.resolve({ flow: { id: "card-1" } })).resolves.toMatchObject({
      flow_name: "Lights (renamed)",
    });
    expect(manager.getAdvancedFlows).toHaveBeenCalledTimes(2);
  });

  test("marks a copied card id and names every Flow in the error message", async () => {
    const manager = createFlowManager({
      "flow-a": { name: "Lights", cards: { one: whoamiCard("card-1") } },
      "flow-b": { name: "Lights (copy)", cards: { one: whoamiCard("card-1") } },
    });
    const identity = createIdentity(manager);

    await expect(identity.resolve({ flow: { id: "card-1" } })).resolves.toEqual({
      flow_name: "flow_identity.markers.copied",
      flow_id: "",
      folder_name: "",
      has_error: true,
      error_message: 'flow_identity.errors.copied "Lights", "Lights (copy)"',
    });
  });

  test("marks a card where nothing has been picked", async () => {
    const manager = createFlowManager({});
    const identity = createIdentity(manager);

    await expect(identity.resolve({})).resolves.toEqual({
      flow_name: "flow_identity.markers.missing",
      flow_id: "",
      folder_name: "",
      has_error: true,
      error_message: "flow_identity.errors.missing",
    });
    expect(manager.getAdvancedFlows).not.toHaveBeenCalled();
  });

  test("marks a card whose id is in no saved Flow", async () => {
    const manager = createFlowManager({ "flow-a": { name: "Lights", cards: { one: whoamiCard("card-1") } } });
    const identity = createIdentity(manager);

    await expect(identity.resolve({ flow: { id: "card-unsaved" } })).resolves.toEqual({
      flow_name: "flow_identity.markers.not_found",
      flow_id: "",
      folder_name: "",
      has_error: true,
      error_message: "flow_identity.errors.not_found",
    });
  });

  test("throws when the Flows cannot be read, so the error output is used", async () => {
    const manager = createFlowManager({});
    manager.getAdvancedFlows.mockRejectedValue(new Error("API unavailable"));
    const identity = createIdentity(manager);

    await expect(identity.resolve({ flow: { id: "card-1" } })).rejects.toThrow("API unavailable");
  });

  test("ignores other apps' cards with the same argument", async () => {
    const foreign = { id: "homey:app:other.app:flow_whoami", args: { flow: { id: "card-1" } } };
    const manager = createFlowManager({
      "flow-a": { name: "Lights", cards: { one: whoamiCard("card-1") } },
      "flow-b": { name: "Other", cards: { one: foreign } },
    });
    const identity = createIdentity(manager);

    await expect(identity.resolve({ flow: { id: "card-1" } })).resolves.toMatchObject({ flow_id: "flow-a" });
  });

  test("returns an empty folder name when the folder lookup fails", async () => {
    const manager = createFlowManager({
      "flow-a": { name: "Lights", folder: "missing", cards: { one: whoamiCard("card-1") } },
    });
    const identity = createIdentity(manager);

    await expect(identity.resolve({ flow: { id: "card-1" } })).resolves.toMatchObject({ folder_name: "" });
  });
});
