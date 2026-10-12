/**
 * 方言驅動的儲存層：**邏輯只寫一次，語法交給 `Dialect`**。
 * The dialect-driven store: the **logic is written once, the syntax is delegated to `Dialect`**.
 *
 * 這支檔案取代了原本只服務 Postgres 的 `pgStore.ts`。改成這樣都是為了**共用程式碼**：Vercel 用
 * Neon（Postgres）、騰訊的免費關聯式選項用 MySQL，而資料層的行為必須在兩邊一模一樣。
 * This replaces `pgStore.ts`, which only served Postgres. The change is entirely about **code
 * sharing**: Vercel uses Neon (Postgres) and Tencent's free relational options use MySQL, and the data
 * layer has to behave identically on both.
 *
 * ## 什麼住在這裡、什麼住在 `Dialect` / What lives here vs in `Dialect`
 *
 * 住在這裡的是**行為**，也就是那些「搞錯了不會報錯、只會靜靜算錯」的東西：
 *   - 時長**跟著分數走**（只在分數真的刷新時才換），
 *   - 交易裡的順序：先寫 `scores`（靠它判冪等），**才**動 `profiles`；
 *   - 「已存在就不要再更新 profile」—— 否則 `updated_at` 會一直往前跑，看起來像剛刷新。
 * What lives here is **behaviour** — the parts that fail silently rather than loudly: the duration
 * **following the score** (replaced only when the score truly improves), the order inside the
 * transaction (write `scores` first, since it decides idempotency, and only then touch `profiles`),
 * and "an existing row is not updated again" (otherwise `updated_at` keeps moving forward and looks
 * freshly beaten).
 *
 * 住在 `Dialect` 的是**語法**：佔位符、時間型別、upsert、`RETURNING`、`NULLS LAST`。
 * What lives in `Dialect` is **syntax**: placeholders, time types, upserts, `RETURNING`, `NULLS LAST`.
 */

import type { RequestRow } from './requests';
import type { ProfileRow, RunTokenRow, ScoreRow, Store } from './store';
import { Binder, type Dialect } from './db/dialect';
import type { Driver, Row } from './db/types';

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');
const asNullableText = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

export class SqlStore implements Store {
  constructor(
    /** 公開是為了讓呼叫端能 `close()`（測試與本機工具要關池子）。 */
    readonly driver: Driver,
    private readonly dialect: Dialect,
  ) {}

  /* ── 憑證 ──────────────────────────────────────────────────────────────── */

  async putRunToken(row: RunTokenRow): Promise<void> {
    await this.driver.query(this.dialect.insertRunToken(), [
      row.runId,
      row.deviceId,
      row.tokenHash,
      this.dialect.ts(row.issuedAtMs),
      this.dialect.ts(row.expiresAtMs),
    ]);
  }

  async getRunToken(runId: string): Promise<RunTokenRow | null> {
    const b = new Binder(this.dialect);
    const time = (column: string): string => this.dialect.epochMs(column);

    const { rows } = await this.driver.query(
      `select run_id, device_id, token_hash,
              ${time('issued_at')} as issued_at_ms,
              ${time('expires_at')} as expires_at_ms,
              case when used_at is null then null else ${time('used_at')} end as used_at_ms
       from run_tokens where run_id = ${b.bind(runId)}`,
      b.params,
    );

    const row = (rows as Row[])[0];
    if (row === undefined) return null;

    return {
      runId: asText(row['run_id']),
      deviceId: asText(row['device_id']),
      tokenHash: asText(row['token_hash']),
      issuedAtMs: this.dialect.readTime(row['issued_at_ms']) ?? 0,
      expiresAtMs: this.dialect.readTime(row['expires_at_ms']) ?? 0,
      usedAtMs: this.dialect.readTime(row['used_at_ms']),
    };
  }

  async markRunTokenUsed(runId: string, atMs: number): Promise<void> {
    const b = new Binder(this.dialect);

    await this.driver.query(
      `update run_tokens set used_at = ${b.bindTime(atMs)}
       where run_id = ${b.bind(runId)} and used_at is null`,
      b.params,
    );
  }

  async countRunTokensSince(deviceId: string, sinceMs: number): Promise<number> {
    const b = new Binder(this.dialect);

    const { rows } = await this.driver.query(
      `select ${this.dialect.countInt('count(*)')} as n from run_tokens
       where device_id = ${b.bind(deviceId)} and issued_at >= ${b.bindTime(sinceMs)}`,
      b.params,
    );

    return this.dialect.readNumber((rows as Row[])[0]?.['n']);
  }

