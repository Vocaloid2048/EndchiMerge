import { defineConfig } from 'vite';

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
