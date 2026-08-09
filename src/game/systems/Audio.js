export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
  }

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
    } catch (e) {
      this.enabled = false;
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(v) { this.enabled = v; }
  isEnabled() { return this.enabled; }

  tone(freq, dur, type = 'square', vol = 0.4, slideTo = null) {
    if (!this.ctx || !this.enabled) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, this.ctx.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), this.ctx.currentTime + dur);
    g.gain.setValueAtTime(vol, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(this.ctx.currentTime + dur);
  }

  noise(dur, vol = 0.4, ff = 1000) {
    if (!this.ctx || !this.enabled) return;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = ff;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
  }

  shoot()     { this.tone(300, 0.11, 'square', 0.3, 90); this.tone(140, 0.14, 'sawtooth', 0.22, 50); this.noise(0.07, 0.16, 1600); }
  machinegun(){ this.tone(520, 0.05, 'square', 0.16, 300); this.noise(0.03, 0.08, 2200); }
  shotgun()   { this.noise(0.14, 0.4, 900); this.tone(160, 0.14, 'sawtooth', 0.28, 50); }
  rocket()    { this.tone(200, 0.28, 'sawtooth', 0.32, 700); this.noise(0.22, 0.2, 2500); }
  laser()     { this.tone(1100, 0.16, 'sine', 0.26, 320); this.tone(700, 0.1, 'triangle', 0.15, 1400); }
  railgun()   { this.tone(1600, 0.06, 'sine', 0.3, 200); this.noise(0.25, 0.3, 3000); this.tone(120, 0.3, 'sawtooth', 0.3, 40); }
  charge()    { this.tone(300, 0.5, 'sine', 0.12, 1200); }
  explode()   { this.noise(0.45, 0.55, 700); this.tone(90, 0.45, 'sawtooth', 0.42, 28); }
  hit()       { this.tone(300, 0.06, 'square', 0.2, 120); }
  ricochet()  { this.tone(1400, 0.06, 'sine', 0.2, 600); this.tone(900, 0.04, 'triangle', 0.1, 1800); }
  pickup()    { this.tone(660, 0.1, 'sine', 0.3, 990); this.tone(990, 0.12, 'sine', 0.25, 1480); }
  coin()      { this.tone(1046, 0.07, 'sine', 0.2, 1568); }
  combo(n)    { this.tone(600 + n * 70, 0.1, 'triangle', 0.25, 900 + n * 70); }
  click()     { this.tone(500, 0.05, 'square', 0.18, 720); }
  warning()   { this.tone(220, 0.5, 'sawtooth', 0.3, 180); setTimeout(() => this.tone(220, 0.5, 'sawtooth', 0.3, 180), 260); }
  victory()   { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 'triangle', 0.3), i * 140)); }
  defeat()    { [400, 330, 262, 196].forEach((f, i) => setTimeout(() => this.tone(f, 0.35, 'sawtooth', 0.3), i * 180)); }
  dash()      { this.tone(300, 0.15, 'sine', 0.25, 900); }
}
