const fs = require("node:fs");
const path = require("node:path");

jest.mock("homey", () => ({
    App: class {},
}), { virtual: true });

jest.mock("./lib/Logger", () => class MockLogger {
    banner() {}
    debug() {}
    error() {}
    flow() {}
    warn() {}
    info() {}
});

jest.mock("./lib/CapturedStateManager", () => jest.fn());

const WaiterManager = require("./lib/WaiterManager");
const BooleanToolboxApp = require("./app");

const SAFE_WAIT_MS = 55000;
const GATE = { name: "Razor", id: "Razor" };
const DEVICE = { id: "device-1", name: "Razor", capabilities: ["onoff", "dim"] };

function createLogger() {
    return {
        banner: jest.fn(),
        debug: jest.fn(),
        error: jest.fn(),
        flow: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
    };
}

function createCard() {
    return {
        autocomplete: {},
        registerRunListener(listener) {
            this.runListener = listener;
            return this;
        },
        registerArgumentAutocompleteListener(name, listener) {
            this.autocomplete[name] = listener;
            return this;
        },
        trigger: jest.fn().mockResolvedValue(undefined),
    };
}

// Records how (and how often) a Flow card run settled.
function track(promise) {
    const outcome = { settled: false, count: 0, value: undefined, error: undefined };
    promise.then(
        (value) => { outcome.settled = true; outcome.count++; outcome.value = value; },
        (error) => { outcome.settled = true; outcome.count++; outcome.error = error; },
    );
    return outcome;
}

async function flush() {
    for (let index = 0; index < 20; index++) await Promise.resolve();
}

async function createApp() {
    const actionCards = new Map();
    const conditionCards = new Map();
    const triggerCards = new Map();
    const getCard = (cards, id) => {
        if (!cards.has(id)) cards.set(id, createCard());
        return cards.get(id);
    };

    const app = new BooleanToolboxApp();
    app.logger = createLogger();
    app.homey = {
        __: jest.fn((key) => key),
        flow: {
            getActionCard: (id) => getCard(actionCards, id),
            getConditionCard: (id) => getCard(conditionCards, id),
            getTriggerCard: (id) => getCard(triggerCards, id),
        },
    };

    WaiterManager.instance = null;
    app.waiterManager = new WaiterManager(app.homey, app.logger);

    const capabilityValues = { onoff: false, dim: 0.3 };
    const capabilityInstances = [];
    const apiDevice = {
        makeCapabilityInstance: jest.fn(async (capability, listener) => {
            const instance = { capability, listener, destroy: jest.fn() };
            capabilityInstances.push(instance);
            return instance;
        }),
    };
    app.api = { devices: { getDevice: jest.fn(async () => apiDevice) } };
    app.getApiDevice = jest.fn(async () => ({
        capabilitiesObj: {
            onoff: { value: capabilityValues.onoff },
            dim: { value: capabilityValues.dim },
        },
    }));

    await app.registerAllFlowCards();

    return {
        app,
        manager: app.waiterManager,
        capabilityValues,
        capabilityInstances,
        action: (id) => actionCards.get(id),
        condition: (id) => conditionCards.get(id),
        trigger: (id) => triggerCards.get(id),
    };
}