  /* ── 成績 ──────────────────────────────────────────────────────────────── */

  async getScore(runId: string): Promise<ScoreRow | null> {
    const b = new Binder(this.dialect);

    const { rows } = await this.driver.query(
      `select run_id, device_id, display_name, score, duration_ms, merges, drops, max_combo,
              version, verified, rejected, client_ip,
              ${this.dialect.epochMs('created_at')} as at_ms
       from scores where run_id = ${b.bind(runId)}`,
      b.params,
    );

    const row = (rows as Row[])[0];
    if (row === undefined) return null;

    return {
      runId: asText(row['run_id']),
      deviceId: asText(row['device_id']),
      displayName: asText(row['display_name']),
      score: this.dialect.readNumber(row['score']),
      durationMs: this.dialect.readNumber(row['duration_ms']),
      merges: this.dialect.readNumber(row['merges']),
      drops: this.dialect.readNumber(row['drops']),
      maxCombo: this.dialect.readNumber(row['max_combo']),
      version: asText(row['version']),
      verified: this.dialect.readBool(row['verified']),
      rejected: asNullableText(row['rejected']),
      clientIp: asNullableText(row['client_ip']),
      atMs: this.dialect.readTime(row['at_ms']) ?? 0,
    };
  }

  async countSubmissionsSince(deviceId: string, sinceMs: number): Promise<number> {
    const b = new Binder(this.dialect);

    const { rows } = await this.driver.query(
      `select ${this.dialect.countInt('count(*)')} as n from scores
       where device_id = ${b.bind(deviceId)} and created_at >= ${b.bindTime(sinceMs)}`,
      b.params,
    );

    return this.dialect.readNumber((rows as Row[])[0]?.['n']);
  }

  /**
   * 寫入一局，並在通過檢查時更新該玩家的歷史最大值。
   * Persist a run, updating the player's historical maxima when it passed the checks.
   *
   * @returns 是否**真的寫進去了**；同一 `run_id` 再送一次回 `false`（冪等）。
   *   Whether it was actually written; the same `run_id` again returns `false` (idempotent).
   */
  async saveScore(row: ScoreRow): Promise<boolean> {
    return this.driver.transaction(async (tx) => {
      const inserted = await this.insertScore(tx, row);

      /*
       * 同一局重複提交（網路重試）時**不能**再動 profile：分數早就算進去了，再算一次會讓
       * `updated_at` 一直往前跑，看起來像剛刷新。
       * A duplicate submission (a network retry) must **not** touch the profile again: the score is
       * already counted, and doing it twice would keep pushing `updated_at` forward so it looks freshly
       * beaten.
       */
      if (!inserted) return false;

      /* 未通過檢查的提交留檔但不進榜（design.md §6.7）。 */
      if (row.verified) await this.upsertProfile(tx, row);

      return true;
    });
  }

  private async insertScore(tx: Driver, row: ScoreRow): Promise<boolean> {
    const result = await tx.query(this.dialect.insertScore(), [
      row.runId,
      row.deviceId,
      row.displayName,
      row.score,
      row.durationMs,
      row.merges,
      row.drops,
      row.maxCombo,
      row.version,
      row.verified,
      row.rejected,
      row.clientIp,
    ]);

    /*
     * Postgres 用 `returning` 的行數判斷，MySQL 沒有 `returning` 只能看 `affectedRows`（見
     * `Dialect.insertScoreSignal`）。兩種都必須是**原子**的 —— 這是重試不會重複計分的唯一依據。
     * Postgres decides from the `returning` row count; MySQL has no `returning` and must use
     * `affectedRows` (see `Dialect.insertScoreSignal`). Both must be **atomic** — it is the only basis
     * for a retry not double-counting.
     */
    return this.dialect.insertScoreSignal === 'rows' ? result.rows.length > 0 : result.affected > 0;
  }

  private async upsertProfile(tx: Driver, row: ScoreRow): Promise<void> {
    await tx.query(this.dialect.upsertProfile(), [
      row.deviceId,
      row.displayName,
      row.score,
      row.durationMs,
      row.maxCombo,
      row.merges,
      this.dialect.ts(row.atMs),
    ]);
  }

  /* ── 玩家與榜 ──────────────────────────────────────────────────────────── */

  /** `profiles` 的固定欄位清單（含把時間讀成毫秒的那一段）。 */
  private profileColumns(): string {
    return `device_id, display_name, best_score, best_duration_ms, best_max_combo, best_merges,
            case when best_at is null then null else ${this.dialect.epochMs('best_at')} end as best_at_ms`;
  }

