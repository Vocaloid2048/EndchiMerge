/**
 * KV 儲存層的組裝點；對應 `STORAGE_BACKEND=kv`（EdgeOne Makers 的 `cloud-functions`）。
 * The KV storage assembly point; for `STORAGE_BACKEND=kv` (EdgeOne Makers `cloud-functions`).
 */

import type { Config } from '../env.js';
import type { Driver } from '../db/types.js';
import type { Store } from '../store.js';
import { KvStore } from './kvStore.js';

/** kv 模式沒有連線池可關；給 `closeDependencies` 一個空操作 driver。
 * The kv mode has no pool to close; a no-op driver for `closeDependencies`. */
const NOOP_DRIVER: Driver = {
  query: async () => ({ rows: [], affected: 0 }),
  transaction: async (run) => run(NOOP_DRIVER),
  close: async () => {},
};

export function createKvStore(_config: Config): { store: Store; driver: Driver; dialect: null } {
  return { store: new KvStore(), driver: NOOP_DRIVER, dialect: null };
}
