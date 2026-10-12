/// <reference types="vite/client" />

/**
 * 編譯時替換的版本號（`vite.config.ts` 的 `define`，值來自 `package.json`）。
 * The version substituted at build time (`define` in `vite.config.ts`, sourced from `package.json`).
 *
 * 只有一個用途：隨每一筆提交送給伺服器，存進 `scores.version`（見 `game/remoteLeaderboard.ts`）。
 * It has exactly one use: sent with every submission and stored in `scores.version` (see
 * `game/remoteLeaderboard.ts`).
 */
declare const __APP_VERSION__: string;
