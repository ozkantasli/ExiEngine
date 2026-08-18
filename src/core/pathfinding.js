const DEFAULT_BLOCKED_VALUES = [1];
const MAX_BLOCKED_VALUES = 32;
const DEFAULT_MAX_NODES = 100_000;

export const MAX_GRID_PATH_CELLS = 262_144;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizePoint(value, label) {
  const point = Array.isArray(value) ? { x: value[0], y: value[1] } : value;
  if (!isRecord(point) || !Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y)) {
    throw new TypeError(`${label} x/y tam sayı olmalı`);
  }
  return { x: point.x, y: point.y };
}

function compareHeap(scores, nodes, first, second) {
  return scores[first] < scores[second] || (scores[first] === scores[second] && nodes[first] < nodes[second]);
}

function pushHeap(nodes, scores, node, score) {
  let index = nodes.length;
  nodes.push(node);
  scores.push(score);
  while (index > 0) {
    const parent = (index - 1) >> 1;
    if (compareHeap(scores, nodes, parent, index)) break;
    [nodes[parent], nodes[index]] = [nodes[index], nodes[parent]];
    [scores[parent], scores[index]] = [scores[index], scores[parent]];
    index = parent;
  }
}

function popHeap(nodes, scores) {
  const node = nodes[0];
  const score = scores[0];
  const lastNode = nodes.pop();
  const lastScore = scores.pop();
  if (nodes.length > 0) {
    nodes[0] = lastNode;
    scores[0] = lastScore;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < nodes.length && compareHeap(scores, nodes, left, smallest)) smallest = left;
      if (right < nodes.length && compareHeap(scores, nodes, right, smallest)) smallest = right;
      if (smallest === index) break;
      [nodes[index], nodes[smallest]] = [nodes[smallest], nodes[index]];
      [scores[index], scores[smallest]] = [scores[smallest], scores[index]];
      index = smallest;
    }
  }
  return { node, score };
}

function validateGrid(grid) {
  if (!Array.isArray(grid) || grid.length === 0) throw new TypeError("grid boş olmayan satır dizisi olmalı");
  const height = grid.length;
  if (!Array.isArray(grid[0]) || grid[0].length === 0) throw new TypeError("grid satırları boş olmayan dizi olmalı");
  const width = grid[0].length;
  if (width * height > MAX_GRID_PATH_CELLS) throw new RangeError(`grid ${MAX_GRID_PATH_CELLS} hücre sınırını aşamaz`);
  for (const row of grid) {
    if (!Array.isArray(row) || row.length !== width) throw new TypeError("grid dikdörtgen olmalı");
  }
  return { width, height, cellCount: width * height };
}

function inBounds(x, y, width, height) {
  return x >= 0 && x < width && y >= 0 && y < height;
}

function heuristic(x, y, goalX, goalY, diagonal) {
  const dx = Math.abs(goalX - x);
  const dy = Math.abs(goalY - y);
  return diagonal ? Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy) : dx + dy;
}

function makePath(parents, startIndex, goalIndex, width) {
  const path = [];
  let current = goalIndex;
  while (current !== -1) {
    path.push({ x: current % width, y: Math.floor(current / width) });
    if (current === startIndex) break;
    current = parents[current];
  }
  if (path[path.length - 1]?.x !== startIndex % width || path[path.length - 1]?.y !== Math.floor(startIndex / width)) return [];
  path.reverse();
  return path;
}

/**
 * Finds a bounded deterministic A* path through a rectangular grid.
 * Grid cells equal to one of blockedValues are not traversable; the grid is not mutated.
 */
