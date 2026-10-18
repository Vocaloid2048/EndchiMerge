/**
 * 玩法模式（伺服器端）：一局的模式決定它落在哪一列 profile，也決定榜的篩選。
 * Play modes on the server: a run's mode picks which profile row it lands in, and what a board filters to.
 */

export type RunMode = 'new' | 'traditional';

/** 所有模式；舊客戶端沒送 `mode` 時一律當新玩法。 */
export const RUN_MODES: readonly RunMode[] = ['new', 'traditional'];

export const DEFAULT_RUN_MODE: RunMode = 'new';

export function isRunMode(value: unknown): value is RunMode {
  return value === 'new' || value === 'traditional';
}

/**
 * 榜的模式篩選：具體模式，或 `'all'`（兩個模式一起列，每一列自帶模式）。
 * A board's mode filter: one mode, or `'all'` (both listed, each row carrying its own mode).
 */
export type BoardFilter = 'all' | RunMode;

export function isBoardFilter(value: unknown): value is BoardFilter {
  return value === 'all' || isRunMode(value);
}

/** 篩選 → 查詢用的模式；`'all'` 對應 `null`。 */
export function filterMode(filter: BoardFilter): RunMode | null {
  return filter === 'all' ? null : filter;
}
