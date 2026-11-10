import { Node } from "./node.js";

// Optional rigid-body dynamics: circles, boxes and convex polygons with rotation,
// SAT contact manifolds (up to two points) and sequential impulses with
// restitution and Coulomb friction. It is independent of the axis-aligned
// PhysicsWorld (which stays the cheap choice for tile platformers) and has the
// same step(delta) shape, so it can be passed as ExiEngine({ physics }).
// Everything is plain arithmetic in a fixed order, so the same inputs and the
// same fixed step give the same results.

export const MAX_RIGID_BODIES = 2_048;
export const MAX_POLYGON_VERTICES = 32;
const MAX_COORDINATE = 1e7;
const MAX_SPEED = 1e5;
const MAX_ITERATIONS = 64;
const LINEAR_SLOP = 0.05;
// Overlap is removed by moving positions directly after the velocity solve
// (not by adding velocity), so warm-started impulses carry no correction energy.
const POSITION_CORRECTION = 0.4;
// Contacts are kept while bodies are within CONTACT_MARGIN of touching
// (speculative contacts): resting bodies keep a stable manifold instead of
// losing contact every other step. Restitution only applies to impacts faster
// than the larger of RESTITUTION_THRESHOLD and two steps of gravity.
const CONTACT_MARGIN = 1;
const RESTITUTION_THRESHOLD = 60;
const WARM_START_DISTANCE_SQUARED = 4;

function finite(value, fallback, label) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError(`${label} must be a finite number.`);
  return number;
}

function positive(value, fallback, label) {
  const number = finite(value, fallback, label);
  if (!(number > 0)) throw new RangeError(`${label} must be positive.`);
  return number;
}

function cross(ax, ay, bx, by) { return ax * by - ay * bx; }

function normalizeShape(shape) {
  if (!shape || typeof shape !== "object" || Array.isArray(shape)) throw new TypeError("RigidBody shape must be an object.");
  if (shape.type === "circle") return { type: "circle", radius: positive(shape.radius, undefined, "RigidBody circle radius") };
  let points;
  if (shape.type === "box") {
    const halfWidth = positive(shape.width, undefined, "RigidBody box width") / 2;
    const halfHeight = positive(shape.height, undefined, "RigidBody box height") / 2;
    points = [-halfWidth, -halfHeight, halfWidth, -halfHeight, halfWidth, halfHeight, -halfWidth, halfHeight];
  } else if (shape.type === "polygon") {
    const source = shape.points;
    if (!Array.isArray(source) && !ArrayBuffer.isView(source)) throw new TypeError("RigidBody polygon points must be an array.");
    if (source.length < 6 || source.length % 2 !== 0 || source.length / 2 > MAX_POLYGON_VERTICES) throw new RangeError(`RigidBody polygon needs 3-${MAX_POLYGON_VERTICES} points.`);
    points = Array.from(source, (value) => finite(value, undefined, "RigidBody polygon point"));
  } else {
    throw new TypeError('RigidBody shape type must be "circle", "box" or "polygon".');
  }
  return polygonFromPoints(points);
}

// Builds a convex polygon centered on its centroid with counter-clockwise
// (screen: y down, so "clockwise-looking") winding and outward normals.
function polygonFromPoints(points) {
  const count = points.length / 2;
  let area = 0; let centerX = 0; let centerY = 0;
  for (let index = 0; index < count; index += 1) {
    const x0 = points[index * 2]; const y0 = points[index * 2 + 1];
    const next = (index + 1) % count;
    const x1 = points[next * 2]; const y1 = points[next * 2 + 1];
    const term = cross(x0, y0, x1, y1);
    area += term;
    centerX += (x0 + x1) * term;
    centerY += (y0 + y1) * term;
  }
  area /= 2;
  if (Math.abs(area) < 1e-9) throw new RangeError("RigidBody polygon area must not be zero.");
  centerX /= 6 * area;
  centerY /= 6 * area;
  const vertices = [];
  for (let index = 0; index < count; index += 1) vertices.push({ x: points[index * 2] - centerX, y: points[index * 2 + 1] - centerY });
  if (area < 0) vertices.reverse();
  const normals = [];
  for (let index = 0; index < count; index += 1) {
    const a = vertices[index]; const b = vertices[(index + 1) % count];
    const edgeX = b.x - a.x; const edgeY = b.y - a.y;
    const length = Math.hypot(edgeX, edgeY);
    if (length < 1e-9) throw new RangeError("RigidBody polygon has duplicate points.");
    normals.push({ x: edgeY / length, y: -edgeX / length });
  }
  for (let index = 0; index < count; index += 1) {
    const a = vertices[index]; const b = vertices[(index + 1) % count]; const c = vertices[(index + 2) % count];
    if (cross(b.x - a.x, b.y - a.y, c.x - b.x, c.y - b.y) <= 0) throw new RangeError("RigidBody polygon must be convex.");
  }
  return { type: "polygon", vertices, normals, area: Math.abs(area), offsetX: centerX, offsetY: centerY };
}

