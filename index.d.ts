export type RendererKind = "auto" | "webgpu" | "webgl2";
export type ResizeMode = "resize" | "contain" | "cover";
export type BlendMode = "normal" | "additive" | "multiply";
export type FilterKind = "none" | "grayscale" | "invert" | "brightness" | "sepia" | "contrast" | "saturate";
export type PostProcessEffectKind = Exclude<FilterKind, "none">;
export interface PostProcessEffect { filter: PostProcessEffectKind; amount?: number; }
export type Point = { x: number; y: number };
export type ClipRect = { x: number; y: number; width: number; height: number };
export type EasingFunction = (value: number) => number;
export const MAX_WORLD_COORDINATE: number;
export const MAX_GRID_PATH_CELLS: number;
export type GridPathInput = Point | readonly [number, number];
export interface GridPathOptions {
  diagonal?: boolean;
  allowCornerCutting?: boolean;
  blockedValues?: readonly unknown[];
  maxNodes?: number;
}
export interface GridPathResult {
  path: Point[];
  reached: boolean;
  expanded: number;
  truncated: boolean;
}
export function findGridPath(grid: readonly (readonly unknown[])[], start: GridPathInput, goal: GridPathInput, options?: GridPathOptions): GridPathResult;
export interface EnginePointerEvent {
  type: "pointerdown" | "pointerup" | "pointercancel" | "pointermove" | "pointerenter" | "pointerleave" | "wheel";
  target: Node; currentTarget: Node | null; bubbles: boolean; defaultPrevented: boolean; propagationStopped: boolean;
  worldX: number; worldY: number;
  pointerId: number | null; pointerType: string;
  button: number; buttons: number; wheelX: number; wheelY: number;
  stopPropagation(): void;
  preventDefault(): void;
}
export type PointerHandler = (event: EnginePointerEvent) => void;
export type NodeUpdateHandler = (delta: number, node: Node) => void;
export interface EngineFocusEvent { type: "focus" | "blur"; target: Node; currentTarget: Node | null; }
export interface EngineKeyEvent {
  type: "keydown"; target: Node | null; currentTarget: Node | null; bubbles: boolean; defaultPrevented: boolean; propagationStopped: boolean;
  key: string; code: string; repeat: boolean; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean;
  stopPropagation(): void;
  preventDefault(): void;
}
export type FocusHandler = (event: EngineFocusEvent) => void;
export type KeyDownHandler = (event: EngineKeyEvent) => void;

export interface NodeOptions {
  name?: string;
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  zIndex?: number;
  visible?: boolean;
  alpha?: number;
  filter?: FilterKind;
  filterAmount?: number;
  cullable?: boolean;
  cullBounds?: ClipRect | null;
  clipRect?: ClipRect | null;
  maskRect?: ClipRect | null;
  maskTexture?: Texture | null;
  hitArea?: ClipRect | null;
  blendMode?: BlendMode;
  interactive?: boolean;
  onPointerDown?: PointerHandler | null;
  onPointerUp?: PointerHandler | null;
  onPointerCancel?: PointerHandler | null;
  onPointerMove?: PointerHandler | null;
  onPointerEnter?: PointerHandler | null;
  onPointerLeave?: PointerHandler | null;
  onWheel?: PointerHandler | null;
  onUpdate?: NodeUpdateHandler | null;
  focusable?: boolean;
  tabIndex?: number;
  onFocus?: FocusHandler | null;
  onBlur?: FocusHandler | null;
  onKeyDown?: KeyDownHandler | null;
  layout?: NodeLayout | null;
}
export interface NodeLayout {
  left?: number | null; top?: number | null; right?: number | null; bottom?: number | null;
  width?: number | null; height?: number | null;
  offsetX?: number; offsetY?: number;
  anchorX?: number; anchorY?: number;
}

export class Vec2 {
  x: number; y: number;
  constructor(x?: number, y?: number);
  set(x: number, y?: number): this;
  copy(value: Vec2): this;
  clone(): Vec2;
  add(value: Vec2): this;
  subtract(value: Vec2): this;
  multiplyScalar(value: number): this;
  length(): number;
  lengthSquared(): number;
  normalize(): this;
  dot(other: Vec2): number;
  distanceTo(other: Vec2): number;
  distanceSquared(other: Vec2): number;
  angle(): number;
  rotate(radians: number): this;
  equals(other: Vec2, epsilon?: number): boolean;
}

export class Mat3 {
  a: number; b: number; c: number; d: number; tx: number; ty: number;
  constructor();
  identity(): this;
  setTransform(position: Vec2, scale: Vec2, rotation: number): this;
  multiply(parent: Mat3, local: Mat3): this;
  transformPoint(x: number, y: number, out?: Point): Point;
}

