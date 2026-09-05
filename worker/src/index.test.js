import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorker } from './index.js';

function cache() {
  const values = new Map();
  return {
    match: async key => values.get(key.url)?.clone() || null,
    put: async (key, value) => values.set(key.url, value.clone()),
  };
}

function request(ids, { origin = 'https://my.homey.app', body } = {}) {
  return new Request('https://worker.example/versions', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: body ?? JSON.stringify({ ids }),
  });
}

test('negatively caches confirmed missing apps without caching upstream failures', async () => {
  const edgeCache = cache();
  let calls = 0;
  const worker = createWorker({ cache: edgeCache, fetchImpl: async () => {
    calls += 1;
    return new Response('', { status: 404 });
  }, observe: () => {} });
  const ctx = { waitUntil: promise => promise };

  assert.equal((await worker.fetch(request(['missing.app']), {}, ctx)).status, 200);
  assert.equal((await worker.fetch(request(['missing.app']), {}, ctx)).status, 200);
  assert.equal(calls, 2, 'the second invalid-id lookup is served from negative cache');
});

test('does not cache transient upstream errors', async () => {
  const edgeCache = cache();
  let calls = 0;
  const worker = createWorker({ cache: edgeCache, fetchImpl: async () => {
    calls += 1;
    return new Response('', { status: 503 });
  }, observe: () => {} });
  const ctx = { waitUntil: promise => promise };

  await worker.fetch(request(['temporarily.unavailable']), {}, ctx);
  await worker.fetch(request(['temporarily.unavailable']), {}, ctx);
  assert.equal(calls, 4, 'both channel lookups retry after a transient failure');
});

test('limits requests and provides retry guidance', async () => {
  const worker = createWorker({ cache: cache(), fetchImpl: async () => new Response('', { status: 404 }), observe: () => {} });
  const response = await worker.fetch(request(['app.id']), {
    VERSIONS_RATE_LIMITER: { limit: async () => ({ success: false }) },
  }, { waitUntil: promise => promise });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '60');
});

test('rejects oversized bodies before parsing', async () => {
  const worker = createWorker({ cache: cache(), observe: () => {} });
  const response = await worker.fetch(request([], { body: JSON.stringify({ ids: ['x'.repeat(20_000)] }) }), {}, { waitUntil: promise => promise });
  assert.equal(response.status, 400);
});