function massData(shape, density) {
  if (shape.type === "circle") {
    const mass = density * Math.PI * shape.radius * shape.radius;
    return { mass, inertia: 0.5 * mass * shape.radius * shape.radius };
  }
  let area = 0; let inertia = 0;
  const { vertices } = shape;
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index]; const b = vertices[(index + 1) % vertices.length];
    const term = cross(a.x, a.y, b.x, b.y);
    area += term / 2;
    inertia += (term / 12) * (a.x * a.x + a.x * b.x + b.x * b.x + a.y * a.y + a.y * b.y + b.y * b.y);
  }
  return { mass: density * area, inertia: density * inertia };
}

export class RigidBody {
  constructor({ shape, x = 0, y = 0, angle = 0, velocityX = 0, velocityY = 0, angularVelocity = 0, static: isStatic = false, density = 1, restitution = 0.2, friction = 0.5, linearDamping = 0, angularDamping = 0, gravityScale = 1, fixedRotation = false, isSensor = false, layer = 1, mask = 0xFFFFFFFF, node = null, tag = "" } = {}) {
    this.shape = normalizeShape(shape);
    if (node !== null && !(node instanceof Node)) throw new TypeError("RigidBody node must be a Node.");
    if (node?.destroyed) throw new TypeError("RigidBody cannot be attached to a destroyed Node.");
    this.node = node;
    this.position = { x: finite(x, 0, "RigidBody x"), y: finite(y, 0, "RigidBody y") };
    this.angle = finite(angle, 0, "RigidBody angle");
    this.velocity = { x: finite(velocityX, 0, "RigidBody velocityX"), y: finite(velocityY, 0, "RigidBody velocityY") };
    this.angularVelocity = finite(angularVelocity, 0, "RigidBody angularVelocity");
    this.force = { x: 0, y: 0 };
    this.torque = 0;
    this.restitution = Math.max(0, Math.min(1, finite(restitution, 0.2, "RigidBody restitution")));
    this.friction = Math.max(0, finite(friction, 0.5, "RigidBody friction"));
    this.linearDamping = Math.max(0, finite(linearDamping, 0, "RigidBody linearDamping"));
    this.angularDamping = Math.max(0, finite(angularDamping, 0, "RigidBody angularDamping"));
    this.gravityScale = finite(gravityScale, 1, "RigidBody gravityScale");
    this.isSensor = Boolean(isSensor);
    this.fixedRotation = Boolean(fixedRotation);
    this.tag = String(tag).slice(0, 256);
    this.layer = layer >>> 0;
    this.mask = mask >>> 0;
    this.isStatic = Boolean(isStatic);
    const { mass, inertia } = massData(this.shape, positive(density, 1, "RigidBody density"));
    this.mass = this.isStatic ? 0 : mass;
    this.inertia = this.isStatic || this.fixedRotation ? 0 : inertia;
    this.invMass = this.mass > 0 ? 1 / this.mass : 0;
    this.invInertia = this.inertia > 0 ? 1 / this.inertia : 0;
    this.world = null;
    // Cached world-space geometry, refreshed before collision detection.
    this.worldVertices = this.shape.type === "polygon" ? this.shape.vertices.map(() => ({ x: 0, y: 0 })) : null;
    this.worldNormals = this.shape.type === "polygon" ? this.shape.normals.map(() => ({ x: 0, y: 0 })) : null;
    this.bounds = { left: 0, top: 0, right: 0, bottom: 0 };
    this.updateGeometry();
  }

  setVelocity(x, y = this.velocity.y) { this.velocity.x = finite(x, 0, "RigidBody velocityX"); this.velocity.y = finite(y, 0, "RigidBody velocityY"); return this; }
  setPosition(x, y) { this.position.x = finite(x, 0, "RigidBody x"); this.position.y = finite(y, 0, "RigidBody y"); this.updateGeometry(); return this; }
  setAngle(angle) { this.angle = finite(angle, 0, "RigidBody angle"); this.updateGeometry(); return this; }

  applyForce(x, y, pointX = this.position.x, pointY = this.position.y) {
    if (this.isStatic) return this;
    const fx = finite(x, 0, "RigidBody force"); const fy = finite(y, 0, "RigidBody force");
    this.force.x += fx; this.force.y += fy;
    this.torque += cross(finite(pointX, 0, "RigidBody point") - this.position.x, finite(pointY, 0, "RigidBody point") - this.position.y, fx, fy);
    return this;
  }

