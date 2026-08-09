# Tank Arena Blitz

A browser-based 2D tank game built with React, Vite, and HTML5 Canvas.

Modes:
- **Battle** — single-player
- **Survival** — single-player, wave survival
- **2 Player** — local, same-keyboard co-op/versus
- **Online Multiplayer** — create/join a private room by code, play a full
  server-authoritative match against up to 4 players, and see results with
  rematch/return-to-lobby support

## Architecture

```
React + Vite  ──────────────────►  Frontend (static site)
                     │
                     │  HTTPS + Secure WebSocket (Socket.IO)
                     ▼
Node.js + Socket.IO  ──────────►  Backend / game server (authoritative)
```

The frontend never simulates multiplayer gameplay — it only sends input and
renders whatever the backend broadcasts. The backend owns every multiplayer
rule (movement, damage, kills, match state, timers) and is the only thing
that decides what happens next; the two can be deployed to entirely
different domains/hosts.

## Setup

Install dependencies once from the project root:

```
npm install
```

Copy the example env file and adjust it for your machine:

```
cp .env.example .env
```

`.env` is gitignored — see `.env.example` for what each variable does. No
variable is required for local development; the code falls back to
`localhost` defaults if `.env` is missing entirely.

## Running the game locally

### 1. Frontend (dev server)

```
npm run dev
```

Opens the game at the printed local URL (typically `http://localhost:5173`).

### 2. Multiplayer server

Online Multiplayer requires the Socket.IO server to be running separately.

```
npm run server
```

Starts the lobby server on `http://localhost:4000` (configurable via `PORT`).
The frontend talks to it using `VITE_SOCKET_SERVER_URL` from `.env` (defaults
to `http://localhost:4000`). `npm run server` and `npm run server:dev` both
auto-load `.env` if present (via Node's `--env-file-if-exists`, no
`dotenv` dependency needed) — this is a local-dev convenience only; see
"Production start command" below for how the real production command differs.

For local development with auto-restart on file changes:

```
npm run server:dev
```

Both processes (`npm run dev` and `npm run server`) need to be running at the
same time for Online Multiplayer to work. Single-player, Survival, and local
2 Player do **not** require the server.

### Health check

```
GET /health
```

on the backend returns `{"status":"ok","uptime":<seconds>}` — useful for
confirming the server process is alive, and for hosting-platform liveness
probes. It intentionally returns nothing beyond that (no internal state,
room counts, or version info).

## Online Multiplayer

Online play is a complete, server-authoritative match from lobby to results:

- Create a room and get a short shareable room code
- Join a room by entering its code
- Lobby shows connected players (max 4) and who is host; live updates when
  players join or leave, with automatic host reassignment if the host leaves
- Host starts the match once at least 2 players are present and the
  connection is healthy (the Start button disables itself while
  reconnecting)
- A server-authoritative 5-second countdown (`5 4 3 2 1 GO!`) precedes every
  match — no client can start gameplay early
- Full server-authoritative simulation: movement, aiming, shooting, dashing,
  powerups, and damage, synced via client-side prediction + reconciliation
  and remote-entity interpolation
- A live scoreboard (kills/deaths) toggled with **Tab**, and a countdown
  match timer in the HUD
- A match ends when a player reaches the kill target (default 10) or the
  timer runs out (default 3 minutes); ties are broken by kills, then deaths,
  then declared a draw
- A results screen shows final standings and lets everyone vote for a
  **rematch** (all connected players must accept), or lets the host
  **return the room to the lobby** to start a new match without losing the
  room or its players
- Disconnects during a match update the scoreboard live; if only one player
  remains, they win automatically. Reconnecting players are restored to
  their in-progress match, or dropped straight into the current
  results/lobby state if the match already ended
