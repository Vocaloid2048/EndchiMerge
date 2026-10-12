/**
 * 時長格式化。
 * Duration formatting.
 *
 * 一局的長度現在只在**排行榜**上出現（使用者定案：HUD 與結算卡都不再顯示這一局的時間），
 * 所以這裡定一種格式、也只有一處消費：榜上每一列、分類數值右邊的那一格。
 * A run's length now appears **only on the leaderboard** (the user's decision: neither the HUD nor
 * the game-over card shows the current run's time), so one format is fixed here and consumed in
 * exactly one place — the cell to the right of each row's category value.
 *
 * **格式固定是 `HH:mm:ss`**（`00:00:07`、`00:12:34`、`01:15:00`）：使用者指名這個格式，而且榜上
 * 是一整欄數字疊在一起，補零之後每個字元都會對齊（列上已有 `font-variant-numeric: tabular-nums`）。
 * 舊版的兩段式（未滿一小時用 `m:ss`）在只剩一個消費點之後就不划算了 —— 那個形狀存在的理由，
 * 正是替 HUD 分數旁邊那個窄位子省字元。小時欄也沒有上限：過了 `99:59:59` 自然長出第三位，
 * 不會回繞成兩位數。
 * **The shape is fixed at `HH:mm:ss`** (`00:00:07`, `00:12:34`, `01:15:00`): the user named that
 * format, and a column of numbers lines up character by character once every field is padded (the
 * rows already carry `tabular-nums`). The old two-shape scheme (`m:ss` under an hour) stopped
 * earning its keep once a single consumer remained — that second shape existed to save characters
 * in the narrow slot beside the HUD score. The hours field is unbounded: past `99:59:59` it simply
 * grows a third digit instead of wrapping back to two.
 */

/** 把毫秒格式化成 `HH:mm:ss`；負值與非有限數都視為 0。 */
export function formatDuration(ms: number): string {
  const totalSeconds = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;

  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const pad = (value: number): string => String(value).padStart(2, '0');

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