export class Node {
  id: string; name: string; parent: Node | null; children: Node[];
  position: Vec2; scale: Vec2; rotation: number; zIndex: number; blendMode: BlendMode;
  visible: boolean; alpha: number; worldAlpha: number; filter: FilterKind; filterAmount: number; worldFilter: FilterKind; worldFilterAmount: number; cullable: boolean; cullBounds: ClipRect | null; clipRect: ClipRect | null; maskRect: ClipRect | null; maskTexture: Texture | null; worldMaskTexture: Texture | null; worldMaskRect: ClipRect | null; hitArea: ClipRect | null; renderClip: ClipRect | null;
  interactive: boolean;
  onPointerDown: PointerHandler | null; onPointerUp: PointerHandler | null; onPointerCancel: PointerHandler | null;
  onPointerMove: PointerHandler | null; onPointerEnter: PointerHandler | null; onPointerLeave: PointerHandler | null; onWheel: PointerHandler | null; onUpdate: NodeUpdateHandler | null;
  focusable: boolean; tabIndex: number; focused: boolean; onFocus: FocusHandler | null; onBlur: FocusHandler | null; onKeyDown: KeyDownHandler | null; layout: NodeLayout | null;
  destroyed: boolean; isRenderable?: boolean;
  constructor(options?: NodeOptions);
  add<T extends Node>(...nodes: T[]): T | T[];
  remove(node: Node): boolean;
  setClipRect(rect: ClipRect | null): this;
  clearClipRect(): this;
  setMaskRect(rect: ClipRect | null): this;
  clearMaskRect(): this;
  setMaskTexture(texture: Texture | null): this;
  clearMaskTexture(): this;
  setCullBounds(rect: ClipRect | null): this;
  clearCullBounds(): this;
  setHitArea(rect: ClipRect | null): this;
  setAlpha(value: number): this;
  setFilter(filter: FilterKind, amount?: number): this;
  clearFilter(): this;
  setBlendMode(mode: BlendMode): this;
  setInteractive(value: boolean): this;
  setPointerHandlers(options?: { onPointerDown?: PointerHandler | null; onPointerUp?: PointerHandler | null; onPointerCancel?: PointerHandler | null; onPointerMove?: PointerHandler | null; onPointerEnter?: PointerHandler | null; onPointerLeave?: PointerHandler | null; onWheel?: PointerHandler | null }): this;
  setUpdateHandler(handler?: NodeUpdateHandler | null): this;
  setFocusHandlers(options?: { onFocus?: FocusHandler | null; onBlur?: FocusHandler | null; onKeyDown?: KeyDownHandler | null }): this;
  setFocusable(value: boolean, tabIndex?: number): this;
  setLayout(layout: NodeLayout | null): this;
  clearLayout(): this;
  containsPoint(worldX: number, worldY: number): boolean;
  isAncestorOf(node: Node): boolean;
  update(delta: number): void;
  updateWorldMatrix(parentMatrix?: Mat3 | null, parentZ?: number, parentWorldVersion?: number, parentAlpha?: number, parentFilter?: FilterKind, parentFilterAmount?: number, parentMaskTexture?: Texture | null, parentMaskRect?: ClipRect | null): void;
  collectRenderables(output: Node[], inheritedVisible?: boolean, inheritedClip?: ClipRect | null, camera?: Camera | null, width?: number, height?: number, cullStats?: { value: number } | null, scratch?: unknown, offscreenRoot?: boolean): void;
  collectHitTestables(output: Node[], inheritedVisible?: boolean): void;
  applyLayout(viewportWidth: number, viewportHeight: number): this;
  collectFocusables(output: Node[], inheritedVisible?: boolean, limit?: number): void;
  traverse(callback: (node: Node) => void): void;
  find(predicate: (node: Node) => boolean): Node | null;
  findByName(name: string): Node | null;
  destroy(): void;
}
export class Scene extends Node {
  pick(worldX: number, worldY: number, predicate?: ((node: Node) => boolean) | null): Node | null;
}

export class Camera {
  position: Vec2; zoom: number; rotation: number; width: number; height: number; pixelRatio: number; roundPixels: boolean; bounds: ClipRect | null;
  viewportX: number; viewportY: number; viewportWidth: number; viewportHeight: number;
  followTarget: Point | { position: Point } | null; followOffset: Vec2; followDeadzone: Vec2; followSmoothing: number;
  readonly isShaking: boolean;
  constructor(options?: { x?: number; y?: number; zoom?: number; rotation?: number; width?: number; height?: number; pixelRatio?: number; roundPixels?: boolean; bounds?: ClipRect | null });
  normalize(): this;
  setViewport(width: number, height: number): this;
  setScreenViewport(x: number, y: number, width: number, height: number): this;
  isScreenPointInViewport(x: number, y: number): boolean;
  setPixelRatio(value: number): this;
  setRoundPixels(value: boolean): this;
  setBounds(bounds: ClipRect): this;
  clearBounds(): this;
  zoomAt(screenX: number, screenY: number, zoom: number): this;
  clampToBounds(): this;
  follow(target: Point | { position: Point }, options?: { offsetX?: number; offsetY?: number; smoothing?: number; deadzoneWidth?: number; deadzoneHeight?: number }): this;
  clearFollow(): this;
  shake(amplitude?: number, duration?: number, options?: { frequency?: number }): this;
  clearShake(): this;
  update(delta?: number): this;
  worldToScreen(x: number, y: number, out?: Point): Point;
  screenToWorld(x: number, y: number, out?: Point): Point;
  getVisibleBounds(out?: ClipRect): ClipRect;
}

