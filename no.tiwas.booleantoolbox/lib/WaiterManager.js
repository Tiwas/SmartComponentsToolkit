'use strict';

/**
 * WaiterManager - Singleton class for managing async flow waiters
 *
 * Holds Homey flow branches "alive" and triggers them asynchronously when
 * conditions are met. Enables "wait until" functionality in flows where
 * the flow pauses until a device capability reaches a target value.
 *
 * Features:
 * - Create waiters with unique IDs and configurable timeouts
 * - Wildcard pattern matching for bulk operations (e.g., "winter-*")
 * - Flow lifecycle tracking and automatic cleanup
 * - Memory-safe with configurable limits (default 100 waiters)
 * - Device capability monitoring with automatic resolution
 *
 * Called by:
 *   - app.js - Creates singleton instance, registers flow cards
 *   - Flow card handlers - Creating and controlling waiters
 *
 * @class WaiterManager
 * @singleton
 */
class WaiterManager {
    /**
     * Creates or returns the singleton WaiterManager instance.
     *
     * Sets up storage maps, configuration limits, and starts the
     * periodic cleanup interval for orphaned waiters.
     *
     * @param {Object} homey - Homey API instance
     * @param {Logger} logger - Logger instance for output
     *
     * Called by:
     *   - app.js onInit() - During application startup
     *
     * Calls:
     *   - WaiterManager.cleanupOrphans() - Via interval timer
     *   - Logger.info() - Initialization logging
     */
    constructor(homey, logger) {
        if (WaiterManager.instance) {
            return WaiterManager.instance;
        }

        this.homey = homey;
        this.logger = logger;

        // Core storage
        this.waiters = new Map(); // waiterId -> waiterData
        this.flowTracking = new Map(); // flowId -> Set<waiterId>

        // Configuration
        this.MAX_WAITERS = 100;
        this.MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours
        this.MIN_TIMEOUT_MS = 100; // 100ms
        this.WARNING_THRESHOLD = 50;

        // Cleanup interval
        this.cleanupInterval = setInterval(() => {
            this.cleanupOrphans();
        }, 60000); // Every minute

        WaiterManager.instance = this;
        this.logger.info('🔧 WaiterManager initialized');
    }

    /**
     * Generates a unique waiter ID using timestamp and random string.
     *
     * @returns {string} Unique waiter ID in format "waiter-{timestamp}-{random}"
     *
     * Called by:
     *   - WaiterManager.createWaiter() - When no custom ID is provided
     *
     * Calls:
     *   - (none)
     */
    generateWaiterId() {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        return `waiter-${timestamp}-${random}`;
    }

    /**
     * Validate timeout value
     */
    validateTimeout(timeoutMs) {
        if (timeoutMs === 0) return 0; // No timeout
        if (timeoutMs < this.MIN_TIMEOUT_MS) return this.MIN_TIMEOUT_MS;
        if (timeoutMs > this.MAX_TIMEOUT_MS) return this.MAX_TIMEOUT_MS;
        return timeoutMs;
    }

    /**
     * Convert timeout value and unit to milliseconds
     */
    convertToMs(value, unit) {
        const multipliers = {
            'ms': 1,
            's': 1000,
            'm': 60000,
            'h': 3600000
        };
        return value * (multipliers[unit] || 1000); // Default to seconds
    }

    /**
     * Match waiter ID against pattern (supports wildcards)
     * Examples:
     *   "winter-*" matches "winter-heating", "winter-lights"
     *   "*-motion" matches "door-motion", "pir-motion"
     *   "sensor-*-delay" matches "sensor-door-delay", "sensor-window-delay"
     */
    matchPattern(id, pattern) {
        if (pattern === id) return true; // Exact match
        if (!pattern.includes('*')) return false; // No wildcard

        // Convert wildcard pattern to regex
        const regexPattern = '^' + pattern
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special chars
            .replace(/\*/g, '.*') // Replace * with .*
            + '$';

        const regex = new RegExp(regexPattern);
        return regex.test(id);
    }

    /**
     * Get all waiter IDs matching a pattern
     */
    getWaitersByPattern(pattern) {
        const matches = [];
        for (const [id, data] of this.waiters.entries()) {
            if (this.matchPattern(id, pattern)) {
                matches.push({ id, data });
            }
        }
        return matches;
    }

