/**
 * 輪廓之間的接近程度（用於合成判定）；純幾何，可在 node 單元測試。
 * How close two outlines are (used for merge detection); pure geometry, unit-testable in node.
 */

import type { Point } from '../render/silhouette';

/**
 * 多邊形的一條邊。
 * One edge of a polygon.
 */
interface Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 把頂點序列轉成邊序列（自動閉合）。 */
function edgesOf(polygon: readonly Point[]): Edge[] {
  const edges: Edge[] = [];
  const n = polygon.length;

  for (let i = 0; i < n; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % n]!;
    edges.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }

  return edges;
}

/**
 * 點到線段的最短距離平方（平方即可，呼叫端只做比較）。
 * Squared point-to-segment distance (squared is enough — callers only compare).
 */
function pointSegmentDistanceSq(px: number, py: number, edge: Edge): number {
  const dx = edge.x2 - edge.x1;
  const dy = edge.y2 - edge.y1;
  const lengthSq = dx * dx + dy * dy;

  /* 退化邊（兩端重合）就當成一個點。 */
  if (lengthSq === 0) {
    const ax = px - edge.x1;
    const ay = py - edge.y1;
    return ax * ax + ay * ay;
  }

  /* 投影參數夾在 [0,1]：落在線段外時最近點就是端點。 */
  let t = ((px - edge.x1) * dx + (py - edge.y1) * dy) / lengthSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;

  const cx = edge.x1 + t * dx;
  const cy = edge.y1 + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

/**
 * 兩組頂點之間的最短距離平方（單向：`from` 的每個點對 `to` 的每條邊）。
 * Shortest squared distance from every vertex in `from` to every edge in `to`.
 */
function directedDistanceSq(from: readonly Point[], toEdges: readonly Edge[]): number {
  let best = Number.POSITIVE_INFINITY;

  for (const point of from) {
    for (const edge of toEdges) {
      const d = pointSegmentDistanceSq(point.x, point.y, edge);
      if (d < best) best = d;
    }
  }

  return best;
}

/**
 * 兩個多邊形的邊緣最近距離平方（雙向「頂點對邊」掃描取最小）。
 * Squared edge-to-edge distance between two polygons (a bidirectional vertex-to-edge sweep).
 *
 * 相交時距離自然是 0，但完全包含時是正數 —— 「有沒有重疊」不能只靠距離門檻，見 `outlinesOverlap()`。
 * Crossing shapes give a distance of 0, but fully contained ones do not — "do they overlap" cannot rest on a threshold alone; see `outlinesOverlap()`.
 */
export function polygonEdgeDistanceSq(a: readonly Point[], b: readonly Point[]): number {
  if (a.length < 3 || b.length < 3) return Number.POSITIVE_INFINITY;

  const aEdges = edgesOf(a);
  const bEdges = edgesOf(b);

  const ab = directedDistanceSq(a, bEdges);
  const ba = directedDistanceSq(b, aEdges);

  return Math.min(ab, ba);
}

/** 點是否落在多邊形內（射線交叉法）。 */
function pointInPolygon(px: number, py: number, polygon: readonly Point[]): boolean {
  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = polygon[i]!.x;
    const yi = polygon[i]!.y;
    const xj = polygon[j]!.x;
    const yj = polygon[j]!.y;

    /* 只算「跨越射線」的邊，且用嚴格不等避免頂點被算兩次。 */
    const crosses = yi > py !== yj > py;
    if (!crosses) continue;

    const xAtY = ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (px < xAtY) inside = !inside;
  }

  return inside;
}