  applyImpulse(x, y, pointX = this.position.x, pointY = this.position.y) {
    if (this.isStatic) return this;
    const ix = finite(x, 0, "RigidBody impulse"); const iy = finite(y, 0, "RigidBody impulse");
    this.velocity.x += ix * this.invMass; this.velocity.y += iy * this.invMass;
    this.angularVelocity += this.invInertia * cross(finite(pointX, 0, "RigidBody point") - this.position.x, finite(pointY, 0, "RigidBody point") - this.position.y, ix, iy);
    return this;
  }

  updateGeometry() {
    const { x, y } = this.position;
    if (this.shape.type === "circle") {
      const r = this.shape.radius;
      this.bounds.left = x - r; this.bounds.top = y - r; this.bounds.right = x + r; this.bounds.bottom = y + r;
      return;
    }
    const cos = Math.cos(this.angle); const sin = Math.sin(this.angle);
    let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
    const { vertices, normals } = this.shape;
    for (let index = 0; index < vertices.length; index += 1) {
      const local = vertices[index]; const out = this.worldVertices[index];
      out.x = x + local.x * cos - local.y * sin;
      out.y = y + local.x * sin + local.y * cos;
      const normal = normals[index]; const outNormal = this.worldNormals[index];
      outNormal.x = normal.x * cos - normal.y * sin;
      outNormal.y = normal.x * sin + normal.y * cos;
      if (out.x < left) left = out.x; if (out.x > right) right = out.x;
      if (out.y < top) top = out.y; if (out.y > bottom) bottom = out.y;
    }
    this.bounds.left = left; this.bounds.top = top; this.bounds.right = right; this.bounds.bottom = bottom;
  }

  containsPoint(px, py) {
    if (this.shape.type === "circle") return Math.hypot(px - this.position.x, py - this.position.y) <= this.shape.radius;
    for (let index = 0; index < this.worldVertices.length; index += 1) {
      const vertex = this.worldVertices[index]; const normal = this.worldNormals[index];
      if ((px - vertex.x) * normal.x + (py - vertex.y) * normal.y > 0) return false;
    }
    return true;
  }

  syncNode() {
    const node = this.node;
    if (!node || node.destroyed) return;
    node.position.set(this.position.x, this.position.y);
    node.rotation = this.angle;
  }
}

// ---------------------------------------------------------------- narrowphase
// Each function fills `manifold` with a normal pointing from A to B, a
// penetration depth and 1-2 world contact points, or returns false.

function collideCircles(a, b, manifold) {
  const dx = b.position.x - a.position.x; const dy = b.position.y - a.position.y;
  const radius = a.shape.radius + b.shape.radius;
  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared >= (radius + CONTACT_MARGIN) * (radius + CONTACT_MARGIN)) return false;
  const distance = Math.sqrt(distanceSquared);
  const nx = distance > 1e-9 ? dx / distance : 0; const ny = distance > 1e-9 ? dy / distance : 1;
  manifold.normalX = nx; manifold.normalY = ny;
  manifold.depth = radius - distance;
  manifold.count = 1;
  manifold.points[0].x = a.position.x + nx * (a.shape.radius - manifold.depth / 2);
  manifold.points[0].y = a.position.y + ny * (a.shape.radius - manifold.depth / 2);
  return true;
}

function collidePolygonCircle(polygon, circle, manifold, flip) {
  const cx = circle.position.x; const cy = circle.position.y; const radius = circle.shape.radius;
  const vertices = polygon.worldVertices; const normals = polygon.worldNormals;
  let separation = -Infinity; let face = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const value = (cx - vertices[index].x) * normals[index].x + (cy - vertices[index].y) * normals[index].y;
    if (value > radius + CONTACT_MARGIN) return false;
    if (value > separation) { separation = value; face = index; }
  }
  const v1 = vertices[face]; const v2 = vertices[(face + 1) % vertices.length];
  let nx; let ny; let depth; let px; let py;
  if (separation < 1e-9) {
    nx = normals[face].x; ny = normals[face].y; depth = radius - separation;
    px = cx - nx * radius; py = cy - ny * radius;
  } else {
    const edgeX = v2.x - v1.x; const edgeY = v2.y - v1.y;
    const t = Math.max(0, Math.min(1, ((cx - v1.x) * edgeX + (cy - v1.y) * edgeY) / (edgeX * edgeX + edgeY * edgeY)));
    px = v1.x + edgeX * t; py = v1.y + edgeY * t;
    const dx = cx - px; const dy = cy - py;
    const distance = Math.hypot(dx, dy);
    if (distance > radius + CONTACT_MARGIN) return false;
    nx = distance > 1e-9 ? dx / distance : normals[face].x; ny = distance > 1e-9 ? dy / distance : normals[face].y;
    depth = radius - distance;
  }
  manifold.normalX = flip ? -nx : nx; manifold.normalY = flip ? -ny : ny;
  manifold.depth = depth;
  manifold.count = 1;
  manifold.points[0].x = px; manifold.points[0].y = py;
  return true;
}