describe("Flow card wait limit (issue #46)", () => {
    let ctx;

    beforeEach(async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-09-29T12:00:00.000Z"));
        ctx = await createApp();
    });

    afterEach(() => {
        ctx.manager.destroy();
        WaiterManager.instance = null;
        jest.useRealTimers();
    });

    function startGateCondition(overrides = {}) {
        return ctx.condition("conditional_gate_start").runListener({
            gate_name: GATE,
            default_state: "NO_GO",
            timeout_value: 2,
            timeout_unit: "m",
            ...overrides,
        }, {});
    }

    function modifyGate(overrides = {}) {
        return ctx.action("conditional_gate_modify").runListener({
            gate_name: GATE,
            new_state: "NO_CHANGE",
            new_timeout_value: -1,
            new_timeout_unit: "s",
            ...overrides,
        }, {});
    }

    function startCapabilityCondition(overrides = {}) {
        return ctx.condition("wait_until_becomes_true").runListener({
            device: DEVICE,
            capability: { id: "onoff", name: "onoff" },
            target_value: "true",
            timeout_value: 2,
            timeout_unit: "m",
            waiter_id: { id: "Wait_OSB_Motion", name: "Wait_OSB_Motion" },
            ...overrides,
        }, {});
    }

    describe("in-card condition guard", () => {
        test("conditional_gate_start ends at 55 s with guidance when the timeout is longer", async () => {
            const run = track(startGateCondition());
            await flush();
            expect(ctx.manager.waiters.size).toBe(1);

            await jest.advanceTimersByTimeAsync(SAFE_WAIT_MS - 1);
            expect(run.settled).toBe(false);

            await jest.advanceTimersByTimeAsync(1);
            expect(run.count).toBe(1);
            expect(run.error.message).toContain("Homey stops app Flow cards after 60 seconds");
            expect(run.error.message).toContain("Start waiting for Conditional Gate GO");
            expect(run.error.message).toContain("Conditional Gate wait finished");
            expect(ctx.manager.waiters.size).toBe(0);
            expect(ctx.manager.virtualGates.get("Razor").waiters.size).toBe(0);
            // Only the WaiterManager orphan-cleanup interval remains.
            expect(jest.getTimerCount()).toBe(1);
        });

        test("short gate timeouts keep resolving through the NO path (gate 'butter', 1 s)", async () => {
            const run = track(startGateCondition({ gate_name: { name: "butter", id: "butter" }, timeout_value: 1, timeout_unit: "s" }));
            await flush();

            await jest.advanceTimersByTimeAsync(1000);
            expect(run.count).toBe(1);
            expect(run.value).toBe(false);

            await jest.advanceTimersByTimeAsync(SAFE_WAIT_MS);
            expect(run.count).toBe(1);
            expect(run.error).toBeUndefined();
            expect(jest.getTimerCount()).toBe(1);
        });

        test("GO within 55 s resolves YES and disarms the guard (reporter's modify: GO + 1 s)", async () => {
            const run = track(startGateCondition());
            await flush();
            await jest.advanceTimersByTimeAsync(20000);

            await expect(modifyGate({ new_state: "GO", new_timeout_value: 1, new_timeout_unit: "s" }))
                .resolves.toEqual({ gate_state: true });
            await flush();

            expect(run.value).toBe(true);
            await jest.advanceTimersByTimeAsync(60000);
            expect(run.count).toBe(1);
            expect(jest.getTimerCount()).toBe(1);
        });

        test("modifying the timeout of an in-card gate wait still works", async () => {
            const run = track(startGateCondition());
            await flush();
            await jest.advanceTimersByTimeAsync(10000);

            await modifyGate({ new_timeout_value: 1, new_timeout_unit: "s" });
            await jest.advanceTimersByTimeAsync(1000);

            expect(run.count).toBe(1);
            expect(run.value).toBe(false);
        });

        test("timeout 0 on a NO GO gate still returns false immediately", async () => {
            await expect(startGateCondition({ timeout_value: 0 })).resolves.toBe(false);
            expect(ctx.manager.waiters.size).toBe(0);
        });

        test("wait_until_becomes_true with no timeout ends at 55 s and releases its listener", async () => {
            const run = track(startCapabilityCondition({ timeout_value: 0 }));
            await flush();
            expect(ctx.capabilityInstances).toHaveLength(1);

            await jest.advanceTimersByTimeAsync(SAFE_WAIT_MS);

            expect(run.count).toBe(1);
            expect(run.error.message).toContain("Start waiting until device capability becomes value");
            expect(run.error.message).toContain("Capability wait finished");
            expect(ctx.manager.waiters.has("Wait_OSB_Motion")).toBe(false);
            expect(ctx.capabilityInstances[0].destroy).toHaveBeenCalledTimes(1);
            expect(jest.getTimerCount()).toBe(1);
        });

        test("wait_until_becomes_true resolves YES when the value arrives within 55 s", async () => {
            const run = track(startCapabilityCondition());
            await flush();
            await jest.advanceTimersByTimeAsync(30000);

            await ctx.capabilityInstances[0].listener(true);
            await flush();

            expect(run.value).toBe(true);
            await jest.advanceTimersByTimeAsync(60000);
            expect(run.count).toBe(1);
            expect(jest.getTimerCount()).toBe(1);
        });

        test("re-initializing the same waiter ID settles the previous run once and its guard spares the successor", async () => {
            const first = track(startCapabilityCondition());
            await flush();
            const firstWaiter = ctx.manager.waiters.get("Wait_OSB_Motion");

            await jest.advanceTimersByTimeAsync(20000);
            const second = track(startCapabilityCondition());
            await flush();
            const secondWaiter = ctx.manager.waiters.get("Wait_OSB_Motion");

            expect(secondWaiter).not.toBe(firstWaiter);
            expect(first.count).toBe(1);
            expect(first.value).toBe(false);
            expect(ctx.capabilityInstances[0].destroy).toHaveBeenCalledTimes(1);

            // The first run's guard would have fired at 55 s.
            await jest.advanceTimersByTimeAsync(SAFE_WAIT_MS - 20000);
            expect(first.count).toBe(1);
            expect(second.settled).toBe(false);
            expect(ctx.manager.waiters.get("Wait_OSB_Motion")).toBe(secondWaiter);
            expect(ctx.capabilityInstances[1].destroy).not.toHaveBeenCalled();

            // The second run's own guard fires 55 s after it started.
            await jest.advanceTimersByTimeAsync(20000);
            expect(second.count).toBe(1);
            expect(second.error.message).toContain("Homey stops app Flow cards after 60 seconds");
            expect(ctx.manager.waiters.has("Wait_OSB_Motion")).toBe(false);
            expect(first.count).toBe(1);
        });

        test("a stale guard never removes a new waiter that reuses the ID", async () => {
            const first = track(startCapabilityCondition());
            await flush();

            await jest.advanceTimersByTimeAsync(10000);
            await ctx.action("control_waiter").runListener({ waiter_id: "Wait_OSB_Motion", action: "stop" }, {});

            await jest.advanceTimersByTimeAsync(10000);
            const second = track(startCapabilityCondition());
            await flush();
            const secondWaiter = ctx.manager.waiters.get("Wait_OSB_Motion");

            await jest.advanceTimersByTimeAsync(SAFE_WAIT_MS - 20000);
            expect(first.count).toBe(1);
            expect(first.error.message).toContain("Homey stops app Flow cards after 60 seconds");
            expect(ctx.manager.waiters.get("Wait_OSB_Motion")).toBe(secondWaiter);
            expect(ctx.capabilityInstances[1].destroy).not.toHaveBeenCalled();
            expect(second.settled).toBe(false);

            await ctx.capabilityInstances[1].listener(true);
            await flush();
            expect(second.value).toBe(true);
        });
    });

    describe("wait action", () => {
        test("rejects waits longer than 55 s immediately with guidance", async () => {
            await expect(ctx.action("wait").runListener({ timeout_value: 2, timeout_unit: "m" }, {}))
                .rejects.toThrow("Use Homey's built-in Flow delay for longer waits.");
            await expect(ctx.action("wait").runListener({ timeout_value: 60000, timeout_unit: "ms" }, {}))
                .rejects.toThrow("limited to 55 seconds");
            expect(jest.getTimerCount()).toBe(1);
        });

        test("uses the translated message when available", async () => {
            ctx.app.homey.__.mockImplementation((key) => key === "errors.flow_card_wait_limit_wait" ? "Oversatt melding" : key);

            await expect(ctx.action("wait").runListener({ timeout_value: 1, timeout_unit: "h" }, {}))
                .rejects.toThrow("Oversatt melding");
        });

        test("short waits are unchanged", async () => {
            const run = track(ctx.action("wait").runListener({ timeout_value: 55, timeout_unit: "s" }, {}));
            await jest.advanceTimersByTimeAsync(54999);
            expect(run.settled).toBe(false);

            await jest.advanceTimersByTimeAsync(1);
            expect(run.value).toBe(true);
        });
    });

    describe("background Conditional Gate wait", () => {
        function startGateWait(overrides = {}) {
            return ctx.action("conditional_gate_start_wait").runListener({
                gate_name: GATE,
                default_state: "NO_GO",
                timeout_value: 2,
                timeout_unit: "m",
                ...overrides,
            }, {});
        }

        const finished = () => ctx.trigger("conditional_gate_wait_finished").trigger;

        test("returns immediately and fires GO when the gate opens after more than a minute", async () => {
            await expect(startGateWait()).resolves.toBe(true);
            expect(ctx.manager.waiters.get("gate_Razor_background").background).toBe(true);

            await jest.advanceTimersByTimeAsync(70000);
            expect(finished()).not.toHaveBeenCalled();

            await modifyGate({ new_state: "GO" });

            expect(finished()).toHaveBeenCalledTimes(1);
            expect(finished()).toHaveBeenCalledWith(
                { opened: true, result: "GO", waited_seconds: 70 },
                { gate_name: "Razor" },
            );
            expect(ctx.manager.waiters.size).toBe(0);
        });

        test("fires TIMEOUT when the gate stays NO GO", async () => {
            await startGateWait();

            await jest.advanceTimersByTimeAsync(120000);

            expect(finished()).toHaveBeenCalledTimes(1);
            expect(finished()).toHaveBeenCalledWith(
                { opened: false, result: "TIMEOUT", waited_seconds: 120 },
                { gate_name: "Razor" },
            );
            expect(ctx.manager.waiters.size).toBe(0);
        });

        test("fires GO immediately when the gate is already GO", async () => {
            await modifyGate({ new_state: "GO" });

            await startGateWait();

            expect(finished()).toHaveBeenCalledWith(
                { opened: true, result: "GO", waited_seconds: 0 },
                { gate_name: "Razor" },
            );
            expect(ctx.manager.waiters.size).toBe(0);
        });

        test("starting again restarts the wait without firing the replaced one", async () => {
            await startGateWait();
            const firstWaiter = ctx.manager.waiters.get("gate_Razor_background");

            await jest.advanceTimersByTimeAsync(60000);
            await startGateWait();
            expect(ctx.manager.waiters.get("gate_Razor_background")).not.toBe(firstWaiter);
            expect(ctx.manager.virtualGates.get("Razor").waiters.size).toBe(1);

            await jest.advanceTimersByTimeAsync(60000);
            expect(finished()).not.toHaveBeenCalled();

            await jest.advanceTimersByTimeAsync(60000);
            expect(finished()).toHaveBeenCalledTimes(1);
            expect(finished()).toHaveBeenCalledWith(
                { opened: false, result: "TIMEOUT", waited_seconds: 120 },
                { gate_name: "Razor" },
            );
        });

        test("Modify Conditional Gate timeout changes apply to background waits", async () => {
            await startGateWait({ timeout_value: 10 });
            await jest.advanceTimersByTimeAsync(10000);

            await modifyGate({ new_timeout_value: 5, new_timeout_unit: "s" });
            await jest.advanceTimersByTimeAsync(4999);
            expect(finished()).not.toHaveBeenCalled();

            await jest.advanceTimersByTimeAsync(1);
            expect(finished()).toHaveBeenCalledWith(
                { opened: false, result: "TIMEOUT", waited_seconds: 15 },
                { gate_name: "Razor" },
            );
        });

        test("GO together with a new timeout (reporter's modify card) finishes as GO", async () => {
            await startGateWait();
            await jest.advanceTimersByTimeAsync(90000);

            await modifyGate({ new_state: "GO", new_timeout_value: 1, new_timeout_unit: "s" });
            await jest.advanceTimersByTimeAsync(5000);

            expect(finished()).toHaveBeenCalledTimes(1);
            expect(finished()).toHaveBeenCalledWith(
                { opened: true, result: "GO", waited_seconds: 90 },
                { gate_name: "Razor" },
            );
        });

        test("timeout 0 waits until GO and is reaped as TIMEOUT after 24 hours", async () => {
            await startGateWait({ timeout_value: 0 });

            await jest.advanceTimersByTimeAsync(3 * 3600000);
            expect(finished()).not.toHaveBeenCalled();
            expect(ctx.manager.waiters.has("gate_Razor_background")).toBe(true);

            await jest.advanceTimersByTimeAsync(ctx.manager.MAX_ORPHAN_AGE_MS);
            expect(finished()).toHaveBeenCalledTimes(1);
            expect(finished().mock.calls[0][0]).toEqual(expect.objectContaining({ opened: false, result: "TIMEOUT" }));
        });

        test("stopping the background waiter never fires the trigger", async () => {
            await startGateWait();

            await ctx.action("control_waiter").runListener({ waiter_id: "gate_Razor_background", action: "stop" }, {});
            await jest.advanceTimersByTimeAsync(5 * 60000);
            await modifyGate({ new_state: "GO" });

            expect(finished()).not.toHaveBeenCalled();
            expect(ctx.manager.waiters.size).toBe(0);
        });

        test("the finished trigger matches the gate name exactly", async () => {
            const listener = ctx.trigger("conditional_gate_wait_finished").runListener;

            await expect(listener({ gate_name: GATE }, { gate_name: "Razor" })).resolves.toBe(true);
            await expect(listener({ gate_name: "Razor" }, { gate_name: "Razor" })).resolves.toBe(true);
            await expect(listener({ gate_name: GATE }, { gate_name: "razor" })).resolves.toBe(false);
            await expect(listener({ gate_name: { name: "Razor2", id: "Razor2" } }, { gate_name: "Razor" })).resolves.toBe(false);
        });
    });

    describe("background capability wait", () => {
        function startCapabilityWait(overrides = {}) {
            return ctx.action("wait_until_start").runListener({
                device: DEVICE,
                capability: { id: "onoff", name: "onoff" },
                target_value: "true",
                timeout_value: 5,
                timeout_unit: "m",
                waiter_id: { id: "kettle_boil", name: "kettle_boil" },
                ...overrides,
            }, {});
        }

        const finished = () => ctx.trigger("wait_until_finished").trigger;

        test("fires MATCHED immediately when the value already matches", async () => {
            ctx.capabilityValues.onoff = true;

            await expect(startCapabilityWait()).resolves.toBe(true);

            expect(finished()).toHaveBeenCalledWith(
                { matched: true, result: "MATCHED", value: "true", waited_seconds: 0 },
                { waiter_id: "kettle_boil" },
            );
            expect(ctx.manager.waiters.size).toBe(0);
            expect(ctx.capabilityInstances).toHaveLength(0);
        });

        test("returns immediately and fires MATCHED when the value arrives after more than a minute", async () => {
            await startCapabilityWait();
            expect(ctx.manager.waiters.get("kettle_boil").background).toBe(true);

            await jest.advanceTimersByTimeAsync(90000);
            await ctx.capabilityInstances[0].listener(true);

            expect(finished()).toHaveBeenCalledTimes(1);
            expect(finished()).toHaveBeenCalledWith(
                { matched: true, result: "MATCHED", value: "true", waited_seconds: 90 },
                { waiter_id: "kettle_boil" },
            );
            expect(ctx.capabilityInstances[0].destroy).toHaveBeenCalledTimes(1);
            expect(ctx.manager.waiters.size).toBe(0);
        });

        test("fires TIMEOUT with the last known value", async () => {
            await startCapabilityWait({
                capability: { id: "dim", name: "dim" },
                target_value: "1",
                timeout_value: 2,
                waiter_id: "dim_wait",
            });

            await jest.advanceTimersByTimeAsync(30000);
            await ctx.capabilityInstances[0].listener(0.5);
            await jest.advanceTimersByTimeAsync(90000);

            expect(finished()).toHaveBeenCalledTimes(1);
            expect(finished()).toHaveBeenCalledWith(
                { matched: false, result: "TIMEOUT", value: "0.5", waited_seconds: 120 },
                { waiter_id: "dim_wait" },
            );
            expect(ctx.capabilityInstances[0].destroy).toHaveBeenCalledTimes(1);
        });

        test("starting again with the same waiter ID restarts the wait instead of failing", async () => {
            await startCapabilityWait();

            await jest.advanceTimersByTimeAsync(60000);
            await expect(startCapabilityWait()).resolves.toBe(true);
            expect(ctx.capabilityInstances[0].destroy).toHaveBeenCalledTimes(1);

            // Late event on the replaced listener is ignored.
            await ctx.capabilityInstances[0].listener(true);
            expect(finished()).not.toHaveBeenCalled();
            expect(ctx.manager.waiters.has("kettle_boil")).toBe(true);

            await jest.advanceTimersByTimeAsync(4 * 60000);
            expect(finished()).not.toHaveBeenCalled();

            await jest.advanceTimersByTimeAsync(60000);
            expect(finished()).toHaveBeenCalledTimes(1);
            expect(finished()).toHaveBeenCalledWith(
                { matched: false, result: "TIMEOUT", value: "false", waited_seconds: 300 },
                { waiter_id: "kettle_boil" },
            );
        });

        test("stopping the background waiter never fires the trigger", async () => {
            await startCapabilityWait();

            await ctx.action("control_waiter").runListener({ waiter_id: { id: "kettle_boil", name: "kettle_boil" }, action: "stop" }, {});
            await jest.advanceTimersByTimeAsync(10 * 60000);

            expect(finished()).not.toHaveBeenCalled();
            expect(ctx.capabilityInstances[0].destroy).toHaveBeenCalledTimes(1);
        });

        test("rejects a capability that the device does not have", async () => {
            await expect(startCapabilityWait({ capability: "measure_power" }))
                .rejects.toThrow('Capability "measure_power" not found on device "Razor"');
            expect(ctx.manager.waiters.size).toBe(0);
        });

        test("the finished trigger matches the waiter ID exactly", async () => {
            const listener = ctx.trigger("wait_until_finished").runListener;

            await expect(listener({ waiter_id: { id: "kettle_boil", name: "kettle_boil" } }, { waiter_id: "kettle_boil" })).resolves.toBe(true);
            await expect(listener({ waiter_id: " kettle_boil " }, { waiter_id: "kettle_boil" })).resolves.toBe(true);
            await expect(listener({ waiter_id: "kettle" }, { waiter_id: "kettle_boil" })).resolves.toBe(false);
        });

        const deviceValue = (value) => ({ capabilitiesObj: { onoff: { value } } });

        // Queues the device lookups in call order: a value resolves at once, "deferred"
        // stays pending until the returned resolver is called. Later calls (the re-check
        // after the listener is installed) return false.
        function queueLookups(...specs) {
            const deferred = [];
            const lookup = jest.fn();
            for (const spec of specs) {
                if (spec === "deferred") {
                    lookup.mockImplementationOnce(() => new Promise((resolve) => { deferred.push(resolve); }));
                } else {
                    lookup.mockImplementationOnce(async () => deviceValue(spec));
                }
            }
            lookup.mockImplementation(async () => deviceValue(false));
            ctx.app.getApiDevice = lookup;
            return deferred;
        }

        test("overlapping starts: an older start whose lookup returns first is superseded; the newer MATCHED fires once", async () => {
            const pendingLookups = queueLookups(false, "deferred");

            const runA = startCapabilityWait(); // older
            const runB = startCapabilityWait(); // newer

            // Run A's lookup returns first, but run B has already started: A installs nothing.
            await expect(runA).resolves.toBe(true);
            expect(ctx.manager.waiters.has("kettle_boil")).toBe(false);
            expect(ctx.capabilityInstances).toHaveLength(0);

            pendingLookups[0](deviceValue(true));
            await expect(runB).resolves.toBe(true);

            expect(finished()).toHaveBeenCalledTimes(1);
            expect(finished()).toHaveBeenCalledWith(
                { matched: true, result: "MATCHED", value: "true", waited_seconds: 0 },
                { waiter_id: "kettle_boil" },
            );
            await jest.advanceTimersByTimeAsync(10 * 60000);
            expect(finished()).toHaveBeenCalledTimes(1);
            expect(ctx.manager.waiters.size).toBe(0);
        });

        test("overlapping starts: an older start whose lookup returns first never installs; only the newer wait is live", async () => {
            const pendingLookups = queueLookups(false, "deferred");

            const runA = startCapabilityWait();
            const runB = startCapabilityWait();
            await expect(runA).resolves.toBe(true);
            expect(ctx.manager.waiters.has("kettle_boil")).toBe(false);

            await jest.advanceTimersByTimeAsync(60000);
            pendingLookups[0](deviceValue(false));
            await expect(runB).resolves.toBe(true);
            expect(ctx.manager.waiters.get("kettle_boil").background).toBe(true);
            expect(ctx.capabilityInstances).toHaveLength(1);

            // The 60 s lookup counts against run B's 5 minutes.
            await jest.advanceTimersByTimeAsync(4 * 60000 - 1);
            expect(finished()).not.toHaveBeenCalled();
            await jest.advanceTimersByTimeAsync(1);
            expect(finished()).toHaveBeenCalledTimes(1);
            expect(finished()).toHaveBeenCalledWith(
                expect.objectContaining({ matched: false, result: "TIMEOUT", waited_seconds: 300 }),
                { waiter_id: "kettle_boil" },
            );
        });

        test("reverse order: an older, slower start that sees a match neither fires nor cancels the newer wait", async () => {
            const pendingLookups = queueLookups("deferred", false);

            const runA = startCapabilityWait(); // older, slow lookup
            const runB = startCapabilityWait(); // newer, installs its wait first
            await expect(runB).resolves.toBe(true);
            const newerWaiter = ctx.manager.waiters.get("kettle_boil");
            expect(newerWaiter.background).toBe(true);
            expect(ctx.capabilityInstances).toHaveLength(1);

            pendingLookups[0](deviceValue(true));
            await expect(runA).resolves.toBe(true);

            expect(finished()).not.toHaveBeenCalled();
            expect(ctx.manager.waiters.get("kettle_boil")).toBe(newerWaiter);
            expect(ctx.capabilityInstances[0].destroy).not.toHaveBeenCalled();

            // Only run B's wait reports.
            await ctx.capabilityInstances[0].listener(true);
            expect(finished()).toHaveBeenCalledTimes(1);
            expect(finished()).toHaveBeenCalledWith(
                expect.objectContaining({ matched: true, result: "MATCHED", value: "true" }),
                { waiter_id: "kettle_boil" },
            );
            await jest.advanceTimersByTimeAsync(10 * 60000);
            expect(finished()).toHaveBeenCalledTimes(1);
        });

        test("reverse order: an older, slower start that does not match never replaces the newer wait", async () => {
            const pendingLookups = queueLookups("deferred", false);

            const runA = startCapabilityWait();
            const runB = startCapabilityWait();
            await expect(runB).resolves.toBe(true);
            const newerWaiter = ctx.manager.waiters.get("kettle_boil");

            await jest.advanceTimersByTimeAsync(30000);
            pendingLookups[0](deviceValue(false));
            await expect(runA).resolves.toBe(true);

            expect(ctx.manager.waiters.get("kettle_boil")).toBe(newerWaiter);
            expect(ctx.capabilityInstances).toHaveLength(1);
            expect(ctx.capabilityInstances[0].destroy).not.toHaveBeenCalled();

            // Run B's own timeout (5 min after it started) is the only result.
            await jest.advanceTimersByTimeAsync(270000 - 1);
            expect(finished()).not.toHaveBeenCalled();
            await jest.advanceTimersByTimeAsync(1);
            expect(finished()).toHaveBeenCalledTimes(1);
            expect(finished()).toHaveBeenCalledWith(
                { matched: false, result: "TIMEOUT", value: "false", waited_seconds: 300 },
                { waiter_id: "kettle_boil" },
            );
        });

        test("overlapping starts: a replaced run never attaches its listener to the successor", async () => {
            let resolveFirstApi;
            const ensureHomeyApi = ctx.app.ensureHomeyApi.bind(ctx.app);
            ctx.app.ensureHomeyApi = jest.fn()
                .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstApi = resolve; }))
                .mockImplementation(ensureHomeyApi);

            // Run A has created its background wait and is waiting for the Homey API.
            const runA = startCapabilityWait();
            await flush();
            const firstWaiter = ctx.manager.waiters.get("kettle_boil");
            expect(firstWaiter.background).toBe(true);

            // Run B restarts the wait and installs its listener first.
            await expect(startCapabilityWait()).resolves.toBe(true);
            const secondWaiter = ctx.manager.waiters.get("kettle_boil");
            expect(secondWaiter).not.toBe(firstWaiter);

            resolveFirstApi(ctx.app.api);
            await expect(runA).resolves.toBe(true);

            expect(ctx.capabilityInstances).toHaveLength(1);
            expect(secondWaiter.capabilityListener.instance).toBe(ctx.capabilityInstances[0]);

            await ctx.capabilityInstances[0].listener(true);
            expect(finished()).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(10 * 60000);
            expect(finished()).toHaveBeenCalledTimes(1);
        });
    });

    describe("background wait IDs and setup time (Codex review)", () => {
        const deviceValue = (value) => ({ capabilitiesObj: { onoff: { value } } });
        const gateFinished = () => ctx.trigger("conditional_gate_wait_finished").trigger;
        const capabilityFinished = () => ctx.trigger("wait_until_finished").trigger;

        function startGateWait(overrides = {}) {
            return ctx.action("conditional_gate_start_wait").runListener({
                gate_name: GATE,
                default_state: "NO_GO",
                timeout_value: 2,
                timeout_unit: "m",
                ...overrides,
            }, {});
        }

        function startCapabilityWait(overrides = {}) {
            return ctx.action("wait_until_start").runListener({
                device: DEVICE,
                capability: { id: "onoff", name: "onoff" },
                target_value: "true",
                timeout_value: 10,
                timeout_unit: "s",
                waiter_id: "kettle_boil",
                ...overrides,
            }, {});
        }

        function slowLookup(delayMs, value = false) {
            ctx.app.getApiDevice = jest.fn(() => new Promise((resolve) => {
                setTimeout(() => resolve(deviceValue(value)), delayMs);
            }));
        }

        test("a capability wait cannot take over a gate wait's ID (gate_<name>_background)", async () => {
            await startGateWait();
            const gateWaiter = ctx.manager.waiters.get("gate_Razor_background");

            await expect(startCapabilityWait({ waiter_id: "gate_Razor_background" }))
                .rejects.toThrow('Waiter ID "gate_Razor_background" is already used by a Conditional Gate wait');

            expect(ctx.manager.waiters.get("gate_Razor_background")).toBe(gateWaiter);
            expect(ctx.capabilityInstances).toHaveLength(0);
            await modifyGate({ new_state: "GO" });
            expect(gateFinished()).toHaveBeenCalledWith(
                expect.objectContaining({ opened: true, result: "GO" }),
                { gate_name: "Razor" },
            );
            expect(capabilityFinished()).not.toHaveBeenCalled();
        });

        test("a gate wait cannot take over a capability wait that uses its ID", async () => {
            await startCapabilityWait({ waiter_id: "gate_Razor_background", timeout_value: 5, timeout_unit: "m" });
            const capabilityWaiter = ctx.manager.waiters.get("gate_Razor_background");
            expect(capabilityWaiter.kind).toBe("capability");

            await expect(startGateWait())
                .rejects.toThrow('Waiter ID "gate_Razor_background" is already used by a capability wait');
            // Also when the gate is already GO.
            await modifyGate({ new_state: "GO" });
            await expect(startGateWait())
                .rejects.toThrow('Waiter ID "gate_Razor_background" is already used by a capability wait');

            expect(ctx.manager.waiters.get("gate_Razor_background")).toBe(capabilityWaiter);
            expect(ctx.capabilityInstances[0].destroy).not.toHaveBeenCalled();
            expect(gateFinished()).not.toHaveBeenCalled();

            await ctx.capabilityInstances[0].listener(true);
            expect(capabilityFinished()).toHaveBeenCalledWith(
                expect.objectContaining({ matched: true, result: "MATCHED" }),
                { waiter_id: "gate_Razor_background" },
            );
        });

        test("a 30 s lookup with a 10 s timeout fires TIMEOUT right after the lookup", async () => {
            slowLookup(30000);

            const run = track(startCapabilityWait());
            await jest.advanceTimersByTimeAsync(30000 - 1);
            expect(capabilityFinished()).not.toHaveBeenCalled();

            await jest.advanceTimersByTimeAsync(1);
            expect(run.value).toBe(true);
            expect(capabilityFinished()).toHaveBeenCalledTimes(1);
            expect(capabilityFinished()).toHaveBeenCalledWith(
                { matched: false, result: "TIMEOUT", value: "false", waited_seconds: 30 },
                { waiter_id: "kettle_boil" },
            );
            expect(ctx.manager.waiters.size).toBe(0);
            expect(ctx.capabilityInstances).toHaveLength(0);
        });

        test("a matching value still wins when the lookup took longer than the timeout", async () => {
            slowLookup(30000, true);

            track(startCapabilityWait());
            await jest.advanceTimersByTimeAsync(30000);

            expect(capabilityFinished()).toHaveBeenCalledTimes(1);
            expect(capabilityFinished()).toHaveBeenCalledWith(
                expect.objectContaining({ matched: true, result: "MATCHED", value: "true" }),
                { waiter_id: "kettle_boil" },
            );
        });

        test("a 5 s lookup with a 10 s timeout fires TIMEOUT 10 s after the start", async () => {
            slowLookup(5000);

            track(startCapabilityWait());
            await jest.advanceTimersByTimeAsync(10000 - 1);
            expect(capabilityFinished()).not.toHaveBeenCalled();
            expect(ctx.manager.waiters.get("kettle_boil").background).toBe(true);

            await jest.advanceTimersByTimeAsync(1);
            expect(capabilityFinished()).toHaveBeenCalledTimes(1);
            expect(capabilityFinished()).toHaveBeenCalledWith(
                expect.objectContaining({ matched: false, result: "TIMEOUT", waited_seconds: 10 }),
                { waiter_id: "kettle_boil" },
            );
        });

        test("timeout 0 still means no timeout after a slow lookup", async () => {
            slowLookup(30000);

            track(startCapabilityWait({ timeout_value: 0 }));
            await jest.advanceTimersByTimeAsync(2 * 3600000);

            expect(capabilityFinished()).not.toHaveBeenCalled();
            const waiter = ctx.manager.waiters.get("kettle_boil");
            expect(waiter.timeoutMs).toBe(0);
            await ctx.capabilityInstances[0].listener(true);
            expect(capabilityFinished()).toHaveBeenCalledWith(
                expect.objectContaining({ matched: true, result: "MATCHED" }),
                { waiter_id: "kettle_boil" },
            );
        });
    });

    describe("disabled waiters stay waiting (Codex review)", () => {
        const control = (waiterId, action) =>
            ctx.action("control_waiter").runListener({ waiter_id: waiterId, action }, {});
        const gateFinished = () => ctx.trigger("conditional_gate_wait_finished").trigger;
        const capabilityFinished = () => ctx.trigger("wait_until_finished").trigger;

        function startGateWait() {
            return ctx.action("conditional_gate_start_wait").runListener({
                gate_name: GATE,
                default_state: "NO_GO",
                timeout_value: 2,
                timeout_unit: "m",
            }, {});
        }

        function startCapabilityWait() {
            return ctx.action("wait_until_start").runListener({
                device: DEVICE,
                capability: { id: "onoff", name: "onoff" },
                target_value: "true",
                timeout_value: 2,
                timeout_unit: "m",
                waiter_id: "kettle_boil",
            }, {});
        }

        test("a disabled background gate wait does not fire TIMEOUT until it is re-enabled", async () => {
            await startGateWait();
            await control("gate_Razor_background", "disable");

            await jest.advanceTimersByTimeAsync(3 * 60 * 1000);
            expect(gateFinished()).not.toHaveBeenCalled();
            expect(ctx.manager.waiters.has("gate_Razor_background")).toBe(true);

            await control("gate_Razor_background", "enable");
            expect(gateFinished()).toHaveBeenCalledTimes(1);
            expect(gateFinished()).toHaveBeenCalledWith(
                expect.objectContaining({ opened: false, result: "TIMEOUT" }),
                { gate_name: "Razor" },
            );
            expect(ctx.manager.waiters.size).toBe(0);
        });

        test("a gate that opens while the wait is disabled completes as GO on re-enable", async () => {
            await startGateWait();
            await control("gate_Razor_background", "disable");

            await ctx.action("conditional_gate_modify").runListener({
                gate_name: GATE, new_state: "GO", new_timeout_value: -1, new_timeout_unit: "s",
            }, {});
            expect(gateFinished()).not.toHaveBeenCalled();
            expect(ctx.manager.waiters.has("gate_Razor_background")).toBe(true);

            await control("gate_Razor_background", "enable");
            expect(gateFinished()).toHaveBeenCalledTimes(1);
            expect(gateFinished()).toHaveBeenCalledWith(
                expect.objectContaining({ opened: true, result: "GO" }),
                { gate_name: "Razor" },
            );
        });

        test("a matching value while disabled keeps the capability waiter so it can be re-enabled", async () => {
            await startCapabilityWait();
            await control("kettle_boil", "disable");

            await ctx.capabilityInstances[0].listener(true);
            expect(capabilityFinished()).not.toHaveBeenCalled();
            expect(ctx.manager.waiters.has("kettle_boil")).toBe(true);
            expect(ctx.capabilityInstances[0].destroy).not.toHaveBeenCalled();

            await control("kettle_boil", "enable");
            expect(capabilityFinished()).toHaveBeenCalledTimes(1);
            expect(capabilityFinished()).toHaveBeenCalledWith(
                expect.objectContaining({ matched: true, result: "MATCHED", value: "true" }),
                { waiter_id: "kettle_boil" },
            );
            expect(ctx.capabilityInstances[0].destroy).toHaveBeenCalledTimes(1);
        });

        test("re-enabling a capability waiter whose value went back keeps it waiting", async () => {
            await startCapabilityWait();
            await control("kettle_boil", "disable");

            await ctx.capabilityInstances[0].listener(true);
            await ctx.capabilityInstances[0].listener(false);
            await control("kettle_boil", "enable");

            expect(capabilityFinished()).not.toHaveBeenCalled();
            expect(ctx.manager.waiters.has("kettle_boil")).toBe(true);

            await ctx.capabilityInstances[0].listener(true);
            expect(capabilityFinished()).toHaveBeenCalledTimes(1);
        });

        test("a new timeout from Modify Conditional Gate replaces one that elapsed while disabled", async () => {
            await startGateWait();
            await control("gate_Razor_background", "disable");
            await jest.advanceTimersByTimeAsync(3 * 60 * 1000);

            await ctx.action("conditional_gate_modify").runListener({
                gate_name: GATE, new_state: "NO_CHANGE", new_timeout_value: 1, new_timeout_unit: "m",
            }, {});
            await control("gate_Razor_background", "enable");
            expect(gateFinished()).not.toHaveBeenCalled();

            await jest.advanceTimersByTimeAsync(60 * 1000);
            expect(gateFinished()).toHaveBeenCalledTimes(1);
            expect(gateFinished()).toHaveBeenCalledWith(
                expect.objectContaining({ opened: false, result: "TIMEOUT" }),
                { gate_name: "Razor" },
            );
        });

        test("a disabled waiter whose timeout elapsed is reaped silently after the orphan age", async () => {
            await startGateWait();
            await control("gate_Razor_background", "disable");

            await jest.advanceTimersByTimeAsync(ctx.manager.MAX_ORPHAN_AGE_MS + 3 * 60 * 1000);
            expect(ctx.manager.waiters.size).toBe(0);
            expect(gateFinished()).not.toHaveBeenCalled();
        });
    });

    describe("value re-check after the listener is installed (Codex review)", () => {
        function changeValueDuringListenerSetup(value) {
            const apiDevice = { makeCapabilityInstance: null };
            apiDevice.makeCapabilityInstance = jest.fn(async (capability, listener) => {
                // The device reaches the target between the first read and the
                // subscription, so no change event is ever delivered.
                ctx.capabilityValues.onoff = value;
                const instance = { capability, listener, destroy: jest.fn() };
                ctx.capabilityInstances.push(instance);
                return instance;
            });
            ctx.app.api.devices.getDevice.mockResolvedValueOnce(apiDevice);
        }

        test("background capability wait fires MATCHED when the value changed during setup", async () => {
            changeValueDuringListenerSetup(true);

            await expect(ctx.action("wait_until_start").runListener({
                device: DEVICE,
                capability: { id: "onoff", name: "onoff" },
                target_value: "true",
                timeout_value: 5,
                timeout_unit: "m",
                waiter_id: "kettle_boil",
            }, {})).resolves.toBe(true);

            const finished = ctx.trigger("wait_until_finished").trigger;
            expect(finished).toHaveBeenCalledTimes(1);
            expect(finished).toHaveBeenCalledWith(
                expect.objectContaining({ matched: true, result: "MATCHED", value: "true" }),
                { waiter_id: "kettle_boil" },
            );
            expect(ctx.manager.waiters.size).toBe(0);
            expect(ctx.capabilityInstances[0].destroy).toHaveBeenCalledTimes(1);
        });

        test("in-card capability wait resolves YES when the value changed during setup", async () => {
            changeValueDuringListenerSetup(true);

            const run = track(startCapabilityCondition());
            await flush();

            expect(run.count).toBe(1);
            expect(run.value).toBe(true);
            expect(ctx.manager.waiters.size).toBe(0);
            expect(jest.getTimerCount()).toBe(1);
        });

        test("no re-check completion when the value is still different", async () => {
            const run = track(startCapabilityCondition({ timeout_value: 30, timeout_unit: "s" }));
            await flush();

            expect(run.settled).toBe(false);
            expect(ctx.manager.waiters.has("Wait_OSB_Motion")).toBe(true);
        });
    });

    describe("guard counts from the start of the card run (Codex review)", () => {
        test("a slow device lookup is subtracted from the 55 s guard", async () => {
            ctx.app.getApiDevice.mockImplementationOnce(() => new Promise((resolve) => {
                setTimeout(() => resolve({ capabilitiesObj: { onoff: { value: false } } }), 10000);
            }));

            const run = track(startCapabilityCondition());
            await jest.advanceTimersByTimeAsync(10000);
            await flush();
            expect(ctx.manager.waiters.has("Wait_OSB_Motion")).toBe(true);

            // 10 s lookup + 44.999 s waiting: still inside the budget.
            await jest.advanceTimersByTimeAsync(SAFE_WAIT_MS - 10000 - 1);
            expect(run.settled).toBe(false);

            // Exactly 55 s after the run began, not 55 s after the waiter was created.
            await jest.advanceTimersByTimeAsync(1);
            expect(run.count).toBe(1);
            expect(run.error.message).toContain("Homey stops app Flow cards after 60 seconds");
            expect(ctx.manager.waiters.size).toBe(0);
        });

        function slowLookup(delayMs, value = false) {
            ctx.app.getApiDevice = jest.fn(() => new Promise((resolve) => {
                setTimeout(() => resolve({ capabilitiesObj: { onoff: { value } } }), delayMs);
            }));
        }

        test("the configured timeout also counts from the run start: 2 s lookup + 54 s timeout is NO at 54 s", async () => {
            slowLookup(2000);

            const run = track(startCapabilityCondition({ timeout_value: 54, timeout_unit: "s" }));
            await jest.advanceTimersByTimeAsync(54000 - 1);
            expect(run.settled).toBe(false);

            await jest.advanceTimersByTimeAsync(1);
            expect(run.count).toBe(1);
            expect(run.value).toBe(false);
            expect(run.error).toBeUndefined();
            expect(ctx.manager.waiters.size).toBe(0);

            // The guard (55 s after the run began) never fires an error afterwards.
            await jest.advanceTimersByTimeAsync(10000);
            expect(run.count).toBe(1);
            expect(run.error).toBeUndefined();
            expect(jest.getTimerCount()).toBe(1);
        });

        test("a configured 55 s timeout wins over the guard at the same moment", async () => {
            slowLookup(2000);

            const run = track(startCapabilityCondition({ timeout_value: 55, timeout_unit: "s" }));
            await jest.advanceTimersByTimeAsync(SAFE_WAIT_MS - 1);
            expect(run.settled).toBe(false);

            await jest.advanceTimersByTimeAsync(1);
            expect(run.count).toBe(1);
            expect(run.value).toBe(false);
            expect(run.error).toBeUndefined();
        });

        test("a timeout that already elapsed during setup resolves NO right away", async () => {
            slowLookup(3000);

            const run = track(startCapabilityCondition({ timeout_value: 2, timeout_unit: "s" }));
            await jest.advanceTimersByTimeAsync(3000);

            expect(run.count).toBe(1);
            expect(run.value).toBe(false);
            expect(ctx.manager.waiters.size).toBe(0);
            expect(ctx.capabilityInstances).toHaveLength(0);
            expect(jest.getTimerCount()).toBe(1);
        });

        test("the guard lets a timeout that is due at its deadline win despite timer jitter", async () => {
            // Simulates the waiter's own timer being scheduled a few ms after the guard.
            await ctx.manager.createWaiter("jitter", { timeoutValue: SAFE_WAIT_MS + 10, timeoutUnit: "ms" }, { flowId: "flow-jitter" });
            const waiter = ctx.manager.waiters.get("jitter");
            waiter.resolver = jest.fn();
            const onExpire = jest.fn();

            ctx.app.armFlowCardWaitGuard("jitter", waiter, onExpire, Date.now());
            await jest.advanceTimersByTimeAsync(SAFE_WAIT_MS);

            expect(waiter.resolver).toHaveBeenCalledTimes(1);
            expect(waiter.resolver).toHaveBeenCalledWith(false);
            expect(onExpire).not.toHaveBeenCalled();
            expect(ctx.manager.waiters.has("jitter")).toBe(false);
        });

        test("the guard still ends the run when the timeout is clearly later (e.g. extended by Modify)", async () => {
            await ctx.manager.createWaiter("later", { timeoutValue: SAFE_WAIT_MS + 1000, timeoutUnit: "ms" }, { flowId: "flow-later" });
            const waiter = ctx.manager.waiters.get("later");
            waiter.resolver = jest.fn();
            const onExpire = jest.fn();

            ctx.app.armFlowCardWaitGuard("later", waiter, onExpire, Date.now());
            await jest.advanceTimersByTimeAsync(SAFE_WAIT_MS);

            expect(onExpire).toHaveBeenCalledTimes(1);
            expect(waiter.resolver).not.toHaveBeenCalled();
            expect(ctx.manager.waiters.has("later")).toBe(false);
        });

        test("Modify Conditional Gate still sets the timeout from now", async () => {
            const run = track(startGateCondition({ timeout_value: 50, timeout_unit: "s" }));
            await flush();
            await jest.advanceTimersByTimeAsync(20000);

            // 10 s from now (at 30 s), not 10 s from the run start (already past).
            await modifyGate({ new_timeout_value: 10, new_timeout_unit: "s" });
            await flush();
            expect(run.settled).toBe(false);
            await jest.advanceTimersByTimeAsync(10000 - 1);
            expect(run.settled).toBe(false);

            await jest.advanceTimersByTimeAsync(1);
            expect(run.count).toBe(1);
            expect(run.value).toBe(false);
            expect(run.error).toBeUndefined();
        });
    });

    describe("gate and waiter discovery", () => {
        beforeEach(() => {
            ctx.app.api.flow = {
                getFlows: jest.fn(async () => ({
                    standard1: {
                        trigger: {
                            id: "homey:app:no.tiwas.booleantoolbox:conditional_gate_wait_finished",
                            args: { gate_name: { name: "Razor", id: "Razor" } },
                        },
                        actions: [{
                            id: "homey:app:no.tiwas.booleantoolbox:wait_until_start",
                            args: { waiter_id: { id: "kettle_boil", name: "kettle_boil" } },
                        }],
                    },
                    standard2: {
                        trigger: {
                            id: "homey:app:no.tiwas.booleantoolbox:wait_until_finished",
                            args: { waiter_id: "door_wait" },
                        },
                        conditions: [{
                            id: "homey:app:no.tiwas.booleantoolbox:wait_until_becomes_true",
                            args: { waiter_id: "legacy_wait" },
                        }],
                    },
                })),
            };
            ctx.app.api.flowAdv = {
                getFlows: jest.fn(async () => ({
                    advanced1: {
                        cards: {
                            a: {
                                id: "homey:app:no.tiwas.booleantoolbox:conditional_gate_start_wait",
                                args: { gate_name: { name: "Washer", id: "Washer" } },
                            },
                            b: {
                                id: "homey:app:no.tiwas.booleantoolbox:wait_until_finished",
                                args: { waiter_id: "advanced_wait" },
                            },
                        },
                    },
                })),
            };
        });

        test("gate names used by the new cards are suggested", async () => {
            await expect(ctx.app.getAllDefinedGateNames()).resolves.toEqual(["Razor", "Washer"]);

            const results = await ctx.action("conditional_gate_start_wait").autocomplete.gate_name("", {});
            expect(results.map((result) => result.name)).toEqual(expect.arrayContaining(["Razor", "Washer"]));
            expect(results[0].description).toBe("Suggested Name");

            const triggerResults = await ctx.trigger("conditional_gate_wait_finished").autocomplete.gate_name("wash", {});
            expect(triggerResults).toEqual([{ name: "Washer", id: "Washer" }, { name: "wash", id: "wash" }]);
        });

        test("waiter IDs used by the new cards are suggested", async () => {
            await expect(ctx.app.getAllDefinedWaiterIds()).resolves.toEqual([
                "advanced_wait",
                "door_wait",
                "kettle_boil",
                "legacy_wait",
            ]);

            const triggerResults = await ctx.trigger("wait_until_finished").autocomplete.waiter_id("custom_id", {});
            expect(triggerResults).toEqual([{ name: "custom_id", description: "Custom ID", id: "custom_id" }]);
        });
    });
});

