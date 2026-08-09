// Lightweight fixed-window rate limiter, keyed per caller (typically a
// socket id). Deliberately simple — this is flood/accident protection for
// discrete, low-frequency events (create room, join room, rematch, ...),
// NOT a defense against a determined attacker, and NOT applied to normal
// gameplay input (movement/shoot/dash), which is already naturally bounded
// by the server-side weapon/dash cooldowns in GameSimulation.
export class RateLimiter {
  constructor(maxEvents, windowMs) {
    this.maxEvents = maxEvents;
    this.windowMs = windowMs;
    this.hits = new Map(); // key -> [timestamps]
  }

  /** Returns true if the call is allowed, false if the caller is over the limit. */
  allow(key) {
    const now = Date.now();
    let arr = this.hits.get(key);
    if (!arr) { arr = []; this.hits.set(key, arr); }
    while (arr.length && now - arr[0] > this.windowMs) arr.shift();
    if (arr.length >= this.maxEvents) return false;
    arr.push(now);
    return true;
  }

  /** Drops all tracked hits for a key — call this when a socket disconnects. */
  clear(key) { this.hits.delete(key); }
}
