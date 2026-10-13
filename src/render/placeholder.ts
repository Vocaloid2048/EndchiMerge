/**
 * 程式化佔位方團團：只在對應的 WebP 素材載入失敗時繪製，且不依賴任何檔案。
 * Programmatic placeholder dumpling, drawn only when the matching WebP fails to load and depending on no files.
 */

/**
 * 每級一條顏色，索引 0 對應 Lv1。
 * One colour per level; index 0 is Lv1.
 */
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

const CORNER_RATIO = 0.1175;

/**
 * 取得某一級的佔位色；超出表尾時沿用最後一個顏色。
 * Placeholder colour for a level; levels past the end of the table reuse the last colour.
 */
export function placeholderColor(levelId: number): string {
  const index = Math.min(Math.max(Math.trunc(levelId), 1), PALETTE.length) - 1;
  return PALETTE[index] as string;
}

export interface PlaceholderOptions {
  x: number;
  y: number;
  /**
   * 外接半徑：圓角方形會內接於邊長 `2 * radius` 的方框。
   * Circumradius: the rounded square is inscribed in a box of side `2 * radius`.
   */
  radius: number;
  levelId: number;
  /**
   * 覆寫顯示文字；未提供時顯示等級數字。
   * Overrides the displayed text; the level number is shown when omitted.
   */
  label?: string;
  scaleText?: boolean;
}

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

  // 徑向漸層：左上偏亮、右下偏暗，做出球體感。
  // Radial gradient lit from the upper left and shaded to the lower right, for a spherical read.
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

  ctx.beginPath();
  ctx.arc(x - radius * 0.34, y - radius * 0.34, radius * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.fill();

  // 中央數字；`ctx.font` 只吃字級字串，不吃 CSS 變數。
  // The centred number; `ctx.font` needs a size string, not a CSS variable.
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
