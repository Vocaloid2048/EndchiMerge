import { defineConfig } from 'vitest/config';

/**
 * Vitest 設定。
 * Vitest configuration.
 *
 * 測試只涵蓋**確定性邏輯**（配置驗證、蛇形佈局、計分、連擊、技力），這些都不碰 DOM，
 * 因此環境固定為 node，避免為了跑純函式而拉進整個 jsdom。
 * Tests only cover deterministic logic (config validation, serpentine layout,
 * scoring, combo, SP). None of it touches the DOM, so the environment stays on
 * node rather than pulling in jsdom just to run pure functions.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
});
