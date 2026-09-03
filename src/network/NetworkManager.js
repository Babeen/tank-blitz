import { io } from 'socket.io-client';
import { EVENTS } from '../../shared/protocol.js';

const SERVER_URL = import.meta.env.VITE_SOCKET_SERVER_URL || 'http://localhost:4000';

// Artificial client-side latency for development only.
// Set VITE_DEV_LATENCY_MS in .env (e.g. VITE_DEV_LATENCY_MS=150).
// Never active in production builds.
const DEV_LATENCY = parseInt(import.meta.env.VITE_DEV_LATENCY_MS || '0', 10);
function maybeDelay(fn) {
  if (DEV_LATENCY > 0) setTimeout(fn, DEV_LATENCY);
  else fn();
}

export class NetworkManager {
  constructor() {
    this.socket = null;
    this._listeners = new Map();
    this.roomCode = null;
    this.you = null;
    this.players = [];
    this.gameStatePlayers = [];

    // Reconnect token — stored in memory, used to rejoin after a disconnect
    this._reconnectToken = null;
    this._reconnectRoomCode = null;

    // Ping tracking
    this.ping = 0;
    this._pingInterval = null;
    this._pingSentAt = 0;

    // Connection state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
    this.connState = 'disconnected';
  }

  on(eventName, callback) {
    if (!this._listeners.has(eventName)) this._listeners.set(eventName, new Set());
    this._listeners.get(eventName).add(callback);
    return () => this.off(eventName, callback);
  }

  off(eventName, callback) { this._listeners.get(eventName)?.delete(callback); }

  _fire(eventName, payload) {
    this._listeners.get(eventName)?.forEach((cb) => {
      try { cb(payload); } catch (err) { console.error(`[NetworkManager] "${eventName}" threw`, err); }
    });
  }

  connect() {
    if (this.socket) return;
    this.connState = 'connecting';
    this._fire('connState', { state: 'connecting' });

    this.socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    this.socket.on('connect', () => {
      this.connState = 'connected';
      this._fire('connected', { id: this.socket.id });
      this._fire('connState', { state: 'connected' });
      this._startPing();
      // Attempt to rejoin an in-progress match after reconnect
      if (this._reconnectToken && this._reconnectRoomCode) {
        this.socket.emit(EVENTS.CLIENT.REJOIN_ROOM, { reconnectToken: this._reconnectToken });
      }
    });

    this.socket.on('disconnect', (reason) => {
      this.connState = 'disconnected';
      this._stopPing();
      this._fire('disconnected', { reason });
      this._fire('connState', { state: 'disconnected', reason });
    });

    this.socket.io.on('reconnect_attempt', () => {
      this.connState = 'reconnecting';
      this._fire('connState', { state: 'reconnecting' });
    });

    this.socket.io.on('reconnect_failed', () => {
      this.connState = 'disconnected';
      this._fire('connState', { state: 'disconnected' });
    });

    this.socket.on('connect_error', (err) => {
      this._fire('error', { message: 'Could not reach the multiplayer server.', detail: err?.message });
    });

    this.socket.on(EVENTS.SERVER.ROOM_CREATED, (data) => {
      this.roomCode = data.roomCode; this.you = data.you; this.players = data.players;
      if (data.reconnectToken) { this._reconnectToken = data.reconnectToken; this._reconnectRoomCode = data.roomCode; }
      this._fire('roomCreated', data);
    });
    this.socket.on(EVENTS.SERVER.ROOM_JOINED, (data) => {
      this.roomCode = data.roomCode; this.you = data.you; this.players = data.players;
      if (data.reconnectToken) { this._reconnectToken = data.reconnectToken; this._reconnectRoomCode = data.roomCode; }
      this._fire('roomJoined', data);
    });
    this.socket.on(EVENTS.SERVER.REJOIN_OK, (data) => {
      this.roomCode = data.roomCode; this.you = data.you; this.players = data.players;
      if (data.reconnectToken) { this._reconnectToken = data.reconnectToken; this._reconnectRoomCode = data.roomCode; }
      this._fire('rejoinOk', data);
    });
    this.socket.on(EVENTS.SERVER.PLAYER_JOINED, (data) => { this.players = data.players; this._fire('playerJoined', data); });
    this.socket.on(EVENTS.SERVER.PLAYER_LEFT, (data) => {
      this.players = data.players;
      if (this.you && data.newHostId === this.socket.id) this.you = { ...this.you, isHost: true };
      this._fire('playerLeft', data);
    });
    this.socket.on(EVENTS.SERVER.ROOM_UPDATED, (data) => {
      this.players = data.players;
      const me = data.players.find((p) => p.id === this.socket.id);
      if (me) this.you = me;
      this._fire('roomUpdated', data);
    });
    this.socket.on(EVENTS.SERVER.GAME_START, (data) => this._fire('gameStart', data));
    this.socket.on(EVENTS.SERVER.GAME_STATE, (data) => {
      this.gameStatePlayers = data.players;
      maybeDelay(() => this._fire('gameState', data));
    });
    this.socket.on(EVENTS.SERVER.GAME_EVENT, (data) => {
      maybeDelay(() => this._fire('gameEvent', data));
    });
    this.socket.on(EVENTS.SERVER.SERVER_ERROR, (data) => this._fire('error', data));

    // Match lifecycle (Stage 6)
    this.socket.on(EVENTS.SERVER.MATCH_STATE, (data) => this._fire('matchState', data));
    this.socket.on(EVENTS.SERVER.MATCH_ENDED, (data) => this._fire('matchEnded', data));
    this.socket.on(EVENTS.SERVER.REMATCH_UPDATE, (data) => this._fire('rematchUpdate', data));
    this.socket.on(EVENTS.SERVER.RETURN_TO_LOBBY, (data) => this._fire('returnToLobby', data));

    // Application-level ping (Part 1A) — independent of Socket.IO's own
    // internal heartbeat/pong. Server echoes the timestamp we sent it.
    this.socket.on(EVENTS.SERVER.PONG_RESPONSE, (data) => {
      if (data?.timestamp == null) return;
      this.ping = Math.round(performance.now() - data.timestamp);
      this._fire('ping', { ping: this.ping });
    });
  }

