"use strict";

const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = __dirname;
const DRIVERS_DIR = path.join(APP_DIR, "drivers");
const FLOW_TYPES = ["triggers", "conditions", "actions"];
const GETTER_TYPES = {
    getTriggerCard: "triggers",
    getDeviceTriggerCard: "triggers",
    getConditionCard: "conditions",
    getActionCard: "actions",
};
const CARD_CALL_PATTERN = /\.(getTriggerCard|getDeviceTriggerCard|getConditionCard|getActionCard)(?:\?\.)?\(\s*([^)]*?)\s*\)/g;
const STRING_LITERAL_PATTERN = /(["'`])([A-Za-z0-9_.-]+)\1/g;

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function relative(filePath) {
    return path.relative(APP_DIR, filePath).split(path.sep).join("/");
}

function listSourceFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            if (["node_modules", "pair", "repair", "assets"].includes(entry.name)) return [];
            return listSourceFiles(entryPath);
        }
        return entry.name.endsWith(".js") && !entry.name.endsWith(".test.js") ? [entryPath] : [];
    });
}

function stringLiterals(text) {
    return [...String(text).matchAll(STRING_LITERAL_PATTERN)].map((match) => match[2]);
}

function lineNumber(source, index) {
    return source.slice(0, index).split("\n").length;
}

function lastMatchBefore(source, pattern, index) {
    let found = null;
    for (const match of source.matchAll(pattern)) {
        if (match.index >= index) break;
        found = match;
    }
    return found;
}

function arrayLiteralAfter(source, openIndex) {
    let depth = 0;
    for (let index = openIndex; index < source.length; index += 1) {
        if (source[index] === "[") depth += 1;
        if (source[index] === "]") {
            depth -= 1;
            if (depth === 0) return source.slice(openIndex, index + 1);
        }
    }
    return "";
}

/**
 * Card ids that are not string literals are resolved from the surrounding
 * source: object arrays iterated as `cardInfo`, local `const` ternaries,
 * arrow-function helpers, and methods that forward their first parameter.
 * Unresolvable expressions fail the test so new patterns cannot slip through.
 */
function resolveDynamicCardIds(source, expression, callIndex) {
    const memberMatch = expression.match(/^(\w+)\.id$/);
    if (memberMatch) {
        const itemName = memberMatch[1];
        const loop = lastMatchBefore(
            source,
            new RegExp(`(\\w+)\\.forEach\\(\\s*\\(?\\s*${itemName}\\b|for\\s*\\(\\s*const\\s+${itemName}\\s+of\\s+(\\w+)\\s*\\)`, "g"),
            callIndex,
        );
        const arrayName = loop && (loop[1] || loop[2]);
        if (!arrayName) return [];
        const declaration = lastMatchBefore(source, new RegExp(`const\\s+${arrayName}\\s*=\\s*\\[`, "g"), loop.index);
        if (!declaration) return [];
        const arrayText = arrayLiteralAfter(source, declaration.index + declaration[0].length - 1);
        return [...arrayText.matchAll(/\bid:\s*([^,}]*)/g)].flatMap((match) => stringLiterals(match[1]));
    }

    if (!/^\w+$/.test(expression)) return [];
    const name = expression;
    const candidates = [
        {
            match: lastMatchBefore(source, new RegExp(`const\\s+${name}\\s*=\\s*([^;]+);`, "g"), callIndex),
            resolve: (match) => stringLiterals(match[1]),
        },
        {
            match: lastMatchBefore(source, new RegExp(`const\\s+(\\w+)\\s*=\\s*(?:async\\s*)?\\(\\s*${name}\\b`, "g"), callIndex),
            resolve: (match) => [...source.matchAll(new RegExp(`\\b${match[1]}\\(\\s*(["'\`])([A-Za-z0-9_.-]+)\\1`, "g"))]
                .map((call) => call[2]),
        },
        {
            match: lastMatchBefore(source, new RegExp(`(?:async\\s+)?(\\w+)\\s*\\(\\s*${name}\\b[^)]*\\)\\s*\\{`, "g"), callIndex),
            resolve: (match) => [...source.matchAll(new RegExp(`\\.${match[1]}\\(\\s*(["'\`])([A-Za-z0-9_.-]+)\\1`, "g"))]
                .map((call) => call[2]),
        },
    ].filter((candidate) => candidate.match);

    if (candidates.length === 0) return [];
    candidates.sort((left, right) => right.match.index - left.match.index);
    return candidates[0].resolve(candidates[0].match);
}

