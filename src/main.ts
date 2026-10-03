import './styles/main.css';

/**
 * 應用程式入口：掛載根節點並顯示骨架就緒狀態。
 * Application entry point: mount the root node and report scaffold readiness.
 *
 * 目前僅建立最小可執行骨架。實際子系統（core / game / render / ui / audio）
 * 與 public/config、public/assets 結構將於 repo 結構定案後陸續加入。
 * Only the minimal runnable skeleton lives here. The real subsystems
 * (core / game / render / ui / audio) plus public/config and public/assets
 * will be added once the repo structure is settled.
 */
const root: HTMLElement | null = document.querySelector('#app');

if (root === null) {
  throw new Error('Root element "#app" is missing from index.html.');
}

const placeholder: HTMLParagraphElement = document.createElement('p');
placeholder.className = 'boot-placeholder';
placeholder.textContent = 'EndchiMerge — 骨架就緒 / scaffold ready';

root.append(placeholder);
