import { Utils } from '../utils/index.js';
import { ENEMY_TYPES, DIFF, T } from '../constants/index.js';

export class EnemyAI {
  constructor(tank, type, diff) {
    this.t = tank; this.type = type; this.cfg = ENEMY_TYPES[type]; this.d = diff;
    this.stateTime = 0; this.wanderAngle = Utils.rand(0, Math.PI * 2); this.dodgeCd = 0;
    this.reactBuf = 0; this.aimError = 0; this.charging = 0;
    this.bossTimer = 1.5; this.bossPhase = 1;
  }

  nearestTarget(game) {
    let best = null, bd = Infinity;
    for (const pl of game.players) { if (pl.dead || pl.spawning > 0) continue; const d = Utils.dist(this.t.x, this.t.y, pl.x, pl.y); if (d < bd) { bd = d; best = pl; } }
    return { target: best, dist: bd };
  }

  losClear(x1, y1, x2, y2, game) {
    const d = Utils.dist(x1, y1, x2, y2), steps = Math.ceil(d / 16);
    for (let i = 1; i < steps; i++) { const t = i / steps, x = Utils.lerp(x1, x2, t), y = Utils.lerp(y1, y2, t); if (game.map.isBulletBlock(game.map.tileAt(x, y))) return false; }
    return true;
  }

  avoidObstacles(dir, game) {
    const t = this.t;
    for (const off of [0, 0.4, -0.4, 0.9, -0.9, 1.6, -1.6]) {
      const a = dir + off; const cx = t.x + Math.cos(a) * (t.radius + 24), cy = t.y + Math.sin(a) * (t.radius + 24);
      const tile = game.map.tileAt(cx, cy); if (!game.map.isSolid(tile) && tile !== T.BARREL) return a;
    }
    return dir + Math.PI;
  }

