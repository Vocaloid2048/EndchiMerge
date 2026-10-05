/**
 * 輪廓之間的接近程度（用於合成判定）。
 * How close two outlines are (used for merge detection).
 *
 * 這個模組是**純幾何**：輸入是兩組世界座標的多邊形頂點，輸出是「邊緣間隙」。
 * 不碰 Matter、不碰 canvas，所以可以在 node 環境完整單元測試。
 * This module is **pure geometry**: two sets of world-space polygon vertices go in, an edge
 * gap comes out. It touches neither Matter nor canvas, so it unit-tests fully in node.
 *
 * **為什麼不能只用圓心距離**：使用者截圖顯示一顆小顆粒夾在兩顆大顆粒之間時，視覺上已經
 * 相依，但圓心距離遠超任何合理的圓心容差 —— 小顆粒的半徑小，圓心到鄰居圓心的距離卻被
 * 「自己的半徑 ＋ 鄰居的半徑」綁死。圓心距離法對**同尺寸**配對尚可，對**不同尺寸**配對
 * 會系統性失準。改用輪廓邊緣間隙就沒有這個問題：它直接量「兩張圖的邊緣差多遠」。
 * **Why centre distance is not enough**: the user's screenshot shows a small dumpling wedged
 * between two larger ones — visually adjacent, yet its centre distance is far beyond any
 * sensible centre tolerance. A centre-radius rule is bound by "my radius + their radius", so
 * it is systematically wrong for **mixed-size** pairs even though it works for equal-size
 * ones. Measuring the edge gap between the two outlines has no such bias: it directly reports
 * how far apart the artwork is.
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
 * 點到線段的最短距離平方。
 * Squared distance from a point to a line segment.
 *
 * 用平方是為了省掉 `Math.sqrt` —— 呼叫端只做比較，不需要真實距離。
 * Squared to avoid `Math.sqrt`: callers only compare, they never need the true distance.
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

  /* 投影參數夾在 [0,1]，落在線段外的話最近點就是端點。 */
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
 * 兩個多邊形的邊緣最近距離平方。
 * Squared edge-to-edge distance between two polygons.
 *
 * 用**頂點對邊**的雙向掃描近似：`A 的每個頂點 → B 的每條邊` 與 `B 的每個頂點 → A 的每條邊`
 * 各掃一次，取最小值。頂點數在 30 上下（見 `SILHOUETTE_OPTIONS`），所以最壞約
 * `2 × 30 × 30 = 1800` 次點線段比較 —— 每步對「可能的配對」跑一次仍舊便宜。
 * A bidirectional **vertex-to-edge** sweep: every vertex of `A` against every edge of `B`, and
 * vice versa, taking the minimum. With about 30 vertices per outline (see
 * `SILHOUETTE_OPTIONS`) that is at most `2 × 30 × 30 = 1800` point-segment tests — still cheap
 * once per step for the pairs that matter.
 *
 * **對相交（重疊）的處理**：兩形**相交**時最近頂點會落在對方邊上，距離自然是 **0**；但
 * **完全包含**（小形在大形內、邊一條都不相交）時距離是正數，例如同心大小方塊會得到
 * 「小方塊頂點到大方塊邊」的距離。所以「有沒有重疊」不能只靠距離門檻 —— 見
 * `outlinesOverlap()`；本函式只回答「輪廓邊緣差多遠」。
 * **On intersection**: when the two shapes **cross**, the nearest vertex lands on the other's
 * edge and the distance is naturally **0**. But under full **containment** (a small shape
 * inside a large one, with no edge crossing at all) the distance is positive — concentric
 * squares yield "small square's vertex to big square's edge". "Do they overlap" therefore
 * cannot rest on a distance threshold — see `outlinesOverlap()`; this function only answers
 * "how far apart are the outlines".
 *
 * @returns 邊緣最短距離**平方**；任一多邊形少於 3 點時回傳 `Number.POSITIVE_INFINITY`。
 */
export function polygonEdgeDistanceSq(a: readonly Point[], b: readonly Point[]): number {
  if (a.length < 3 || b.length < 3) return Number.POSITIVE_INFINITY;

  const aEdges = edgesOf(a);
  const bEdges = edgesOf(b);

  const ab = directedDistanceSq(a, bEdges);
  const ba = directedDistanceSq(b, aEdges);

  return Math.min(ab, ba);
}

