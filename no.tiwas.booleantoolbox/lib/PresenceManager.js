"use strict";

const PRESENCE_STATE_KEY = "presence_guard_state_v1";
const PERSON_TRIGGER_ID = "presence_person_away_for";
const EVERYONE_TRIGGER_ID = "presence_everyone_away_for";
const MIN_DELAY_MINUTES = 1;
const MAX_DELAY_MINUTES = 7 * 24 * 60;
const REFRESH_DEBOUNCE_MS = 100;

/**
 * Tracks Homey's user presence and schedules delayed absence Flow triggers.
 *
 * Trigger-card arguments live in the user's Flows, not in the app runtime.
 * This manager therefore reads enabled standard and Advanced Flows, reduces
 * them to unique person/delay configurations, and schedules one timer for
 * each configuration. Absence episodes and fired thresholds are persisted so
 * app restarts neither reset a running delay nor fire the same threshold twice.
 */
class PresenceManager {
    constructor({ homey, logger, getApi, now = () => Date.now() }) {
        this.homey = homey;
        this.logger = logger;
        this.getApi = getApi;
        this.now = now;

        this.users = new Map();
        this.personConfigurations = new Map();
        this.everyoneConfigurations = new Map();
        this.timers = new Map();
        this.inFlight = new Set();
        this.managerListeners = [];
        this.firedPerson = {};
        this.firedEveryone = {};
        this.allAbsentSince = null;
        this.lastPersonName = "";
        this.personTriggerCard = null;
        this.everyoneTriggerCard = null;
        this.userRefreshTimer = null;
        this.flowRefreshTimer = null;
        this.persistPromise = Promise.resolve();
        this.userRevision = 0;
        this.destroyed = false;
    }

    setTriggerCards({ person, everyone }) {
        this.personTriggerCard = person;
        this.everyoneTriggerCard = everyone;
    }

    static autocompleteId(value) {
        if (typeof value === "string") return value.trim();
        if (!value || typeof value !== "object") return "";
        return String(value.id || value.name || "").trim();
    }

    static delayMinutes(value) {
        const minutes = Number(value);
        if (
            !Number.isInteger(minutes)
            || minutes < MIN_DELAY_MINUTES
            || minutes > MAX_DELAY_MINUTES
        ) {
            return null;
        }
        return minutes;
    }

    static triggerMatches(card, triggerId, appId) {
        if (!card || typeof card !== "object") return false;
        const fullId = `homey:app:${appId}:${triggerId}`;
        return [card.id, card.uri].some((value) =>
            typeof value === "string"
            && (value === triggerId || value === fullId || value.endsWith(`:${triggerId}`)));
    }

    static personRunMatches(args, state) {
        const personId = PresenceManager.autocompleteId(args?.person);
        const minutes = PresenceManager.delayMinutes(args?.minutes);
        return !!personId
            && minutes !== null
            && personId === state?.person_id
            && minutes === state?.minutes;
    }

    static everyoneRunMatches(args, state) {
        const minutes = PresenceManager.delayMinutes(args?.minutes);
        return minutes !== null && minutes === state?.minutes;
    }

    async init() {
        this.loadPersistedState();

        const api = await this.getApi();
        if (!api?.users || !api?.flow) {
            throw new Error("Homey users or Flow API is not available");
        }

        this.api = api;
        this.usersManager = api.users;
        this.flowManager = api.flow;
        this.bindManagerEvents();

        if (typeof this.usersManager.connect === "function") {
            await this.usersManager.connect();
        }
        if (typeof this.flowManager.connect === "function") {
            await this.flowManager.connect();
        }

        await this.syncUsers();
        await this.refreshConfigurations();
        this.logger.info("Presence guard initialized", {
            users: this.users.size,
            personTimers: this.personConfigurations.size,
            everyoneTimers: this.everyoneConfigurations.size,
        });
    }

    loadPersistedState() {
        let stored = null;
        try {
            stored = this.homey.settings.get(PRESENCE_STATE_KEY);
        } catch (error) {
            this.logger.warn("Could not read persisted presence state", {
                message: error.message,
            });
        }

        if (!stored || typeof stored !== "object") return;

        for (const [id, value] of Object.entries(stored.users || {})) {
            if (!value || typeof value !== "object") continue;
            this.users.set(id, {
                id,
                name: typeof value.name === "string" ? value.name : id,
                present: value.present === true,
                absentSince: Number.isFinite(value.absentSince) ? value.absentSince : null,
            });
        }

        this.allAbsentSince = Number.isFinite(stored.allAbsentSince)
            ? stored.allAbsentSince
            : null;
        this.lastPersonName = typeof stored.lastPersonName === "string"
            ? stored.lastPersonName
            : "";
        this.firedPerson = stored.firedPerson && typeof stored.firedPerson === "object"
            ? { ...stored.firedPerson }
            : {};
        this.firedEveryone = stored.firedEveryone && typeof stored.firedEveryone === "object"
            ? { ...stored.firedEveryone }
            : {};
    }

