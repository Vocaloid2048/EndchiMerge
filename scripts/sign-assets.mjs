#!/usr/bin/env node
/**
 * sign-assets.mjs — 為方團團素材（SVG / PNG / WebP）注入不可見的元數據簽名。
 * Embed an invisible metadata signature into EndchiMerge character assets.
 *
 * 為什麼是「元數據」而不是可見浮水印：
 *   Metadata is invisible, whereas a visible watermark would ruin the in-game
 *   artwork and would clash with the design mock-up.
 *
 * 重要前提（勿誤解）：
 *   SVG / PNG / WebP 都是「使用者可直接編輯」的格式——任何簽名都能被移除或覆寫。
 *   這個簽名是**署名與溯源**，不是防拷貝。真正的保護是授權聲明 + git 時間戳。
 *   Signing is attribution, not DRM. Nothing here prevents removal.
 *
 * 用法 / Usage:
 *   node scripts/sign-assets.mjs <file|dir> [...]           就地簽名（可重複執行）
 *   node scripts/sign-assets.mjs --check <file|dir> [...]   只檢查；有檔案未簽名即 exit 1
 *   node scripts/sign-assets.mjs --dry-run <file|dir> [...] 只報告，不寫入
 *
 * 支援格式 / Formats:
 *   .svg  → <title> / <desc> / <metadata>（RDF: dc:* + xmp:CreatorTool）
 *   .png  → iTXt chunk  keyword = "XML:com.adobe.xmp"
 *   .webp → RIFF "XMP " chunk（必要時自動升級為 VP8X 擴充容器）
 */
import fs from 'node:fs';
import path from 'node:path';

/* ── 簽名內容（單一真實來源）/ Signature payload ───────────────────────────── */

const SIGNER = {
  tool: 'EndchiMerge asset-signer',
  version: '1',
  creator: 'Vocaloid2048',
  rights: '非官方同人延伸作品；角色名稱與原設定版權屬原權利人。',
  source: 'https://github.com/Vocaloid2048/EndchiMerge',
  lang: 'zh-Hant',
};

/** 用於 --check 的辨識字串；版本變動時舊檔案會刻意變成「未簽名」。 */
const MARKER = `${SIGNER.tool} v${SIGNER.version}`;
const SUPPORTED = new Set(['.svg', '.png', '.webp']);
const TODAY = new Date().toISOString().slice(0, 10);

/* ── 共用 / Shared ─────────────────────────────────────────────────────────── */

/** 由檔名推導角色顯示名：`萊萬汀_img.svg` → `萊萬汀`。 */
function titleFromPath(file) {
  return path
    .basename(file)
    .replace(/\.[^.]+$/, '')
    .replace(/_(img|icon|sprite|sym|art)$/i, '');
}

/** 保留既有簽名的建立日期，讓重複執行不會產生 diff 雜訊。 */
function pickDate(existingDate) {
  return existingDate && /^\d{4}-\d{2}-\d{2}$/.test(existingDate) ? existingDate : TODAY;
}

/* ── SVG ───────────────────────────────────────────────────────────────────── */

function svgBlock(ctx) {
  return [
    `  <title>${ctx.title} — 方團團（EndchiMerge）</title>`,
    `  <desc>非官方二創角色素材；作者 ${SIGNER.creator}。角色名稱與原設定版權屬原權利人。</desc>`,
    `  <metadata>`,
    `    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"`,
    `             xmlns:dc="http://purl.org/dc/elements/1.1/"`,
    `             xmlns:dcterms="http://purl.org/dc/terms/"`,
    `             xmlns:xmp="http://ns.adobe.com/xap/1.0/">`,
    `      <rdf:Description rdf:about="">`,
    `        <dc:title>${ctx.title}</dc:title>`,
    `        <dc:creator>${SIGNER.creator}</dc:creator>`,
    `        <dc:rights>${SIGNER.rights}</dc:rights>`,
    `        <dcterms:created>${ctx.date}</dcterms:created>`,
    `        <dc:source>${SIGNER.source}</dc:source>`,
    `        <xmp:CreatorTool>${MARKER}</xmp:CreatorTool>`,
    `      </rdf:Description>`,
    `    </rdf:RDF>`,
    `  </metadata>`,
  ].join('\n');
}

