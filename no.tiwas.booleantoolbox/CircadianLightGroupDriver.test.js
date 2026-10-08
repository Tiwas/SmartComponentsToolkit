jest.mock('homey', () => ({
  Driver: class {},
  Device: class {},
}), { virtual: true });

jest.mock('suncalc', () => ({}), { virtual: true });

const fs = require('node:fs');
const path = require('node:path');
const CircadianLightGroupDriver = require('./drivers/circadian-light-group/driver');
const CircadianLightGroupDevice = require('./drivers/circadian-light-group/device');

function registerCards() {
  const listeners = {};
  const card = id => ({
    registerRunListener: jest.fn((listener) => {
      listeners[id] = listener;
    }),
    registerArgumentAutocompleteListener: jest.fn(),
  });
  const driver = Object.create(CircadianLightGroupDriver.prototype);
  driver.homey = { flow: { getActionCard: jest.fn(card), getConditionCard: jest.fn(card) } };
  driver.registerFlowCards();
  return { driver, listeners };
}

function readActionCard(id) {
  const file = path.join(__dirname, '.homeycompose', 'flow', 'actions', `${id}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

describe('CircadianLightGroupDriver Flow card results', () => {
  test('every action card that declares tokens returns them, and the others keep their old result', async () => {
    const { driver, listeners } = registerCards();
    const actionIds = driver.homey.flow.getActionCard.mock.calls.map(([id]) => id);
    const outcome = CircadianLightGroupDevice.createOperationOutcome({ total: 3, pending: ['Hall'] });

    for (const id of actionIds) {
      const definition = readActionCard(id);
      const device = Object.create(CircadianLightGroupDevice.prototype);
      device.debug = jest.fn();
      const handler = jest.fn().mockResolvedValue(outcome);
      const result = await listeners[id]({
        device: new Proxy(device, {
          get: (target, property) => (typeof property === 'string' && property.startsWith('onFlow') ? handler : target[property]),
        }),
      });

      if (Array.isArray(definition.tokens)) {
        expect(definition.tokens.map(token => token.name)).toEqual(['completed', 'status']);
        expect(definition.deprecated).toBeUndefined();
        expect(result).toEqual({
          completed: false,
          status: 'Continued before everything was confirmed. Lights still being retried in the background (1 of 3): Hall.',
        });
      } else {
        expect(result).toBe(true);
      }
    }

    expect(actionIds).toEqual(expect.arrayContaining(['clg_turn_on', 'clg_turn_off', 'clg_toggle', 'clg_resume']));
    ['clg_turn_on', 'clg_turn_off', 'clg_toggle'].forEach((id) => {
      expect(readActionCard(id).tokens).toBeDefined();
    });
  });

  test('cards that can be in standard Flows get no tokens, because Homey hides THEN cards with tokens there', () => {
    [
      'clg_apply_now',
      'clg_resume',
      'clg_turn_on_member',
      'clg_apply_state',
      'clg_force_red_mode',
      'clg_set_external_lux',
      'clg_pause',
      'clg_pause_until_time',
      'clg_pause_until_solar',
      'clg_set_red_threshold',
    ].forEach((id) => {
      expect({ id, tokens: readActionCard(id).tokens }).toEqual({ id, tokens: undefined });
    });
  });
});

describe('CircadianLightGroupDriver probe cleanup', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('destroys all capability instances after completing a pairing probe', async () => {
    jest.useFakeTimers();
    const instance = { destroy: jest.fn() };
    const apiDevice = {
      capabilitiesObj: { onoff: { value: false, setable: true } },
      makeCapabilityInstance: jest.fn(() => instance),
      setCapabilityValue: jest.fn().mockResolvedValue(undefined),
    };
    const driver = Object.create(CircadianLightGroupDriver.prototype);
    driver.homey = { app: { api: { devices: { getDevice: jest.fn().mockResolvedValue(apiDevice) } } } };
    driver.debug = jest.fn();
    driver.error = jest.fn();

    const probe = driver.probeDevice('light-1');
    await jest.runAllTimersAsync();
    await probe;

    expect(apiDevice.makeCapabilityInstance).toHaveBeenCalledWith('onoff', expect.any(Function));
    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });
});
