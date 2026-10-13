/**
 * 接收紀錄：客戶端位址、標頭白名單，以及落庫的形狀。
 * The receive log: client address, the header whitelist, and the shape that goes into the database.
 *
 * 使用者定案：接收一筆記錄時看到的 IP 與 headers 要另外存進一張專門的表（`requests`）。
 * The user's decision: the IP and headers seen when a record arrives go into a table of their own
 * (`requests`).
 */

import type { IpStorageMode } from './env.js';
import { keyedFingerprint } from './tokens.js';

/**
 * 會落庫的標頭。**白名單，不是黑名單。**
 * The headers that are stored. **A whitelist, not a blacklist.**
 *
 * 黑名單在這裡是錯的工具：標頭的名稱是可以被發明出來的（`x-my-token`、各種自訂 auth 標頭），
 * 所以「除了 cookie 和 authorization 以外都存」遲早會存到一份憑證。白名單的失效方向剛好相反 ——
 * 有新東西要記就少記一筆，而不是多漏一份。
 * A blacklist is the wrong tool here: header names can be invented (`x-my-token`, assorted custom
 * auth headers), so "store everything except cookie and authorization" will eventually store a
 * credential. A whitelist fails in the opposite direction — a new thing to log gets missed, rather
 * than a secret getting leaked.
 *
 * `cookie` 與 `authorization` **明確不在名單上**，而且永遠不會被加進去：這個服務沒有登入，任何
 * 憑證都是別的東西洩漏過來的，沒有理由留一份副本。
 * `cookie` and `authorization` are **explicitly absent** and will never be added: this service has no
 * login, so any credential here leaked from somewhere else and there is no reason to keep a copy.
 */
export const HEADER_WHITELIST = [
  'user-agent',
  'accept-language',
  'accept',
  'content-type',
  'origin',
  'referer',
  'x-forwarded-for',
  'x-real-ip',
  'x-vercel-id',
  'x-vercel-ip-country',
  'x-vercel-ip-country-region',
  'x-vercel-ip-city',
] as const;

/** 白名單標頭裡、另外拉出來當獨立欄位的三個（會寫進專屬欄位而不是 jsonb）。 */
const LOCATION_HEADERS = {
  country: 'x-vercel-ip-country',
  region: 'x-vercel-ip-country-region',
  city: 'x-vercel-ip-city',
} as const;

