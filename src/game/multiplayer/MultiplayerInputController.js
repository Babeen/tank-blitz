import { InputManager } from '../systems/Input.js';
import { PLAYER, TILE, T } from '../../../shared/gameConstants.js';

const SEND_INTERVAL_MS = 33;   // ~30 Hz — matches server tick rate
const HEARTBEAT_MS     = 200;  // resend unchanged state periodically

// ── Prediction helpers (mirrors GameSimulation movement exactly) ──────────────
const lerp     = (a, b, t) => a + (b - a) * t;
const clamp    = (v, a, b) => v < a ? a : v > b ? b : v;
function angLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function inputsEqual(a, b) {
  return a.up === b.up && a.down === b.down && a.left === b.left && a.right === b.right
    && a.turretAngle === b.turretAngle && a.shooting === b.shooting;
}

// Mirrors MapGenerator.isSolid() / GameSimulation._collides() — the same
// tile categories that block tank movement on the server.
function isSolidTile(t) {
  return t === T.BRICK || t === T.STEEL || t === T.CRATE || t === T.WATER || t === T.BARREL;
}

// Mirrors GameSimulation._collides() exactly: 8-point sampling around the
// tank's bounding radius against the shared map grid.
function collides(map, x, y, r) {
  if (!map) return false;
  for (const [ox, oy] of [[-r,-r],[r,-r],[-r,r],[r,r],[0,-r],[0,r],[-r,0],[r,0]]) {
    if (isSolidTile(map.tileAt(x + ox, y + oy))) return true;
  }
  return false;
}

// Mirrors GameSimulation._tryMove() exactly: per-axis collision-checked
// integration instead of unconditional boundary clamping. This keeps
// client prediction closely matching the server's real tile collision
// (Part 1C), so reconciliation corrections around walls are rare instead
// of routine.
function tryMove(state, dx, dy, map) {
  const r = PLAYER.RADIUS - 2;
  const nx = state.x + dx;
  if (!collides(map, nx, state.y, r)) state.x = nx; else state.vx *= -0.2;
  const ny = state.y + dy;
  if (!collides(map, state.x, ny, r)) state.y = ny; else state.vy *= -0.2;
  const worldW = map ? map.cols * TILE : 9999;
  const worldH = map ? map.rows * TILE : 9999;
  state.x = clamp(state.x, r + TILE, worldW - r - TILE);
  state.y = clamp(state.y, r + TILE, worldH - r - TILE);
}

/**
 * Applies one movement tick to a mutable state object, mirroring
 * GameSimulation._updatePlayer() exactly (minus shooting/dash side-effects).
 * Used for both initial prediction and reconciliation replay.
 */
function applyMovement(state, input, dt, map) {
  if (!state.alive || state.spawning > 0) return;

  // Mirrors GameSimulation._updatePlayer()'s cooldown tick — needed so
  // the client's own dash-availability gating (see stepPrediction) stays
  // in lockstep with the server's, instead of assuming any dashTime<=0
  // is immediately re-dashable.
  if (state.dashCd > 0) state.dashCd -= dt;

  let dx = 0, dy = 0;
  if (input.up)    dy -= 1;
  if (input.down)  dy += 1;
  if (input.left)  dx -= 1;
  if (input.right) dx += 1;
  const mag = Math.hypot(dx, dy);

  if (state.dashTime > 0) {
    state.dashTime -= dt;
    state.vx = Math.cos(state.dashDir) * state.maxSpeed * PLAYER.DASH_SPEED_MUL;
    state.vy = Math.sin(state.dashDir) * state.maxSpeed * PLAYER.DASH_SPEED_MUL;
  } else {
    if (mag > 0.1) {
      const target = Math.atan2(dy, dx);
      state.angle = angLerp(state.angle, target, Math.min(1, dt * PLAYER.TURN_LERP_RATE));
      const boost = state.speedBoost > 0 ? 1.5 : 1;
      state.speed = lerp(state.speed, state.maxSpeed * boost * Math.min(1, mag), dt * PLAYER.ACCEL_LERP_RATE);
    } else {
      state.speed = lerp(state.speed, 0, dt * PLAYER.DECEL_LERP_RATE);
      if (Math.abs(state.speed) < 0.5) state.speed = 0;
    }
    const onOil = map ? map.tileAt(state.x, state.y) === T.OIL : false;
    const grip = onOil ? 0.04 : PLAYER.VELOCITY_GRIP;
    state.vx = lerp(state.vx, Math.cos(state.angle) * state.speed, grip);
    state.vy = lerp(state.vy, Math.sin(state.angle) * state.speed, grip);
  }

  tryMove(state, state.vx * dt, state.vy * dt, map);

  if (Number.isFinite(input.turretAngle)) state.turretAngle = input.turretAngle;
}

// ─────────────────────────────────────────────────────────────────────────────

