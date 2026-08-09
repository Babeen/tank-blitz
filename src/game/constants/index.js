export const TILE = 48;

export const T = {
  EMPTY: 0, BRICK: 1, STEEL: 2, CRATE: 3, BUSH: 4, WATER: 5, BARREL: 6, OIL: 7
};

export const THEMES = {
  city:   { name: 'City',    floorA: '#4a4a52', floorB: '#43434b', wall: T.STEEL, brick: T.BRICK, sky: '#2e2e36' },
  forest: { name: 'Forest',  floorA: '#3f5a34', floorB: '#395230', wall: T.BRICK, brick: T.BUSH,  sky: '#25341f' },
  factory:{ name: 'Factory', floorA: '#4a4436', floorB: '#443f32', wall: T.STEEL, brick: T.CRATE, sky: '#332e22' },
  desert: { name: 'Desert',  floorA: '#b8975a', floorB: '#ad8d52', wall: T.CRATE, brick: T.BRICK, sky: '#8a6f3e' },
  maze:   { name: 'Maze',    floorA: '#3a3a45', floorB: '#34343f', wall: T.STEEL, brick: T.STEEL, sky: '#22222c' },
  arena:  { name: 'Arena',   floorA: '#3a3226', floorB: '#453b2c', wall: T.STEEL, brick: T.BRICK, sky: '#3a3226' }
};

export const WEAPONS = {
  cannon:    { name: 'Cannon',       icon: 'C', cd: 0.42, dmg: 26, speed: 440,  spread: 0,    pellets: 1, bounces: 3, color: '#ffe14a', ammo: Infinity, sound: 'shoot' },
  machinegun:{ name: 'Machine Gun',  icon: 'M', cd: 0.10, dmg: 10, speed: 540,  spread: 0.10, pellets: 1, bounces: 1, color: '#9fd8ff', ammo: 140,        sound: 'machinegun' },
  shotgun:   { name: 'Shotgun',      icon: 'S', cd: 0.70, dmg: 12, speed: 400,  spread: 0.34, pellets: 7, bounces: 1, color: '#ffb14a', ammo: 24,         sound: 'shotgun' },
  rocket:    { name: 'Rocket',       icon: 'R', cd: 0.90, dmg: 60, speed: 340,  spread: 0,    pellets: 1, bounces: 0, color: '#ff5a3c', ammo: 8,          sound: 'rocket', rocket: true, explosive: true },
  laser:     { name: 'Laser',        icon: 'L', cd: 0.26, dmg: 22, speed: 900,  spread: 0,    pellets: 1, bounces: 2, color: '#ff5ad0', ammo: 44,         sound: 'laser',  laser: true },
  railgun:   { name: 'Railgun',      icon: 'X', cd: 1.05, dmg: 90, speed: 1600, spread: 0,    pellets: 1, bounces: 0, color: '#7ce8ff', ammo: 6,          sound: 'railgun', rail: true }
};

export const ENEMY_TYPES = {
  scout:   { maxHp: 40,  maxSpeed: 210, color: '#e05a5a', turretColor: '#b83c3c', radius: 14, fireCd: 1.2, range: 260, score: 100, name: 'SCOUT',    behavior: 'circle',   accurate: false },
  soldier: { maxHp: 80,  maxSpeed: 130, color: '#d94c4c', turretColor: '#a83333', radius: 17, fireCd: 1.1, range: 340, score: 150, name: 'SOLDIER',  behavior: 'balanced', accurate: false },
  heavy:   { maxHp: 200, maxSpeed: 72,  color: '#b03030', turretColor: '#7a1f1f', radius: 22, fireCd: 1.7, range: 300, score: 250, name: 'HEAVY',    behavior: 'tank',     accurate: false, dmgMul: 2.2, noDodge: true },
  sniper:  { maxHp: 55,  maxSpeed: 95,  color: '#c74d8a', turretColor: '#9a2e63', radius: 16, fireCd: 2.4, range: 620, score: 220, name: 'SNIPER',   behavior: 'snipe',    accurate: true,  charge: 0.9 },
  boss:    { maxHp: 1000,maxSpeed: 70,  color: '#8a2be2', turretColor: '#5a1a9a', radius: 34, fireCd: 1.2, range: 520, score: 1500,name: 'BOSS',     behavior: 'boss',     accurate: false, isBoss: true }
};

