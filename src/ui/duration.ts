/**
 * 時長格式化：**固定 `HH:mm:ss`**（補零對齊、小時欄無上限），一局的長度只在排行榜上出現。
 * Duration formatting: always `HH:mm:ss` (zero-padded, unbounded hours), shown only on the leaderboard.
 */

/**
 * 把毫秒格式化成 `HH:mm:ss`；負值與非有限數都視為 0。
 * Formats milliseconds as `HH:mm:ss`; negative and non-finite inputs become 0.
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;

  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const pad = (value: number): string => String(value).padStart(2, '0');

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
