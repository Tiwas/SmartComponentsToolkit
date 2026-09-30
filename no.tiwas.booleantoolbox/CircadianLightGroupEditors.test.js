'use strict';

const fs = require('fs');
const path = require('path');
const { DEFAULT_PROFILE, mergeProfile } = require('./lib/CircadianProfile');

const EDITORS = [
  'drivers/circadian-light-group/pair/edit_configuration.html',
  'drivers/circadian-light-group/repair/repair_configuration.html',
];

// Returns the source of a browser-side function declared in an editor page.
function extractFunction(relativePath, name) {
  const html = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
  const start = html.indexOf(`function ${name}(`);
  let end = html.indexOf('{', start);
  let depth = 0;
  for (; end < html.length; end++) {
    if (html[end] === '{') depth++;
    else if (html[end] === '}' && --depth === 0) break;
  }
  return html.slice(start, end + 1);
}

// Pulls the browser-side normalizeAnchor() out of an editor page so it can be compared with the device.
function loadNormalizeAnchor(relativePath) {
  return new Function(`${extractFunction(relativePath, 'normalizeAnchor')}\nreturn normalizeAnchor;`)();
}

// unknownSensorOption() reads the page's `sensors` list and uses its t() and esc() helpers.
function loadUnknownSensorOption(relativePath, sensors, t) {
  return new Function('sensors', 't', `${extractFunction(relativePath, 'esc')}\n${extractFunction(relativePath, 'unknownSensorOption')}\nreturn unknownSensorOption;`)(sensors, t);
}

const SENSORS = [{ id: 'sensor-1', name: 'Garden', zoneName: 'Outside' }];
const translate = key => (key === 'pair.circadian_light_group.unknown_lux_sensor' ? 'Ukjent sensor' : key);

const ANCHORS = {
  'a lux anchor': { mode: 'lux', sensorDeviceId: 'sensor-1', threshold: 250, direction: 'rising', fallbackTime: '06:30' },
  'a lux anchor with threshold 0': { mode: 'lux', sensorDeviceId: 'sensor-1', threshold: 0, direction: 'falling', fallbackTime: '23:10' },
  'a lux anchor with missing and invalid fields': { mode: 'lux', threshold: 'abc', direction: 'sideways', time: '08:00' },
  'a solar anchor': { mode: 'solar', solarEvent: 'sunset', offsetMinutes: -20, fallbackTime: '19:30' },
  'a time anchor': { mode: 'time', time: '06:45' },
  'a legacy string anchor': '06:15',
  'an anchor with an unknown mode': { mode: 'weather', time: '06:00' },
};

describe('Circadian Light Group editors', () => {
  EDITORS.forEach(editor => {
    const normalizeAnchor = loadNormalizeAnchor(editor);

    Object.entries(ANCHORS).forEach(([name, anchor]) => {
      test(`${path.basename(editor)} normalizes ${name} like the device`, () => {
        const device = mergeProfile({ anchors: { morning: anchor } }).anchors.morning;

        expect(normalizeAnchor(anchor, DEFAULT_PROFILE.anchors.morning)).toEqual(device);
      });
    });

    test(`${path.basename(editor)} keeps a saved sensor that get_lux_sensors did not return`, () => {
      const unknownSensorOption = loadUnknownSensorOption(editor, [], translate);

      expect(unknownSensorOption('sensor-x')).toBe('<option value="sensor-x" selected>Ukjent sensor (sensor-x)</option>');
    });

    test(`${path.basename(editor)} escapes an unknown sensor id`, () => {
      const unknownSensorOption = loadUnknownSensorOption(editor, SENSORS, translate);

      expect(unknownSensorOption('a"b<c')).toBe('<option value="a&quot;b&lt;c" selected>Ukjent sensor (a&quot;b&lt;c)</option>');
    });

    test(`${path.basename(editor)} adds no unknown sensor option for a listed or empty sensor id`, () => {
      const unknownSensorOption = loadUnknownSensorOption(editor, SENSORS, translate);

      expect(unknownSensorOption('sensor-1')).toBe('');
      expect(unknownSensorOption(null)).toBe('');
      expect(unknownSensorOption('')).toBe('');
    });
  });
});
