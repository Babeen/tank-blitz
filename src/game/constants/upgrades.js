// Persistent garage upgrades, purchased with coins banked from single-player
// runs (see GameEngine.endGame / purchaseUpgrade). Multiplayer intentionally
// ignores these — every player starts on equal footing there.
export const UPGRADE_TRACKS = [
  { key: 'armor',     label: 'ARMOR',     desc: '+10 Max HP per level',   maxLevel: 5, baseCost: 60, costStep: 40 },
  { key: 'engine',    label: 'ENGINE',    desc: '+8 Speed per level',     maxLevel: 5, baseCost: 60, costStep: 40 },
  { key: 'firepower', label: 'FIREPOWER', desc: '+8% Damage per level',   maxLevel: 5, baseCost: 80, costStep: 50 },
  { key: 'reload',    label: 'RELOAD',    desc: '-6% Cooldown per level', maxLevel: 5, baseCost: 80, costStep: 50 },
];

export const UPGRADE_DEFAULTS = { armor: 0, engine: 0, firepower: 0, reload: 0 };

// Cost to go from `level` to `level + 1` on a given track.
export function upgradeCost(track, level) {
  return track.baseCost + level * track.costStep;
}
