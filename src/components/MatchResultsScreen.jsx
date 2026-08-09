import React from 'react';

export default function MatchResultsScreen({ result, you, isHost, rematchReady, onRematch, onReturnToLobby, onExit }) {
  if (!result) return null;
  const { winnerId, winnerName, reason, standings = [] } = result;
  const isDraw = reason === 'draw' || !winnerId;
  const youWon = !isDraw && winnerId === you?.id;

  const readyIds = new Set(rematchReady?.ready || []);
  const iAmReady = you && readyIds.has(you.id);
  const readyCount = readyIds.size;
  const totalCount = rematchReady?.total ?? standings.length;

  return (
    <div className="screen" id="mpResultsScreen">
      <div className="title" style={{ color: isDraw ? '#9fb3d1' : '#ffd54a', fontSize: 'clamp(22px,5vw,40px)' }}>
        MATCH {isDraw ? 'DRAW' : 'OVER'}
      </div>
      {!isDraw && (
        <div className="subtitle" style={{ color: youWon ? '#6bd35a' : '#ff6b6b', letterSpacing: 1 }}>
          {youWon ? 'VICTORY' : `${winnerName || 'Opponent'} wins`}
        </div>
      )}

      <div className="panel">
        <h2>STANDINGS</h2>
        <ul style={{ listStyle: 'none', marginLeft: 0, minWidth: 260 }}>
          {standings.map((s) => (
            <li key={s.playerId} style={{ display: 'flex', justifyContent: 'space-between', gap: 18, padding: '4px 0' }}>
              <span>
                #{s.rank} {s.name}
                {s.playerId === you?.id && <span style={{ color: '#9fb3d1', fontSize: 12 }}>&nbsp;(YOU)</span>}
              </span>
              <span style={{ color: '#ffd54a' }}>{s.kills} / {s.deaths}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="diff-desc">
        {readyCount}/{totalCount} ready for rematch
      </div>

      <button className={`btn ${iAmReady ? '' : 'primary'}`} onClick={onRematch} disabled={iAmReady}>
        {iAmReady ? 'WAITING FOR OTHERS…' : 'REMATCH'}
      </button>
      {isHost && <button className="btn purple" onClick={onReturnToLobby}>RETURN TO LOBBY</button>}
      <button className="btn small red" onClick={onExit}>EXIT</button>
    </div>
  );
}
