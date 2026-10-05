/**
 * 由 sprite 的 alpha 輪廓推導碰撞多邊形（光柵化輪廓法）。
 * Derive collision polygons from a sprite's alpha outline (rasterised contour tracing).
 *
 * 這個模組是**純幾何**：輸入一個 alpha 遮罩（0/255 的灰階點陣），輸出以虛擬單位表示的
 * 多邊形。它不碰 canvas、不碰圖片解碼，因此可以在 node 環境下單元測試；把圖片變成遮罩的
 * 那一步（`OffscreenCanvas`）留在 `render/silhouetteLoader.ts`。
 * This module is **pure geometry**: an alpha mask (a 0/255 grey bitmap) goes in, polygons in
 * virtual units come out. It touches neither canvas nor image decoding, so it unit-tests in
 * node; turning an image into a mask (`OffscreenCanvas`) lives in `render/silhouetteLoader.ts`.
 *
 * 為什麼是輪廓而不是圓（使用者定案取代舊的「一律圓形」）：
 * Why an outline rather than a circle (the user's decision, replacing "always a circle"):
 *
 * 方團團的輪廓是**凹多邊形**（方形身體 ＋ 頭髮、翅膀、頭角等裝飾），用外接圓會讓兩顆明明
 * 沒碰到就互相推開。這支模組逐像素追出輪廓、簡化頂點，再交給 Matter 的凸分解。
 * A dumpling's outline is a **concave polygon** (a square body plus hair, wings and horns);
 * a circumscribed circle makes two dumplings push apart while visibly apart. This module
 * traces the outline pixel by pixel, simplifies the vertices, then hands them to Matter's
 * convex decomposition.
 *
 * 取樣步進（`step`）：在遮罩上每 `step` 像素才檢查一次，等於先用一格格的粗篩描出外形，
 * 再讓 RDP 把共線的點收掉。這讓 512² 的遮罩只需掃 ~1/16 的點，且不犧牲尖角。
 * Sampling stride: the mask is probed every `step` pixels, then RDP collapses collinear runs.
 * A 512² mask is therefore scanned at ~1/16 density without rounding off sharp corners.
 */

/** 只讀的點陣；座標以左上角為原點。 */
export interface Bitmap {
  width: number;
  height: number;
  /** 每像素亮度；大於 `threshold` 視為「實心」。長度必須是 `width * height`。 */
  data: Uint8ClampedArray | Uint8Array;
}

/** 虛擬單位下的二維點。 */
export interface Point {
  x: number;
  y: number;
}

export interface TraceOptions {
  /**
   * 遮罩掃描步進，像素。步進越大越快、輪廓越粗。
   * Mask sampling stride in pixels. Larger is faster and coarser.
   */
  step?: number;
  /** alpha 門檻（0..255）；大於此值算實心。 */
  threshold?: number;
  /**
   * RDP 簡化容差，**像素**。越大頂點越少、越貼近凸包；越小越貼合但頂點越多。
   * Ramer–Douglas–Peucker tolerance in **pixels**. Larger means fewer vertices.
   */
  epsilon?: number;
}

const DEFAULTS = {
  step: 2,
  threshold: 8,
  epsilon: 3,
} as const;

/**
 * 在遮罩上以 Moore 鄰域追出最大輪廓。
 * Trace the largest outline with Moore-neighbour boundary following.
 *
 * 只追**單一**外輪廓（洞與其他分離塊忽略）：方團團的裝飾是連在身體上的，洞不會出現在
 * 外緣。這讓我們不必處理多輪廓的排序問題，也讓碰撞體維持單一凸分解輸入。
 * Only the **single** outer contour is traced (holes and detached blobs are ignored): the
 * decorations are attached to the body and no hole ever reaches the outer edge, so the
 * collider stays a single convex-decomposition input.
 *
 * @returns 依序排列的輪廓點；遮罩全空時回傳空陣列。
 */
export function traceContour(bitmap: Bitmap, options: TraceOptions = {}): Point[] {
  const { width, height, data } = bitmap;
  const step = Math.max(1, Math.floor(options.step ?? DEFAULTS.step));
  const threshold = options.threshold ?? DEFAULTS.threshold;

  const solid = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    /* `noUncheckedIndexedAccess` 未開啟，索引存取直接給 number。 */
    return (data[y * width + x] ?? 0) > threshold;
  };

  /* 由上往下、由左往右找第一個實心點（粗篩，用 step 取樣）。 */
  const start = findStart(bitmap, step, threshold);
  if (start === null) return [];

  /*
   * 八鄰域，從西向開始順時鐘排列。追蹤時「先回溯再順時鐘掃」，這是 Moore 追蹤的標準做法，
   * 保證貼著輪廓走而不會斜穿。
   * Eight neighbours ordered clockwise from west. The "backtrack then sweep clockwise" step
   * is standard Moore tracing and keeps the walk on the boundary.
   */
  const neighbours: readonly (readonly [number, number])[] = [
    [-step, 0],
    [-step, -step],
    [0, -step],
    [step, -step],
    [step, 0],
    [step, step],
    [0, step],
    [-step, step],
  ];

  const contour: Point[] = [{ x: start.x, y: start.y }];
  let cur = start;
  let cameFrom = 4; // 從東邊進來

  /* 上限：輪廓點數不可能超過取樣格數，留 4 倍餘裕防止病態輸入無限迴圈。 */
  const maxIterations = Math.ceil(width / step) * Math.ceil(height / step) * 4;

  for (let i = 0; i < maxIterations; i += 1) {
    let advanced = false;

    for (let k = 0; k < 8; k += 1) {
      const dir = (cameFrom + 5 + k) % 8;
      const [dx, dy] = neighbours[dir]!;
      const nx = cur.x + dx;
      const ny = cur.y + dy;

      if (solid(nx, ny)) {
        const previous = contour[contour.length - 1]!;
        if (nx !== previous.x || ny !== previous.y) contour.push({ x: nx, y: ny });
        cameFrom = dir;
        cur = { x: nx, y: ny };
        advanced = true;
        break;
      }
    }

    if (!advanced) break;
    if (cur.x === start.x && cur.y === start.y && contour.length > 3) break;
  }

  /* 追蹤可能回到起點而留下重複的收尾點，交給 RDP 前先移除。 */
  const deduped = contour.filter((p, index) => {
    const next = contour[index + 1];
    return next === undefined || next.x !== p.x || next.y !== p.y;
  });

  return deduped;
}

