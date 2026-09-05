// Flow Doctor Versions Worker
// Fetches published stable + test versions for Homey apps from homey.app
// (server-side, no CORS). Edge-cached for 1 hour so we make at most one
// upstream request per app per hour regardless of client volume.
//
// Endpoint:
//   POST /versions    body: { "ids": ["no.tiwas.booleantoolbox", ...] }
//   →  { "no.tiwas.booleantoolbox": { "stable": "1.10.8", "test": "1.10.9-rc.2" } }

const CACHE_TTL_SECONDS = 3600;
const NEGATIVE_CACHE_TTL_SECONDS = 300;
const MAX_BODY_BYTES = 16 * 1024;
// We process ids serially inside an invocation (parallel fan-out caused
// homey.app to rate-limit us). 10 ids serial × 2 fetches each was slow
// enough to time out, so cap at 5. The Flow Doctor client fans out across
// invocations instead — each batch is a separate Worker invocation with
// its own subrequest budget and gets to homey.app from a different edge
// connection.
const MAX_IDS_PER_REQUEST = 5;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const DEFAULT_ALLOWED_ORIGINS = new Set(['https://my.homey.app']);

const CORS_HEADERS = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
};

export function createWorker({ cache = null, fetchImpl = fetch, observe = defaultObserve } = {}) {
    return {
    async fetch(request, env = {}, ctx = { waitUntil: () => {} }) {
        const origin = allowedOrigin(request, env);
        if (request.method === 'OPTIONS') {
            return origin ? new Response(null, { headers: corsHeaders(origin) }) : json({ error: 'origin not allowed' }, 403);
        }

        const url = new URL(request.url);
        if (request.method !== 'POST' || url.pathname !== '/versions') {
            return json({ error: 'POST /versions only' }, 404, origin);
        }
        if (!origin) return json({ error: 'origin not allowed' }, 403);

        const limited = await enforceRateLimit(request, env, observe);
        if (limited) return json({ error: 'rate limit exceeded' }, 429, origin, { 'Retry-After': '60' });

        let body;
        try {
            body = await readJsonBody(request);
        } catch {
            return json({ error: 'invalid or oversized JSON body' }, 400, origin);
        }

        const ids = Array.isArray(body?.ids)
            ? [...new Set(body.ids)]
                  .filter((s) => typeof s === 'string' && ID_PATTERN.test(s))
                  .slice(0, MAX_IDS_PER_REQUEST)
            : [];

        if (!ids.length) return json({}, 200, origin);

        // Serialize across ids inside one invocation. Earlier parallel
        // fan-out (20 upstream fetches in flight at once per Worker) caused
        // homey.app to rate-limit our edge IP, leaving most results null.
        // Inside getVersions stable+test still fire in parallel — that's
        // only 2 concurrent requests per id, which homey.app tolerates.
        const out = {};
        for (const id of ids) {
            out[id] = await getVersions(id, ctx, { cache: cache || caches.default, fetchImpl, observe });
        }
        return json(out, 200, origin);
    },
};
}

export default createWorker();

export async function getVersions(id, ctx, { cache, fetchImpl = fetch, observe = defaultObserve } = {}) {
    const cacheKey = new Request(`https://flow-doctor-versions.cache/v5/${encodeURIComponent(id)}`);
    const cached = await cache.match(cacheKey);
    if (cached) {
        try {
            observe('cache_hit');
            return await cached.json();
        } catch {
            /* fall through and refetch */
        }
    }

    observe('cache_miss');
    const [stable, test] = await Promise.all([
        fetchChannelVersion(id, 'stable', fetchImpl, observe),
        fetchChannelVersion(id, 'test', fetchImpl, observe),
    ]);
    const result = { stable: stable.version, test: test.version };

    // Cache confirmed misses briefly, but never cache upstream failures.
    // This prevents random nonexistent IDs from bypassing the cache while
    // allowing transient Homey App Store failures to recover promptly.
    if (stable.cacheable && test.cacheable) {
        const negative = !stable.version && !test.version;
        const ttl = negative ? NEGATIVE_CACHE_TTL_SECONDS : CACHE_TTL_SECONDS;
        const cacheResponse = new Response(JSON.stringify(result), {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': `public, max-age=${ttl}`,
                'X-Cache-Result': negative ? 'negative' : 'positive',
            },
        });
        ctx.waitUntil(cache.put(cacheKey, cacheResponse));
    }
    return result;
}