function maxSeparation(a, b) {
  let best = -Infinity; let bestFace = 0;
  const vertices = a.worldVertices; const normals = a.worldNormals; const other = b.worldVertices;
  for (let index = 0; index < vertices.length; index += 1) {
    const nx = normals[index].x; const ny = normals[index].y;
    let min = Infinity;
    for (const point of other) {
      const value = (point.x - vertices[index].x) * nx + (point.y - vertices[index].y) * ny;
      if (value < min) min = value;
    }
    if (min > best) { best = min; bestFace = index; }
  }
  return { separation: best, face: bestFace };
}

function clipSegment(points, nx, ny, offset, out) {
  let count = 0;
  const d0 = points[0].x * nx + points[0].y * ny - offset;
  const d1 = points[1].x * nx + points[1].y * ny - offset;
  if (d0 <= 0) { out[count].x = points[0].x; out[count].y = points[0].y; count += 1; }
  if (d1 <= 0) { out[count].x = points[1].x; out[count].y = points[1].y; count += 1; }
  if (d0 * d1 < 0) {
    const t = d0 / (d0 - d1);
    out[count].x = points[0].x + t * (points[1].x - points[0].x);
    out[count].y = points[0].y + t * (points[1].y - points[0].y);
    count += 1;
  }
  return count;
}

const clipIn = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
const clipMid = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
const clipOut = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];

function collidePolygons(a, b, manifold) {
  const separationA = maxSeparation(a, b);
  if (separationA.separation > CONTACT_MARGIN) return false;
  const separationB = maxSeparation(b, a);
  if (separationB.separation > CONTACT_MARGIN) return false;
  // Prefer A as reference unless B is clearly better (keeps results stable).
  let reference = a; let incident = b; let face = separationA.face; let flip = false;
  if (separationB.separation > separationA.separation + 0.0005) { reference = b; incident = a; face = separationB.face; flip = true; }
  const refVertices = reference.worldVertices; const refNormals = reference.worldNormals;
  const nx = refNormals[face].x; const ny = refNormals[face].y;
  // Incident edge: the face of the other polygon most anti-parallel to the normal.
  let incidentFace = 0; let minDot = Infinity;
  for (let index = 0; index < incident.worldNormals.length; index += 1) {
    const dot = incident.worldNormals[index].x * nx + incident.worldNormals[index].y * ny;
    if (dot < minDot) { minDot = dot; incidentFace = index; }
  }
  const incVertices = incident.worldVertices;
  clipIn[0].x = incVertices[incidentFace].x; clipIn[0].y = incVertices[incidentFace].y;
  const nextIncident = incVertices[(incidentFace + 1) % incVertices.length];
  clipIn[1].x = nextIncident.x; clipIn[1].y = nextIncident.y;
  const v1 = refVertices[face]; const v2 = refVertices[(face + 1) % refVertices.length];
  let tx = v2.x - v1.x; let ty = v2.y - v1.y;
  const length = Math.hypot(tx, ty); tx /= length; ty /= length;
  // Clip against the two side planes of the reference face.
  if (clipSegment(clipIn, -tx, -ty, -(tx * v1.x + ty * v1.y), clipMid) < 2) return false;
  if (clipSegment(clipMid, tx, ty, tx * v2.x + ty * v2.y, clipOut) < 2) return false;
  const faceOffset = nx * v1.x + ny * v1.y;
  let count = 0; let depth = -Infinity;
  for (let index = 0; index < 2; index += 1) {
    const separation = clipOut[index].x * nx + clipOut[index].y * ny - faceOffset;
    if (separation <= CONTACT_MARGIN) {
      manifold.points[count].x = clipOut[index].x - nx * separation * 0.5;
      manifold.points[count].y = clipOut[index].y - ny * separation * 0.5;
      manifold.separations[count] = -separation;
      depth = Math.max(depth, -separation);
      count += 1;
    }
  }
  if (count === 0) return false;
  manifold.count = count;
  manifold.depth = depth;
  manifold.normalX = flip ? -nx : nx; manifold.normalY = flip ? -ny : ny;
  return true;
}