function collectCardReferences(filePath, source = fs.readFileSync(filePath, "utf8")) {
    const references = [];
    for (const match of source.matchAll(CARD_CALL_PATTERN)) {
        const [, getter, rawArgument] = match;
        const argument = rawArgument.trim().replace(/,$/, "").trim();
        if (!argument) continue;

        const location = `${relative(filePath)}:${lineNumber(source, match.index)}`;
        const literal = argument.match(/^(["'`])([A-Za-z0-9_.-]+)\1$/);
        const ids = literal ? [literal[2]] : resolveDynamicCardIds(source, argument, match.index);
        if (ids.length === 0) {
            references.push({ type: GETTER_TYPES[getter], id: null, expression: argument, location });
            continue;
        }
        ids.forEach((id) => references.push({ type: GETTER_TYPES[getter], id, expression: argument, location }));
    }
    return references;
}

function collectDefinedCards() {
    const defined = Object.fromEntries(FLOW_TYPES.map((type) => [type, new Set()]));

    // Homey Compose uses $id, then id, then the file name for app-level cards.
    for (const type of FLOW_TYPES) {
        const directory = path.join(APP_DIR, ".homeycompose", "flow", type);
        if (!fs.existsSync(directory)) continue;
        for (const file of fs.readdirSync(directory).filter((name) => name.endsWith(".json"))) {
            const card = readJson(path.join(directory, file));
            defined[type].add(card.$id || card.id || path.basename(file, ".json"));
        }
    }

    // Driver-level cards live in driver.flow.compose.json. Compose resolves
    // their id from $id, then id, then the last $extends template.
    for (const driverId of fs.readdirSync(DRIVERS_DIR)) {
        const flowFile = path.join(DRIVERS_DIR, driverId, "driver.flow.compose.json");
        if (!fs.existsSync(flowFile)) continue;
        const flow = readJson(flowFile);
        for (const type of FLOW_TYPES) {
            for (const card of flow[type] || []) {
                const templates = [].concat(card.$extends || []);
                defined[type].add(card.$id || card.id || templates[templates.length - 1]);
            }
        }
    }

    return defined;
}

function collectDeclaredDriverCards() {
    const declared = [];
    for (const driverId of fs.readdirSync(DRIVERS_DIR)) {
        const composeFile = path.join(DRIVERS_DIR, driverId, "driver.compose.json");
        if (!fs.existsSync(composeFile)) continue;
        const flow = readJson(composeFile).flow;
        if (!flow) continue;

        // Both shapes exist in this repository: an object keyed by card type
        // and an array of { type, id } entries.
        const entries = Array.isArray(flow)
            ? flow.map((card) => [`${card.type}s`, card])
            : Object.entries(flow).flatMap(([type, cards]) => cards.map((card) => [type, card]));
        entries.forEach(([type, card]) => declared.push({
            type,
            id: card.id,
            location: `drivers/${driverId}/driver.compose.json`,
        }));
    }
    return declared;
}

function findMissing(references, defined) {
    return references
        .filter((reference) => !reference.id || !defined[reference.type] || !defined[reference.type].has(reference.id))
        .map((reference) => reference.id
            ? `${reference.location} ${reference.type}:${reference.id}`
            : `${reference.location} unresolved dynamic card id '${reference.expression}'`);
}

describe("Flow card definitions", () => {
    const defined = collectDefinedCards();
    const sourceFiles = [
        path.join(APP_DIR, "app.js"),
        ...listSourceFiles(path.join(APP_DIR, "lib")),
        ...listSourceFiles(DRIVERS_DIR),
    ];
    const references = sourceFiles.flatMap((filePath) => collectCardReferences(filePath));

    test("every Flow card requested in code has a Compose definition of the same type", () => {
        expect(findMissing(references, defined)).toEqual([]);
    });

    test("resolves literal, looped, ternary, helper, and forwarded card ids", () => {
        const referencedIds = new Set(references.map((reference) => reference.id));

        [
            "has_error",
            "device_alarm_is_ld",
            "has_any_error_ld",
            "clg_turned_on",
            "clg_resumed",
            "clg_apply_now",
            "clg_is_on",
            "formula_changed_to_true_lu_deprecated",
            "state_changed_ld",
            "composite_value_changed_larger_than",
        ].forEach((id) => expect(referencedIds).toContain(id));
        expect(referencedIds).not.toContain("formula_result_is_ld");
    });

    test("every card declared in a driver compose flow section is defined", () => {
        const missing = collectDeclaredDriverCards()
            .filter((card) => !defined[card.type] || !defined[card.type].has(card.id))
            .map((card) => `${card.location} ${card.type}:${card.id}`);

        expect(missing).toEqual([]);
    });

    test("reports a card id that has no definition", () => {
        const source = [
            "const conditionCards = [",
            "  { id: \"has_any_error_ld\", checkType: \"has_error\" },",
            "  { id: \"formula_result_is_ld\", checkTypeFromArg: \"what_is\" },",
            "];",
            "conditionCards.forEach((cardInfo) => {",
            "  this.homey.flow.getConditionCard(cardInfo.id);",
            "});",
            "this.homey.flow.getActionCard(someRuntimeValue());",
        ].join("\n");
        const missing = findMissing(
            collectCardReferences(path.join(APP_DIR, "synthetic.js"), source),
            defined,
        );

        expect(missing).toEqual([
            "synthetic.js:6 conditions:formula_result_is_ld",
            "synthetic.js:8 unresolved dynamic card id 'someRuntimeValue('",
        ]);
    });
});