/** 點是否落在多邊形內（射線交叉法，處理奇偶規則）。 */
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
 * 兩個多邊形是否重疊或相接。
 * Whether two polygons overlap or touch.
 *
 * 三個條件任一成立即算重疊：
 *  1. 兩組邊有交點（輪廓互相切過）
 *  2. A 的某個頂點落在 B 內（A 陷進 B）
 *  3. B 的某個頂點落在 A 內（B 陷進 A）
 *
 * 條件 2、3 缺一不可：兩形可以一個完全包住另一個而**一條邊都不相交**（同心大小方塊就是
 * 這種情況），那時只有「頂點在對方內部」才偵測得到。
 * Any of three conditions counts as overlap: an edge crossing, a vertex of `A` inside `B`, or
 * a vertex of `B` inside `A`. Conditions 2 and 3 are both required — one shape can sit wholly
 * inside the other with **no edge crossing at all** (concentric squares), and only the
 * containment test catches that.
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
 * 兩個輪廓是否「足以合成」——相接，或邊緣間隙在容差內。
 * Whether two outlines are close enough to merge: touching, or within the edge tolerance.
 *
 * 順序刻意是「先查重疊、再比距離」：**相交**時距離自然是 0（會過關），但**完全包含**時
 * 距離是正數，只看距離門檻會有微妙的漏判空間；先跑 `outlinesOverlap()` 把重疊直接判過，
 * 再用間隙門檻涵蓋「幾乎相接」，語意最清楚。
 * The order is deliberate — overlap first, then distance: **crossing** shapes already give a
 * distance of 0 (so they would pass anyway), but **contained** ones give a positive value, so
 * leaning on distance alone leaves a subtle gap. `outlinesOverlap()` passes overlapping shapes
 * outright and the gap threshold then covers "almost touching" — the clearest reading.
 *
 * @param a A 的世界座標頂點 / World-space vertices of A.
 * @param b B 的世界座標頂點 / World-space vertices of B.
 * @param tolerance 允許的邊緣間隙（世界／虛擬單位，≥ 0）/ Allowed edge gap, in world units.
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
 * 把**局部座標**的輪廓頂點轉到世界座標（依剛體位置與旋轉）。
 * Transform **local-space** outline vertices into world space, given a body's position and
 * rotation.
 *
 * 輪廓快取（`SilhouetteCache`）存的是相對質心、尚未旋轉的頂點；剛體在世界裡會被 Matter
 * 平移與旋轉，所以比較兩顆之前必須先各自轉到世界座標。
 * The silhouette cache stores vertices relative to the centre of mass, unrotated; bodies are
 * translated and rotated by Matter, so each outline must be brought into world space before
 * two of them can be compared.
 *
 * 用 `Math.cos` / `Math.sin` **各算一次**再複用（而非在迴圈裡呼叫三角函式）：頂點有 30
 * 個上下，每次呼叫都重算是明顯的浪費。
 * `Math.cos` / `Math.sin` are computed **once** and reused rather than called per vertex —
 * with ~30 vertices, recomputing the trigonometry each time is plainly wasteful.
 *
 * @param polygon 局部座標頂點 / Local-space vertices.
 * @param x 剛體中心 X / Body centre X.
 * @param y 剛體中心 Y / Body centre Y.
 * @param angle 剛體角度（弧度）/ Body angle in radians.
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
 * Project a polygon onto a direction, returning the [min, max] interval.
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
 * 兩個輪廓沿著「連心線」方向的重疊深度。
 * The penetration depth of two outlines measured along their centre-to-centre axis.
 *
 * 這是「分離軸定理」在**單一軸**上的版本：把兩形投影到連心線方向，兩個投影區間的重疊量
 * 就是深度。回傳值同時是**推力方向**（`nx`, `ny`，由 A 指向 B 的單位向量）與**深度**
 * （`depth`，≥ 0；沒重疊時為 0）。
 * A **single-axis** version of the separating axis theorem: the two shapes are projected onto
 * the centre-to-centre line and the interval overlap is the depth. The result carries both the
 * **push direction** (`nx`, `ny`, unit vector from A towards B) and the **depth** (`depth`,
 * ≥ 0, zero when there is no overlap).
 *
 * **為什麼只取連心線這一軸**：Matter 的求解器本來就會解掉沿其他軸的穿透，這裡要補的是
 * 「新生成的放大顆粒整個陷進鄰居裡」那種**整塊重疊**—— 那種情況沿連心線推開最直接，也最
 * 穩定（推力方向與玩家看到的「往外擠」一致）。掃描所有邊法線的完整 SAT 會多出近 60 條軸，
 * 而且最小軸常常是抖動的次要軸，推開方向反而不自然。
 * **Why only the centre axis**: Matter's solver already resolves penetration along other axes.
 * What is left to fix is a freshly spawned, larger body sitting *wholly inside* its neighbour
 * — and pushing outward along the centre line is both the most direct answer and the most
 * stable one (the direction matches the "squeezed outward" the player sees). A full SAT over
 * every edge normal would add nearly 60 axes, and its minimum axis is often a jittery
 * secondary one, which produces a less natural push.
 *
 * 深度用**連心線上的區間重疊**而不是「邊界最近距離」：後者對「一顆完全在另一顆裡面」
 * 會回傳 0 或很小的值，推不開；區間重疊在這兩種情況都會給出真正的穿透量。
 * Depth is the **interval overlap on the centre line**, not "closest edge distance": the latter
 * returns zero or a tiny value when one shape sits wholly inside the other and would not push
 * anything apart, whereas the interval overlap reports the true penetration in both cases.
 *
 * @returns `{ nx, ny, depth }`；任一多邊形退化時 `depth` 為 0。
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
