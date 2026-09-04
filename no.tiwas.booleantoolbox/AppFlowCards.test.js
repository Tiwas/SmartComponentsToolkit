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

jest.mock("./lib/WaiterManager", () => jest.fn());
jest.mock("./lib/CapturedStateManager", () => jest.fn());
const BooleanToolboxApp = require("./app");

function createCard() {
    return {
        registerRunListener(listener) {
            this.runListener = listener;
        },
        registerArgumentAutocompleteListener() {},
    };
}

function createApp() {
    const actionCards = new Map();
    const conditionCards = new Map();
    const triggerCards = new Map();
    const getCard = (cards, id) => {
        if (!cards.has(id)) cards.set(id, createCard());
        return cards.get(id);
    };

    const app = new BooleanToolboxApp();
    app.logger = {
        banner: jest.fn(),
        debug: jest.fn(),
        error: jest.fn(),
        flow: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
    };
    app.homey = {
        __: jest.fn((key, variables) => key === "app.value_outside_logic"
            ? `Value ${variables.input} is outside the defined logic.`
            : key),
        flow: {
            getActionCard: (id) => getCard(actionCards, id),
            getConditionCard: (id) => getCard(conditionCards, id),
            getTriggerCard: (id) => getCard(triggerCards, id),
        },
    };

    return { app, actionCards, conditionCards };
}

describe("app-level Flow cards", () => {
    test("evaluate_expression evaluates matching rules without a device argument", async () => {
        const { app, actionCards } = createApp();
        await app.registerAllFlowCards();

        const result = await actionCards.get("evaluate_expression").runListener({
            input: 10,
            rules: "0,10,25;11,20,50",
            op1: "gte",
            op2: "lte",
            logical_op: "AND",
        });

        expect(result).toEqual({ outputValue: 25, errorMessage: "" });
    });

    test("evaluate_expression returns error tokens for invalid configuration", async () => {
        const { app, actionCards } = createApp();
        await app.registerAllFlowCards();

        const result = await actionCards.get("evaluate_expression").runListener({
            input: 10,
            rules: "0,,25",
            op1: "gte",
            op2: "lte",
            logical_op: "AND",
        });

        expect(result.outputValue).toBe(0);
        expect(result.errorMessage).toMatch(/^Configuration error:/);
    });

    test("evaluate_expression validates all rules before returning a match", async () => {
        const { app, actionCards } = createApp();
        await app.registerAllFlowCards();

        const result = await actionCards.get("evaluate_expression").runListener({
            input: 5,
            rules: "0,10,25;not-a-rule",
            op1: "gte",
            op2: "lte",
            logical_op: "AND",
        });

        expect(result.outputValue).toBe(0);
        expect(result.errorMessage).toMatch(/^Configuration error:/);
    });

    test("evaluate_expression localizes the no-match error token", async () => {
        const { app, actionCards } = createApp();
        await app.registerAllFlowCards();

        const result = await actionCards.get("evaluate_expression").runListener({
            input: 30,
            rules: "0,10,25",
            op1: "gte",
            op2: "lte",
            logical_op: "AND",
        });

        expect(result).toEqual({
            outputValue: 0,
            errorMessage: "Value 30 is outside the defined logic.",
        });
    });

    test("has_error evaluates its text argument without a device argument", async () => {
        const { app, conditionCards } = createApp();
        await app.registerAllFlowCards();

        const listener = conditionCards.get("has_error").runListener;
        await expect(listener({ text_input: "" })).resolves.toBe(false);
        await expect(listener({ text_input: "Validation failed" })).resolves.toBe(true);
    });
});