/**
 * 找出第一個實心取樣點。
 * Find the first solid sample point.
 */
function findStart(bitmap: Bitmap, step: number, threshold: number): Point | null {
  const { width, height, data } = bitmap;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if ((data[y * width + x] ?? 0) > threshold) return { x, y };
    }
  }

  return null;
}

/**
 * Ramer–Douglas–Peucker 簡化（**迭代**版，避免深輪廓爆遞迴堆疊）。
 * Ramer–Douglas–Peucker simplification, iterative so deep contours cannot blow the stack.
 *
 * 這是輪廓能否當碰撞體的關鍵一步：原始輪廓有一千多點，直接餵給 Matter 會產生幾百個凸塊。
 * RDP 會**保留尖角**（角點到弦的距離大，必定被留下），同時把直線段收成兩端點 —— 正好
 * 對應「身體是直邊、裝飾是尖角」的素材特性。
 * This is the step that makes the outline usable: the raw contour has >1000 points, which
 * would explode into hundreds of convex pieces. RDP **keeps corners** (their distance to the
 * chord is large, so they are always retained) while collapsing straight runs to endpoints —
 * exactly matching art that is straight-edged with sharp decorative corners.
 */
export function simplify(points: readonly Point[], epsilon: number): Point[] {
  if (points.length < 3) return [...points];

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;

    let farthest = first;
    let maxDistance = 0;

    for (let i = first + 1; i < last; i += 1) {
      const distance = perpendicularDistance(points[i]!, points[first]!, points[last]!);
      if (distance > maxDistance) {
        maxDistance = distance;
        farthest = i;
      }
    }

    if (maxDistance > epsilon) {
      keep[farthest] = true;
      stack.push([first, farthest], [farthest, last]);
    }
  }

  return points.filter((_, index) => keep[index]!);
}

/** 點到線段（由 a 到 b）的垂直距離；a == b 時退化為點距。 */
function perpendicularDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);

  const area = Math.abs(dy * point.x - dx * point.y + b.x * a.y - b.y * a.x);
  return area / Math.sqrt(lengthSquared);
}

/**
 * 把像素輪廓換算成**置中**於原點、以虛擬單位表示的多邊形。
 * Convert a pixel contour into a virtual-unit polygon centred on the origin.
 *
 * 換算用 sprite 的正規化常數（`SPRITE_SIZE` / `SPRITE_BODY` / `SPRITE_ANCHOR`）：先減去
 * body 中心（讓多邊形的原點落在身體中心），再乘上「半徑 → 像素」的比例。
 * The conversion uses the sprite normalisation constants: subtract the body centre so the
 * polygon's origin sits at the body centre, then apply the radius-to-pixel ratio.
 *
 * @param pixelContour 像素座標輪廓 / Contour in pixel coordinates.
 * @param scale 每個像素對應的虛擬單位 / Virtual units per pixel.
 * @param anchorX body 中心像素 X / Body centre X in pixels.
 * @param anchorY body 中心像素 Y / Body centre Y in pixels.
 */
export function toVirtualPolygon(
  pixelContour: readonly Point[],
  scale: number,
  anchorX: number,
  anchorY: number,
): Point[] {
  return pixelContour.map((point) => ({
    x: (point.x - anchorX) * scale,
    y: (point.y - anchorY) * scale,
  }));
}

/**
 * 多邊形是否退化到不能當碰撞體。
 * Whether a polygon is too degenerate to be a collider.
 *
 * 退化條件：點數少於 3，或是有向面積趨近 0（三點共線 / 全部重疊）。這種輸入餵給 Matter
 * 會產生零質量的剛體，比退回圓形更糟，所以呼叫端必須據此走 fallback。
 * Degenerate means fewer than 3 points or a near-zero signed area (collinear or coincident).
 * Feeding that to Matter yields a zero-mass body, which is worse than the circle fallback,
 * so the caller must branch on this.
 */
export function isDegenerate(polygon: readonly Point[], areaEpsilon = 1e-6): boolean {
  if (polygon.length < 3) return true;

  let area = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    area += a.x * b.y - b.x * a.y;
  }

  return Math.abs(area / 2) < areaEpsilon;
}

/**
 * 一步到位：遮罩 → 虛擬單位輪廓多邊形。
 * One-shot: mask → virtual-unit outline polygon.
 *
 * @returns 簡化後的輪廓；遮罩全空或結果退化時回傳 `null`（呼叫端應退回圓形）。
 */
export function contourToPolygon(
  bitmap: Bitmap,
  scale: number,
  anchorX: number,
  anchorY: number,
  options: TraceOptions = {},
): Point[] | null {
  const raw = traceContour(bitmap, options);
  if (raw.length < 3) return null;

  const epsilon = options.epsilon ?? DEFAULTS.epsilon;
  const simplified = simplify(raw, epsilon);
  if (simplified.length < 3) return null;

  const polygon = toVirtualPolygon(simplified, scale, anchorX, anchorY);

  return isDegenerate(polygon) ? null : polygon;
}