export interface TextureOptions {
  id?: string;
  source?: CanvasImageSource | null;
  width?: number;
  height?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  baseTexture?: Texture | null;
  u0?: number; v0?: number; u1?: number; v1?: number;
  filter?: "linear" | "nearest";
}
export class Texture {
  static white: Texture;
  id: string; source: CanvasImageSource | null; baseTexture: Texture;
  width: number; height: number; sourceWidth: number; sourceHeight: number;
  u0: number; v0: number; u1: number; v1: number; version: number; destroyed: boolean;
  filter: "linear" | "nearest";
  constructor(options?: TextureOptions);
  static fromImage(source: CanvasImageSource, options?: TextureOptions): Texture;
  subTexture(options: { x: number; y: number; width: number; height: number; id?: string }): Texture;
  setFilter(filter: "linear" | "nearest"): this;
  markDirty(): this;
  updateSource(source: CanvasImageSource): this;
  destroy(): void;
}
export interface RenderTextureOptions { id?: string; width: number; height: number; filter?: "linear" | "nearest"; }
export class RenderTexture extends Texture {
  readonly renderTarget: true;
  constructor(options: RenderTextureOptions);
  resize(width: number, height: number): this;
  subTexture(options: { x: number; y: number; width: number; height: number; id?: string }): Texture;
  updateSource(source: CanvasImageSource): this;
}

export interface RenderGroupOptions extends NodeOptions {
  width?: number; height?: number;
  target?: RenderTexture | null;
  camera?: Camera | null;
  effects?: PostProcessEffect[];
}
export class RenderGroup extends Node {
  target: RenderTexture; camera: Camera; width: number; height: number;
  effects: readonly PostProcessEffect[];
  constructor(options?: RenderGroupOptions);
  resize(width: number, height: number): this;
  setEffects(effects?: PostProcessEffect[]): this;
  clearEffects(): this;
  getEffects(): readonly PostProcessEffect[];
  getRenderCamera(): Camera;
}

export interface TextureFrame { x: number; y: number; width: number; height: number; }
export interface GridAtlasOptions {
  frameWidth: number; frameHeight: number; columns: number; rows: number;
  marginX?: number; marginY?: number; spacingX?: number; spacingY?: number;
  names?: string[] | null; maxFrames?: number;
}
export type AtlasPackSource = CanvasImageSource | Texture;
export interface AtlasPackEntry { name: string; source: AtlasPackSource; }
export interface AtlasPackOptions {
  padding?: number; maxWidth?: number; maxHeight?: number; maxPixels?: number; id?: string;
}
export interface TextureAtlasClipOptions {
  frameRate?: number; loop?: boolean; pingPong?: boolean; playing?: boolean;
}
export interface TextureAtlasClip {
  frames: Texture[]; frameRate: number; loop: boolean; pingPong: boolean; playing: boolean;
}
export class TextureAtlas {
  texture: Texture; frames: Map<string, TextureFrame>; destroyed: boolean;
  constructor(texture: Texture, frames: Record<string, TextureFrame>);
  get(name: string): Texture;
  getFrames(names: readonly string[]): Texture[];
  getClip(names: readonly string[], options?: TextureAtlasClipOptions): TextureAtlasClip;
  has(name: string): boolean;
  destroy(): void;
  static fromJSON(texture: Texture, data: unknown, options?: { maxFrames?: number }): TextureAtlas;
  static fromGrid(texture: Texture, options: GridAtlasOptions): TextureAtlas;
  static pack(entries: AtlasPackEntry[], options?: AtlasPackOptions): TextureAtlas;
}

