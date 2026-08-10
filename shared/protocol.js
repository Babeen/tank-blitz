// Centralized Socket.IO event-name protocol, shared verbatim by the client
// and the server. Single source of truth — do not hardcode event strings elsewhere.

export const EVENTS = {
  CLIENT: {
    CREATE_ROOM: 'create_room',
    JOIN_ROOM: 'join_room',
    LEAVE_ROOM: 'leave_room',
    START_MATCH: 'start_match',
    PLAYER_INPUT: 'player_input',
    REJOIN_ROOM: 'rejoin_room',
    PING_REQUEST: 'ping_request',
    REMATCH_REQUEST: 'rematch_request',
    RETURN_TO_LOBBY_REQUEST: 'return_to_lobby_request',
  },
  SERVER: {
    CONNECTED: 'connected',
    ROOM_CREATED: 'room_created',
    ROOM_JOINED: 'room_joined',
    PLAYER_JOINED: 'player_joined',
    PLAYER_LEFT: 'player_left',
    ROOM_UPDATED: 'room_updated',
    GAME_START: 'game_start',
    GAME_STATE: 'game_state',
    GAME_EVENT: 'game_event',
    SERVER_ERROR: 'server_error',
    REJOIN_OK: 'rejoin_ok',
    PONG_RESPONSE: 'pong_response',
    MATCH_STATE: 'match_state',
    MATCH_ENDED: 'match_ended',
    REMATCH_UPDATE: 'rematch_update',
    RETURN_TO_LOBBY: 'return_to_lobby',
  },
};

// Server-authoritative multiplayer match lifecycle states.
// LOBBY -> COUNTDOWN -> ACTIVE -> ENDED -> (rematch -> COUNTDOWN) | (return to lobby -> LOBBY)
export const MATCH_STATES = {
  LOBBY: 'lobby',
  COUNTDOWN: 'countdown',
  ACTIVE: 'active',
  ENDED: 'ended',
};

// Tunable match configuration. Kept centralized so nothing hardcodes these
// values elsewhere in server or client code.
export const MATCH_RULES = {
  COUNTDOWN_SECONDS: 5,
  MATCH_DURATION_SECONDS: 180,
  KILLS_TO_WIN: 10,
};

// One-time gameplay events for client-side visual/audio feedback.
// The server remains authoritative — these are notifications only.
export const GAME_EVENTS = {
  PLAYER_HIT: 'player_hit',
  PLAYER_DIED: 'player_died',
  PLAYER_RESPAWNED: 'player_respawned',
  BULLET_FIRED: 'bullet_fired',
  POWERUP_PICKED: 'powerup_picked',
  DASH_STARTED: 'dash_started',
  BARREL_EXPLODED: 'barrel_exploded',
  // Fired whenever any destructible tile (brick/crate/barrel) turns to
  // T.EMPTY on the server's live grid, so every client's own map copy
  // (received once at GAME_START) can be kept in sync for both rendering
  // and local collision prediction. Without this, already-destroyed
  // obstacles keep blocking client-side movement prediction forever,
  // producing a "walk through the wall" desync once the server (which
  // has no such obstacle any more) pulls the reconciled position past it.
  TILE_DESTROYED: 'tile_destroyed',
};

export const ROOM_RULES = {
  MAX_PLAYERS: 4,
  MIN_PLAYERS_TO_START: 2,
  ROOM_CODE_LENGTH: 5,
};

// Map dimensions in tiles — server generates the map, clients receive the grid.
export const MAP_CONFIG = {
  COLS: 20,
  ROWS: 14,
  THEME: 'arena',
};

// Spawn corners in tile coordinates (converted to world coords by server).
// Cleared areas in MapGenerator.generate() guarantee these are always open.
export const SPAWN_TILE_POINTS = [
  { tx: 2, ty: 2,                    angle: 0 },
  { tx: MAP_CONFIG.COLS - 3, ty: MAP_CONFIG.ROWS - 3, angle: Math.PI },
  { tx: MAP_CONFIG.COLS - 3, ty: 2,  angle: Math.PI },
  { tx: 2,                   ty: MAP_CONFIG.ROWS - 3, angle: 0 },
];

export const PLAYER_DEFAULTS = {
  HP: 100,
  MAX_HP: 100,
};
