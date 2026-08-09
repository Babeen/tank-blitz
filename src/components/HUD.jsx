import React from 'react';
import { WEAPONS } from '../game/constants/index.js';

export default function HUD({ data, boss, onPause }) {
  const { stats, players, combo, mode } = data;
  const p1 = players[0];
  const p2 = players[1];
  const w = p1 ? WEAPONS[p1.weapon] : WEAPONS.cannon;

  const chips = [];
  if (p1) {
    if (p1.shield > 0) chips.push(['SHLD', Math.ceil(p1.shield)]);
    if (p1.speedBoost > 0) chips.push(['SPD', Math.ceil(p1.speedBoost)]);
    if (p1.rapidFire > 0) chips.push(['RPD', Math.ceil(p1.rapidFire)]);
    if (p1.tripleShot > 0) chips.push(['x3', Math.ceil(p1.tripleShot)]);
    if (p1.scoreMultTime > 0) chips.push(['2X', Math.ceil(p1.scoreMultTime)]);
    if (p1.coinMagnet > 0) chips.push(['MAG', Math.ceil(p1.coinMagnet)]);
    if (p1.dashCd > 0) chips.push(['DASH', p1.dashCd.toFixed(1)]);
  }

  return (
    <div id="hud">
      <div className="hud-top">
        <div className="hud-chip">K <span>{stats.kills ?? 0}</span></div>
        <div className="hud-center">
          <div className="hud-chip">LV <span>{stats.wave ?? 1}</span></div>
          <div className="hud-chip">PTS <span>{stats.score ?? 0}</span></div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="hud-chip"><span className="icon-coin">$</span> <span>{stats.coins ?? 0}</span></div>
          <div className="hud-chip" id="pauseBtn" onClick={onPause}>II</div>
        </div>
      </div>

      {combo > 1 && <div id="comboChip" style={{ display: 'block' }}>x{combo} COMBO</div>}

      {boss && !boss.dead && (
        <div id="bossBar" style={{ display: 'block' }}>
          <div className="barlabel"><span>{boss.name || 'BOSS'}</span></div>
          <div className="bar"><div className="bfill" style={{ width: Math.max(0, boss.hp / boss.maxHp * 100) + '%' }} /></div>
        </div>
      )}

      <div id="healthWrap">
        <div className="barlabel"><span>P1  L<span>{stats.lives ?? 3}</span></span><span>{p1 ? Math.max(0, Math.round(p1.hp)) : 0}</span></div>
        <div className="bar"><div className="hp-fill" id="hpFill" style={{ width: (p1 ? Math.max(0, p1.hp / p1.maxHp * 100) : 0) + '%' }} /></div>
      </div>

      {p2 && (
        <div id="p2HealthWrap" className="p2" style={{ display: 'block' }}>
          <div className="barlabel"><span>P2  L<span>{stats.p2lives ?? 3}</span></span><span>{Math.max(0, Math.round(p2.hp))}</span></div>
          <div className="bar"><div className="hp-fill" id="p2hpFill" style={{ width: Math.max(0, p2.hp / p2.maxHp * 100) + '%' }} /></div>
        </div>
      )}

      <div className="hud-chip" id="weaponChip">
        <span>{w.icon}</span> <span>{w.name}</span> <span>{(p1 && p1.ammo[p1.weapon] !== Infinity && p1.weapon !== 'cannon') ? `(${p1.ammo[p1.weapon] || 0})` : ''}</span>
      </div>

      <div id="powerbar">
        {chips.map(([icon, val]) => (
          <div className="pchip" key={icon}>{icon} {val}</div>
        ))}
      </div>
    </div>
  );
}
