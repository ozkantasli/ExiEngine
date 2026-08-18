// ExiEngine TypeScript consumer fixture — index.d.ts'deki public API'nin
// TS tarafından kullanılabilirliğini sözdizimi + çalıştırma düzeyinde doğrular.
// --experimental-strip-types ile çalıştırılır: tip importları kaldırılır, JS çalışır.
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
} from "../../index.d.ts";

import { Scene, Sprite, Camera, clamp, Vec2 } from "../../src/index.js";

// Tip düzeyinde sözleşme: bu sembollerin TS'te mevcut olduğunu kanıtlar.
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

// Çalıştırılabilir tip kullanımı (runtime'da gerçekten koşar)
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

// Modül yüklendiğinde çalıştır: doğrulama
if (import.meta.url) {
  const scene = makeScene();
  if (scene.children.length !== 1) throw new Error("typecheck fixture: scene build failed");
  const cam = new Camera({ width: 100, height: 100 });
  const point = useCamera(cam, { x: 10, y: 20 });
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("typecheck fixture: camera transform failed");
  if (clamp(5, 0, 1) !== 1) throw new Error("typecheck fixture: clamp failed");
  const vec = new Vec2(3, 4);
  if (vec.length() !== 5) throw new Error("typecheck fixture: Vec2 failed");
  console.log("typecheck fixture: passed");
}
