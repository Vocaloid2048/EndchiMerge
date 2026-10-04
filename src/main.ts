import './styles/main.css';
import { createLayout } from './ui/layout';

/**
 * 應用程式入口。
 * Application entry point.
 *
 * 目前只掛載七區域版面骨架。M0 的配置／素材載入與 M2／M3 的名冊、容器、投放
 * 會在後續步驟接進來，屆時這裡負責把它們組裝起來（agent-readme §0.2：`main.ts`
 * 是組裝點，不含遊戲邏輯）。
 * For now this mounts the seven-region skeleton only. Config/sprite loading and
 * the M2/M3 roster, container and dropping are wired in by later steps; this file
 * stays the assembly point and holds no game logic.
 */
function bootstrap(): void {
  const host = document.querySelector<HTMLElement>('#app');

  if (host === null) {
    throw new Error('Root element "#app" is missing from index.html.');
  }

  createLayout(host);
}

bootstrap();
