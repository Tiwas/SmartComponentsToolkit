'use strict';

const fs = require('fs');
const path = require('path');
const { DEFAULT_PROFILE, mergeProfile } = require('./lib/CircadianProfile');

const EDITORS = [
  'drivers/circadian-light-group/pair/edit_configuration.html',
  'drivers/circadian-light-group/repair/repair_configuration.html',
];

// Pulls the browser-side normalizeAnchor() out of an editor page so it can be compared with the device.
function loadNormalizeAnchor(relativePath) {
  const html = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
  const start = html.indexOf('function normalizeAnchor(');
  let end = html.indexOf('{', start);
  let depth = 0;
  for (; end < html.length; end++) {
    if (html[end] === '{') depth++;
    else if (html[end] === '}' && --depth === 0) break;
  }
  return new Function(`${html.slice(start, end + 1)}\nreturn normalizeAnchor;`)();
}

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
  });
});
