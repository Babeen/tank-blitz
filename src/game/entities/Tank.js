import { TILE, T, WEAPONS } from '../constants/index.js';
import { Utils } from '../utils/index.js';

export class Tank {
  constructor(x, y, o = {}) {
    this.x = x; this.y = y; this.radius = 17; this.angle = o.angle || 0; this.turret = this.angle;
    this.speed = 0; this.maxSpeed = o.maxSpeed || 150; this.vx = 0; this.vy = 0;
    this.maxHp = o.maxHp || 100; this.hp = this.maxHp; this.color = o.color || '#6bd35a';
    this.turretColor = o.turretColor || '#4fae42'; this.team = o.team || 'player'; this.dead = false;
    this.fireCd = 0; this.weapon = 'cannon'; this.ammo = { cannon: Infinity };
    this.dashCd = 0; this.dashTime = 0; this.dashDir = 0; this.hitFlash = 0;
    this.shield = 0; this.speedBoost = 0; this.rapidFire = 0; this.tripleShot = 0;
    this.scoreMult = 1; this.scoreMultTime = 0; this.coinMagnet = 0; this.frozen = 0;
    this.isBoss = o.isBoss || false; this.enemyType = o.enemyType || null; this.recoil = 0; this.name = o.name || '';
    this._enemyCd = o.enemyCd || 1; this.ai = null; this.spawning = 0; this.smokeTimer = 0;
  }

  get inBush() { return this.map && this.map.tileAt(this.x, this.y) === T.BUSH; }

  takeDamage(dmg, game) {
    if (this.dead || this.spawning > 0) return;
    if (this.shield > 0) {
      this.shield -= dmg * 0.5; if (this.shield < 0) this.shield = 0;
      game.particles.spawn(this.x, this.y, { count: 8, color: '#5aa8ff', speedMax: 120, life: .3 });
      game.audio.hit(); return;
    }
    this.hp -= dmg; this.hitFlash = 0.15;
    game.particles.floatText(this.x, this.y - this.radius - 6, '-' + Math.round(dmg), this.team === 'enemy' ? '#ff6b6b' : '#fff', 18);
    game.audio.hit();
    if (this.hp <= 0) this.die(game);
  }

  die(game) {
    if (this.dead) return; this.dead = true;
    game.particles.explosion(this.x, this.y, this.isBoss ? 2.4 : 1);
    game.audio.explode(); game.shake(this.isBoss ? 26 : 10);
  }

  applyKnob(dx, dy, dt) {
    const mag = Math.hypot(dx, dy);
    if (mag > 0.1) {
      const target = Math.atan2(dy, dx);
      this.angle = Utils.angLerp(this.angle, target, Math.min(1, dt * 10));
      const boost = this.speedBoost > 0 ? 1.5 : 1;
      this.speed = Utils.lerp(this.speed, this.maxSpeed * boost * Math.min(1, mag), dt * 6);
    } else this.speed = Utils.lerp(this.speed, 0, dt * 8);
  }

