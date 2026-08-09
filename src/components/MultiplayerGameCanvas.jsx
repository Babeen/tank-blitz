import React, { useEffect, useRef, useState } from 'react';
import { MultiplayerRenderer } from '../game/multiplayer/MultiplayerRenderer.js';
import { MultiplayerInputController } from '../game/multiplayer/MultiplayerInputController.js';
import { networkManager } from '../network/NetworkManager.js';

// Small, unobtrusive multiplayer connection indicator. Follows the same
// dark rounded-pill visual language as the room banner in App.jsx.
function ConnectionBadge({ connState, ping }) {
  const dotColor = {
    connected: '#5be36a',
    connecting: '#ffcf3f',
    reconnecting: '#ffcf3f',
    disconnected: '#ff5b5b',
  }[connState] || '#9fb3d1';

  const label = {
    connected: ping != null ? `${ping} ms` : 'CONNECTED',
    connecting: 'CONNECTING…',
    reconnecting: 'RECONNECTING…',
    disconnected: 'DISCONNECTED',
  }[connState] || connState;

  return (
    <span
      style={{
        background: 'rgba(10,14,24,.7)',
        border: '1px solid rgba(120,150,200,.35)',
        borderRadius: 8,
        padding: '6px 12px',
        fontWeight: 700,
        fontSize: 12,
        color: '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, display: 'inline-block' }} />
      {label}
    </span>
  );
}

export default function MultiplayerGameCanvas({ localPlayerId, mapData, matchActive }) {
  const canvasRef     = useRef(null);
  const rendererRef   = useRef(null);
  const inputRef      = useRef(null);
  const localIdRef    = useRef(localPlayerId);
  localIdRef.current = localPlayerId;

  // Connection status/ping change rarely (ping ~every 2s, connState on
  // actual transitions) — safe to drive with React state without touching
  // the 30 Hz game-state hot path below.
  const [connState, setConnState] = useState(networkManager.connState || 'connected');
  const [ping, setPing] = useState(networkManager.ping || 0);

  useEffect(() => {
    if (!canvasRef.current) return;
    const renderer = new MultiplayerRenderer(canvasRef.current);
    renderer.init();
    rendererRef.current = renderer;

    const inputController = new MultiplayerInputController(networkManager, renderer);
    inputController.init(canvasRef.current);
    inputRef.current = inputController;

    // Hot path: GAME_STATE arrives up to ~30x/sec. Feed it straight into
    // the renderer's own internal state and run client-side reconciliation
    // directly — deliberately bypassing React state/props so a network
    // tick never triggers a React re-render (see Stage 5 perf notes).
    const offGameState = networkManager.onGameState((data) => {
      if (data.players) {
        inputController.applyServerState(data.players, localIdRef.current);
        renderer.setPlayers(data.players);
      }
      if (data.bullets)  renderer.setBullets(data.bullets);
      if (data.powerups) renderer.setPowerups(data.powerups);
    });

    const offEvent = networkManager.onGameEvent((data) => renderer.handleGameEvent(data));

    const offConnState = networkManager.onConnState((data) => setConnState(data.state));
    const offPing = networkManager.onPing((data) => setPing(data.ping));

    // Part 22 — Tab toggles the compact scoreboard. Kept as a direct
    // renderer flag (not React state) since it only affects the canvas.
    const onKeyDown = (e) => {
      if (e.code === 'Tab') { e.preventDefault(); renderer.toggleScoreboard(); }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      renderer.destroy();
      inputController.destroy();
      offGameState();
      offEvent();
      offConnState();
      offPing();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => { rendererRef.current?.setLocalPlayerId(localPlayerId); }, [localPlayerId]);
  useEffect(() => {
    rendererRef.current?.setMapData(mapData);
    inputRef.current?.setMap(mapData);
  }, [mapData]);
  // Parts 20/21 — only accept/send gameplay input while the server says the
  // match is ACTIVE (countdown, results, and lobby all lock input).
  useEffect(() => { inputRef.current?.setActive(!!matchActive); }, [matchActive]);

  return (
    <>
      <canvas id="mp-game" ref={canvasRef} />
      <div style={{ position: 'absolute', top: 14, right: 14, zIndex: 21 }}>
        <ConnectionBadge connState={connState} ping={ping} />
      </div>
    </>
  );
}