async function fetchChannelVersion(id, channel, fetchImpl, observe) {
    // homey.app/a/<id>[/test] is the public app page. It redirects through
    // a locale prefix to e.g. /no-no/app/<id>/<App-Title>/ (or .../test/ if
    // there is a separately-published test build). Apps without a test build
    // have their /test URL silently redirected to the regular page, so we
    // verify the final redirected URL contains '/test' before trusting the
    // returned version as the test-channel one.
    const path = channel === 'test' ? `${encodeURIComponent(id)}/test` : encodeURIComponent(id);
    const upstream = `https://homey.app/a/${path}`;
    try {
        const res = await fetchImpl(upstream, {
            cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
            headers: { 'User-Agent': 'flow-doctor-versions/1.0 (+https://tiwas.github.io/SmartComponentsToolkit/)' },
        });
        if (!res.ok) {
            observe('upstream_error', { status: res.status });
            return { version: null, cacheable: res.status === 404 };
        }
        if (channel === 'test' && !/\/test\/?$/i.test(new URL(res.url).pathname)) {
            // Redirected away from /test → no separate test build published.
            return { version: null, cacheable: true };
        }
        const html = await res.text();
        const version = extractVersion(html);
        return { version, cacheable: Boolean(version) };
    } catch {
        observe('upstream_error', { status: 'network' });
        return { version: null, cacheable: false };
    }
}

function extractVersion(html) {
    // Most reliable: the data-hy-app-version="x.y.z" attribute on the page's
    // app container. Stable on homey.app for years; survives Next.js / Nuxt
    // shifts since it's a server-rendered HTML data attribute.
    const dataAttr = html.match(/data-hy-app-version="([0-9]+\.[0-9]+\.[0-9]+[A-Za-z0-9.\-+]*)"/);
    if (dataAttr) return dataAttr[1];
    // Fallback: the AddSearch meta tag carries the same value in a different shape.
    const meta = html.match(/hy_app_version=([0-9]+\.[0-9]+\.[0-9]+[A-Za-z0-9.\-+]*)/);
    if (meta) return meta[1];
    return null;
}

function allowedOrigin(request, env) {
    const origin = request.headers.get('Origin');
    if (!origin) return null;
    const configured = String(env.ALLOWED_ORIGINS || '')
        .split(',').map(value => value.trim()).filter(Boolean);
    return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]).has(origin) ? origin : null;
}

function corsHeaders(origin) {
    return { ...CORS_HEADERS, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
}

async function enforceRateLimit(request, env, observe) {
    if (!env.VERSIONS_RATE_LIMITER) return false;
    const key = request.headers.get('CF-Connecting-IP') || 'unknown-client';
    const { success } = await env.VERSIONS_RATE_LIMITER.limit({ key });
    if (!success) observe('rate_limited');
    return !success;
}

async function readJsonBody(request) {
    const contentLength = Number(request.headers.get('Content-Length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) throw new Error('body too large');
    const reader = request.body?.getReader();
    if (!reader) return {};
    let size = 0;
    const chunks = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) throw new Error('body too large');
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
}

function defaultObserve(event, fields = {}) {
    console.log(JSON.stringify({ service: 'flow-doctor-versions', event, ...fields }));
}

function json(payload, status, origin, headers = {}) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { ...(origin ? corsHeaders(origin) : {}), ...headers, 'Content-Type': 'application/json' },
    });
}
