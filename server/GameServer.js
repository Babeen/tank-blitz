import { randomBytes } from 'node:crypto';
import { GameRoom } from './GameRoom.js';
import { GameSimulation } from './simulation/GameSimulation.js';
import { RateLimiter } from './RateLimiter.js';
import { logger } from './logger.js';
import { EVENTS, ROOM_RULES, MATCH_STATES, MATCH_RULES, MAPS } from '../shared/protocol.js';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomRoomCode(length) {
  let code = '';
  for (let i = 0; i < length; i++) code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  return code;
}
function generatePlayerName(ordinal) { return `Player ${ordinal}`; }

// Artificial latency for development (set DEV_LATENCY_MS env var, e.g. 150).
// Never active in production — only when the env var is explicitly set.
const DEV_LATENCY = parseInt(process.env.DEV_LATENCY_MS || '0', 10);
function maybeDelay(fn) {
  if (DEV_LATENCY > 0) setTimeout(fn, DEV_LATENCY);
  else fn();
}

// A generic error shown to players — never the raw error message/stack,
// which stays in the server log only (Part 8: don't expose internals).
const GENERIC_ERROR = 'Something went wrong. Please try again.';
const RATE_LIMIT_ERROR = 'Too many requests — please slow down.';

// Reconnect tokens let a dropped player rejoin their in-progress match.
// Kept short-lived and rotated on every successful use (see handleRejoin)
// so a token that leaks (log line, browser history, etc.) has a narrow
// window and can't be replayed indefinitely after the real player has
// already reconnected with it once.
const RECONNECT_TOKEN_TTL_MS = 300_000; // 5 minutes

export class GameServer {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();        // roomCode -> GameRoom
    this.simulations = new Map();  // roomCode -> GameSimulation
    // Reconnect tokens: token -> { roomCode, playerId, name, expiresAt }
    this._reconnectTokens = new Map();
    this._pruneInterval = null;

