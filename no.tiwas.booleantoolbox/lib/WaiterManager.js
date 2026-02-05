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
            if (existing.timeoutHandle) clearTimeout(existing.timeoutHandle);
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
            timeoutHandle: null,
            resolver: null,
            config,
            deviceConfig,
            virtualGateConfig,
            capabilityListener: null
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
        if (waiterData.timeoutMs > 0) {
            waiterData.timeoutHandle = setTimeout(() => {
                this.logger.warn(`⏰ Waiter "${waiterData.id}" timed out`);
                if (waiterData.resolver) {
                    try { waiterData.resolver(false); } catch (e) { this.logger.error(e); }
                }
                this.removeWaiter(waiterData.id);
            }, waiterData.timeoutMs);
        }
    }

    enableWaiter(idPattern, enabled) {
        const matches = this.getWaitersByPattern(idPattern);
        for (const { data } of matches) data.enabled = enabled;
        return matches.length;
    }

    removeWaiter(idPattern) {
        const matches = this.getWaitersByPattern(idPattern);
        for (const { id, data } of matches) {
            if (data.timeoutHandle) clearTimeout(data.timeoutHandle);
            if (data.capabilityListener) {
                try { data.capabilityListener.device.removeListener(`capability.${data.capabilityListener.capability}`, data.capabilityListener.listener); } catch (e) {}
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
        }
        return matches.length;
    }

    async registerCapabilityListener(waiterId, homey) {
        const waiter = this.waiters.get(waiterId);
        if (!waiter || !waiter.deviceConfig) return;
        try {
            const device = await homey.devices.getDevice({ id: waiter.deviceConfig.deviceId });
            const listener = async (value) => {
                if (this.valueMatches(value, waiter.deviceConfig.targetValue)) {
                    if (waiter.resolver && waiter.enabled) waiter.resolver(true);
                    this.removeWaiter(waiterId);
                }
            };
            await device.makeCapabilityInstance(waiter.deviceConfig.capability, listener);
            waiter.capabilityListener = { device, capability: waiter.deviceConfig.capability, listener };
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
                    this.removeWaiter(waiterId);
                }
            }
        }
        return triggered;
    }
    
    updateWaiter(id, updates) {
        const waiter = this.waiters.get(id);
        if (!waiter) return false;
        
        if (updates.timeoutMs !== undefined) {
            waiter.timeoutMs = updates.timeoutMs;
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
            const typeInfo = data.deviceConfig ? 'Device' : (data.virtualGateConfig ? 'Gate' : 'Unknown');
            const targetInfo = data.virtualGateConfig ? `${data.virtualGateConfig.gateName} (${data.virtualGateConfig.targetState || 'GO'})` : '';
            results.push({ name: id, description: `${data.enabled ? '✅' : '⏸️'} [${typeInfo}] ${targetInfo}`, id });
        }
        return results.sort((a,b) => b.name.localeCompare(a.name));
    }

    cleanupOrphans() { /* ... existing simplified ... */ }

    destroy() {
        if (this.cleanupInterval) clearInterval(this.cleanupInterval);
        for (const [id, data] of this.waiters.entries()) { if (data.timeoutHandle) clearTimeout(data.timeoutHandle); }
        this.waiters.clear(); this.virtualGates.clear(); this.flowTracking.clear();
        this.logger.info('🛑 WaiterManager destroyed');
    }
}

WaiterManager.instance = null;
module.exports = WaiterManager;
