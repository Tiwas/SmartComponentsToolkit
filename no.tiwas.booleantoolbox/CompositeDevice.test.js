"use strict";

jest.mock("homey", () => ({
  Device: class {},
  Driver: class {},
}), { virtual: true });

jest.mock("./lib/Logger", () => class MockLogger {
  info() {}

  warn() {}

  error() {}

  debug() {}
});

const CompositeDevice = require("./drivers/composite-device/device");
const CompositeDeviceDriver = require("./drivers/composite-device/driver");

function createCapabilityTarget(id, capabilityId, value, options = {}) {
  let listener = null;
  const capabilityInstance = {
    destroy: jest.fn(),
    once: jest.fn(),
    lastChanged: new Date(options.updatedAt || 100),
  };
  const target = {
    id,
    name: options.name || id,
    zone: options.zone || "zone-1",
    capabilitiesObj: {
      [capabilityId]: {
        value,
        type: options.type || typeof value,
        title: options.title || capabilityId,
        units: options.units || "",
        decimals: options.decimals || 0,
        getable: true,
        lastUpdated: new Date(options.updatedAt || 100),
      },
    },
    makeCapabilityInstance: jest.fn((requestedCapability, callback) => {
      expect(requestedCapability).toBe(capabilityId);
      listener = callback;
      return capabilityInstance;
    }),
    emitValue: async nextValue => {
      target.capabilitiesObj[capabilityId].value = nextValue;
      capabilityInstance.lastChanged = new Date(200);
      listener(nextValue, capabilityInstance);
      await new Promise(resolve => setImmediate(resolve));
    },
    capabilityInstance,
  };
  return target;
}

function createCompositeDevice(configuration, targets) {
  const device = new CompositeDevice();
  const capabilityValues = new Map([
    [configuration.outputCapability, null],
    ["alarm_config", null],
  ]);
  device.driver = { id: "composite-device" };
  device.homey = {
    app: {
      ensureHomeyApi: jest.fn(async () => ({
        devices: {
          getDevice: jest.fn(async ({ id }) => {
            if (targets[id] instanceof Error) throw targets[id];
            return targets[id] || null;
          }),
        },
      })),
    },
  };
  device.getStoreValue = jest.fn(() => configuration);
  device.hasCapability = jest.fn(capabilityId => capabilityValues.has(capabilityId));
  device.addCapability = jest.fn(async capabilityId => capabilityValues.set(capabilityId, null));
  device.getCapabilityValue = jest.fn(capabilityId => capabilityValues.get(capabilityId));
  device.setCapabilityValue = jest.fn(async (capabilityId, value) => {
    capabilityValues.set(capabilityId, value);
  });
  device.setAvailable = jest.fn(async () => {});
  device.setUnavailable = jest.fn(async () => {});
  device.capabilityValues = capabilityValues;
  return device;
}

function createConfig(overrides = {}) {
  return {
    version: 1,
    capabilityId: "measure_humidity",
    sourceType: "number",
    operation: "max",
    outputCapability: "measure_composite",
    sourceMetadata: {
      title: "Humidity",
      units: "%",
      decimals: 1,
    },
    sources: [
      { id: "sensor-1", name: "Sensor 1" },
      { id: "sensor-2", name: "Sensor 2" },
    ],
    ...overrides,
  };
}

