-- EndchiMerge — 後端資料表。
-- EndchiMerge — backend tables.
--
-- 執行方式（任何 Postgres 皆可：Neon／Supabase／自架的 NAS）：
--   psql "$DATABASE_URL" -f schema.sql
-- Run against any Postgres (Neon, Supabase, a self-hosted NAS):
--   psql "$DATABASE_URL" -f schema.sql
--
-- 設計前提（design.md §6）：
--   1. **伺服器為準**。本機存檔只是快取，榜上的數字一律由這裡算出來。
--   2. **一位玩家一筆**：身份是 `device_id`，改名只改一個欄位，不會多一筆。
--   3. **合成數／分數／連擊各自取歷史最大**，由 `max()` 聚合得出，不靠客戶端宣稱。
--   4. 榜期只有**單一全時段**（使用者定案 2026-10-12），所以不需要 `period` 欄位。
-- Design premises (design.md §6):
--   1. **The server is authoritative.** The local save is a cache; every number on the board is
--      computed here.
--   2. **One row per player**: identity is `device_id`, so renaming edits a field rather than
--      adding a row.
--   3. **Merges / score / combo each take their own historical maximum**, via `max()` — never
--      taken on the client's word.
--   4. The board is **all-time only** (the user's decision, 2026-10-12), so there is no `period`
--      column.

-- ── 玩家 ────────────────────────────────────────────────────────────────────
-- 一位玩家一列。`device_id` 由伺服器在第一次 `/api/run/start` 時頒發（見 handlers.ts），
-- 不由客戶端自產 —— 自產的話「換個 id 重來」就等於換一個 profile。
-- One row per player. `device_id` is issued by the server on the first `/api/run/start` (see
-- handlers.ts) rather than minted by the client: a client-minted id would let "start over with a
-- new id" mean "become a different player".
create table if not exists profiles (
  device_id         text primary key,
  display_name      text        not null default '',
  -- 這三個是**各自**的歷史最大，可能來自不同的局（與客戶端資料層同一個模型）。
  best_score        integer     not null default 0,
  best_max_combo    integer     not null default 0,
  best_merges       integer     not null default 0,
  -- 綁在 `best_score` 上：創下最高分的**那一局**打了多久（使用者定案：時長顯示在分數旁邊）。
  best_duration_ms  integer     not null default 0,
  best_at           timestamptz,
  name_changed_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 榜的排序鍵：分數降冪，同分時早達成的排前面（先到先得，且是穩定的決勝鍵）。
create index if not exists profiles_best_score_idx
  on profiles (best_score desc, best_at asc);

-- ── 每一局 ──────────────────────────────────────────────────────────────────
-- 一次提交一列。`run_id` 唯一 —— 這是**冪等**的來源：網路重試送同一局不會重複計分，
-- 而重放一個舊的 `run_id` 只會拿回同一個裁決。
-- One row per submission. `run_id` is unique, which is what makes the endpoint **idempotent**: a
-- network retry of the same run does not double-count, and replaying an old `run_id` just returns
-- the same verdict.
create table if not exists scores (
  run_id       uuid primary key,
  device_id    text        not null references profiles (device_id) on delete cascade,
  display_name text        not null default '',
  score        integer     not null,
  duration_ms  integer     not null,
  merges       integer     not null,
  drops        integer     not null,
  max_combo    integer     not null,
  -- 平衡版本。調整難度後舊紀錄不該永遠壓在上面（design.md §6.7「分段」）。
  version      text        not null default '',
  -- 未通過合理性檢查者仍然寫入（留審計痕跡），但 `verified = false`，榜單一律排除。
  verified     boolean     not null default true,
  rejected     text,
  client_ip    text,
  created_at   timestamptz not null default now()
);

create index if not exists scores_device_idx on scores (device_id, created_at desc);
create index if not exists scores_verified_score_idx on scores (score desc) where verified;

-- ── 短期憑證（反作弊層次 T2）───────────────────────────────────────────────
-- 伺服器在每一局開始時頒發一張憑證，綁定 (run_id, device_id, 頒發時刻)。
-- 客戶端提交時必須帶回來；伺服器據此知道「這一局是什麼時候開始的」，於是
-- **宣稱的時長不可能超過實際流逝的時間** —— 這是 T1 對稱簽章做不到的事。
-- The server issues a token at the start of each run, bound to (run_id, device_id, issued_at).
-- The client must present it back, which is how the server knows **when the run began** and can
-- require that the claimed duration does not exceed the time that actually elapsed — something an
-- T1 symmetric signature cannot do.
create table if not exists run_tokens (
  run_id      uuid primary key,
  device_id   text        not null,
  -- 只存憑證的**雜湊**：資料庫外洩不等於可以直接拿去提交。
  token_hash  text        not null,
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);

create index if not exists run_tokens_device_idx on run_tokens (device_id, issued_at desc);

-- ── 接收紀錄 ────────────────────────────────────────────────────────────────
-- 使用者定案：接收記錄時的 IP 與 headers 要另外存進一張專門的表。
-- The user's decision: the IP and headers seen when a record is received go into a table of their
-- own.
--
-- **只存白名單標頭。** `cookie` / `authorization` 這類憑證**永不入庫** —— 這張表是為了防濫用
-- 與除錯，不是拿來收集憑證的。IP 的儲存型態由 `IP_STORAGE_MODE` 決定（見 requests.ts）。
-- **Whitelisted headers only.** Credentials such as `cookie` / `authorization` are **never**
-- stored: this table exists for abuse handling and debugging, not for collecting secrets. How the
-- IP is stored is decided by `IP_STORAGE_MODE` (see requests.ts).
create table if not exists requests (
  id              bigserial primary key,
  received_at     timestamptz not null default now(),
  method          text        not null,
  path            text        not null,
  status          integer     not null,
  device_id       text,
  run_id          uuid,
  client_ip       text,
  user_agent      text,
  accept_language text,
  origin          text,
  referer         text,
  -- Vercel 會在標頭裡附上粗略地理位置；有就順手記下來，沒有就留 null。
  country         text,
  region          text,
  city            text,
  -- 其餘白名單標頭（見 requests.ts 的 HEADER_WHITELIST）。
  headers         jsonb       not null default '{}'::jsonb
);

create index if not exists requests_received_idx on requests (received_at desc);
create index if not exists requests_device_idx on requests (device_id, received_at desc);
create index if not exists requests_ip_idx on requests (client_ip, received_at desc);
