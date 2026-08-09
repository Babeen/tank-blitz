// Minimal structured logging with a dev/production distinction.
//
// - info/warn/error always print — these are the low-frequency lifecycle
//   events called out in the Stage 7 spec (server started, room created,
//   match started/ended, player connected/disconnected, room destroyed).
// - debug only prints outside production (or when DEBUG=1 is set), and is
//   the place for anything chatty. Nothing in this codebase calls debug()
//   with per-tick data (movement/bullets/GAME_STATE) — that stays out of
//   the log entirely, at any level, since it's useless noise even in dev.
const isProd = process.env.NODE_ENV === 'production';
const debugEnabled = !isProd || process.env.DEBUG === '1';

function ts() { return new Date().toISOString(); }
function fmt(level, args) { return [`[${ts()}] [${level}]`, ...args]; }

export const logger = {
  info(...args)  { console.log(...fmt('info', args)); },
  warn(...args)  { console.warn(...fmt('warn', args)); },
  error(...args) { console.error(...fmt('error', args)); },
  debug(...args) { if (debugEnabled) console.log(...fmt('debug', args)); },
};
