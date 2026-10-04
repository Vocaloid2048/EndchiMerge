/**
 * 全域常數。
 * Global constants.
 *
 * 只放真正全域、且不適合外部化成 JSON 的值。可調參數一律放
 * `public/config/`，不要加進來。
 * Only values that are truly global and unsuitable for externalisation live
 * here. Anything tunable belongs in `public/config/`.
 */

/**
 * 世界座標的虛擬高度。
 * Virtual height of the world.
 *
 * 鎖高度而非鎖寬度：垂直空間決定遊戲難度（堆疊高度、溢出線），鎖高度才能保證
 * 換裝置時難度曲線不變。寬度依容器實際像素寬度浮動。
 * Height is locked rather than width because vertical space determines
 * difficulty. Locking height keeps the difficulty curve stable across devices;
 * the width floats with the container.
 */
export const VIRTUAL_HEIGHT = 1000;

/** 牆壁厚度，虛擬單位。同時用於把遊戲區往內縮，避免貼邊物體被畫出框外。 */
export const WALL_THICKNESS = 16;

/**
 * Sprite 正規化的三個常數（design.md §1.5.1／D16／D28）。
 * The three sprite normalisation constants.
 *
 * 素材端已把每個角色正規化成「512² 畫布、body 外框 304、body 中心 (256, 328)、
 * 其餘完全透明」。因此渲染器**不需要**在 `levels.json` 存任何尺寸或偏移 ——
 * 只要這三個數字就能把任何等級的碰撞圓對上畫面。
 * The assets are normalised to a 512² canvas with a 304 body box centred at
 * (256, 328) and fully transparent padding, so the renderer needs no per-level size
 * or offset — these three numbers are enough to align any collision circle.
 *
 * 留白必須透明（§1.5.1）：§3.2 的輪廓白框是從 alpha 通道推導形狀的，若留白填白，
 * 剪影會變成整張畫布而讓所有量測靜默失效。
 * The padding must stay transparent: the D20 outline frame derives its shape from the
 * alpha channel, so opaque padding would silently turn the silhouette into the whole
 * canvas.
 */
export const SPRITE_SIZE = 512;

/** body 外框邊長，像素。實測為 304 ± 2。 */
export const SPRITE_BODY = 304;

/** body 中心在畫布中的位置，像素。y 偏下是因為裝飾多在身體上方。 */
export const SPRITE_ANCHOR = { x: 256, y: 328 } as const;

/**
 * 「碰撞半徑 → sprite 繪製縮放」的換算率。
 * Conversion factor from collision radius to sprite draw scale.
 *
 * 與 design.md §1.5.1 的公式一致：`scale = (2 * radius) / SPRITE_BODY`。
 * Matches the formula in design.md §1.5.1.
 */
export function spriteScaleForRadius(radius: number): number {
  return (2 * radius) / SPRITE_BODY;
}

/**
 * 技力硬上限（程式常數）。
 * Hard ceiling for SP (a code constant).
 *
 * 這是安全閥，不是玩法參數：`skills.json` 的 `sp.max` 載入時會被鉗制到此值以下。
 * 存在理由是避免配置檔寫出一個爆掉 UI 的數字。
 * This is a safety valve rather than a gameplay parameter: `sp.max` from
 * `skills.json` is clamped to it on load, so a bad config cannot blow up the UI.
 */
export const SP_MAX_CEILING = 5;

/** Matter.js 求解器迭代次數。提高位置迭代可減少堆疊穿透，代價是 CPU。 */
export const ENGINE_POSITION_ITERATIONS = 8;

/** Matter.js 速度迭代次數。 */
export const ENGINE_VELOCITY_ITERATIONS = 6;

/** 是否啟用休眠。靜止物體會停止計算，對大量堆疊的效能影響顯著。 */
export const ENGINE_ENABLE_SLEEPING = true;

/** 合成時的彈跳動畫時長，毫秒。 */
export const POP_ANIMATION_MS = 180;

/** 彈跳動畫的峰值縮放倍率。 */
export const POP_PEAK_SCALE = 1.3;

/** 本地儲存鍵的前綴，避免與同網域其他專案衝突。 */
export const STORAGE_PREFIX = 'endchimerge';

/** 本地儲存鍵。 */
export const STORAGE_KEYS = {
  profile: `${STORAGE_PREFIX}:profile`,
  unlocks: `${STORAGE_PREFIX}:unlocks`,
  highScore: `${STORAGE_PREFIX}:high-score`,
  deviceId: `${STORAGE_PREFIX}:device-id`,
  preferences: `${STORAGE_PREFIX}:preferences`,
} as const;

/** 版面斷點（像素）。低於 tablet 視為手機，低於 desktop 視為平板。 */
export const BREAKPOINT_TABLET = 768;

/** 桌面斷點。 */
export const BREAKPOINT_DESKTOP = 1024;