    bindManagerEvents() {
        const bind = (manager, event, listener) => {
            if (!manager || typeof manager.on !== "function") return;
            manager.on(event, listener);
            this.managerListeners.push({ manager, event, listener });
        };

        ["user.create", "user.update"].forEach((event) => {
            bind(this.usersManager, event, (user) => this.applyUserEvent(user));
        });
        bind(this.usersManager, "user.delete", (user) => this.applyUserEvent(user, true));
        [
            "flow.create",
            "flow.update",
            "flow.delete",
            "advancedflow.create",
            "advancedflow.update",
            "advancedflow.delete",
        ].forEach((event) => {
            bind(this.flowManager, event, () => this.queueFlowRefresh());
        });
        bind(this.api, "reconnect", () => {
            this.queueUserRefresh();
            this.queueFlowRefresh();
        });
    }

    applyUserEvent(user, deleted = false) {
        if (this.destroyed || !user?.id) return;
        this.userRevision += 1;
        const previous = this.users.get(user.id);
        let lastTransitionUser = null;

        if (deleted || user.enabled === false) {
            this.users.delete(user.id);
            this.clearPersonFired(user.id);
            if (previous?.present === true) {
                lastTransitionUser = {
                    ...previous,
                    absentSince: this.now(),
                };
            }
        } else if (typeof user.present === "boolean") {
            const present = user.present === true;
            this.users.set(user.id, {
                id: user.id,
                name: typeof user.name === "string" && user.name ? user.name : user.id,
                present,
                absentSince: present
                    ? null
                    : previous?.present === false && Number.isFinite(previous.absentSince)
                        ? previous.absentSince
                        : this.now(),
            });
            if (!present && previous?.present !== false) {
                lastTransitionUser = this.users.get(user.id);
            }
            if (present && previous?.present === false) {
                this.clearPersonFired(user.id);
            }
        } else {
            this.queueUserRefresh();
            return;
        }

        // Apply the realtime event before any asynchronous refresh. In
        // particular, a return at the timer boundary must cancel the timer
        // immediately instead of waiting for a REST round-trip.
        this.updateEveryoneState(lastTransitionUser);
        this.persistState();
        this.refreshSchedules();
    }

    queueUserRefresh() {
        if (this.destroyed) return;
        if (this.userRefreshTimer) clearTimeout(this.userRefreshTimer);
        this.userRefreshTimer = setTimeout(() => {
            this.userRefreshTimer = null;
            this.syncUsers().catch((error) => {
                this.logger.error("Presence state refresh failed", error);
            });
        }, REFRESH_DEBOUNCE_MS);
    }

    queueFlowRefresh() {
        if (this.destroyed) return;
        if (this.flowRefreshTimer) clearTimeout(this.flowRefreshTimer);
        this.flowRefreshTimer = setTimeout(() => {
            this.flowRefreshTimer = null;
            this.refreshConfigurations().catch((error) => {
                this.logger.error("Presence Flow refresh failed", error);
            });
        }, REFRESH_DEBOUNCE_MS);
    }

    async syncUsers() {
        const revision = this.userRevision;
        const rawUsers = await this.usersManager.getUsers({ $cache: false });
        if (revision !== this.userRevision) {
            this.queueUserRefresh();
            return;
        }
        const currentUsers = Object.values(rawUsers || {}).filter((user) =>
            user
            && user.id
            && user.enabled !== false
            && typeof user.present === "boolean");
        const currentIds = new Set(currentUsers.map((user) => user.id));
        const now = this.now();
        let lastTransitionUser = null;

        for (const user of currentUsers) {
            const previous = this.users.get(user.id);
            const present = user.present === true;
            const absentSince = present
                ? null
                : previous?.present === false && Number.isFinite(previous.absentSince)
                    ? previous.absentSince
                    : now;

            const current = {
                id: user.id,
                name: typeof user.name === "string" && user.name ? user.name : user.id,
                present,
                absentSince,
            };
            this.users.set(user.id, current);
            if (!present && previous?.present !== false) lastTransitionUser = current;

            if (present && previous?.present === false) {
                this.clearPersonFired(user.id);
            }
        }

        for (const userId of [...this.users.keys()]) {
            if (currentIds.has(userId)) continue;
            const removed = this.users.get(userId);
            this.users.delete(userId);
            this.clearPersonFired(userId);
            if (removed?.present === true) {
                lastTransitionUser = {
                    ...removed,
                    absentSince: now,
                };
            }
        }

        this.updateEveryoneState(lastTransitionUser);
        await this.persistState();
        this.refreshSchedules();
    }

