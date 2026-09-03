// Server-authoritative game simulation for one multiplayer room.
// Reuses gameplay constants and logic from the single-player implementation
// (Tank.js movement/dash, Bullet.js collision, MapGenerator collision).
// No rendering code lives here.

import { MapState } from './MapState.js';
import { TILE, T, WEAPONS, PU_TYPES, PLAYER, POWERUP } from '../../shared/gameConstants.js';
import { GAME_EVENTS } from '../../shared/protocol.js';

// ─── Utility (mirrors src/game/utils/index.js) ───────────────────────────────
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp  = (a, b, t) => a + (b - a) * t;
const dist  = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const rand  = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const choose = a => a[Math.floor(Math.random() * a.length)];
function angLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

let _bulletId = 0;
let _puId = 0;

// ─── GameSimulation ───────────────────────────────────────────────────────────
export class GameSimulation {
  /**
   * @param {import('../GameRoom.js').GameRoom} room
   * @param {{ tickRate?: number, onTick?: Function, onEvent?: Function }} opts
   */
  constructor(room, { tickRate = 30, onTick = () => {}, onEvent = () => {}, onMatchEnd = () => {}, onError = () => {}, killsToWin = null, mapId = undefined, teams = false } = {}) {
    this.room = room;
    this.tickRate = tickRate;
    this.onTick = onTick;
    this.onEvent = onEvent;
    // Called once with a reason ('kills') the moment a player reaches the
    // kill target. The server (not the simulation) owns match-end broadcast
    // and timer cleanup — this is purely a notification.
    this.onMatchEnd = onMatchEnd;
    // Called if a tick throws — the loop keeps running (see start()) so one
    // bad tick can't take down the room, let alone the whole process.
    this.onError = onError;
    this.killsToWin = killsToWin;
    // Team Deathmatch: friendly fire off, win condition is combined team
    // kills rather than one player's. See _hitPlayer's caller, _rocketExplode,
    // and _checkKillWin below.
    this.teams = teams;
    this._matchEndFired = false;

    // Per-player input (set by GameServer on PLAYER_INPUT)
    this.inputs = new Map();      // playerId -> input snapshot

    // Per-player kinematics (internal, never broadcast)
    this.kinematics = new Map();  // playerId -> { speed, vx, vy }

    // Authoritative bullets
    this.bullets = [];            // array of bullet objects

    // Authoritative powerups
    this.powerups = [];           // array of powerup objects
    this._puTimer = 0;

    // Map
    this.map = new MapState();
    this.map.generate(mapId);

    this._intervalId = null;
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  setInput(playerId, input) {
    if (!this.room.gameState.players.has(playerId)) return;
    const prev = this.inputs.get(playerId) || {};
    this.inputs.set(playerId, {
      up:          !!input?.up,
      down:        !!input?.down,
      left:        !!input?.left,
      right:       !!input?.right,
      turretAngle: Number.isFinite(input?.turretAngle) ? input.turretAngle : (prev.turretAngle ?? 0),
      shooting:    !!input?.shooting,
      dash:        !!input?.dash,
      seq:         Number.isFinite(input?.seq) ? input.seq : (prev.seq ?? 0),
    });
  }

  removePlayer(playerId) {
    this.inputs.delete(playerId);
    this.kinematics.delete(playerId);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start() {
    if (this._intervalId) return;
    const dt = 1 / this.tickRate;
    this._intervalId = setInterval(() => {
      // A single malformed/edge-case tick must never crash the whole
      // process — log it and keep the loop (and every other room) running.
      try {
        this.tick(dt);
      } catch (err) {
        this.onError(err);
      }
    }, 1000 / this.tickRate);
  }

  stop() {
    if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
  }

  // ── Main tick ──────────────────────────────────────────────────────────────

  tick(dt) {
    const players = this.room.gameState.players;
    if (!players || players.size === 0) return;

    for (const player of players.values()) {
      this._updatePlayer(player, dt);
    }

    this._updateBullets(dt, players);
    this._updatePowerups(dt, players);
    this._checkRespawns(dt, players);

    this.onTick(this._buildState());
  }

  // ── Player update ──────────────────────────────────────────────────────────

  _updatePlayer(player, dt) {
    // Cooldown timers always tick (even dead, so respawn shield drains)
    if (player.fireCd > 0) player.fireCd -= dt;
    if (player.dashCd > 0) player.dashCd -= dt;
    if (player.dashTime > 0) player.dashTime -= dt;
    if (player.hitFlash > 0) player.hitFlash -= dt;
    if (player.shield > 0) player.shield -= dt * 0;  // shield doesn't drain over time
    for (const k of ['speedBoost', 'rapidFire', 'tripleShot']) {
      if (player[k] > 0) player[k] -= dt;
    }
    if (player.spawning > 0) { player.spawning -= dt; return; }
    if (!player.alive) return;

    const input = this.inputs.get(player.id);

    // Dash request
    if (input?.dash && !input._dashConsumed) {
      input._dashConsumed = true;
      this._tryDash(player);
    } else if (!input?.dash) {
      if (input) input._dashConsumed = false;
    }

    // Movement (mirrors Tank.applyKnob + Tank.move)
    let dx = 0, dy = 0;
    if (input?.up)    dy -= 1;
    if (input?.down)  dy += 1;
    if (input?.left)  dx -= 1;
    if (input?.right) dx += 1;
    const mag = Math.hypot(dx, dy);

    let kin = this.kinematics.get(player.id);
    if (!kin) { kin = { speed: 0, vx: 0, vy: 0 }; this.kinematics.set(player.id, kin); }

    if (player.dashTime > 0) {
      // Dash overrides normal movement
      kin.vx = Math.cos(player.dashDir) * player.maxSpeed * PLAYER.DASH_SPEED_MUL;
      kin.vy = Math.sin(player.dashDir) * player.maxSpeed * PLAYER.DASH_SPEED_MUL;
    } else {
      if (mag > 0.1) {
        const target = Math.atan2(dy, dx);
        player.angle = angLerp(player.angle, target, Math.min(1, dt * PLAYER.TURN_LERP_RATE));
        const boost = player.speedBoost > 0 ? 1.5 : 1;
        kin.speed = lerp(kin.speed, player.maxSpeed * boost * Math.min(1, mag), dt * PLAYER.ACCEL_LERP_RATE);
      } else {
        kin.speed = lerp(kin.speed, 0, dt * PLAYER.DECEL_LERP_RATE);
        if (Math.abs(kin.speed) < 0.5) kin.speed = 0;
      }
      const onOil = this.map.tileAt(player.x, player.y) === T.OIL;
      const grip = onOil ? 0.04 : PLAYER.VELOCITY_GRIP;
      kin.vx = lerp(kin.vx, Math.cos(player.angle) * kin.speed, grip);
      kin.vy = lerp(kin.vy, Math.sin(player.angle) * kin.speed, grip);
    }

    this._tryMove(player, kin.vx * dt, kin.vy * dt, kin);

    // Turret angle from client aim
    if (Number.isFinite(input?.turretAngle)) player.turretAngle = input.turretAngle;

    // Shoot request
    if (input?.shooting) this._tryShoot(player);
  }

  _tryMove(player, dx, dy, kin) {
    const r = PLAYER.RADIUS - 2;
    const nx = player.x + dx;
    if (!this._collides(nx, player.y, r)) player.x = nx; else kin.vx *= -0.2;
    const ny = player.y + dy;
    if (!this._collides(player.x, ny, r)) player.y = ny; else kin.vy *= -0.2;
    player.x = clamp(player.x, r + TILE, this.map.worldW() - r - TILE);
    player.y = clamp(player.y, r + TILE, this.map.worldH() - r - TILE);
  }

  _collides(x, y, r) {
    for (const [ox, oy] of [[-r,-r],[r,-r],[-r,r],[r,r],[0,-r],[0,r],[-r,0],[r,0]])
      if (this.map.isSolid(this.map.tileAt(x + ox, y + oy))) return true;
    return false;
  }

  // ── Dash ───────────────────────────────────────────────────────────────────

  _tryDash(player) {
    if (player.dashCd > 0) return;
    player.dashCd  = PLAYER.DASH_CD;
    player.dashTime = PLAYER.DASH_DURATION;
    player.dashDir  = player.angle;
    this.onEvent(GAME_EVENTS.DASH_STARTED, { playerId: player.id, x: player.x, y: player.y, angle: player.angle });
  }

  // ── Shooting ───────────────────────────────────────────────────────────────

  _tryShoot(player) {
    if (player.fireCd > 0 || player.spawning > 0 || !player.alive) return;
    const wKey = player.weapon || 'cannon';
    const w = WEAPONS[wKey];
    if (!w) return;
    // Ammo check
    if (wKey !== 'cannon' && player.ammo[wKey] !== undefined && player.ammo[wKey] <= 0) {
      player.weapon = 'cannon'; return;
    }

    let cd = w.cd;
    if (player.rapidFire > 0) cd *= 0.4;
    player.fireCd = cd;

    if (wKey !== 'cannon' && player.ammo[wKey] !== undefined && player.ammo[wKey] !== Infinity) {
      player.ammo[wKey]--;
      if (player.ammo[wKey] <= 0) player.weapon = 'cannon';
    }

    const pellets = w.pellets || 1;
    const shots = [];
    for (let p = 0; p < pellets; p++) {
      const sp = pellets > 1
        ? (p - (pellets - 1) / 2) * w.spread
        : rand(-w.spread, w.spread);
      shots.push(player.turretAngle + sp);
    }
    if (player.tripleShot > 0) { shots.push(player.turretAngle - 0.25); shots.push(player.turretAngle + 0.25); }

    const mx = player.x + Math.cos(player.turretAngle) * (PLAYER.RADIUS + 10);
    const my = player.y + Math.sin(player.turretAngle) * (PLAYER.RADIUS + 10);

    for (const angle of shots) {
      const bullet = {
        id: ++_bulletId,
        ownerId: player.id,
        x: mx, y: my,
        angle,
        vx: Math.cos(angle) * w.speed,
        vy: Math.sin(angle) * w.speed,
        speed: w.speed,
        damage: w.dmg,
        radius: w.rocket ? 6 : (w.laser ? 4 : 5),
        bounces: w.bounces,
        color: w.color,
        life: 3,
        dead: false,
        rocket: !!w.rocket,
        laser: !!w.laser,
        rail: !!w.rail,
        explosive: !!w.explosive,
        trail: [],
      };
      this.bullets.push(bullet);
    }

    // Recoil
    const kin = this.kinematics.get(player.id);
    if (kin) { kin.vx -= Math.cos(player.turretAngle) * 40; kin.vy -= Math.sin(player.turretAngle) * 40; }

    this.onEvent(GAME_EVENTS.BULLET_FIRED, {
      playerId: player.id, x: mx, y: my, angle: player.turretAngle, weapon: wKey,
    });
  }

  // ── Bullet update ──────────────────────────────────────────────────────────

  _updateBullets(dt, players) {
    for (const b of this.bullets) {
      if (b.dead) continue;
      b.life -= dt;
      if (b.life <= 0) { b.dead = true; continue; }

      b.trail.push(b.x, b.y);
      if (b.trail.length > 12) b.trail.splice(0, 2);

      const steps = b.rail ? 5 : 3;
      let hit = false;
      for (let s = 0; s < steps && !hit; s++) {
        const nx = b.x + b.vx * dt / steps;
        const ny = b.y + b.vy * dt / steps;
        const t = this.map.tileAt(nx, ny);

        if (this.map.isBulletBlock(t)) {
          const gx = Math.floor(nx / TILE), gy = Math.floor(ny / TILE);
          if (t === T.BRICK || t === T.CRATE) {
            this.map.grid[gy][gx] = T.EMPTY;
            this.onEvent(GAME_EVENTS.TILE_DESTROYED, { gx, gy });
            if (b.explosive) this._rocketExplode(b.x, b.y, b.ownerId, players);
            b.dead = true; hit = true;
          } else if (t === T.BARREL) {
            this._explodeBarrel(gx, gy, players);
            b.dead = true; hit = true;
          } else if (t === T.STEEL) {
            if (b.rail) { b.dead = true; hit = true; }
            else if (b.bounces > 0 && !b.rocket) {
              const pgx = Math.floor(b.x / TILE), pgy = Math.floor(b.y / TILE);
              if (pgx !== gx) b.vx = -b.vx;
              if (pgy !== gy) b.vy = -b.vy;
              if (pgx === gx && pgy === gy) { b.vx = -b.vx; b.vy = -b.vy; }
              b.angle = Math.atan2(b.vy, b.vx);
              b.bounces--;
              // Mirrors Bullet.update() (single-player): on a steel bounce
              // it `return`s immediately without advancing x/y onto the
              // solid tile it just detected. Stopping the step loop here
              // (via hit=true) instead of falling through to `b.x = nx;
              // b.y = ny;` keeps the bullet outside the wall — previously
              // it was written into/through the solid tile on every
              // bounce, which is what let shots tunnel past steel over
              // repeated ricochets.
              hit = true;
            } else {
              if (b.explosive) this._rocketExplode(b.x, b.y, b.ownerId, players);
              b.dead = true; hit = true;
            }
          }
          if (!hit) { b.x = nx; b.y = ny; }
        } else {
          b.x = nx; b.y = ny;
        }
      }
      if (b.dead) continue;

      // Bullet vs player collision
      const owner = players.get(b.ownerId);
      for (const player of players.values()) {
        if (!player.alive || player.spawning > 0) continue;
        if (player.id === b.ownerId) continue;
        // Team Deathmatch: bullets pass through teammates instead of
        // colliding — no friendly fire.
        if (this.teams && owner && player.team && player.team === owner.team) continue;
        if (dist(b.x, b.y, player.x, player.y) < player.radius + b.radius) {
          this._hitPlayer(player, b.damage, players);
          if (b.explosive) this._rocketExplode(b.x, b.y, b.ownerId, players);
          b.dead = true;
          // Credit kill to owner
          if (owner && !player.alive) {
            owner.kills = (owner.kills || 0) + 1;
            this._checkKillWin(owner);
          }
          break;
        }
      }
    }

    // Prune dead bullets
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      if (this.bullets[i].dead) this.bullets.splice(i, 1);
    }
  }

  _hitPlayer(player, damage, players) {
    if (!player.alive || player.spawning > 0) return;
    if (player.shield > 0) {
      player.shield -= damage * 0.5;
      if (player.shield < 0) player.shield = 0;
      this.onEvent(GAME_EVENTS.PLAYER_HIT, { playerId: player.id, x: player.x, y: player.y, damage: 0, shielded: true });
      return;
    }
    player.hp -= damage;
    player.hitFlash = 0.15;
    this.onEvent(GAME_EVENTS.PLAYER_HIT, { playerId: player.id, x: player.x, y: player.y, damage: Math.round(damage) });
    if (player.hp <= 0) {
      player.hp = 0;
      player.alive = false;
      player.deaths = (player.deaths || 0) + 1;
      this.onEvent(GAME_EVENTS.PLAYER_DIED, { playerId: player.id, x: player.x, y: player.y });
      this._scheduleRespawn(player);
    }
  }

  _rocketExplode(x, y, ownerId, players) {
    const R = 70;
    this.onEvent(GAME_EVENTS.BARREL_EXPLODED, { x, y, radius: R });
    const owner = players.get(ownerId);
    for (const player of players.values()) {
      if (!player.alive || player.id === ownerId) continue;
      // No friendly-fire splash damage in Team Deathmatch either.
      if (this.teams && owner && player.team && player.team === owner.team) continue;
      const d = dist(x, y, player.x, player.y);
      if (d < R) this._hitPlayer(player, 40 * (1 - d / R), players);
    }
  }

  _explodeBarrel(gx, gy, players) {
    const wx = gx * TILE + TILE / 2, wy = gy * TILE + TILE / 2;
    this.map.grid[gy][gx] = T.EMPTY;
    this.onEvent(GAME_EVENTS.TILE_DESTROYED, { gx, gy });
    const R = 90;
    this.onEvent(GAME_EVENTS.BARREL_EXPLODED, { x: wx, y: wy, radius: R });
    for (const player of players.values()) {
      if (!player.alive) continue;
      const d = dist(wx, wy, player.x, player.y);
      if (d < R) this._hitPlayer(player, 50 * (1 - d / R), players);
    }
    for (let y = gy - 1; y <= gy + 1; y++) for (let x = gx - 1; x <= gx + 1; x++) {
      if (x <= 0 || y <= 0 || x >= this.map.cols - 1 || y >= this.map.rows - 1) continue;
      const tt = this.map.grid[y][x];
      if (tt === T.BRICK || tt === T.CRATE) { this.map.grid[y][x] = T.EMPTY; this.onEvent(GAME_EVENTS.TILE_DESTROYED, { gx: x, gy: y }); }
      else if (tt === T.BARREL) setTimeout(() => this._explodeBarrel(x, y, players), 80);
    }
  }

  // ── Win condition (kill target) ──────────────────────────────────────────
  // Time-based win checking lives on the server (GameServer), since it must
  // fire even during ticks with no kills. Kill-target checking happens here
  // because it's naturally driven by the kill-credit moment above.

  _checkKillWin(owner) {
    if (this._matchEndFired) return;
    if (!this.killsToWin) return;
    if (this.teams && owner.team) {
      // Team Deathmatch: win target is the combined kill count of every
      // player on the scoring player's team, not their individual total.
      let teamKills = 0;
      for (const p of this.room.gameState.players.values()) {
        if (p.team === owner.team) teamKills += p.kills || 0;
      }
      if (teamKills >= this.killsToWin) { this._matchEndFired = true; this.onMatchEnd('kills'); }
      return;
    }
    if (owner.kills >= this.killsToWin) {
      this._matchEndFired = true;
      this.onMatchEnd('kills');
    }
  }

  // ── Respawn ────────────────────────────────────────────────────────────────

  _scheduleRespawn(player) {
    player._respawning = true;
    setTimeout(() => {
      if (!this.room.gameState.players.has(player.id)) return;
      player._respawning = false;
      player.alive = true;
      player.hp = PLAYER.MAX_HP;
      player.shield = PLAYER.RESPAWN_SHIELD;
      player.spawning = PLAYER.RESPAWN_SPAWNING;
      player.weapon = 'cannon';
      player.ammo = { cannon: Infinity };
      player.rapidFire = 0; player.tripleShot = 0; player.speedBoost = 0;
      player.dashCd = 0; player.dashTime = 0; player.fireCd = 0;
      // Pick a spawn corner. In Team Deathmatch, respawn on the player's
      // own side (see GameRoom.buildGameState for the same north/south
      // pairing) instead of any of the 4 corners — respawning behind
      // enemy lines would be a rough way to lose your dash cooldown.
      const spawns = this.map.spawnPoints();
      let pool = spawns;
      if (this.teams && player.team) {
        const teamSpawns = player.team === 'red' ? [spawns[0], spawns[2]] : [spawns[1], spawns[3]];
        const filtered = teamSpawns.filter(Boolean);
        if (filtered.length) pool = filtered;
      }
      const spawn = choose(pool);
      player.x = spawn.x; player.y = spawn.y; player.angle = spawn.angle; player.turretAngle = spawn.angle;
      const kin = this.kinematics.get(player.id);
      if (kin) { kin.speed = 0; kin.vx = 0; kin.vy = 0; }
      this.onEvent(GAME_EVENTS.PLAYER_RESPAWNED, { playerId: player.id, x: player.x, y: player.y });
    }, PLAYER.RESPAWN_DELAY);
  }

  _checkRespawns(dt, players) {
    // Handled via setTimeout — nothing to poll here.
  }

  // ── Powerups ───────────────────────────────────────────────────────────────

  _updatePowerups(dt, players) {
    this._puTimer += dt;
    if (this._puTimer >= POWERUP.SPAWN_INTERVAL && this.powerups.length < POWERUP.MAX_ON_MAP) {
      this._puTimer = 0;
      this._spawnPowerup();
    }

    for (const pu of this.powerups) {
      pu.life -= dt;
      if (pu.life <= 0) { pu.dead = true; continue; }
      for (const player of players.values()) {
        if (!player.alive || player.spawning > 0) continue;
        if (dist(pu.x, pu.y, player.x, player.y) < player.radius + POWERUP.RADIUS) {
          this._applyPowerup(player, pu);
          pu.dead = true;
          break;
        }
      }
    }
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      if (this.powerups[i].dead) this.powerups.splice(i, 1);
    }
  }

