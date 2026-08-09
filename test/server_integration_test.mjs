import { spawn } from 'child_process';
import http from 'http';
import net from 'net';
import assert from 'assert';
import { io as ioClient } from 'socket.io-client';
import { EVENTS } from '../shared/protocol.js';

// ── helpers ─────────────────────────────────────────────────────────────

/** Finds a free local TCP port so the test never collides with a fixed port. */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on('error', reject);
  });
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('request timed out')));
  });
}

async function waitForHealth(port, timeoutMs) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await get(port, '/health');
      if (res.status === 200) return true;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (lastErr) console.log('  (last connection attempt failed with:', lastErr.message, ')');
  return false;
}

/** process.env with CLIENT_URL/CLIENT_ORIGIN stripped, so a value the test
 * runner's own shell happens to have set can never leak into a child that's
 * specifically testing "what happens when CLIENT_URL is missing". */
function cleanEnv(overrides) {
  const { CLIENT_URL, CLIENT_ORIGIN, ...rest } = process.env;
  return { ...rest, ...overrides };
}

/** Spawns `node server/server.js` with the given env and captures output. */
function spawnServer(env) {
  const child = spawn('node', ['server/server.js'], {
    env,
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = { stdout: '', stderr: '', exit: null };
  child.stdout.on('data', (d) => (state.stdout += d.toString()));
  child.stderr.on('data', (d) => (state.stderr += d.toString()));
  child.on('exit', (code, signal) => { state.exit = { code, signal }; });
  return { child, state };
}

/** Guarantees the child is gone: SIGTERM first, SIGKILL if it doesn't exit in time. */
async function killAndWait(child, timeoutMs = 3000) {
  if (child.exitCode !== null || child.signalCode !== null) return; // already exited
  await new Promise((resolve) => {
    const forceKill = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      resolve();
    }, timeoutMs);
    child.once('exit', () => { clearTimeout(forceKill); resolve(); });
    child.kill('SIGTERM');
  });
}

function waitForSocketEvent(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for "${event}"`));
    }, timeoutMs);
    function onEvent(data) {
      clearTimeout(timer);
      resolve(data);
    }
    socket.once(event, onEvent);
  });
}

// ── test 1: happy path — server starts, /health works, real Socket.IO
//    connectivity (create room -> join room) works end-to-end ────────────

async function testHappyPath() {
  const port = await getFreePort();
  const { child, state } = spawnServer(cleanEnv({
    PORT: String(port),
    NODE_ENV: 'production',
    CLIENT_URL: 'http://localhost:5173',
  }));

  try {
    const up = await waitForHealth(port, 5000);
    if (!up) {
      throw new Error(
        `Server did not become healthy within 5s.\nexit=${JSON.stringify(state.exit)}\nstdout=${state.stdout}\nstderr=${state.stderr}`
      );
    }

    console.log('--- GET /health ---');
    const health = await get(port, '/health');
    assert.strictEqual(health.status, 200);
    const parsedHealth = JSON.parse(health.body);
    assert.strictEqual(parsedHealth.status, 'ok');
    assert.strictEqual(typeof parsedHealth.uptime, 'number');

    console.log('--- GET /unknown -> 404 ---');
    const missing = await get(port, '/unknown');
    assert.strictEqual(missing.status, 404);

    console.log('--- Socket.IO connect + basic multiplayer connectivity ---');
    const url = `http://127.0.0.1:${port}`;
    const clientA = ioClient(url, { transports: ['websocket'], reconnection: false, forceNew: true });
    const clientB = ioClient(url, { transports: ['websocket'], reconnection: false, forceNew: true });

    try {
      const connectedA = await waitForSocketEvent(clientA, EVENTS.SERVER.CONNECTED, 5000);
      assert.ok(connectedA.id, 'clientA should receive a connected id');

      const connectedB = await waitForSocketEvent(clientB, EVENTS.SERVER.CONNECTED, 5000);
      assert.ok(connectedB.id, 'clientB should receive a connected id');
      assert.notStrictEqual(connectedA.id, connectedB.id);

      clientA.emit(EVENTS.CLIENT.CREATE_ROOM);
      const roomCreated = await waitForSocketEvent(clientA, EVENTS.SERVER.ROOM_CREATED, 5000);
      assert.ok(roomCreated.roomCode, 'room_created should include a roomCode');
      assert.strictEqual(roomCreated.you.isHost, true);
      console.log('  room code:', roomCreated.roomCode);

      const playerJoinedPromise = waitForSocketEvent(clientA, EVENTS.SERVER.PLAYER_JOINED, 5000);
      clientB.emit(EVENTS.CLIENT.JOIN_ROOM, { roomCode: roomCreated.roomCode });
      const roomJoined = await waitForSocketEvent(clientB, EVENTS.SERVER.ROOM_JOINED, 5000);
      assert.strictEqual(roomJoined.roomCode, roomCreated.roomCode);
      assert.strictEqual(roomJoined.you.isHost, false);
      assert.strictEqual(roomJoined.players.length, 2);

      const playerJoined = await playerJoinedPromise;
      assert.strictEqual(playerJoined.players.length, 2);

      console.log('  clientA (host) and clientB both see 2 players in the room — real end-to-end Socket.IO connectivity confirmed');
    } finally {
      clientA.close();
      clientB.close();
    }

    console.log('--- SIGTERM -> graceful shutdown with clean exit ---');
    const exitPromise = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
    child.kill('SIGTERM');
    const { code } = await Promise.race([
      exitPromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('process did not exit within 3s of SIGTERM')), 3000)),
    ]);
    assert.strictEqual(code, 0, `Expected clean exit code 0, got ${code}`);

    console.log('HAPPY PATH: ALL PASSED');
  } finally {
    // Always clean up, even if an assertion above threw.
    await killAndWait(child);
  }
}

// ── test 2: fail-closed CORS — production without CLIENT_URL must refuse
//    to start, not silently allow all origins ────────────────────────────

async function testFailClosedProductionCors() {
  const port = await getFreePort();
  const { child, state } = spawnServer(cleanEnv({
    PORT: String(port),
    NODE_ENV: 'production',
    // CLIENT_URL intentionally omitted
  }));

  try {
    const exit = await new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
      setTimeout(() => resolve(null), 3000);
    });

    if (!exit) {
      throw new Error(
        `Server should have refused to start (NODE_ENV=production, no CLIENT_URL) but is still running after 3s.\nstdout=${state.stdout}\nstderr=${state.stderr}`
      );
    }
    assert.notStrictEqual(exit.code, 0, 'Expected a non-zero exit code when CLIENT_URL is missing in production');

    // Belt-and-suspenders: confirm it never actually started serving traffic.
    const stillDown = await get(port, '/health').catch((err) => err);
    assert.ok(stillDown instanceof Error, 'Health endpoint should be unreachable — the server must never have bound the port');

    console.log('  exit code:', exit.code, '(non-zero, as expected)');
    console.log('FAIL-CLOSED CORS: ALL PASSED');
  } finally {
    await killAndWait(child);
  }
}

// ── run ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== testHappyPath ===');
  await testHappyPath();

  console.log('=== testFailClosedProductionCors ===');
  await testFailClosedProductionCors();

  console.log('ALL SERVER INTEGRATION TESTS PASSED');
}

main().catch((err) => {
  console.error('SERVER INTEGRATION TEST FAILED:', err);
  process.exitCode = 1;
});