  update(dt, game) {
    const t = this.t; if (t.dead || t.spawning > 0) return;
    if (t.frozen > 0) { t.applyKnob(0, 0, dt); return; }
    this.stateTime += dt; if (this.dodgeCd > 0) this.dodgeCd -= dt; if (this.reactBuf > 0) this.reactBuf -= dt;
    const { target, dist } = this.nearestTarget(game);
    if (!target) { this.wander(dt, game); return; }
    if (this.reactBuf <= 0) { this.reactBuf = this.d.react * Utils.rand(0.8, 1.2); this.aimError = Utils.rand(-1, 1) * this.d.aimJitter; }
    const los = this.losClear(t.x, t.y, target.x, target.y, game);
    const inRange = dist < this.cfg.range && los;
    let aimX = target.x, aimY = target.y;
    if (!this.cfg.accurate) { const lead = dist / this.cfg.range * 0.5; aimX += target.vx * lead; aimY += target.vy * lead; }
    let desired = Math.atan2(aimY - t.y, aimX - t.x) + this.aimError;
    t.turret = Utils.angLerp(t.turret, desired, dt * (this.cfg.accurate ? 4 : 6));
    if (!this.cfg.noDodge && this.dodgeCd <= 0 && Math.random() < this.d.dodge) {
      for (const b of game.bullets) {
        if (b.owner === 'enemy') continue;
        if (Utils.dist(t.x, t.y, b.x, b.y) < 130) {
          const bulletDir = Math.atan2(b.vy, b.vx); const toT = Math.atan2(t.y - b.y, t.x - b.x);
          if (Math.abs(Utils.norm(bulletDir - toT)) < 0.5) {
            const perp = bulletDir + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1);
            t.applyKnob(Math.cos(perp), Math.sin(perp), dt);
            if (t.dashCd <= 0 && Math.random() < 0.4) { t.angle = perp; t.dash(); }
            this.dodgeCd = 0.5; return;
          }
        }
      }
    }
    if (!this.cfg.noDodge && !this.cfg.isBoss && t.hp < t.maxHp * 0.28) {
      const away = Math.atan2(t.y - target.y, t.x - target.x); const a = this.avoidObstacles(away, game);
      t.applyKnob(Math.cos(a), Math.sin(a), dt);
      if (this._canFire(desired) && Math.random() < 0.5) t.shoot(game);
      return;
    }
    switch (this.cfg.behavior) {
      case 'circle': this.circle(dt, game, target, dist, inRange, desired); break;
      case 'snipe':  this.snipe(dt, game, target, dist, los, desired); break;
      case 'tank':   this.tankBehavior(dt, game, target, dist, inRange, desired); break;
      case 'boss':   this.bossUpdate(dt, game, target, dist); break;
      default:       this.balanced(dt, game, target, dist, inRange, desired); break;
    }
  }

  _canFire(desired) { return Math.abs(Utils.norm(this.t.turret - desired)) < 0.18 && this.t.fireCd <= 0; }

  seekPowerup(dt, game) {
    const t = this.t; let best = null, bd = Infinity;
    for (const pu of game.powerups) { const d = Utils.dist(t.x, t.y, pu.x, pu.y); if (d < 170 && d < bd) { bd = d; best = pu; } }
    if (best && Math.random() < 0.7) { const a = this.avoidObstacles(Math.atan2(best.y - t.y, best.x - t.x), game); t.applyKnob(Math.cos(a), Math.sin(a), dt); return true; }
    return false;
  }

  circle(dt, game, target, dist, inRange, desired) {
    const t = this.t; if (this.seekPowerup(dt, game)) return;
    const toT = Math.atan2(target.y - t.y, target.x - t.x);
    const ideal = 180; let orbit = toT + Math.PI / 2 * (Math.sin(this.stateTime * 0.8) > 0 ? 1 : -1);
    if (dist > ideal * 1.4) orbit = toT; else if (dist < ideal * 0.6) orbit = toT + Math.PI;
    const a = this.avoidObstacles(orbit, game); t.applyKnob(Math.cos(a) * 0.9, Math.sin(a) * 0.9, dt);
    if (inRange && this._canFire(desired) && Math.random() < 0.5) t.shoot(game);
  }

  balanced(dt, game, target, dist, inRange, desired) {
    const t = this.t; if (this.seekPowerup(dt, game)) return;
    const toT = Math.atan2(target.y - t.y, target.x - t.x);
    if (inRange) {
      const ideal = this.cfg.range * 0.6;
      if (dist < ideal * 0.7) { const s = toT + Math.PI / 2 * (Math.sin(this.stateTime * 1.5) > 0 ? 1 : -1); const a = this.avoidObstacles(s, game); t.applyKnob(Math.cos(a), Math.sin(a), dt); }
      else if (dist > this.cfg.range * 0.9) { const a = this.avoidObstacles(toT, game); t.applyKnob(Math.cos(a), Math.sin(a), dt); }
      else { const s = toT + Math.PI / 2 * (Math.sin(this.stateTime) > 0 ? 1 : -1); const a = this.avoidObstacles(s, game); t.applyKnob(Math.cos(a) * 0.6, Math.sin(a) * 0.6, dt); }
      if (this._canFire(desired)) t.shoot(game);
    } else { const a = this.avoidObstacles(toT, game); t.applyKnob(Math.cos(a), Math.sin(a), dt); }
  }

  tankBehavior(dt, game, target, dist, inRange, desired) {
    const t = this.t; const toT = Math.atan2(target.y - t.y, target.x - t.x);
    if (dist > this.cfg.range * 0.55) { const a = this.avoidObstacles(toT, game); t.applyKnob(Math.cos(a) * 0.8, Math.sin(a) * 0.8, dt); }
    else t.applyKnob(0, 0, dt);
    if (inRange && this._canFire(desired)) t.shoot(game);
  }

  snipe(dt, game, target, dist, los, desired) {
    const t = this.t; const toT = Math.atan2(target.y - t.y, target.x - t.x);
    if (dist < 300) { const away = this.avoidObstacles(toT + Math.PI, game); t.applyKnob(Math.cos(away), Math.sin(away), dt); }
    else if (dist > this.cfg.range) { const a = this.avoidObstacles(toT, game); t.applyKnob(Math.cos(a) * 0.7, Math.sin(a) * 0.7, dt); }
    else { const s = toT + Math.PI / 2 * (Math.sin(this.stateTime * 0.5) > 0 ? 1 : -1); t.applyKnob(Math.cos(s) * 0.4, Math.sin(s) * 0.4, dt); }
    if (los && dist < this.cfg.range) {
      if (Math.abs(Utils.norm(t.turret - desired)) < 0.12) {
        this.charging += dt;
        if (this.charging === dt) game.audio.charge();
        if (this.charging >= this.cfg.charge && t.fireCd <= 0) { t.shoot(game); this.charging = 0; }
      } else this.charging = Math.max(0, this.charging - dt * 2);
    } else this.charging = 0;
  }

  wander(dt, game) {
    const t = this.t;
    if (this.stateTime > 2 || Math.random() < 0.01) { this.wanderAngle = Utils.rand(0, Math.PI * 2); this.stateTime = 0; }
    const a = this.avoidObstacles(this.wanderAngle, game);
    t.applyKnob(Math.cos(a) * 0.5, Math.sin(a) * 0.5, dt);
  }

  bossUpdate(dt, game, target, dist) {
    const t = this.t; this.bossTimer -= dt;
    const frac = t.hp / t.maxHp; let ph = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;
    if (ph !== this.bossPhase) {
      this.bossPhase = ph; game.audio.warning(); game.shake(14); game.onToast && game.onToast('BOSS PHASE ' + ph);
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        const mx = t.x + Math.cos(a) * (t.radius + 8), my = t.y + Math.sin(a) * (t.radius + 8);
        game.bullets.push(game.bulletPool.get(mx, my, a, { speed: 300, damage: 16, owner: 'enemy', bounces: 1, color: '#e39bff', radius: 6 }));
      }
    }
    const toT = Math.atan2(target.y - t.y, target.x - t.x); const strafe = toT + Math.PI / 2;
    t.turret = Utils.angLerp(t.turret, toT, dt * 3);
    t.applyKnob(Math.cos(strafe) * 0.7, Math.sin(strafe) * 0.7, dt);
    if (this.bossTimer <= 0) {
      if (ph === 1) {
        for (let s = -2; s <= 2; s++) { const a = toT + s * 0.18; const mx = t.x + Math.cos(a) * (t.radius + 8), my = t.y + Math.sin(a) * (t.radius + 8); game.bullets.push(game.bulletPool.get(mx, my, a, { speed: 360, damage: 24, owner: 'enemy', bounces: 2, color: '#c86bff', radius: 7 })); }
        game.audio.rocket();
      } else if (ph === 2) {
        for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2 + this.stateTime; const mx = t.x + Math.cos(a) * (t.radius + 8), my = t.y + Math.sin(a) * (t.radius + 8); game.bullets.push(game.bulletPool.get(mx, my, a, { speed: 280, damage: 18, owner: 'enemy', bounces: 1, color: '#c86bff', radius: 6 })); }
        game.audio.shotgun(); game.shake(6);
      } else {
        for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + this.stateTime * 3; const mx = t.x + Math.cos(a) * (t.radius + 8), my = t.y + Math.sin(a) * (t.radius + 8); game.bullets.push(game.bulletPool.get(mx, my, a, { speed: 320, damage: 20, owner: 'enemy', bounces: 1, color: '#ff6bd0', radius: 7 })); }
        game.bullets.push(game.bulletPool.get(t.x + Math.cos(toT) * (t.radius + 8), t.y + Math.sin(toT) * (t.radius + 8), toT, { speed: 340, damage: 40, owner: 'enemy', bounces: 0, color: '#ff5a3c', radius: 8, rocket: true, explosive: true }));
        game.audio.rocket(); game.shake(8);
      }
      this.bossTimer = ph === 3 ? Utils.rand(0.7, 1.2) : Utils.rand(1.2, 2.0);
    }
  }

  drawSight(ctx) {
    if (this.type !== 'sniper' || this.charging <= 0 || this.t.dead) return;
    const t = this.t; const len = this.cfg.range; const chargeFrac = Utils.clamp(this.charging / this.cfg.charge, 0, 1);
    ctx.save(); ctx.globalAlpha = 0.25 + 0.5 * chargeFrac; ctx.strokeStyle = chargeFrac >= 1 ? '#ff2b2b' : '#ff6b8a'; ctx.lineWidth = 1 + chargeFrac * 2;
    ctx.beginPath(); ctx.moveTo(t.x, t.y);
    let hx = t.x, hy = t.y;
    for (let i = 0; i < len; i += 8) { const nx = t.x + Math.cos(t.turret) * i, ny = t.y + Math.sin(t.turret) * i; if (this.game && this.game.map.isBulletBlock(this.game.map.tileAt(nx, ny))) break; hx = nx; hy = ny; }
    ctx.lineTo(hx, hy); ctx.stroke(); ctx.restore();
  }
}
