import { TILE, T, THEMES, WEAPONS, ENEMY_TYPES, PU_TYPES, DIFF, LEVELS } from '../constants/index.js';
import { UPGRADE_TRACKS, UPGRADE_DEFAULTS, upgradeCost } from '../constants/upgrades.js';
import { isTouchDevice } from '../utils/touchDevice.js';
import { Utils } from '../utils/index.js';
import { AudioManager } from '../systems/Audio.js';
import { InputManager } from '../systems/Input.js';
import { MapGenerator } from '../systems/MapGen.js';
import { ParticleSystem } from '../systems/Particles.js';
import { BulletPool } from '../entities/Bullet.js';
import { Tank } from '../entities/Tank.js';
import { EnemyAI } from '../entities/EnemyAI.js';
import { PowerUp } from '../entities/PowerUp.js';
import { Spawner } from '../entities/Spawner.js';

export class GameEngine {
  constructor(canvas, minimapCanvas, callbacks) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.mmCanvas = minimapCanvas; this.mmCtx = minimapCanvas.getContext('2d');
    this.W = 0; this.H = 0; this.dpr = 1;
    this.cam = { x: 0, y: 0, zoom: 1, targetZoom: 1, shakeT: 0, shakeMag: 0 };
    this.state = 'menu'; this.mode = 'battle'; this.difficulty = 'easy';
    this.players = []; this.enemies = []; this.bullets = []; this.powerups = []; this.spawners = []; this.pendingSpawns = [];
    this.stats = { kills: 0, coins: 0, score: 0, wave: 1, lives: 3, p2lives: 3, time: 0 };
    this.combo = 0; this.comboTimer = 0; this.waveDelay = 0; this.last = 0; this.running = false;
    this.bossRef = null; this.tutorial = null;
    this.settings = this.loadSettings();
    this.audio = new AudioManager();
    this.input = new InputManager();
    this.map = new MapGenerator();
    this.particles = new ParticleSystem();
    this.bulletPool = BulletPool;
    this.callbacks = callbacks;
    this._boundLoop = this.loop.bind(this);
  }

  init() {
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.input.init(this.canvas);
    // Nothing previously called this — the on-screen joystick markup and
    // InputManager's touch-reading code both existed, but were never
    // connected, so isTouch() was always false and the game only ever
    // responded to keyboard/mouse. See TouchControls.jsx for the other
    // half of this wiring.
    if (isTouchDevice()) this.input.setTouch(true);
    requestAnimationFrame(this._boundLoop);
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.canvas.width = this.W * this.dpr; this.canvas.height = this.H * this.dpr;
    this.canvas.style.width = this.W + 'px'; this.canvas.style.height = this.H + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  diffCfg() { return DIFF[this.difficulty]; }

  themeForWave() {
    if (this.mode === 'battle') { const L = LEVELS[Utils.clamp(this.stats.wave - 1, 0, LEVELS.length - 1)]; return L.theme; }
    const keys = ['city', 'forest', 'factory', 'desert', 'maze', 'arena'];
    return keys[(this.stats.wave - 1) % keys.length];
  }

  start(mode, diff) {
    this.mode = mode; this.difficulty = diff || 'normal';
    this.audio.init(); this.audio.resume(); this.particles.clear();
    this.bullets = []; this.powerups = []; this.enemies = []; this.spawners = []; this.pendingSpawns = []; this.bossRef = null;
    this.combo = 0; this.comboTimer = 0;
    this.stats = { kills: 0, coins: 0, score: 0, wave: 1, lives: 3, p2lives: 3, time: 0 };
    this.buildLevel();
    this.state = 'play'; this.running = true;
    this.audio.setEnabled(this.settings.sound); this.particles.setEnabled(this.settings.particles);
    this.callbacks.onStateChange(this.state, this.mode);
    this.callbacks.onToast(this.mode === 'battle' ? ('LEVEL 1 — ' + LEVELS[0].note) : this.mode === 'survival' ? 'SURVIVE!' : '2 PLAYER!');
    this.last = performance.now();
    setTimeout(() => this.spawnWave(), 700);
  }

  buildLevel() {
    // Size the map to roughly match the viewport (in tiles) so the play
    // area fills the screen instead of leaving empty background around a
    // map that's capped much smaller than the window. The upper bound is
    // still capped for generation/perf sanity on very large or ultrawide
    // displays — the camera-centering fallback below covers any remainder.
    const cols = Utils.clamp(Math.round(this.W / TILE) + 2, 15, 34), rows = Utils.clamp(Math.round(this.H / TILE) + 2, 11, 22);
    this.map.generate(cols, rows, this.themeForWave());
    this.players = [];
    // Garage upgrades (purchased with banked coins) apply to the player's
    // own tank(s) in single-player only — multiplayer stays vanilla so
    // every match is on equal footing.
    const up = this.getUpgradedStats();
    const p1 = new Tank(2 * TILE + 24, 2 * TILE + 24, { color: '#6bd35a', turretColor: '#4fae42', team: 'player', maxHp: up.maxHp, maxSpeed: up.maxSpeed, dmgMult: up.dmgMult, reloadMult: up.reloadMult });
    this.players.push(p1);
    if (this.mode === '2player') {
      const p2 = new Tank((cols - 3) * TILE, (rows - 3) * TILE, { color: '#5aa8ff', turretColor: '#2f7fe0', team: 'p2', maxHp: up.maxHp, maxSpeed: up.maxSpeed, dmgMult: up.dmgMult, reloadMult: up.reloadMult, angle: Math.PI });
      this.players.push(p2);
    }
  }

  pickTypesAndCount() {
    const d = this.diffCfg();
    if (this.mode === 'survival') {
      const wave = this.stats.wave; let pool;
      if (wave <= 1) pool = ['scout', 'soldier']; else if (wave <= 3) pool = ['scout', 'soldier', 'soldier', 'heavy', 'sniper']; else pool = ['soldier', 'heavy', 'sniper', 'scout', 'heavy'];
      const count = Math.min(3 + Math.floor(wave * d.waveGrowth), 11);
      const boss = wave % d.bossLevel === 0;
      return { pool, count, boss, miniBoss: false };
    }
    if (this.mode === '2player') {
      const wave = this.stats.wave; let pool = wave <= 1 ? ['scout', 'soldier'] : wave <= 3 ? ['scout', 'soldier', 'heavy'] : ['soldier', 'heavy', 'sniper', 'scout'];
      return { pool, count: Math.round((d.waveSize + 2) + wave * d.waveGrowth), boss: wave >= 6, miniBoss: false };
    }
    const L = LEVELS[Utils.clamp(this.stats.wave - 1, 0, LEVELS.length - 1)];
    const count = Math.round(d.waveSize + (this.stats.wave - 1) * d.waveGrowth);
    return { pool: L.types, count: Utils.clamp(count, L.types.length, 10), boss: !!L.boss, miniBoss: !!L.miniBoss };
  }

  spawnPoints() {
    return [[2, this.map.rows - 3], [this.map.cols - 3, 2], [this.map.cols - 3, this.map.rows - 3], [Math.floor(this.map.cols / 2), 2], [Math.floor(this.map.cols / 2), this.map.rows - 3], [2, 2], [this.map.cols - 3, Math.floor(this.map.rows / 2)], [2, Math.floor(this.map.rows / 2)]];
  }

  spawnWave() {
    if (this.state !== 'play') return;
    const { pool, count, boss, miniBoss } = this.pickTypesAndCount();
    const pts = this.spawnPoints();
    this.pendingSpawns = [];
    for (let i = 0; i < count; i++) {
      let type;
      if ((boss || miniBoss) && i === 0) type = boss ? 'boss' : 'heavy';
      else type = Utils.choose(pool);
      const p = pts[i % pts.length];
      const sp = new Spawner(p[0] * TILE + TILE / 2, p[1] * TILE + TILE / 2, type, this.stats.wave);
      this.spawners.push(sp);
      this.pendingSpawns.push({ spawner: sp, mini: (miniBoss && i === 0) });
    }
    if (boss) { this.cam.targetZoom = 1.15; setTimeout(() => this.cam.targetZoom = 1, 1800); this.callbacks.onToast('!!! MAJOR BOSS !!!'); this.audio.warning(); this.shake(20); }
    else if (miniBoss) { this.callbacks.onToast('MINI BOSS'); this.audio.warning(); this.shake(12); }
  }

  spawnEnemy(type, wx, wy, mini) {
    const cfg = ENEMY_TYPES[type], d = this.diffCfg();
    const wave = this.stats.wave;
    const scale = this.mode === 'survival' ? 1 + (wave - 1) * 0.12 : 1 + (wave - 1) * 0.06;
    let hp = cfg.maxHp * d.hpMul * scale; if (mini) hp *= 2;
    const t = new Tank(wx, wy, { color: cfg.color, turretColor: cfg.turretColor, team: 'enemy', maxHp: hp, maxSpeed: cfg.maxSpeed, isBoss: cfg.isBoss || false, enemyType: type, name: mini ? 'MINI-BOSS' : cfg.name, enemyCd: cfg.fireCd });
    t.radius = mini ? cfg.radius + 6 : cfg.radius; t.weapon = 'cannon'; t.ai = new EnemyAI(t, type, d); t.spawning = 1.2;
    if (cfg.isBoss) { this.bossRef = t; this.callbacks.onBossChange(t); }
    this.enemies.push(t); this.particles.spawn(wx, wy, { count: 16, color: cfg.color, speedMax: 180, life: .5 });
  }

  explodeBarrel(gx, gy) {
    const wx = gx * TILE + TILE / 2, wy = gy * TILE + TILE / 2; this.map.grid[gy][gx] = T.EMPTY;
    this.particles.explosion(wx, wy, 1.5); this.audio.explode(); this.shake(14); const R = 90;
    for (const t of [...this.players, ...this.enemies]) { if (t.dead) continue; const d = Utils.dist(wx, wy, t.x, t.y); if (d < R) t.takeDamage(50 * (1 - d / R), this); }
    for (let y = gy - 1; y <= gy + 1; y++) for (let x = gx - 1; x <= gx + 1; x++) {
      if (x <= 0 || y <= 0 || x >= this.map.cols - 1 || y >= this.map.rows - 1) continue;
      const tt = this.map.grid[y][x]; if (tt === T.BRICK || tt === T.CRATE) this.map.grid[y][x] = T.EMPTY; else if (tt === T.BARREL) setTimeout(() => this.explodeBarrel(x, y), 80);
    }
  }

  rocketExplode(x, y, owner) {
    this.particles.explosion(x, y, 1.4); this.audio.explode(); this.shake(10); const R = 70;
    const hitTeam = owner === 'enemy' ? this.players : this.enemies;
    for (const t of hitTeam) { if (t.dead) continue; const d = Utils.dist(x, y, t.x, t.y); if (d < R) t.takeDamage(40 * (1 - d / R), this); }
  }

  spawnPowerUp(x, y, forceHealth) {
    let type;
    if (forceHealth) type = PU_TYPES[0];
    else if (Math.random() < this.diffCfg().healthChance) type = PU_TYPES[0];
    else type = Utils.choose(PU_TYPES);
    this.powerups.push(new PowerUp(x, y, type));
  }

  applyPowerUp(pl, pu) {
    this.audio.pickup(); this.particles.spawn(pu.x, pu.y, { count: 16, color: pu.type.color, speedMax: 180, life: .5 });
    this.particles.floatText(pl.x, pl.y - 30, pu.type.label, pu.type.color, 20);
    switch (pu.type.id) {
      case 'repair': pl.hp = Math.min(pl.maxHp, pl.hp + 50); this.particles.floatText(pl.x, pl.y - 46, '+50 HP', '#5be36a', 18); break;
      case 'speed': pl.speedBoost = 8; break; case 'shield': pl.shield = 60; break; case 'rapid': pl.rapidFire = 8; break;
      case 'triple': pl.tripleShot = 10; break; case 'freeze': for (const e of this.enemies) e.frozen = 4; this.callbacks.onToast('FROZEN'); break;
      case 'rocket': pl.giveWeapon('rocket', 8); break; case 'magnet': pl.coinMagnet = 10; break;
      case 'multi': pl.scoreMult = 2; pl.scoreMultTime = 12; this.callbacks.onToast('2X SCORE'); break;
      case 'shotgun': pl.giveWeapon('shotgun', 24); break; case 'laser': pl.giveWeapon('laser', 44); break;
      case 'mg': pl.giveWeapon('machinegun', 140); break; case 'railgun': pl.giveWeapon('railgun', 6); break;
    }
  }

  shake(mag) { if (!this.settings.shake) return; this.cam.shakeMag = Math.max(this.cam.shakeMag, mag); this.cam.shakeT = 0.3; }

  update(dt) {
    this.input.getTouchState();
    if (this.state !== 'play' && this.state !== 'tutorial') return;
    this.stats.time += dt;
    if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.combo = 0; }

    const alive = this.players.filter(p => !p.dead); let fx, fy;
    if (alive.length) { fx = alive.reduce((s, p) => s + p.x, 0) / alive.length; fy = alive.reduce((s, p) => s + p.y, 0) / alive.length; }
    else { fx = this.map.worldW() / 2; fy = this.map.worldH() / 2; }
    this.cam.zoom = Utils.lerp(this.cam.zoom, this.cam.targetZoom, dt * 3);
    this.cam.x = Utils.lerp(this.cam.x, fx - this.W / (2 * this.cam.zoom), dt * 6);
    this.cam.y = Utils.lerp(this.cam.y, fy - this.H / (2 * this.cam.zoom), dt * 6);
    // When the map is narrower/shorter than the viewport, center it instead
    // of pinning to the top-left corner — pinning left a permanent block of
    // empty background along the right and/or bottom edge on any window
    // bigger than the map itself.
    const maxCamX = this.map.worldW() - this.W / this.cam.zoom;
    const maxCamY = this.map.worldH() - this.H / this.cam.zoom;
    this.cam.x = maxCamX > 0 ? Utils.clamp(this.cam.x, 0, maxCamX) : maxCamX / 2;
    this.cam.y = maxCamY > 0 ? Utils.clamp(this.cam.y, 0, maxCamY) : maxCamY / 2;
    if (this.cam.shakeT > 0) { this.cam.shakeT -= dt; this.cam.shakeMag *= 0.9; }
    if (this.state === 'tutorial' && this.tutorial) this.tutorial.update(dt);

    for (let i = this.spawners.length - 1; i >= 0; i--) {
      const s = this.spawners[i]; s.update(dt);
      if (!s.warned) { s.warned = true; this.audio.warning(); }
      if (s.t > s.dur * 0.55 && Math.random() < 0.5) this.particles.smoke(s.x + Utils.rand(-14, 14), s.y + Utils.rand(-14, 14));
      if (s.done) { const ps = this.pendingSpawns.find(p => p.spawner === s); this.spawnEnemy(s.type, s.x, s.y, ps && ps.mini); this.spawners.splice(i, 1); }
    }

    this.handlePlayer(this.players[0], 0, dt);
    if (this.players[1]) this.handlePlayer(this.players[1], 1, dt);
    for (const p of this.players) if (!p.dead) p.move(dt, this);
    for (const e of this.enemies) { if (e.dead) continue; e.ai.update(dt, this); e.move(dt, this); }
    for (const b of this.bullets) b.update(dt, this);

    for (const b of this.bullets) { if (b.dead) continue;
      const targets = b.owner === 'enemy' ? this.players : this.enemies;
      for (const t of targets) { if (t.dead || t.spawning > 0) continue;
        if (Utils.dist(b.x, b.y, t.x, t.y) < t.radius + b.radius) {
          t.takeDamage(b.damage * (b.owner === 'enemy' ? this.diffCfg().dmgMul : 1), this);
          this.particles.spawn(b.x, b.y, { count: 8, color: b.color, angle: b.angle, spread: 1, speedMax: 140, life: .3 });
          if (b.explosive) this.rocketExplode(b.x, b.y, b.owner); b.dead = true; break;
        }
      }
    }
    for (let i = this.bullets.length - 1; i >= 0; i--) if (this.bullets[i].dead) { BulletPool.release(this.bullets[i]); this.bullets.splice(i, 1); }

    for (const pu of this.powerups) {
      pu.update(dt, this);
      for (const p of this.players) { if (p.dead) continue; if (Utils.dist(pu.x, pu.y, p.x, p.y) < p.radius + pu.r) { this.applyPowerUp(p, pu); pu.dead = true; break; } }
    }
    for (let i = this.powerups.length - 1; i >= 0; i--) if (this.powerups[i].dead) this.powerups.splice(i, 1);
    if (this.state === 'play' && Math.random() < dt * this.diffCfg().dropRate && this.powerups.length < 4) {
      let gx, gy, tries = 0; do { gx = Utils.randi(2, this.map.cols - 3); gy = Utils.randi(2, this.map.rows - 3); tries++; } while (this.map.grid[gy][gx] !== T.EMPTY && tries < 20);
      if (this.map.grid[gy][gx] === T.EMPTY) this.spawnPowerUp(gx * TILE + TILE / 2, gy * TILE + TILE / 2);
    }
    this.particles.update(dt);

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]; if (e.dead) {
        const cfg = ENEMY_TYPES[e.enemyType]; this.combo++; this.comboTimer = 3;
        if (this.combo > 1) { this.audio.combo(Math.min(this.combo, 8)); this.callbacks.onComboPulse(); }
        const comboBonus = 1 + Math.min(this.combo - 1, 9) * 0.15;
        const mult = (this.players[0] ? this.players[0].scoreMult : 1) * comboBonus;
        const pts = Math.round(cfg.score * mult); this.stats.kills++; this.stats.score += pts; this.stats.coins += Utils.randi(5, 15);
        this.particles.floatText(e.x, e.y - 20, '+' + pts + (this.combo > 1 ? ' x' + this.combo : ''), '#ffd54a', 20);
        if (e === this.bossRef) { this.bossRef = null; this.callbacks.onBossChange(null); for (let k = 0; k < 6; k++) setTimeout(() => { this.particles.explosion(e.x + Utils.rand(-30, 30), e.y + Utils.rand(-30, 30), 1.4); this.audio.explode(); }, k * 140); }
        if (Math.random() < 0.4) this.spawnPowerUp(e.x, e.y, e.enemyType === 'heavy' || e.isBoss); this.audio.coin(); this.enemies.splice(i, 1);
      }
    }

    for (const p of this.players) { if (p.dead) {
      if (p.team === 'player' && this.stats.lives > 0 && !p._respawning) { this.stats.lives--; if (this.stats.lives > 0) this.respawn(p); }
      else if (p.team === 'p2' && this.stats.p2lives > 0 && !p._respawning) { this.stats.p2lives--; if (this.stats.p2lives > 0) this.respawn(p); }
    }}

    if (this.state === 'play') this.checkWaveState(dt);
    this.callbacks.onHUDUpdate({ stats: this.stats, players: this.players, combo: this.combo, mode: this.mode });
  }

  respawn(p) {
    p._respawning = true;
    setTimeout(() => {
      p._respawning = false; p.dead = false; p.hp = p.maxHp; p.shield = 30; p.spawning = 0.6;
      const c = Utils.choose([[2, 2], [this.map.cols - 3, this.map.rows - 3], [this.map.cols - 3, 2], [2, this.map.rows - 3]]);
      p.x = c[0] * TILE + TILE / 2; p.y = c[1] * TILE + TILE / 2; p.vx = 0; p.vy = 0;
      this.particles.spawn(p.x, p.y, { count: 16, color: p.color, speedMax: 160, life: .5 });
    }, 1000);
  }

  checkWaveState(dt) {
    const p1Dead = this.stats.lives <= 0 && this.players[0].dead;
    if (this.mode === '2player') { if (p1Dead && (!this.players[1] || (this.stats.p2lives <= 0 && this.players[1].dead))) { this.endGame(false); return; } }
    else if (p1Dead) { this.endGame(false); return; }
    if (this.enemies.length === 0 && this.spawners.length === 0) {
      const maxWave = this.mode === 'battle' ? LEVELS.length : (this.mode === '2player' ? 6 : Infinity);
      this.waveDelay += dt;
      if (this.waveDelay > 2) {
        if (this.stats.wave >= maxWave && this.mode !== 'survival') { this.endGame(true); return; }
        this.stats.wave++; this.waveDelay = 0;
        if (this.mode === 'battle') { const L = LEVELS[Utils.clamp(this.stats.wave - 1, 0, LEVELS.length - 1)]; this.map.generate(this.map.cols, this.map.rows, L.theme); this.callbacks.onToast('LEVEL ' + this.stats.wave + ' — ' + L.note); }
        else this.callbacks.onToast('WAVE ' + this.stats.wave);
        this.spawnWave();
      }
    }
  }

  handlePlayer(p, idx, dt) {
    if (p.dead) return; let dx = 0, dy = 0;
    if (idx === 0) {
      if (this.input.key('KeyW')) dy--; if (this.input.key('KeyS')) dy++; if (this.input.key('KeyA')) dx--; if (this.input.key('KeyD')) dx++;
      if (this.input.isTouch()) { dx += this.input.touch.mx; dy += this.input.touch.my; }
      if (!this.input.isTouch()) { const wx = this.cam.x + this.input.mouse.x / this.cam.zoom, wy = this.cam.y + this.input.mouse.y / this.cam.zoom; p.turret = Utils.angLerp(p.turret, Math.atan2(wy - p.y, wx - p.x), dt * 14); }
      else { const tgt = this.nearestEnemy(p); if (tgt) p.turret = Utils.angLerp(p.turret, Math.atan2(tgt.y - p.y, tgt.x - p.x), dt * 10); else if (Math.hypot(dx, dy) > 0.1) p.turret = Utils.angLerp(p.turret, Math.atan2(dy, dx), dt * 10); }
      if (this.input.mouse.down || this.input.touch.fire) p.shoot(this);
      if (this.input.key('Space') || this.input.touch.dash) { p.dash(); if (this.input.isTouch()) this.input.touch.dash = false; }
    } else {
      if (this.input.key('ArrowUp')) dy--; if (this.input.key('ArrowDown')) dy++; if (this.input.key('ArrowLeft')) dx--; if (this.input.key('ArrowRight')) dx++;
      const tgt = this.nearestEnemy(p); if (tgt) p.turret = Utils.angLerp(p.turret, Math.atan2(tgt.y - p.y, tgt.x - p.x), dt * 8); else if (Math.hypot(dx, dy) > 0.1) p.turret = Utils.angLerp(p.turret, Math.atan2(dy, dx), dt * 10);
      if (this.input.key('Numpad0')) p.shoot(this);
      if (this.input.key('ControlRight')) p.dash();
    }
    p.applyKnob(dx, dy, dt);
  }

  nearestEnemy(p) { let best = null, bd = Infinity; for (const e of this.enemies) { if (e.dead || e.spawning > 0) continue; const d = Utils.dist(p.x, p.y, e.x, e.y); if (d < bd) { bd = d; best = e; } } return best; }

  endGame(victory) {
    if (this.state === 'over') return; this.state = 'over'; this.running = false;
    if (victory) this.audio.victory(); else this.audio.defeat();
    const isNewBest = this.saveHighScore(this.mode, this.stats.score, this.stats.wave);
    const best = this.getHighScore(this.mode);
    // Coins earned this run are banked to the persistent wallet regardless
    // of win/loss, spendable later in the Garage.
    const wallet = this.loadWallet() + this.stats.coins;
    this.saveWallet(wallet);
    this.callbacks.onStateChange(this.state, this.mode, { victory, stats: this.stats, isNewBest, best, wallet });
  }

  /* ---------- Render ---------- */
  render() {
    this.ctx.clearRect(0, 0, this.W, this.H); this.ctx.fillStyle = this.map.theme.sky; this.ctx.fillRect(0, 0, this.W, this.H);
    if (this.state === 'menu') return;
    this.ctx.save(); let sx = 0, sy = 0;
    if (this.cam.shakeT > 0) { sx = Utils.rand(-this.cam.shakeMag, this.cam.shakeMag); sy = Utils.rand(-this.cam.shakeMag, this.cam.shakeMag); }
    this.ctx.scale(this.cam.zoom, this.cam.zoom); this.ctx.translate(-this.cam.x + sx, -this.cam.y + sy);
    this.drawMap();
    for (const pu of this.powerups) pu.draw(this.ctx);
    for (const e of this.enemies) if (e.ai) e.ai.drawSight(this.ctx);
    for (const s of this.spawners) s.draw(this.ctx);
    for (const e of this.enemies) e.draw(this.ctx, true, this.map);
    for (const p of this.players) p.draw(this.ctx, false, this.map);
    for (const b of this.bullets) b.draw(this.ctx);
    this.drawBushTops();
    this.particles.draw(this.ctx);
    if (this.state === 'tutorial' && this.tutorial) this.tutorial.draw(this.ctx, this.W, this.H, this.dpr);
    this.ctx.restore();
    this.drawMinimap();
  }

  roundR(x, y, w, h, r) { this.ctx.beginPath(); this.ctx.moveTo(x + r, y); this.ctx.arcTo(x + w, y, x + w, y + h, r); this.ctx.arcTo(x + w, y + h, x, y + h, r); this.ctx.arcTo(x, y + h, x, y, r); this.ctx.arcTo(x, y, x + w, y, r); this.ctx.closePath(); this.ctx.fill(); }

  drawMap() {
    const startX = Math.floor(this.cam.x / TILE), startY = Math.floor(this.cam.y / TILE);
    const endX = Math.ceil((this.cam.x + this.W / this.cam.zoom) / TILE), endY = Math.ceil((this.cam.y + this.H / this.cam.zoom) / TILE);
    const fa = this.map.theme.floorA, fb = this.map.theme.floorB;
    for (let y = Math.max(0, startY); y < Math.min(this.map.rows, endY); y++) for (let x = Math.max(0, startX); x < Math.min(this.map.cols, endX); x++) {
      const t = this.map.grid[y][x], px = x * TILE, py = y * TILE;
      this.ctx.fillStyle = ((x + y) % 2 === 0) ? fa : fb; this.ctx.fillRect(px, py, TILE, TILE); this.drawTile(t, px, py);
    }
  }

  drawTile(t, px, py) {
    switch (t) {
      case T.STEEL:
        this.ctx.fillStyle = '#5a6270'; this.roundR(px + 2, py + 2, TILE - 4, TILE - 4, 6);
        this.ctx.fillStyle = '#6f7888'; this.roundR(px + 5, py + 5, TILE - 14, TILE - 14, 4);
        this.ctx.fillStyle = '#3d434f'; for (const [bx, by] of [[8, 8], [TILE - 12, 8], [8, TILE - 12], [TILE - 12, TILE - 12]]) { this.ctx.beginPath(); this.ctx.arc(px + bx, py + by, 2.5, 0, Math.PI * 2); this.ctx.fill(); }
        break;
      case T.BRICK:
        this.ctx.fillStyle = '#a8542e'; this.roundR(px + 2, py + 2, TILE - 4, TILE - 4, 4);
        this.ctx.strokeStyle = '#7a3a1e'; this.ctx.lineWidth = 2; this.ctx.beginPath();
        this.ctx.moveTo(px + 2, py + TILE / 2); this.ctx.lineTo(px + TILE - 2, py + TILE / 2);
        this.ctx.moveTo(px + TILE / 2, py + 2); this.ctx.lineTo(px + TILE / 2, py + TILE / 2);
        this.ctx.moveTo(px + TILE / 4, py + TILE / 2); this.ctx.lineTo(px + TILE / 4, py + TILE - 2);
        this.ctx.moveTo(px + 3 * TILE / 4, py + TILE / 2); this.ctx.lineTo(px + 3 * TILE / 4, py + TILE - 2);
        this.ctx.stroke(); break;
      case T.CRATE:
        this.ctx.fillStyle = '#c9963f'; this.roundR(px + 4, py + 4, TILE - 8, TILE - 8, 4);
        this.ctx.strokeStyle = '#8a6420'; this.ctx.lineWidth = 3; this.ctx.strokeRect(px + 6, py + 6, TILE - 12, TILE - 12);
        this.ctx.beginPath(); this.ctx.moveTo(px + 6, py + 6); this.ctx.lineTo(px + TILE - 6, py + TILE - 6);
        this.ctx.moveTo(px + TILE - 6, py + 6); this.ctx.lineTo(px + 6, py + TILE - 6); this.ctx.stroke(); break;
      case T.WATER:
        this.ctx.fillStyle = '#2f7fbf'; this.ctx.fillRect(px, py, TILE, TILE);
        this.ctx.fillStyle = 'rgba(255,255,255,0.15)'; const w = Math.sin(performance.now() / 400 + px) * 3;
        this.ctx.fillRect(px + 4, py + TILE / 2 + w, TILE - 8, 3); this.ctx.fillRect(px + 8, py + TILE / 3 + w, TILE - 16, 2); break;
      case T.BARREL:
        this.ctx.fillStyle = 'rgba(0,0,0,0.25)'; this.ctx.beginPath(); this.ctx.ellipse(px + TILE / 2, py + TILE / 2 + 6, TILE / 3, TILE / 5, 0, 0, Math.PI * 2); this.ctx.fill();
        this.ctx.fillStyle = '#d94c2e'; this.roundR(px + 10, py + 6, TILE - 20, TILE - 12, 5);
        this.ctx.fillStyle = '#2a2a2a'; this.ctx.fillRect(px + 10, py + TILE / 2 - 2, TILE - 20, 4);
        this.ctx.fillStyle = '#ffdb4a'; this.ctx.font = '900 14px Arial'; this.ctx.textAlign = 'center'; this.ctx.textBaseline = 'middle'; this.ctx.fillText('!', px + TILE / 2, py + TILE / 2); break;
      case T.OIL:
        this.ctx.fillStyle = 'rgba(20,20,30,0.7)'; this.ctx.beginPath(); this.ctx.ellipse(px + TILE / 2, py + TILE / 2, TILE / 2.4, TILE / 3, 0, 0, Math.PI * 2); this.ctx.fill();
        this.ctx.fillStyle = 'rgba(90,70,120,0.4)'; this.ctx.beginPath(); this.ctx.ellipse(px + TILE / 2 - 4, py + TILE / 2 - 3, TILE / 5, TILE / 7, 0, 0, Math.PI * 2); this.ctx.fill(); break;
      case T.BUSH:
        this.ctx.fillStyle = '#1e5a2a'; this.ctx.beginPath(); this.ctx.arc(px + TILE / 2, py + TILE / 2, TILE / 2.3, 0, Math.PI * 2); this.ctx.fill(); break;
    }
  }

  drawBushTops() {
    // Cull to the visible tile range, same as drawMap() — previously this
    // walked the entire grid every frame regardless of camera position,
    // which gets expensive on larger maps.
    const startX = Math.floor(this.cam.x / TILE), startY = Math.floor(this.cam.y / TILE);
    const endX = Math.ceil((this.cam.x + this.W / this.cam.zoom) / TILE), endY = Math.ceil((this.cam.y + this.H / this.cam.zoom) / TILE);
    for (let y = Math.max(0, startY); y < Math.min(this.map.rows, endY); y++) for (let x = Math.max(0, startX); x < Math.min(this.map.cols, endX); x++) if (this.map.grid[y][x] === T.BUSH) {
      const px = x * TILE, py = y * TILE; this.ctx.globalAlpha = 0.85; this.ctx.fillStyle = '#2e7d3a';
      for (const [ox, oy, r] of [[TILE / 2, TILE / 2, 15], [TILE / 3, TILE / 2.5, 10], [2 * TILE / 3, TILE / 2.6, 10], [TILE / 2, 2 * TILE / 3, 11]]) { this.ctx.beginPath(); this.ctx.arc(px + ox, py + oy, r, 0, Math.PI * 2); this.ctx.fill(); }
      this.ctx.fillStyle = '#3d9a4a'; this.ctx.beginPath(); this.ctx.arc(px + TILE / 2 - 3, py + TILE / 2 - 3, 7, 0, Math.PI * 2); this.ctx.fill(); this.ctx.globalAlpha = 1;
    }
  }

  drawMinimap() {
    if (this.state === 'menu' || this.state === 'over') return;
    const mw = this.mmCanvas.width, mh = this.mmCanvas.height; this.mmCtx.clearRect(0, 0, mw, mh);
    const sx = mw / this.map.worldW(), sy = mh / this.map.worldH(); this.mmCtx.fillStyle = '#2a2418'; this.mmCtx.fillRect(0, 0, mw, mh);
    for (let y = 0; y < this.map.rows; y++) for (let x = 0; x < this.map.cols; x++) {
      const t = this.map.grid[y][x];
      if (t === T.STEEL) { this.mmCtx.fillStyle = '#6f7888'; this.mmCtx.fillRect(x * TILE * sx, y * TILE * sy, TILE * sx, TILE * sy); }
      else if (t === T.BRICK || t === T.CRATE) { this.mmCtx.fillStyle = '#a8542e'; this.mmCtx.fillRect(x * TILE * sx, y * TILE * sy, TILE * sx, TILE * sy); }
      else if (t === T.WATER) { this.mmCtx.fillStyle = '#2f7fbf'; this.mmCtx.fillRect(x * TILE * sx, y * TILE * sy, TILE * sx, TILE * sy); }
    }
    for (const pu of this.powerups) { this.mmCtx.fillStyle = pu.type.color; this.mmCtx.fillRect(pu.x * sx - 1, pu.y * sy - 1, 3, 3); }
    for (const s of this.spawners) { this.mmCtx.fillStyle = Math.sin(s.t * 12) > 0 ? '#ff4b4b' : '#772222'; this.mmCtx.beginPath(); this.mmCtx.arc(s.x * sx, s.y * sy, 2.5, 0, Math.PI * 2); this.mmCtx.fill(); }
    for (const e of this.enemies) { if (e.dead) continue; this.mmCtx.fillStyle = e.isBoss ? '#c86bff' : '#ff4b4b'; this.mmCtx.beginPath(); this.mmCtx.arc(e.x * sx, e.y * sy, e.isBoss ? 4 : 2.5, 0, Math.PI * 2); this.mmCtx.fill(); }
    for (const p of this.players) { if (p.dead) continue; this.mmCtx.fillStyle = p.team === 'p2' ? '#5aa8ff' : '#5be36a'; this.mmCtx.beginPath(); this.mmCtx.arc(p.x * sx, p.y * sy, 3, 0, Math.PI * 2); this.mmCtx.fill(); }
    this.mmCtx.strokeStyle = 'rgba(255,255,255,0.4)'; this.mmCtx.lineWidth = 1; this.mmCtx.strokeRect(this.cam.x * sx, this.cam.y * sy, (this.W / this.cam.zoom) * sx, (this.H / this.cam.zoom) * sy);
  }

  loop(ts) {
    const dt = Math.min(0.033, (ts - this.last) / 1000 || 0); this.last = ts;
    if (this.running && (this.state === 'play' || this.state === 'tutorial')) this.update(dt);
    this.render();
    requestAnimationFrame(this._boundLoop);
  }

  pause() { if (this.state === 'play') { this.state = 'pause'; this.running = false; this.callbacks.onStateChange(this.state); } }
  resume() { if (this.state === 'pause') { this.state = 'play'; this.running = true; this.last = performance.now(); this.callbacks.onStateChange(this.state); } }
  restart() { this.start(this.mode, this.difficulty); }
  quit() { this.running = false; this.state = 'menu'; this.callbacks.onStateChange(this.state); }

  /* ---------- Tutorial ---------- */
  startTutorial() {
    this.audio.init(); this.audio.resume(); this.mode = 'tutorial';
    this.map.generate(15, 11, 'arena');
    for (let y = 3; y < 8; y++) this.map.grid[y][8] = T.STEEL;
    this.players = []; const p = new Tank(3 * TILE, 5 * TILE, { color: '#6bd35a', turretColor: '#4fae42', team: 'player', maxHp: 100 }); this.players.push(p);
    this.enemies = []; this.bullets = []; this.powerups = []; this.spawners = []; this.particles.clear();
    this.stats = { kills: 0, coins: 0, score: 0, wave: 1, lives: 99, p2lives: 0, time: 0 };
    this.tutorial = new Tutorial(this); this.state = 'tutorial'; this.running = true;
    this.callbacks.onStateChange(this.state); this.last = performance.now();
  }

  setSetting(k, v) { this.settings[k] = v; if (k === 'sound') this.audio.setEnabled(v); if (k === 'particles') this.particles.setEnabled(v); this.saveSettings(); }
  getSettings() { return this.settings; }

  /* ---------- Persistence (localStorage) ---------- */
  loadSettings() {
    const defaults = { sound: true, shake: true, particles: true };
    try {
      const raw = localStorage.getItem('tankBlitz.settings');
      if (raw) return { ...defaults, ...JSON.parse(raw) };
    } catch (e) { /* localStorage unavailable (private mode, SSR, etc.) — fall back to defaults */ }
    return defaults;
  }

  saveSettings() {
    try { localStorage.setItem('tankBlitz.settings', JSON.stringify(this.settings)); } catch (e) { /* ignore write failures */ }
  }

  getHighScore(mode) {
    try {
      const raw = localStorage.getItem('tankBlitz.highscores');
      const all = raw ? JSON.parse(raw) : {};
      return all[mode] || { score: 0, wave: 0 };
    } catch (e) { return { score: 0, wave: 0 }; }
  }

  /** Persists a new best if `score` beats the stored one for `mode`. Returns whether it was a new best. */
  saveHighScore(mode, score, wave) {
    try {
      const raw = localStorage.getItem('tankBlitz.highscores');
      const all = raw ? JSON.parse(raw) : {};
      const cur = all[mode] || { score: 0, wave: 0 };
      const isNew = score > cur.score;
      if (isNew) { all[mode] = { score, wave }; localStorage.setItem('tankBlitz.highscores', JSON.stringify(all)); }
      return isNew;
    } catch (e) { return false; }
  }

  /* ---------- Garage: coin wallet + upgrades (single-player only) ---------- */

  loadWallet() {
    try { return parseInt(localStorage.getItem('tankBlitz.wallet'), 10) || 0; } catch (e) { return 0; }
  }

  saveWallet(v) {
    try { localStorage.setItem('tankBlitz.wallet', String(Math.max(0, v))); } catch (e) { /* ignore write failures */ }
  }

  loadUpgrades() {
    try {
      const raw = localStorage.getItem('tankBlitz.upgrades');
      if (raw) return { ...UPGRADE_DEFAULTS, ...JSON.parse(raw) };
    } catch (e) { /* localStorage unavailable — fall back to defaults */ }
    return { ...UPGRADE_DEFAULTS };
  }

  saveUpgrades(u) {
    try { localStorage.setItem('tankBlitz.upgrades', JSON.stringify(u)); } catch (e) { /* ignore write failures */ }
  }

  // Translates purchased upgrade levels into the stat bundle applied to the
  // player's tank(s) at buildLevel() time.
  getUpgradedStats() {
    const u = this.loadUpgrades();
    return {
      maxHp: 100 + u.armor * 10,
      maxSpeed: 150 + u.engine * 8,
      dmgMult: 1 + u.firepower * 0.08,
      reloadMult: Math.max(0.4, 1 - u.reload * 0.06),
    };
  }

  /** Attempts to spend coins to raise one upgrade track by a level. Returns { ok, reason?, upgrades, wallet }. */
  purchaseUpgrade(trackKey) {
    const track = UPGRADE_TRACKS.find((t) => t.key === trackKey);
    const upgrades = this.loadUpgrades();
    const wallet = this.loadWallet();
    if (!track) return { ok: false, reason: 'unknown', upgrades, wallet };
    const level = upgrades[trackKey] || 0;
    if (level >= track.maxLevel) return { ok: false, reason: 'maxed', upgrades, wallet };
    const cost = upgradeCost(track, level);
    if (wallet < cost) return { ok: false, reason: 'funds', upgrades, wallet };
    upgrades[trackKey] = level + 1;
    this.saveUpgrades(upgrades);
    this.saveWallet(wallet - cost);
    return { ok: true, upgrades, wallet: wallet - cost };
  }
}

