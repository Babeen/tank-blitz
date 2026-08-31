import React from 'react';

export default function LobbyScreen({ roomCode, players, you, onStart, onLeave, error, connState, maps, mapId, onSetMap }) {
  // Part 26 — never allow starting a match while the connection is
  // unavailable; the host would just get a silently-dropped request.
  const connOk = connState === 'connected';
  const canStart = !!you?.isHost && players.length >= 2 && connOk;
  const selectedMap = maps?.find((m) => m.id === mapId);

  return (
    <div className="screen" id="lobbyScreen">
      <div className="title" style={{ fontSize: 'clamp(28px,6vw,54px)' }}>LOBBY</div>

      <div className="panel">
        <h2>ROOM CODE: {roomCode}</h2>
        <p style={{ marginBottom: 10 }}>PLAYERS {players.length}/4</p>
        <ul style={{ listStyle: 'none', marginLeft: 0 }}>
          {players.map((p) => (
            <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
              <span style={{ color: '#4bd07a' }}>●</span>
              <span>{p.name}</span>
              {p.isHost && <span style={{ color: '#ffd54a', fontSize: 12 }}>&nbsp;(HOST)</span>}
              {p.id === you?.id && <span style={{ color: '#9fb3d1', fontSize: 12 }}>&nbsp;(YOU)</span>}
            </li>
          ))}
        </ul>
      </div>

      {maps && maps.length > 0 && (
        <div className="panel">
          <p style={{ marginBottom: 10 }}>MAP</p>
          {you?.isHost ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {maps.map((m) => (
                <button
                  key={m.id}
                  className={m.id === mapId ? 'btn small primary' : 'btn small'}
                  onClick={() => onSetMap?.(m.id)}
                  disabled={!connOk}
                >
                  {m.name}
                  <span style={{ display: 'block', fontSize: 10, opacity: 0.75 }}>{m.cols}×{m.rows}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="diff-desc">{selectedMap ? selectedMap.name : 'Waiting for host…'}</div>
          )}
        </div>
      )}

      {error && <div className="diff-desc" style={{ color: '#ff6b6b' }}>{error}</div>}
      {!connOk && <div className="diff-desc" style={{ color: '#ffcf3f' }}>{connState === 'reconnecting' ? 'Reconnecting…' : 'Connection unavailable — waiting to reconnect…'}</div>}

      {you?.isHost ? (
        <button className="btn primary" onClick={onStart} disabled={!canStart}>START MATCH</button>
      ) : (
        <div className="diff-desc">Waiting for host to start…</div>
      )}

      <button className="btn small red" onClick={onLeave}>LEAVE ROOM</button>
    </div>
  );
}