export interface SpriteOptions extends NodeOptions {
  texture?: Texture;
  width?: number; height?: number;
  anchorX?: number; anchorY?: number;
  tint?: number | string; alpha?: number; flipX?: boolean; flipY?: boolean;
}
export class Sprite extends Node {
  texture: Texture; width: number; height: number;
  anchor: Point; tint: number | string; alpha: number; flipX: boolean; flipY: boolean;
  constructor(options?: SpriteOptions);
  setTexture(texture: Texture, options?: { width?: number; height?: number }): this;
  setTint(tint: number | string): this;
  setFlip(flipX: boolean, flipY?: boolean): this;
  getLocalBounds(): { x: number; y: number; width: number; height: number };
}
export interface NineSliceSpriteOptions extends SpriteOptions {
  left?: number; right?: number; top?: number; bottom?: number;
}
export class NineSliceSprite extends Sprite {
  left: number; right: number; top: number; bottom: number;
  constructor(options?: NineSliceSpriteOptions);
  setBorders(options?: { left?: number; right?: number; top?: number; bottom?: number }): this;
  setSize(width: number, height?: number): this;
  getLocalBounds(): { x: number; y: number; width: number; height: number };
}
export interface TextCacheOptions { maxEntries?: number; maxPixels?: number; }
export class TextCache {
  maxEntries: number; maxPixels: number; readonly size: number;
  constructor(options?: TextCacheOptions);
  clear(): number;
}
export interface GlyphAtlasOptions {
  width?: number; height?: number; maxEntries?: number; maxPixels?: number; padding?: number;
}
export class GlyphAtlas {
  width: number; height: number; maxEntries: number; maxPixels: number; padding: number; destroyed: boolean; readonly size: number;
  constructor(options?: GlyphAtlasOptions);
  getInfo(): { width: number; height: number; size: number; maxEntries: number; maxPixels: number; usedPixels: number; complexScriptFallbacks: number; destroyed: boolean };
  clear(): this;
  destroy(): void;
}
export interface TextOptions extends NodeOptions {
  text?: string; font?: string; fill?: string; stroke?: string | null; strokeWidth?: number;
  align?: "left" | "center" | "right"; baseline?: "top" | "middle" | "alphabetic" | "bottom";
  lineHeight?: number; padding?: number; resolution?: number; maxWidth?: number; wordWrap?: boolean; cache?: TextCache | null; glyphAtlas?: GlyphAtlas | null;
}
export class Text extends Sprite {
  text: string; font: string; fill: string; stroke: string | null; strokeWidth: number;
  align: "left" | "center" | "right"; baseline: "top" | "middle" | "alphabetic" | "bottom";
  lineHeight: number; padding: number; resolution: number; maxWidth: number; wordWrap: boolean; cache: TextCache | null; glyphAtlas: GlyphAtlas | null; canvas: HTMLCanvasElement | OffscreenCanvas;
  constructor(options?: TextOptions);
  setText(value: string): this;
  setStyle(options?: Omit<TextOptions, keyof NodeOptions | "text">): this;
  redraw(): this;
}
export interface AnimatedSpriteOptions extends SpriteOptions {
  frames: readonly Texture[];
  frameRate?: number; loop?: boolean; pingPong?: boolean; playing?: boolean;
  onComplete?: ((sprite: AnimatedSprite) => void) | null;
  onLoop?: ((sprite: AnimatedSprite) => void) | null;
  onFrameChange?: ((sprite: AnimatedSprite, frame: number) => void) | null;
}
export class AnimatedSprite extends Sprite {
  readonly frames: ReadonlyArray<Texture>; frameRate: number; loop: boolean; pingPong: boolean; playing: boolean; direction: number;
  onComplete: ((sprite: AnimatedSprite) => void) | null; onLoop: ((sprite: AnimatedSprite) => void) | null; onFrameChange: ((sprite: AnimatedSprite, frame: number) => void) | null; currentFrame: number; elapsed: number;
  constructor(options: AnimatedSpriteOptions);
  setFrames(frames: readonly Texture[]): this;
  gotoFrame(index: number): this;
  play(): this;
  stop(): this;
  update(delta: number): void;
}
export interface SpriteBatchSpriteOptions {
  texture?: Texture;
  x?: number; y?: number; width?: number; height?: number;
  anchorX?: number; anchorY?: number; rotation?: number;
  tint?: number | string; alpha?: number; flipX?: boolean; flipY?: boolean;
  animation?: SpriteBatchAnimationOptions | null;
}
export interface SpriteBatchAnimationOptions {
  frames: Texture[];
  frameRate?: number; loop?: boolean; pingPong?: boolean; playing?: boolean; currentFrame?: number;
  onComplete?: ((batch: SpriteBatch, index: number) => void) | null;
  onLoop?: ((batch: SpriteBatch, index: number) => void) | null;
  onFrameChange?: ((batch: SpriteBatch, index: number, frame: number) => void) | null;
}
export interface SpriteBatchAnimatedSpriteOptions extends SpriteBatchSpriteOptions, Omit<SpriteBatchAnimationOptions, "frames"> {
  frames: Texture[];
}
export interface SpriteBatchOptions extends NodeOptions { texture?: Texture; chunkSize?: number; spatialCulling?: boolean; cellSize?: number; instanced?: boolean; gpuCulling?: boolean; }
export class SpriteBatch extends Node {
  texture: Texture; chunkSize: number; spatialCulling: boolean; cellSize: number; instanced: boolean; gpuCulling: boolean; readonly sprites: ReadonlyArray<SpriteBatchSpriteOptions>; readonly count: number;
  constructor(options?: SpriteBatchOptions);
  addSprite(options?: SpriteBatchSpriteOptions): number;
  addAnimatedSprite(options: SpriteBatchAnimatedSpriteOptions): number;
  addSprites(options?: SpriteBatchSpriteOptions[]): this;
  setSprite(index: number, options?: SpriteBatchSpriteOptions): boolean;
  setSpriteAnimation(index: number, options?: SpriteBatchAnimationOptions | null): boolean;
  playSprite(index: number): boolean;
  stopSprite(index: number): boolean;
  gotoSpriteFrame(index: number, frame: number): boolean;
  updateAnimations(delta: number): this;
  markDirty(): this;
  removeSprite(index: number): boolean;
  clear(): this;
  setTexture(texture: Texture): this;
  setFrame(texture: Texture): this;
  getLocalBounds(): { x: number; y: number; width: number; height: number };
}

export interface GraphicsStyle { fill?: number | string; alpha?: number; segments?: number; }
export interface GraphicsOptions extends NodeOptions { staticCache?: boolean; }
export class Graphics extends Node {
  commands: unknown[];
  staticCache: boolean;
  constructor(options?: GraphicsOptions);
  clear(): this;
  rect(x: number, y: number, width: number, height: number, options?: GraphicsStyle): this;
  circle(x: number, y: number, radius: number, options?: GraphicsStyle): this;
  ellipse(x: number, y: number, radiusX: number, radiusY: number, options?: GraphicsStyle): this;
  triangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, options?: GraphicsStyle): this;
  roundedRect(x: number, y: number, width: number, height: number, radius: number, options?: GraphicsStyle): this;
  line(x1: number, y1: number, x2: number, y2: number, width?: number, options?: GraphicsStyle): this;
  strokeRect(x: number, y: number, width: number, height: number, lineWidth?: number, options?: GraphicsStyle): this;
  strokeCircle(x: number, y: number, radius: number, lineWidth?: number, options?: GraphicsStyle): this;
  polygon(points: ArrayLike<number>, options?: GraphicsStyle): this;
  getLocalBounds(): { x: number; y: number; width: number; height: number };
}