/** 兩線段是否相交（含共線重疊的寬鬆判定）。 */
function segmentsIntersect(a: Edge, b: Edge): boolean {
  const cross = (ox: number, oy: number, ax: number, ay: number, bx: number, by: number): number =>
    (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);

  const d1 = cross(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const d2 = cross(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  const d3 = cross(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const d4 = cross(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);

  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/**
 * 兩個多邊形是否重疊或相接：有邊相交，或任一方的頂點落在對方內部（完全包含時邊不會相交，必須靠後者）。
 * Whether two polygons overlap or touch: an edge crossing, or either shape's vertex inside the other (full containment never crosses edges, so the vertex test is required).
 */
export function outlinesOverlap(a: readonly Point[], b: readonly Point[]): boolean {
  if (a.length < 3 || b.length < 3) return false;

  const aEdges = edgesOf(a);
  const bEdges = edgesOf(b);

  for (const ea of aEdges) {
    for (const eb of bEdges) {
      if (segmentsIntersect(ea, eb)) return true;
    }
  }

  if (a.some((point) => pointInPolygon(point.x, point.y, b))) return true;
  if (b.some((point) => pointInPolygon(point.x, point.y, a))) return true;

  return false;
}

/**
 * 兩個輪廓是否「足以合成」——先判重疊、再比邊緣間隙門檻（完全包含時距離是正數，順序不可對調）。
 * Whether two outlines are close enough to merge — overlap first, then the edge-gap tolerance (contained shapes give a positive distance, so the order matters).
 */
export function outlinesWithinReach(
  a: readonly Point[],
  b: readonly Point[],
  tolerance: number,
): boolean {
  if (a.length < 3 || b.length < 3) return false;

  if (outlinesOverlap(a, b)) return true;

  const limitSq = tolerance * tolerance;
  return polygonEdgeDistanceSq(a, b) <= limitSq;
}

/**
 * 把局部座標的輪廓頂點轉到世界座標（依剛體位置與旋轉）；三角函式只算一次。
 * Transforms local-space outline vertices into world space (position and rotation), computing the trigonometry once.
 */
export function toWorldPolygon(
  polygon: readonly Point[],
  x: number,
  y: number,
  angle: number,
): Point[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return polygon.map((point) => ({
    x: x + point.x * cos - point.y * sin,
    y: y + point.x * sin + point.y * cos,
  }));
}

/**
 * 沿著某個方向，把 `polygon` 的投影區間算出來。
 * Projects a polygon onto a direction, returning the [min, max] interval.
 */
function projectOnto(polygon: readonly Point[], dx: number, dy: number): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const point of polygon) {
    const value = point.x * dx + point.y * dy;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  return { min, max };
}

/**
 * 兩個輪廓沿連心線的重疊深度（單軸 SAT）：回傳推力方向（A 指向 B 的單位向量）與深度（≥ 0）。
 * The two outlines' penetration depth along their centre line (single-axis SAT): returns the push direction (unit vector from A to B) and the depth (≥ 0).
 *
 * 只取連心線這一軸：Matter 的求解器已解掉其他軸，這裡要補的是「整塊陷進鄰居」的重疊；
 * 深度用區間重疊而非邊界最近距離，後者對「完全在裡面」會回 0 而推不開。
 * Only the centre axis: Matter's solver already resolves the rest, and interval overlap (unlike closest-edge distance) still reports a real penetration when one shape sits wholly inside the other.
 */
export function outlinePenetration(
  a: readonly Point[],
  b: readonly Point[],
): { nx: number; ny: number; depth: number } {
  if (a.length < 3 || b.length < 3) return { nx: 0, ny: 0, depth: 0 };

  /* 兩者的質心（頂點平均，足夠當方向參考）。 */
  const centre = (polygon: readonly Point[]): Point => {
    let sx = 0;
    let sy = 0;
    for (const point of polygon) {
      sx += point.x;
      sy += point.y;
    }
    return { x: sx / polygon.length, y: sy / polygon.length };
  };

  const ca = centre(a);
  const cb = centre(b);

  let dx = cb.x - ca.x;
  let dy = cb.y - ca.y;
  const length = Math.hypot(dx, dy);

  /* 質心重合時沒有方向可言 —— 用預設的「往下推」，深度照算。 */
  if (length === 0) {
    dx = 0;
    dy = 1;
  } else {
    dx /= length;
    dy /= length;
  }

  const pa = projectOnto(a, dx, dy);
  const pb = projectOnto(b, dx, dy);

  /* 區間重疊量；沒重疊（含只是相接）就是 0。 */
  const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
  const depth = overlap > 0 ? overlap : 0;

  return { nx: dx, ny: dy, depth };
}
