-- EndchiMerge — 後端資料表。
-- EndchiMerge — backend tables.
--
-- 執行方式（任何 Postgres 皆可：Neon／Supabase／自架的 NAS）：
--   psql "$DATABASE_URL" -f schema.sql
-- Run against any Postgres (Neon, Supabase, a self-hosted NAS):
--   psql "$DATABASE_URL" -f schema.sql
--
-- 這份檔案必須與 `api/_lib/db/postgres.ts` 的 `schema()` 逐條一致（`tests/dialect.test.ts` 會比對）。
-- This file must match `postgresDialect.schema()` statement for statement (`tests/dialect.test.ts` checks it).
--
-- 設計前提（design.md §6）：
--   1. **伺服器為準**。本機存檔只是快取，榜上的數字一律由這裡算出來。
--   2. **一位玩家一個模式一筆**：身份是 `device_id`，名字與號留在 `profiles`，成績留在 `profile_modes`。
--   3. **合成數／分數／連擊各自取歷史最大**，由 `max()` 聚合得出，不靠客戶端宣稱。
--   4. 榜期只有**單一全時段**（使用者定案 2026-10-12），所以不需要 `period` 欄位。
-- Design premises (design.md §6):
--   1. **The server is authoritative.** The local save is a cache; every number on the board is
--      computed here.
--   2. **One row per player per mode**: identity is `device_id`, the name and tag stay in `profiles`,
--      and the bests live in `profile_modes`.
--   3. **Merges / score / combo each take their own historical maximum**, via `max()` — never
--      taken on the client's word.
--   4. The board is **all-time only** (the user's decision, 2026-10-12), so there is no `period`
--      column.

-- ── 玩家身份 ────────────────────────────────────────────────────────────────
-- 一位玩家一列：名字與號。`device_id` 由伺服器在第一次 `/api/run/start` 時頒發（見 handlers.ts），
-- 不由客戶端自產 —— 自產的話「換個 id 重來」就等於換一個 profile。
-- 下面的 `best_*` 是舊版留下的欄位，成績已搬到 `profile_modes`，程式不再讀寫它們。
-- One row per player: name and tag. `device_id` is issued by the server on the first
-- `/api/run/start` (see handlers.ts) rather than minted by the client: a client-minted id would let
-- "start over with a new id" mean "become a different player". The `best_*` columns below are the
-- previous shape; the bests moved to `profile_modes` and nothing reads or writes them any more.
create table if not exists profiles (
  device_id         text primary key,
  display_name      text        not null default '',
  -- 顯示用的四位數玩家號（`0001`–`9999`）。**不是身分** —— 身分是 `device_id`，所以改名不動號、
  -- 也永遠不會因為撞名而換人；同名的人靠這個號分開。
  user_tag          varchar(4)  not null default '',
  best_score        integer     not null default 0,
  best_max_combo    integer     not null default 0,
  best_merges       integer     not null default 0,
  best_duration_ms  integer     not null default 0,
  best_at           timestamptz,
  name_changed_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists profiles_best_score_idx
  on profiles (best_score desc, best_at asc);

-- ── 每個模式的歷史最大值 ────────────────────────────────────────────────────
-- 一位玩家在每個模式各一列（`primary key (device_id, mode)`）：兩個模式的分數尺度不同，合成一列
-- 會讓傳統模式的成績永遠被新玩法蓋住。`mode` 目前是 `new` 或 `traditional`。
-- One row per player per mode (`primary key (device_id, mode)`): the two modes score on different
-- scales, and folding them into one row would bury the traditional numbers forever. `mode` is
-- currently `new` or `traditional`.
create table if not exists profile_modes (
  device_id        text        not null,
  mode             text        not null default 'new',
  display_name     text        not null default '',
  user_tag         varchar(4)  not null default '',
  -- 這三個是**各自**的歷史最大，可能來自不同的局（與客戶端資料層同一個模型）。
  best_score       integer     not null default 0,
  best_max_combo   integer     not null default 0,
  best_merges      integer     not null default 0,
  -- 綁在 `best_score` 上：創下最高分的**那一局**打了多久（使用者定案：時長顯示在分數旁邊）。
  best_duration_ms integer     not null default 0,
  best_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (device_id, mode)
);

create index if not exists profile_modes_board_idx
  on profile_modes (mode, best_score desc, best_at asc);

-- ── 每一局 ──────────────────────────────────────────────────────────────────
-- 一次提交一列。`run_id` 唯一 —— 這是**冪等**的來源：網路重試送同一局不會重複計分，
-- 而重放一個舊的 `run_id` 只會拿回同一個裁決。
-- One row per submission. `run_id` is unique, which is what makes the endpoint **idempotent**: a
-- network retry of the same run does not double-count, and replaying an old `run_id` just returns
-- the same verdict.
--
-- ⚠️ `device_id` **刻意不是**外鍵（它原本是 `references profiles … on delete cascade`，那是錯的）。
-- 那條外鍵會擋掉兩個完全正常的寫入：
--   1. **新裝置的第一次提交**。`saveScore` 先寫 `scores` 再寫 `profiles`，順序不能反 ——
--      「這一局是不是新的」是由 `scores` 那一句的結果決定的。所以寫入的那一刻還沒有父列。
--   2. **被退回的提交**。`verified = false` 的局故意不建 profile（見 design.md §6.7），
--      於是它永遠沒有父列；有外鍵就等於「拒絕留審計痕跡」，而那正是要留的東西。
-- 反過來說那條外鍵買不到任何東西：沒有任何地方刪除 profile，`on delete cascade` 是裝飾品。所以這裡
-- 不再宣告它，三個方言（Postgres／MySQL／SQLite）也就此一致。
-- ⚠️ `device_id` is **deliberately not** a foreign key (it used to be
-- `references profiles … on delete cascade`, and that was wrong). The key would block two entirely
-- normal writes: a new device's first submission (`saveScore` writes `scores` before `profiles`, and
-- the order cannot be swapped because whether the run is new is decided by that statement's result),
-- and a rejected submission (a `verified = false` run purposely creates no profile, per design.md
-- §6.7, so it can never have a parent — with the key, recording the audit trail becomes impossible).
-- And the key buys nothing in return: nothing deletes a profile, so `on delete cascade` is
-- decoration. It is therefore not declared here, which also makes Postgres, MySQL and SQLite agree.
create table if not exists scores (
  run_id       uuid primary key,
  device_id    text        not null,
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
  -- 這一局是哪個模式；榜與 profile 都按它分開。
  mode         text        not null default 'new',
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
-- 每個請求一列，只記端點維運需要的五個欄位（方法、路徑、狀態、裝置、局號）。
-- One row per request, with only the five fields operations needs (method, path, status, device, run).
--
-- ⚠️ 私隱：IP 與標頭屬個人資料，**一律不落庫**。下面的 drop 語句把舊版資料庫的舊欄位（連同舊資料）
-- 清掉；全新資料庫沒有這些欄位，`if exists` 讓它們原樣通過。
-- ⚠️ Privacy: IPs and headers are personal data and are **never** persisted. The drop statements below
-- remove the legacy columns (and the data in them) from old databases; a fresh database has no such
-- columns and `if exists` lets them pass.
create table if not exists requests (
  id              bigserial primary key,
  received_at     timestamptz not null default now(),
  method          text        not null,
  path            text        not null,
  status          integer     not null,
  device_id       text,
  run_id          uuid
);

create index if not exists requests_received_idx on requests (received_at desc);
create index if not exists requests_device_idx on requests (device_id, received_at desc);

alter table requests drop column if exists user_agent,
  drop column if exists accept_language, drop column if exists origin, drop column if exists referer,
  drop column if exists country, drop column if exists region, drop column if exists city,
  drop column if exists headers;

-- ⚠️ 玩家號：顯示用的四位數，**永不當身分**。新庫由上面的建表帶上；舊庫在這裡補欄位與回填 ——
-- 回填靠自己的 `where` 冪等，所以每次部署重跑都不會動到已經有號的列。
-- ⚠️ The player tag: four display digits, **never identity**. A new database gets it from the create
-- above; an old one is given the column and the backfill here, and the backfill is idempotent through
-- its own `where`, so re-running it on every deploy touches no row that already has a tag.
alter table profiles add column if not exists user_tag varchar(4) not null default '';
update profiles set user_tag = lpad((floor(random() * 9999) + 1)::int::text, 4, '0') where user_tag = '';

-- 模式：`scores` 補欄位；舊庫的成績回填成「新玩法」一列。`on conflict do nothing` 讓重跑無害。
-- Mode: `scores` gains the column, and an old database's scores are backfilled as the new mode.
-- `on conflict do nothing` makes a re-run harmless.
alter table scores add column if not exists mode text not null default 'new';

insert into profile_modes (
  device_id, mode, display_name, user_tag, best_score, best_duration_ms, best_max_combo,
  best_merges, best_at
)
select p.device_id, 'new', p.display_name, p.user_tag, p.best_score, p.best_duration_ms,
       p.best_max_combo, p.best_merges, p.best_at
from profiles p
where p.best_score > 0
on conflict (device_id, mode) do nothing;