export class MultiplayerInputController {
  /**
   * @param {import('../../network/NetworkManager.js').NetworkManager} networkManager
   * @param {import('./MultiplayerRenderer.js').MultiplayerRenderer} renderer
   */
  constructor(networkManager, renderer) {
    this.networkManager = networkManager;
    this.renderer = renderer;
    this.input = new InputManager();

    this._seq = 0;
    // Pending inputs not yet acknowledged by server: [{ seq, input, dt }]
    this._pending = [];

    // Predicted local state (position/angle only — not HP/damage)
    this._predicted = null;

    // Map reference for boundary clamping during prediction
    this._map = null;

    // Drives per-animation-frame prediction stepping (stepPrediction),
    // decoupled from the 30 Hz network-send tick — see stepPrediction().
    this._predLast = 0;
    this._spaceWasDown = false;

    this._lastSent = { up: false, down: false, left: false, right: false, turretAngle: 0, shooting: false, dash: false };
    this._lastSentAt = 0;
    this._intervalId = null;
    this._dashPressed = false;
    this._onKeyDown = null;

    // Part 20/21 — gameplay input is only sent while the match is ACTIVE.
    // The server independently enforces this too (never trust the client),
    // but gating here avoids spamming input packets during countdown/results
    // and keeps the local tank visually frozen in the meantime.
    this._active = false;
  }

  /** Called by the app whenever the server-authoritative match state changes. */
  setActive(active) { this._active = !!active; }

  init(canvas) {
    this.input.init(canvas);
    this._onKeyDown = (e) => { if (e.code === 'Space') this._dashPressed = true; };
    window.addEventListener('keydown', this._onKeyDown);
    this._intervalId = setInterval(() => this.tick(), SEND_INTERVAL_MS);
  }

  destroy() {
    if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
    if (this._onKeyDown)  { window.removeEventListener('keydown', this._onKeyDown); this._onKeyDown = null; }
  }

  setMap(mapData) {
    // Lightweight map proxy for boundary/oil queries during prediction
    if (!mapData) { this._map = null; return; }
    this._map = {
      cols: mapData.cols,
      rows: mapData.rows,
      tileAt(px, py) {
        const gx = Math.floor(px / TILE), gy = Math.floor(py / TILE);
        if (gx < 0 || gy < 0 || gx >= mapData.cols || gy >= mapData.rows) return T.STEEL;
        return mapData.grid[gy][gx];
      },
    };
  }

  /**
   * Called by the renderer when a new authoritative server state arrives.
   * Performs server reconciliation:
   *   1. Adopt the server's authoritative position/angle.
   *   2. Discard inputs the server has already processed (seq <= lastSeq).
   *   3. Re-simulate remaining unacknowledged inputs on top of the server state.
   */
  reconcile(serverPlayer) {
    if (!serverPlayer) return;

    // Adopt authoritative non-positional state (HP, weapon, etc.) always
    if (!this._predicted) {
      this._predicted = {
        x: serverPlayer.x, y: serverPlayer.y,
        angle: serverPlayer.angle, turretAngle: serverPlayer.turretAngle,
        speed: 0, vx: 0, vy: 0,
        alive: serverPlayer.alive, spawning: serverPlayer.spawning || 0,
        maxSpeed: PLAYER.MAX_SPEED, speedBoost: serverPlayer.speedBoost || 0,
        dashTime: 0, dashDir: 0, dashCd: serverPlayer.dashCd || 0,
      };
      this.renderer?.setLocalPredicted(this._predicted);
      return;
    }

    // Discard acknowledged inputs
    const lastSeq = serverPlayer.lastSeq ?? 0;
    this._pending = this._pending.filter(p => p.seq > lastSeq);

    // Start from server-authoritative position — and, critically, from the
    // server's authoritative dash state too. Previously dashTime/dashDir/
    // dashCd were carried forward from the client's own prediction here,
    // so a locally-predicted dash that the server had actually rejected
    // (still on cooldown server-side) never got corrected: replay kept
    // "continuing" a dash the server never started, producing a large,
    // collision-checked-but-still-wrong displacement every reconcile —
    // the flicker/jump. Sourcing these from serverPlayer each time keeps
    // the client's cooldown gate (see stepPrediction) in lockstep with
    // the server, so an invalid local dash self-corrects within one
    // reconcile instead of diverging indefinitely.
    const state = {
      x: serverPlayer.x, y: serverPlayer.y,
      angle: serverPlayer.angle, turretAngle: serverPlayer.turretAngle,
      speed: this._predicted.speed, vx: this._predicted.vx, vy: this._predicted.vy,
      alive: serverPlayer.alive, spawning: serverPlayer.spawning || 0,
      maxSpeed: PLAYER.MAX_SPEED, speedBoost: serverPlayer.speedBoost || 0,
      dashTime: serverPlayer.dashTime || 0, dashDir: serverPlayer.dashDir || 0,
      dashCd: serverPlayer.dashCd || 0,
    };

    // Re-apply unacknowledged inputs
    for (const p of this._pending) {
      applyMovement(state, p.input, p.dt, this._map);
    }

    // Smooth small errors, snap large ones
    const errX = state.x - this._predicted.x;
    const errY = state.y - this._predicted.y;
    const errDist = Math.hypot(errX, errY);
    if (errDist < 80) {
      // Smooth correction over ~3 frames
      this._predicted.x = lerp(this._predicted.x, state.x, 0.3);
      this._predicted.y = lerp(this._predicted.y, state.y, 0.3);
    } else {
      this._predicted.x = state.x;
      this._predicted.y = state.y;
    }
    this._predicted.angle      = state.angle;
    this._predicted.turretAngle = state.turretAngle;
    this._predicted.speed      = state.speed;
    this._predicted.vx         = state.vx;
    this._predicted.vy         = state.vy;
    this._predicted.alive      = state.alive;
    this._predicted.spawning   = state.spawning;
    this._predicted.speedBoost = state.speedBoost;
    this._predicted.dashTime   = state.dashTime;
    this._predicted.dashDir    = state.dashDir;
    this._predicted.dashCd     = state.dashCd;

    this.renderer?.setLocalPredicted(this._predicted);
  }

