// ExiEngine unit test — LDtk project import (Tiles/AutoLayer, IntGrid, Entities)
import { test } from "node:test";
import assert from "node:assert/strict";
import { Texture, findGridPath, ldtkEntities, ldtkIntGrid, tileMapFromLDtk } from "../../src/index.js";

function project() {
  return {
    jsonVersion: "1.5.3",
    defs: { tilesets: [{ uid: 7, identifier: "Tiles", tileGridSize: 16, padding: 0, spacing: 0, pxWid: 64, pxHei: 32 }] },
    levels: [{
      identifier: "Level_0", iid: "lvl0", worldX: 0, worldY: 0, pxWid: 64, pxHei: 32,
      layerInstances: [
        { __identifier: "Entities", __type: "Entities", __gridSize: 16, __cWid: 4, __cHei: 2, __pxTotalOffsetX: 0, __pxTotalOffsetY: 0, entityInstances: [
          { __identifier: "Player", iid: "p1", px: [24, 16], width: 16, height: 16, __pivot: [0.5, 1], __tags: ["actor"], fieldInstances: [{ __identifier: "hp", __type: "Int", __value: 3 }] },
          { __identifier: "Coin", iid: "c1", px: [48, 8], width: 8, height: 8, __pivot: [0, 0], fieldInstances: [] },
        ] },
        { __identifier: "Walls", __type: "IntGrid", __gridSize: 16, __cWid: 4, __cHei: 2, intGridCsv: [1, 0, 0, 1, 1, 1, 0, 1], autoLayerTiles: [{ px: [0, 0], src: [16, 0], t: 1, f: 0 }, { px: [48, 16], src: [0, 16], t: 4, f: 0 }], __tilesetDefUid: 7 },
        { __identifier: "Ground", __type: "Tiles", __gridSize: 16, __cWid: 4, __cHei: 2, __opacity: 0.5, __pxTotalOffsetX: 8, __pxTotalOffsetY: 4, visible: true, __tilesetDefUid: 7,
          gridTiles: [{ px: [0, 16], src: [0, 0], t: 0, f: 0 }, { px: [16, 16], src: [16, 0], t: 1, f: 1 }, { px: [32, 16], src: [32, 0], t: 2, f: 3 }, { px: [32, 16], src: [48, 0], t: 3, f: 0 }] },
      ],
    }],
  };
}
const texture = () => new Texture({ id: "ldtk-tiles", sourceWidth: 64, sourceHeight: 32 });

test("ldtk: Tiles layers become TileMaps with flips, offsets and opacity", () => {
  const map = tileMapFromLDtk(project(), { texture: texture(), layer: "Ground" });
  assert.equal(map.name, "Ground");
  assert.deepEqual([map.columns, map.rows, map.tileWidth], [4, 2, 16]);
  assert.deepEqual(Array.from(map.tiles), [-1, -1, -1, -1, 0, 1, 3, -1], "the top-most tile wins in a cell");
  assert.equal(map.tileFlags[5], 1);
  assert.equal(map.tileFlags[6], 0, "flags follow the winning tile");
  assert.deepEqual([map.position.x, map.position.y, map.alpha], [8, 4, 0.5]);
  const auto = tileMapFromLDtk(project(), { texture: texture(), layer: "Walls", level: "Level_0" });
  assert.deepEqual(Array.from(auto.tiles), [1, -1, -1, -1, -1, -1, -1, 4], "IntGrid auto-tiles render too");
});

test("ldtk: IntGrid and entities feed collision, pathfinding and spawning", () => {
  const grid = ldtkIntGrid(project(), { layer: "Walls" });
  assert.deepEqual([grid.columns, grid.rows, grid.gridSize], [4, 2, 16]);
  assert.equal(grid.get(3, 0), 1);
  assert.equal(grid.get(9, 9), 0);
  const path = findGridPath(grid.toRows(), { x: 1, y: 0 }, { x: 2, y: 1 }, { blockedValues: [1] });
  assert.equal(path.reached, true);
  const entities = ldtkEntities(project(), { level: 0 });
  assert.deepEqual(entities.map((entity) => entity.identifier), ["Player", "Coin"]);
  assert.deepEqual([entities[0].x, entities[0].left, entities[0].top, entities[0].fields.hp], [24, 16, 0, 3]);
  assert.deepEqual(entities[0].tags, ["actor"]);
  assert.equal(ldtkEntities(project(), { layer: "Missing" }).length, 0);
});

test("ldtk: invalid or unsupported data is rejected", () => {
  assert.throws(() => tileMapFromLDtk(project(), { layer: "Ground" }), /texture/);
  assert.throws(() => tileMapFromLDtk(null, { texture: texture() }), /project/);
  assert.throws(() => tileMapFromLDtk(project(), { texture: texture(), layer: "Nope" }), /not found/);
  assert.throws(() => tileMapFromLDtk(project(), { texture: texture(), level: "Level_9" }), /not found/);
  const padded = project(); padded.defs.tilesets[0].padding = 2;
  assert.throws(() => tileMapFromLDtk(padded, { texture: texture(), layer: "Ground" }), /padding/);
  const wrongGrid = project(); wrongGrid.defs.tilesets[0].tileGridSize = 8;
  assert.throws(() => tileMapFromLDtk(wrongGrid, { texture: texture(), layer: "Ground" }), /grid size/);
  const separate = project(); delete separate.levels[0].layerInstances;
  assert.throws(() => tileMapFromLDtk(separate, { texture: texture() }), /separate level files/);
  const badCsv = project(); badCsv.levels[0].layerInstances[1].intGridCsv = [1, 2];
  assert.throws(() => ldtkIntGrid(badCsv, { layer: "Walls" }), /size/);
  assert.throws(() => tileMapFromLDtk(project(), { texture: new Texture({ sourceWidth: 16, sourceHeight: 16 }), layer: "Ground" }), /TileMap/);
});
