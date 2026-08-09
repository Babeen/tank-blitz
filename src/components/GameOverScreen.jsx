import React from 'react';

export default function GameOverScreen({ result, onAgain, onMenu }) {
  if (!result) return null;
  const { victory, stats } = result;
  const label = stats.mode === 'battle' ? 'Level' : 'Wave';
  return (
    <div className="screen" id="endScreen">
      <div className="title" style={{ color: victory ? '#ffd54a' : '#ff6b6b' }}>{victory ? 'VICTORY!' : 'GAME OVER'}</div>
      <div className="stats">
        <div>Kills: <b>{stats.kills}</b></div>
        <div>Score: <b>{stats.score}</b></div>
        <div>Coins: <b>{stats.coins}</b></div>
        <div>{label}: <b>{stats.wave}</b></div>
        <div>Time: <b>{Math.floor(stats.time)}s</b></div>
      </div>
      <div className="row">
        <button className="btn primary" onClick={onAgain}>PLAY AGAIN</button>
        <button className="btn" onClick={onMenu}>MENU</button>
      </div>
    </div>
  );
}