/**
 * 切開 `<svg>` 開標籤與其後「連續的 title / desc / metadata 區塊」。
 * 原素材的第一個子元素一律是繪圖元素，故此切法對本專案安全。
 */
function splitSvg(xml) {
  const open = xml.match(/<svg\b[^>]*>/i);
  if (!open) return null;
  const head = open[0];
  const prefix = xml.slice(0, open.index);
  let rest = xml.slice(open.index + head.length);
  const leading = /^\s*<(title|desc|metadata)\b[\s\S]*?<\/\1>\s*/i;
  while (leading.test(rest)) rest = rest.replace(leading, '');
  return { prefix, head, rest: rest.replace(/^\s*/, '') };
}

function signSvgFile(raw, file) {
  const parts = splitSvg(raw);
  if (!parts) throw new Error('找不到 <svg> 開標籤 / no <svg> opening tag');
  const date = pickDate((raw.match(/<dcterms:created>([^<]*)<\/dcterms:created>/) || [])[1]);
  const block = svgBlock({ title: titleFromPath(file), date });
  return `${parts.prefix}${parts.head}\n${block}\n${parts.rest}`;
}

/* ── XMP（供 PNG / WebP 使用）/ XMP packet for raster formats ──────────────── */

function buildXmp(ctx) {
  return [
    `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>`,
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">`,
    `  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">`,
    `    <rdf:Description rdf:about=""`,
    `        xmlns:dc="http://purl.org/dc/elements/1.1/"`,
    `        xmlns:dcterms="http://purl.org/dc/terms/"`,
    `        xmlns:xmp="http://ns.adobe.com/xap/1.0/">`,
    `      <dc:title><rdf:Alt><rdf:li xml:lang="${SIGNER.lang}">${ctx.title}</rdf:li></rdf:Alt></dc:title>`,
    `      <dc:creator><rdf:Seq><rdf:li>${SIGNER.creator}</rdf:li></rdf:Seq></dc:creator>`,
    `      <dc:rights><rdf:Alt><rdf:li xml:lang="${SIGNER.lang}">${SIGNER.rights}</rdf:li></rdf:Alt></dc:rights>`,
    `      <dc:source>${SIGNER.source}</dc:source>`,
    `      <dcterms:created>${ctx.date}</dcterms:created>`,
    `      <xmp:CreatorTool>${MARKER}</xmp:CreatorTool>`,
    `    </rdf:Description>`,
    `  </rdf:RDF>`,
    `</x:xmpmeta>`,
    `<?xpacket end="w"?>`,
  ].join('\n');
}

/* ── PNG ───────────────────────────────────────────────────────────────────── */

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** iTXt payload：keyword\0 compFlag compMethod langTag\0 translatedKeyword\0 text */
function itxtChunk(keyword, text) {
  const data = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0, 0, 0]), // keyword 結束 + 無壓縮 + 壓縮方法 0
    Buffer.from([0]), // 空 language tag
    Buffer.from([0]), // 空 translated keyword
    Buffer.from(text, 'utf8'),
  ]);
  return pngChunk('iTXt', data);
}

function walkPng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error('不是 PNG / not a PNG (bad signature)');
  }
  const chunks = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    chunks.push({ type, data: buf.subarray(off + 8, off + 8 + len), start: off, end: off + 12 + len });
    off += 12 + len;
    if (type === 'IEND') break;
  }
  if (off !== buf.length) throw new Error('PNG chunk 走訪長度不符 / chunk walk mismatch');
  return chunks;
}

const PNG_XMP_KEY = 'XML:com.adobe.xmp';

function pngKeyword(data) {
  const z = data.indexOf(0);
  return z === -1 ? '' : data.toString('latin1', 0, z);
}

function signPng(buf, ctx) {
  const chunks = walkPng(buf);
  const chunk = itxtChunk(PNG_XMP_KEY, buildXmp(ctx));
  const parts = [PNG_SIG];
  let inserted = false;
  for (const c of chunks) {
    if ((c.type === 'iTXt' || c.type === 'tEXt' || c.type === 'zTXt') && pngKeyword(c.data) === PNG_XMP_KEY) {
      continue; // 丟棄舊簽名，稍後緊接 IHDR 重新插入
    }
    parts.push(buf.subarray(c.start, c.end));
    if (c.type === 'IHDR' && !inserted) {
      parts.push(chunk);
      inserted = true;
    }
  }
  if (!inserted) throw new Error('PNG 缺少 IHDR / missing IHDR');
  const out = Buffer.concat(parts);
  walkPng(out); // 往返驗證：結構不合法就拋錯，呼叫端不會寫檔
  return out;
}

