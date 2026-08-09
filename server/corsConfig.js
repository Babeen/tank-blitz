// Resolves the configured allow-list from env vars. Pure/no side effects
// beyond logging, so this is easy to unit-test in isolation.
//
// CLIENT_URL accepts one or more comma-separated origins, e.g.
//   CLIENT_URL=https://tank-arena.example.com
//   CLIENT_URL=https://tank-arena.example.com,https://staging.tank-arena.example.com
// CLIENT_ORIGIN is kept as a deprecated alias so any existing deployment
// config from before this stage keeps working unchanged.
//
// Fail-closed in production: NODE_ENV=production with no CLIENT_URL throws
// instead of silently falling back to allow-all CORS. Development keeps the
// permissive allow-all fallback so a fresh checkout still runs immediately.
export class CorsConfigError extends Error {}

export function resolveAllowedOrigins(env = process.env, { logger } = {}) {
  const raw = env.CLIENT_URL || env.CLIENT_ORIGIN || '';
  const origins = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const isProd = env.NODE_ENV === 'production';

  if (origins.length === 0) {
    if (isProd) {
      throw new CorsConfigError(
        'CLIENT_URL is required when NODE_ENV=production — refusing to start with an open (allow-all) CORS policy. ' +
        'Set CLIENT_URL to your deployed frontend origin(s), e.g. CLIENT_URL=https://your-frontend-domain'
      );
    }
    if (logger) logger.debug('CLIENT_URL not set — allowing all origins for local development.');
  }
  return origins;
}

// Socket.IO's cors.origin accepts a function so we can validate against a
// configurable allow-list instead of hardcoding a domain or using `"*"`
// unconditionally. Falls back to allow-all only when no origins are
// configured, which is fine for local dev and flagged by resolveAllowedOrigins
// above for production.
export function createCorsOriginFn(allowedOrigins) {
  return function corsOrigin(origin, callback) {
    if (allowedOrigins.length === 0) return callback(null, true);
    if (!origin) return callback(null, true); // non-browser clients (health checks, curl, server-to-server)
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`Origin ${origin} is not allowed by CORS.`));
  };
}
