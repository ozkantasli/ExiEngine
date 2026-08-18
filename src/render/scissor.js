export function getScissorRect(rect, width, height, output = null) {
  if (!rect) return null;
  const left = Math.max(0, Math.min(width, Math.floor(rect.x)));
  const top = Math.max(0, Math.min(height, Math.floor(rect.y)));
  const right = Math.max(left, Math.min(width, Math.ceil(rect.x + rect.width)));
  const bottom = Math.max(top, Math.min(height, Math.ceil(rect.y + rect.height)));
  const result = output || { x: 0, y: 0, width: 0, height: 0 };
  result.x = left; result.y = top; result.width = right - left; result.height = bottom - top;
  return result;
}