  /**
   * Convenience wrapper: given the full players array from a GAME_STATE
   * packet and the local player's id, finds this client's entry and runs
   * reconciliation against it. No-op if the local player isn't present
   * (e.g. state arrived before the id is known yet).
   */
  applyServerState(players, localPlayerId) {
    if (!localPlayerId) return;
    const mine = players.find((p) => p.id === localPlayerId);
    if (mine) this.reconcile(mine);
  }

  /** Returns the current predicted position for the local tank, or null. */
  getPredicted() { return this._predicted; }

  /**
   * Advances local prediction by one render frame. Called every
   * requestAnimationFrame via the renderer's frame callback (~60 Hz),
   * independent of the ~30 Hz network-send tick() below.
   *
   * Why this exists: previously prediction only advanced inside tick(),
   * which runs on a 33ms setInterval. The render loop (rAF, ~60 Hz) just
   * redrew whatever position tick() last computed, so the local tank's
   * position only changed on roughly every other rendered frame — a
   * stair-step that reads as stutter, most visible during a fast dash.
   * Stepping prediction every rendered frame with the real frame dt fixes
   * that without touching how often we talk to the server.
   *
   * Dash is also triggered here (edge-detected every frame) rather than
   * in tick(), so a dash starts within one rendered frame of the keypress
   * instead of waiting for the next network-send tick.
   */
  stepPrediction(ts) {
    if (!this._predLast) this._predLast = ts;
    const dt = Math.min(0.05, Math.max(0, (ts - this._predLast) / 1000));
    this._predLast = ts;

    if (!this._active || !this._predicted) return;

    const movement = this.input.getMovementInput();
    const turretAngle = this.getTurretAngle();
    const input = {
      ...movement,
      turretAngle: turretAngle != null ? turretAngle : this._predicted.turretAngle,
    };

    // Edge-triggered dash start, gated on cooldown just like the server's
    // _tryDash(). Direction mirrors GameSimulation._tryDash(): the tank's
    // current facing angle at the instant the dash begins.
    const spaceDown = this.input.key('Space');
    if (spaceDown && !this._spaceWasDown && this._predicted.dashTime <= 0 && this._predicted.dashCd <= 0) {
      this._predicted.dashTime = PLAYER.DASH_DURATION;
      this._predicted.dashDir  = this._predicted.angle;
      this._predicted.dashCd   = PLAYER.DASH_CD;
    }
    this._spaceWasDown = spaceDown;

    applyMovement(this._predicted, input, dt, this._map);
    this.renderer?.setLocalPredicted(this._predicted);
  }

  getTurretAngle() {
    const localTank = this.renderer?.getLocalTank();
    if (!localTank) return null;
    const mouse = this.input.mouse;
    const world = this.renderer.screenToWorld(mouse.x, mouse.y);
    // Use predicted position for turret angle calculation so aiming feels immediate
    const tx = this._predicted?.x ?? localTank.x;
    const ty = this._predicted?.y ?? localTank.y;
    return Math.atan2(world.y - ty, world.x - tx);
  }

  tick() {
    if (!this._active) return; // countdown / lobby / results — no gameplay input

    const movement = this.input.getMovementInput();
    const turretAngle = this.getTurretAngle();
    const shooting = this.input.mouse.down;
    const dash = this._dashPressed || this.input.key('Space');
    this._dashPressed = false;

    const current = {
      ...movement,
      turretAngle: turretAngle != null ? turretAngle : this._lastSent.turretAngle,
      shooting,
      dash,
    };

    const now = performance.now();
    const changed = !inputsEqual(current, this._lastSent) || current.dash;
    if (changed || now - this._lastSentAt >= HEARTBEAT_MS) {
      this._seq++;
      const seq = this._seq;
      const dt = SEND_INTERVAL_MS / 1000;

      // Store in pending history for reconciliation replay (see reconcile()).
      // Actual movement/dash prediction now happens every render frame in
      // stepPrediction(), not here — this tick only decides what to send.
      this._pending.push({ seq, input: { ...current }, dt });
      // Cap history to avoid unbounded growth (> 2 s of inputs = network problem)
      if (this._pending.length > 120) this._pending.shift();

      this.networkManager.sendInput({ ...current, seq });
      this._lastSent = { ...current };
      this._lastSentAt = now;
    }
  }
}
