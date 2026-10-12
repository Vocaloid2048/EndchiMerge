import { readFileSync } from 'node:fs';

import { defineConfig } from 'vite';

/**
 * `package.json` 的版本，編譯時替換成字面值（`__APP_VERSION__`）。
 * The version from `package.json`, substituted at build time as `__APP_VERSION__`.
 *
 * 用途只有一個：每一筆提交都帶著它，伺服器把它存進 `scores.version`。查一件舊事時，「這一筆是
 * 哪個版本的客戶端送出來的」是唯一問得出來的線索 —— 而 `package.json` 是版本唯一的出處，所以
 * 抄一份到別的地方只會製造第二個真相。
 * It has exactly one use: every submission carries it and the server stores it in
 * `scores.version`. "Which client version produced this row" is the only clue available when
 * looking into something old, and `package.json` is the single source of the version — copying it
 * elsewhere would create a second truth.
 */
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

/**
 * Vite 建置設定。
 * Vite build configuration.
 *
 * `base` 固定為根路徑：Vercel 自訂網域與 Docker nginx 皆以網站根目錄提供資源。
 * `base` stays at the root path because both the Vercel custom domain and the
 * Docker nginx image serve the app from the site root.
 */
export default defineConfig({
  base: '/',
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
