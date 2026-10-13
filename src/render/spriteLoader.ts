/**
 * 素材載入器：把 `public/assets/character/*.webp` 載成 `HTMLImageElement`，任何失敗都標記為不可用而不拋錯。
 * The sprite loader: loads `public/assets/character/*.webp` into `HTMLImageElement`s, marking any failure as unavailable instead of throwing.
 */

import type { LevelDef } from '../core/types';

/**
 * 一個等級的載入結果。
 * One level's load result.
 */
export interface SpriteEntry {
  /**
   * 解碼完成的圖片；載入失敗時仍存在，但 `ok` 為 false。
   * The decoded image; present even on failure, with `ok` false.
   */
  image: HTMLImageElement;
  /**
   * true 表示可以直接 `drawImage`；false 表示應改用佔位圖。
   * true means `drawImage` is safe; false means use the placeholder.
   */
  ok: boolean;
}

export interface SpriteLoaderOptions {
  /**
   * 素材根路徑；預設為 Vite 的 `BASE_URL`。
   * The asset root; defaults to Vite's `BASE_URL`.
   */
  baseUrl?: string;
  /**
   * 載入失敗時的回報；預設 `console.warn`。
   * The failure reporter; defaults to `console.warn`.
   */
  onWarn?: (message: string) => void;
}

/**
 * 由 `levels.json` 的相對路徑組出實際 URL。
 * Builds the real URL from the relative path stored in `levels.json`.
 */
export function resolveSpriteUrl(baseUrl: string, sprite: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const path = sprite.replace(/^\/+/, '');
  return `${base}assets/${path}`;
}

/**
 * 載入並依等級編號保存所有素材。
 * Loads and indexes every sprite by level id.
 */
export class SpriteLoader {
  private readonly baseUrl: string;
  private readonly onWarn: (message: string) => void;
  private readonly entries = new Map<number, SpriteEntry>();

  constructor(options: SpriteLoaderOptions = {}) {
    this.baseUrl = options.baseUrl ?? import.meta.env.BASE_URL;
    this.onWarn = options.onWarn ?? ((message: string): void => console.warn(`[assets] ${message}`));
  }

  /**
   * 並行載入整條合成鏈；單張失敗不影響其他張。
   * Loads the whole merge chain in parallel; one failure does not affect the rest.
   */
  async loadAll(levels: readonly LevelDef[]): Promise<void> {
    await Promise.all(
      levels.map(async (level) => {
        const entry = await this.loadOne(level);
        this.entries.set(level.id, entry);
      }),
    );
  }

  /**
   * 取得某一級的素材；未載入或載入失敗時回傳 undefined 或 `ok: false`。
   * Returns a level's sprite; `undefined` when never loaded, `ok: false` when failed.
   */
  get(levelId: number): SpriteEntry | undefined {
    return this.entries.get(levelId);
  }

  /**
   * 取得某一級的圖片 URL；DOM 場景自己建 `<img>` 並沿用瀏覽器快取
   * （同一個 `HTMLImageElement` 不可能同時出現在兩個位置）。
   * Returns a level's image URL; DOM surfaces build their own `<img>` reusing the browser cache (one element cannot be in two places).
   */
  srcFor(level: LevelDef): string {
    return resolveSpriteUrl(this.baseUrl, level.sprite);
  }

  /**
   * 已處理過的等級數量（含失敗者）。
   * How many levels have been processed (failures included).
   */
  get size(): number {
    return this.entries.size;
  }

  private async loadOne(level: LevelDef): Promise<SpriteEntry> {
    const image = new Image();
    image.decoding = 'async';

    if (level.sprite.trim() === '') {
      this.onWarn(`level ${level.id} has no sprite path; the placeholder will be used.`);
      return { image, ok: false };
    }

    const url = resolveSpriteUrl(this.baseUrl, level.sprite);

    return new Promise<SpriteEntry>((resolve) => {
      image.addEventListener(
        'load',
        (): void => {
          void image
            .decode()
            .then((): void => resolve({ image, ok: true }))
            /* 部分瀏覽器對已載入的圖仍會讓 decode() 失敗；此時 load 已成立，照用。 */
            .catch((): void => resolve({ image, ok: true }));
        },
        { once: true },
      );

      image.addEventListener(
        'error',
        (): void => {
          this.onWarn(`${url} could not be loaded; the placeholder will be used for level ${level.id}.`);
          resolve({ image, ok: false });
        },
        { once: true },
      );

      image.src = url;
    });
  }
}
