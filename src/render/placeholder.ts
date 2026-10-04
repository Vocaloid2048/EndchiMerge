/**
 * 程式化佔位方團團。
 * Programmatic placeholder dumpling.
 *
 * 只有在對應的 WebP 素材載入失敗時才會畫到畫面上。它必須**不依賴任何檔案**，
 * 因為它的存在意義就是「素材不見了，遊戲仍然要能跑」——這條性質是快速下架
 * 能力的基礎（agent-readme §0.4）。
 * Drawn only when the matching WebP fails to load. It must depend on no files at
 * all: its whole purpose is "the art is gone but the game still runs", which is
 * the basis of the takedown escape hatch (agent-readme §0.4).
 *
 * 形狀刻意做成**圓角方形**而非圓形，呼應角色原稿的身體（251×251、rx≈29.5，
 * 圓角約為邊長的 11.75%）。
 * The shape is a rounded square rather than a circle, echoing the character
 * bodies (251×251 with rx≈29.5, i.e. corner radius ≈ 11.75% of the side).
 */

/** 每級一條顏色，索引 0 對應 Lv1。 */
const PALETTE: readonly string[] = [
  '#9ca3af',
  '#60a5fa',
  '#4ade80',
  '#facc15',
  '#fb923c',
  '#f87171',
  '#c084fc',
  '#f472b6',
  '#38bdf8',
  '#fcd34d',
];

/** 圓角佔邊長的比例，取自角色原稿的 rx / 邊長。 */
const CORNER_RATIO = 0.1175;

/** 取得某一級的佔位色；超出表尾時沿用最後一個顏色。 */
export function placeholderColor(levelId: number): string {
  const index = Math.min(Math.max(Math.trunc(levelId), 1), PALETTE.length) - 1;
  return PALETTE[index] as string;
}

export interface PlaceholderOptions {
  /** 圓心 X，畫布像素。 */
  x: number;
  /** 圓心 Y，畫布像素。 */
  y: number;
  /** 外接半徑：圓角方形會內接於邊長 `2 * radius` 的方框。 */
  radius: number;
  /** 等級編號，決定顏色與顯示數字。 */
  levelId: number;
  /** 覆寫顯示文字；未提供時顯示等級數字。 */
  label?: string;
  /** 文字是否隨等級放大；名冊縮圖通常關掉以維持可讀。 */
  scaleText?: boolean;
}

/**
 * 把五個階段的繪製拆開，方便日後描邊快取重複利用同一組幾何。
 * Splitting the drawing into stages keeps the geometry reusable if outline
 * baking ever wants to redraw it.
 */
function roundedSquarePath(ctx: CanvasRenderingContext2D, options: PlaceholderOptions): void {
  const size = options.radius * 2;
  const r = Math.min(size * CORNER_RATIO, options.radius);
  const left = options.x - options.radius;
  const top = options.y - options.radius;

  ctx.beginPath();
  ctx.moveTo(left + r, top);
  ctx.lineTo(left + size - r, top);
  ctx.quadraticCurveTo(left + size, top, left + size, top + r);
  ctx.lineTo(left + size, top + size - r);
  ctx.quadraticCurveTo(left + size, top + size, left + size - r, top + size);
  ctx.lineTo(left + r, top + size);
  ctx.quadraticCurveTo(left, top + size, left, top + size - r);
  ctx.lineTo(left, top + r);
  ctx.quadraticCurveTo(left, top, left + r, top);
  ctx.closePath();
}

/**
 * 畫一顆佔位方團團。
 * Draw one placeholder dumpling.
 *
 * @param ctx 目標 2D 畫布 / Target 2D canvas context.
 * @param options 位置、大小與等級 / Position, size and level.
 */
export function drawPlaceholderDumpling(ctx: CanvasRenderingContext2D, options: PlaceholderOptions): void {
  const { x, y, radius, levelId } = options;
  const fill = placeholderColor(levelId);
  const scaleText = options.scaleText ?? true;

  ctx.save();
  roundedSquarePath(ctx, options);

  /* 徑向漸層：左上偏亮、右下偏暗，做出球體感。 */
  const gradient = ctx.createRadialGradient(
    x - radius * 0.35,
    y - radius * 0.35,
    radius * 0.1,
    x,
    y,
    radius * 1.15,
  );
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.18, fill);
  gradient.addColorStop(1, shade(fill, -0.35));
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.lineWidth = Math.max(1, radius * 0.08);
  ctx.strokeStyle = shade(fill, -0.5);
  ctx.stroke();

  /* 高光點，位於左上三分之一處。 */
  ctx.beginPath();
  ctx.arc(x - radius * 0.34, y - radius * 0.34, radius * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.fill();

  /* 中央數字。font 必須寫入 ctx.font，故用字級字串而非 CSS 變數。 */
  const fontSize = scaleText ? radius * 0.9 : radius * 0.95;
  ctx.font = `600 ${fontSize.toFixed(1)}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(17, 18, 22, 0.88)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(options.label ?? String(levelId), x, y + radius * 0.04);

  ctx.restore();
}

/**
 * 依比例調整十六進位顏色的明度。
 * Lighten or darken a hex colour by a ratio.
 *
 * @param hex `#rrggbb` 格式的顏色 / Colour in `#rrggbb` form.
 * @param ratio 負值變暗、正值變亮（-1 ~ 1）/ Negative darkens, positive lightens.
 */
function shade(hex: string, ratio: number): string {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(value.slice(offset, offset + 2), 16);
    const shifted = ratio < 0 ? channel * (1 + ratio) : channel + (255 - channel) * ratio;
    return Math.max(0, Math.min(255, Math.round(shifted)));
  });
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}
