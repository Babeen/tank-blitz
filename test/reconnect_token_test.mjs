import assert from 'assert';
import { GameServer } from '../server/GameServer.js';
import { EVENTS } from '../shared/protocol.js';

function makeSocket(id, io) {
  return {
    id,
    data: {},
    _rooms: new Set(),
    join(code) { this._rooms.add(code); },
    leave(code) { this._rooms.delete(code); },
    emit(event, payload) { this._lastEmit = { event, payload }; this._emits = this._emits || []; this._emits.push({ event, payload }); },
    to(code) {
      return { emit: () => {} }; // broadcasts to others — irrelevant for these tests
    },
    lastOf(event) {
      return [...(this._emits || [])].reverse().find((e) => e.event === event)?.payload;
    },
  };
}

class FakeIO {
  constructor() { this.sockets = []; }
  register(socket) { this.sockets.push(socket); }
  to(code) {
    const sockets = this.sockets.filter((s) => s._rooms.has(code));
    return { emit: (event, payload) => { for (const s of sockets) s.emit(event, payload); } };
  }
  on() {}
}

function makeServer() {
  const io = new FakeIO();
  const server = new GameServer(io);
  return { io, server };
}

console.log('--- token is generated via crypto (not Math.random), long, and URL/socket-safe ---');
{
  const { io, server } = makeServer();
  const s1 = makeSocket('P1', io);
  io.register(s1);
  server.handleCreateRoom(s1);
  const created = s1.lastOf(EVENTS.SERVER.ROOM_CREATED);
  assert.ok(created?.reconnectToken, 'should receive a reconnectToken');
  const token = created.reconnectToken;

  // base64url(32 bytes) => 43 chars, no padding, no unsafe URL characters.
  assert.strictEqual(token.length, 43, `expected 43-char base64url token, got length ${token.length}`);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(token), 'token must be URL/socket-safe base64url (no +, /, or = characters)');

  // Sanity check against the *shape* of the old Math.random()-based token
  // (short, base36, always contains only [0-9a-z]) — the new token should
  // not match that pattern's typical length.
  assert.notStrictEqual(token.length, 24, 'token should not look like the old Math.random()-based format');
}

console.log('--- two generated tokens are not equal (basic unpredictability sanity check) ---');
{
  const { io, server } = makeServer();
  const s1 = makeSocket('P1', io);
  const s2 = makeSocket('P2', io);
  io.register(s1); io.register(s2);
  server.handleCreateRoom(s1);
  server.handleCreateRoom(s2);
  const t1 = s1.lastOf(EVENTS.SERVER.ROOM_CREATED).reconnectToken;
  const t2 = s2.lastOf(EVENTS.SERVER.ROOM_CREATED).reconnectToken;
  assert.notStrictEqual(t1, t2);
}

console.log('--- token is rotated on successful reconnect: old token can no longer be used ---');
{
  const { io, server } = makeServer();
  const s1 = makeSocket('P1', io);
  const s2 = makeSocket('P2', io);
  io.register(s1); io.register(s2);

  server.handleCreateRoom(s1);
  const created = s1.lastOf(EVENTS.SERVER.ROOM_CREATED);
  const code = created.roomCode;
  const originalToken = created.reconnectToken;

  server.handleJoinRoom(s2, { roomCode: code });

  // Simulate P1 dropping and reconnecting under a fresh socket id.
  const s1b = makeSocket('P1-reconnected', io);
  io.register(s1b);
  server.handleRejoin(s1b, { reconnectToken: originalToken });

  const rejoinOk = s1b.lastOf(EVENTS.SERVER.REJOIN_OK);
  assert.ok(rejoinOk, 'reconnect should succeed with the original token');
  const newToken = rejoinOk.reconnectToken;
  assert.notStrictEqual(newToken, originalToken, 'server must issue a fresh token on reconnect, not reuse the old one');

  // Replaying the OLD token must now fail — it was invalidated on rotation.
  const s1c = makeSocket('P1-replay-attempt', io);
  io.register(s1c);
  server.handleRejoin(s1c, { reconnectToken: originalToken });
  const replayError = s1c.lastOf(EVENTS.SERVER.SERVER_ERROR);
  assert.ok(replayError, 'replaying the old, already-used token must be rejected');
  assert.match(replayError.message, /invalid|expired/i);

  // The NEW token, however, still works for a subsequent legitimate reconnect.
  const s1d = makeSocket('P1-reconnected-again', io);
  io.register(s1d);
  server.handleRejoin(s1d, { reconnectToken: newToken });
  const secondRejoinOk = s1d.lastOf(EVENTS.SERVER.REJOIN_OK);
  assert.ok(secondRejoinOk, 'the freshly rotated token should still work');
}

console.log('--- an unknown/garbage token is rejected without crashing ---');
{
  const { io, server } = makeServer();
  const s1 = makeSocket('P1', io);
  io.register(s1);
  server.handleRejoin(s1, { reconnectToken: 'not-a-real-token' });
  const err = s1.lastOf(EVENTS.SERVER.SERVER_ERROR);
  assert.ok(err);
  assert.match(err.message, /invalid|expired/i);
}

console.log('--- expired token is rejected and removed from the store ---');
{
  const { io, server } = makeServer();
  const s1 = makeSocket('P1', io);
  io.register(s1);
  server.handleCreateRoom(s1);
  const created = s1.lastOf(EVENTS.SERVER.ROOM_CREATED);
  const token = created.reconnectToken;

  // Force the stored entry to look expired without waiting 5 real minutes.
  const entry = server._reconnectTokens.get(token);
  assert.ok(entry, 'token should be stored server-side');
  entry.expiresAt = Date.now() - 1000;

  const s1b = makeSocket('P1-late', io);
  io.register(s1b);
  server.handleRejoin(s1b, { reconnectToken: token });
  const err = s1b.lastOf(EVENTS.SERVER.SERVER_ERROR);
  assert.ok(err);
  assert.match(err.message, /invalid|expired/i);
  assert.strictEqual(server._reconnectTokens.has(token), false, 'expired token should be purged on use, not left dangling');
}

console.log('RECONNECT TOKEN TESTS: ALL PASSED');
