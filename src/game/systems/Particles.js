import { Utils } from '../utils/index.js';

export class ParticleSystem {
  constructor() {
    this.pool = [];
    this.active = [];
    this.floaters = [];
    this.enabled = true;
  }

  setEnabled(v) { this.enabled = v; }

  spawn(x, y, o = {}) {
    if (!this.enabled) return;
    const n = o.count || 1;
    for (let i = 0; i < n; i++) {
      if (this.active.length > 800) break;
      const a = o.angle !== undefined ? o.angle + Utils.rand(-(o.spread || 0), o.spread || 0) : Utils.rand(0, Math.PI * 2);
      const sp = Utils.rand(o.speedMin || 30, o.speedMax || 160);
      const p = this.pool.pop() || {};
      p.x = x; p.y = y; p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
      p.life = o.life || Utils.rand(.3, .7); p.max = p.life; p.size = o.size || Utils.rand(2, 5);
      p.color = o.color || '#ffcf3f'; p.grav = o.grav || 0; p.fade = o.fade !== false; p.shrink = o.shrink !== false;
      this.active.push(p);
    }
  }

  explosion(x, y, s = 1) {
    this.spawn(x, y, { count: Math.floor(24 * s), color: '#ff8c1a', speedMin: 60, speedMax: 260 * s, size: Utils.rand(4, 9), life: .6 });
    this.spawn(x, y, { count: Math.floor(14 * s), color: '#ffe14a', speedMin: 40, speedMax: 200 * s, size: Utils.rand(3, 6), life: .5 });
    this.spawn(x, y, { count: Math.floor(12 * s), color: '#555', speedMin: 20, speedMax: 120 * s, size: Utils.rand(5, 11), life: .9, grav: -10 });
  }

  smoke(x, y) {
    this.spawn(x, y, { count: 1, color: 'rgba(120,120,120,0.5)', speedMin: 5, speedMax: 25, size: Utils.rand(4, 8), life: .6, grav: -15 });
  }

  floatText(x, y, text, color = '#fff', size = 20) {
    this.floaters.push({ x, y, text, color, size, life: 1, vy: -40 });
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) { this.active.splice(i, 1); this.pool.push(p); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.grav * dt; p.vx *= 0.94; p.vy *= 0.94;
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt * 1.2; f.y += f.vy * dt; f.vy *= 0.92;
      if (f.life <= 0) this.floaters.splice(i, 1);
    }
  }

  draw(ctx) {
    for (const p of this.active) {
      const t = p.life / p.max;
      ctx.globalAlpha = p.fade ? Utils.clamp(t, 0, 1) : 1;
      ctx.fillStyle = p.color;
      const s = p.shrink ? p.size * t : p.size;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, s), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const f of this.floaters) {
      ctx.globalAlpha = Utils.clamp(f.life, 0, 1);
      ctx.font = `900 ${f.size}px Segoe UI, Arial`; ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  clear() {
    for (const p of this.active) this.pool.push(p);
    this.active = []; this.floaters.length = 0;
  }
}
