/**
 * 時長格式化。
 * Duration formatting.
 *
 * 一局的長度要顯示在分數旁邊（使用者定案），而它出現的地方有三種寬度：HUD 分數卡那個大字旁邊
 * 的一小段、結算卡的一格、以及日後排行榜列。與其讓每個地方各寫一份 `padStart`，這裡定一次
 * 格式，三處共用。
 * A run's length is shown next to the score (the user's decision), and it appears in three places of
 * very different widths: a small note beside the HUD's big number, a cell in the game-over card,
 * and eventually a leaderboard row. Rather than each site writing its own `padStart`, the format is
 * fixed here once.
 *
 * **格式有兩段**：未滿一小時用 `m:ss`（`0:07`、`12:34`、`75:00` 不成立 —— 見下），滿一小時才
 * 長出時段 `h:mm:ss`。時間類的讀者習慣看 `mm:ss`，所以分鐘不補零、小時不佔位；但**分鐘不會
 * 進位成 60**，`1:15:00` 才是 75 分鐘，不會印成 `75:00` 讓兩段格式的界線變成模糊的。
 * **Two shapes**: under an hour it is `m:ss` (`0:07`, `12:34`); at an hour or more it grows an
 * hours field to `h:mm:ss`. Readers of a timer expect `mm:ss`, so minutes are not zero-padded and
 * hours take no slot when unused — but minutes **never** reach 60, so 75 minutes prints `1:15:00`
 * rather than `75:00`, which would blur where one shape ends and the other begins.
 */

/** 把毫秒格式化成 `m:ss`（滿一小時為 `h:mm:ss`）；負值與非有限數都視為 0。 */
export function formatDuration(ms: number): string {
  const totalSeconds = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;

  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const pad = (value: number): string => String(value).padStart(2, '0');
  const tail = `${pad(minutes)}:${pad(seconds)}`;

  return hours > 0 ? `${String(hours)}:${tail}` : `${String(minutes)}:${pad(seconds)}`;
}