/* ── WebP（RIFF 容器）/ WebP RIFF container ────────────────────────────────── */

const WEBP_XMP_FLAG = 0x04; // VP8X flags byte 的 XMP 位元

function walkRiff(buf) {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') {
    throw new Error('不是 WebP / not a WebP (bad RIFF header)');
  }
  if (buf.readUInt32LE(4) + 8 !== buf.length) {
    throw new Error('RIFF 宣告長度不符 / RIFF size mismatch');
  }
  const chunks = [];
  let off = 12;
  while (off < buf.length) {
    const fourcc = buf.toString('latin1', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + size);
    chunks.push({ fourcc, data });
    off += 8 + size + (size % 2);
  }
  if (off !== buf.length) throw new Error('RIFF chunk 走訪長度不符 / chunk walk mismatch');
  return chunks;
}

function writeRiff(chunks) {
  const parts = [];
  for (const c of chunks) {
    const head = Buffer.alloc(8);
    head.write(c.fourcc, 0, 'latin1');
    head.writeUInt32LE(c.data.length, 4);
    parts.push(head, Buffer.from(c.data));
    if (c.data.length % 2) parts.push(Buffer.from([0])); // 奇數長度需補齊
  }
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

/** 讀出畫布尺寸，用於必要時建立 VP8X 擴充容器。 */
function webpCanvas(chunks) {
  const u24 = (d, o) => d[o] | (d[o + 1] << 8) | (d[o + 2] << 16);
  const vp8x = chunks.find((c) => c.fourcc === 'VP8X');
  if (vp8x) return { w: u24(vp8x.data, 4) + 1, h: u24(vp8x.data, 7) + 1 };
  const vp8l = chunks.find((c) => c.fourcc === 'VP8L');
  if (vp8l) {
    const v = vp8l.data.readUInt32LE(1);
    return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 };
  }
  const vp8 = chunks.find((c) => c.fourcc === 'VP8 ');
  if (vp8) {
    const d = vp8.data;
    if (!(d[3] === 0x9d && d[4] === 0x01 && d[5] === 0x2a)) throw new Error('VP8 起始碼缺失 / bad VP8 start code');
    return { w: (d[6] | (d[7] << 8)) & 0x3fff, h: (d[8] | (d[9] << 8)) & 0x3fff };
  }
  throw new Error('找不到影像 chunk / no image chunk (VP8/VP8L/VP8X)');
}

function signWebp(buf, ctx) {
  let chunks = walkRiff(buf);
  chunks = chunks.filter((c) => c.fourcc !== 'XMP ');
  const existing = chunks.find((c) => c.fourcc === 'VP8X');
  if (existing) {
    const data = Buffer.from(existing.data);
    data[0] |= WEBP_XMP_FLAG;
    existing.data = data;
  } else {
    const { w, h } = webpCanvas(chunks);
    const data = Buffer.alloc(10);
    data[0] = WEBP_XMP_FLAG;
    data.writeUIntLE(w - 1, 4, 3);
    data.writeUIntLE(h - 1, 7, 3);
    chunks.unshift({ fourcc: 'VP8X', data });
  }
  chunks.push({ fourcc: 'XMP ', data: Buffer.from(buildXmp(ctx), 'utf8') });
  const out = writeRiff(chunks);
  walkRiff(out); // 往返驗證
  return out;
}

/* ── 簽名偵測（供 --check）/ Signature detection ───────────────────────────── */

function isSigned(file, buf) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.svg') return buf.toString('utf8').includes(MARKER);
  if (ext === '.png') {
    for (const c of walkPng(buf)) {
      if ((c.type === 'iTXt' || c.type === 'tEXt' || c.type === 'zTXt') && pngKeyword(c.data) === PNG_XMP_KEY) {
        return c.data.toString('utf8').includes(MARKER);
      }
    }
    return false;
  }
  if (ext === '.webp') {
    const chunk = walkRiff(buf).find((c) => c.fourcc === 'XMP ');
    return Boolean(chunk) && chunk.data.toString('utf8').includes(MARKER);
  }
  return false;
}

/* ── 簽名（就地修改）/ Signing ─────────────────────────────────────────────── */

