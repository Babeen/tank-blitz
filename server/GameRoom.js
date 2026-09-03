import { ROOM_RULES, PLAYER_DEFAULTS, MATCH_STATES, MAPS, DEFAULT_MAP_ID, GAME_MODES, DEFAULT_MODE_ID, getModeDef } from '../shared/protocol.js';
import { PLAYER } from '../shared/gameConstants.js';

export class GameRoom {
  constructor(code) {
    this.code = code;
    this.players = new Map(); // socketId -> { id, name, isHost, ready }
    this.matchStarted = false;
    this.gameState = { players: new Map() };

    // Host-selected map for the *next* match. Sticky across rematches —
    // only changes when the host explicitly picks a different one from
    // the lobby — and defaults to the original map so anyone who doesn't
    // touch the picker gets the same match they always got.
    this.selectedMapId = DEFAULT_MAP_ID;
    // Same sticky-default pattern for the match mode (FFA vs Team Deathmatch).
    this.selectedModeId = DEFAULT_MODE_ID;

    // ── Match lifecycle state (server-authoritative) ──────────────────────
    this.matchState = MATCH_STATES.LOBBY;
    this.countdown = 0;
    this.matchStartedAt = null;
    this.matchEndsAt = null;
    this.winnerId = null;
    this.winnerName = null;
    this.winReason = null;
    // Team-mode result fields — null/unused outside Team Deathmatch.
    this.winnerTeam = null;
    this.teamScores = null;

    // Players (by socket id) who have confirmed they want a rematch since
    // the last match ended. Cleared whenever a match starts or ends.
    this.rematchReady = new Set();

    // Timer handles owned by this room — always cleared via clearTimers()
    // so no timer from an old match can ever fire into a new one.
    this._countdownTimer = null;
    this._matchTimer = null;
  }

  addPlayer(id, name, isHost) {
    const player = { id, name, isHost, ready: true };
    this.players.set(id, player);
    return player;
  }

  removePlayer(id) {
    const player = this.players.get(id) || null;
    this.players.delete(id);
    let newHost = null;
    if (player?.isHost && this.players.size > 0) {
      newHost = this.players.values().next().value;
      newHost.isHost = true;
    }
    return { player, newHost };
  }

  getPlayers() { return Array.from(this.players.values()); }
  isFull()     { return this.players.size >= ROOM_RULES.MAX_PLAYERS; }
  isEmpty()    { return this.players.size === 0; }
  isHost(id)   { return this.players.get(id)?.isHost === true; }
  hasEnoughPlayers() { return this.players.size >= ROOM_RULES.MIN_PLAYERS_TO_START; }
  hasStarted() { return this.matchStarted; }

  /** Returns true if `mapId` is valid and was applied. */
  setMap(mapId) {
    if (!MAPS.some((m) => m.id === mapId)) return false;
    this.selectedMapId = mapId;
    return true;
  }
  getMapId() { return this.selectedMapId; }

  /** Returns true if `modeId` is valid and was applied. */
  setMode(modeId) {
    if (!GAME_MODES.some((m) => m.id === modeId)) return false;
    this.selectedModeId = modeId;
    return true;
  }
  getModeId() { return this.selectedModeId; }

  // ── Match lifecycle helpers ────────────────────────────────────────────

  clearTimers() {
    if (this._countdownTimer) { clearInterval(this._countdownTimer); this._countdownTimer = null; }
    if (this._matchTimer)     { clearInterval(this._matchTimer);     this._matchTimer = null; }
  }

  /** Fully resets match-lifecycle bookkeeping for a brand new match/rematch. */
  beginNewMatch(spawnPoints) {
    this.clearTimers();
    this.matchStarted = true;
    this.matchState = MATCH_STATES.LOBBY; // caller transitions to COUNTDOWN
    this.countdown = 0;
    this.matchStartedAt = null;
    this.matchEndsAt = null;
    this.winnerId = null;
    this.winnerName = null;
    this.winReason = null;
    this.winnerTeam = null;
    this.teamScores = null;
    this.rematchReady = new Set();
    this.buildGameState(spawnPoints);
  }

  /** Returns to the pre-match lobby state, keeping the room and players. */
  resetToLobby() {
    this.clearTimers();
    this.matchStarted = false;
    this.matchState = MATCH_STATES.LOBBY;
    this.countdown = 0;
    this.matchStartedAt = null;
    this.matchEndsAt = null;
    this.winnerId = null;
    this.winnerName = null;
    this.winReason = null;
    this.winnerTeam = null;
    this.teamScores = null;
    this.rematchReady = new Set();
  }

  start(spawnPoints) {
    this.matchStarted = true;
    this.buildGameState(spawnPoints);
  }

  buildGameState(spawnPoints) {
    const teamsEnabled = getModeDef(this.selectedModeId).teams;
    const lobbyPlayers = this.getPlayers();
    this.gameState.players = new Map();
    // North/south spawn pairing for team mode: spawnTilePointsFor() puts
    // indices 0 & 2 on the top edge and 1 & 3 on the bottom edge (see
    // shared/protocol.js), so grouping them this way spawns each team
    // together on its own side of the map instead of scattered corners.
    const teamSpawns = {
      red:  [spawnPoints[0], spawnPoints[2]].filter(Boolean),
      blue: [spawnPoints[1], spawnPoints[3]].filter(Boolean),
    };
    const teamCounts = { red: 0, blue: 0 };
    lobbyPlayers.forEach((player, index) => {
      const team = teamsEnabled ? (index % 2 === 0 ? 'red' : 'blue') : null;
      let spawn;
      if (teamsEnabled) {
        const pool = teamSpawns[team].length ? teamSpawns[team] : spawnPoints;
        spawn = pool[teamCounts[team]++ % pool.length];
      } else {
        spawn = spawnPoints[index % spawnPoints.length];
      }
      this.gameState.players.set(player.id, {
        id: player.id,
        name: player.name,
        team,
        x: spawn.x,
        y: spawn.y,
        angle: spawn.angle,
        turretAngle: spawn.angle,
        hp: PLAYER_DEFAULTS.HP,
        maxHp: PLAYER_DEFAULTS.MAX_HP,
        alive: true,
        spawning: 0,
        kills: 0,
        deaths: 0,
        weapon: 'cannon',
        ammo: { cannon: Infinity },
        shield: 0,
        fireCd: 0,
        dashCd: 0,
        dashTime: 0,
        dashDir: 0,
        hitFlash: 0,
        speedBoost: 0,
        rapidFire: 0,
        tripleShot: 0,
        radius: PLAYER.RADIUS,
        maxSpeed: PLAYER.MAX_SPEED,
        _respawning: false,
      });
    });
  }

  getGameState() {
    return Array.from(this.gameState.players.values());
  }
}