/** 落庫的一列；欄位名稱與 `schema.sql` 的 `requests` 表一一對應。 */
export interface RequestRow {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly deviceId: string | null;
  readonly runId: string | null;
  readonly clientIp: string | null;
  readonly userAgent: string | null;
  readonly acceptLanguage: string | null;
  readonly origin: string | null;
  readonly referer: string | null;
  readonly country: string | null;
  readonly region: string | null;
  readonly city: string | null;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * 去掉位址上的埠，並把 IPv4-mapped IPv6 收斂成 IPv4。
 * Strip the port and fold IPv4-mapped IPv6 back to IPv4.
 *
 * 不做這兩件事的話，同一個來源會因為 `::ffff:1.2.3.4` 與 `1.2.3.4`、或埠號不同而被算成不同
 * 的位址 —— 速率限制與「同一個來源重複出現」的判讀就一起失效。
 * Without both, one source becomes several addresses (`::ffff:1.2.3.4` vs `1.2.3.4`, or differing
 * ports), which breaks rate limiting and any reading of "the same source showed up again".
 */
function normaliseAddress(raw: string): string {
  let value = raw.trim();
  if (value === '') return '';

  /* `[::1]:1234` → `::1`；`1.2.3.4:5678` → `1.2.3.4`。 */
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(value);
  if (bracketed?.[1] !== undefined) value = bracketed[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) value = value.slice(0, value.indexOf(':'));

  /* `::ffff:1.2.3.4` 是同一個 IPv4 位址的另一種寫法。 */
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  if (mapped?.[1] !== undefined) value = mapped[1];

  return value.toLowerCase();
}

/**
 * 真正的客戶端位址。
 * The actual client address.
 *
 * `x-forwarded-for` 是逗號分隔的清單，**第一個**才是原始客戶端，後面是經過的代理；取錯邊會讓所有
 * 人看起來都來自同一個 CDN 節點。
 * `x-forwarded-for` is a comma-separated list where the **first** entry is the original client and
 * the rest are proxies; reading the wrong end makes everyone appear to come from one CDN node.
 */
export function clientIp(
  headers: Readonly<Record<string, string>>,
  remoteAddress: string,
): string {
  const forwarded = headers['x-forwarded-for'];
  if (forwarded !== undefined) {
    const first = forwarded.split(',')[0];
    if (first !== undefined) {
      const address = normaliseAddress(first);
      if (address !== '') return address;
    }
  }

  const real = headers['x-real-ip'];
  if (real !== undefined) {
    const address = normaliseAddress(real);
    if (address !== '') return address;
  }

  return normaliseAddress(remoteAddress);
}

/**
 * 依 `IP_STORAGE_MODE` 決定 IP 要怎麼存。
 * How the IP is stored, per `IP_STORAGE_MODE`.
 *
 * 預設是 `truncated`（丟掉最後一段）。理由不是「不想存」，而是存全址對這個服務沒有額外好處卻有
 * 實際風險：這是個公開的粉絲遊戲，`requests` 表是為了追濫用與除錯，而**同一網段的來源**已經足夠
 * 回答那兩個問題。IP 在香港（PDPO）與歐盟（GDPR）都算個人資料，能少存一點就少存一點。
 * The default is `truncated` (drop the last octet). Not because storing the full address is
 * inconvenient, but because it buys this service nothing and costs something: this is a public fan
 * game, the `requests` table exists for abuse handling and debugging, and **the network the source
 * came from** already answers both. IP addresses are personal data under Hong Kong's PDPO and the
 * EU's GDPR alike, so the less of one that is kept, the better.
 *
 * 要改回全址就把 `IP_STORAGE_MODE=raw` 設起來 —— 那是一個環境變數，不是一次程式改動。
 * Switching to full addresses is `IP_STORAGE_MODE=raw` — an environment variable, not a code change.
 */
export function storeIp(
  ip: string,
  mode: IpStorageMode,
  hashSecret: string,
): string | null {
  if (ip === '') return null;
  if (mode === 'raw') return ip;

  if (mode === 'hashed') {
    /* 前綴 `h:` 讓「雜湊過」與「截斷過」在資料庫裡一眼可分，不必回頭查當時的設定。 */
    return `h:${keyedFingerprint(hashSecret, ip).slice(0, 32)}`;
  }

  const octets = ip.split('.');
  if (octets.length === 4) return `${octets[0] ?? '0'}.${octets[1] ?? '0'}.${octets[2] ?? '0'}.0`;

  /* IPv6：保留前三段（/48），其餘歸零。 */
  const hextets = ip.split(':');
  if (hextets.length >= 3) return `${hextets.slice(0, 3).join(':')}::`;

  return ip;
}

/** 只留下白名單標頭的副本。 */
function pickHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const picked: Record<string, string> = {};

  for (const name of HEADER_WHITELIST) {
    const value = headers[name];
    if (value !== undefined && value !== '') picked[name] = value;
  }

  return picked;
}

/** 組出要落庫的那一列。 */
export function buildRequestRow(input: {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly deviceId: string | null;
  readonly runId: string | null;
  readonly ip: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly ipStorage: IpStorageMode;
  readonly ipHashSecret: string;
}): RequestRow {
  const text = (name: string): string | null => {
    const value = input.headers[name];
    return value === undefined || value === '' ? null : value;
  };

  return {
    method: input.method,
    path: input.path,
    status: input.status,
    deviceId: input.deviceId,
    runId: input.runId,
    clientIp: storeIp(input.ip, input.ipStorage, input.ipHashSecret),
    userAgent: text('user-agent'),
    acceptLanguage: text('accept-language'),
    origin: text('origin'),
    referer: text('referer'),
    country: text(LOCATION_HEADERS.country),
    region: text(LOCATION_HEADERS.region),
    city: text(LOCATION_HEADERS.city),
    headers: pickHeaders(input.headers),
  };
}
