// ExiEngine TypeScript consumer fixture — index.d.ts'deki public API'nin
// usability from TypeScript at the syntax + execution level.
// Run with --experimental-strip-types: type imports are stripped and the JS runs.
import type {
  ExiEngine,
  Scene,
  Node,
  Sprite,
  Camera,
  Vec2,
  Texture,
  RenderTexture,
  TextureAtlas,
  SpriteBatch,
  Graphics,
  TileMap,
  ParticleEmitter,
  Input,
  Animator,
  Tween,
  PhysicsWorld,
  PhysicsBody,
  CollisionWorld,
  Collider,
  AudioManager,
  SaveStore,
  Profiler,
  Text,
  TextCache,
  GlyphAtlas,
  AnimatedSprite,
  NineSliceSprite,
  RenderGroup,
  ResizeMode,
  BlendMode,
  FilterKind,
  Point,
  ClipRect,
  AABB,
  GridPathResult,
  KTX2Info,
  CaptureFrameResult,
  SceneDocument,
} from "../../index.d.ts";

import { Scene, Sprite, Camera, clamp, Vec2, Texture, TileMap, serializeScene, deserializeScene } from "../../src/index.js";

// Type-level contract: proves these symbols exist for TS.
export type {
  ExiEngine,
  Scene,
  Node,
  Sprite,
  Camera,
  Vec2,
  Texture,
  RenderTexture,
  TextureAtlas,
  SpriteBatch,
  Graphics,
  TileMap,
  ParticleEmitter,
  Input,
  Animator,
  Tween,
  PhysicsWorld,
  PhysicsBody,
  CollisionWorld,
  Collider,
  AudioManager,
  SaveStore,
  Profiler,
  Text,
  TextCache,
  GlyphAtlas,
  AnimatedSprite,
  NineSliceSprite,
  RenderGroup,
  ResizeMode,
  BlendMode,
  FilterKind,
  Point,
  ClipRect,
  AABB,
  GridPathResult,
  KTX2Info,
  CaptureFrameResult,
};

// Executable type usage (actually runs at runtime)
export function makeScene(): Scene {
  const scene = new Scene();
  const sprite = new Sprite({ width: 16, height: 16 });
  scene.add(sprite);
  return scene;
}

export function useCamera(camera: Camera, point: Point): Point {
  return camera.screenToWorld(point.x, point.y);
}

export function useBlend(mode: BlendMode): BlendMode {
  return mode;
}

export function useFilter(kind: FilterKind): FilterKind {
  return kind;
}

export function useTiled(texture: Texture): TileMap {
  const map = { width: 2, height: 1, tilewidth: 8, tileheight: 8, layers: [{ type: "tilelayer", name: "ground", data: [1, 0] }], tilesets: [{ firstgid: 1, tiles: [{ id: 0, properties: [{ name: "solid", type: "bool", value: true }] }] }] };
  const solid: Set<number> = TileMap.tiledTileIdsWithProperty(map, "solid");
  const tileMap = TileMap.fromTiled(map, { texture, layer: "ground", zIndex: 1 });
  if (!solid.has(0) || tileMap.getTile(0, 0) !== 0) throw new Error("typecheck fixture: Tiled import failed");
  return tileMap;
}

// Run on module load: verification
if (import.meta.url) {
  const scene = makeScene();
  if (scene.children.length !== 1) throw new Error("typecheck fixture: scene build failed");
  const cam = new Camera({ width: 100, height: 100 });
  const point = useCamera(cam, { x: 10, y: 20 });
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("typecheck fixture: camera transform failed");
  if (clamp(5, 0, 1) !== 1) throw new Error("typecheck fixture: clamp failed");
  const vec = new Vec2(3, 4);
  if (vec.length() !== 5) throw new Error("typecheck fixture: Vec2 failed");
  useTiled(new Texture({ sourceWidth: 16, sourceHeight: 8 })).destroy();
  const document: SceneDocument = serializeScene(scene);
  if (!(deserializeScene(document) instanceof Scene)) throw new Error("typecheck fixture: scene serialization failed");
  console.log("typecheck fixture: passed");
}
