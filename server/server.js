import http from 'http';
import { Server } from 'socket.io';
import { GameServer } from './GameServer.js';
import { logger } from './logger.js';
import { resolveAllowedOrigins, createCorsOriginFn, CorsConfigError } from './corsConfig.js';
import { handleHttpRequest } from './httpRoutes.js';

const PORT = parseInt(process.env.PORT, 10) || 4000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Fail closed: in production, an unconfigured CLIENT_URL is a
// misconfiguration, not a reason to fall back to an open CORS policy — so
// the process refuses to start rather than silently accepting connections
// from any origin. Development keeps running with the permissive fallback.
let allowedOrigins;
try {
  allowedOrigins = resolveAllowedOrigins(process.env, { logger });
} catch (err) {
  if (err instanceof CorsConfigError) {
    logger.error(`FATAL: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
const corsOrigin = createCorsOriginFn(allowedOrigins);

const httpServer = http.createServer(handleHttpRequest);

const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
  },
});

const gameServer = new GameServer(io);
gameServer.init();

httpServer.listen(PORT, () => {
  logger.info(`Tank Arena Blitz multiplayer server listening on port ${PORT} (${NODE_ENV})`);
});

// ── Graceful shutdown ────────────────────────────────────────────────────
// Stops accepting new work, tears down every room's simulation loop and
// timers, then closes Socket.IO/HTTP cleanly. A failsafe timer forces exit
// if anything hangs, so the process is never stuck.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received — shutting down gracefully...`);

  httpServer.close(() => logger.debug('HTTP server closed.'));
  gameServer.shutdown();

  io.close(() => {
    logger.info('Socket.IO closed. Exiting.');
    process.exit(0);
  });

  setTimeout(() => {
    logger.warn('Graceful shutdown timed out — forcing exit.');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Last-resort safety net. Every socket handler and the simulation tick loop
// already catch and log their own errors (see GameServer.js / GameSimulation.js)
// so the server keeps running for everyone else — this only catches what
// slips past that, and logs it instead of letting the whole process crash.
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason);
});
