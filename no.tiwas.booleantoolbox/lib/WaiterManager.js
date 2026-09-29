'use strict';

/**
 * WaiterManager - Singleton class for managing async flow waiters
 */
class WaiterManager {
    constructor(homey, logger) {
        if (WaiterManager.instance) return WaiterManager.instance;
        this.homey = homey;
        this.logger = logger;
        this.waiters = new Map();
        this.flowTracking = new Map();
        this.virtualGates = new Map(); // gateName -> { state, waiters: Set<waiterId> }
        this.MAX_WAITERS = 100;
        this.MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;
        // A no-timeout waiter represents a running Flow. Keep it long enough for
        // intentional waits, but reap it eventually if the Flow was abandoned.
        this.MAX_ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;
        this.MIN_TIMEOUT_MS = 100;
        this.WARNING_THRESHOLD = 50;
        this.cleanupInterval = setInterval(() => this.cleanupOrphans(), 60000);
        WaiterManager.instance = this;
        this.logger.info('🔧 WaiterManager initialized');
    }

    generateWaiterId() {
        return `waiter-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    validateTimeout(timeoutMs) {
        if (timeoutMs === 0) return 0;
        if (timeoutMs < this.MIN_TIMEOUT_MS) return this.MIN_TIMEOUT_MS;
        if (timeoutMs > this.MAX_TIMEOUT_MS) return this.MAX_TIMEOUT_MS;
        return timeoutMs;
    }

    convertToMs(value, unit) {
        const multipliers = { 'ms': 1, 's': 1000, 'm': 60000, 'h': 3600000 };
        return value * (multipliers[unit] || 1000);
    }

    matchPattern(id, pattern) {
        if (pattern === id) return true;
        if (!pattern.includes('*')) return false;
        const regexPattern = '^' + pattern.replace(/[.+?^${}()|[\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
        return new RegExp(regexPattern).test(id);
    }

    getWaitersByPattern(pattern) {
        const matches = [];
        for (const [id, data] of this.waiters.entries()) {
            if (this.matchPattern(id, pattern)) matches.push({ id, data });
        }
        return matches;
    }

    async createWaiter(id, config, flowContext, deviceConfig = null, virtualGateConfig = null) {
        if (this.waiters.size >= this.MAX_WAITERS) throw new Error(`Max waiters (${this.MAX_WAITERS}) reached`);
        if (!id || id.trim() === '') id = this.generateWaiterId();

        const existing = this.waiters.get(id);
        if (existing && existing.flowId === flowContext.flowId) {
            this.logger.debug(`♻️  Re-initializing existing waiter: ${id}`);
            const previousResolver = existing.resolver;
            this.removeWaiterById(id);
            // Settle the superseded Flow card run through its NO/false path so it
            // does not hang until Homey kills it at the 60 second card limit.
            if (previousResolver) {
                try { previousResolver(false); } catch (e) { this.logger.error(e); }
            }
        } else if (existing) {
            throw new Error(`Waiter ID "${id}" already exists`);
        }

        const timeoutMs = config.timeoutValue === 0 ? 0 : this.validateTimeout(this.convertToMs(config.timeoutValue, config.timeoutUnit));

        const waiterData = {
            id,
            created: Date.now(),
            flowId: flowContext.flowId,
            flowToken: flowContext.flowToken,
            enabled: true,
            timeoutMs,
            indefiniteSince: timeoutMs === 0 ? Date.now() : null,
            timeoutHandle: null,
            resolver: null,
            config,
            deviceConfig,
            virtualGateConfig,
            capabilityListener: null,
        };

        this.setupTimeout(waiterData);
        this.waiters.set(id, waiterData);

        if (virtualGateConfig?.gateName) {
            const gateName = virtualGateConfig.gateName;
            if (!this.virtualGates.has(gateName)) this.virtualGates.set(gateName, { state: 'NO_GO', waiters: new Set() });
            this.virtualGates.get(gateName).waiters.add(id);
        }

        if (!this.flowTracking.has(flowContext.flowId)) this.flowTracking.set(flowContext.flowId, new Set());
        this.flowTracking.get(flowContext.flowId).add(id);

        this.logger.info(`✅ Waiter created: ${id} (timeout: ${timeoutMs}ms)`);
        return id;
    }

    setupTimeout(waiterData) {
        if (waiterData.timeoutHandle) clearTimeout(waiterData.timeoutHandle);
        waiterData.timeoutHandle = null;
        // Absolute time the configured timeout is due (null = no timeout).
        waiterData.timeoutAt = waiterData.timeoutMs > 0 ? Date.now() + waiterData.timeoutMs : null;
        if (waiterData.timeoutMs > 0) {
            waiterData.timeoutHandle = setTimeout(() => this.expireWaiter(waiterData), waiterData.timeoutMs);
        }
    }

    /**
     * Runs a waiter's timeout: resolves it as timed out (false) and removes it.
     * Called by its own timer, and by the in-card Flow card guard when the
     * configured timeout is due at the same moment as the guard.
     *
     * @returns {boolean} True when the waiter was completed as timed out
     */
    expireWaiter(waiterData) {
        // A replaced waiter must never resolve or remove its successor.
        if (this.waiters.get(waiterData.id) !== waiterData) return false;
        if (!waiterData.enabled) {
            // Disabled waiters stay in the waiting state; enableWaiter()
            // completes the elapsed timeout when the waiter is re-enabled.
            waiterData.timedOutWhileDisabled = true;
            waiterData.timedOutAt = Date.now();
            this.logger.info(`⏸️  Waiter "${waiterData.id}" timed out while disabled - completing when re-enabled`);
            return false;
        }
        this.logger.warn(`⏰ Waiter "${waiterData.id}" timed out`);
        if (waiterData.resolver) {
            try { waiterData.resolver(false); } catch (e) { this.logger.error(e); }
        }
        this.removeWaiterIfCurrent(waiterData.id, waiterData);
        return true;
    }

    enableWaiter(idPattern, enabled) {
        const matches = this.getWaitersByPattern(idPattern);
        for (const { data } of matches) data.enabled = enabled;
        if (enabled) {
            for (const { id, data } of matches) this.completeReEnabledWaiter(id, data);
        }
        return matches.length;
    }

    /**
     * Completes a waiter that was re-enabled while its condition is already
     * met: the capability's last known value matches, or the gate is in the
     * target state. Otherwise a timeout that elapsed while it was disabled is
     * completed now. A waiter with neither keeps waiting.
     */
    completeReEnabledWaiter(id, waiterData) {
        if (this.waiters.get(id) !== waiterData) return false;

        if (waiterData.deviceConfig && this.settleCapabilityWaiterIfMatches(waiterData, waiterData.lastValue)) {
            return true;
        }

        const gateName = waiterData.virtualGateConfig?.gateName;
        if (gateName && this.virtualGates.has(gateName)) {
            const gateState = this.virtualGates.get(gateName).state;
            const targetState = waiterData.virtualGateConfig.targetState || 'GO';
            if (gateState === targetState) {
                if (waiterData.resolver) {
                    try {
                        waiterData.resolver({ gate_state: gateState === 'GO', gate_state_text: gateState });
                    } catch (e) { this.logger.error(e); }
                }
                this.removeWaiterIfCurrent(id, waiterData);
                return true;
            }
        }

        if (waiterData.timedOutWhileDisabled) {
            this.logger.warn(`⏰ Waiter "${id}" timed out (timeout elapsed while disabled)`);
            if (waiterData.resolver) {
                try { waiterData.resolver(false); } catch (e) { this.logger.error(e); }
            }
            this.removeWaiterIfCurrent(id, waiterData);
            return true;
        }
        return false;
    }

    /**
     * Completes an enabled capability waiter when the given value matches its
     * target. Used by the capability listener and by out-of-band reads (the
     * re-check after the listener is installed, and re-enabling). Values seen
     * while the waiter is disabled are only remembered; it keeps waiting.
     *
     * @returns {boolean} True when the waiter was completed
     */
    settleCapabilityWaiterIfMatches(waiterData, value) {
        if (!waiterData?.deviceConfig || this.waiters.get(waiterData.id) !== waiterData) return false;
        waiterData.lastValue = value;
        if (!waiterData.enabled || !this.valueMatches(value, waiterData.deviceConfig.targetValue)) return false;
        if (waiterData.resolver) {
            try { waiterData.resolver(true); } catch (e) { this.logger.error(e); }
        }
        this.removeWaiterIfCurrent(waiterData.id, waiterData);
        return true;
    }

    removeWaiter(idPattern) {
        const matches = this.getWaitersByPattern(idPattern);
        for (const { id } of matches) this.removeWaiterById(id);
        return matches.length;
    }

    removeWaiterById(id) {
        const data = this.waiters.get(id);
        if (!data) return false;
        if (data.timeoutHandle) clearTimeout(data.timeoutHandle);
        if (data.capabilityListener) {
            try { data.capabilityListener.instance?.destroy(); } catch (e) {}
        }
        if (data.virtualGateConfig?.gateName) {
            const gate = this.virtualGates.get(data.virtualGateConfig.gateName);
            if (gate) gate.waiters.delete(id);
        }
        if (this.flowTracking.has(data.flowId)) {
            this.flowTracking.get(data.flowId).delete(id);
            if (this.flowTracking.get(data.flowId).size === 0) this.flowTracking.delete(data.flowId);
        }
        this.waiters.delete(id);
        return true;
    }

    /**
     * Removes a waiter only if the given waiter object is still the one
     * registered under that ID. Waiter IDs are reused (re-initialized Flow
     * runs, restarted background waits), so stale timers and listeners must
     * not remove the successor.
     */
    removeWaiterIfCurrent(id, waiterData) {
        if (!waiterData || this.waiters.get(id) !== waiterData) return false;
        return this.removeWaiterById(id);
    }

    getBackgroundGateWaiterId(gateName) {
        return `gate_${gateName}_background`;
    }

    /**
     * Starts a wait that is not bound to a Flow card run. The Flow card that
     * starts it returns immediately; onFinish is called once when the waiter
     * resolves (GO / capability match / timeout / orphan reaping). A pending
     * background waiter with the same ID is replaced without calling its
     * onFinish (restart semantics). Stopping or replacing a background waiter
     * never calls onFinish.
     */
    async startBackgroundWaiter(id, config, deviceConfig = null, virtualGateConfig = null, onFinish = null) {
        const existing = this.waiters.get(id);
        if (existing && existing.background) {
            this.logger.info(`🔁 Restarting background waiter: ${id}`);
            this.removeWaiterById(id);
        }

        const actualId = await this.createWaiter(
            id,
            config,
            { flowId: WaiterManager.BACKGROUND_FLOW_ID, flowToken: null },
            deviceConfig,
            virtualGateConfig,
        );
        const waiterData = this.waiters.get(actualId);
        waiterData.background = true;

        let finished = false;
        waiterData.resolver = (result) => {
            if (finished) return;
            finished = true;
            if (typeof onFinish === 'function') {
                onFinish({
                    id: actualId,
                    success: result !== false,
                    result,
                    waitedMs: Math.max(0, Date.now() - waiterData.created),
                    lastValue: waiterData.lastValue,
                });
            }
        };

        this.logger.info(`🕓 Background waiter started: ${actualId}`);
        return waiterData;
    }

    async registerCapabilityListener(waiterId, homey) {
        const waiter = this.waiters.get(waiterId);
        if (!waiter || !waiter.deviceConfig) return;
        try {
            const device = await homey.devices.getDevice({ id: waiter.deviceConfig.deviceId });
            const listener = async (value) => {
                // Events for a waiter that was replaced or already finished are
                // ignored; a disabled waiter only remembers the value and keeps waiting.
                this.settleCapabilityWaiterIfMatches(waiter, value);
            };
            const instance = await device.makeCapabilityInstance(
                waiter.deviceConfig.capability,
                listener,
            );
            // Drop the instance if the waiter was removed/replaced meanwhile, or if an
            // overlapping registration for the same waiter object already won.
            if (this.waiters.get(waiterId) !== waiter || waiter.capabilityListener) {
                try { instance?.destroy(); } catch (e) {}
                return;
            }
            waiter.capabilityListener = {
                device,
                capability: waiter.deviceConfig.capability,
                listener,
                instance,
            };
        } catch (error) { this.logger.error(error); throw error; }
    }

    valueMatches(actual, target) {
        let t = target;
        if (target === 'true') t = true; else if (target === 'false') t = false; else if (!isNaN(target)) t = Number(target);
        return actual === t;
    }

    stopWaiter(idPattern) {
        const matches = this.getWaitersByPattern(idPattern);
        for (const { id } of matches) this.removeWaiter(id);
        return matches.length;
    }

    // --- Virtual Gates Logic ---

    getGateState(gateName, defaultState = 'NO_GO') {
        this.logger.debug(`🔍 getGateState called: gateName="${gateName}" (type: ${typeof gateName}), defaultState="${defaultState}"`);
        this.logger.debug(`🔍 Current gates in memory: [${Array.from(this.virtualGates.keys()).map(k => `"${k}"`).join(', ')}]`);

        if (!this.virtualGates.has(gateName)) {
            this.logger.debug(`🔍 Gate "${gateName}" not found, creating with state="${defaultState}"`);
            this.virtualGates.set(gateName, { state: defaultState, waiters: new Set() });
        }

        const state = this.virtualGates.get(gateName).state;
        this.logger.debug(`🔍 getGateState returning: "${state}"`);
        return state;
    }

    setGateState(gateName, newState) {
        this.logger.debug(`🔧 setGateState called: gateName="${gateName}" (type: ${typeof gateName}), newState="${newState}"`);
        this.logger.debug(`🔧 Current gates in memory: [${Array.from(this.virtualGates.keys()).map(k => `"${k}"`).join(', ')}]`);

        // Ensure gate exists before getting it
        if (!this.virtualGates.has(gateName)) {
            this.logger.debug(`🔧 Gate "${gateName}" not found, creating new gate`);
            this.virtualGates.set(gateName, { state: 'NO_GO', waiters: new Set() });
        }

        const gate = this.virtualGates.get(gateName);
        this.logger.debug(`🔧 Gate object: state="${gate.state}", waiters=[${Array.from(gate.waiters).join(', ')}]`);

        let actualNewState = newState;
        if (newState === 'TOGGLE') actualNewState = gate.state === 'GO' ? 'NO_GO' : 'GO';

        // Update state
        gate.state = actualNewState;

        this.logger.info(`🚪 Gate "${gateName}" set to ${actualNewState}`);
        this.logger.debug(`🔧 Gates after update: [${Array.from(this.virtualGates.keys()).map(k => `"${k}": ${this.virtualGates.get(k).state}`).join(', ')}]`);

        // Trigger matching waiters (now using the actual gate object, not a fallback)
        const waitersToTrigger = Array.from(gate.waiters);
        let triggered = 0;
        for (const waiterId of waitersToTrigger) {
            const waiter = this.waiters.get(waiterId);
            if (waiter && waiter.enabled && waiter.resolver) {
                const targetState = waiter.virtualGateConfig?.targetState || 'GO';
                if (targetState === actualNewState) {
                    try {
                        // Return tokens for condition cards
                        waiter.resolver({ gate_state: actualNewState === 'GO', gate_state_text: actualNewState });
                        triggered++;
                    } catch (e) { this.logger.error(e); }
                    this.removeWaiterIfCurrent(waiterId, waiter);
                }
            }
        }
        return triggered;
    }
    
    updateWaiter(id, updates) {
        const waiter = this.waiters.get(id);
        if (!waiter) return false;
        
        if (updates.timeoutMs !== undefined) {
            const wasIndefinite = waiter.timeoutMs === 0;
            waiter.timeoutMs = updates.timeoutMs;
            if (waiter.timeoutMs === 0 && !wasIndefinite) waiter.indefiniteSince = Date.now();
            if (waiter.timeoutMs !== 0) waiter.indefiniteSince = null;
            // A new timeout replaces one that elapsed while the waiter was disabled.
            waiter.timedOutWhileDisabled = false;
            waiter.timedOutAt = null;
            this.setupTimeout(waiter);
            this.logger.info(`⏱️ Updated timeout for waiter "${id}" to ${waiter.timeoutMs}ms`);
        }
        return true;
    }

    updateGateWaiters(gateName, updates) {
        if (!this.virtualGates.has(gateName)) return 0;
        const gate = this.virtualGates.get(gateName);
        let count = 0;
        for (const waiterId of gate.waiters) {
            if (this.updateWaiter(waiterId, updates)) {
                count++;
            }
        }
        return count;
    }

    getDefinedGates() { return Array.from(this.virtualGates.keys()).sort(); }

    getWaitersForAutocomplete(query = '') {
        const results = [];
        for (const [id, data] of this.waiters.entries()) {
            if (query && !id.toLowerCase().includes(query.toLowerCase())) continue;
            const typeInfo = (data.deviceConfig ? 'Device' : (data.virtualGateConfig ? 'Gate' : 'Unknown')) + (data.background ? ', background' : '');
            const targetInfo = data.virtualGateConfig ? `${data.virtualGateConfig.gateName} (${data.virtualGateConfig.targetState || 'GO'})` : '';
            results.push({ name: id, description: `${data.enabled ? '✅' : '⏸️'} [${typeInfo}] ${targetInfo}`, id });
        }
        return results.sort((a,b) => b.name.localeCompare(a.name));
    }

    cleanupOrphans() {
        const now = Date.now();
        let reaped = 0;
        for (const [id, waiter] of this.waiters.entries()) {
            const indefiniteSince = waiter.indefiniteSince ?? waiter.created;
            const isOrphanIndefinite = waiter.timeoutMs === 0 && now - indefiniteSince >= this.MAX_ORPHAN_AGE_MS;
            // A waiter whose timeout elapsed while disabled waits for re-enabling;
            // reap it if nobody re-enables it within the orphan age.
            const isOrphanDisabled = waiter.timedOutWhileDisabled === true
                && now - (waiter.timedOutAt ?? now) >= this.MAX_ORPHAN_AGE_MS;
            if (!isOrphanIndefinite && !isOrphanDisabled) continue;

            this.logger.warn(`🧹 Reaping orphan waiter "${id}" after ${this.MAX_ORPHAN_AGE_MS}ms without completing`);
            // Disabled waiters never trigger, not even when they are reaped.
            if (waiter.resolver && waiter.enabled) {
                try { waiter.resolver(false); } catch (error) { this.logger.error(error); }
            }
            this.removeWaiterById(id);
            reaped++;
        }
        return reaped;
    }

    destroy() {
        if (this.cleanupInterval) clearInterval(this.cleanupInterval);
        for (const id of [...this.waiters.keys()]) this.removeWaiter(id);
        this.waiters.clear(); this.virtualGates.clear(); this.flowTracking.clear();
        this.logger.info('🛑 WaiterManager destroyed');
    }
}

WaiterManager.instance = null;
// Homey stops every app Flow card run listener after ~60 seconds. In-card
// waits are ended just before that; longer waits use background waiters.
WaiterManager.FLOW_CARD_SAFE_WAIT_MS = 55000;
// Timer jitter allowed when an in-card wait's own timeout is due at the same
// moment as the guard: the timeout (NO path) wins over the limit error.
WaiterManager.FLOW_CARD_TIMEOUT_TIE_MS = 50;
WaiterManager.BACKGROUND_FLOW_ID = 'background';
module.exports = WaiterManager;