function sign(file, buf) {
  const ext = path.extname(file).toLowerCase();
  const date = pickDate(
    ext === '.svg'
      ? (buf.toString('utf8').match(/<dcterms:created>([^<]*)<\/dcterms:created>/) || [])[1]
      : (bufferToXmpDate(buf, ext) ?? undefined),
  );
  const ctx = { title: titleFromPath(file), date };
  if (ext === '.svg') {
    const text = signSvgFile(buf.toString('utf8'), file);
    return Buffer.from(text, 'utf8');
  }
  if (ext === '.png') return signPng(buf, ctx);
  if (ext === '.webp') return signWebp(buf, ctx);
  throw new Error(`不支援的格式 / unsupported format: ${ext}`);
}

/** 從既有 PNG/WebP 簽名取出日期（若有）。 */
function bufferToXmpDate(buf, ext) {
  let xmp = '';
  try {
    if (ext === '.png') {
      const c = walkPng(buf).find(
        (ch) => (ch.type === 'iTXt' || ch.type === 'tEXt') && pngKeyword(ch.data) === PNG_XMP_KEY,
      );
      xmp = c ? c.data.toString('utf8') : '';
    } else {
      const c = walkRiff(buf).find((ch) => ch.fourcc === 'XMP ');
      xmp = c ? c.data.toString('utf8') : '';
    }
  } catch {
    return null;
  }
  return (xmp.match(/<dcterms:created>([^<]*)<\/dcterms:created>/) || [])[1] ?? null;
}

/* ── 檔案走訪 / File collection ────────────────────────────────────────────── */

function collect(targets) {
  const out = [];
  for (const t of targets) {
    const abs = path.resolve(t);
    if (!fs.existsSync(abs)) {
      console.warn(`警告：路徑不存在，略過 / skipping missing path: ${t}`);
      continue;
    }
    if (fs.statSync(abs).isDirectory()) {
      for (const entry of fs.readdirSync(abs)) {
        const p = path.join(abs, entry);
        if (fs.statSync(p).isFile() && SUPPORTED.has(path.extname(p).toLowerCase())) out.push(p);
      }
    } else {
      out.push(abs);
    }
  }
  return out;
}

/* ── CLI ───────────────────────────────────────────────────────────────────── */

function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const dryRun = argv.includes('--dry-run');
  const targets = argv.filter((a) => !a.startsWith('--'));

  if (targets.length === 0) {
    console.error('用法 / Usage: node scripts/sign-assets.mjs [--check|--dry-run] <file|dir> [...]');
    process.exit(2);
  }

  const files = collect(targets);
  if (files.length === 0) {
    console.error(`找不到任何可簽名的檔案（支援 ${[...SUPPORTED].join(' / ')}）/ no signable files found`);
    process.exit(2);
  }

  let changed = 0;
  const missing = [];
  const failed = [];

  for (const file of files) {
    const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
    let buf;
    try {
      buf = fs.readFileSync(file);
    } catch (e) {
      failed.push([rel, e.message]);
      continue;
    }

    if (check) {
      let signed;
      try {
        signed = isSigned(file, buf);
      } catch (e) {
        failed.push([rel, e.message]);
        continue;
      }
      if (signed) {
        console.log(`OK       ${rel}`);
      } else {
        missing.push(rel);
        console.log(`UNSIGNED ${rel}`);
      }
      continue;
    }

    try {
      const out = sign(file, buf);
      if (out.equals(buf)) {
        console.log(`unchanged ${rel}`);
        continue;
      }
      if (!dryRun) fs.writeFileSync(file, out);
      changed++;
      console.log(`${dryRun ? 'would sign' : 'signed   '} ${rel}`);
    } catch (e) {
      failed.push([rel, e.message]);
    }
  }

  const summary = `${files.length} 個檔案：${changed} 已簽名／變更、${missing.length} 未簽名、${failed.length} 失敗`;
  console.log(`\n${summary}`);

  if (failed.length > 0) {
    for (const [f, m] of failed) console.error(`FAILED  ${f}  ${m}`);
    process.exit(1);
  }
  if (check && missing.length > 0) {
    console.error(
      '\n有素材缺少元數據簽名。請執行 / Missing signatures — run:\n  node scripts/sign-assets.mjs public/assets/character',
    );
    process.exit(1);
  }
}

main();