  move(dt, game) {
    if (this.spawning > 0) { this.spawning -= dt; return; }
    if (this.frozen > 0) { this.frozen -= dt; this.speed *= 0.9; }
    const onOil = game.map.tileAt(this.x, this.y) === T.OIL;
    let tvx = Math.cos(this.angle) * this.speed, tvy = Math.sin(this.angle) * this.speed;
    if (this.dashTime > 0) {
      this.dashTime -= dt;
      tvx = Math.cos(this.dashDir) * this.maxSpeed * 3.4; tvy = Math.sin(this.dashDir) * this.maxSpeed * 3.4;
      if (Math.random() < 0.6) game.particles.spawn(this.x, this.y, { count: 1, color: this.color, speedMax: 40, life: .3 });
    }
    const grip = onOil ? 0.04 : 0.35;
    this.vx = Utils.lerp(this.vx, tvx, grip); this.vy = Utils.lerp(this.vy, tvy, grip);
    this.tryMove(this.vx * dt, this.vy * dt, game);
    if (this.dashCd > 0) this.dashCd -= dt; if (this.fireCd > 0) this.fireCd -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt; if (this.recoil > 0) this.recoil -= dt * 4;
    for (const k of ['speedBoost', 'rapidFire', 'tripleShot', 'coinMagnet']) if (this[k] > 0) this[k] -= dt;
    if (this.scoreMultTime > 0) { this.scoreMultTime -= dt; if (this.scoreMultTime <= 0) this.scoreMult = 1; }
    if (Math.abs(this.speed) > 30 && Math.random() < 0.25 && !this.inBush) game.particles.smoke(this.x - Math.cos(this.angle) * this.radius, this.y - Math.sin(this.angle) * this.radius);
    if (this.hp < this.maxHp * 0.35 && !this.dead) {
      this.smokeTimer -= dt; if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.15;
        game.particles.spawn(this.x, this.y - 4, { count: 1, color: 'rgba(60,60,60,0.6)', speedMin: 5, speedMax: 20, size: Utils.rand(5, 9), life: .8, grav: -25 });
      }
    }
  }

  tryMove(dx, dy, game) {
    const r = this.radius - 2;
    let nx = this.x + dx; if (!this.collides(nx, this.y, r, game)) this.x = nx; else this.vx *= -0.2;
    let ny = this.y + dy; if (!this.collides(this.x, ny, r, game)) this.y = ny; else this.vy *= -0.2;
    this.x = Utils.clamp(this.x, r + TILE, game.map.worldW() - r - TILE);
    this.y = Utils.clamp(this.y, r + TILE, game.map.worldH() - r - TILE);
  }

  collides(x, y, r, game) {
    for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r], [0, -r], [0, r], [-r, 0], [r, 0]])
      if (game.map.isSolid(game.map.tileAt(x + ox, y + oy))) return true;
    return false;
  }

  canShoot() {
    if (this.fireCd > 0 || this.spawning > 0) return false;
    if (this.weapon !== 'cannon' && this.ammo[this.weapon] !== Infinity && (this.ammo[this.weapon] || 0) <= 0) return false;
    return true;
  }

  shoot(game) {
    if (!this.canShoot()) return;
    const w = WEAPONS[this.weapon]; let cd = w.cd; if (this.rapidFire > 0) cd *= 0.4;
    if (this.team === 'enemy') cd = this._enemyCd * Utils.rand(0.85, 1.2);
    this.fireCd = cd;
    if (this.weapon !== 'cannon' && this.ammo[this.weapon] !== Infinity) {
      this.ammo[this.weapon]--; if (this.ammo[this.weapon] <= 0) this.weapon = 'cannon';
    }
    const tripled = this.tripleShot > 0; const pellets = w.pellets;
    const shots = [];
    for (let p = 0; p < pellets; p++) {
      let sp = (pellets > 1 ? (p - (pellets - 1) / 2) * w.spread : Utils.rand(-w.spread, w.spread));
      shots.push(this.turret + sp);
    }
    if (tripled) { shots.push(this.turret - 0.25); shots.push(this.turret + 0.25); }
    const mx = this.x + Math.cos(this.turret) * (this.radius + 10), my = this.y + Math.sin(this.turret) * (this.radius + 10);
    const spdMul = this.team === 'enemy' ? game.diffCfg().bulletSpeed : 1;
    for (const a of shots) {
      game.bullets.push(game.bulletPool.get(mx, my, a, {
        speed: w.speed * spdMul, damage: w.dmg * (this.team === 'enemy' ? 0.85 : 1),
        owner: this.team, bounces: w.bounces, color: w.color,
        radius: w.rocket ? 6 : (w.laser ? 4 : 5), rocket: w.rocket, laser: w.laser, rail: w.rail, explosive: w.explosive
      }));
    }
    game.audio[w.sound] && game.audio[w.sound](); this.recoil = 1;
    this.vx -= Math.cos(this.turret) * 40; this.vy -= Math.sin(this.turret) * 40;
    game.particles.spawn(mx, my, { count: 8, color: '#fff4c2', angle: this.turret, spread: 0.5, speedMin: 80, speedMax: 200, life: .2, size: Utils.rand(2, 5) });
    game.shake(this.weapon === 'rocket' || this.weapon === 'railgun' ? 6 : this.weapon === 'shotgun' ? 5 : 2);
  }

  dash() {
    if (this.dashCd > 0 || this.frozen > 0 || this.spawning > 0) return;
    this.dashCd = 1.4; this.dashTime = 0.16; this.dashDir = this.angle;
  }

  giveWeapon(w, ammo) { this.weapon = w; this.ammo[w] = (this.ammo[w] || 0) + ammo; }

  rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath(); ctx.fill();
  }

  draw(ctx, hideInBush = false, map = null) {
    if (this.dead) return;
    ctx.save(); ctx.translate(this.x, this.y);
    let alpha = 1;
    if (this.spawning > 0) alpha = Utils.clamp(1 - this.spawning / 1.2, 0, 1) * 0.9;
    else if (map && map.tileAt(this.x, this.y) === T.BUSH) alpha = (this.team === 'enemy' || hideInBush) ? 0.25 : 0.55;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(3, 5, this.radius + 2, this.radius, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.rotate(this.angle); const rec = this.recoil > 0 ? this.recoil * 3 : 0;
    ctx.fillStyle = '#2b2f3a'; this.rr(ctx, -this.radius - 2, -this.radius - 2, 4, this.radius * 2 + 4, 2); this.rr(ctx, -this.radius - 2, this.radius - 2, this.radius * 2 + 4, 4, 2);
    ctx.fillStyle = '#3a3f4d'; this.rr(ctx, -this.radius, -this.radius, this.radius * 2, 4, 2); this.rr(ctx, -this.radius, this.radius - 4, this.radius * 2, 4, 2);
    let bodyCol = this.color; if (this.hitFlash > 0) bodyCol = '#ffffff'; else if (this.frozen > 0) bodyCol = '#9fd8ff';
    ctx.fillStyle = bodyCol; this.rr(ctx, -this.radius, -this.radius + 3, this.radius * 2, this.radius * 2 - 6, 6);
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; this.rr(ctx, -this.radius, this.radius - 8, this.radius * 2, 5, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; this.rr(ctx, -this.radius, -this.radius + 3, this.radius * 2, 4, 3);
    ctx.restore();
    ctx.save(); ctx.rotate(this.turret); ctx.fillStyle = this.hitFlash > 0 ? '#fff' : this.turretColor;
    const bl = this.isBoss ? 32 : 24; this.rr(ctx, 0 - rec, -4, bl, 8, 3);
    if (this.isBoss) { this.rr(ctx, 0 - rec, -13, bl - 4, 6, 3); this.rr(ctx, 0 - rec, 7, bl - 4, 6, 3); }
    ctx.beginPath(); ctx.arc(0, 0, this.radius * 0.62, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath(); ctx.arc(-2, -2, this.radius * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (this.shield > 0) { ctx.strokeStyle = 'rgba(90,168,255,' + (0.4 + 0.3 * Math.sin(performance.now() / 120)) + ')'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, this.radius + 7, 0, Math.PI * 2); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.restore();
    if (this.hp < this.maxHp && !this.dead && !this.isBoss && !(map && map.tileAt(this.x, this.y) === T.BUSH && this.team === 'enemy')) {
      const w = this.radius * 2.2, h = 5;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; this.rr(ctx, this.x - w / 2, this.y - this.radius - 13, w, h, 2);
      ctx.fillStyle = this.team === 'enemy' ? '#ff5b5b' : this.team === 'p2' ? '#5aa8ff' : '#5be36a'; this.rr(ctx, this.x - w / 2, this.y - this.radius - 13, w * (this.hp / this.maxHp), h, 2);
    }
    if (this.name && !(map && map.tileAt(this.x, this.y) === T.BUSH && this.team === 'enemy') && !this.isBoss) {
      ctx.font = '700 11px Segoe UI'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.strokeText(this.name, this.x, this.y - this.radius - 18); ctx.fillText(this.name, this.x, this.y - this.radius - 18);
    }
  }
}