export interface ParticleOptions {
  x?: number; y?: number; vx?: number; vy?: number; lifetime?: number;
  size?: number; tint?: number | string; alpha?: number;
}
export interface ParticleEmitterOptions extends NodeOptions {
  texture?: Texture; maxParticles?: number; rate?: number;
  gravityX?: number; gravityY?: number; lifetime?: number; size?: number;
  tint?: number | string; alpha?: number; random?: () => number; instanced?: boolean; gpuCulling?: boolean;
}
export interface ParticleBurstOptions extends ParticleOptions {
  minSpeed?: number;
  maxSpeed?: number;
}
export class ParticleEmitter extends Node {
  texture: Texture; instanced: boolean; gpuCulling: boolean; particles: Array<Record<string, number | string>>;
  readonly count: number;
  constructor(options?: ParticleEmitterOptions);
  clear(): this;
  burst(count?: number, options?: ParticleBurstOptions): number;
  emit(count?: number, options?: ParticleOptions): number;
  update(delta: number): void;
}

export interface TileCollisionRect { x: number; y: number; width: number; height: number; }
export type TileSolidPredicate = (tileIndex: number, x: number, y: number) => boolean;
export interface TileMapTileOptions { flipX?: boolean; flipY?: boolean; }
export interface TileMapStaticBodies {
  readonly tileMap: TileMap; readonly physicsWorld: PhysicsWorld; readonly bodies: ReadonlyArray<PhysicsBody>; readonly nodes: ReadonlyArray<Node>; readonly destroyed: boolean;
  rebuild(): this;
  destroy(): void;
}
export interface TileMapOptions extends NodeOptions {
  texture?: Texture; tileWidth: number; tileHeight: number; columns: number; rows: number; staticCache?: boolean; instanced?: boolean; gpuCulling?: boolean; cullTiles?: boolean;
}
export class TileMap extends Node {
  texture: Texture; tileWidth: number; tileHeight: number; columns: number; rows: number;
  staticCache: boolean; instanced: boolean; gpuCulling: boolean; cullTiles: boolean;
  tiles: Int32Array;
  constructor(options: TileMapOptions);
  index(x: number, y: number): number;
  inBounds(x: number, y: number): boolean;
  setTile(x: number, y: number, tileIndex: number, options?: TileMapTileOptions): this;
  getTile(x: number, y: number): number;
  setTiles(values: ArrayLike<number>): this;
  setRegion(x: number, y: number, width: number, height: number, values: ArrayLike<number>): this;
  rebuild(): this;
  getCollisionRects(solidTiles?: ReadonlySet<number> | TileSolidPredicate | null, out?: TileCollisionRect[]): TileCollisionRect[];
  createStaticBodies(physicsWorld: PhysicsWorld, options?: { solidTiles?: ReadonlySet<number> | TileSolidPredicate | null; tag?: string; layer?: number; mask?: number }): TileMapStaticBodies;
}

export interface PointerState { pointerId: number | null; type: string; x: number; y: number; buttons: number; pressed: number; released: number; cancelled: number; moved: boolean; wheelX: number; wheelY: number; button: number; }
export type InputBinding = string | { type: "key"; code: string } | { type: "pointer"; button: number } | { type: "gamepad"; index?: number; button: number };
export type InputActionMap = Record<string, InputBinding | InputBinding[]>;
export type InputAxisBinding = { type: "key-axis"; positive: string; negative: string; scale?: number } | { type: "gamepad-axis"; index?: number; axis: number; deadzone?: number; scale?: number };
export type InputAxisMap = Record<string, InputAxisBinding | InputAxisBinding[]>;
export interface GamepadSnapshot { index: number; id: string; connected: boolean; axes: number[]; buttons: boolean[]; pressed: boolean[]; released: boolean[]; }
export type GamepadHandler = (gamepad: GamepadSnapshot) => void;
export interface GamepadRumbleOptions { duration?: number; strongMagnitude?: number; weakMagnitude?: number; }
export type InputInjectionKeyOptions = { key?: string; repeat?: boolean; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean };
export type InputInjectionPointerOptions = { x?: number; y?: number; pointerId?: number; pointerType?: string; button?: number; deltaX?: number; deltaY?: number };
export type InputInjectionEvent =
  | ({ type: "keydown"; code: string } & InputInjectionKeyOptions)
  | { type: "keyup"; code: string }
  | ({ type: "pointermove" | "pointerdown" | "pointerup" | "pointercancel" | "wheel" } & InputInjectionPointerOptions);
