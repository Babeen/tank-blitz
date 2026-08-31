// Server-side map state. Reuses MapGenerator from the client game (it has
// no rendering code — only grid generation and tile queries), so the server
// and every client share identical collision geometry.
import { MapGenerator } from '../../src/game/systems/MapGen.js';
import { getMapDef, spawnTilePointsFor, DEFAULT_MAP_ID } from '../../shared/protocol.js';
import { TILE } from '../../shared/gameConstants.js';

export class MapState {
  constructor() {
    this.gen = new MapGenerator();
    this.def = null;
  }

  generate(mapId = DEFAULT_MAP_ID) {
    this.def = getMapDef(mapId);
    this.gen.generate(this.def.cols, this.def.rows, this.def.theme);
    return this;
  }

  // Serializable grid for sending to clients.
  toJSON() {
    return {
      cols: this.gen.cols,
      rows: this.gen.rows,
      theme: this.def.theme,
      mapId: this.def.id,
      mapName: this.def.name,
      grid: this.gen.grid,
    };
  }

  // World-space spawn positions derived from tile coordinates.
  spawnPoints() {
    return spawnTilePointsFor(this.gen.cols, this.gen.rows).map((p) => ({
      x: p.tx * TILE + TILE / 2,
      y: p.ty * TILE + TILE / 2,
      angle: p.angle,
    }));
  }

  tileAt(px, py) { return this.gen.tileAt(px, py); }
  isSolid(t)     { return this.gen.isSolid(t); }
  isBulletBlock(t){ return this.gen.isBulletBlock(t); }
  worldW()       { return this.gen.worldW(); }
  worldH()       { return this.gen.worldH(); }
  get grid()     { return this.gen.grid; }
  get cols()     { return this.gen.cols; }
  get rows()     { return this.gen.rows; }
}
