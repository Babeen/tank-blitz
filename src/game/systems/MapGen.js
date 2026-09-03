import { TILE, T, THEMES } from '../constants/index.js';
import { Utils } from '../utils/index.js';

export class MapGenerator {
  constructor() {
    this.cols = 0; this.rows = 0; this.grid = []; this.theme = THEMES.arena;
  }

  generate(cols, rows, themeKey) {
    this.theme = THEMES[themeKey] || THEMES.arena;
    this.cols = cols; this.rows = rows; this.grid = [];
    for (let y = 0; y < rows; y++) {
      const row = [];
      for (let x = 0; x < cols; x++) row.push(T.EMPTY);
      this.grid.push(row);
    }
    for (let x = 0; x < cols; x++) { this.grid[0][x] = T.STEEL; this.grid[rows - 1][x] = T.STEEL; }
    for (let y = 0; y < rows; y++) { this.grid[y][0] = T.STEEL; this.grid[y][cols - 1] = T.STEEL; }
    const W = this.theme.wall, B = this.theme.brick;
    if (themeKey === 'maze') this._genMaze(cols, rows, W);
    else if (themeKey === 'arena') this._genArena(cols, rows, W);
    else this._genBlobs(cols, rows, W, B, themeKey);
    this.clearArea(1, 1, 3, 3);
    this.clearArea(cols - 4, rows - 4, cols - 2, rows - 2);
    this.clearArea(cols - 4, 1, cols - 2, 3);
    this.clearArea(1, rows - 4, 3, rows - 2);
    // Also protect the mid-edge points GameEngine.spawnPoints() uses for
    // enemy wave spawns — without this, a barrier could land directly on a
    // spawner and trap an enemy inside a wall on the tick it appears.
    const midX = Math.floor(cols / 2), midY = Math.floor(rows / 2);
    this.clearArea(midX - 1, 1, midX + 1, 3);
    this.clearArea(midX - 1, rows - 4, midX + 1, rows - 2);
    this.clearArea(1, midY - 1, 3, midY + 1);
    this.clearArea(cols - 4, midY - 1, cols - 2, midY + 1);
    this._ensureConnectivity();
    return this.grid;
  }