    /**
     * Creates a new waiter to hold a flow branch until conditions are met.
     *
     * The waiter will resolve (continue the flow) when either:
     * - The target device capability reaches the specified value (YES-output)
     * - The timeout expires (NO-output)
     * - The waiter is manually triggered via flow action
     *
     * @param {string} id - Waiter ID (auto-generated if empty/null)
     * @param {object} config - Configuration { timeoutValue, timeoutUnit }
     * @param {object} flowContext - Flow execution context { flowId, flowToken }
     * @param {object} [deviceConfig=null] - Device listening config { deviceId, capability, targetValue }
     * @returns {Promise<string>} The waiter ID (useful when auto-generated)
     * @throws {Error} If maximum waiter limit reached or ID conflict
     *
     * Called by:
     *   - Flow action card "create_waiter" in app.js
     *   - Flow condition card "wait_until_becomes_true" in app.js
     *
     * Calls:
     *   - WaiterManager.generateWaiterId() - If no ID provided
     *   - WaiterManager.validateTimeout() - Validate timeout bounds
     *   - WaiterManager.convertToMs() - Convert timeout to milliseconds
     *   - WaiterManager.removeWaiter() - On timeout expiration
     *   - Logger methods - For status logging
     */
    async createWaiter(id, config, flowContext, deviceConfig = null) {
        // Check limits
        if (this.waiters.size >= this.MAX_WAITERS) {
            throw new Error(`Maximum number of waiters (${this.MAX_WAITERS}) reached`);
        }

        // Generate ID if not provided
        if (!id || id.trim() === '') {
            id = this.generateWaiterId();
        }

        // Check if waiter already exists with same flow
        const existing = this.waiters.get(id);
        if (existing && existing.flowId === flowContext.flowId) {
            this.logger.debug(`♻️  Re-initializing existing waiter: ${id}`);
            // Cancel old timeout
            if (existing.timeoutHandle) {
                clearTimeout(existing.timeoutHandle);
            }
            // Keep the resolver to trigger the same flow instance
        } else if (existing) {
            throw new Error(`Waiter ID "${id}" already exists for a different flow`);
        }

        // Convert timeout
        const timeoutMs = config.timeoutValue === 0
            ? 0
            : this.validateTimeout(this.convertToMs(config.timeoutValue, config.timeoutUnit));

        // Create waiter data
        const waiterData = {
            id,
            created: Date.now(),
            flowId: flowContext.flowId,
            flowToken: flowContext.flowToken,
            enabled: true,
            timeoutMs,
            timeoutHandle: null,
            resolver: null, // Will be set by the condition card
            config,
            deviceConfig,           // NEW: Store device listening info
            capabilityListener: null // NEW: Store listener reference
        };

        // Set timeout if specified
        if (timeoutMs > 0) {
            waiterData.timeoutHandle = setTimeout(() => {
                this.logger.warn(`⏰ Waiter "${id}" timed out after ${timeoutMs}ms`);

                // Get waiter data before removing
                const waiter = this.waiters.get(id);

                // Resolve with false to trigger NO-output (red path)
                if (waiter && waiter.resolver) {
                    try {
                        waiter.resolver(false);
                        this.logger.info(`❌ Waiter "${id}" resolved to NO-output (timeout)`);
                    } catch (error) {
                        this.logger.error(`Failed to resolve waiter "${id}" on timeout:`, error);
                    }
                }

                // Clean up
                this.removeWaiter(id);
            }, timeoutMs);
        }

        // Store waiter
        this.waiters.set(id, waiterData);

        // Track flow
        if (!this.flowTracking.has(flowContext.flowId)) {
            this.flowTracking.set(flowContext.flowId, new Set());
        }
        this.flowTracking.get(flowContext.flowId).add(id);

        // Warning if approaching limit
        if (this.waiters.size >= this.WARNING_THRESHOLD) {
            this.logger.warn(`⚠️  High waiter count: ${this.waiters.size}/${this.MAX_WAITERS}`);
        }

        this.logger.info(`✅ Waiter created: ${id} (timeout: ${timeoutMs}ms, total: ${this.waiters.size})`);

        return id;
    }

    /**
     * Enable or disable waiters matching a pattern
     *
     * @param {string} idPattern - Waiter ID or pattern with wildcards
     * @param {boolean} enabled - Enable (true) or disable (false)
     * @returns {number} - Number of waiters affected
     */
    enableWaiter(idPattern, enabled) {
        const matches = this.getWaitersByPattern(idPattern);

        if (matches.length === 0) {
            this.logger.warn(`⚠️  No waiters found matching pattern: ${idPattern}`);
            return 0;
        }

        let affected = 0;
        for (const { id, data: waiterData } of matches) {
            waiterData.enabled = enabled;
            affected++;
        }

        this.logger.info(`${enabled ? '✅' : '⏸️ '} ${enabled ? 'Enabled' : 'Disabled'} ${affected} waiter(s) matching "${idPattern}"`);
        return affected;
    }

