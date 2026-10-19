/** Pure geometry helpers shared by the canvas controller and unit tests. */
export type Point = readonly [number, number];
export type BoundingBox = readonly [number, number, number, number];

export function canvasLayout(
  wrapperWidth: number,
  wrapperHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  fieldYear?: number,
  margin = 0,
): { scale: number; left: number; top: number } | null {
  if (
    !Number.isFinite(wrapperWidth) || !Number.isFinite(wrapperHeight) ||
    !Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight) ||
    wrapperWidth <= 0 || wrapperHeight <= 0 || canvasWidth <= 0 || canvasHeight <= 0
  ) return null;

  const scale = Math.min(wrapperWidth / (canvasWidth + margin * 2), wrapperHeight / canvasHeight);
  const scaledHeight = canvasHeight * scale;
  const left = (wrapperWidth - canvasWidth * scale) / 2;
  const centeredTop = (wrapperHeight - scaledHeight) / 2;
  const crop = fieldYear === 2026 ? -30 : 0;
  return { scale, left, top: Math.max(0, Math.min(centeredTop + crop, Math.max(0, wrapperHeight - scaledHeight))) };
}

// the board on screen in css pixels - its size and where the whole field sits in it before any zoom
export interface BoardFrame { width: number; height: number; scale: number; left: number; top: number }
// the field point in the middle of the board and how far past the whole-field view it is zoomed
export interface Camera { zoom: number; center: Point }

export function homeCamera(frame: BoardFrame): Camera {
  return { zoom: 1, center: [(frame.width / 2 - frame.left) / frame.scale, (frame.height / 2 - frame.top) / frame.scale] };
}

// the view never pans past what the whole-field view shows
export function clampCamera(camera: Camera, frame: BoardFrame, maxZoom: number): Camera {
  const zoom = Math.min(Math.max(camera.zoom, 1), maxZoom);
  const home = homeCamera(frame).center;
  const slackX = (frame.width / frame.scale) * (1 - 1 / zoom) / 2;
  const slackY = (frame.height / frame.scale) * (1 - 1 / zoom) / 2;
  return {
    zoom,
    center: [Math.min(Math.max(camera.center[0], home[0] - slackX), home[0] + slackX), Math.min(Math.max(camera.center[1], home[1] - slackY), home[1] + slackY)],
  };
}

export function fieldToScreen(point: Point, camera: Camera, frame: BoardFrame): Point {
  const scale = frame.scale * camera.zoom;
  return [(point[0] - camera.center[0]) * scale + frame.width / 2, (point[1] - camera.center[1]) * scale + frame.height / 2];
}

export function screenToField(point: Point, camera: Camera, frame: BoardFrame): Point {
  const scale = frame.scale * camera.zoom;
  return [(point[0] - frame.width / 2) / scale + camera.center[0], (point[1] - frame.height / 2) / scale + camera.center[1]];
}

// zooms by spread and slides the camera so the field point that was at from lands at to
export function pinchCamera(start: Camera, frame: BoardFrame, from: Point, to: Point, spread: number, maxZoom: number): Camera {
  const anchor = screenToField(from, start, frame);
  const zoom = Math.min(Math.max(start.zoom * spread, 1), maxZoom);
  const scale = frame.scale * zoom;
  return clampCamera({ zoom, center: [anchor[0] - (to[0] - frame.width / 2) / scale, anchor[1] - (to[1] - frame.height / 2) / scale] }, frame, maxZoom);
}

export function pointInRotatedRect(
  point: Point,
  center: Point,
  width: number,
  height: number,
  rotation: number,
): boolean {
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const dx = point[0] - center[0];
  const dy = point[1] - center[1];
  const x = cos * dx - sin * dy;
  const y = sin * dx + cos * dy;
  return x >= -width / 2 && x <= width / 2 && y >= -height / 2 && y <= height / 2;
}

export function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

export function strokeBounds(stroke: readonly [number, ...Point[]]): [number, number, number, number] {
  const first = stroke[1];
  let minX = first[0]; let minY = first[1]; let maxX = first[0]; let maxY = first[1];
  for (const point of stroke.slice(2) as Point[]) {
    minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]);
  }
  // A one-point stroke is painted as a 5px radius dot.
  if (stroke.length === 2) return [minX - 5, minY - 5, maxX + 5, maxY + 5];
  return [minX, minY, maxX, maxY];
}

export function segmentTouchesBounds(start: Point, end: Point, bounds: BoundingBox, padding = 0): boolean {
  const [minX, minY, maxX, maxY] = bounds;
  const left = minX - padding; const top = minY - padding;
  const right = maxX + padding; const bottom = maxY + padding;
  if ((start[0] >= left && start[0] <= right && start[1] >= top && start[1] <= bottom) ||
      (end[0] >= left && end[0] <= right && end[1] >= top && end[1] <= bottom)) return true;
  return segmentsIntersect(start, end, [left, top], [right, top]) ||
    segmentsIntersect(start, end, [left, bottom], [right, bottom]) ||
    segmentsIntersect(start, end, [left, top], [left, bottom]) ||
    segmentsIntersect(start, end, [right, top], [right, bottom]);
}

export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point, tolerance = 0): boolean {
  const cross = (p: Point, q: Point, r: Point) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const abC = cross(a, b, c); const abD = cross(a, b, d);
  const cdA = cross(c, d, a); const cdB = cross(c, d, b);
  if (((abC >= 0 && abD <= 0) || (abC <= 0 && abD >= 0)) && ((cdA >= 0 && cdB <= 0) || (cdA <= 0 && cdB >= 0))) return true;
  return tolerance > 0 && [distanceToSegment(a, c, d), distanceToSegment(b, c, d), distanceToSegment(c, a, b), distanceToSegment(d, a, b)].some((distance) => distance <= tolerance);
}