describe("Flow card definitions for background waits", () => {
    const flowDirectory = path.join(__dirname, ".homeycompose", "flow");
    const languages = ["en", "no", "da", "nl", "de", "es", "fr", "it", "sv", "pl", "fi", "ru"];
    const readCard = (type, id) => JSON.parse(fs.readFileSync(path.join(flowDirectory, type, `${id}.json`), "utf8"));

    test.each([
        ["actions", "conditional_gate_start_wait", ["gate_name", "default_state", "timeout_value", "timeout_unit"], []],
        ["triggers", "conditional_gate_wait_finished", ["gate_name"], ["opened", "result", "waited_seconds"]],
        ["actions", "wait_until_start", ["device", "capability", "target_value", "timeout_value", "timeout_unit", "waiter_id"], []],
        ["triggers", "wait_until_finished", ["waiter_id"], ["matched", "result", "value", "waited_seconds"]],
    ])("%s/%s.json defines the args and tokens used by the app", (type, id, args, tokens) => {
        const card = readCard(type, id);

        expect(card.args.map((arg) => arg.name)).toEqual(args);
        expect((card.tokens || []).map((token) => token.name)).toEqual(tokens);
        for (const field of ["title", "titleFormatted", "hint"]) {
            expect(Object.keys(card[field]).sort()).toEqual([...languages].sort());
        }
        for (const arg of args) {
            for (const language of languages) {
                expect(card.titleFormatted[language]).toContain(`[[${arg}]]`);
            }
        }
    });
});
