// Gameplay constants shared between server simulation and client rendering.
// Mirrors src/game/constants/index.js values that the server needs.
// The single-player constants/index.js is NOT modified.

export const TILE = 48;

export const T = {
  EMPTY: 0, BRICK: 1, STEEL: 2, CRATE: 3, BUSH: 4, WATER: 5, BARREL: 6, OIL: 7
};

export const WEAPONS = {
  cannon:    { cd: 0.42, dmg: 26, speed: 440,  spread: 0,    pellets: 1, bounces: 3, color: '#ffe14a', ammo: Infinity },
  machinegun:{ cd: 0.10, dmg: 10, speed: 540,  spread: 0.10, pellets: 1, bounces: 1, color: '#9fd8ff', ammo: 140 },
  shotgun:   { cd: 0.70, dmg: 12, speed: 400,  spread: 0.34, pellets: 7, bounces: 1, color: '#ffb14a', ammo: 24 },
  rocket:    { cd: 0.90, dmg: 60, speed: 340,  spread: 0,    pellets: 1, bounces: 0, color: '#ff5a3c', ammo: 8,  rocket: true, explosive: true },
  laser:     { cd: 0.26, dmg: 22, speed: 900,  spread: 0,    pellets: 1, bounces: 2, color: '#ff5ad0', ammo: 44, laser: true },
  railgun:   { cd: 1.05, dmg: 90, speed: 1600, spread: 0,    pellets: 1, bounces: 0, color: '#7ce8ff', ammo: 6,  rail: true },
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
  { id: 'shotgun', label: 'SG',   color: '#ffb14a' },
  { id: 'laser',   label: 'LSR',  color: '#ff5ad0' },
  { id: 'mg',      label: 'MG',   color: '#9fd8ff' },
  { id: 'railgun', label: 'RAIL', color: '#7ce8ff' },
];

export const PLAYER = {
  RADIUS: 17,
  MAX_HP: 100,
  MAX_SPEED: 150,
  TURN_LERP_RATE: 10,
  ACCEL_LERP_RATE: 6,
  DECEL_LERP_RATE: 8,
  VELOCITY_GRIP: 0.35,
  DASH_CD: 1.4,
  DASH_DURATION: 0.16,
  DASH_SPEED_MUL: 3.4,
  RESPAWN_DELAY: 2000,
  RESPAWN_SHIELD: 30,
  RESPAWN_SPAWNING: 0.8,
};

export const POWERUP = {
  RADIUS: 15,
  LIFE: 18,
  SPAWN_INTERVAL: 8,   // seconds between server powerup spawns
  MAX_ON_MAP: 4,
};
