// EdgeOne Node Function 入口：把核心處理器接成 Web 標準的具名匯出。
import { handleHealth } from '../../api/_lib/handlers.js';
import { endpoint } from '../../api/_lib/runtime.js';
import { createEdgeOneHandlers } from '../../api/_lib/adapters/fetch.js';

export const { onRequestGet, onRequestPost, onRequestOptions } =
  createEdgeOneHandlers(endpoint(handleHealth));
