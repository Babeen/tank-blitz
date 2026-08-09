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
    return this.grid;
  }

  _genBlobs(cols, rows, W, B, theme) {
    const blobs = Utils.randi(4, 6);
    for (let b = 0; b < blobs; b++) {
      const bx = Utils.randi(2, cols - 3), by = Utils.randi(2, rows - 3), w = Utils.randi(1, 3), h = Utils.randi(1, 3);
      const type = Utils.choose([W, W, B, T.CRATE]);
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const gx = bx + xx, gy = by + yy;
        if (gx > 1 && gx < cols - 2 && gy > 1 && gy < rows - 2) this.grid[gy][gx] = type;
      }
    }
    this.scatter(Utils.randi(6, 10), B);
    this.scatter(Utils.randi(5, 9), T.CRATE);
    this.scatter(Utils.randi(theme === 'forest' ? 12 : 6, theme === 'forest' ? 18 : 12), T.BUSH);
    this.scatter(Utils.randi(theme === 'factory' ? 6 : 3, theme === 'factory' ? 10 : 6), T.BARREL);
    this.scatter(Utils.randi(2, 4), T.OIL);
    if (Math.random() < 0.7) {
      const wx = Utils.randi(3, cols - 5), wy = Utils.randi(3, rows - 5);
      for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++)
        if (this.grid[wy + yy][wx + xx] === T.EMPTY) this.grid[wy + yy][wx + xx] = T.WATER;
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
