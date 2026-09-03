import { useRef, useState, useCallback, useEffect } from 'react';
import { useGameEngine } from './hooks/useGameEngine';
import MenuScreen from './components/MenuScreen';
import DifficultyScreen from './components/DifficultyScreen';
import HowToPlayScreen from './components/HowToPlayScreen';
import SettingsScreen from './components/SettingsScreen';
import CreditsScreen from './components/CreditsScreen';
import GarageScreen from './components/GarageScreen';
import PauseScreen from './components/PauseScreen';
import GameOverScreen from './components/GameOverScreen';
import HUD from './components/HUD';
import GameCanvas from './components/GameCanvas';
import MultiplayerScreen from './components/MultiplayerScreen';
import LobbyScreen from './components/LobbyScreen';
import MultiplayerGameCanvas from './components/MultiplayerGameCanvas';
import CountdownOverlay from './components/CountdownOverlay';
import MatchResultsScreen from './components/MatchResultsScreen';
import { networkManager } from './network/NetworkManager.js';

export default function App() {
  const [view, setView] = useState('menu');
  const [gameState, setGameState] = useState('menu');
  const [hud, setHud] = useState({ stats: { kills: 0, coins: 0, score: 0, wave: 1, lives: 3, p2lives: 3, time: 0 }, players: [], combo: 0, mode: 'battle' });
  const [toastMsg, setToastMsg] = useState('');
  const [boss, setBoss] = useState(null);
  const [endResult, setEndResult] = useState(null);
  const [pendingMode, setPendingMode] = useState('battle');
  const [wallet, setWallet] = useState(0);
  const [upgrades, setUpgrades] = useState(null);

  // --- Online multiplayer (lobby only — no gameplay networking yet) ---
  const [mpConnecting, setMpConnecting] = useState(false);
  const [mpError, setMpError] = useState('');
  const [mpRoomCode, setMpRoomCode] = useState(null);
  const [mpPlayers, setMpPlayers] = useState([]);
  const [mpYou, setMpYou] = useState(null);
  const [mpMapId, setMpMapId] = useState(null);
  const [mpMaps, setMpMaps] = useState([]);
  const [mpModeId, setMpModeId] = useState(null);
  const [mpModes, setMpModes] = useState([]);
  const [mpStartedInfo, setMpStartedInfo] = useState(null);
  // Tracked at the App level (not just inside MultiplayerGameCanvas) so the
  // lobby can also react to it — e.g. disabling "Start Match" while the
  // connection is unavailable (Part 26), and offering a Retry action.
  const [mpConnState, setMpConnState] = useState('disconnected');
  const [mpLastAction, setMpLastAction] = useState(null); // { type: 'create' } | { type: 'join', code }

  // --- Stage 6: server-authoritative match lifecycle ---
  const [mpMatchState, setMpMatchState] = useState('lobby'); // 'lobby' | 'countdown' | 'active' | 'ended'
  const [mpCountdown, setMpCountdown] = useState(null);
  const [mpMatchTime, setMpMatchTime] = useState(null);
  const [mpMatchResult, setMpMatchResult] = useState(null);
  const [mpRematchReady, setMpRematchReady] = useState({ ready: [], total: 0 });

  // Authoritative in-match state (player positions, bullets, etc.) is fed
  // directly from NetworkManager into MultiplayerGameCanvas's own renderer —
  // it deliberately does NOT live in React state, since GAME_STATE arrives
  // at ~30 Hz and routing it through setState would re-render the app tree
  // every network tick. mpPlayers (the lobby roster) below only changes on
  // join/leave and is fine to keep as ordinary React state.
  const [mpMapData, setMpMapData] = useState(null);

  useEffect(() => {
    const offRoomCreated = networkManager.on('roomCreated', (data) => {
      setMpConnecting(false);
      setMpError('');
      setMpRoomCode(data.roomCode);
      setMpPlayers(data.players);
      setMpYou(data.you);
      if (data.mapId) setMpMapId(data.mapId);
      if (data.maps) setMpMaps(data.maps);
      if (data.modeId) setMpModeId(data.modeId);
      if (data.modes) setMpModes(data.modes);
      setView('lobby');
    });
    const offRoomJoined = networkManager.on('roomJoined', (data) => {
      setMpConnecting(false);
      setMpError('');
      setMpRoomCode(data.roomCode);
      setMpPlayers(data.players);
      setMpYou(data.you);
      if (data.mapId) setMpMapId(data.mapId);
      if (data.maps) setMpMaps(data.maps);
      if (data.modeId) setMpModeId(data.modeId);
      if (data.modes) setMpModes(data.modes);
      setView('lobby');
    });
    const offPlayerJoined = networkManager.on('playerJoined', (data) => setMpPlayers(data.players));
    const offPlayerLeft = networkManager.on('playerLeft', (data) => {
      setMpPlayers(data.players);
      if (data.newHostId && networkManager.socket && data.newHostId === networkManager.socket.id) {
        setMpYou((prev) => (prev ? { ...prev, isHost: true } : prev));
      }
    });
    const offRoomUpdated = networkManager.on('roomUpdated', (data) => {
      setMpPlayers(data.players);
      const me = networkManager.socket && data.players.find((p) => p.id === networkManager.socket.id);
      if (me) setMpYou(me);
      if (data.mapId) setMpMapId(data.mapId);
      if (data.modeId) setMpModeId(data.modeId);
    });
    const offGameStart = networkManager.on('gameStart', (data) => {
      setMpStartedInfo(data);
      if (data.mapData) setMpMapData(data.mapData);
      // A GAME_START also fires for a rematch — clear any previous results
      // and rematch-readiness so the countdown starts on a clean screen.
      setMpMatchResult(null);
      setMpRematchReady({ ready: [], total: 0 });
      setView('mp-game');
    });
    const offMatchState = networkManager.onMatchState((data) => {
      setMpMatchState(data.state);
      setMpCountdown(data.state === 'countdown' ? data.countdown : null);
      setMpMatchTime(Number.isFinite(data.matchTime) ? data.matchTime : null);
    });
    const offMatchEnded = networkManager.onMatchEnded((data) => {
      setMpMatchState('ended');
      setMpMatchResult(data);
    });
    const offRematchUpdate = networkManager.onRematchUpdate((data) => setMpRematchReady(data));
    const offReturnToLobby = networkManager.onReturnToLobby((data) => {
      setMpMatchState('lobby');
      setMpMatchResult(null);
      setMpRematchReady({ ready: [], total: 0 });
      setMpCountdown(null);
      setMpMatchTime(null);
      setMpMapData(null);
      if (data?.players) setMpPlayers(data.players);
      setView('lobby');
    });
    // After a temporary disconnect, the server re-registers the player under
    // a new socket id and replies with REJOIN_OK. Without this, the client
    // would keep pointing at its stale pre-disconnect id as "localPlayerId",
    // which would make the reconnecting client's own tank render/predict as
    // if it were a remote player.
    const offRejoinOk = networkManager.onRejoinOk((data) => {
      setMpRoomCode(data.roomCode);
      setMpPlayers(data.players);
      setMpYou(data.you);
      if (data.mapData) setMpMapData(data.mapData);
    });
    const offError = networkManager.on('error', (data) => {
      setMpConnecting(false);
      setMpError(data?.message || 'Something went wrong.');
    });
    const offConnState = networkManager.onConnState((data) => {
      setMpConnState(data.state);
      // Part 23 — never leave the player staring at an infinite loading
      // screen: a failed/dropped connection always clears the spinner.
      if (data.state === 'disconnected') setMpConnecting(false);
    });

    return () => {
      offRoomCreated(); offRoomJoined(); offPlayerJoined(); offPlayerLeft();
      offRoomUpdated(); offGameStart(); offRejoinOk(); offError(); offConnState();
      offMatchState(); offMatchEnded(); offRematchUpdate(); offReturnToLobby();
    };
  }, []);

  const canvasRef = useRef(null);
  const minimapRef = useRef(null);
  const toastTimer = useRef(null);
  // Single-player HUD data arrives from the engine's update() loop, i.e. up
  // to 60x/sec. Routing every one of those through setState would re-render
  // the whole App tree every frame (the same reason the multiplayer path
  // deliberately keeps its per-tick GAME_STATE out of React state — see the
  // comment above mpMapData). We don't need HUD numbers to update faster
  // than the eye can read them, so throttle to ~15Hz here instead.
  const lastHudUpdate = useRef(0);
  const HUD_UPDATE_INTERVAL_MS = 66;

  const onStateChange = useCallback((state, mode, data) => {
    setGameState(state);
    if (state === 'menu') setView('menu');
    else if (state === 'over') { setView('game'); setEndResult(data); }
    else setView('game');
  }, []);

  const onHUDUpdate = useCallback((data) => {
    const now = performance.now();
    if (now - lastHudUpdate.current < HUD_UPDATE_INTERVAL_MS) return;
    lastHudUpdate.current = now;
    setHud(data);
  }, []);
  const onToast = useCallback((txt) => {
    setToastMsg(txt);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 1300);
  }, []);
  const onComboPulse = useCallback(() => {
    const el = document.getElementById('comboChip');
    if (el) { el.style.transform = 'scale(1.25)'; setTimeout(() => el.style.transform = 'scale(1)', 110); }
  }, []);
  const onBossChange = useCallback((t) => setBoss(t), []);

  const engineRef = useGameEngine(canvasRef, minimapRef, onStateChange, onHUDUpdate, onToast, onComboPulse, onBossChange);

  const goMenu = () => setView('menu');
  const goDiff = (mode) => { setPendingMode(mode); setView('difficulty'); };
  const startGame = (diff) => { engineRef.current?.start(pendingMode, diff); };
  const startTutorial = () => { engineRef.current?.startTutorial(); };
  const pause = () => engineRef.current?.pause();
  const resume = () => engineRef.current?.resume();
  const restart = () => engineRef.current?.restart();
  const quit = () => engineRef.current?.quit();
  const toggleSetting = (key) => { engineRef.current?.setSetting(key, !engineRef.current.getSettings()[key]); };
  const getSetting = (key) => engineRef.current?.getSettings()[key] ?? true;

  const goGarage = () => {
    const engine = engineRef.current;
    if (engine) { setWallet(engine.loadWallet()); setUpgrades(engine.loadUpgrades()); }
    setView('garage');
  };
  const purchaseUpgrade = (key) => {
    const res = engineRef.current?.purchaseUpgrade(key);
    if (res) { setWallet(res.wallet); setUpgrades(res.upgrades); }
  };

  const goOnline = () => { setMpError(''); setView('multiplayer'); };
  const leaveMultiplayer = () => {
    networkManager.disconnect();
    setMpConnecting(false); setMpError(''); setMpRoomCode(null); setMpPlayers([]); setMpYou(null); setMpStartedInfo(null); setMpMapData(null);
    setMpMatchState('lobby'); setMpCountdown(null); setMpMatchTime(null); setMpMatchResult(null); setMpRematchReady({ ready: [], total: 0 });
    setMpConnState('disconnected'); setMpLastAction(null);
    setView('menu');
  };
  const createRoom = () => {
    setMpError(''); setMpConnecting(true); setMpLastAction({ type: 'create' });
    networkManager.connect();
    networkManager.createRoom();
  };
  const joinRoom = (code) => {
    setMpError(''); setMpConnecting(true); setMpLastAction({ type: 'join', code });
    networkManager.connect();
    networkManager.joinRoom(code);
  };
  // Part 23 — explicit retry after a failed connection attempt, instead of
  // making the player start over from the main menu.
  const retryLastAction = () => {
    if (!mpLastAction) return;
    setMpError(''); setMpConnecting(true);
    networkManager.connect();
    if (mpLastAction.type === 'create') networkManager.createRoom();
    else if (mpLastAction.type === 'join') networkManager.joinRoom(mpLastAction.code);
  };
  const leaveLobby = () => {
    networkManager.leaveRoom();
    setMpRoomCode(null); setMpPlayers([]); setMpYou(null);
    setView('multiplayer');
  };
  const startMatch = () => networkManager.startMatch();
  const requestRematch = () => networkManager.requestRematch();
  const requestReturnToLobby = () => networkManager.requestReturnToLobby();

  return (
    <div id="wrap">
      <GameCanvas canvasRef={canvasRef} minimapRef={minimapRef} showTouch={view === 'game' && gameState !== 'over'} />
      {view === 'game' && <HUD data={hud} boss={boss} onPause={pause} />}
      {view === 'game' && gameState === 'play' && toastMsg && (
        <div id="toast" className="show">{toastMsg}</div>
      )}
      {view === 'game' && gameState === 'pause' && <PauseScreen onResume={resume} onRestart={restart} onQuit={quit} />}
      {view === 'game' && gameState === 'over' && <GameOverScreen result={endResult} onAgain={restart} onMenu={quit} />}
      {view === 'menu' && <MenuScreen onPlay={() => goDiff('battle')} onSurvival={() => goDiff('survival')} on2P={() => goDiff('2player')} onOnline={goOnline} onGarage={goGarage} onHow={() => setView('how')} onSettings={() => setView('settings')} onCredits={() => setView('credits')} />}
      {view === 'garage' && <GarageScreen wallet={wallet} upgrades={upgrades} onPurchase={purchaseUpgrade} onBack={goMenu} />}
      {view === 'difficulty' && <DifficultyScreen onStart={startGame} onBack={goMenu} />}
      {view === 'how' && <HowToPlayScreen onTutorial={startTutorial} onBack={goMenu} />}
      {view === 'settings' && <SettingsScreen getSetting={getSetting} toggleSetting={toggleSetting} onBack={goMenu} />}
      {view === 'credits' && <CreditsScreen onBack={goMenu} />}
      {view === 'multiplayer' && (
        <MultiplayerScreen onCreateRoom={createRoom} onJoinRoom={joinRoom} onBack={leaveMultiplayer} connecting={mpConnecting} error={mpError} onRetry={retryLastAction} canRetry={!!mpLastAction} />
      )}
      {view === 'lobby' && (
        <LobbyScreen roomCode={mpRoomCode} players={mpPlayers} you={mpYou} onStart={startMatch} onLeave={leaveLobby} error={mpError} connState={mpConnState} maps={mpMaps} mapId={mpMapId} onSetMap={(id) => networkManager.setMap(id)} modes={mpModes} modeId={mpModeId} onSetMode={(id) => networkManager.setMode(id)} />
      )}
      {view === 'mp-game' && (
        <>
          <MultiplayerGameCanvas
            localPlayerId={mpYou?.id ?? null}
            mapData={mpMapData}
            matchActive={mpMatchState === 'active'}
            showTouch={mpMatchState !== 'ended'}
          />
          <div id="mpGameOverlay" style={{ position: 'absolute', top: 14, left: 14, zIndex: 21, color: '#fff', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ background: 'rgba(10,14,24,.7)', border: '1px solid rgba(120,150,200,.35)', borderRadius: 8, padding: '6px 12px', fontWeight: 700 }}>
              ROOM {mpRoomCode} · {mpStartedInfo?.players?.length || mpPlayers.length} PLAYERS
            </span>
            {mpMatchState === 'active' && mpMatchTime != null && (
              <span className={`mp-match-timer${mpMatchTime <= 10 ? ' low' : ''}`}>
                {String(Math.floor(mpMatchTime / 60)).padStart(2, '0')}:{String(mpMatchTime % 60).padStart(2, '0')}
              </span>
            )}
            <button className="btn small red" style={{ margin: 0, minWidth: 0, padding: '8px 16px' }} onClick={leaveMultiplayer}>LEAVE</button>
          </div>

          {mpMatchState === 'countdown' && <CountdownOverlay countdown={mpCountdown} />}

          {mpMatchState === 'ended' && mpMatchResult && (
            <MatchResultsScreen
              result={mpMatchResult}
              you={mpYou}
              isHost={!!mpYou?.isHost}
              rematchReady={mpRematchReady}
              onRematch={requestRematch}
              onReturnToLobby={requestReturnToLobby}
              onExit={leaveMultiplayer}
            />
          )}
        </>
      )}
    </div>
  );
}