- Application-level ping (independent of Socket.IO's own heartbeat) is
  shown in the connection badge; connection loss shows a clear retry-able
  message instead of an infinite spinner

Not yet implemented (by design, for a later milestone): matchmaking, a
public room browser, accounts, persistent rankings, voice chat, and
cosmetics.

### Project layout (multiplayer additions)

```
src/
├── components/
│   ├── MultiplayerScreen.jsx   # Create / Join UI (+ Retry on connect failure)
│   ├── LobbyScreen.jsx         # Room code, player list, start/leave
│   ├── MultiplayerGameCanvas.jsx  # Canvas + connection badge + scoreboard toggle
│   ├── CountdownOverlay.jsx    # 5..4..3..2..1..GO! overlay (visual only)
│   └── MatchResultsScreen.jsx  # Standings, rematch voting, return to lobby
├── game/multiplayer/
│   ├── MultiplayerRenderer.js         # Interpolation, drawing, scoreboard
│   └── MultiplayerInputController.js  # Prediction + reconciliation, input gating
└── network/
    └── NetworkManager.js       # All Socket.IO client logic lives here

shared/
├── protocol.js       # Event names, MATCH_STATES, MATCH_RULES, room rules
└── gameConstants.js   # Gameplay constants shared with the server

server/
├── server.js                 # HTTP + Socket.IO bootstrap, CORS, health check, shutdown
├── logger.js                  # Dev/production-aware logging
├── RateLimiter.js              # Per-socket fixed-window rate limiter
├── GameServer.js                # Socket/room orchestration + match lifecycle
├── GameRoom.js                   # Per-room lobby + match-lifecycle state
└── simulation/
    ├── GameSimulation.js       # Server-authoritative tick loop
    └── MapState.js             # Server-side map generation/collision
```

---

---

## Testing

```
node test/lifecycle_test.mjs           # full match state machine (fake sockets, no deps needed)
node test/rate_limiter_test.mjs        # rate limiter unit tests
node test/http_and_cors_test.mjs       # CORS + health route logic (real TCP, no socket.io needed)
node test/reconnect_token_test.mjs     # reconnect-token crypto/rotation/expiry (fake sockets)
node test/server_integration_test.mjs  # spawns a real server.js + real socket.io-client — needs `npm install` first
```

The first four don't need `npm install` — they exercise the game/server
logic directly (with lightweight fake sockets, or Node's built-in `http`).
`server_integration_test.mjs` is the one true end-to-end test: it spawns
the real backend on a dynamically-assigned free port, waits for `/health`,
connects two real Socket.IO clients and confirms room creation/joining
works, then verifies graceful shutdown — and separately confirms a
production server with no `CLIENT_URL` refuses to start. It always cleans
up its spawned process, even if an assertion fails.

## Deployment

This is a single repository containing both the frontend (`src/`, `index.html`,
Vite config) and the backend (`server/`), sharing `shared/`. There is no
separate `frontend/`/`backend/` folder split — both Vercel and Render deploy
from the **repository root**, just with different build/start commands.

### Quick start: Vercel (frontend) + Render (backend)

**Vercel — frontend**

| Setting | Value |
|---|---|
| Root directory | `.` (repo root) |
| Framework preset | Vite (auto-detected) |
| Build command | `npm run build` |
| Output directory | `dist` |
| Environment variable | `VITE_SOCKET_SERVER_URL=https://<your-render-backend-domain>` |

No `vercel.json` is required — the app has no client-side routes (no React
Router), so there's nothing to add SPA rewrites for, and Vite's default
static output serves correctly on Vercel as-is.

**Render — backend**

A `render.yaml` is included at the repo root (Render "Blueprint"). Or configure manually:

| Setting | Value |
|---|---|
| Root directory | `.` (repo root) |
| Runtime | Node |
| Build command | `npm install` |
| Start command | `npm start` |
| Health check path | `/health` |
| Environment variables | `NODE_ENV=production`, `CLIENT_URL=https://<your-vercel-frontend-domain>` |

`PORT` is provided automatically by Render — do not set it manually; the
server already reads `process.env.PORT` (see `server/server.js`).

**Deploy order:** deploy the backend to Render first so you have its domain,
then set `VITE_SOCKET_SERVER_URL` on Vercel to that domain and deploy the
frontend, then go back to Render and set `CLIENT_URL` to the resulting
Vercel domain and redeploy the backend once more so CORS allows it.

### Post-deployment smoke test

1. Open the deployed frontend URL
2. Create a room, copy the room code
3. Open the same URL in another browser/device, join with the code
4. Start the match (host)
5. Move, aim, shoot on both clients
6. Get a kill and confirm the scoreboard updates
7. Let the match finish (kills or timer)
8. Confirm the results screen shows correct standings
9. Vote rematch on both clients, confirm a new match starts
10. Return to lobby, confirm the room persists with both players

### Frontend

1. Install dependencies: `npm install`
2. Configure `VITE_SOCKET_SERVER_URL` to point at your deployed backend's
   real HTTPS URL (set this as an environment variable in your static host's
   dashboard, or in a `.env.production` file — do not hardcode it in source)
3. Build: `npm run build` → outputs static files to `dist/`
4. Deploy the contents of `dist/` to any static host (Netlify, Vercel,
   Cloudflare Pages, S3+CloudFront, GitHub Pages, etc.)
5. Serve it over HTTPS. Socket.IO automatically uses secure WebSocket
   (`wss://`) when the page itself is loaded over `https://` — nothing to
   configure manually, and nothing forces `ws://` in this codebase.

### Backend

1. Install dependencies: `npm install`
2. Configure environment variables on your Node host (Render, Railway,
   Fly.io, a VPS, etc.):
   - `PORT` — usually provided by the platform automatically
   - `NODE_ENV=production`
   - `CLIENT_URL` — **required in production.** Your deployed frontend's
     exact HTTPS origin (comma-separate multiple origins if you have
     staging + production frontends). If this is missing, the server
     fails closed: it logs a fatal error and refuses to start rather than
     silently allowing every origin — so a missing/misconfigured
     `CLIENT_URL` is caught immediately at boot, not discovered later.
3. Start the server: `npm start` (plain `node server/server.js` — no
   `nodemon`, no dev tooling, no `.env` file required; env vars come from
   the platform)
4. Confirm `GET https://your-backend-domain/health` returns
   `{"status":"ok",...}`

### Expected architecture in production

```
Frontend (static hosting, HTTPS)
        │
        │  wss:// (Socket.IO auto-upgrades since the page is HTTPS)
        ▼
Backend (Node.js + Socket.IO, HTTPS-terminated by the host/proxy)
```

The frontend and backend are expected to live on **different domains** —
CORS on the backend is configured via `CLIENT_URL` specifically so this
works without editing source code per deployment.

### Deployment checklist

```
[ ] Backend environment configured (PORT, NODE_ENV, CLIENT_URL)
[ ] Frontend environment configured (VITE_SOCKET_SERVER_URL)
[ ] CORS configured (CLIENT_URL matches the real frontend origin — server
    fails closed and refuses to start in production if this is missing)
[ ] Health endpoint works (GET /health → {"status":"ok"})
[ ] Production frontend builds (npm run build, no errors)
[ ] Backend starts in production (npm start, no dev tools required)
[ ] Socket.IO connection works end-to-end (frontend → backend, over HTTPS)
[ ] Create room works
[ ] Join room works
[ ] Match works (countdown → active → win condition → ended)
[ ] Results work
[ ] Rematch works
[ ] Return to lobby works
[ ] Reconnection works (drop and restore network mid-match)
```

### Not part of this stage (by design)

Deployment itself (registering a domain, provisioning hosting, actually
pushing to production), matchmaking, a public room browser, accounts,
databases, and a real anti-cheat system are all explicitly out of scope
here — this stage only makes the project *ready* to deploy.

---

### Known limitations

- Client movement prediction runs the same tile-collision checks as the
  server (not just boundary clamping), but very high latency can still
  produce brief visible corrections near walls.
- A disconnect that leaves exactly one player standing ends the match with a
  `lastStanding` reason (an addition beyond the `kills`/`time`/`draw` set),
  since the spec calls for an automatic win in that case.
- Rate limiting is basic, per-socket, in-memory flood/accident protection
  (e.g. 5 "create room" calls per 10s) — not a defense against a determined
  distributed attacker, and resets if the process restarts. Good enough for
  this stage; a production-grade deployment behind heavy abuse would want a
  shared store (e.g. Redis) instead, which was deliberately not introduced
  here per the "keep deployment simple" goal.
- Reconnect tokens (`server/GameServer.js`) are generated with
  `crypto.randomBytes(32)` (256 bits, base64url), stored server-side only,
  expire after 5 minutes, and are **rotated on every successful reconnect**
  — the token just used is invalidated immediately, so it can't be replayed
  even if it was previously observed somewhere (a log line, browser
  history, etc.). There's still no per-IP throttling on reconnect attempts
  themselves beyond the general `rejoin_room` rate limit.
- The backend is a single Node process holding all rooms in memory — there's
  no persistence and no horizontal scaling (multiple instances would each
  have their own disjoint set of rooms). Fine for this milestone; a future
  stage would need a shared room store to run more than one instance. This
  also means a server restart clears every room: players will need to
  create/join again afterward. Some hosts (including Render's free tier)
  spin the service down after inactivity and cold-start it on the next
  request, which has the same effect — expect an empty room list after a
  period of no traffic.
- `npm start` does not itself restart the process if it crashes — pair it
  with your host's process supervisor (most PaaS backends do this for you
  automatically; on a bare VPS, use something like `systemd` or `pm2`).
