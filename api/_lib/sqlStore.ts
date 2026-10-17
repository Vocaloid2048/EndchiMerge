/**
 * 方言驅動的儲存層：**邏輯只寫一次，語法交給 `Dialect`**（Postgres 與 MySQL 行為必須一致）。
 * The dialect-driven store: the **logic is written once, the syntax is delegated to `Dialect`**.
 */

import type { ProfileRow, RankProbe, RequestRow, RunTokenRow, ScoreRow, Store } from './store.js';
import { Binder, BOARD_PRIMARY_COLUMN, type BoardCategory, type Dialect } from './db/dialect.js';
import type { Driver, Row } from './db/types.js';
import { newUserTag } from './tokens.js';

/** 重抽玩家號的次數上限：撞號本身罕見（四位數），上限只是不讓極端情況變成無窮迴圈。
 * How many times a colliding tag is re-rolled: collisions are rare (four digits), and the cap only keeps an extreme case from looping forever. */
const TAG_ATTEMPTS = 10;

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');
const asNullableText = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

function probeValue(category: BoardCategory, probe: RankProbe): number {
  switch (category) {
    case 'score':
      return probe.score;
    case 'combo':
      return probe.maxCombo;
    case 'merges':
      return probe.merges;
  }
}

export class SqlStore implements Store {
  constructor(
    /** 公開是為了讓呼叫端能 `close()`（測試與本機工具要關池子）。
     * Public so callers can `close()` the pool (tests and local tooling).
     */
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
              version, verified, rejected,
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
      /* `scores` 沒有號這一欄（只有 `profiles` 有），所以讀回來的就是空的 —— 呼叫端要寫 profile 時才提議一個。
       * `scores` has no tag column (only `profiles` does), so a row read back carries none; a tag is offered only when a profile is written. */
      userTag: '',
      score: this.dialect.readNumber(row['score']),
      durationMs: this.dialect.readNumber(row['duration_ms']),
      merges: this.dialect.readNumber(row['merges']),
      drops: this.dialect.readNumber(row['drops']),
      maxCombo: this.dialect.readNumber(row['max_combo']),
      version: asText(row['version']),
      verified: this.dialect.readBool(row['verified']),
      rejected: asNullableText(row['rejected']),
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

  /** 寫入一局，並在通過檢查時更新該玩家的歷史最大值；同一 `run_id` 再送一次回 `false`（冪等）。
   * Persist a run, updating the player's historical maxima when it passed. Re-submitting returns `false`. */
  async saveScore(row: ScoreRow): Promise<boolean> {
    return this.driver.transaction(async (tx) => {
      const inserted = await this.insertScore(tx, row);

      /* 重複提交（網路重試）**不能**再動 profile，否則 `updated_at` 一直往前跑，看起來像剛刷新。
       * A duplicate submission must **not** touch the profile, or `updated_at` keeps looking fresh. */
      if (!inserted) return false;

      /* 未通過檢查的提交留檔但不進榜。
       * A submission that failed the checks is recorded but kept off the board. */
      if (row.verified) await this.upsertProfile(tx, row);

      return true;
    });
  }

  /**
   * 同一局的即時更新：覆蓋數字、不新增一列；`created_at` 不動（它是速率限制視窗與審計的起點）。
   * 被退回的更新整條跳過 —— 不合理的提交不該抹掉之前那筆已驗證的成績。
   * A live update to the same run: overwrites the figures without adding a row; `created_at` stays
   * put (it anchors the rate-limit window and the audit trail). A rejected update is skipped
   * entirely — an implausible submission must not erase an earlier verified result.
   */
  async updateScore(row: ScoreRow): Promise<void> {
    if (!row.verified) return;

    await this.driver.transaction(async (tx) => {
      const b = new Binder(this.dialect);

      await tx.query(
        `update scores set
           display_name = ${b.bind(row.displayName)},
           score = ${b.bind(row.score)},
           duration_ms = ${b.bind(row.durationMs)},
           merges = ${b.bind(row.merges)},
           drops = ${b.bind(row.drops)},
           max_combo = ${b.bind(row.maxCombo)},
           version = ${b.bind(row.version)},
           verified = ${b.bind(row.verified)},
           rejected = ${b.bind(row.rejected)}
         where run_id = ${b.bind(row.runId)} and device_id = ${b.bind(row.deviceId)}`,
        b.params,
      );

      await this.upsertProfile(tx, row);
    });
  }

  private async insertScore(tx: Driver, row: ScoreRow): Promise<boolean> {    const result = await tx.query(this.dialect.insertScore(), [
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
      /*
       * `atMs` 一定要綁進去：`scores.created_at` 同時是審計時間、速率限制視窗與 `getScore` 讀回的
       * `atMs`；漏掉不會報錯，只會讓兩個 store 實作靜靜地不一致（單元測試走的是 `MemoryStore`）。
       * `atMs` must be bound: `created_at` is the audit time, the rate-limit window and `getScore`'s
       * `atMs`; dropping it raises nothing and silently drifts the two stores apart.
       */
      this.dialect.ts(row.atMs),
    ]);

    /* Postgres 用 `returning` 的行數判斷、MySQL 用 `affectedRows`（見 `Dialect.insertScoreSignal`），兩者都必須原子。
     * Postgres counts `returning` rows, MySQL uses `affectedRows` (see `Dialect.insertScoreSignal`); both atomic. */
    return this.dialect.insertScoreSignal === 'rows' ? result.rows.length > 0 : result.affected > 0;
  }

  private async upsertProfile(tx: Driver, row: ScoreRow): Promise<void> {
    const current = await this.loadProfile(tx, row.deviceId);
    const displayName = row.displayName === '' ? (current?.displayName ?? '') : row.displayName;
    const userTag = await this.resolveUserTag(tx, displayName, current?.userTag ?? '', row.userTag, row.deviceId);

    await tx.query(this.dialect.upsertProfile(), [
      row.deviceId,
      row.displayName,
      userTag,
      row.score,
      row.durationMs,
      row.maxCombo,
      row.merges,
      this.dialect.ts(row.atMs),
    ]);
  }

  /**
   * 這個裝置在**這個名字**下該用哪個號：沿用既有的（所以改名不動號），否則用送進來的那個；只有與**別的裝置**
   * 撞到「同名字＋同號」才重抽 —— 這一條就是「榜上不會有兩列一模一樣」的保證。
   * Which tag this device carries under **this name**: keep the existing one (so a rename does not change
   * it), else take the offered one; a re-roll happens only when **another device** already holds the same
   * name-and-tag pair — that is what keeps two board rows from ever reading alike.
   */
  private async resolveUserTag(
    tx: Driver,
    displayName: string,
    current: string,
    offered: string,
    deviceId: string,
  ): Promise<string> {
    /* 沿用既有的 → 用送來的 → 連送來的都是空的就當場鑄一個（例如從 `scores` 讀回來的一列）。
     * Keep the existing one → take the offered one → mint one when even that is empty (a row read back from `scores`, say). */
    let tag = current !== '' ? current : offered !== '' ? offered : newUserTag();
    if (displayName === '') return tag;

    for (let attempt = 0; attempt < TAG_ATTEMPTS && (await this.isUserTagTaken(tx, displayName, tag, deviceId)); attempt += 1) {
      tag = newUserTag();
    }

    return tag;
  }

  /** 這個「名字＋號」是不是已經被**別的**裝置佔用。 */
  private async isUserTagTaken(
    tx: Driver,
    displayName: string,
    tag: string,
    deviceId: string,
  ): Promise<boolean> {
    const b = new Binder(this.dialect);

    const { rows } = await tx.query(
      `select 1 as taken from profiles
       where display_name = ${b.bind(displayName)} and user_tag = ${b.bind(tag)}
         and device_id <> ${b.bind(deviceId)}
       limit 1`,
      b.params,
    );

    return rows.length > 0;
  }

  /* ── 玩家與榜 ──────────────────────────────────────────────────────────── */

  private profileColumns(): string {
    return `device_id, display_name, user_tag, best_score, best_duration_ms, best_max_combo, best_merges,
            case when best_at is null then null else ${this.dialect.epochMs('best_at')} end as best_at_ms`;
  }

  private toProfileRow(row: Row): ProfileRow {
    return {
      deviceId: asText(row['device_id']),
      displayName: asText(row['display_name']),
      userTag: asText(row['user_tag']),
      bestScore: this.dialect.readNumber(row['best_score']),
      bestDurationMs: this.dialect.readNumber(row['best_duration_ms']),
      bestMaxCombo: this.dialect.readNumber(row['best_max_combo']),
      bestMerges: this.dialect.readNumber(row['best_merges']),
      bestAtMs: this.dialect.readTime(row['best_at_ms']),
    };
  }

  /** 讀一列 profile；`upsertProfile` 要在**同一個交易**裡先看現況（號要沿用、名字要不動），所以驅動是參數。 */
  private async loadProfile(driver: Driver, deviceId: string): Promise<ProfileRow | null> {
    const b = new Binder(this.dialect);

    const { rows } = await driver.query(
      `select ${this.profileColumns()} from profiles where device_id = ${b.bind(deviceId)}`,
      b.params,
    );

    const row = (rows as Row[])[0];

    return row === undefined ? null : this.toProfileRow(row);
  }

  async getProfile(deviceId: string): Promise<ProfileRow | null> {
    return this.loadProfile(this.driver, deviceId);
  }

  async topProfiles(category: BoardCategory, limit: number): Promise<ProfileRow[]> {
    const b = new Binder(this.dialect);

    const { rows } = await this.driver.query(
      `select ${this.profileColumns()} from profiles
       where best_score > 0
       order by ${this.dialect.boardOrder(category)}
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

  /** 「排在這一筆之前」的條件 —— `boardOrder(category)` 的**鏡像**；兩份一旦分歧，名次就與列序矛盾。
   * The "comes before this one" condition, the **mirror** of `boardOrder(category)`; divergence breaks ranks. */
  private aheadOf(category: BoardCategory, b: Binder, probe: RankProbe): string {
    const keys: readonly {
      readonly column: string;
      readonly value: unknown;
      readonly desc: boolean;
      /** 時間鍵要走 `bindTime()`，Postgres 才不會拿字串去比 `timestamptz`。
       * Time keys go through `bindTime()` so Postgres does not compare a string to `timestamptz`. */
      readonly time?: boolean;
    }[] = [
      { column: BOARD_PRIMARY_COLUMN[category], value: probeValue(category, probe), desc: true },
      ...(category === 'score'
        ? []
        : [{ column: 'best_score', value: probe.score, desc: true }]),
      { column: 'best_at', value: probe.atMs, desc: false, time: true },
      { column: 'device_id', value: probe.deviceId, desc: false },
    ];

    const bind = (key: (typeof keys)[number]): string =>
      key.time === true ? b.bindTime(key.value as number) : b.bind(key.value);

    const terms: string[] = [];

    for (let at = 0; at < keys.length; at += 1) {
      const conditions = keys
        .slice(0, at)
        .map((key) => `${key.column} = ${bind(key)}`);

      const key = keys[at]!;

      /*
       * `best_at` 可能是 null，而 null 排在最後 —— 條件寫成 `best_at < t` 時 null 比較的結果是
       * NULL（不是真），所以空的列本來就不會算在前面；顯式寫出 `is not null` 只是把這件事講明白。
       * `best_at` may be null and nulls sort last: `best_at < t` already yields NULL (not true) for
       * an empty row, so it never counts as ahead — the explicit `is not null` just says so out loud.
       */
      if (key.time === true) conditions.push(`${key.column} is not null`);

      conditions.push(`${key.column} ${key.desc ? '>' : '<'} ${bind(key)}`);
      terms.push(`(${conditions.join(' and ')})`);
    }

    return terms.join(' or ');
  }

  async rankOf(probe: RankProbe, category: BoardCategory): Promise<number> {
    const b = new Binder(this.dialect);

    const { rows } = await this.driver.query(
      `select ${this.dialect.countInt('count(*)')} as n from profiles
       where best_score > 0 and (${this.aheadOf(category, b, probe)})`,
      b.params,
    );

    return this.dialect.readNumber((rows as Row[])[0]?.['n']) + 1;
  }

  /* ── 接收紀錄 ──────────────────────────────────────────────────────────── */

  async insertRequest(row: RequestRow): Promise<void> {
    const b = new Binder(this.dialect);

    await this.driver.query(
      `insert into requests (method, path, status, device_id, run_id)
       values (${b.bind(row.method)}, ${b.bind(row.path)}, ${b.bind(row.status)}, ${b.bind(row.deviceId)}, ${b.bind(row.runId)})`,
      b.params,
    );
  }
}
