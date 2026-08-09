import { Tank } from '../entities/Tank.js';
import { TILE, T, WEAPONS } from '../constants/index.js';
import { GAME_EVENTS } from '../../../shared/protocol.js';
import { ParticleSystem } from '../systems/Particles.js';
import { AudioManager } from '../systems/Audio.js';
import { Utils } from '../utils/index.js';

const LOCAL_COLORS  = { color: '#6bd35a', turretColor: '#4fae42', team: 'player' };
const REMOTE_COLORS = { color: '#5aa8ff', turretColor: '#2f7fe0', team: 'p2'     };

const { lerp, angLerp } = Utils;

// Fallback snapshot interval used for the very first interpolation step,
// before we've measured the real gap between two server packets.
// Matches the server's default tick rate (30/sec).
const DEFAULT_SNAPSHOT_MS = 1000 / 30;
// Clamp measured snapshot gaps so a hiccup (e.g. a dropped packet) doesn't
// produce a huge interpolation window and a slow-motion glide.
const MIN_SNAPSHOT_MS = 16;
const MAX_SNAPSHOT_MS = 250;
// If a remote entity's position jumped further than this between two
// snapshots (e.g. a long disconnect gap, or a respawn we didn't detect via
// the alive-flag check), snap instead of interpolating — sliding across
// half the map in 250ms reads as a glitch, not smooth movement.
const MAX_INTERP_DIST = 260;