  _startPing() {
    this._stopPing();
    this._pingInterval = setInterval(() => {
      if (!this.socket?.connected) return;
      const timestamp = performance.now();
      this.socket.emit(EVENTS.CLIENT.PING_REQUEST, { timestamp });
    }, 2000);
  }

  _stopPing() {
    if (this._pingInterval) { clearInterval(this._pingInterval); this._pingInterval = null; }
  }

  onPlayerJoined(callback)  { return this.on('playerJoined', callback); }
  onPlayerLeft(callback)    { return this.on('playerLeft', callback); }
  onGameStart(callback)     { return this.on('gameStart', callback); }
  onGameState(callback)     { return this.on('gameState', callback); }
  onGameEvent(callback)     { return this.on('gameEvent', callback); }
  onConnState(callback)     { return this.on('connState', callback); }
  onPing(callback)          { return this.on('ping', callback); }
  onRejoinOk(callback)      { return this.on('rejoinOk', callback); }
  onMatchState(callback)    { return this.on('matchState', callback); }
  onMatchEnded(callback)    { return this.on('matchEnded', callback); }
  onRematchUpdate(callback) { return this.on('rematchUpdate', callback); }
  onReturnToLobby(callback) { return this.on('returnToLobby', callback); }

  disconnect() {
    this._stopPing();
    this.socket?.disconnect(); this.socket = null;
    this.roomCode = null; this.you = null; this.players = []; this.gameStatePlayers = [];
    this._reconnectToken = null; this._reconnectRoomCode = null;
    this.connState = 'disconnected';
  }

  createRoom()       { this.socket?.emit(EVENTS.CLIENT.CREATE_ROOM); }
  joinRoom(code)     { this.socket?.emit(EVENTS.CLIENT.JOIN_ROOM, { roomCode: code }); }
  leaveRoom()        { this.socket?.emit(EVENTS.CLIENT.LEAVE_ROOM); this.roomCode = null; this.you = null; this.players = []; this._reconnectToken = null; }
  setMap(mapId)      { this.socket?.emit(EVENTS.CLIENT.SET_MAP, { mapId }); }
  setMode(modeId)    { this.socket?.emit(EVENTS.CLIENT.SET_MODE, { modeId }); }
  startMatch()       { this.socket?.emit(EVENTS.CLIENT.START_MATCH); }
  requestRematch()   { this.socket?.emit(EVENTS.CLIENT.REMATCH_REQUEST); }
  requestReturnToLobby() { this.socket?.emit(EVENTS.CLIENT.RETURN_TO_LOBBY_REQUEST); }

  sendInput(input) {
    if (!this.socket?.connected) return;
    this.socket.emit(EVENTS.CLIENT.PLAYER_INPUT, {
      seq:         input.seq,
      up:          !!input?.up,
      down:        !!input?.down,
      left:        !!input?.left,
      right:       !!input?.right,
      turretAngle: Number.isFinite(input?.turretAngle) ? input.turretAngle : undefined,
      shooting:    !!input?.shooting,
      dash:        !!input?.dash,
    });
  }
}

export const networkManager = new NetworkManager();
