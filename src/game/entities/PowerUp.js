import { Utils } from '../utils/index.js';

export class PowerUp {
  constructor(x, y, type) { this.x = x; this.y = y; this.type = type; this.t = 0; this.dead = false; this.r = 15; this.life = 18; }

  update(dt, game) {
    this.t += dt; this.life -= dt; if (this.life <= 0) this.dead = true;
    for (const pl of game.players) {
      if (pl.dead) continue;
      if (pl.coinMagnet > 0) {
        const d = Utils.dist(this.x, this.y, pl.x, pl.y);
        if (d < 200) { const a = Math.atan2(pl.y - this.y, pl.x - this.x); this.x += Math.cos(a) * 160 * dt; this.y += Math.sin(a) * 160 * dt; }
      }
    }
  }

  draw(ctx) {
    const bob = Math.sin(this.t * 3) * 4; ctx.save();
    ctx.globalAlpha = this.life < 3 ? (0.4 + 0.6 * Math.abs(Math.sin(this.life * 8))) : 1;
    ctx.translate(this.x, this.y + bob); ctx.rotate(Math.sin(this.t * 1.5) * 0.15);
    ctx.shadowBlur = 14; ctx.shadowColor = this.type.color; ctx.fillStyle = this.type.color;
    ctx.beginPath(); ctx.arc(0, 0, this.r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(-4, -4, this.r * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(-Math.sin(this.t * 1.5) * 0.15);
    ctx.fillStyle = '#1a1030'; ctx.font = '900 10px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(this.type.label, 0, 1); ctx.restore();
  }
}
