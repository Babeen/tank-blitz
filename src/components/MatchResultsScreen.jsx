import React from 'react';
import Screen from './Screen';

export default function MatchResultsScreen({ result, you, isHost, rematchReady, onRematch, onReturnToLobby, onExit }) {
  if (!result) return null;
  const { winnerId, winnerName, winnerTeam, teamScores, reason, standings = [] } = result;
  const isDraw = reason === 'draw' || (!winnerId && !winnerTeam);
  const youTeam = standings.find((s) => s.playerId === you?.id)?.team;
  const youWon = !isDraw && (winnerTeam ? youTeam === winnerTeam : winnerId === you?.id);

  const readyIds = new Set(rematchReady?.ready || []);
  const iAmReady = you && readyIds.has(you.id);
  const readyCount = readyIds.size;
  const totalCount = rematchReady?.total ?? standings.length;

  return (
    <Screen id="mpResultsScreen">
      <div className="title" style={{ color: isDraw ? '#9fb3d1' : '#ffd54a', fontSize: 'clamp(22px,5vw,40px)' }}>
        MATCH {isDraw ? 'DRAW' : 'OVER'}
      </div>
      {!isDraw && (
        <div className="subtitle" style={{ color: youWon ? '#6bd35a' : '#ff6b6b', letterSpacing: 1 }}>
          {youWon ? 'VICTORY' : winnerTeam ? `${winnerName} wins` : `${winnerName || 'Opponent'} wins`}
        </div>
      )}
      {teamScores && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 'clamp(20px,5vw,32px)', fontWeight: 800, margin: '4px 0 10px' }}>
          <span style={{ color: '#ff5a5a' }}>{teamScores.red}</span>
          <span style={{ color: '#9fb3d1', fontSize: 16 }}>—</span>
          <span style={{ color: '#5aa8ff' }}>{teamScores.blue}</span>
        </div>
      )}

      <div className="panel">
        <h2>STANDINGS</h2>
        <ul style={{ listStyle: 'none', marginLeft: 0, minWidth: 260 }}>
          {standings.map((s) => (
            <li key={s.playerId} style={{ display: 'flex', justifyContent: 'space-between', gap: 18, padding: '4px 0' }}>
              <span style={{ color: s.team === 'red' ? '#ff5a5a' : s.team === 'blue' ? '#5aa8ff' : undefined }}>
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
    </Screen>
  );
}