    // Lightweight flood/accident protection for discrete, low-frequency
    // events. Deliberately NOT applied to PLAYER_INPUT — gameplay input
    // arrives continuously by design and is already bounded by the
    // server-side weapon/dash cooldowns inside GameSimulation.
    this._limiters = {
      createRoom:     new RateLimiter(5, 10_000),
      joinRoom:       new RateLimiter(10, 10_000),
      setMap:         new RateLimiter(10, 5_000),
      startMatch:     new RateLimiter(5, 5_000),
      rematch:        new RateLimiter(10, 5_000),
      returnToLobby:  new RateLimiter(5, 5_000),
      rejoin:         new RateLimiter(10, 10_000),
      ping:           new RateLimiter(5, 2_000),
    };
  }

  init() {
    this.io.on('connection', (socket) => this.handleConnection(socket));
    // Prune expired reconnect tokens every 60 s
    this._pruneInterval = setInterval(() => {
      const now = Date.now();
      for (const [token, entry] of this._reconnectTokens) {
        if (entry.expiresAt < now) this._reconnectTokens.delete(token);
      }
    }, 60_000);
    logger.info('GameServer initialized.');
  }

  /** Stops every room's simulation/timers and clears server-wide intervals. Used on process shutdown. */
  shutdown() {
    if (this._pruneInterval) { clearInterval(this._pruneInterval); this._pruneInterval = null; }
    for (const [code, room] of this.rooms) {
      room.clearTimers();
      this.simulations.get(code)?.stop();
    }
    this.rooms.clear();
    this.simulations.clear();
    this._reconnectTokens.clear();
    logger.info('GameServer shutdown complete — all rooms and simulations stopped.');
  }

  generateRoomCode() {
    let code;
    do { code = randomRoomCode(ROOM_RULES.ROOM_CODE_LENGTH); } while (this.rooms.has(code));
    return code;
  }

  _generateToken() {
    // 32 random bytes (256 bits) of CSPRNG output, base64url-encoded so the
    // result is URL/socket-payload safe with no padding characters to
    // strip — a big step up from Math.random(), which is not
    // cryptographically secure and is predictable given enough samples.
    return randomBytes(32).toString('base64url');
  }

  // Wraps a handler so a single malformed event or unexpected exception
  // never crashes the process or takes down other rooms/players — it's
  // logged with full detail server-side and the player gets a generic,
  // non-technical message instead of a stack trace.
  _safe(socket, name, fn) {
    return (...args) => {
      try {
        fn(...args);
      } catch (err) {
        logger.error(`Error handling "${name}" from socket ${socket.id}:`, err);
        try { socket.emit(EVENTS.SERVER.SERVER_ERROR, { message: GENERIC_ERROR }); } catch { /* socket may already be gone */ }
      }
    };
  }

  _rateLimited(socket, limiter, name) {
    if (limiter.allow(socket.id)) return false;
    logger.debug(`Rate limit hit: "${name}" from socket ${socket.id}`);
    socket.emit(EVENTS.SERVER.SERVER_ERROR, { message: RATE_LIMIT_ERROR });
    return true;
  }

  _clearRateLimits(socketId) {
    for (const limiter of Object.values(this._limiters)) limiter.clear(socketId);
  }

  handleConnection(socket) {
    logger.debug(`Socket connected: ${socket.id}`);
    socket.emit(EVENTS.SERVER.CONNECTED, { id: socket.id });

    socket.on(EVENTS.CLIENT.CREATE_ROOM,  this._safe(socket, 'create_room', () => this.handleCreateRoom(socket)));
    socket.on(EVENTS.CLIENT.JOIN_ROOM,    this._safe(socket, 'join_room', (p) => this.handleJoinRoom(socket, p)));
    socket.on(EVENTS.CLIENT.LEAVE_ROOM,   this._safe(socket, 'leave_room', () => this.handleLeaveRoom(socket)));
    socket.on(EVENTS.CLIENT.SET_MAP,      this._safe(socket, 'set_map', (p) => this.handleSetMap(socket, p)));
    socket.on(EVENTS.CLIENT.START_MATCH,  this._safe(socket, 'start_match', () => this.handleStartMatch(socket)));
    socket.on(EVENTS.CLIENT.PLAYER_INPUT, this._safe(socket, 'player_input', (input) => this.handlePlayerInput(socket, input)));
    socket.on(EVENTS.CLIENT.REJOIN_ROOM,  this._safe(socket, 'rejoin_room', (p) => this.handleRejoin(socket, p)));
    socket.on(EVENTS.CLIENT.PING_REQUEST, this._safe(socket, 'ping_request', (p) => this.handlePingRequest(socket, p)));
    socket.on(EVENTS.CLIENT.REMATCH_REQUEST, this._safe(socket, 'rematch_request', () => this.handleRematchRequest(socket)));
    socket.on(EVENTS.CLIENT.RETURN_TO_LOBBY_REQUEST, this._safe(socket, 'return_to_lobby_request', () => this.handleReturnToLobbyRequest(socket)));
    socket.on('disconnect', this._safe(socket, 'disconnect', (reason) => this.handleDisconnect(socket, reason)));
    // Socket.IO itself emits this for transport-level issues (bad frames,
    // parser errors, etc.) — log it but never let it crash the process.
    socket.on('error', (err) => logger.error(`Socket error on ${socket.id}:`, err));
  }

  // ── Application-level ping (Part 1A) ───────────────────────────────────────
  // Lightweight, low-frequency latency measurement independent of Socket.IO's
  // own internal heartbeat/pong mechanism.
  handlePingRequest(socket, payload) {
    if (this._rateLimited(socket, this._limiters.ping, 'ping_request')) return;
    const timestamp = Number.isFinite(payload?.timestamp) ? payload.timestamp : null;
    socket.emit(EVENTS.SERVER.PONG_RESPONSE, { timestamp });
  }

  handleCreateRoom(socket) {
    if (this._rateLimited(socket, this._limiters.createRoom, 'create_room')) return;
    if (socket.data.roomCode) { socket.emit(EVENTS.SERVER.SERVER_ERROR, { message: 'You are already in a room.' }); return; }

    const code = this.generateRoomCode();
    const room = new GameRoom(code);
    this.rooms.set(code, room);
    const player = room.addPlayer(socket.id, generatePlayerName(1), true);
    socket.join(code);
    socket.data.roomCode = code;
    const token = this._generateToken();
    this._reconnectTokens.set(token, { roomCode: code, playerId: socket.id, name: player.name, expiresAt: Date.now() + RECONNECT_TOKEN_TTL_MS });
    socket.emit(EVENTS.SERVER.ROOM_CREATED, { roomCode: code, players: room.getPlayers(), you: player, reconnectToken: token, mapId: room.getMapId(), maps: MAPS });
    logger.info(`Room created: ${code} (host ${socket.id})`);
  }

  handleJoinRoom(socket, payload) {
    if (this._rateLimited(socket, this._limiters.joinRoom, 'join_room')) return;
    if (socket.data.roomCode) { socket.emit(EVENTS.SERVER.SERVER_ERROR, { message: 'You are already in a room.' }); return; }

    const rawCode = payload && typeof payload.roomCode === 'string' ? payload.roomCode : '';
    const code = rawCode.trim().toUpperCase().slice(0, ROOM_RULES.ROOM_CODE_LENGTH);
    if (!code) { socket.emit(EVENTS.SERVER.SERVER_ERROR, { message: 'Enter a room code.' }); return; }

    const room = this.rooms.get(code);
    if (!room)              { socket.emit(EVENTS.SERVER.SERVER_ERROR, { message: 'Room not found.' }); return; }
    if (room.hasStarted())  { socket.emit(EVENTS.SERVER.SERVER_ERROR, { message: 'That match has already started.' }); return; }
    if (room.isFull())      { socket.emit(EVENTS.SERVER.SERVER_ERROR, { message: 'Room is full.' }); return; }

    const player = room.addPlayer(socket.id, generatePlayerName(room.getPlayers().length + 1), false);
    socket.join(code);
    socket.data.roomCode = code;
    const token = this._generateToken();
    this._reconnectTokens.set(token, { roomCode: code, playerId: socket.id, name: player.name, expiresAt: Date.now() + RECONNECT_TOKEN_TTL_MS });
    socket.emit(EVENTS.SERVER.ROOM_JOINED, { roomCode: code, players: room.getPlayers(), you: player, reconnectToken: token, mapId: room.getMapId(), maps: MAPS });
    socket.to(code).emit(EVENTS.SERVER.PLAYER_JOINED, { player, players: room.getPlayers() });
    this.io.to(code).emit(EVENTS.SERVER.ROOM_UPDATED, { players: room.getPlayers() });
    logger.info(`Player joined room ${code}: ${socket.id}`);
  }

  handleRejoin(socket, payload) {
    if (this._rateLimited(socket, this._limiters.rejoin, 'rejoin_room')) return;

    const token = payload && typeof payload.reconnectToken === 'string' ? payload.reconnectToken : '';
    const entry = token ? this._reconnectTokens.get(token) : null;
    if (!entry || entry.expiresAt < Date.now()) {
      if (entry) this._reconnectTokens.delete(token); // expired — don't leave it around for the pruning sweep
      socket.emit(EVENTS.SERVER.SERVER_ERROR, { message: 'Reconnect token invalid or expired.' });
      return;
    }
    const room = this.rooms.get(entry.roomCode);
    if (!room) {
      socket.emit(EVENTS.SERVER.SERVER_ERROR, { message: 'Room no longer exists.' });
      this._reconnectTokens.delete(token);
      return;
    }
    const sim = this.simulations.get(entry.roomCode);

    // Re-register the socket under the original player id
    const oldId = entry.playerId;
    socket.data.roomCode = entry.roomCode;
    socket.join(entry.roomCode);

    // Update room lobby entry
    const lobbyPlayer = room.players.get(oldId);
    if (lobbyPlayer) {
      room.players.delete(oldId);
      lobbyPlayer.id = socket.id;
      room.players.set(socket.id, lobbyPlayer);
    } else {
      room.addPlayer(socket.id, entry.name, false);
    }

    // Update game state entry
    if (room.gameState.players.has(oldId)) {
      const gs = room.gameState.players.get(oldId);
      gs.id = socket.id;
      room.gameState.players.delete(oldId);
      room.gameState.players.set(socket.id, gs);
    }

    // Update simulation input/kinematics
    if (sim) {
      const inp = sim.inputs.get(oldId);
      const kin = sim.kinematics.get(oldId);
      sim.inputs.delete(oldId);
      sim.kinematics.delete(oldId);
      if (inp) sim.inputs.set(socket.id, inp);
      if (kin) sim.kinematics.set(socket.id, kin);
    }

    // Carry over rematch-readiness under the new socket id, if applicable
    if (room.rematchReady.has(oldId)) { room.rematchReady.delete(oldId); room.rematchReady.add(socket.id); }

    // Rotate the reconnect token on every successful reconnect: invalidate
    // the one that was just used and issue a fresh one. This bounds how
    // long a leaked/observed token stays useful — once the real player has
    // reconnected with it, the old value is dead and can't be replayed.
    this._reconnectTokens.delete(token);
    const newToken = this._generateToken();
    this._reconnectTokens.set(newToken, {
      roomCode: entry.roomCode,
      playerId: socket.id,
      name: entry.name,
      expiresAt: Date.now() + RECONNECT_TOKEN_TTL_MS,
    });

    const you = room.players.get(socket.id);
    socket.emit(EVENTS.SERVER.REJOIN_OK, {
      roomCode: entry.roomCode,
      players: room.getPlayers(),
      you,
      reconnectToken: newToken,
      mapData: sim?.getMapData() || null,
    });
    // Bring the reconnecting client up to date on the match lifecycle —
    // if the match already ended, send them straight to results/lobby state.
    socket.emit(EVENTS.SERVER.MATCH_STATE, this._matchStatePayload(room));
    if (room.matchState === MATCH_STATES.ENDED) {
      socket.emit(EVENTS.SERVER.MATCH_ENDED, this._matchEndedPayload(room));
    }
    if (sim) {
      maybeDelay(() => socket.emit(EVENTS.SERVER.GAME_STATE, sim._buildState()));
    }
    socket.to(entry.roomCode).emit(EVENTS.SERVER.ROOM_UPDATED, { players: room.getPlayers() });
    logger.info(`Player reconnected to room ${entry.roomCode}: ${oldId} -> ${socket.id}`);
  }

  handleLeaveRoom(socket) { this.removePlayerFromRoom(socket); }

  handleDisconnect(socket, reason) {
    logger.debug(`Socket disconnected: ${socket.id} (${reason})`);
    this._clearRateLimits(socket.id);
    this.removePlayerFromRoom(socket);
  }

  removePlayerFromRoom(socket) {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = this.rooms.get(code);
    if (!room) return;
    const { newHost } = room.removePlayer(socket.id);
    socket.leave(code);
    delete socket.data.roomCode;
    room.gameState.players.delete(socket.id);
    room.rematchReady.delete(socket.id);
    this.simulations.get(code)?.removePlayer(socket.id);

    if (room.isEmpty()) {
      room.clearTimers();
      this.simulations.get(code)?.stop();
      this.simulations.delete(code);
      this.rooms.delete(code);
      logger.info(`Room destroyed (empty): ${code}`);
      return;
    }

    this.io.to(code).emit(EVENTS.SERVER.PLAYER_LEFT, { playerId: socket.id, players: room.getPlayers(), newHostId: newHost?.id || null });
    this.io.to(code).emit(EVENTS.SERVER.ROOM_UPDATED, { players: room.getPlayers() });
    logger.info(`Player left room ${code}: ${socket.id}`);

    // Part 24 — if a disconnect leaves exactly one player in an active
    // match, that player wins automatically.
    if (room.matchState === MATCH_STATES.ACTIVE && room.gameState.players.size === 1) {
      this.endMatch(code, 'lastStanding');
    }

    // If everyone still connected had already accepted a rematch, a
    // departure can bring the ready count up to the (now smaller) total.
    if (room.matchState === MATCH_STATES.ENDED && room.rematchReady.size > 0 && room.rematchReady.size >= room.players.size) {
      this._triggerRematch(code, room);
    }
  }

  // ── Map selection (lobby only) ──────────────────────────────────────────

  handleSetMap(socket, payload) {
    if (this._rateLimited(socket, this._limiters.setMap, 'set_map')) return;

    const code = socket.data.roomCode;
    const room = code ? this.rooms.get(code) : null;
    if (!room)                              { socket.emit(EVENTS.SERVER.SERVER_ERROR, { message: 'You are not in a room.' }); return; }
    if (!room.isHost(socket.id))            { socket.emit(EVENTS.SERVER.SERVER_ERROR, { message: 'Only the host can change the map.' }); return; }
    if (room.matchState !== MATCH_STATES.LOBBY) { socket.emit(EVENTS.SERVER.SERVER_ERROR, { message: 'Cannot change the map once a match has started.' }); return; }

    const mapId = payload && typeof payload.mapId === 'string' ? payload.mapId : '';
    if (!room.setMap(mapId)) { socket.emit(EVENTS.SERVER.SERVER_ERROR, { message: 'Unknown map.' }); return; }

    this.io.to(code).emit(EVENTS.SERVER.ROOM_UPDATED, { players: room.getPlayers(), mapId: room.getMapId() });
  }

  // ── Match start / countdown / active (Parts 4-7) ────────────────────────────

  handleStartMatch(socket) {
    if (this._rateLimited(socket, this._limiters.startMatch, 'start_match')) return;

    const code = socket.data.roomCode;
    const room = code ? this.rooms.get(code) : null;
    if (!room)                              { socket.emit(EVENTS.SERVER.SERVER_ERROR, { message: 'You are not in a room.' }); return; }
    if (!room.isHost(socket.id))            { socket.emit(EVENTS.SERVER.SERVER_ERROR, { message: 'Only the host can start the match.' }); return; }
    if (!room.hasEnoughPlayers())           { socket.emit(EVENTS.SERVER.SERVER_ERROR, { message: 'Need at least 2 players to start.' }); return; }
    if (room.matchState !== MATCH_STATES.LOBBY) { socket.emit(EVENTS.SERVER.SERVER_ERROR, { message: 'A match is already in progress.' }); return; }

    const simulation = this._createSimulation(room, code);
    this.simulations.set(code, simulation);
    room.beginNewMatch(simulation.map.spawnPoints());

    logger.info(`Match started: room ${code} (${room.players.size} players, map ${room.getMapId()})`);
    this._startCountdown(code, room, simulation);
  }

  _createSimulation(room, code) {
    return new GameSimulation(room, {
      tickRate: 30,
      killsToWin: MATCH_RULES.KILLS_TO_WIN,
      mapId: room.getMapId(),
      onTick: (state) => maybeDelay(() => this.io.to(code).emit(EVENTS.SERVER.GAME_STATE, state)),
      onEvent: (type, data) => maybeDelay(() => this.io.to(code).emit(EVENTS.SERVER.GAME_EVENT, { type, ...data })),
      onMatchEnd: (reason) => this.endMatch(code, reason),
      onError: (err) => logger.error(`Simulation tick error in room ${code}:`, err),
    });
  }

  _startCountdown(code, room, simulation) {
    room.matchState = MATCH_STATES.COUNTDOWN;
    room.countdown = MATCH_RULES.COUNTDOWN_SECONDS;

    const mapData = simulation.getMapData();
    this.io.to(code).emit(EVENTS.SERVER.GAME_START, { roomId: code, players: room.getPlayers(), mapData });
    this.io.to(code).emit(EVENTS.SERVER.GAME_STATE, simulation._buildState());
    this.io.to(code).emit(EVENTS.SERVER.MATCH_STATE, this._matchStatePayload(room));

    room.clearTimers();
    room._countdownTimer = setInterval(() => {
      room.countdown -= 1;
      if (room.countdown > 0) {
        this.io.to(code).emit(EVENTS.SERVER.MATCH_STATE, this._matchStatePayload(room));
      } else {
        clearInterval(room._countdownTimer);
        room._countdownTimer = null;
        this._activateMatch(code, room, simulation);
      }
    }, 1000);
  }

  _activateMatch(code, room, simulation) {
    room.matchState = MATCH_STATES.ACTIVE;
    room.matchStartedAt = Date.now();
    room.matchEndsAt = room.matchStartedAt + MATCH_RULES.MATCH_DURATION_SECONDS * 1000;

    this.io.to(code).emit(EVENTS.SERVER.MATCH_STATE, this._matchStatePayload(room));
    this.io.to(code).emit(EVENTS.SERVER.GAME_STATE, simulation._buildState());

    simulation.start();

    // Server-authoritative match timer (Part 7) — the client may display
    // this however it likes, but only the server decides when it hits zero.
    room._matchTimer = setInterval(() => {
      const remainingMs = room.matchEndsAt - Date.now();
      if (remainingMs <= 0) {
        clearInterval(room._matchTimer);
        room._matchTimer = null;
        this.endMatch(code, 'time');
        return;
      }
      this.io.to(code).emit(EVENTS.SERVER.MATCH_STATE, this._matchStatePayload(room));
    }, 1000);
  }

  _matchStatePayload(room) {
    return {
      state: room.matchState,
      countdown: room.countdown,
      matchTime: room.matchEndsAt ? Math.max(0, Math.ceil((room.matchEndsAt - Date.now()) / 1000)) : MATCH_RULES.MATCH_DURATION_SECONDS,
    };
  }

  // ── Match end / results (Parts 8-12) ────────────────────────────────────────

  endMatch(code, reason) {
    const room = this.rooms.get(code);
    if (!room || room.matchState === MATCH_STATES.ENDED) return; // already ended — ignore race between timer/kill triggers
    const simulation = this.simulations.get(code);

    room.matchState = MATCH_STATES.ENDED;
    room.clearTimers();
    simulation?.stop();
    room.rematchReady = new Set();

    const { winnerId, winnerName, winReason, standings } = this._computeResults(room, reason);
    room.winnerId = winnerId;
    room.winnerName = winnerName;
    room.winReason = winReason;

    this.io.to(code).emit(EVENTS.SERVER.MATCH_STATE, this._matchStatePayload(room));
    this.io.to(code).emit(EVENTS.SERVER.MATCH_ENDED, this._matchEndedPayload(room, standings));
    logger.info(`Match ended: room ${code} (reason: ${winReason}, winner: ${winnerName || 'none'})`);
  }

  _computeResults(room, reason) {
    const players = Array.from(room.gameState.players.values());
    const sorted = [...players].sort((a, b) => (b.kills || 0) - (a.kills || 0) || (a.deaths || 0) - (b.deaths || 0));
    const standings = sorted.map((p, i) => ({
      playerId: p.id, name: p.name, kills: p.kills || 0, deaths: p.deaths || 0, rank: i + 1,
    }));

    if (sorted.length === 0) return { winnerId: null, winnerName: null, winReason: 'draw', standings };

    const top = sorted[0];
    const second = sorted[1];
    // Deterministic tiebreak: highest kills, then lowest deaths, then draw.
    const tied = second && (top.kills || 0) === (second.kills || 0) && (top.deaths || 0) === (second.deaths || 0);
    if (tied) return { winnerId: null, winnerName: null, winReason: 'draw', standings };

    return { winnerId: top.id, winnerName: top.name, winReason: reason, standings };
  }

  _matchEndedPayload(room, standingsOverride) {
    const standings = standingsOverride || this._computeResults(room, room.winReason).standings;
    return {
      winnerId: room.winnerId,
      winnerName: room.winnerName,
      reason: room.winReason,
      standings,
    };
  }

  // ── Rematch (Parts 13-14) ────────────────────────────────────────────────────

  handleRematchRequest(socket) {
    if (this._rateLimited(socket, this._limiters.rematch, 'rematch_request')) return;

    const code = socket.data.roomCode;
    const room = code ? this.rooms.get(code) : null;
    if (!room || room.matchState !== MATCH_STATES.ENDED) return;

    room.rematchReady.add(socket.id);
    this.io.to(code).emit(EVENTS.SERVER.REMATCH_UPDATE, {
      ready: Array.from(room.rematchReady),
      total: room.players.size,
    });

    if (room.rematchReady.size >= room.players.size) {
      this._triggerRematch(code, room);
    }
  }

  _triggerRematch(code, room) {
    const oldSim = this.simulations.get(code);
    oldSim?.stop();
    const simulation = this._createSimulation(room, code);
    this.simulations.set(code, simulation);
    room.beginNewMatch(simulation.map.spawnPoints());
    logger.info(`Rematch starting: room ${code}`);
    this._startCountdown(code, room, simulation);
  }

  // ── Return to lobby (Part 15) ────────────────────────────────────────────────

  handleReturnToLobbyRequest(socket) {
    if (this._rateLimited(socket, this._limiters.returnToLobby, 'return_to_lobby_request')) return;

    const code = socket.data.roomCode;
    const room = code ? this.rooms.get(code) : null;
    if (!room)                    { socket.emit(EVENTS.SERVER.SERVER_ERROR, { message: 'You are not in a room.' }); return; }
    if (!room.isHost(socket.id))  { socket.emit(EVENTS.SERVER.SERVER_ERROR, { message: 'Only the host can return the room to the lobby.' }); return; }
    if (room.matchState !== MATCH_STATES.ENDED) { socket.emit(EVENTS.SERVER.SERVER_ERROR, { message: 'The match has not ended yet.' }); return; }

    const simulation = this.simulations.get(code);
    simulation?.stop();
    this.simulations.delete(code);
    room.resetToLobby();

    this.io.to(code).emit(EVENTS.SERVER.RETURN_TO_LOBBY, { players: room.getPlayers() });
    logger.info(`Room returned to lobby: ${code}`);
  }

  // ── Gameplay input ────────────────────────────────────────────────────────
  // Deliberately NOT rate-limited (see constructor comment) — protected
  // instead by strict validation (setInput) and match-state gating below.

  handlePlayerInput(socket, input) {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = this.rooms.get(code);
    // Parts 20/21 — the server is the sole authority on whether gameplay
    // input is currently accepted. Reject everything outside ACTIVE.
    if (!room || room.matchState !== MATCH_STATES.ACTIVE) return;
    if (!input || typeof input !== 'object') return; // malformed payload — ignore, don't throw
    this.simulations.get(code)?.setInput(socket.id, input);
  }
}
