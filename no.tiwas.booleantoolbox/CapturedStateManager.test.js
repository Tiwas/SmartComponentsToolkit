const CapturedStateManager = require('./lib/CapturedStateManager');

function createManager() {
  CapturedStateManager.instance = null;
  const store = new Map();
  const homey = {
    settings: {
      get: jest.fn(key => store.get(key)),
      set: jest.fn((key, value) => store.set(key, value)),
      unset: jest.fn(key => store.delete(key)),
    },
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return new CapturedStateManager(homey, logger);
}

afterEach(() => {
  CapturedStateManager.instance = null;
});

describe('CapturedStateManager named state import/export', () => {
  test.each([
    ['hierarchical', {
      captured_at: '2026-09-05T00:00:00.000Z',
      config: { default_delay: 250, ignore_errors: false },
      metadata: { source: 'backup', label: 'Evening' },
      zones: {
        LivingRoom: {
          config: { delay_between: 100 },
          items: [{
            id: 'light-1',
            name: 'Lamp',
            active: true,
            capabilities: [{ capability: 'onoff', value: true }, { capability: 'dim', value: 0.5 }],
          }],
        },
      },
    }],
    ['legacy flat', {
      captured_at: '2026-09-05T00:00:00.000Z',
      config: { default_delay: 250 },
      metadata: { source: 'legacy-backup' },
      values: { 'light-1': { onoff: true, dim: 0.5 } },
    }],
  ])('round-trips %s named states through export and import', (_format, state) => {
    const manager = createManager();
    const deviceId = 'capture-device';

    manager.setStateFromJson(deviceId, 'Evening', state);
    const exported = manager.exportNamedStates(deviceId);

    manager.cleanupDevice(deviceId);
    const result = manager.importNamedStates(deviceId, exported);

    expect(result).toEqual({ imported: 1, overwritten: 0, errors: [] });
    expect(manager.exportNamedStates(deviceId)).toEqual(exported);
  });
});
