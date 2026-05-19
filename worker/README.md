# flow-doctor-versions Worker

Tiny Cloudflare Worker that resolves Homey App Store stable + test versions
for Flow Doctor. Server-side, edge-cached, no CORS issues.

## Deploy

```sh
cd worker
wrangler deploy
```

First deploy prints your endpoint, e.g. `https://flow-doctor-versions.<account>.workers.dev`.

Paste that URL into Flow Doctor's browser console once:

```js
localStorage.setItem('flowdoctor_versions_worker', 'https://flow-doctor-versions.<account>.workers.dev')
```

…then reload Flow Doctor. Re-scan: dev apps will lazy-load stable + test versions.

## Local test

```sh
wrangler dev
# then
curl -X POST http://localhost:8787/versions \
  -H "Content-Type: application/json" \
  -d '{"ids":["no.tiwas.booleantoolbox"]}'
```

## API

`POST /versions` — body `{ "ids": ["app.id.one", "app.id.two"] }` (max 50 ids).

Response: `{ "app.id.one": { "stable": "1.0.0", "test": "1.0.1-rc.1" } }` —
either field is `null` if that channel doesn't exist or the upstream lookup
failed.

Each app is cached on the Cloudflare edge for 1 hour.
