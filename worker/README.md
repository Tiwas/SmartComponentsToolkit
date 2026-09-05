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

`POST /versions` — body `{ "ids": ["app.id.one", "app.id.two"] }` (max 5 ids, 16 KiB body).

Response: `{ "app.id.one": { "stable": "1.0.0", "test": "1.0.1-rc.1" } }` —
either field is `null` if that channel doesn't exist or the upstream lookup
failed.

Each app with a confirmed result is cached on the Cloudflare edge for 1 hour.
Confirmed missing apps are negatively cached for 5 minutes; transient upstream
failures are never cached.

## Abuse controls and observability

The Worker accepts browser requests from `https://my.homey.app` only. Add other
trusted Flow Doctor origins as a comma-separated `ALLOWED_ORIGINS` Worker
variable. A Cloudflare Rate Limiting binding caps each client IP at 10 requests
per minute and returns `429` with `Retry-After: 60` when exceeded.

Structured Worker logs record only aggregate events (`cache_hit`, `cache_miss`,
`upstream_error`, `rate_limited`) and upstream status; they do not log client
IPs, app IDs, request bodies, or credentials. Inspect them in Workers Logs to
monitor cache hit rate, upstream errors, and throttling.

## Tests

```sh
npm test
```
