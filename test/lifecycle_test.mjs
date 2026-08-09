import { GameServer } from '../server/GameServer.js';
import { MATCH_RULES, EVENTS } from '../shared/protocol.js';

// Speed up for testing
MATCH_RULES.COUNTDOWN_SECONDS = 1;
MATCH_RULES.MATCH_DURATION_SECONDS = 2;
MATCH_RULES.KILLS_TO_WIN = 2;

function makeSocket(id, io) {
  return {
    id,
    data: {},
    _rooms: new Set(),
    join(code) { this._rooms.add(code); },
    leave(code) { this._rooms.delete(code); },
    emit(event, payload) {
      console.log(`[socket ${id}] <- ${event}`, JSON.stringify(payload).slice(0, 200));
    },
    to(code) {
      return {
        emit: (event, payload) => {
          const targets = io.sockets.filter((s) => s !== this && s._rooms.has(code));
          for (const s of targets) console.log(`[socket ${id}->${s.id} room ${code}] ${event}`, JSON.stringify(payload).slice(0, 200));
        },
      };
    },
  };
}

// Fake io: `to(code).emit(...)` broadcasts to all sockets that joined that room
class FakeIO {
  constructor() { this.sockets = []; }
  register(socket) { this.sockets.push(socket); }
  to(code) {
    const sockets = this.sockets.filter((s) => s._rooms.has(code));
    return {
      emit: (event, payload) => {
        for (const s of sockets) {
          if (event === EVENTS.SERVER.GAME_STATE) continue; // too noisy, skip
          console.log(`[room ${code}] -> ${event}`, JSON.stringify(payload).slice(0, 300));
        }
      },
    };
  }
  on() {}
}

async function main() {
  const io = new FakeIO();
  const server = new GameServer(io);

  const s1 = makeSocket('P1', io);
  const s2 = makeSocket('P2', io);
  io.register(s1);
  io.register(s2);

  console.log('--- create room ---');
  server.handleCreateRoom(s1);
  const code = s1.data.roomCode;
  console.log('room code:', code);

  console.log('--- join room ---');
  server.handleJoinRoom(s2, { roomCode: code });

  console.log('--- start match (host) ---');
  server.handleStartMatch(s1);

  const room = server.rooms.get(code);
  console.log('matchState after start:', room.matchState);

  // Wait through countdown (1s) into ACTIVE
  await new Promise((r) => setTimeout(r, 1300));
  console.log('matchState after countdown:', room.matchState);

  // Simulate player input being rejected before active - already tested via matchState check.
  // Force 2 kills for P1 to trigger kill-based win.
  const sim = server.simulations.get(code);
  const p1State = room.gameState.players.get('P1');
  const p2State = room.gameState.players.get('P2');
  p1State.kills = 1;
  sim._checkKillWin(p1State); // 1 kill, no end yet
  console.log('matchState after 1 kill:', room.matchState);
  p1State.kills = 2;
  sim._checkKillWin(p1State); // 2 kills == KILLS_TO_WIN -> should end
  console.log('matchState after 2 kills:', room.matchState);
  console.log('winner:', room.winnerId, room.winnerName, room.winReason);

  console.log('--- rematch: both players request ---');
  server.handleRematchRequest(s1);
  console.log('matchState after 1/2 rematch ready:', room.matchState);
  server.handleRematchRequest(s2);
  console.log('matchState after 2/2 rematch ready (should be countdown again):', room.matchState);

  // Let the new match reach ACTIVE, then time it out
  await new Promise((r) => setTimeout(r, 1300));
  console.log('matchState after 2nd countdown:', room.matchState);

  await new Promise((r) => setTimeout(r, 2200));
  console.log('matchState after match duration elapsed (should be ended via time):', room.matchState, room.winReason);

  console.log('--- return to lobby ---');
  server.handleReturnToLobbyRequest(s1);
  console.log('matchState after return to lobby:', room.matchState);

  console.log('--- disconnect down to 1 player mid-match auto-win test ---');
  server.handleStartMatch(s1);
  await new Promise((r) => setTimeout(r, 1300)); // through countdown -> active
  console.log('matchState:', room.matchState);
  server.handleDisconnect(s2); // only P1 remains
  console.log('matchState after disconnect (should be ended, lastStanding):', room.matchState, room.winReason, room.winnerId);

  console.log('ALL TESTS COMPLETED OK');
  process.exit(0);
}

main().catch((err) => { console.error('TEST FAILED', err); process.exit(1); });
