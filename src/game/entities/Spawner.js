import { Utils } from '../utils/index.js';

export class Spawner {
  constructor(x, y, type, wave) { this.x = x; this.y = y; this.type = type; this.wave = wave; this.t = 0; this.dur = 1.4; this.done = false; this.warned = false; }

  update(dt) {
    this.t += dt;
    if (!this.warned) { this.warned = true; /* warning sound handled by game */ }
    if (this.t > this.dur * 0.55 && Math.random() < 0.5) /* smoke handled by game */;
    if (this.t >= this.dur) this.done = true;
  }

  draw(ctx) {
    const p = Utils.clamp(this.t / this.dur, 0, 1); ctx.save(); ctx.translate(this.x, this.y);
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(this.t * 14); ctx.strokeStyle = '#ff4b4b'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 20 + Math.sin(this.t * 8) * 4, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1; ctx.fillStyle = '#ff4b4b'; ctx.font = '900 22px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', 0, -1);
    ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(0, 0, 26, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); ctx.stroke(); ctx.restore();
  }
}