export class Input {
  pointer: PointerState;
  readonly pointerWorld: Point;
  activePointerId: number | null;
  readonly destroyed: boolean;
  readonly pointers: Map<number, PointerState>;
  constructor(canvas: HTMLCanvasElement, options?: { actions?: InputActionMap | null; axes?: InputAxisMap | null; onKeyDown?: ((event: KeyboardEvent) => void) | null; onGamepadConnected?: GamepadHandler | null; onGamepadDisconnected?: GamepadHandler | null });
  injectKeyDown(code: string, options?: InputInjectionKeyOptions): this;
  injectKeyUp(code: string): this;
  injectPointer(type: "pointermove" | "pointerdown" | "pointerup" | "pointercancel" | "wheel", options?: InputInjectionPointerOptions): this;
  inject(events: readonly InputInjectionEvent[]): this;
  bindAction(name: string, bindings: InputBinding | InputBinding[]): this;
  unbindAction(name: string): boolean;
  bindAxis(name: string, bindings: InputAxisBinding | InputAxisBinding[]): this;
  unbindAxis(name: string): boolean;
  getBindings(): { actions: InputActionMap; axes: InputAxisMap };
  setBindings(bindings?: { actions?: InputActionMap | null; axes?: InputAxisMap | null }): this;
  getAxis(name: string): number;
  getActionAxis(name: string): number;
  getVector(xAxisName: string, yAxisName: string, out?: Point, normalize?: boolean): Point;
  isActionDown(name: string): boolean;
  wasActionPressed(name: string): boolean;
  wasActionReleased(name: string): boolean;
  isKeyDown(code: string): boolean;
  wasKeyPressed(code: string): boolean;
  wasKeyReleased(code: string): boolean;
  isPointerDown(button?: number): boolean;
  wasPointerPressed(button?: number): boolean;
  wasPointerReleased(button?: number): boolean;
  wasPointerCancelled(button?: number): boolean;
  wasPointerMoved(): boolean;
  getPointer(pointerId: number): PointerState | null;
  getPointers(): ReadonlyMap<number, PointerState>;
  getPointerWorld(camera: Camera, out?: Point, pointerId?: number | null): Point;
  getGamepad(index?: number): GamepadSnapshot | null;
  isGamepadButtonDown(index: number, button: number): boolean;
  wasGamepadButtonPressed(index: number, button: number): boolean;
  wasGamepadButtonReleased(index: number, button: number): boolean;
  getGamepadAxis(index: number, axis: number): number;
  rumbleGamepad(index?: number, options?: GamepadRumbleOptions): Promise<boolean>;
  beginFrame(): void;
  endFrame(): void;
  destroy(): void;
}

export const easing: Record<string, EasingFunction>;
export interface TweenOptions { from?: number; ease?: EasingFunction; loop?: number; yoyo?: boolean; onComplete?: (() => void) | null; }
export class Tween {
  target: object; property: string; from: number; to: number; duration: number;
  elapsed: number; finished: boolean;
  constructor(target: object, property: string, to: number, duration: number, options?: TweenOptions);
  update(delta: number): boolean;
}
export class Animator {
  maxTweens: number; tweens: Set<Tween>;
  constructor(options?: { maxTweens?: number });
  add(tween: Tween): Tween;
  remove(tween: Tween): boolean;
  update(delta: number): void;
  clear(): void;
}

export interface ColliderBounds { x: number; y: number; width: number; height: number; }
export type OneWayDirection = "up" | "down" | "left" | "right";
export interface AABB extends ColliderBounds { left: number; top: number; right: number; bottom: number; }
export interface RaycastHit { collider: Collider; distance: number; point: Point; normal: Point; }
export class Collider {
  node: Node; tag: string; isTrigger: boolean; oneWay: OneWayDirection | null; layer: number; mask: number; enabled: boolean; readonly bounds: AABB;
  constructor(node: Node, options?: { tag?: string; isTrigger?: boolean; oneWay?: OneWayDirection | null; layer?: number; mask?: number; bounds?: ColliderBounds | null });
  setBounds(bounds?: ColliderBounds | null): this;
}
export class CollisionWorld {
  colliders: Set<Collider>;
  spatial: boolean; autoSync: boolean;
  cellSize: number;
  constructor(options?: { spatial?: boolean; autoSync?: boolean; cellSize?: number });
  add(collider: Collider): Collider;
  remove(collider: Collider): boolean;
  syncCollider(collider: Collider): this;
  rebuild(): this;
  hasSpatialChanges(): boolean;
  query(bounds: AABB, filter?: (collider: Collider) => boolean, out?: Collider[]): Collider[];
  firstHit(bounds: AABB, filter?: (collider: Collider) => boolean): Collider | null;
  raycast(origin: Point, direction: Point, maxDistance?: number, filter?: (collider: Collider) => boolean, out?: RaycastHit): RaycastHit | null;
  overlapCircle(centerX: number, centerY: number, radius: number, filter?: (collider: Collider) => boolean, out?: Collider[]): Collider[];
  clear(): void;
}
export class PhysicsBody {
  node: Node; isStatic: boolean; isKinematic: boolean; gravityScale: number; maxSpeed: number; velocity: Vec2; grounded: boolean; collider: Collider;
  constructor(node: Node, options?: { static?: boolean; kinematic?: boolean; isTrigger?: boolean; oneWay?: OneWayDirection | null; tag?: string; layer?: number; mask?: number; bounds?: ColliderBounds | null; velocityX?: number; velocityY?: number; gravityScale?: number; maxSpeed?: number });
  setVelocity(x: number, y?: number): this;
  setStatic(value: boolean): this;
  setKinematic(value: boolean): this;
}
export type PhysicsContactPhase = "begin" | "stay" | "end";
export interface PhysicsContact { body: PhysicsBody; other: PhysicsBody; phase: PhysicsContactPhase; normal: Point; penetration: number; }
export type PhysicsContactHandler = (body: PhysicsBody, other: PhysicsBody, contact: PhysicsContact) => void;
export class PhysicsWorld {
  scene: Scene | null; gravity: Vec2; autoSync: boolean; bodies: Set<PhysicsBody>; collisionWorld: CollisionWorld;
  onBeginContact: PhysicsContactHandler | null; onStayContact: PhysicsContactHandler | null; onEndContact: PhysicsContactHandler | null;
  constructor(options?: { scene?: Scene | null; gravityX?: number; gravityY?: number; autoSync?: boolean; onBeginContact?: PhysicsContactHandler | null; onStayContact?: PhysicsContactHandler | null; onEndContact?: PhysicsContactHandler | null });
  add(body: PhysicsBody): PhysicsBody;
  remove(body: PhysicsBody): boolean;
  syncBody(body: PhysicsBody): void;
  overlaps(body: PhysicsBody, filter?: (body: PhysicsBody) => boolean, out?: PhysicsBody[]): PhysicsBody[];
  overlapCircle(centerX: number, centerY: number, radius: number, filter?: (body: PhysicsBody) => boolean, out?: PhysicsBody[]): PhysicsBody[];
  step(delta: number): this;
  clear(): void;
}
export function getAABB(node: Node, output?: AABB): AABB;
export function intersectsAABB(first: AABB, second: AABB): boolean;
export function pointInAABB(bounds: AABB | ClipRect, x: number, y: number): boolean;
export function containsAABB(parent: AABB | ClipRect, child: AABB | ClipRect): boolean;