  // Any obstacle placement — barriers, blobs, or plain bad luck with
  // scatter() — can coincidentally wall a tile off from the rest of the
  // map. Rather than risk it (a sealed powerup, or an enemy that can never
  // reach the player), flood fill from a guaranteed-clear corner and punch
  // through the nearest solid neighbor of anything unreached. Repeated a
  // few times in case a pocket sits behind more than one layer of wall.
  _ensureConnectivity() {
    const isSolid = (t) => t === T.BRICK || t === T.STEEL || t === T.CRATE || t === T.WATER || t === T.BARREL;
    for (let pass = 0; pass < 5; pass++) {
      const visited = Array.from({ length: this.rows }, () => new Array(this.cols).fill(false));
      const stack = [[2, 2]];
      visited[2][2] = true;
      while (stack.length) {
        const [x, y] = stack.pop();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 1 || ny < 1 || nx >= this.cols - 1 || ny >= this.rows - 1) continue;
          if (visited[ny][nx] || isSolid(this.grid[ny][nx])) continue;
          visited[ny][nx] = true; stack.push([nx, ny]);
        }
      }
      let punched = false;
      for (let y = 1; y < this.rows - 1; y++) for (let x = 1; x < this.cols - 1; x++) {
        if (isSolid(this.grid[y][x]) || visited[y][x]) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 1 || ny < 1 || nx >= this.cols - 1 || ny >= this.rows - 1) continue;
          if (isSolid(this.grid[ny][nx])) { this.grid[ny][nx] = T.EMPTY; punched = true; break; }
        }
      }
      if (!punched) break; // fully connected — verified by the flood fill itself, not assumed
    }
  }

  _genBlobs(cols, rows, W, B, theme) {
    // Larger maps got the same handful of scattered obstacles as the small
    // classic one, so they read as emptier the bigger they got. Scale
    // obstacle density to map area (280 = the 20x14 classic map) so
    // Docklands/Jungle Outpost/Desert Siege feel as full as Classic Arena.
    const scale = Utils.clamp((cols * rows) / 280, 1, 4);

    // Permanent barrier walls carve the open field into distinct lanes and
    // chokepoints instead of leaving one uninterrupted box. A contestable
    // cluster in the middle gives the center of the map a reason to fight
    // over instead of being empty ground everyone just crosses.
    this._genBarriers(cols, rows, W, scale);
    this._genCenterCluster(cols, rows, B);

    const blobs = Math.round(Utils.randi(4, 6) * scale);
    for (let b = 0; b < blobs; b++) {
      const bx = Utils.randi(2, cols - 3), by = Utils.randi(2, rows - 3), w = Utils.randi(1, 3), h = Utils.randi(1, 3);
      const type = Utils.choose([W, W, B, T.CRATE]);
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const gx = bx + xx, gy = by + yy;
        if (gx > 1 && gx < cols - 2 && gy > 1 && gy < rows - 2 && this.grid[gy][gx] === T.EMPTY) this.grid[gy][gx] = type;
      }
    }
    this.scatter(Math.round(Utils.randi(6, 10) * scale), B);
    this.scatter(Math.round(Utils.randi(5, 9) * scale), T.CRATE);
    this.scatter(Math.round(Utils.randi(theme === 'forest' ? 12 : 6, theme === 'forest' ? 18 : 12) * scale), T.BUSH);
    this.scatter(Math.round(Utils.randi(theme === 'factory' ? 6 : 3, theme === 'factory' ? 10 : 6) * scale), T.BARREL);
    this.scatter(Math.round(Utils.randi(2, 4) * scale), T.OIL);
    const ponds = scale > 2.5 ? 2 : 1;
    for (let p = 0; p < ponds; p++) {
      if (Math.random() < 0.7) {
        const wx = Utils.randi(3, cols - 5), wy = Utils.randi(3, rows - 5);
        for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++)
          if (this.grid[wy + yy] && this.grid[wy + yy][wx + xx] === T.EMPTY) this.grid[wy + yy][wx + xx] = T.WATER;
      }
    }
  }

  // Short (3-6 tile) permanent walls, point-mirrored 180° around the map
  // center so diagonally-opposite spawn corners face an identical layout.
  // Segments are kept short and spaced apart on purpose: a long unbroken
  // wall would both wall off whole regions and trap the enemy AI, which
  // only does local obstacle avoidance rather than real pathfinding.
  _genBarriers(cols, rows, W, scale) {
    const count = Math.round(Utils.randi(3, 5) * Math.sqrt(scale));
    const minGap = 3;
    const placed = [];
    const rectFor = (b) => {
      const w = b.horiz ? b.len : 1, h = b.horiz ? 1 : b.len;
      return { x1: b.x - minGap, y1: b.y - minGap, x2: b.x + w - 1 + minGap, y2: b.y + h - 1 + minGap };
    };
    const overlaps = (cand) => placed.some((p) => {
      const r1 = rectFor(cand), r2 = rectFor(p);
      return !(r1.x2 < r2.x1 || r1.x1 > r2.x2 || r1.y2 < r2.y1 || r1.y1 > r2.y2);
    });
    for (let i = 0; i < count; i++) {
      const horiz = Math.random() < 0.5;
      const len = Utils.randi(3, 6);
      let cand = null;
      for (let attempt = 0; attempt < 12 && !cand; attempt++) {
        const x = Utils.randi(4, cols - 5 - (horiz ? len : 0));
        const y = Utils.randi(4, rows - 5 - (horiz ? 0 : len));
        const c = { x, y, len, horiz };
        if (!overlaps(c)) cand = c;
      }
      if (!cand) continue;
      this._placeBarrier(cand, W);
      placed.push(cand);

      // Mirror the segment through the map's center point (180° rotation).
      const mw = horiz ? cand.len : 1, mh = horiz ? 1 : cand.len;
      const mirrored = { x: cols - 1 - cand.x - mw + 1, y: rows - 1 - cand.y - mh + 1, len, horiz };
      if (!overlaps(mirrored)) { this._placeBarrier(mirrored, W); placed.push(mirrored); }
    }
  }

  _placeBarrier(b, W) {
    for (let i = 0; i < b.len; i++) {
      const gx = b.horiz ? b.x + i : b.x, gy = b.horiz ? b.y : b.y + i;
      if (gx > 1 && gx < this.cols - 2 && gy > 1 && gy < this.rows - 2) this.grid[gy][gx] = W;
    }
  }

  // Plus-shaped destructible cluster at the map's center — a contestable
  // focal point rather than a hard block, since it's the theme's `brick`
  // type and can be shot through.
  _genCenterCluster(cols, rows, B) {
    const cx = Math.floor(cols / 2), cy = Math.floor(rows / 2);
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const gx = cx + dx, gy = cy + dy;
      if (gx > 1 && gx < cols - 2 && gy > 1 && gy < rows - 2 && this.grid[gy][gx] === T.EMPTY) this.grid[gy][gx] = B;
    }
  }

  _genMaze(cols, rows, W) {
    for (let y = 2; y < rows - 2; y += 2) for (let x = 2; x < cols - 2; x += 2) {
      this.grid[y][x] = W;
      if (Math.random() < 0.6) {
        const d = Utils.choose([[1, 0], [-1, 0], [0, 1], [0, -1]]);
        const nx = x + d[0], ny = y + d[1];
        if (nx > 1 && nx < cols - 2 && ny > 1 && ny < rows - 2) this.grid[ny][nx] = W;
      }
    }
    this.scatter(4, T.CRATE); this.scatter(3, T.BARREL); this.scatter(6, T.BUSH);
  }

  _genArena(cols, rows, W) {
    const cx = Math.floor(cols / 2), cy = Math.floor(rows / 2);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++)
      if (Math.abs(i) + Math.abs(j) !== 0 && Math.abs(i) !== Math.abs(j)) this.grid[cy + j][cx + i] = W;
    for (const [qx, qy] of [[4, 3], [cols - 5, 3], [4, rows - 4], [cols - 5, rows - 4]]) {
      this.grid[qy][qx] = T.CRATE; this.grid[qy][qx + 1] = T.CRATE;
    }
    this.scatter(8, T.BRICK); this.scatter(4, T.BARREL); this.scatter(8, T.BUSH); this.scatter(3, T.OIL);
  }

  scatter(n, type) {
    for (let i = 0; i < n; i++) {
      const gx = Utils.randi(2, this.cols - 3), gy = Utils.randi(2, this.rows - 3);
      if (this.grid[gy][gx] === T.EMPTY) this.grid[gy][gx] = type;
    }
  }

  clearArea(x1, y1, x2, y2) {
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++)
      if (y > 0 && y < this.rows - 1 && x > 0 && x < this.cols - 1) this.grid[y][x] = T.EMPTY;
  }

  tileAt(px, py) {
    const gx = Math.floor(px / TILE), gy = Math.floor(py / TILE);
    if (gx < 0 || gy < 0 || gx >= this.cols || gy >= this.rows) return T.STEEL;
    return this.grid[gy][gx];
  }

  isSolid(t) { return t === T.BRICK || t === T.STEEL || t === T.CRATE || t === T.WATER || t === T.BARREL; }
  isBulletBlock(t) { return t === T.BRICK || t === T.STEEL || t === T.CRATE || t === T.BARREL; }
  worldW() { return this.cols * TILE; }
  worldH() { return this.rows * TILE; }
}
