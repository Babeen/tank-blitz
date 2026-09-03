import React from 'react';
import Screen from './Screen';

export default function MenuScreen({ onPlay, onSurvival, on2P, onOnline, onGarage, onHow, onSettings, onCredits }) {
  return (
    <Screen id="menu">
      <div className="title">TANK ARENA</div>
      <div className="subtitle">B L I T Z</div>
      <button className="btn primary" onClick={onPlay}>BATTLE</button>
      <button className="btn green" onClick={onSurvival}>SURVIVAL</button>
      <button className="btn purple" onClick={on2P}>2 PLAYER</button>
      <button className="btn" onClick={onOnline}>ONLINE MULTIPLAYER</button>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={onGarage}>GARAGE</button>
        <button className="btn small" onClick={onHow}>HOW TO PLAY</button>
        <button className="btn small" onClick={onSettings}>SETTINGS</button>
        <button className="btn small" onClick={onCredits}>CREDITS</button>
      </div>
    </Screen>
  );
}