export function findGridPath(grid, start, goal, options = {}) {
  const { width, height, cellCount } = validateGrid(grid);
  if (!isRecord(options)) throw new TypeError("pathfinding options object olmalı");
  const startPoint = normalizePoint(start, "start");
  const goalPoint = normalizePoint(goal, "goal");
  if (!inBounds(startPoint.x, startPoint.y, width, height) || !inBounds(goalPoint.x, goalPoint.y, width, height)) {
    throw new RangeError("start/goal grid sınırları içinde olmalı");
  }
  const blockedValues = options.blockedValues === undefined ? DEFAULT_BLOCKED_VALUES : options.blockedValues;
  if (!Array.isArray(blockedValues) || blockedValues.length > MAX_BLOCKED_VALUES) throw new RangeError(`blockedValues en fazla ${MAX_BLOCKED_VALUES} değer içerebilir`);
  const blocked = new Set(blockedValues);
  const diagonal = options.diagonal === true;
  const allowCornerCutting = options.allowCornerCutting === true;
  const maxNodes = options.maxNodes === undefined ? Math.min(cellCount, DEFAULT_MAX_NODES) : options.maxNodes;
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > cellCount) throw new RangeError(`maxNodes 1 ile ${cellCount} arasında olmalı`);
  const isWalkable = (x, y) => !blocked.has(grid[y][x]);
  const startIndex = startPoint.y * width + startPoint.x;
  const goalIndex = goalPoint.y * width + goalPoint.x;
  if (!isWalkable(startPoint.x, startPoint.y) || !isWalkable(goalPoint.x, goalPoint.y)) return { path: [], reached: false, expanded: 0, truncated: false };
  if (startIndex === goalIndex) return { path: [{ x: startPoint.x, y: startPoint.y }], reached: true, expanded: 0, truncated: false };

  const gScore = new Float64Array(cellCount);
  const fScore = new Float64Array(cellCount);
  gScore.fill(Infinity);
  fScore.fill(Infinity);
  const parents = new Int32Array(cellCount);
  parents.fill(-1);
  const closed = new Uint8Array(cellCount);
  const heapNodes = [];
  const heapScores = [];
  gScore[startIndex] = 0;
  fScore[startIndex] = heuristic(startPoint.x, startPoint.y, goalPoint.x, goalPoint.y, diagonal);
  pushHeap(heapNodes, heapScores, startIndex, fScore[startIndex]);
  const directions = diagonal
    ? [[1, 0, 1], [0, 1, 1], [-1, 0, 1], [0, -1, 1], [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2]]
    : [[1, 0, 1], [0, 1, 1], [-1, 0, 1], [0, -1, 1]];
  let expanded = 0;
  let reached = false;
  let truncated = false;
  while (heapNodes.length > 0 && expanded < maxNodes) {
    const current = popHeap(heapNodes, heapScores);
    if (closed[current.node] || current.score !== fScore[current.node]) continue;
    closed[current.node] = 1;
    expanded += 1;
    if (current.node === goalIndex) {
      reached = true;
      break;
    }
    const currentX = current.node % width;
    const currentY = Math.floor(current.node / width);
    for (const [offsetX, offsetY, cost] of directions) {
      const nextX = currentX + offsetX;
      const nextY = currentY + offsetY;
      if (!inBounds(nextX, nextY, width, height) || !isWalkable(nextX, nextY)) continue;
      if (diagonal && !allowCornerCutting && offsetX !== 0 && offsetY !== 0 && (!isWalkable(currentX + offsetX, currentY) || !isWalkable(currentX, currentY + offsetY))) continue;
      const nextIndex = nextY * width + nextX;
      if (closed[nextIndex]) continue;
      const tentative = gScore[current.node] + cost;
      if (tentative >= gScore[nextIndex]) continue;
      parents[nextIndex] = current.node;
      gScore[nextIndex] = tentative;
      fScore[nextIndex] = tentative + heuristic(nextX, nextY, goalPoint.x, goalPoint.y, diagonal);
      pushHeap(heapNodes, heapScores, nextIndex, fScore[nextIndex]);
    }
  }
  truncated = !reached && expanded >= maxNodes && heapNodes.length > 0;
  return {
    path: reached ? makePath(parents, startIndex, goalIndex, width) : [],
    reached,
    expanded,
    truncated,
  };
}
