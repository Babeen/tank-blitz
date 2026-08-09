import http from 'http';
import assert from 'assert';
import { resolveAllowedOrigins, createCorsOriginFn, CorsConfigError } from '../server/corsConfig.js';
import { handleHttpRequest } from '../server/httpRoutes.js';

// ── CORS origin resolution (pure logic, no socket.io needed) ───────────────

console.log('--- resolveAllowedOrigins: unset in development -> empty (allow-all fallback) ---');
assert.deepStrictEqual(resolveAllowedOrigins({}), []);
assert.deepStrictEqual(resolveAllowedOrigins({ NODE_ENV: 'development' }), []);

console.log('--- resolveAllowedOrigins: single origin ---');
assert.deepStrictEqual(resolveAllowedOrigins({ CLIENT_URL: 'https://tank-arena.example.com' }), ['https://tank-arena.example.com']);

console.log('--- resolveAllowedOrigins: multiple comma-separated origins, trimmed ---');
assert.deepStrictEqual(
  resolveAllowedOrigins({ CLIENT_URL: 'https://a.example.com, https://b.example.com ,https://c.example.com' }),
  ['https://a.example.com', 'https://b.example.com', 'https://c.example.com']
);

console.log('--- resolveAllowedOrigins: legacy CLIENT_ORIGIN alias still works ---');
assert.deepStrictEqual(resolveAllowedOrigins({ CLIENT_ORIGIN: 'https://legacy.example.com' }), ['https://legacy.example.com']);

console.log('--- resolveAllowedOrigins: CLIENT_URL takes precedence over legacy alias ---');
assert.deepStrictEqual(
  resolveAllowedOrigins({ CLIENT_URL: 'https://new.example.com', CLIENT_ORIGIN: 'https://old.example.com' }),
  ['https://new.example.com']
);

console.log('--- resolveAllowedOrigins: FAILS CLOSED — throws in production when unset ---');
{
  assert.throws(
    () => resolveAllowedOrigins({ NODE_ENV: 'production' }),
    CorsConfigError
  );
}

console.log('--- resolveAllowedOrigins: fails closed even with a logger passed (does not just warn-and-continue) ---');
{
  const warnings = [];
  assert.throws(
    () => resolveAllowedOrigins({ NODE_ENV: 'production' }, { logger: { warn: (m) => warnings.push(m), debug: () => {} } }),
    CorsConfigError
  );
  // No CORS-permissive fallback happened — the call never returned an
  // (empty, allow-all) result, it threw instead.
}

console.log('--- resolveAllowedOrigins: whitespace-only CLIENT_URL is treated as unset in production -> throws ---');
{
  assert.throws(
    () => resolveAllowedOrigins({ NODE_ENV: 'production', CLIENT_URL: ' , , ' }),
    CorsConfigError
  );
}

console.log('--- resolveAllowedOrigins: production WITH CLIENT_URL set -> works normally, no throw ---');
assert.deepStrictEqual(
  resolveAllowedOrigins({ NODE_ENV: 'production', CLIENT_URL: 'https://tank-arena.example.com' }),
  ['https://tank-arena.example.com']
);

console.log('--- corsOrigin: allow-all when no origins configured ---');
{
  const fn = createCorsOriginFn([]);
  let called = null;
  fn('https://anything.example.com', (err, ok) => { called = [err, ok]; });
  assert.strictEqual(called[0], null);
  assert.strictEqual(called[1], true);
}

console.log('--- corsOrigin: allows exact match against allow-list ---');
{
  const fn = createCorsOriginFn(['https://tank-arena.example.com']);
  let called = null;
  fn('https://tank-arena.example.com', (err, ok) => { called = [err, ok]; });
  assert.strictEqual(called[0], null);
  assert.strictEqual(called[1], true);
}

console.log('--- corsOrigin: rejects origin not on the allow-list ---');
{
  const fn = createCorsOriginFn(['https://tank-arena.example.com']);
  let called = null;
  fn('https://evil.example.com', (err, ok) => { called = [err, ok]; });
  assert.ok(called[0] instanceof Error);
}

console.log('--- corsOrigin: allows requests with no Origin header (curl/health checks) ---');
{
  const fn = createCorsOriginFn(['https://tank-arena.example.com']);
  let called = null;
  fn(undefined, (err, ok) => { called = [err, ok]; });
  assert.strictEqual(called[0], null);
  assert.strictEqual(called[1], true);
}

console.log('CORS logic tests: ALL PASSED');

// ── HTTP route handler: real TCP-level test (built-in http module only) ───

function get(server, path) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    http.get(`http://127.0.0.1:${addr.port}${path}`, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

async function testHttpRoutes() {
  const server = http.createServer(handleHttpRequest);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  console.log('--- GET /health -> 200 JSON {status:"ok"} ---');
  const health = await get(server, '/health');
  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.headers['content-type'], 'application/json');
  const parsed = JSON.parse(health.body);
  assert.strictEqual(parsed.status, 'ok');
  assert.strictEqual(typeof parsed.uptime, 'number');
  console.log('body:', health.body);

  console.log('--- GET /anything-else -> 404 ---');
  const missing = await get(server, '/nope');
  assert.strictEqual(missing.status, 404);

  await new Promise((resolve) => server.close(resolve));
  console.log('HTTP route tests: ALL PASSED');
}

await testHttpRoutes();

console.log('ALL HTTP + CORS TESTS PASSED');
