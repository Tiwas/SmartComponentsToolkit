import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const directory = path.dirname(fileURLToPath(import.meta.url));
const editorPath = path.resolve(directory, '../../../../docs/tools/boolean-editor.html');
const html = await readFile(editorPath, 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];

assert.ok(script, 'Boolean Editor must contain its application script');

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  url: 'https://tiwas.github.io/SmartComponentsToolkit/tools/boolean-editor.html',
});
const { window } = dom;
Object.defineProperty(window, 'HomeyLibrariesReady', { value: Promise.resolve() });
Object.defineProperty(window, 'AthomCloudAPI', { value: class {} });
Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async () => undefined } });
Object.defineProperty(window, 'fetch', { value: async () => ({ ok: true, json: async () => ({}) }) });
window.alert = () => undefined;
window.eval(script);
await new Promise(resolve => setTimeout(resolve, 0));

const app = (window as unknown as { app: any }).app;
assert.ok(app, 'Boolean Editor must initialize the application');

const payload = '<img src=x onerror="window.__xss = true">';
app.allZones = { zone: { name: payload } };
app.allDevices = {
  device: {
    id: payload,
    zone: 'zone',
    name: payload,
    driverId: 'logic-device',
    capabilitiesObj: {
      cap: { id: payload, title: payload },
    },
  },
};
app.logicDeviceCapabilities = [{
  deviceId: payload,
  capabilityId: payload,
  deviceName: payload,
  capabilityTitle: payload,
}];

app.renderEditDevices();
app.renderLogicDeviceCapabilityList();
app.updateLogicDeviceSelectedList();
app.removeLogicDeviceCapability(0);
assert.equal(app.logicDeviceCapabilities.length, 0, 'hostile identifiers must not break capability removal');
app.logicDeviceCapabilities = [{ deviceId: payload, capabilityId: payload, deviceName: payload, capabilityTitle: payload }];
app.updateLogicDeviceSelectedList();
app.showDeviceSelectionModal('logic-device');
app.api = {
  devices: {
    getDeviceSettingsObj: async () => [{
      type: 'group', title: payload, children: [{ id: payload, title: payload, hint: payload, value: payload, units: payload }],
    }],
  },
};
await app.openSettingsModal('device');
app.showOutputModal(payload, { formulas: [{ name: payload, expression: payload }] }, payload);

const dynamicRoots = [
  window.document.getElementById('edit-devices-list'),
  window.document.getElementById('logic-device-capability-list'),
  window.document.getElementById('logic-device-selected-list'),
  window.document.getElementById('settings-modal-content'),
  window.document.body.lastElementChild,
];

for (const root of dynamicRoots) {
  assert.equal(root?.querySelectorAll('img, script, [onerror], [onclick]').length, 0, 'untrusted data must not create executable DOM');
  assert.match(root?.textContent ?? '', /<img src=x onerror=/, 'fixture must remain text');
}
assert.equal((window as unknown as { __xss?: boolean }).__xss, undefined, 'fixture must never execute');
assert.doesNotMatch(html, /localStorage\.(?:getItem|setItem)\('homey_client_(?:id|secret)'\)/, 'credentials must not persist in localStorage');

console.log('Boolean Editor XSS regression fixtures passed');