    updateEveryoneState(lastTransitionUser = null) {
        const trackedUsers = [...this.users.values()];
        const everyoneAway = trackedUsers.length > 0
            && trackedUsers.every((user) => user.present === false);

        if (!everyoneAway) {
            if (this.allAbsentSince !== null) this.firedEveryone = {};
            this.allAbsentSince = null;
            this.lastPersonName = "";
            return;
        }

        if (Number.isFinite(this.allAbsentSince)) return;

        const lastToLeave = lastTransitionUser
            || trackedUsers.reduce((latest, user) =>
                !latest || user.absentSince > latest.absentSince ? user : latest, null);
        this.allAbsentSince = lastToLeave?.absentSince || this.now();
        this.lastPersonName = lastToLeave?.name || "";
    }

    clearPersonFired(userId) {
        const prefix = `${userId}|`;
        for (const key of Object.keys(this.firedPerson)) {
            if (key.startsWith(prefix)) delete this.firedPerson[key];
        }
    }

    async refreshConfigurations() {
        const [flows, advancedFlows] = await Promise.all([
            this.flowManager.getFlows({ $cache: false }),
            this.getAdvancedFlows(),
        ]);
        const personConfigurations = new Map();
        const everyoneConfigurations = new Map();
        const appId = this.homey.manifest?.id || "no.tiwas.booleantoolbox";

        const collect = (card) => {
            if (PresenceManager.triggerMatches(card, PERSON_TRIGGER_ID, appId)) {
                const personId = PresenceManager.autocompleteId(card.args?.person);
                const minutes = PresenceManager.delayMinutes(card.args?.minutes);
                if (personId && minutes !== null) {
                    personConfigurations.set(`${personId}|${minutes}`, { personId, minutes });
                }
            }
            if (PresenceManager.triggerMatches(card, EVERYONE_TRIGGER_ID, appId)) {
                const minutes = PresenceManager.delayMinutes(card.args?.minutes);
                if (minutes !== null) {
                    everyoneConfigurations.set(String(minutes), { minutes });
                }
            }
        };

        for (const flow of Object.values(flows || {})) {
            if (flow?.enabled === false) continue;
            collect(flow?.trigger);
        }
        for (const flow of Object.values(advancedFlows || {})) {
            if (flow?.enabled === false) continue;
            for (const card of Object.values(flow?.cards || {})) {
                if (card?.type === "trigger") collect(card);
            }
        }

        this.personConfigurations = personConfigurations;
        this.everyoneConfigurations = everyoneConfigurations;
        this.refreshSchedules();
    }

    async getAdvancedFlows() {
        try {
            if (typeof this.flowManager.getAdvancedFlows === "function") {
                return await this.flowManager.getAdvancedFlows({ $cache: false });
            }
            if (this.api?.flowAdv && typeof this.api.flowAdv.getFlows === "function") {
                return await this.api.flowAdv.getFlows({ $cache: false });
            }
        } catch (error) {
            this.logger.warn("Advanced Flows are unavailable for presence guards", {
                message: error.message,
            });
        }
        return {};
    }

    refreshSchedules() {
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
        if (this.destroyed) return;

        for (const [key, configuration] of this.personConfigurations) {
            const user = this.users.get(configuration.personId);
            if (!user || user.present || !Number.isFinite(user.absentSince)) continue;
            if (this.firedPerson[key] === user.absentSince || this.inFlight.has(`person:${key}`)) {
                continue;
            }
            this.schedule(`person:${key}`, user.absentSince, configuration.minutes, () =>
                this.firePerson(configuration, user.absentSince));
        }

        if (!Number.isFinite(this.allAbsentSince)) return;
        for (const [key, configuration] of this.everyoneConfigurations) {
            if (
                this.firedEveryone[key] === this.allAbsentSince
                || this.inFlight.has(`everyone:${key}`)
            ) {
                continue;
            }
            const episodeStart = this.allAbsentSince;
            this.schedule(`everyone:${key}`, episodeStart, configuration.minutes, () =>
                this.fireEveryone(configuration, episodeStart));
        }
    }

    schedule(key, episodeStart, minutes, callback) {
        const dueAt = episodeStart + minutes * 60 * 1000;
        const delay = Math.max(0, dueAt - this.now());
        const timer = setTimeout(() => {
            this.timers.delete(key);
            Promise.resolve(callback()).catch((error) => {
                this.logger.error("Presence timer failed", error);
            });
        }, delay);
        this.timers.set(key, timer);
    }