export interface AssetLoadOptions { signal?: AbortSignal; maxBytes?: number; maxJSONBytes?: number; maxJSONNodes?: number; maxJSONDepth?: number; mimeType?: string; integrity?: string; }
export interface AssetEntry { key: string; type?: "texture" | "json" | "bytes" | "ktx2" | "atlas"; url: string; atlasUrl?: string; options?: AssetLoadOptions & { atlasIntegrity?: string }; decoder?: KTX2Decoder | null; }
export interface AssetProgress { loaded: number; total: number; key: string; percent: number; }
export interface KTX2Level { byteOffset: number; byteLength: number; uncompressedByteLength: number; }
export interface KTX2Info { width: number; height: number; pixelDepth: number; layerCount: number; faceCount: number; levelCount: number; vkFormat: number; typeSize: number; supercompressionScheme: number; rgba8: boolean; levels: KTX2Level[]; }
export type KTX2Decoder = (bytes: Uint8Array, info: KTX2Info, options: { signal: AbortSignal | null }) => Promise<CanvasImageSource> | CanvasImageSource;
export const VK_FORMAT_R8G8B8A8_UNORM: 37;
export function inspectKTX2(bytes: Uint8Array, options?: { maxImageSize?: number; maxTexturePixels?: number }): KTX2Info;
export class AssetLoader {
  baseURL: string; maxBytes: number; maxJSONBytes: number; maxJSONNodes: number; maxJSONDepth: number; maxImageSize: number; maxTexturePixels: number; maxCacheTextures: number; maxCachePixels: number; cache: Map<string, Texture>; destroyed: boolean;
  constructor(options?: { baseURL?: string; allowedOrigins?: string[]; maxBytes?: number; maxJSONBytes?: number; maxJSONNodes?: number; maxJSONDepth?: number; maxImageSize?: number; maxTexturePixels?: number; maxCacheTextures?: number; maxCachePixels?: number });
  resolve(url: string): string;
  loadBytes(url: string, options?: AssetLoadOptions): Promise<Uint8Array>;
  loadJSON<T = unknown>(url: string, options?: AssetLoadOptions): Promise<T>;
  loadTexture(url: string, options?: AssetLoadOptions): Promise<Texture>;
  loadAtlas(textureURL: string, atlasURL: string, options?: AssetLoadOptions & { maxFrames?: number; atlasIntegrity?: string }): Promise<TextureAtlas>;
  inspectKTX2(bytes: Uint8Array): KTX2Info;
  loadKTX2(url: string, options?: AssetLoadOptions & { decoder?: KTX2Decoder | null }): Promise<Texture>;
  loadMany(entries: AssetEntry[], options?: { onProgress?: (event: AssetProgress) => void; signal?: AbortSignal; stopOnError?: boolean; maxConcurrent?: number }): Promise<{ results: Map<string, unknown>; errors: Map<string, Error> }>;
  release(url: string): boolean;
  clear(): void;
  destroy(): void;
}

export interface StorageLike { setItem(key: string, value: string): void; getItem(key: string): string | null; removeItem(key: string): void; }
export class SaveStore {
  namespace: string; maxBytes: number;
  constructor(options?: { namespace?: string; storage?: StorageLike; maxBytes?: number });
  key(name: string): string;
  get<T = unknown>(name: string, fallback?: T): T;
  set<T = unknown>(name: string, value: T): void;
  remove(name: string): void;
}

