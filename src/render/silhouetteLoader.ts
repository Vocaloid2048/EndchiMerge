/**
 * 由已載入的 sprite 圖片導出輪廓碰撞多邊形，並依等級快取。
 * Derive outline collision polygons from loaded sprite images and cache them per level.
 *
 * 這一層是 `render/silhouette.ts`（純幾何）與瀏覽器之間的黏合：它把 `HTMLImageElement`
 * 畫進一張 `OffscreenCanvas`，讀出 alpha 遮罩，交給純幾何函式追輪廓，再快取結果。之所以
 * 分開，是為了讓輪廓演算法能在 node 環境被單元測試 —— 這裡只做「圖片 → 遮罩」那段。
 * This layer glues the browser to `render/silhouette.ts` (pure geometry): it paints an
 * `HTMLImageElement` into an `OffscreenCanvas`, reads the alpha mask, hands it to the pure
 * tracer, and caches the result. The split exists so the tracing maths unit-tests in node;
 * only the "image → mask" step lives here.
 *
 * **為什麼在啟動時算一次**：追蹤 512² 遮罩雖然只要幾毫秒，但每投一顆都算就毫無意義 ——
 * 同一張圖的輪廓永遠一樣。啟動時算 10 個等級，之後投合成都用快取。
 * **Why compute once at boot**: tracing a 512² mask takes milliseconds, but recomputing it on
 * every drop is pointless — the outline of an image never changes. Ten levels are traced once
 * at boot and every drop and merge reuses the cache.
 */

import {
  contourToPolygon,
  traceContour,
  simplify,
  toVirtualPolygon,
  isDegenerate,
  type Bitmap,
  type Point,
  type TraceOptions,
} from './silhouette';
import { SPRITE_ANCHOR, SPRITE_BODY } from '../core/constants';
import type { LevelDef } from '../core/types';
import type { SpriteSource } from './stage';

/**
 * 輪廓取樣的參數，全部以**像素**為單位。
 * Contour sampling options, all in **pixels**.
 *
 * `step = 2` 在 512² 上掃 256² 個點，足以抓出裝飾尖角；`epsilon = 3` 把一千多個原始點收
 * 到 30 上下，同時保留尖角（實測各級 26～43 點）。
 * `step = 2` probes 256² points on a 512² canvas, enough to catch decorative corners;
 * `epsilon = 3` collapses the >1000 raw points to about 30 while keeping corners (measured
 * 26–43 per level).
 */
export const SILHOUETTE_OPTIONS: Required<TraceOptions> = {
  step: 2,
  threshold: 8,
  epsilon: 3,
};

/** 依等級編號快取的輪廓多邊形；`null` 表示該級沒有可用輪廓，呼叫端應退回圓形。 */
export type SilhouetteCache = Map<number, Point[] | null>;

/**
 * 由圖片抽出 alpha 遮罩。
 * Extract the alpha mask from an image.
 *
 * 刻意**不**用 `getImageData` 於主畫布：那需要一張可見的 canvas，而這裡只需要暫時的點陣。
 * `OffscreenCanvas` 在支援的瀏覽器上一次配置即可；不支援時回傳 `null`，呼叫端退回圓形。
 * Deliberately avoids `getImageData` on the main canvas — this needs only a transient bitmap.
 * `OffscreenCanvas` is a one-off allocation where supported; where it is not, `null` is
 * returned and the caller falls back to circles.
 */
export function extractAlphaMask(image: HTMLImageElement): Bitmap | null {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (width <= 0 || height <= 0) return null;

  if (typeof OffscreenCanvas === 'undefined') return null;

  try {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (ctx === null) return null;

    ctx.drawImage(image, 0, 0);

    const pixels = ctx.getImageData(0, 0, width, height).data;
    const alpha = new Uint8ClampedArray(width * height);

    /* 只留 alpha 通道：輪廓只在乎「實心與否」，顏色與輪廓無關。 */
    for (let i = 0; i < alpha.length; i += 1) {
      alpha[i] = pixels[i * 4 + 3] ?? 0;
    }

    return { width, height, data: alpha };
  } catch {
    /* 跨來源圖片會讓 `getImageData` 拋錯；那時退回圓形比整個遊戲開不起來好。 */
    return null;
  }
}

/**
 * 為單一等級導出輪廓多邊形。
 * Derive the outline polygon for one level.
 *
 * @param scale 每個像素對應的虛擬單位（＝ `2 * radius / SPRITE_BODY`）。
 * @returns 相對身體中心的多邊形；無法導出時回傳 `null`。
 */
export function polygonForSprite(
  image: HTMLImageElement,
  scale: number,
  options: Required<TraceOptions> = SILHOUETTE_OPTIONS,
): Point[] | null {
  const mask = extractAlphaMask(image);
  if (mask === null) return null;

  return contourToPolygon(mask, scale, SPRITE_ANCHOR.x, SPRITE_ANCHOR.y, options);
}

/**
 * 為整條合成鏈導出並快取輪廓。
 * Derive and cache outlines for the whole merge chain.
 *
 * 單一等級失敗不會影響其他級：失敗者記為 `null`，遊玩時退回圓形碰撞體。
 * One level failing does not affect the rest: it is recorded as `null` and falls back to a
 * circle at play time.
 *
 * 注意比例依半徑而定：不同等級的半徑不同，同一個 304 px body 會縮放成不同虛擬尺寸，所以
 * 每一級都要用自己的 `scale` 重算（不能共用同一份輪廓再縮放 —— 那會累積取樣誤差）。
 * The scale is per-level: each radius maps the same 304 px body to a different virtual size,
 * so every level is traced with its own scale rather than sharing one outline and resizing it
 * (which would compound sampling error).
 */
export function buildSilhouetteCache(
  levels: readonly LevelDef[],
  sprites: SpriteSource,
  options: Required<TraceOptions> = SILHOUETTE_OPTIONS,
): SilhouetteCache {
  const cache: SilhouetteCache = new Map();

  for (const level of levels) {
    const entry = sprites.get(level.id);
    if (entry === undefined || !entry.ok) {
      cache.set(level.id, null);
      continue;
    }

    const scale = (2 * level.radius) / SPRITE_BODY;
    cache.set(level.id, polygonForSprite(entry.image, scale, options));
  }

  return cache;
}

/*
 * 以下兩個函式匯出給測試使用，讓測試可以在 node 環境用合成遮罩驗證整條管線，
 * 不必真的解碼 webp。
 * The next two exports exist for tests: they let the whole pipeline be verified in node
 * against synthetic masks without decoding a real webp.
 */

/** 測試用：由遮罩直接導出虛擬多邊形（略過瀏覽器）。 */
export function polygonFromMask(
  mask: Bitmap,
  scale: number,
  options: Required<TraceOptions> = SILHOUETTE_OPTIONS,
): Point[] | null {
  return contourToPolygon(mask, scale, SPRITE_ANCHOR.x, SPRITE_ANCHOR.y, options);
}

/** 測試用：回傳「原始輪廓點數 → 簡化後點數」，用於驗證簡化確實收斂。 */
export function traceStats(
  mask: Bitmap,
  options: Required<TraceOptions> = SILHOUETTE_OPTIONS,
): { raw: number; simplified: number } {
  const raw = traceContour(mask, options);
  return { raw: raw.length, simplified: simplify(raw, options.epsilon).length };
}

export { isDegenerate, toVirtualPolygon };
