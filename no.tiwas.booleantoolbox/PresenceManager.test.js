"use strict";

const { EventEmitter } = require("node:events");
const PresenceManager = require("./lib/PresenceManager");

class MockManager extends EventEmitter {
    constructor(getValues) {
        super();
        this.getValues = getValues;
        this.connect = jest.fn(async () => {});
    }
}

function trigger(id, args) {
    return {
        id: `homey:app:no.tiwas.booleantoolbox:${id}`,
        args,
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function createHarness({ users, flows = {}, advancedFlows = {}, stored = null }) {
    let persisted = stored;
    const usersManager = new MockManager(() => users);
    usersManager.getUsers = jest.fn(async () => usersManager.getValues());

    const flowManager = new MockManager(() => flows);
    flowManager.getFlows = jest.fn(async () => flowManager.getValues());
    flowManager.getAdvancedFlows = jest.fn(async () => advancedFlows);

    const personCard = { trigger: jest.fn(async () => {}) };
    const everyoneCard = { trigger: jest.fn(async () => {}) };
    const logger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
    const homey = {
        manifest: { id: "no.tiwas.booleantoolbox" },
        settings: {
            get: jest.fn(() => persisted),
            set: jest.fn(async (key, value) => {
                persisted = value;
            }),
        },
    };
    const api = { users: usersManager, flow: flowManager };
    const manager = new PresenceManager({
        homey,
        logger,
        getApi: jest.fn(async () => api),
    });
    manager.setTriggerCards({ person: personCard, everyone: everyoneCard });

    return {
        manager,
        usersManager,
        flowManager,
        personCard,
        everyoneCard,
        getPersisted: () => persisted,
    };
}

describe("PresenceManager", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-10-13T08:00:00.000Z"));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test("fires a person trigger after the configured continuous absence", async () => {
        const users = {
            userA: { id: "userA", name: "Ada", enabled: true, present: true },
        };
        const flows = {
            flowA: {
                enabled: true,
                trigger: trigger(PresenceManager.PERSON_TRIGGER_ID, {
                    person: { id: "userA", name: "Ada" },
                    minutes: 5,
                }),
            },
        };
        const harness = createHarness({ users, flows });
        await harness.manager.init();

        users.userA.present = false;
        harness.usersManager.emit("user.update", users.userA);
        await jest.advanceTimersByTimeAsync(100);
        await jest.advanceTimersByTimeAsync(5 * 60 * 1000);

        expect(harness.personCard.trigger).toHaveBeenCalledTimes(1);
        expect(harness.personCard.trigger).toHaveBeenCalledWith(
            expect.objectContaining({
                person_name: "Ada",
                away_minutes: 5,
                away_since: "2026-10-13T08:00:00.000Z",
            }),
            { person_id: "userA", minutes: 5 },
        );

        await harness.manager.destroy();
    });

    test("a return cancels a pending person trigger", async () => {
        const users = {
            userA: { id: "userA", name: "Ada", enabled: true, present: true },
        };
        const flows = {
            flowA: {
                enabled: true,
                trigger: trigger(PresenceManager.PERSON_TRIGGER_ID, {
                    person: { id: "userA", name: "Ada" },
                    minutes: 5,
                }),
            },
        };
        const harness = createHarness({ users, flows });
        await harness.manager.init();

        users.userA.present = false;
        harness.usersManager.emit("user.update", users.userA);
        await jest.advanceTimersByTimeAsync(5 * 60 * 1000 - 50);
        users.userA.present = true;
        harness.usersManager.emit("user.update", users.userA);
        await jest.advanceTimersByTimeAsync(100);

        expect(harness.personCard.trigger).not.toHaveBeenCalled();
        await harness.manager.destroy();
    });

    test("re-arms a new person absence after the previous trigger settles", async () => {
        const users = {
            userA: { id: "userA", name: "Ada", enabled: true, present: true },
        };
        const flows = {
            flowA: {
                enabled: true,
                trigger: trigger(PresenceManager.PERSON_TRIGGER_ID, {
                    person: { id: "userA", name: "Ada" },
                    minutes: 1,
                }),
            },
        };
        const firstTrigger = deferred();
        const harness = createHarness({ users, flows });
        harness.personCard.trigger
            .mockImplementationOnce(() => firstTrigger.promise)
            .mockResolvedValue(undefined);
        await harness.manager.init();

        users.userA.present = false;
        harness.usersManager.emit("user.update", users.userA);
        await jest.advanceTimersByTimeAsync(60 * 1000);
        expect(harness.personCard.trigger).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(5 * 1000);
        users.userA.present = true;
        harness.usersManager.emit("user.update", users.userA);
        await jest.advanceTimersByTimeAsync(1000);
        users.userA.present = false;
        harness.usersManager.emit("user.update", users.userA);
        await jest.advanceTimersByTimeAsync(30 * 1000);
        expect(harness.personCard.trigger).toHaveBeenCalledTimes(1);

        firstTrigger.resolve();
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(29 * 1000 + 999);
        expect(harness.personCard.trigger).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);

        expect(harness.personCard.trigger).toHaveBeenCalledTimes(2);
        expect(harness.personCard.trigger).toHaveBeenLastCalledWith(
            expect.objectContaining({
                away_minutes: 1,
                away_since: "2026-10-13T08:01:06.000Z",
            }),
            { person_id: "userA", minutes: 1 },
        );
        await harness.manager.destroy();
    });

    test("starts the everyone timer when the last present person leaves", async () => {
        const users = {
            userA: { id: "userA", name: "Ada", enabled: true, present: false },
            userB: { id: "userB", name: "Ben", enabled: true, present: true },
        };
        const advancedFlows = {
            advancedA: {
                enabled: true,
                cards: {
                    cardA: {
                        ...trigger(PresenceManager.EVERYONE_TRIGGER_ID, { minutes: 2 }),
                        type: "trigger",
                    },
                },
            },
        };
        const harness = createHarness({ users, advancedFlows });
        await harness.manager.init();

        users.userB.present = false;
        harness.usersManager.emit("user.update", users.userB);
        await jest.advanceTimersByTimeAsync(100);
        await jest.advanceTimersByTimeAsync(2 * 60 * 1000);

        expect(harness.everyoneCard.trigger).toHaveBeenCalledTimes(1);
        expect(harness.everyoneCard.trigger).toHaveBeenCalledWith(
            expect.objectContaining({
                away_minutes: 2,
                people_count: 2,
                last_person_name: "Ben",
            }),
            { minutes: 2 },
        );

        await harness.manager.destroy();
    });

    test("any return cancels a pending everyone trigger", async () => {
        const users = {
            userA: { id: "userA", name: "Ada", enabled: true, present: false },
            userB: { id: "userB", name: "Ben", enabled: true, present: false },
        };
        const flows = {
            flowA: {
                enabled: true,
                trigger: trigger(PresenceManager.EVERYONE_TRIGGER_ID, { minutes: 5 }),
            },
        };
        const harness = createHarness({ users, flows });
        await harness.manager.init();
        await jest.advanceTimersByTimeAsync(2 * 60 * 1000);

        users.userA.present = true;
        harness.usersManager.emit("user.update", users.userA);
        await jest.advanceTimersByTimeAsync(100);
        await jest.advanceTimersByTimeAsync(5 * 60 * 1000);

        expect(harness.everyoneCard.trigger).not.toHaveBeenCalled();
        await harness.manager.destroy();
    });

    test("re-arms a new everyone-away episode after the previous trigger settles", async () => {
        const users = {
            userA: { id: "userA", name: "Ada", enabled: true, present: true },
            userB: { id: "userB", name: "Ben", enabled: true, present: false },
        };
        const flows = {
            flowA: {
                enabled: true,
                trigger: trigger(PresenceManager.EVERYONE_TRIGGER_ID, { minutes: 1 }),
            },
        };
        const firstTrigger = deferred();
        const harness = createHarness({ users, flows });
        harness.everyoneCard.trigger
            .mockImplementationOnce(() => firstTrigger.promise)
            .mockResolvedValue(undefined);
        await harness.manager.init();

        users.userA.present = false;
        harness.usersManager.emit("user.update", users.userA);
        await jest.advanceTimersByTimeAsync(60 * 1000);
        expect(harness.everyoneCard.trigger).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(5 * 1000);
        users.userA.present = true;
        harness.usersManager.emit("user.update", users.userA);
        await jest.advanceTimersByTimeAsync(1000);
        users.userA.present = false;
        harness.usersManager.emit("user.update", users.userA);
        await jest.advanceTimersByTimeAsync(30 * 1000);
        expect(harness.everyoneCard.trigger).toHaveBeenCalledTimes(1);

        firstTrigger.resolve();
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(29 * 1000 + 999);
        expect(harness.everyoneCard.trigger).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);

        expect(harness.everyoneCard.trigger).toHaveBeenCalledTimes(2);
        expect(harness.everyoneCard.trigger).toHaveBeenLastCalledWith(
            expect.objectContaining({
                away_minutes: 1,
                away_since: "2026-10-13T08:01:06.000Z",
                last_person_name: "Ada",
            }),
            { minutes: 1 },
        );
        await harness.manager.destroy();
    });

    test("resumes a pending absence countdown after an app restart", async () => {
        const users = {
            userA: { id: "userA", name: "Ada", enabled: true, present: false },
        };
        const flows = {
            flowA: {
                enabled: true,
                trigger: trigger(PresenceManager.PERSON_TRIGGER_ID, {
                    person: { id: "userA", name: "Ada" },
                    minutes: 2,
                }),
            },
        };
        const first = createHarness({ users, flows });
        await first.manager.init();
        await jest.advanceTimersByTimeAsync(60 * 1000);
        const persisted = first.getPersisted();
        await first.manager.destroy();

        const restarted = createHarness({ users, flows, stored: persisted });
        await restarted.manager.init();
        await jest.advanceTimersByTimeAsync(59 * 1000);
        expect(restarted.personCard.trigger).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1000);

        expect(restarted.personCard.trigger).toHaveBeenCalledTimes(1);
        await restarted.manager.destroy();
    });

    test("does not repeat an already-fired threshold after an app restart", async () => {
        const users = {
            userA: { id: "userA", name: "Ada", enabled: true, present: false },
        };
        const flows = {
            flowA: {
                enabled: true,
                trigger: trigger(PresenceManager.PERSON_TRIGGER_ID, {
                    person: { id: "userA", name: "Ada" },
                    minutes: 1,
                }),
            },
        };
        const first = createHarness({ users, flows });
        await first.manager.init();
        await jest.advanceTimersByTimeAsync(60 * 1000);
        expect(first.personCard.trigger).toHaveBeenCalledTimes(1);
        const persisted = first.getPersisted();
        await first.manager.destroy();

        const restarted = createHarness({ users, flows, stored: persisted });
        await restarted.manager.init();
        await jest.advanceTimersByTimeAsync(5 * 60 * 1000);

        expect(restarted.personCard.trigger).not.toHaveBeenCalled();
        await restarted.manager.destroy();
    });

    test("run listeners match both the target and configured delay", () => {
        expect(PresenceManager.personRunMatches(
            { person: { id: "userA" }, minutes: 5 },
            { person_id: "userA", minutes: 5 },
        )).toBe(true);
        expect(PresenceManager.personRunMatches(
            { person: { id: "userB" }, minutes: 5 },
            { person_id: "userA", minutes: 5 },
        )).toBe(false);
        expect(PresenceManager.everyoneRunMatches(
            { minutes: 10 },
            { minutes: 10 },
        )).toBe(true);
        expect(PresenceManager.everyoneRunMatches(
            { minutes: 15 },
            { minutes: 10 },
        )).toBe(false);
    });
});