export interface AudioBus { name: string; gain: GainNode; parent: string | null; }
export interface AudioProgress { loaded: number; total: number; name: string; percent: number; }
export interface AudioLoadOptions { signal?: AbortSignal | null; integrity?: string | null; }
export interface AudioEntry { name: string; url: string; integrity?: string | null; }
export class AudioManager {
  loader: AssetLoader | null; maxBytes: number; maxDecodedBytes: number; maxVoices: number; decodedBytes: number; readonly voiceCount: number; context: AudioContext | null;
  constructor(options?: { loader?: AssetLoader | null; maxBytes?: number; maxDecodedBytes?: number; maxVoices?: number });
  ensureContext(): AudioContext;
  createBus(name: string, options?: { volume?: number; parent?: string | null }): AudioBus;
  getBus(name?: string): AudioBus | null;
  getBusNames(): string[];
  setBusVolume(name: string, volume: number): this;
  getBusVolume(name: string): number;
  setBusMuted(name: string, muted?: boolean): this;
  isBusMuted(name: string): boolean;
  fadeBus(name: string, volume: number, duration?: number): this;
  stopBus(name: string): number;
  unlock(): Promise<void>;
  stopVoice(source: AudioBufferSourceNode): boolean;
  stopAll(): this;
  suspend(): Promise<void>;
  resume(): Promise<void>;
  setVoiceVolume(source: AudioBufferSourceNode, volume: number): boolean;
  setVoicePan(source: AudioBufferSourceNode, pan: number): boolean;
  has(name: string): boolean;
  unload(name: string): boolean;
  load(name: string, url: string, options?: AudioLoadOptions): Promise<AudioBuffer>;
  loadMany(entries: ReadonlyArray<AudioEntry>, options?: { onProgress?: (event: AudioProgress) => void; signal?: AbortSignal | null; stopOnError?: boolean; maxConcurrent?: number }): Promise<{ results: Map<string, AudioBuffer>; errors: Map<string, Error> }>;
  play(nameOrBuffer: AudioBuffer | string, options?: { volume?: number; loop?: boolean; bus?: string; pan?: number }): AudioBufferSourceNode;
  destroy(): void;
}

export class Profiler {
  frames: number; fps: number; frameMs: number; metrics: Record<string, unknown>;
  begin(time: number): void;
  end(time: number, metrics?: Record<string, unknown>): void;
  snapshot(): Record<string, unknown>;
}

export type EngineStatus = Record<string, unknown> & { type: string };
export interface EngineOptions {
  canvas: HTMLCanvasElement;
  renderer?: RendererKind;
  resizeMode?: ResizeMode;
  width?: number; height?: number;
  maxPixelRatio?: number;
  maxTextureBytes?: number; maxTextureCount?: number;
  backgroundColor?: number | string; backgroundAlpha?: number; clearBeforeRender?: boolean;
  scene?: Scene; camera?: Camera; overlayScene?: Scene | null; overlayCamera?: Camera | null; animator?: Animator | null; physics?: PhysicsWorld | null;
  fixedStep?: number; maxFrameDelta?: number; timeScale?: number; interpolate?: boolean;
  pauseOnHidden?: boolean; pauseAudio?: boolean;
  inputActions?: InputActionMap | null;
  inputAxes?: InputAxisMap | null;
  onGamepadConnected?: GamepadHandler | null;
  onGamepadDisconnected?: GamepadHandler | null;
  onStatus?: (status: EngineStatus) => void;
  onUpdate?: (delta: number, engine: ExiEngine) => void;
  onRender?: (engine: ExiEngine, profiler: Profiler) => void;
}
export interface CaptureFrameOptions { columns?: number; rows?: number; }
export interface CaptureFrameResult { width: number; height: number; format: string; flipY: boolean; pixels: Uint8Array; }
export class ExiEngine {
  static create(options: EngineOptions): Promise<ExiEngine>;
  canvas: HTMLCanvasElement; width: number; height: number; maxPixelRatio: number; maxTextureBytes: number; maxTextureCount: number;
  backgroundColor: number; backgroundAlpha: number; clearBeforeRender: boolean;
  preference: RendererKind; resizeMode: ResizeMode; scene: Scene; overlayScene: Scene | null; overlayCamera: Camera | null; animator: Animator | null; physics: PhysicsWorld | null; input: Input | null;
  assets: AssetLoader; audio: AudioManager; profiler: Profiler;
  running: boolean; paused: boolean; timeScale: number; interpolate: boolean; pauseOnHidden: boolean; pauseAudio: boolean; audioSuspendedByEngine: boolean; focusedNode: Node | null; fallbackUsed: boolean;
  constructor(options: EngineOptions);
  init(): Promise<this>;
  start(): this;
  pause(): this;
  resume(): this;
  suspendAudio(): this;
  resumeAudio(): this;
  setTimeScale(value: number): this;
  focus(node?: Node | null): this;
  blur(): this;
  focusNext(reverse?: boolean): boolean;
  step(delta: number): this;
  prepare(): { batches: number; uploads: number };
  setScene(scene: Scene, camera?: Camera): this;
  setResizeMode(mode: ResizeMode): this;
  setLogicalSize(width: number, height: number): this;
  setOverlay(scene: Scene | null, camera?: Camera | null): this;
  renderToTexture(target: RenderTexture, scene?: Scene, camera?: Camera, time?: number): RenderTexture;
  captureFrame(options?: CaptureFrameOptions): Promise<CaptureFrameResult>;
  stop(): this;
  add<T extends Node>(...nodes: T[]): T | T[];
  pickPointer(predicate?: ((node: Node) => boolean) | null, pointerId?: number | null): Node | null;
  resize(): this;
  getInfo(): Record<string, unknown>;
  destroy(): void;
}

export function clamp(value: number, min: number, max: number): number;
export function lerp(from: number, to: number, amount: number): number;
export function degToRad(degrees: number): number;
export function radToDeg(radians: number): number;