export const PU_TYPES = [
  { id: 'repair',  label: '+HP',  color: '#ff5b5b' },
  { id: 'speed',   label: 'SPD',  color: '#ffcf3f' },
  { id: 'shield',  label: 'SHLD', color: '#5aa8ff' },
  { id: 'rapid',   label: 'RPD',  color: '#ff8c1a' },
  { id: 'triple',  label: 'x3',   color: '#ff6bd0' },
  { id: 'freeze',  label: 'ICE',  color: '#9fe8ff' },
  { id: 'rocket',  label: 'RKT',  color: '#ff5a3c' },
  { id: 'magnet',  label: 'MAG',  color: '#b06bff' },
  { id: 'multi',   label: 'x2',   color: '#ffd54a' },
  { id: 'shotgun', label: 'SG',   color: '#ffb14a' },
  { id: 'laser',   label: 'LSR',  color: '#ff5ad0' },
  { id: 'mg',      label: 'MG',   color: '#9fd8ff' },
  { id: 'railgun', label: 'RAIL', color: '#7ce8ff' }
];

export const DIFF = {
  easy: {
    label: 'Slow, inaccurate enemies · weak bullets · small waves · frequent health drops. Forgiving.',
    hpMul: 0.8, dmgMul: 0.65, react: 1.0, aimJitter: 0.55, bulletSpeed: 0.75, dodge: 0.12,
    waveSize: 3, waveGrowth: 0.5, healthChance: 0.45, bossLevel: 5, dropRate: 0.42
  },
  normal: {
    label: 'Balanced AI · moderate reactions & accuracy · standard waves and drops.',
    hpMul: 1.0, dmgMul: 1.0, react: 0.45, aimJitter: 0.22, bulletSpeed: 1.0, dodge: 0.35,
    waveSize: 4, waveGrowth: 0.8, healthChance: 0.3, bossLevel: 5, dropRate: 0.34
  },
  hard: {
    label: 'Fast reactions · sharp aim · aggressive flanking & dodging · fast bullets · large waves · rare health.',
    hpMul: 1.35, dmgMul: 1.3, react: 0.18, aimJitter: 0.06, bulletSpeed: 1.3, dodge: 0.75,
    waveSize: 6, waveGrowth: 1.1, healthChance: 0.15, bossLevel: 4, dropRate: 0.26
  }
};

export const LEVELS = [
  { theme: 'city',    types: ['scout'],                                    note: 'Scouts only' },
  { theme: 'city',    types: ['scout', 'soldier'],                         note: 'Soldiers join' },
  { theme: 'forest',  types: ['scout', 'soldier', 'soldier'],              note: 'Mobile enemies' },
  { theme: 'factory', types: ['soldier', 'heavy'],                         note: 'Heavy Tank' },
  { theme: 'factory', types: ['soldier', 'heavy'],  miniBoss: true,        note: 'Mini Boss' },
  { theme: 'desert',  types: ['soldier', 'sniper', 'scout'],               note: 'Snipers' },
  { theme: 'maze',    types: ['scout', 'soldier', 'sniper'],               note: 'New layout: Maze' },
  { theme: 'factory', types: ['soldier', 'heavy', 'scout'], barrels: true, note: 'Explosive Factory' },
  { theme: 'city',    types: ['scout', 'soldier', 'heavy', 'sniper'],      note: 'Mixed forces' },
  { theme: 'arena',   types: ['soldier', 'heavy', 'sniper'], boss: true,   note: 'MAJOR BOSS' }
];