export class MultiplayerRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = 0; this.H = 0; this.dpr = 1;
    this.tanks = new Map();       // playerId -> Tank
    this.localPlayerId = null;
    this.running = false;

    // Map data received from server
    this.mapData = null;          // { cols, rows, theme, grid }

    // Authoritative bullet/powerup state from server (most recent snapshot,
    // kept separate from the interpolated visual state below).
    this.bullets = [];
    this.powerups = [];

    // ── Remote-entity interpolation buffers ──────────────────────────────
    // playerId -> { prevX, prevY, prevAngle, prevTurret, targetX, targetY,
    //               targetAngle, targetTurret, snapAt, snapDt }
    this._remoteInterp = new Map();
    // bulletId -> { prevX, prevY, targetX, targetY, snapAt, snapDt }
    this._bulletInterp = new Map();

    // Local-player render override, supplied each frame by the
    // MultiplayerInputController's client-prediction output. When absent,
    // the local tank falls back to the raw authoritative server position.
    this._localPredicted = null;

    // Camera (follows local tank)
    this.cam = { x: 0, y: 0, zoom: 1, shakeT: 0, shakeMag: 0 };

    // Client-side effects only
    this.particles = new ParticleSystem();
    this.audio = new AudioManager();
    this._audioInit = false;

    // Part 22 — compact toggleable scoreboard. Purely a rendering concern
    // (like the K/D chips already drawn per-tank below), driven entirely by
    // the authoritative kills/deaths already carried on each tank.
    this.showScoreboard = false;

    // World<->screen transform (recomputed each draw)
    this.scale = 1; this.offX = 0; this.offY = 0;

    this._boundLoop   = this.loop.bind(this);
    this._boundResize = () => this.resize();
    this._last = 0;
  }

  init() {
    this.resize();
    window.addEventListener('resize', this._boundResize);
    this.running = true;
    this._last = performance.now();
    requestAnimationFrame(this._boundLoop);
  }

  destroy() {
    this.running = false;
    window.removeEventListener('resize', this._boundResize);
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.canvas.width  = this.W * this.dpr; this.canvas.height = this.H * this.dpr;
    this.canvas.style.width = this.W + 'px'; this.canvas.style.height = this.H + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setLocalPlayerId(id) { this.localPlayerId = id; }

  setShowScoreboard(show) { this.showScoreboard = !!show; }
  toggleScoreboard() { this.showScoreboard = !this.showScoreboard; }

  getLocalTank() {
    return this.localPlayerId != null ? (this.tanks.get(this.localPlayerId) || null) : null;
  }

  setMapData(mapData) { this.mapData = mapData; }

  /**
   * Ingests a new authoritative GAME_STATE.players snapshot.
   *
   * This does NOT set tank.x/y/angle directly for remote players — it only
   * records prev/target interpolation targets. The actual render-state
   * (tank.x/y/angle/turret) is computed every animation frame in
   * _applyInterpolation(), so remote players glide between snapshots
   * instead of jumping.
   *
   * The local player's authoritative fields (hp, alive, etc.) are adopted
   * immediately, but its rendered x/y/angle come from client prediction
   * (see setLocalPredicted) when available.
   */
  setPlayers(players = []) {
    const now = performance.now();
    const seenIds = new Set();
    for (const p of players) {
      seenIds.add(p.id);
      const isLocal = p.id === this.localPlayerId;
      const style = isLocal ? LOCAL_COLORS : REMOTE_COLORS;
      let tank = this.tanks.get(p.id);
      const isNew = !tank;
      if (!tank) {
        tank = new Tank(p.x, p.y, { angle: p.angle, maxHp: p.maxHp, color: style.color, turretColor: style.turretColor, team: style.team, name: p.name });
        this.tanks.set(p.id, tank);
      }

      // Non-positional authoritative state always adopted immediately.
      tank.hp = p.hp; tank.maxHp = p.maxHp;
      tank.alive = !!p.alive;
      tank.dead = !p.alive;
      tank.spawning = p.spawning || 0;
      tank.shield = p.shield || 0;
      tank.hitFlash = p.hitFlash || 0;
      tank.name = p.name;
      tank.color = style.color; tank.turretColor = style.turretColor; tank.team = style.team;
      tank._kills  = p.kills  || 0;
      tank._deaths = p.deaths || 0;
      tank._weapon = p.weapon || 'cannon';
      tank._ammo   = p.ammo   || {};
      tank._dashCd = p.dashCd || 0;

      if (isLocal) {
        // Local render position comes from prediction (setLocalPredicted).
        // If prediction hasn't produced anything yet (e.g. first frame),
        // fall back to the raw authoritative position.
        if (!this._localPredicted) {
          tank.x = p.x; tank.y = p.y; tank.angle = p.angle; tank.turret = p.turretAngle;
        }
        // On death/respawn, snap immediately rather than interpolating —
        // there's no meaningful "movement" to smooth across a teleport.
        if (isNew) { tank.x = p.x; tank.y = p.y; tank.angle = p.angle; tank.turret = p.turretAngle; }
        continue;
      }

      // Remote player: update interpolation targets, don't touch tank.x/y yet.
      let interp = this._remoteInterp.get(p.id);
      const respawned = interp && interp.wasAlive === false && p.alive;
      const teleported = interp && Utils.dist(interp.targetX, interp.targetY, p.x, p.y) > MAX_INTERP_DIST;
      if (!interp || isNew || respawned || teleported) {
        // First snapshot for this player, or a teleport (respawn) — snap
        // both prev and target so there's nothing to glide across.
        interp = {
          prevX: p.x, prevY: p.y, prevAngle: p.angle, prevTurret: p.turretAngle,
          targetX: p.x, targetY: p.y, targetAngle: p.angle, targetTurret: p.turretAngle,
          snapAt: now, snapDt: DEFAULT_SNAPSHOT_MS, wasAlive: p.alive,
        };
        this._remoteInterp.set(p.id, interp);
        tank.x = p.x; tank.y = p.y; tank.angle = p.angle; tank.turret = p.turretAngle;
      } else {
        const dt = now - interp.snapAt;
        interp.snapDt = Utils.clamp(dt, MIN_SNAPSHOT_MS, MAX_SNAPSHOT_MS);
        interp.snapAt = now;
        interp.prevX = interp.targetX; interp.prevY = interp.targetY;
        interp.prevAngle = interp.targetAngle; interp.prevTurret = interp.targetTurret;
        interp.targetX = p.x; interp.targetY = p.y;
        interp.targetAngle = p.angle; interp.targetTurret = p.turretAngle;
        interp.wasAlive = p.alive;
      }
    }
    for (const id of Array.from(this.tanks.keys())) {
      if (!seenIds.has(id)) { this.tanks.delete(id); this._remoteInterp.delete(id); }
    }
  }

  /**
   * Supplies the client-predicted local-player render position/angle,
   * computed by MultiplayerInputController. Called once per input tick
   * (and after reconciliation) — the render loop reads whatever was last
   * set here for the local tank's x/y/angle/turret.
   */
  setLocalPredicted(predicted) {
    this._localPredicted = predicted;
  }

  setBullets(bullets = []) {
    const now = performance.now();
    const seen = new Set();
    for (const b of bullets) {
      seen.add(b.id);
      let interp = this._bulletInterp.get(b.id);
      const angle = b.angle || 0;
      if (!interp) {
        interp = { prevX: b.x, prevY: b.y, prevAngle: angle, targetX: b.x, targetY: b.y, targetAngle: angle, snapAt: now, snapDt: DEFAULT_SNAPSHOT_MS };
        this._bulletInterp.set(b.id, interp);
      } else {
        const dt = now - interp.snapAt;
        interp.snapDt = Utils.clamp(dt, MIN_SNAPSHOT_MS, MAX_SNAPSHOT_MS);
        interp.snapAt = now;
        interp.prevX = interp.targetX; interp.prevY = interp.targetY; interp.prevAngle = interp.targetAngle;
        interp.targetX = b.x; interp.targetY = b.y; interp.targetAngle = angle;
      }
    }
    for (const id of Array.from(this._bulletInterp.keys())) {
      if (!seen.has(id)) this._bulletInterp.delete(id);
    }
    // Keep the raw authoritative array for non-positional fields (color,
    // radius, trail, etc.) — positions get overwritten with interpolated
    // values in _applyInterpolation() right before drawing.
    this.bullets = bullets;
  }

  setPowerups(powerups = []) { this.powerups = powerups; }

  /**
   * Runs every animation frame, right before drawing: computes the
   * interpolated visual x/y/angle for every remote tank and bullet from
   * their prev/target snapshot buffers, and applies the local player's
   * predicted position. This is the only place tank.x/y/angle and
   * bullet.x/y are mutated for rendering purposes — it never touches the
   * authoritative server data itself.
   */
  _applyInterpolation(now) {
    for (const [id, tank] of this.tanks) {
      if (id === this.localPlayerId) {
        if (this._localPredicted) {
          tank.x = this._localPredicted.x; tank.y = this._localPredicted.y;
          tank.angle = this._localPredicted.angle; tank.turret = this._localPredicted.turretAngle;
        }
        continue;
      }
      const interp = this._remoteInterp.get(id);
      if (!interp) continue;
      const alpha = Utils.clamp((now - interp.snapAt) / interp.snapDt, 0, 1);
      tank.x = lerp(interp.prevX, interp.targetX, alpha);
      tank.y = lerp(interp.prevY, interp.targetY, alpha);
      tank.angle = angLerp(interp.prevAngle, interp.targetAngle, alpha);
      tank.turret = angLerp(interp.prevTurret, interp.targetTurret, alpha);
    }

    for (const b of this.bullets) {
      const interp = this._bulletInterp.get(b.id);
      if (!interp) continue;
      const alpha = Utils.clamp((now - interp.snapAt) / interp.snapDt, 0, 1);
      b.x = lerp(interp.prevX, interp.targetX, alpha);
      b.y = lerp(interp.prevY, interp.targetY, alpha);
      if (b.rocket) b.angle = angLerp(interp.prevAngle, interp.targetAngle, alpha);
    }
  }

  handleGameEvent(event) {
    if (!this._audioInit) { this.audio.init(); this._audioInit = true; }
    switch (event.type) {
      case GAME_EVENTS.PLAYER_HIT:
        if (event.shielded) {
          this.particles.spawn(event.x, event.y, { count: 8, color: '#5aa8ff', speedMax: 120, life: 0.3 });
        } else {
          this.particles.spawn(event.x, event.y, { count: 8, color: '#ff6b6b', speedMax: 140, life: 0.3 });
          this.audio.hit?.();
          if (event.playerId === this.localPlayerId) this._shake(6);
        }
        break;
      case GAME_EVENTS.PLAYER_DIED:
        this.particles.explosion(event.x, event.y, 1);
        this.audio.explode?.();
        this._shake(10);
        break;
      case GAME_EVENTS.PLAYER_RESPAWNED:
        this.particles.spawn(event.x, event.y, { count: 16, color: '#6bd35a', speedMax: 160, life: 0.5 });
        break;
      case GAME_EVENTS.BULLET_FIRED:
        this.particles.spawn(event.x, event.y, { count: 6, color: '#fff4c2', angle: event.angle, spread: 0.5, speedMin: 80, speedMax: 200, life: 0.2 });
        this.audio[WEAPONS[event.weapon]?.sound]?.();
        break;
      case GAME_EVENTS.POWERUP_PICKED:
        this.particles.spawn(event.x, event.y, { count: 16, speedMax: 180, life: 0.5 });
        this.audio.pickup?.();
        break;
      case GAME_EVENTS.BARREL_EXPLODED:
        this.particles.explosion(event.x, event.y, 1.4);
        this.audio.explode?.();
        this._shake(14);
        break;
      case GAME_EVENTS.DASH_STARTED:
        this.particles.spawn(event.x, event.y, { count: 6, color: '#fff', speedMax: 80, life: 0.2 });
        break;
    }
  }

  _shake(mag) {
    this.cam.shakeMag = Math.max(this.cam.shakeMag, mag);
    this.cam.shakeT = 0.3;
  }

  screenToWorld(canvasX, canvasY) {
    return { x: (canvasX - this.offX) / this.scale, y: (canvasY - this.offY) / this.scale };
  }

  loop(ts) {
    if (!this.running) return;
    const dt = Math.min(0.05, (ts - this._last) / 1000 || 0);
    this._last = ts;
    this.particles.update(dt);
    if (this.cam.shakeT > 0) { this.cam.shakeT -= dt; this.cam.shakeMag *= 0.88; }
    this._applyInterpolation(ts);
    this.draw();
    requestAnimationFrame(this._boundLoop);
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);

    if (!this.mapData) {
      ctx.fillStyle = '#151824'; ctx.fillRect(0, 0, this.W, this.H);
      return;
    }

    const worldW = this.mapData.cols * TILE;
    const worldH = this.mapData.rows * TILE;

    // Camera follows local tank
    const localTank = this.getLocalTank();
    const targetX = localTank ? localTank.x : worldW / 2;
    const targetY = localTank ? localTank.y : worldH / 2;

    this.scale = Math.min(this.W / worldW, this.H / worldH) * 0.95;
    // Clamp camera so map fills screen
    const viewW = this.W / this.scale, viewH = this.H / this.scale;
    const camX = Math.max(0, Math.min(targetX - viewW / 2, worldW - viewW));
    const camY = Math.max(0, Math.min(targetY - viewH / 2, worldH - viewH));

    this.offX = -camX * this.scale;
    this.offY = -camY * this.scale;

    // Sky background
    ctx.fillStyle = '#3a3226'; ctx.fillRect(0, 0, this.W, this.H);

    let sx = 0, sy = 0;
    if (this.cam.shakeT > 0) {
      sx = (Math.random() - 0.5) * this.cam.shakeMag * 2;
      sy = (Math.random() - 0.5) * this.cam.shakeMag * 2;
    }

    ctx.save();
    ctx.translate(this.offX + sx, this.offY + sy);
    ctx.scale(this.scale, this.scale);

    this._drawMap(ctx, camX, camY, viewW, viewH);
    this._drawPowerups(ctx);
    for (const tank of this.tanks.values()) tank.draw(ctx);
    this._drawBullets(ctx);
    this._drawBushTops(ctx, camX, camY, viewW, viewH);
    this.particles.draw(ctx);

    ctx.restore();

    this._drawHUD(ctx);
  }

  // ── Map rendering (mirrors GameEngine.drawMap / drawTile) ─────────────────

  _drawMap(ctx, camX, camY, viewW, viewH) {
    if (!this.mapData) return;
    const { cols, rows, grid } = this.mapData;
    const startX = Math.max(0, Math.floor(camX / TILE));
    const startY = Math.max(0, Math.floor(camY / TILE));
    const endX   = Math.min(cols, Math.ceil((camX + viewW) / TILE));
    const endY   = Math.min(rows, Math.ceil((camY + viewH) / TILE));
    const fa = '#3a3226', fb = '#453b2c';
    for (let y = startY; y < endY; y++) for (let x = startX; x < endX; x++) {
      const t = grid[y][x], px = x * TILE, py = y * TILE;
      ctx.fillStyle = ((x + y) % 2 === 0) ? fa : fb;
      ctx.fillRect(px, py, TILE, TILE);
      this._drawTile(ctx, t, px, py);
    }
  }

  _rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath(); ctx.fill();
  }

  _drawTile(ctx, t, px, py) {
    switch (t) {
      case T.STEEL:
        ctx.fillStyle = '#5a6270'; this._rr(ctx, px+2, py+2, TILE-4, TILE-4, 6);
        ctx.fillStyle = '#6f7888'; this._rr(ctx, px+5, py+5, TILE-14, TILE-14, 4); break;
      case T.BRICK:
        ctx.fillStyle = '#a8542e'; this._rr(ctx, px+2, py+2, TILE-4, TILE-4, 4);
        ctx.strokeStyle = '#7a3a1e'; ctx.lineWidth = 2; ctx.beginPath();
        ctx.moveTo(px+2, py+TILE/2); ctx.lineTo(px+TILE-2, py+TILE/2);
        ctx.moveTo(px+TILE/2, py+2); ctx.lineTo(px+TILE/2, py+TILE/2);
        ctx.stroke(); break;
      case T.CRATE:
        ctx.fillStyle = '#c9963f'; this._rr(ctx, px+4, py+4, TILE-8, TILE-8, 4);
        ctx.strokeStyle = '#8a6420'; ctx.lineWidth = 3; ctx.strokeRect(px+6, py+6, TILE-12, TILE-12);
        ctx.beginPath(); ctx.moveTo(px+6, py+6); ctx.lineTo(px+TILE-6, py+TILE-6);
        ctx.moveTo(px+TILE-6, py+6); ctx.lineTo(px+6, py+TILE-6); ctx.stroke(); break;
      case T.WATER:
        ctx.fillStyle = '#2f7fbf'; ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(px+4, py+TILE/2, TILE-8, 3); break;
      case T.BARREL:
        ctx.fillStyle = '#d94c2e'; this._rr(ctx, px+10, py+6, TILE-20, TILE-12, 5);
        ctx.fillStyle = '#2a2a2a'; ctx.fillRect(px+10, py+TILE/2-2, TILE-20, 4);
        ctx.fillStyle = '#ffdb4a'; ctx.font = '900 14px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('!', px+TILE/2, py+TILE/2); break;
      case T.OIL:
        ctx.fillStyle = 'rgba(20,20,30,0.7)'; ctx.beginPath();
        ctx.ellipse(px+TILE/2, py+TILE/2, TILE/2.4, TILE/3, 0, 0, Math.PI*2); ctx.fill(); break;
      case T.BUSH:
        ctx.fillStyle = '#1e5a2a'; ctx.beginPath();
        ctx.arc(px+TILE/2, py+TILE/2, TILE/2.3, 0, Math.PI*2); ctx.fill(); break;
    }
  }

  _drawBushTops(ctx, camX, camY, viewW, viewH) {
    if (!this.mapData) return;
    const { cols, rows, grid } = this.mapData;
    const startX = Math.max(0, Math.floor(camX / TILE));
    const startY = Math.max(0, Math.floor(camY / TILE));
    const endX   = Math.min(cols, Math.ceil((camX + viewW) / TILE));
    const endY   = Math.min(rows, Math.ceil((camY + viewH) / TILE));
    for (let y = startY; y < endY; y++) for (let x = startX; x < endX; x++) {
      if (grid[y][x] !== T.BUSH) continue;
      const px = x * TILE, py = y * TILE;
      ctx.globalAlpha = 0.85; ctx.fillStyle = '#2e7d3a';
      for (const [ox, oy, r] of [[TILE/2,TILE/2,15],[TILE/3,TILE/2.5,10],[2*TILE/3,TILE/2.6,10],[TILE/2,2*TILE/3,11]]) {
        ctx.beginPath(); ctx.arc(px+ox, py+oy, r, 0, Math.PI*2); ctx.fill();
      }
      ctx.fillStyle = '#3d9a4a'; ctx.beginPath(); ctx.arc(px+TILE/2-3, py+TILE/2-3, 7, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // ── Bullets ───────────────────────────────────────────────────────────────

  _drawBullets(ctx) {
    for (const b of this.bullets) {
      if (b.laser || b.rail) {
        ctx.strokeStyle = b.color; ctx.lineWidth = b.rail ? 4 : 6; ctx.lineCap = 'round'; ctx.globalAlpha = 0.5;
        ctx.beginPath();
        if (b.trail && b.trail.length >= 2) { ctx.moveTo(b.trail[0], b.trail[1]); ctx.lineTo(b.x, b.y); }
        ctx.stroke(); ctx.globalAlpha = 1;
      } else {
        if (b.trail) for (let i = 0; i < b.trail.length; i += 2) {
          ctx.globalAlpha = (i / b.trail.length) * 0.4; ctx.fillStyle = b.color;
          ctx.beginPath(); ctx.arc(b.trail[i], b.trail[i+1], b.radius * 0.8, 0, Math.PI*2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      ctx.save(); ctx.shadowBlur = 10; ctx.shadowColor = b.color; ctx.fillStyle = b.rocket ? '#ff5a3c' : b.color;
      if (b.rocket) {
        ctx.translate(b.x, b.y); ctx.rotate(b.angle);
        ctx.fillRect(-8, -3, 16, 6); ctx.fillStyle = '#ffcf3f';
        ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(4, -4); ctx.lineTo(4, 4); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.arc(b.x-1, b.y-1, b.radius*0.4, 0, Math.PI*2); ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── Powerups ──────────────────────────────────────────────────────────────

  _drawPowerups(ctx) {
    const now = performance.now() / 1000;
    for (const pu of this.powerups) {
      const bob = Math.sin(now * 3) * 4;
      ctx.save();
      ctx.globalAlpha = pu.life < 3 ? (0.4 + 0.6 * Math.abs(Math.sin(pu.life * 8))) : 1;
      ctx.translate(pu.x, pu.y + bob);
      ctx.shadowBlur = 14; ctx.shadowColor = pu.type.color; ctx.fillStyle = pu.type.color;
      ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(-4, -4, 7, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#1a1030'; ctx.font = '900 10px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(pu.type.label, 0, 1);
      ctx.restore();
    }
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  _drawHUD(ctx) {
    const localTank = this.getLocalTank();
    if (!localTank) return;

    const pad = 14, barW = 160, barH = 14;
    let y = this.H - pad - barH - 60;

    // Local player HP bar
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    this._hudRR(ctx, pad, y, barW + 80, 58, 8);

    ctx.fillStyle = '#fff'; ctx.font = '700 12px Segoe UI'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('YOU  ❤ ' + Math.max(0, Math.ceil(localTank.hp)) + '/' + localTank.maxHp, pad + 8, y + 8);

    ctx.fillStyle = 'rgba(0,0,0,0.5)'; this._hudRR(ctx, pad + 8, y + 26, barW, barH, 4);
    ctx.fillStyle = localTank.hp > localTank.maxHp * 0.5 ? '#5be36a' : localTank.hp > localTank.maxHp * 0.25 ? '#ffcf3f' : '#ff5b5b';
    this._hudRR(ctx, pad + 8, y + 26, Math.max(0, barW * (localTank.hp / localTank.maxHp)), barH, 4);

    if (localTank.shield > 0) {
      ctx.fillStyle = '#5aa8ff'; ctx.font = '700 11px Segoe UI';
      ctx.fillText('SHIELD ' + Math.ceil(localTank.shield), pad + 8, y + 44);
    }

    // Weapon + ammo
    const wKey = localTank._weapon || 'cannon';
    const ammo = localTank._ammo?.[wKey];
    const ammoStr = ammo === Infinity || ammo === undefined ? '∞' : ammo;
    ctx.fillStyle = '#ffd54a'; ctx.font = '700 11px Segoe UI';
    ctx.fillText(wKey.toUpperCase() + '  ' + ammoStr, pad + barW + 16, y + 8);

    // Dash cooldown
    const dashCd = localTank._dashCd || 0;
    if (dashCd > 0) {
      ctx.fillStyle = '#9fb3d1'; ctx.font = '700 11px Segoe UI';
      ctx.fillText('DASH ' + dashCd.toFixed(1) + 's', pad + barW + 16, y + 24);
    } else {
      ctx.fillStyle = '#5be36a'; ctx.font = '700 11px Segoe UI';
      ctx.fillText('DASH READY', pad + barW + 16, y + 24);
    }

    // Kills / deaths
    ctx.fillStyle = '#fff'; ctx.font = '700 11px Segoe UI';
    ctx.fillText('K:' + (localTank._kills || 0) + '  D:' + (localTank._deaths || 0), pad + barW + 16, y + 40);

    // Remote players
    let rx = this.W - pad - 200;
    for (const [id, tank] of this.tanks) {
      if (id === this.localPlayerId) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; this._hudRR(ctx, rx, pad, 200, 48, 8);
      ctx.fillStyle = '#5aa8ff'; ctx.font = '700 12px Segoe UI'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText((tank.name || 'Player') + (tank.dead ? ' 💀' : ''), rx + 8, pad + 6);
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; this._hudRR(ctx, rx + 8, pad + 24, 180, 12, 4);
      ctx.fillStyle = '#5aa8ff';
      this._hudRR(ctx, rx + 8, pad + 24, Math.max(0, 180 * (tank.hp / tank.maxHp)), 12, 4);
      ctx.fillStyle = '#fff'; ctx.font = '700 10px Segoe UI';
      ctx.fillText('K:' + (tank._kills || 0) + '  D:' + (tank._deaths || 0), rx + 8, pad + 38);
      rx -= 210;
    }

    if (this.showScoreboard) this._drawScoreboard(ctx);
  }

  // ── Scoreboard (Part 22) — toggled with Tab, sorted by kills desc ─────────

  _drawScoreboard(ctx) {
    const rows = Array.from(this.tanks.entries())
      .map(([id, tank]) => ({ id, name: tank.name || 'Player', kills: tank._kills || 0, deaths: tank._deaths || 0, isLocal: id === this.localPlayerId }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);

    const rowH = 26, headerH = 30, w = 300;
    const h = headerH + rowH * rows.length + 10;
    const x = this.W / 2 - w / 2, y = 90;

    ctx.fillStyle = 'rgba(10,14,24,.82)';
    this._hudRR(ctx, x, y, w, h, 10);
    ctx.strokeStyle = 'rgba(120,150,200,.35)'; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    ctx.fillStyle = '#ffd54a'; ctx.font = '700 13px Segoe UI'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('PLAYER', x + 14, y + 8);
    ctx.textAlign = 'right';
    ctx.fillText('KILLS', x + w - 92, y + 8);
    ctx.fillText('DEATHS', x + w - 14, y + 8);
    ctx.textAlign = 'left';

    rows.forEach((r, i) => {
      const ry = y + headerH + i * rowH;
      ctx.fillStyle = r.isLocal ? '#6bd35a' : '#fff';
      ctx.font = '700 13px Segoe UI'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(r.name, x + 14, ry + 5);
      ctx.textAlign = 'right';
      ctx.fillText(String(r.kills), x + w - 92, ry + 5);
      ctx.fillText(String(r.deaths), x + w - 14, ry + 5);
      ctx.textAlign = 'left';
    });
  }

  _hudRR(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x+r, y); ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r); ctx.arcTo(x, y+h, x, y, r); ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath(); ctx.fill();
  }
}
