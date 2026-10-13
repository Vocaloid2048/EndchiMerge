/**
 * 接收紀錄：客戶端位址、標頭白名單，以及落庫的形狀。
 * The receive log: client address, the header whitelist, and the row shape that goes into the database.
 */

import type { IpStorageMode } from './env.js';
import { keyedFingerprint } from './tokens.js';

/**
 * 會落庫的標頭：白名單而非黑名單；`cookie` 與 `authorization` 明確不在、永不加入，避免存到任何憑證。
 * The headers that are stored: a whitelist, never a blacklist; `cookie` and `authorization` are
 * explicitly absent and will never be added, so no credential can end up here.
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

/**
 * 白名單標頭裡、另外拉出來當獨立欄位的三個（寫進專屬欄位而不是 jsonb）。
 * The three whitelisted headers pulled out as their own columns (not into the jsonb blob).
 */
const LOCATION_HEADERS = {
  country: 'x-vercel-ip-country',
  region: 'x-vercel-ip-country-region',
  city: 'x-vercel-ip-city',
} as const;

/**
 * 落庫的一列；欄位名稱與 `schema.sql` 的 `requests` 表一一對應。
 * The row that gets persisted; field names map one-to-one onto the `requests` table in `schema.sql`.
 */
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
 * 去掉埠、並把 IPv4-mapped IPv6 收斂成 IPv4；否則同一來源會被算成多位址，速率限制與判讀一起失效。
 * Strips the port and folds IPv4-mapped IPv6 back to IPv4; without both, one source becomes
 * several addresses and rate limiting (and any reading of it) breaks.
 */
function normaliseAddress(raw: string): string {
  let value = raw.trim();
  if (value === '') return '';

  /* `[::1]:1234` → `::1`；`1.2.3.4:5678` → `1.2.3.4`。
   * `[::1]:1234` → `::1`; `1.2.3.4:5678` → `1.2.3.4`. */
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(value);
  if (bracketed?.[1] !== undefined) value = bracketed[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) value = value.slice(0, value.indexOf(':'));

  /* `::ffff:1.2.3.4` 是同一個 IPv4 位址的另一種寫法。
   * `::ffff:1.2.3.4` is another spelling of the same IPv4 address. */
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  if (mapped?.[1] !== undefined) value = mapped[1];

  return value.toLowerCase();
}

/**
 * 真正的客戶端位址；`x-forwarded-for` 取第一個（原始客戶端），取錯邊會讓所有人看起來都來自同一個節點。
 * The actual client address; the first `x-forwarded-for` entry (the original client) wins — the
 * wrong end makes everyone appear to come from one CDN node.
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
 * 依 `IP_STORAGE_MODE` 決定 IP 的存法；預設 `truncated` 是刻意的 —— IP 屬個人資料，存到網段已足夠追濫用與除錯。
 * How the IP is stored, per `IP_STORAGE_MODE`; the `truncated` default is deliberate — IPs are
 * personal data, and the network already suffices for abuse handling and debugging.
 */
export function storeIp(
  ip: string,
  mode: IpStorageMode,
  hashSecret: string,
): string | null {
  if (ip === '') return null;
  if (mode === 'raw') return ip;

  if (mode === 'hashed') {
    /*
     * 前綴 `h:` 讓「雜湊過」與「截斷過」在資料庫裡一眼可分。
     * The `h:` prefix keeps hashed and truncated values apart at a glance.
     */
    return `h:${keyedFingerprint(hashSecret, ip).slice(0, 32)}`;
  }

  const octets = ip.split('.');
  if (octets.length === 4) return `${octets[0] ?? '0'}.${octets[1] ?? '0'}.${octets[2] ?? '0'}.0`;

  /* IPv6：保留前三段（/48），其餘歸零。
   * IPv6: keep the first three hextets (/48) and zero the rest. */
  const hextets = ip.split(':');
  if (hextets.length >= 3) return `${hextets.slice(0, 3).join(':')}::`;

  return ip;
}

/**
 * 只留下白名單標頭的副本。
 * Keeps only the whitelisted headers.
 */
function pickHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const picked: Record<string, string> = {};

  for (const name of HEADER_WHITELIST) {
    const value = headers[name];
    if (value !== undefined && value !== '') picked[name] = value;
  }

  return picked;
}

/**
 * 組出要落庫的那一列。
 * Builds the row to persist.
 */
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