  private toProfileRow(row: Row): ProfileRow {
    return {
      deviceId: asText(row['device_id']),
      displayName: asText(row['display_name']),
      bestScore: this.dialect.readNumber(row['best_score']),
      bestDurationMs: this.dialect.readNumber(row['best_duration_ms']),
      bestMaxCombo: this.dialect.readNumber(row['best_max_combo']),
      bestMerges: this.dialect.readNumber(row['best_merges']),
      bestAtMs: this.dialect.readTime(row['best_at_ms']),
    };
  }

  async getProfile(deviceId: string): Promise<ProfileRow | null> {
    const b = new Binder(this.dialect);

    const { rows } = await this.driver.query(
      `select ${this.profileColumns()} from profiles where device_id = ${b.bind(deviceId)}`,
      b.params,
    );

    const row = (rows as Row[])[0];

    return row === undefined ? null : this.toProfileRow(row);
  }

  async topProfiles(limit: number): Promise<ProfileRow[]> {
    const b = new Binder(this.dialect);

    const { rows } = await this.driver.query(
      `select ${this.profileColumns()} from profiles
       where best_score > 0
       order by ${this.dialect.boardOrder()}
       limit ${b.bind(Math.max(0, limit))}`,
      b.params,
    );

    return (rows as Row[]).map((row) => this.toProfileRow(row));
  }

  async countProfiles(): Promise<number> {
    const { rows } = await this.driver.query(
      `select ${this.dialect.countInt('count(*)')} as n from profiles where best_score > 0`,
    );

    return this.dialect.readNumber((rows as Row[])[0]?.['n']);
  }

  async rankOf(key: { score: number; atMs: number; deviceId: string }): Promise<number> {
    /*
     * 名次 ＝ 排在自己前面的有幾個 ＋ 1，而「排在前面」寫成**與 `topProfiles` 同一條排序**的三段
     * 條件：分數更高，或同分但更早達成，或三者完全相同時 id 較小。寫成 `order by` 的鏡像是刻意的
     * —— 兩邊任何一邊改了，這裡就必須跟著改，而 `tests/api.test.ts` 會用同分的案例把兩邊釘在一起。
     * The rank is "how many come before me, plus one", and "before me" is spelled out as the **same
     * three-part ordering as `topProfiles`**: a higher score, or an equal score reached earlier, or —
     * with all three equal — a smaller id. Mirroring the `order by` is deliberate: changing either side
     * requires changing this one, and `tests/api.test.ts` pins the two together with a tied case.
     *
     * 注意這裡**把同一個值綁了三次**（分數兩次、時間兩次）。Postgres 用 `$n` 本來可以重用，但 MySQL
     * 的 `?` 是位置性的，每次出現都要一個參數 —— 兩邊都綁三次就得到同一份 SQL 文字，見 `Binder`。
     * Note that the same values are **bound three times** (the score twice, the time twice). Postgres's
     * `$n` could be reused, but MySQL's `?` is positional and needs one parameter per occurrence —
     * binding three times on both sides yields a single SQL string, see `Binder`.
     */
    const b = new Binder(this.dialect);

    const { rows } = await this.driver.query(
      `select ${this.dialect.countInt('count(*)')} as n from profiles
       where best_score > ${b.bind(key.score)}
          or (best_score = ${b.bind(key.score)} and best_at is not null
              and best_at < ${b.bindTime(key.atMs)})
          or (best_score = ${b.bind(key.score)} and best_at = ${b.bindTime(key.atMs)}
              and device_id < ${b.bind(key.deviceId)})`,
      b.params,
    );

    return this.dialect.readNumber((rows as Row[])[0]?.['n']) + 1;
  }

  /* ── 接收紀錄 ──────────────────────────────────────────────────────────── */

  async insertRequest(row: RequestRow): Promise<void> {
    const b = new Binder(this.dialect);

    await this.driver.query(
      `insert into requests (
         method, path, status, device_id, run_id, client_ip, user_agent, accept_language,
         origin, referer, country, region, city, headers
       ) values (
         ${b.bind(row.method)}, ${b.bind(row.path)}, ${b.bind(row.status)}, ${b.bind(row.deviceId)},
         ${b.bind(row.runId)}, ${b.bind(row.clientIp)}, ${b.bind(row.userAgent)},
         ${b.bind(row.acceptLanguage)}, ${b.bind(row.origin)}, ${b.bind(row.referer)},
         ${b.bind(row.country)}, ${b.bind(row.region)}, ${b.bind(row.city)},
         ${b.bindJson(JSON.stringify(row.headers))}
       )`,
      b.params,
    );
  }
}