class Tutorial {
  constructor(game) { this.game = game; this.step = 0; this.timer = 0;
    this.steps = [
      { txt: 'Use WASD (or joystick) to MOVE', check: () => Math.hypot(game.players[0].vx, game.players[0].vy) > 40, hold: 1 },
      { txt: 'Move your MOUSE to AIM the turret', check: () => true, hold: 2 },
      { txt: 'LEFT CLICK / FIRE to SHOOT', check: () => game.bullets.length > 0, hold: 0.5 },
      { txt: 'Bullets RICOCHET off steel! Bank a shot off the wall', check: () => game.bullets.some(b => b.bounces < 3), hold: 0.5 },
      { txt: 'Grab the POWER-UP!', setup: () => { game.powerups.push(new PowerUp(11 * TILE, 5 * TILE, PU_TYPES[0])); }, check: () => game.powerups.length === 0, hold: 0.5 },
      { txt: 'Destroy the ENEMY tank!', setup: () => { const e = new Tank(11 * TILE, 5 * TILE, { color: '#e05a5a', team: 'enemy', maxHp: 40, enemyType: 'scout', name: 'TARGET' }); e.radius = 15; e.ai = new EnemyAI(e, 'scout', DIFF.easy); game.enemies.push(e); }, check: () => game.enemies.length === 0, hold: 0.5 },
      { txt: 'You are ready! Tutorial complete', check: () => true, hold: 2.5 }
    ];
    this.applySetup();
  }
  applySetup() { const s = this.steps[this.step]; if (s && s.setup) s.setup(); }
  update(dt) { const s = this.steps[this.step]; if (!s) return; if (s.check()) { this.timer += dt; if (this.timer >= s.hold) { this.timer = 0; this.step++; if (this.step >= this.steps.length) { this.finish(); return; } this.applySetup(); this.game.audio.pickup(); } } }
  finish() { this.game.running = false; this.game.state = 'menu'; this.game.callbacks.onStateChange(this.game.state); this.game.callbacks.onToast('TUTORIAL DONE!'); }
  draw(c, W, H, dpr) { const s = this.steps[this.step]; if (!s) return; c.save(); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = 'rgba(20,26,42,0.92)'; const bw = Math.min(560, W - 40), bh = 64, bx = W / 2 - bw / 2, by = 70;
    c.beginPath(); c.moveTo(bx + 16, by); c.arcTo(bx + bw, by, bx + bw, by + bh, 16); c.arcTo(bx + bw, by + bh, bx, by + bh, 16); c.arcTo(bx, by + bh, bx, by, 16); c.arcTo(bx, by, bx + bw, by, 16); c.closePath(); c.fill();
    c.fillStyle = '#ffd54a'; c.font = '700 19px Segoe UI'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('Step ' + (this.step + 1) + '/' + this.steps.length + ': ' + s.txt, W / 2, by + bh / 2); c.restore();
  }
}