    /**
     * Removes waiters matching a pattern, cleaning up all resources.
     *
     * Handles cleanup of:
     * - Timeout handles (clearTimeout)
     * - Capability listeners (removeListener)
     * - Flow tracking entries
     * - Waiter storage entries
     *
     * @param {string} idPattern - Waiter ID or pattern with wildcards (e.g., "winter-*")
     * @returns {number} Number of waiters removed
     *
     * Called by:
     *   - WaiterManager.createWaiter() - On timeout expiration
     *   - WaiterManager.registerCapabilityListener() - On target value match
     *   - WaiterManager.stopWaiter() - For graceful stop
     *   - WaiterManager.cleanupOrphans() - For orphan cleanup
     *   - Flow action cards - For manual waiter removal
     *
     * Calls:
     *   - WaiterManager.getWaitersByPattern() - Find matching waiters
     *   - Logger methods - For status logging
     */
    removeWaiter(idPattern) {
        const matches = this.getWaitersByPattern(idPattern);

        if (matches.length === 0) {
            return 0;
        }

        let removed = 0;
        for (const { id, data: waiterData } of matches) {
            // Cancel timeout
            if (waiterData.timeoutHandle) {
                clearTimeout(waiterData.timeoutHandle);
            }

            // Unregister capability listener
            if (waiterData.capabilityListener) {
                try {
                    const { device, capability, listener } = waiterData.capabilityListener;
                    device.removeListener(`capability.${capability}`, listener);
                    this.logger.debug(`🔇 Unregistered listener for ${id}`);
                } catch (error) {
                    this.logger.error(`Failed to unregister listener for ${id}:`, error);
                }
            }

            // Remove from flow tracking
            if (this.flowTracking.has(waiterData.flowId)) {
                this.flowTracking.get(waiterData.flowId).delete(id);
                if (this.flowTracking.get(waiterData.flowId).size === 0) {
                    this.flowTracking.delete(waiterData.flowId);
                }
            }

            // Remove waiter
            this.waiters.delete(id);
            removed++;
        }

        this.logger.info(`🗑️  Removed ${removed} waiter(s) matching "${idPattern}"`);
        return removed;
    }

    /**
     * Register capability listener for a waiter
     * @param {string} waiterId - Waiter ID
     * @param {object} homey - Homey API instance
     */
    async registerCapabilityListener(waiterId, homey) {
        const waiter = this.waiters.get(waiterId);
        if (!waiter || !waiter.deviceConfig) return;

        const { deviceId, capability, targetValue } = waiter.deviceConfig;

        try {
            // Get device from Homey API
            const device = await homey.devices.getDevice({ id: deviceId });

            // Register capability listener
            const listener = async (value) => {
                this.logger.debug(`📡 Capability change: ${deviceId}.${capability} = ${value}`);

                // Check if value matches target
                if (this.valueMatches(value, targetValue)) {
                    this.logger.info(`✅ Target value reached for waiter: ${waiterId}`);

                    // Trigger waiter (YES-output)
                    if (waiter.resolver && waiter.enabled) {
                        waiter.resolver(true);
                        this.logger.info(`✅ Waiter "${waiterId}" resolved to YES-output (capability matched)`);
                    }

                    this.removeWaiter(waiterId);
                }
            };

            // Register listener
            await device.makeCapabilityInstance(capability, listener);

            // Store listener reference for cleanup
            waiter.capabilityListener = {
                device,
                capability,
                listener
            };

            this.logger.debug(`📡 Registered listener for ${deviceId}.${capability}`);

        } catch (error) {
            this.logger.error(`Failed to register capability listener for ${waiterId}:`, error);
            throw error;
        }
    }

    /**
     * Check if actual value matches target value
     * @param {any} actual - Actual value from device
     * @param {string} target - Target value from user (as string)
     * @returns {boolean}
     */
    valueMatches(actual, target) {
        // Convert target string to appropriate type
        let targetTyped = target;

        if (target === 'true') targetTyped = true;
        else if (target === 'false') targetTyped = false;
        else if (!isNaN(target)) targetTyped = Number(target);

        return actual === targetTyped;
    }

