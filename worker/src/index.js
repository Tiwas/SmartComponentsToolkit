// Flow Doctor Versions Worker
// Fetches published stable + test versions for Homey apps from homey.app
// (server-side, no CORS). Edge-cached for 1 hour so we make at most one
// upstream request per app per hour regardless of client volume.
//
// Endpoint:
//   POST /versions    body: { "ids": ["no.tiwas.booleantoolbox", ...] }
//   →  { "no.tiwas.booleantoolbox": { "stable": "1.10.8", "test": "1.10.9-rc.2" } }

const CACHE_TTL_SECONDS = 3600;
// Cloudflare Workers free tier allows 50 subrequests per invocation. Each
// id triggers up to 2 upstream fetches (stable + test), so cap at 20 ids
// per request to keep us safely under the limit. The Flow Doctor client
// chunks larger batches client-side.
const MAX_IDS_PER_REQUEST = 20;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
};

export default {
    async fetch(request, env, ctx) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: CORS_HEADERS });
        }

        const url = new URL(request.url);
        if (request.method !== 'POST' || url.pathname !== '/versions') {
            return json({ error: 'POST /versions only' }, 404);
        }

        let body;
        try {
            body = await request.json();
        } catch {
            return json({ error: 'invalid JSON body' }, 400);
        }

        const ids = Array.isArray(body?.ids)
            ? [...new Set(body.ids)]
                  .filter((s) => typeof s === 'string' && ID_PATTERN.test(s))
                  .slice(0, MAX_IDS_PER_REQUEST)
            : [];

        if (!ids.length) return json({}, 200);

        const out = {};
        await Promise.all(
            ids.map(async (id) => {
                out[id] = await getVersions(id, ctx);
            })
        );
        return json(out, 200);
    },
};

async function getVersions(id, ctx) {
    const cacheKey = new Request(`https://flow-doctor-versions.cache/v3/${encodeURIComponent(id)}`);
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) {
        try {
            return await cached.json();
        } catch {
            /* fall through and refetch */
        }
    }

    const [stable, test] = await Promise.all([fetchChannelVersion(id, 'stable'), fetchChannelVersion(id, 'test')]);
    const result = { stable, test };

    const cacheResponse = new Response(JSON.stringify(result), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
        },
    });
    ctx.waitUntil(cache.put(cacheKey, cacheResponse));
    return result;
}

async function fetchChannelVersion(id, channel) {
    // homey.app/a/<id>[/test] is the public app page. It redirects through
    // a locale prefix to e.g. /no-no/app/<id>/<App-Title>/ (or .../test/ if
    // there is a separately-published test build). Apps without a test build
    // have their /test URL silently redirected to the regular page, so we
    // verify the final redirected URL contains '/test' before trusting the
    // returned version as the test-channel one.
    const path = channel === 'test' ? `${encodeURIComponent(id)}/test` : encodeURIComponent(id);
    const upstream = `https://homey.app/a/${path}`;
    try {
        const res = await fetch(upstream, {
            cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
            headers: { 'User-Agent': 'flow-doctor-versions/1.0 (+https://tiwas.github.io/SmartComponentsToolkit/)' },
        });
        if (!res.ok) return null;
        if (channel === 'test' && !/\/test\/?$/i.test(new URL(res.url).pathname)) {
            // Redirected away from /test → no separate test build published.
            return null;
        }
        const html = await res.text();
        return extractVersion(html);
    } catch {
        return null;
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

function json(payload, status) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
}
