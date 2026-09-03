import React, { useState } from 'react';
import Screen from './Screen';

export default function MultiplayerScreen({ onCreateRoom, onJoinRoom, onBack, connecting, error, onRetry, canRetry }) {
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');

  const submitJoin = () => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4 || connecting) return;
    onJoinRoom(trimmed);
  };

  return (
    <Screen id="multiplayerScreen">
      <div className="title" style={{ fontSize: 'clamp(28px,6vw,54px)' }}>ONLINE MULTIPLAYER</div>

      {!joining ? (
        <>
          <button className="btn primary" onClick={onCreateRoom} disabled={connecting}>CREATE ROOM</button>
          <button className="btn purple" onClick={() => setJoining(true)} disabled={connecting}>JOIN ROOM</button>
          <button className="btn small" onClick={onBack}>BACK</button>
        </>
      ) : (
        <div className="panel">
          <h2>JOIN ROOM</h2>
          <input
            className="room-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
            onKeyDown={(e) => { if (e.key === 'Enter') submitJoin(); }}
            placeholder="ROOM CODE"
            autoFocus
            maxLength={6}
          />
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn green" onClick={submitJoin} disabled={connecting || code.trim().length < 4}>JOIN</button>
            <button className="btn small" onClick={() => { setJoining(false); setCode(''); }}>CANCEL</button>
          </div>
        </div>
      )}

      {connecting && <div className="diff-desc">Connecting…</div>}
      {error && (
        <>
          <div className="diff-desc" style={{ color: '#ff6b6b' }}>{error}</div>
          {!connecting && canRetry && (
            <button className="btn small" onClick={onRetry}>RETRY</button>
          )}
        </>
      )}
    </Screen>
  );
}
