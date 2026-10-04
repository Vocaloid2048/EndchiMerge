/**
 * 素材載入器。
 * Sprite loader.
 *
 * 把 `public/assets/character/*.webp` 載成 `HTMLImageElement`，並在**任何**失敗
 * （路徑錯、檔案缺失、解碼失敗）時標記為不可用，讓呼叫端退回程式佔位圖。
 * 這裡不拋錯：缺一張圖不該讓整個畫面開不起來。
 * Loads `public/assets/character/*.webp` into `HTMLImageElement`s and marks any
 * failure (bad path, missing file, decode error) as unavailable so the caller can
 * fall back to the programmatic placeholder. Nothing throws: one missing image
 * must not stop the board from rendering.
 */

import type { LevelDef } from '../core/types';

/** 一個等級的載入結果。 */
export interface SpriteEntry {
  /** 解碼完成的圖片；載入失敗時仍存在，但 `ok` 為 false。 */
  image: HTMLImageElement;
  /** true 表示可以直接 `drawImage`；false 表示應改用佔位圖。 */
  ok: boolean;
}

export interface SpriteLoaderOptions {
  /** 素材根路徑；預設為 Vite 的 `BASE_URL`。 */
  baseUrl?: string;
  /** 載入失敗時的回報；預設 `console.warn`。 */
  onWarn?: (message: string) => void;
}

/**
 * 由 `levels.json` 的相對路徑組出實際 URL。
 * Build the real URL from the relative path stored in `levels.json`.
 *
 * @param baseUrl 站台基底（結尾有無斜線皆可）/ Site base, with or without a trailing slash.
 * @param sprite `assets/` 之下的相對路徑 / Path relative to `assets/`.
 */
export function resolveSpriteUrl(baseUrl: string, sprite: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const path = sprite.replace(/^\/+/, '');
  return `${base}assets/${path}`;
}

/**
 * 載入並依等級編號保存所有素材。
 * Load and index every sprite by level id.
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
   * 並行載入整條合成鏈。單張失敗不影響其他張。
   * Load the whole merge chain in parallel; one failure does not affect the rest.
   *
   * @param levels 等級表 / The level table.
   */
  async loadAll(levels: readonly LevelDef[]): Promise<void> {
    await Promise.all(
      levels.map(async (level) => {
        const entry = await this.loadOne(level);
        this.entries.set(level.id, entry);
      }),
    );
  }

  /** 取得某一級的素材；未載入或載入失敗時回傳 undefined 或 `ok: false`。 */
  get(levelId: number): SpriteEntry | undefined {
    return this.entries.get(levelId);
  }

  /** 已處理過的等級數量（含失敗者）。 */
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