  _spawnPowerup() {
    let gx, gy, tries = 0;
    do {
      gx = randi(2, this.map.cols - 3);
      gy = randi(2, this.map.rows - 3);
      tries++;
    } while (this.map.grid[gy][gx] !== T.EMPTY && tries < 20);
    if (this.map.grid[gy][gx] !== T.EMPTY) return;
    const type = choose(PU_TYPES);
    this.powerups.push({
      id: ++_puId,
      x: gx * TILE + TILE / 2,
      y: gy * TILE + TILE / 2,
      type,
      life: POWERUP.LIFE,
      dead: false,
    });
  }

  _applyPowerup(player, pu) {
    switch (pu.type.id) {
      case 'repair':  player.hp = Math.min(player.maxHp, player.hp + 50); break;
      case 'speed':   player.speedBoost = 8; break;
      case 'shield':  player.shield = 60; break;
      case 'rapid':   player.rapidFire = 8; break;
      case 'triple':  player.tripleShot = 10; break;
      case 'freeze':  break; // no enemies in MP
      case 'rocket':  player.ammo.rocket = (player.ammo.rocket || 0) + 8; player.weapon = 'rocket'; break;
      case 'shotgun': player.ammo.shotgun = (player.ammo.shotgun || 0) + 24; player.weapon = 'shotgun'; break;
      case 'laser':   player.ammo.laser = (player.ammo.laser || 0) + 44; player.weapon = 'laser'; break;
      case 'mg':      player.ammo.machinegun = (player.ammo.machinegun || 0) + 140; player.weapon = 'machinegun'; break;
      case 'railgun': player.ammo.railgun = (player.ammo.railgun || 0) + 6; player.weapon = 'railgun'; break;
    }
    this.onEvent(GAME_EVENTS.POWERUP_PICKED, {
      playerId: player.id, puId: pu.id, type: pu.type.id, x: pu.x, y: pu.y,
    });
  }