describe("CompositeDevice", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("aggregates initial values and reacts to source updates", async () => {
    const first = createCapabilityTarget("sensor-1", "measure_humidity", 40);
    const second = createCapabilityTarget("sensor-2", "measure_humidity", 65);
    const device = createCompositeDevice(createConfig(), {
      "sensor-1": first,
      "sensor-2": second,
    });

    await device.onInit();
    expect(device.capabilityValues.get("measure_composite")).toBe(65);
    expect(device.capabilityValues.get("alarm_config")).toBe(false);
    expect(device.setAvailable).toHaveBeenCalled();

    await first.emitValue(72);
    expect(device.capabilityValues.get("measure_composite")).toBe(72);
    expect(device.capabilityValues.get("alarm_config")).toBe(false);

    await device.onDeleted();
    expect(first.capabilityInstance.destroy).toHaveBeenCalledTimes(1);
    expect(second.capabilityInstance.destroy).toHaveBeenCalledTimes(1);
  });

  test("keeps aggregating available values while raising a source alarm", async () => {
    const first = createCapabilityTarget("sensor-1", "measure_humidity", 44);
    const device = createCompositeDevice(createConfig(), {
      "sensor-1": first,
      "sensor-2": new Error("Offline"),
    });

    await device.onInit();
    expect(device.capabilityValues.get("measure_composite")).toBe(44);
    expect(device.capabilityValues.get("alarm_config")).toBe(true);
    expect(device.setAvailable).toHaveBeenCalled();
    await device.onDeleted();
  });

  test("marks the device unavailable when no source has a valid value", async () => {
    const device = createCompositeDevice(createConfig(), {
      "sensor-1": new Error("Offline"),
      "sensor-2": new Error("Offline"),
    });

    await device.onInit();
    expect(device.capabilityValues.get("alarm_config")).toBe(true);
    expect(device.setUnavailable).toHaveBeenCalledWith(expect.stringContaining("No selected source"));
    await device.onDeleted();
  });
});

describe("CompositeDeviceDriver", () => {
  function createDriver() {
    const humidityOne = createCapabilityTarget("humidity-1", "measure_humidity", 42, {
      name: "Bathroom",
      title: "Humidity",
      type: "number",
      units: "%",
      decimals: 1,
    });
    const humidityTwo = createCapabilityTarget("humidity-2", "measure_humidity", 57, {
      name: "Bedroom",
      title: "Humidity",
      type: "number",
      units: "%",
      decimals: 1,
    });
    const driver = new CompositeDeviceDriver();
    driver.id = "composite-device";
    driver.homey = {
      i18n: { getLanguage: () => "en" },
      app: {
        ensureHomeyApi: jest.fn(async () => ({
          devices: {
            getDevices: jest.fn(async () => ({
              "humidity-1": humidityOne,
              "humidity-2": humidityTwo,
            })),
          },
          zones: {
            getZones: jest.fn(async () => ({
              "zone-1": { id: "zone-1", name: "Upstairs" },
            })),
          },
        })),
      },
    };
    return driver;
  }

  test("discovers shared capabilities and creates a dynamic output device", async () => {
    const driver = createDriver();
    await driver.onInit();
    const handlers = new Map();
    const session = {
      setHandler: jest.fn((name, handler) => handlers.set(name, handler)),
    };
    await driver.onPair(session);

    const groups = await handlers.get("get_capability_groups")();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      capabilityId: "measure_humidity",
      title: "Humidity",
      units: "%",
      deviceCount: 2,
    });
    expect(groups[0].operations.map(operation => operation.id)).toContain("max");

    const sources = await handlers.get("get_devices_for_capability")({
      groupId: groups[0].id,
    });
    expect(sources).toHaveLength(2);

    const pairedDevice = await handlers.get("create_device")({
      groupId: groups[0].id,
      operation: "max",
      selectedIds: sources.map(source => source.id),
      name: "Highest Humidity",
    });
    expect(pairedDevice).toMatchObject({
      name: "Highest Humidity",
      class: "sensor",
      icon: "/icon.svg",
      capabilities: ["measure_composite", "alarm_config"],
    });
    expect(pairedDevice.capabilitiesOptions.measure_composite.units)
      .toEqual({ en: "%", no: "%" });
    expect(pairedDevice.store.composite_config).toMatchObject({
      capabilityId: "measure_humidity",
      sourceType: "number",
      operation: "max",
      outputCapability: "measure_composite",
    });
  });

  test("requires at least two source devices", async () => {
    const driver = createDriver();
    await driver.onInit();
    const handlers = new Map();
    await driver.onPair({
      setHandler: (name, handler) => handlers.set(name, handler),
    });
    const groups = await handlers.get("get_capability_groups")();
    const sources = await handlers.get("get_devices_for_capability")({ groupId: groups[0].id });
    await expect(handlers.get("create_device")({
      groupId: groups[0].id,
      operation: "max",
      selectedIds: [sources[0].id],
      name: "Invalid Composite",
    })).rejects.toThrow("at least two");
  });
});