    /**
     * Stop waiters gracefully (no output, just cleanup)
     * @param {string} idPattern - Waiter ID or pattern
     * @returns {number} - Number of waiters stopped
     */
    stopWaiter(idPattern) {
        const matches = this.getWaitersByPattern(idPattern);

        if (matches.length === 0) {
            this.logger.warn(`⚠️  No waiters found matching pattern: ${idPattern}`);
            return 0;
        }

        let stopped = 0;
        for (const { id, data: waiterData } of matches) {
            // Just remove without triggering any output
            // (resolver is NOT called, so flow stops here)
            this.removeWaiter(id);
            stopped++;
        }

        this.logger.info(`🛑 Stopped ${stopped} waiter(s) matching "${idPattern}"`);
        return stopped;
    }

    /**
     * Clean up orphaned waiters (flows that no longer exist)
     */
    async cleanupOrphans() {
        const orphaned = [];

        // Check each flow to see if it still exists
        for (const [flowId, waiterIds] of this.flowTracking.entries()) {
            // TODO: Implement flow existence check via Homey API
            // For now, we'll rely on timeouts and manual cleanup

            // Check if any waiters have expired
            for (const waiterId of waiterIds) {
                const waiter = this.waiters.get(waiterId);
                if (waiter) {
                    const age = Date.now() - waiter.created;
                    // If waiter is older than max timeout and has no timeout, it might be orphaned
                    if (waiter.timeoutMs === 0 && age > this.MAX_TIMEOUT_MS) {
                        orphaned.push(waiterId);
                    }
                }
            }
        }

        if (orphaned.length > 0) {
            this.logger.warn(`🧹 Cleaning up ${orphaned.length} potentially orphaned waiter(s)`);
            for (const id of orphaned) {
                this.removeWaiter(id);
            }
        }
    }

    /**
     * Get all active waiters
     */
    getAllWaiters() {
        const waiters = [];
        for (const [id, data] of this.waiters.entries()) {
            waiters.push({
                id,
                created: new Date(data.created).toISOString(),
                age: Date.now() - data.created,
                enabled: data.enabled,
                timeoutMs: data.timeoutMs,
                flowId: data.flowId
            });
        }
        return waiters;
    }

    /**
     * Get active waiters for autocomplete (Homey flow card format)
     * Returns array of { name, description, id } objects
     */
    getWaitersForAutocomplete(query = '') {
        const results = [];

        for (const [id, data] of this.waiters.entries()) {
            // Filter by query if provided
            if (query && !id.toLowerCase().includes(query.toLowerCase())) {
                continue;
            }

            const ageSeconds = Math.floor((Date.now() - data.created) / 1000);
            const timeoutInfo = data.timeoutMs === 0
                ? 'no timeout'
                : `timeout: ${data.timeoutMs}ms`;

            const statusIcon = data.enabled ? '✅' : '⏸️';

            results.push({
                name: id,
                description: `${statusIcon} Age: ${ageSeconds}s, ${timeoutInfo}`,
                id: id
            });
        }

        // Sort by creation time (newest first)
        results.sort((a, b) => {
            const dataA = this.waiters.get(a.id);
            const dataB = this.waiters.get(b.id);
            return (dataB?.created || 0) - (dataA?.created || 0);
        });

        return results;
    }

    /**
     * Check if a waiter is active
     */
    isWaiterActive(id) {
        return this.waiters.has(id);
    }

    /**
     * Get waiter status
     */
    getWaiterStatus() {
        return {
            total: this.waiters.size,
            enabled: Array.from(this.waiters.values()).filter(w => w.enabled).length,
            disabled: Array.from(this.waiters.values()).filter(w => !w.enabled).length,
            flows: this.flowTracking.size,
            maxWaiters: this.MAX_WAITERS
        };
    }

    /**
     * Cleans up all resources on application shutdown.
     *
     * Stops the cleanup interval, cancels all timeout handles,
     * and clears all storage maps. Should be called when the
     * Homey app is being unloaded.
     *
     * Called by:
     *   - app.js onUninit() - During application shutdown
     *
     * Calls:
     *   - clearInterval() - Stop cleanup timer
     *   - clearTimeout() - Cancel waiter timeouts
     *   - Logger.info() - Shutdown logging
     */
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        // Cancel all timeouts
        for (const [id, data] of this.waiters.entries()) {
            if (data.timeoutHandle) {
                clearTimeout(data.timeoutHandle);
            }
        }

        // Clear all waiters
        this.waiters.clear();
        this.flowTracking.clear();

        this.logger.info('🛑 WaiterManager destroyed');
    }
}

// Singleton instance
WaiterManager.instance = null;

module.exports = WaiterManager;