function createManifold() {
  return { normalX: 0, normalY: 0, depth: 0, count: 0, points: [{ x: 0, y: 0 }, { x: 0, y: 0 }], separations: [0, 0] };
}

export function collideRigidBodies(a, b, manifold = createManifold()) {
  if (!(a instanceof RigidBody) || !(b instanceof RigidBody)) throw new TypeError("collideRigidBodies expects two RigidBody instances.");
  manifold.separations[0] = 0; manifold.separations[1] = 0;
  const typeA = a.shape.type; const typeB = b.shape.type;
  let hit;
  if (typeA === "circle" && typeB === "circle") hit = collideCircles(a, b, manifold);
  else if (typeA === "polygon" && typeB === "circle") hit = collidePolygonCircle(a, b, manifold, false);
  else if (typeA === "circle" && typeB === "polygon") hit = collidePolygonCircle(b, a, manifold, true);
  else hit = collidePolygons(a, b, manifold);
  if (hit && manifold.count === 1) manifold.separations[0] = manifold.depth;
  return hit ? manifold : null;
}

// ---------------------------------------------------------------- world

export class RigidBodyWorld {
  constructor({ gravityX = 0, gravityY = 980, iterations = 10, scene = null, onContact = null, maxBodies = MAX_RIGID_BODIES } = {}) {
    this.gravity = { x: finite(gravityX, 0, "RigidBodyWorld gravityX"), y: finite(gravityY, 980, "RigidBodyWorld gravityY") };
    if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) throw new RangeError(`RigidBodyWorld iterations must be between 1 and ${MAX_ITERATIONS}.`);
    this.iterations = iterations;
    if (!Number.isSafeInteger(maxBodies) || maxBodies < 1 || maxBodies > MAX_RIGID_BODIES) throw new RangeError(`RigidBodyWorld maxBodies must be between 1 and ${MAX_RIGID_BODIES}.`);
    this.maxBodies = maxBodies;
    if (onContact !== null && typeof onContact !== "function") throw new TypeError("RigidBodyWorld onContact must be a function.");
    this.onContact = onContact;
    this.scene = scene;
    this.bodies = [];
    this.contacts = [];
    this._contactPool = [];
    this._order = [];
    this._previousPairs = new Set();
    this._pairs = new Set();
    // Accumulated impulses from the previous step, keyed by body pair, used to
    // warm start the solver (much steadier stacks and resting contacts).
    this._cache = new Map();
    this._nextCache = new Map();
  }

  add(body) {
    if (!(body instanceof RigidBody)) throw new TypeError("RigidBodyWorld.add expects a RigidBody.");
    if (body.world === this) return body;
    if (body.world) throw new Error("RigidBody already belongs to another world.");
    if (this.bodies.length >= this.maxBodies) throw new RangeError(`RigidBodyWorld supports at most ${this.maxBodies} bodies.`);
    body.world = this;
    body.id = this.bodies.length === 0 ? 0 : this.bodies[this.bodies.length - 1].id + 1;
    this.bodies.push(body);
    body.updateGeometry();
    body.syncNode();
    return body;
  }

  remove(body) {
    const index = this.bodies.indexOf(body);
    if (index < 0) return false;
    this.bodies.splice(index, 1);
    body.world = null;
    return true;
  }

  clear() {
    for (const body of this.bodies) body.world = null;
    this.bodies.length = 0;
    this.contacts.length = 0;
    this._previousPairs.clear();
    this._cache.clear();
  }

  queryPoint(x, y, out = []) {
    out.length = 0;
    for (const body of this.bodies) if (body.containsPoint(x, y)) out.push(body);
    return out;
  }

  _contact(index) {
    let contact = this._contactPool[index];
    if (!contact) {
      contact = { a: null, b: null, manifold: createManifold(), normalImpulse: [0, 0], tangentImpulse: [0, 0], normalMass: [0, 0], tangentMass: [0, 0], bias: [0, 0], ra: [{ x: 0, y: 0 }, { x: 0, y: 0 }], rb: [{ x: 0, y: 0 }, { x: 0, y: 0 }], friction: 0, restitution: 0 };
      this._contactPool[index] = contact;
    }
    return contact;
  }

  _detect() {
    const bodies = this.bodies;
    for (const body of bodies) body.updateGeometry();
    // Sort-and-sweep broadphase along x; ties broken by insertion id for determinism.
    const order = this._order;
    order.length = 0;
    for (const body of bodies) order.push(body);
    order.sort((left, right) => (left.bounds.left - right.bounds.left) || (left.id - right.id));
    let count = 0;
    this._pairs.clear();
    for (let i = 0; i < order.length; i += 1) {
      const a = order[i];
      for (let j = i + 1; j < order.length; j += 1) {
        const b = order[j];
        // Bounds are compared with the speculative margin so near-touching pairs
        // (resting stacks after position correction) keep their contacts.
        if (b.bounds.left > a.bounds.right + CONTACT_MARGIN) break;
        if (a.invMass === 0 && b.invMass === 0) continue;
        if (b.bounds.top > a.bounds.bottom + CONTACT_MARGIN || b.bounds.bottom < a.bounds.top - CONTACT_MARGIN) continue;
        if ((a.layer & b.mask) === 0 || (b.layer & a.mask) === 0) continue;
        const first = a.id < b.id ? a : b; const second = first === a ? b : a;
        const contact = this._contact(count);
        if (!collideRigidBodies(first, second, contact.manifold)) continue;
        contact.a = first; contact.b = second;
        const key = `${first.id}:${second.id}`;
        contact.key = key;
        this._pairs.add(key);
        if (this.onContact && !this._previousPairs.has(key)) this.onContact(first, second, contact.manifold);
        if (first.isSensor || second.isSensor) continue;
        count += 1;
      }
    }
    const swap = this._previousPairs; this._previousPairs = this._pairs; this._pairs = swap;
    this.contacts.length = count;
    for (let index = 0; index < count; index += 1) this.contacts[index] = this._contactPool[index];
    // Stable solve order independent of the broadphase sort.
    this.contacts.sort((left, right) => (left.a.id - right.a.id) || (left.b.id - right.b.id));
  }

  _prepare(delta) {
    const restitutionThreshold = Math.max(RESTITUTION_THRESHOLD, 2 * Math.hypot(this.gravity.x, this.gravity.y) * delta);
    for (const contact of this.contacts) {
      const { a, b, manifold } = contact;
      const nx = manifold.normalX; const ny = manifold.normalY;
      const tx = -ny; const ty = nx;
      contact.friction = Math.sqrt(a.friction * b.friction);
      contact.restitution = Math.max(a.restitution, b.restitution);
      for (let index = 0; index < manifold.count; index += 1) {
        const point = manifold.points[index];
        const ra = contact.ra[index]; const rb = contact.rb[index];
        ra.x = point.x - a.position.x; ra.y = point.y - a.position.y;
        rb.x = point.x - b.position.x; rb.y = point.y - b.position.y;
        const rnA = cross(ra.x, ra.y, nx, ny); const rnB = cross(rb.x, rb.y, nx, ny);
        contact.normalMass[index] = 1 / (a.invMass + b.invMass + a.invInertia * rnA * rnA + b.invInertia * rnB * rnB);
        const rtA = cross(ra.x, ra.y, tx, ty); const rtB = cross(rb.x, rb.y, tx, ty);
        contact.tangentMass[index] = 1 / (a.invMass + b.invMass + a.invInertia * rtA * rtA + b.invInertia * rtB * rtB);
        const relativeX = b.velocity.x - b.angularVelocity * rb.y - a.velocity.x + a.angularVelocity * ra.y;
        const relativeY = b.velocity.y + b.angularVelocity * rb.x - a.velocity.y - a.angularVelocity * ra.x;
        const normalVelocity = relativeX * nx + relativeY * ny;
        // separations[] holds signed depth: positive = overlap, negative = gap.
        const depth = manifold.separations[index];
        // A speculative contact (gap) may still close the gap within this step.
        const speculative = depth < 0 ? depth / delta : 0;
        contact.bias[index] = speculative + (normalVelocity < -restitutionThreshold ? -contact.restitution * normalVelocity : 0);
        contact.normalImpulse[index] = 0;
        contact.tangentImpulse[index] = 0;
      }
      contact.blockSolvable = false;
      if (manifold.count === 2) {
        const ra1 = contact.ra[0]; const rb1 = contact.rb[0]; const ra2 = contact.ra[1]; const rb2 = contact.rb[1];
        const rn1A = cross(ra1.x, ra1.y, nx, ny); const rn1B = cross(rb1.x, rb1.y, nx, ny);
        const rn2A = cross(ra2.x, ra2.y, nx, ny); const rn2B = cross(rb2.x, rb2.y, nx, ny);
        const k11 = a.invMass + b.invMass + a.invInertia * rn1A * rn1A + b.invInertia * rn1B * rn1B;
        const k22 = a.invMass + b.invMass + a.invInertia * rn2A * rn2A + b.invInertia * rn2B * rn2B;
        const k12 = a.invMass + b.invMass + a.invInertia * rn1A * rn2A + b.invInertia * rn1B * rn2B;
        const determinant = k11 * k22 - k12 * k12;
        // Ill-conditioned (nearly redundant points) falls back to sequential impulses.
        if (k11 * k11 < 1000 * determinant) {
          const inverse = 1 / determinant;
          contact.block = { k11, k12, k22, inv11: k22 * inverse, inv12: -k12 * inverse, inv22: k11 * inverse };
          contact.blockSolvable = true;
        }
      }
    }
    // Warm start only after every bias is known: restitution must see the
    // velocities from before any of this step's impulses were applied.
    for (const contact of this.contacts) {
      const cached = this._cache.get(contact.key);
      if (!cached) continue;
      const { a, b, manifold } = contact;
      const nx = manifold.normalX; const ny = manifold.normalY;
      const tx = -ny; const ty = nx;
      for (let index = 0; index < manifold.count; index += 1) {
        const point = manifold.points[index];
        for (let previous = 0; previous < cached.count; previous += 1) {
          const dx = cached.x[previous] - point.x; const dy = cached.y[previous] - point.y;
          if (dx * dx + dy * dy > WARM_START_DISTANCE_SQUARED) continue;
          contact.normalImpulse[index] = cached.normal[previous];
          contact.tangentImpulse[index] = cached.tangent[previous];
          applyPairImpulse(a, b, contact.ra[index], contact.rb[index], nx * cached.normal[previous] + tx * cached.tangent[previous], ny * cached.normal[previous] + ty * cached.tangent[previous]);
          break;
        }
      }
    }
  }

  _correctPositions() {
    for (const contact of this.contacts) {
      const { a, b, manifold } = contact;
      const totalInverseMass = a.invMass + b.invMass;
      if (totalInverseMass === 0) continue;
      const depth = Math.max(manifold.separations[0], manifold.count > 1 ? manifold.separations[1] : -Infinity);
      if (depth <= LINEAR_SLOP) continue;
      const amount = ((depth - LINEAR_SLOP) * POSITION_CORRECTION) / totalInverseMass;
      a.position.x -= manifold.normalX * amount * a.invMass; a.position.y -= manifold.normalY * amount * a.invMass;
      b.position.x += manifold.normalX * amount * b.invMass; b.position.y += manifold.normalY * amount * b.invMass;
    }
  }

  _storeImpulses() {
    const next = this._nextCache;
    next.clear();
    for (const contact of this.contacts) {
      let entry = this._cache.get(contact.key);
      if (!entry) entry = { count: 0, x: [0, 0], y: [0, 0], normal: [0, 0], tangent: [0, 0] };
      const { manifold } = contact;
      entry.count = manifold.count;
      for (let index = 0; index < manifold.count; index += 1) {
        entry.x[index] = manifold.points[index].x; entry.y[index] = manifold.points[index].y;
        entry.normal[index] = contact.normalImpulse[index]; entry.tangent[index] = contact.tangentImpulse[index];
      }
      next.set(contact.key, entry);
    }
    this._nextCache = this._cache;
    this._cache = next;
  }

  _solve() {
    for (const contact of this.contacts) {
      const { a, b, manifold } = contact;
      const nx = manifold.normalX; const ny = manifold.normalY;
      const tx = -ny; const ty = nx;
      // Friction first (Box2D order), then the normal constraint.
      for (let index = 0; index < manifold.count; index += 1) {
        const ra = contact.ra[index]; const rb = contact.rb[index];
        const relativeX = b.velocity.x - b.angularVelocity * rb.y - a.velocity.x + a.angularVelocity * ra.y;
        const relativeY = b.velocity.y + b.angularVelocity * rb.x - a.velocity.y - a.angularVelocity * ra.x;
        const tangentVelocity = relativeX * tx + relativeY * ty;
        let friction = -contact.tangentMass[index] * tangentVelocity;
        const limit = contact.friction * contact.normalImpulse[index];
        const previousTangent = contact.tangentImpulse[index];
        contact.tangentImpulse[index] = Math.max(-limit, Math.min(limit, previousTangent + friction));
        friction = contact.tangentImpulse[index] - previousTangent;
        applyPairImpulse(a, b, ra, rb, tx * friction, ty * friction);
      }
      if (manifold.count === 2 && contact.blockSolvable) this._solveBlock(contact, nx, ny);
      else {
        for (let index = 0; index < manifold.count; index += 1) {
          const ra = contact.ra[index]; const rb = contact.rb[index];
          const relativeX = b.velocity.x - b.angularVelocity * rb.y - a.velocity.x + a.angularVelocity * ra.y;
          const relativeY = b.velocity.y + b.angularVelocity * rb.x - a.velocity.y - a.angularVelocity * ra.x;
          const normalVelocity = relativeX * nx + relativeY * ny;
          let impulse = contact.normalMass[index] * (contact.bias[index] - normalVelocity);
          const previous = contact.normalImpulse[index];
          contact.normalImpulse[index] = Math.max(previous + impulse, 0);
          impulse = contact.normalImpulse[index] - previous;
          applyPairImpulse(a, b, ra, rb, nx * impulse, ny * impulse);
        }
      }
    }
  }

  // Solves both normal impulses of a two-point manifold together (the 2x2 LCP
  // from Box2D's block solver), which keeps flat stacks symmetric and steady.
  _solveBlock(contact, nx, ny) {
    const { a, b } = contact;
    const ra1 = contact.ra[0]; const rb1 = contact.rb[0]; const ra2 = contact.ra[1]; const rb2 = contact.rb[1];
    const oldX = contact.normalImpulse[0]; const oldY = contact.normalImpulse[1];
    const vn1 = (b.velocity.x - b.angularVelocity * rb1.y - a.velocity.x + a.angularVelocity * ra1.y) * nx + (b.velocity.y + b.angularVelocity * rb1.x - a.velocity.y - a.angularVelocity * ra1.x) * ny;
    const vn2 = (b.velocity.x - b.angularVelocity * rb2.y - a.velocity.x + a.angularVelocity * ra2.y) * nx + (b.velocity.y + b.angularVelocity * rb2.x - a.velocity.y - a.angularVelocity * ra2.x) * ny;
    const { k11, k12, k22, inv11, inv12, inv22 } = contact.block;
    const bx = vn1 - contact.bias[0] - (k11 * oldX + k12 * oldY);
    const by = vn2 - contact.bias[1] - (k12 * oldX + k22 * oldY);
    let x1; let x2;
    // Case 1: both points active.
    x1 = -(inv11 * bx + inv12 * by); x2 = -(inv12 * bx + inv22 * by);
    if (!(x1 >= 0 && x2 >= 0)) {
      // Case 2: only point 1 active.
      x1 = -bx / k11; x2 = 0;
      if (!(x1 >= 0 && k12 * x1 + by >= 0)) {
        // Case 3: only point 2 active.
        x1 = 0; x2 = -by / k22;
        if (!(x2 >= 0 && k12 * x2 + bx >= 0)) {
          // Case 4: neither point active.
          x1 = 0; x2 = 0;
          if (!(bx >= 0 && by >= 0)) return;
        }
      }
    }
    const d1 = x1 - oldX; const d2 = x2 - oldY;
    applyPairImpulse(a, b, ra1, rb1, nx * d1, ny * d1);
    applyPairImpulse(a, b, ra2, rb2, nx * d2, ny * d2);
    contact.normalImpulse[0] = x1; contact.normalImpulse[1] = x2;
  }

  step(delta) {
    const dt = Number(delta);
    if (!Number.isFinite(dt) || dt <= 0) return this;
    const step = Math.min(dt, 0.1);
    for (const body of this.bodies) {
      if (body.invMass === 0) { body.force.x = 0; body.force.y = 0; body.torque = 0; continue; }
      body.velocity.x += (this.gravity.x * body.gravityScale + body.force.x * body.invMass) * step;
      body.velocity.y += (this.gravity.y * body.gravityScale + body.force.y * body.invMass) * step;
      body.angularVelocity += body.torque * body.invInertia * step;
      const linear = 1 / (1 + step * body.linearDamping); const angular = 1 / (1 + step * body.angularDamping);
      body.velocity.x *= linear; body.velocity.y *= linear; body.angularVelocity *= angular;
      body.force.x = 0; body.force.y = 0; body.torque = 0;
    }
    this._detect();
    this._prepare(step);
    for (let iteration = 0; iteration < this.iterations; iteration += 1) this._solve();
    this._storeImpulses();
    this._correctPositions();
    for (const body of this.bodies) {
      if (body.invMass === 0) continue;
      body.velocity.x = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, body.velocity.x));
      body.velocity.y = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, body.velocity.y));
      body.position.x = Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, body.position.x + body.velocity.x * step));
      body.position.y = Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, body.position.y + body.velocity.y * step));
      if (!body.fixedRotation) body.angle += body.angularVelocity * step;
      body.updateGeometry();
      body.syncNode();
    }
    return this;
  }
}

function applyPairImpulse(a, b, ra, rb, ix, iy) {
  a.velocity.x -= ix * a.invMass; a.velocity.y -= iy * a.invMass;
  a.angularVelocity -= a.invInertia * cross(ra.x, ra.y, ix, iy);
  b.velocity.x += ix * b.invMass; b.velocity.y += iy * b.invMass;
  b.angularVelocity += b.invInertia * cross(rb.x, rb.y, ix, iy);
}
