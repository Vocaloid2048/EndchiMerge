/**
 * Makers `cloud-functions` 入口：薄接線，把核心處理器接到 EdgeOne 邊緣轉接頭。
 * Makers `cloud-functions` entry — a thin wire joining the core handler to the EdgeOne edge adapter.
 */
import { endpoint } from '../../../api/_lib/runtime.js';
import { handleRunStart } from '../../../api/_lib/handlers.js';
import { createEdgeOneHandlers } from '../../../api/_lib/adapters/fetch.js';

export const { onRequestGet, onRequestPost, onRequestOptions } = createEdgeOneHandlers(
  endpoint(handleRunStart),
);
