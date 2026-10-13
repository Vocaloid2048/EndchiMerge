/**
 * 由已載入的 sprite 圖片導出輪廓碰撞多邊形並依等級快取；
 * 是 `render/silhouette.ts`（純幾何）與瀏覽器之間的黏合，只做「圖片 → 遮罩」。
 * Derives outline collision polygons from loaded sprites and caches them per level; the glue between `render/silhouette.ts` (pure geometry) and the browser, doing only "image → mask".
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
 * 輪廓取樣的參數，全部以像素為單位：`step = 2` 抓得住裝飾尖角，`epsilon = 3`
 * 把一千多個原始點收到 30 上下並保留尖角。
 * Contour sampling options, all in pixels: `step = 2` catches decorative corners and `epsilon = 3` collapses 1000+ raw points to about 30 while keeping them.
 */
export const SILHOUETTE_OPTIONS: Required<TraceOptions> = {
  step: 2,
  threshold: 8,
  epsilon: 3,
};

/**
 * 依等級編號快取的輪廓多邊形；`null` 表示該級沒有可用輪廓，呼叫端應退回圓形。
 * Outline polygons cached by level id; `null` means no usable outline and the caller falls back to a circle.
 */
export type SilhouetteCache = Map<number, Point[] | null>;

/**
 * 由圖片抽出 alpha 遮罩；用 `OffscreenCanvas`，不支援時回 `null`（呼叫端退回圓形）。
 * Extracts the alpha mask from an image via `OffscreenCanvas`; `null` when unsupported (the caller falls back to a circle).
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
 * 為單一等級導出輪廓多邊形；`scale` 是每個像素對應的虛擬單位（＝ `2 * radius / SPRITE_BODY`）。
 * Derives the outline polygon for one level; `scale` is virtual units per pixel (＝ `2 * radius / SPRITE_BODY`).
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
 * 為整條合成鏈導出並快取輪廓；單一等級失敗記為 `null`，不影響其他級。
 * Derives and caches outlines for the whole merge chain; one level failing is recorded as `null` and does not affect the rest.
 *
 * 每一級都要用自己的 `scale` 重算（半徑不同），不能共用一份輪廓再縮放 —— 那會累積取樣誤差。
 * Each level is traced with its own scale (radii differ); sharing one outline and resizing it would compound sampling error.
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
 * The next two exports exist for tests: the whole pipeline is verified in node against synthetic masks without decoding a real webp.
 */

/**
 * 測試用：由遮罩直接導出虛擬多邊形（略過瀏覽器）。
 * For tests: derives the virtual polygon straight from a mask, skipping the browser.
 */
export function polygonFromMask(
  mask: Bitmap,
  scale: number,
  options: Required<TraceOptions> = SILHOUETTE_OPTIONS,
): Point[] | null {
  return contourToPolygon(mask, scale, SPRITE_ANCHOR.x, SPRITE_ANCHOR.y, options);
}

/**
 * 測試用：回傳「原始輪廓點數 → 簡化後點數」，用於驗證簡化確實收斂。
 * For tests: returns raw vs simplified point counts, verifying the simplification converges.
 */
export function traceStats(
  mask: Bitmap,
  options: Required<TraceOptions> = SILHOUETTE_OPTIONS,
): { raw: number; simplified: number } {
  const raw = traceContour(mask, options);
  return { raw: raw.length, simplified: simplify(raw, options.epsilon).length };
}

export { isDegenerate, toVirtualPolygon };