  // ── State serialization ────────────────────────────────────────────────────

  _buildState() {
    return {
      players: Array.from(this.room.gameState.players.values()).map(p => {
        const inp = this.inputs.get(p.id);
        return {
          id: p.id,
          name: p.name,
          team: p.team || null,
          x: p.x, y: p.y,
          angle: p.angle,
          turretAngle: p.turretAngle,
          hp: p.hp, maxHp: p.maxHp,
          alive: p.alive,
          spawning: p.spawning > 0 ? p.spawning : 0,
          kills: p.kills || 0,
          deaths: p.deaths || 0,
          weapon: p.weapon || 'cannon',
          ammo: p.ammo,
          shield: p.shield || 0,
          dashCd: p.dashCd || 0,
          hitFlash: p.hitFlash || 0,
          // Prediction-relevant authoritative state: the client's movement
          // prediction (MultiplayerInputController.applyMovement) mirrors
          // GameSimulation._updatePlayer()'s use of these exact fields, so
          // they must be available on every snapshot, not just internally.
          speedBoost: p.speedBoost || 0,
          dashTime: p.dashTime || 0,
          dashDir: p.dashDir || 0,
          lastSeq: inp?.seq ?? 0,
        };
      }),
      bullets: this.bullets.map(b => ({
        id: b.id,
        x: b.x, y: b.y,
        angle: b.angle,
        color: b.color,
        radius: b.radius,
        rocket: b.rocket,
        laser: b.laser,
        rail: b.rail,
        trail: b.trail.slice(),
      })),
      powerups: this.powerups.map(pu => ({
        id: pu.id,
        x: pu.x, y: pu.y,
        type: pu.type,
        life: pu.life,
      })),
    };
  }

  getMapData() {
    return this.map.toJSON();
  }
}
