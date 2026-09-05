# Dependency security policy

## Supported dependency checks

Run the following from the named directory before a release:

- `no.tiwas.booleantoolbox`: `npm audit --omit=dev --audit-level=high`
- `apps/dashboard`: `npm audit --audit-level=high` and `npm audit --omit=dev --audit-level=high`

The dashboard's development and production dependency trees must have no high-or-higher findings. The Homey runtime must have no high-or-higher findings; its remaining moderate findings are recorded below.

## Accepted Homey runtime risk

`homey-api` 3.17.0 uses Socket.IO 2.x, which still pulls in `parseuri` 0.0.6. Its [ReDoS advisory](https://github.com/advisories/GHSA-6fx8-h7jm-663j) has no compatible fixed transitive version: `parseuri` 3.x is not API-compatible with the Socket.IO 2.x client. Newer `homey-api` releases require Node.js 24, while this Homey app supports the older Homey Node.js runtime.

The app is a Socket.IO client; it does not expose a listening Socket.IO endpoint. The remaining risk therefore requires a malicious or compromised Homey/API endpoint to supply a crafted URI. This moderate upstream risk is accepted only while all of the following remain true:

- the app uses the authenticated Homey API endpoint rather than an untrusted URL;
- `socket.io-parser` is pinned through `overrides` to 3.3.6 or later, which fixes GHSA-2m8v-j782-fhvr;
- `npm audit --omit=dev --audit-level=high` remains clean; and
- the dependency is reviewed when Homey supports the Node.js version required by a fixed `homey-api` release, or when Socket.IO 2.x receives a compatible fix.

Do not use `npm audit fix --force` for the Homey app: its suggested `homey-api` change is not a compatible upgrade path.