    async firePerson(configuration, episodeStart) {
        const key = `${configuration.personId}|${configuration.minutes}`;
        const inFlightKey = `person:${key}`;
        const user = this.users.get(configuration.personId);
        if (
            !this.personTriggerCard
            || !user
            || user.present
            || user.absentSince !== episodeStart
            || this.firedPerson[key] === episodeStart
            || this.inFlight.has(inFlightKey)
        ) {
            return;
        }

        this.inFlight.add(inFlightKey);
        try {
            await this.personTriggerCard.trigger({
                person_name: user.name,
                away_minutes: this.elapsedMinutes(episodeStart),
                away_since: new Date(episodeStart).toISOString(),
            }, {
                person_id: user.id,
                minutes: configuration.minutes,
            });
            const currentUser = this.users.get(configuration.personId);
            if (
                currentUser?.present === false
                && currentUser.absentSince === episodeStart
            ) {
                this.firedPerson[key] = episodeStart;
                await this.persistState();
            }
        } finally {
            this.inFlight.delete(inFlightKey);
            const currentUser = this.users.get(configuration.personId);
            if (
                currentUser?.present === false
                && Number.isFinite(currentUser.absentSince)
                && currentUser.absentSince !== episodeStart
            ) {
                this.refreshSchedules();
            }
        }
    }

    async fireEveryone(configuration, episodeStart) {
        const key = String(configuration.minutes);
        const inFlightKey = `everyone:${key}`;
        if (
            !this.everyoneTriggerCard
            || this.allAbsentSince !== episodeStart
            || [...this.users.values()].some((user) => user.present)
            || this.firedEveryone[key] === episodeStart
            || this.inFlight.has(inFlightKey)
        ) {
            return;
        }

        this.inFlight.add(inFlightKey);
        try {
            await this.everyoneTriggerCard.trigger({
                away_minutes: this.elapsedMinutes(episodeStart),
                away_since: new Date(episodeStart).toISOString(),
                people_count: this.users.size,
                last_person_name: this.lastPersonName,
            }, {
                minutes: configuration.minutes,
            });
            if (this.allAbsentSince === episodeStart) {
                this.firedEveryone[key] = episodeStart;
                await this.persistState();
            }
        } finally {
            this.inFlight.delete(inFlightKey);
            if (
                Number.isFinite(this.allAbsentSince)
                && this.allAbsentSince !== episodeStart
            ) {
                this.refreshSchedules();
            }
        }
    }

    elapsedMinutes(episodeStart) {
        return Number(((this.now() - episodeStart) / 60000).toFixed(2));
    }

    getPeopleAutocomplete(query = "") {
        const normalizedQuery = String(query || "").trim().toLowerCase();
        return [...this.users.values()]
            .filter((user) => !normalizedQuery || user.name.toLowerCase().includes(normalizedQuery))
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((user) => ({ id: user.id, name: user.name }));
    }

    persistState() {
        const state = {
            version: 1,
            users: Object.fromEntries(this.users),
            allAbsentSince: this.allAbsentSince,
            lastPersonName: this.lastPersonName,
            firedPerson: this.firedPerson,
            firedEveryone: this.firedEveryone,
            updatedAt: new Date(this.now()).toISOString(),
        };
        this.persistPromise = this.persistPromise
            .catch(() => {})
            .then(() => Promise.resolve(this.homey.settings.set(PRESENCE_STATE_KEY, state)))
            .catch((error) => {
                this.logger.error("Could not persist presence state", error);
            });
        return this.persistPromise;
    }

    async destroy() {
        this.destroyed = true;
        if (this.userRefreshTimer) clearTimeout(this.userRefreshTimer);
        if (this.flowRefreshTimer) clearTimeout(this.flowRefreshTimer);
        this.userRefreshTimer = null;
        this.flowRefreshTimer = null;

        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
        for (const { manager, event, listener } of this.managerListeners) {
            if (typeof manager.removeListener === "function") {
                manager.removeListener(event, listener);
            }
        }
        this.managerListeners = [];
        await this.persistPromise;
    }
}

PresenceManager.PRESENCE_STATE_KEY = PRESENCE_STATE_KEY;
PresenceManager.PERSON_TRIGGER_ID = PERSON_TRIGGER_ID;
PresenceManager.EVERYONE_TRIGGER_ID = EVERYONE_TRIGGER_ID;
PresenceManager.MIN_DELAY_MINUTES = MIN_DELAY_MINUTES;
PresenceManager.MAX_DELAY_MINUTES = MAX_DELAY_MINUTES;

module.exports = PresenceManager;
