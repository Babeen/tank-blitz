import { TILE, T } from '../constants/index.js';
import { Utils } from '../utils/index.js';

export class Bullet {
  init(x, y, angle, o = {}) {
    this.x = x; this.y = y; this.angle = angle; this.speed = o.speed || 420;
    this.vx = Math.cos(angle) * this.speed; this.vy = Math.sin(angle) * this.speed;
    this.damage = o.damage || 20; this.radius = o.radius || 5; this.owner = o.owner || 'player';
    this.bounces = o.bounces !== undefined ? o.bounces : 3; this.color = o.color || '#ffe14a';
    this.life = o.life || 3; this.dead = false; this.rocket = o.rocket || false; this.laser = o.laser || false;
    this.rail = o.rail || false; this.explosive = o.explosive || false;
    this.trail = this.trail || []; this.trail.length = 0;
    return this;
  }

  update(dt, game) {
    this.life -= dt; if (this.life <= 0) { this.dead = true; return; }
    this.trail.push(this.x, this.y); if (this.trail.length > 12) this.trail.splice(0, 2);
    const steps = this.rail ? 5 : 3;
    for (let s = 0; s < steps; s++) {
      const nx = this.x + this.vx * dt / steps, ny = this.y + this.vy * dt / steps;
      const t = game.map.tileAt(nx, ny);
      if (game.map.isBulletBlock(t)) {
        const gx = Math.floor(nx / TILE), gy = Math.floor(ny / TILE);
        if (t === T.BRICK || t === T.CRATE) {
          game.map.grid[gy][gx] = T.EMPTY;
          game.particles.spawn(gx * TILE + TILE / 2, gy * TILE + TILE / 2, { count: 10, color: t === T.BRICK ? '#c96b3a' : '#c99a4a', speedMax: 120, life: .5 });
          game.audio.hit();
          if (this.explosive) game.rocketExplode(this.x, this.y, this.owner);
          this.dead = true; return;
        }
        if (t === T.BARREL) { game.explodeBarrel(gx, gy); this.dead = true; return; }
        if (t === T.STEEL) {
          if (this.rail) { this.dead = true; return; }
          if (this.bounces > 0 && !this.rocket) {
            const pgx = Math.floor(this.x / TILE), pgy = Math.floor(this.y / TILE);
            if (pgx !== gx) this.vx = -this.vx; if (pgy !== gy) this.vy = -this.vy;
            if (pgx === gx && pgy === gy) { this.vx = -this.vx; this.vy = -this.vy; }
            this.angle = Math.atan2(this.vy, this.vx); this.bounces--;
            game.audio.ricochet();
            game.particles.spawn(nx, ny, { count: 6, color: '#9fd8ff', speedMax: 120, life: .3 });
            return;
          } else { this.dead = true; if (this.explosive) game.rocketExplode(this.x, this.y, this.owner); return; }
        }
      }
      this.x = nx; this.y = ny;
    }
  }

  draw(ctx) {
    if (this.laser || this.rail) {
      ctx.strokeStyle = this.color; ctx.lineWidth = this.rail ? 4 : 6; ctx.lineCap = 'round'; ctx.globalAlpha = 0.5;
      ctx.beginPath(); if (this.trail.length >= 2) { ctx.moveTo(this.trail[0], this.trail[1]); ctx.lineTo(this.x, this.y); }
      ctx.stroke(); ctx.globalAlpha = 1;
    } else {
      for (let i = 0; i < this.trail.length; i += 2) {
        ctx.globalAlpha = (i / this.trail.length) * 0.4; ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(this.trail[i], this.trail[i + 1], this.radius * 0.8, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.save(); ctx.shadowBlur = 10; ctx.shadowColor = this.color; ctx.fillStyle = this.rocket ? '#ff5a3c' : this.color;
    if (this.rocket) {
      ctx.translate(this.x, this.y); ctx.rotate(this.angle);
      ctx.fillRect(-8, -3, 16, 6); ctx.fillStyle = '#ffcf3f';
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(4, -4); ctx.lineTo(4, 4); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.arc(this.x - 1, this.y - 1, this.radius * 0.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

const pool = [];
export const BulletPool = {
  get(x, y, angle, o) { const b = pool.pop() || new Bullet(); return b.init(x, y, angle, o); },
  release(b) { if (pool.length < 300) pool.push(b); }
};
