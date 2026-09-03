import React from 'react';
import { UPGRADE_TRACKS, upgradeCost } from '../game/constants/upgrades.js';
import Screen from './Screen';

export default function GarageScreen({ wallet, upgrades, onPurchase, onBack }) {
  return (
    <Screen id="garageScreen">
      <div className="title" style={{ fontSize: 'clamp(28px,6vw,54px)' }}>GARAGE</div>
      <p style={{ marginBottom: 14 }}>Wallet: <b>{wallet}</b> coins</p>
      <p className="diff-desc" style={{ marginBottom: 14 }}>
        Upgrades apply to your tank in Battle, Survival, and 2 Player — online matches stay unmodified so every player is on equal footing.
      </p>

      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 420 }}>
        {UPGRADE_TRACKS.map((track) => {
          const level = upgrades?.[track.key] || 0;
          const maxed = level >= track.maxLevel;
          const cost = maxed ? null : upgradeCost(track, level);
          const canAfford = !maxed && wallet >= cost;
          return (
            <div key={track.key} style={{ textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <b>{track.label}</b>
                <span style={{ fontSize: 12, opacity: 0.8 }}>Lv {level}/{track.maxLevel}</span>
              </div>
              <div style={{ display: 'flex', gap: 4, margin: '4px 0' }}>
                {Array.from({ length: track.maxLevel }).map((_, i) => (
                  <div key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: i < level ? '#4bd07a' : 'rgba(255,255,255,0.15)' }} />
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, opacity: 0.75 }}>{track.desc}</span>
                <button
                  className={canAfford ? 'btn small primary' : 'btn small'}
                  disabled={maxed || !canAfford}
                  onClick={() => onPurchase(track.key)}
                >
                  {maxed ? 'MAXED' : `${cost} coins`}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button className="btn" style={{ marginTop: 16 }} onClick={onBack}>BACK</button>
    </Screen>
  );
}
