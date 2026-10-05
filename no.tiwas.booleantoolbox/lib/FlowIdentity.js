"use strict";

const { randomUUID } = require("node:crypto");

const CARD_ID = "flow_whoami";
const ARG_NAME = "flow";

/**
 * Lets the "flow_whoami" action card find out which Advanced Flow it runs in.
 *
 * Homey passes no Flow context to a run listener, and an app may read Flows
 * but not write them. The card therefore has an autocomplete argument with
 * one choice, "this Flow". Each time the list opens, that choice carries a
 * new random id, and Homey stores the picked id with the card. When the card
 * runs, the app reads the Advanced Flows, finds the one holding a card with
 * that id, and returns its current name. The name is read on every run, so a
 * rename shows up on the next run without any event listening.
 *
 * A duplicated Flow or a copied card carries the same id. The id is then
 * found in several Flows. The card does not guess: "Flow name" gets a marker
 * such as "[Duplicate]" and "Error message" names the Flows. The card does not
 * throw in these cases, because Homey drops a card's tokens when it takes the
 * error output. It only throws when the Flows cannot be read at all.
 *
 * Action cards with tokens only exist in Advanced Flows, so standard Flows are
 * never read.
 */
class FlowIdentity {
  constructor({ appId, getApi, logger, translate, createId } = {}) {
    if (!appId) throw new Error("FlowIdentity needs the app id");
    if (typeof getApi !== "function") throw new Error("FlowIdentity needs getApi()");

    this.appId = appId;
    this.getApi = getApi;
    this.logger = logger;
    this.translate = typeof translate === "function" ? translate : (key) => key;
    this.createId = typeof createId === "function" ? createId : randomUUID;
  }

  get cardUri() {
    return `homey:app:${this.appId}:${CARD_ID}`;
  }

  isOwnCard(card) {
    if (!card || typeof card.id !== "string") return false;
    if (card.id === this.cardUri) return true;
    return card.id === CARD_ID && card.ownerUri === `homey:app:${this.appId}`;
  }

  cardIdFromArgs(args) {
    const value = args ? args[ARG_NAME] : null;
    if (value && typeof value === "object" && typeof value.id === "string" && value.id) {
      return value.id;
    }
    return null;
  }

  /**
   * The single choice offered in the card's list. A new id each time, so
   * every card that picks it gets its own id.
   */
  autocompleteResults() {
    return [
      {
        id: this.createId(),
        name: this.translate("flow_identity.choice_name"),
        description: this.translate("flow_identity.choice_description"),
      },
    ];
  }

  async getFlowManager() {
    const api = await this.getApi();
    if (!api || !api.flow) throw new Error("Homey API flow manager is not available");
    return api.flow;
  }

  /**
   * Returns the Advanced Flows that hold this app's card with the given id.
   */
  async findFlowsWithCardId(cardId) {
    const flowManager = await this.getFlowManager();
    const flows = Object.values((await flowManager.getAdvancedFlows({ $cache: false })) || {});
    return flows.filter((flow) =>
      Object.values(flow.cards || {}).some(
        (card) => this.isOwnCard(card) && this.cardIdFromArgs(card.args) === cardId,
      ),
    );
  }

  async getFolderName(folderId) {
    if (!folderId) return "";
    const flowManager = await this.getFlowManager();
    try {
      const folder = await flowManager.getFlowFolder({ id: folderId, $cache: false });
      return (folder && folder.name) || "";
    } catch (error) {
      this.logger.debug("FlowIdentity: folder lookup for {folderId} failed: {message}", {
        folderId,
        message: error.message,
      });
      return "";
    }
  }

  /**
   * Tokens for a run that cannot name the Flow: a short marker in place of
   * the name, and the full explanation in "error_message".
   */
  problemTokens(kind, detail = "") {
    const message = this.translate(`flow_identity.errors.${kind}`);
    return {
      flow_name: this.translate(`flow_identity.markers.${kind}`),
      flow_id: "",
      folder_name: "",
      error_message: detail ? `${message} ${detail}` : message,
    };
  }

  /**
   * Returns the tokens for a run of the card. The Flows are read from the API
   * on every run, never from a cache.
   */
  async resolve(args) {
    const cardId = this.cardIdFromArgs(args);
    if (!cardId) return this.problemTokens("missing");

    const flows = await this.findFlowsWithCardId(cardId);
    if (flows.length === 0) return this.problemTokens("not_found");
    if (flows.length > 1) {
      return this.problemTokens("copied", flows.map((flow) => `"${flow.name}"`).join(", "));
    }

    const flow = flows[0];
    return {
      flow_name: flow.name || "",
      flow_id: flow.id,
      folder_name: await this.getFolderName(flow.folder),
      error_message: "",
    };
  }
}

FlowIdentity.CARD_ID = CARD_ID;
FlowIdentity.ARG_NAME = ARG_NAME;

module.exports = FlowIdentity;
