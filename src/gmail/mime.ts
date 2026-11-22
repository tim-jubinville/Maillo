import type { GMessage, GPart } from './types';

export interface Address {
  name: string;
  email: string;
}

export interface Attachment {
  messageId: string;
  attachmentId?: string;
  inlineData?: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId?: string;
  inline: boolean;
}

export interface ParsedMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  date: Date;
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  subject: string;
  messageId: string;
  references: string;
  listUnsubscribe: string;
  html: string;
  text: string;
  attachments: Attachment[];
  calendar?: { summary: string; start?: Date; end?: Date; location?: string };
}

const utf8 = new TextDecoder('utf-8');

export function b64urlToBytes(data: string): Uint8Array {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  const pad = b64.length % 4 ? b64 + '='.repeat(4 - (b64.length % 4)) : b64;
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64urlToBase64(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return b64.length % 4 ? b64 + '='.repeat(4 - (b64.length % 4)) : b64;
}

function charsetOf(part: GPart): string {
  const ct = header(part.headers, 'Content-Type');
  const m = /charset="?([^";\s]+)"?/i.exec(ct);
  return (m?.[1] || 'utf-8').toLowerCase();
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
// Text that was UTF-8 but got read as Latin-1/Windows-1252 somewhere along the way ("Ã©", "â€™").
const MOJIBAKE = /[ÃÂâ][\u0080-¿ŒœŠšŸŽžƒˆ˜–—‘-„†-•…‰‹›€™]/g;
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89,
  0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f
};

/** Undoes a UTF-8 → Windows-1252 misreading, only when the whole text converts back cleanly. */
export function repairMojibake(s: string): string {
  const hits = s.match(MOJIBAKE)?.length ?? 0;
  if (!hits) return s;
  const bytes: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x100) bytes.push(c);
    else if (CP1252[c] !== undefined) bytes.push(CP1252[c]);
    else return s;
  }
  try {
    const fixed = strictUtf8.decode(new Uint8Array(bytes));
    return (fixed.match(MOJIBAKE)?.length ?? 0) < hits ? fixed : s;
  } catch {
    return s;
  }
}

function decodeText(data: string, charset: string): string {
  const bytes = b64urlToBytes(data);
  // Many senders label UTF-8 text as Latin-1 (or not at all). Valid UTF-8 with accents is almost never meant as Latin-1.
  if (charset !== 'utf-8' && charset !== 'utf8' && bytes.some((b) => b > 0x7f)) {
    try {
      return repairMojibake(strictUtf8.decode(bytes));
    } catch {
      /* really a single-byte charset */
    }
  }
  let text: string;
  try {
    text = new TextDecoder(charset).decode(bytes);
  } catch {
    text = utf8.decode(bytes);
  }
  return repairMojibake(text);
}

export function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export function strToB64url(s: string): string {
  return bytesToB64(new TextEncoder().encode(s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function header(headers: { name: string; value: string }[] | undefined, name: string): string {
  const n = name.toLowerCase();
  return headers?.find((h) => h.name.toLowerCase() === n)?.value ?? '';
}

export function parseAddressList(value: string): Address[] {
  const out: Address[] = [];
  let buf = '';
  let quoted = false;
  let angle = 0;
  const push = () => {
    const a = parseAddress(buf);
    if (a.email) out.push(a);
    buf = '';
  };
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === '<') angle++;
    if (!quoted && ch === '>') angle = Math.max(0, angle - 1);
    if (!quoted && !angle && (ch === ',' || ch === ';')) push();
    else buf += ch;
  }
  push();
  return out;
}

export function parseAddress(raw: string): Address {
  const s = raw.trim();
  const m = /^(.*)<([^>]+)>\s*$/.exec(s);
  if (m) {
    const name = m[1].trim().replace(/^"|"$/g, '').replace(/\\"/g, '"').trim();
    return { name, email: m[2].trim() };
  }
  return { name: '', email: s.replace(/^mailto:/i, '') };
}

export function displayName(a: Address): string {
  return a.name || a.email.split('@')[0] || a.email;
}

export function formatAddress(a: Address): string {
  if (!a.name) return a.email;
  const needsQuote = /[",;<>@()[\]:\\]/.test(a.name);
  const name = /[^\x20-\x7e]/.test(a.name)
    ? encodeWord(a.name)
    : needsQuote
      ? `"${a.name.replace(/"/g, '\\"')}"`
      : a.name;
  return `${name} <${a.email}>`;
}

export function encodeWord(s: string): string {
  if (!/[^\x20-\x7e]/.test(s)) return s;
  return `=?UTF-8?B?${bytesToB64(new TextEncoder().encode(s))}?=`;
}

function walk(part: GPart | undefined, fn: (p: GPart) => void) {
  if (!part) return;
  fn(part);
  part.parts?.forEach((p) => walk(p, fn));
}

function unfoldIcs(text: string): string[] {
  return text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
}

function icsDate(v?: string): Date | undefined {
  if (!v) return undefined;
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(v);
  if (!m) return undefined;
  const [, y, mo, d, h = '0', mi = '0', se = '0', z] = m;
  return z
    ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se))
    : new Date(+y, +mo - 1, +d, +h, +mi, +se);
}

function parseIcs(text: string) {
  const lines = unfoldIcs(text);
  const get = (key: string) => {
    const l = lines.find((x) => x.startsWith(key + ':') || x.startsWith(key + ';'));
    return l ? l.slice(l.indexOf(':') + 1).replace(/\\,/g, ',').replace(/\\n/g, '\n').replace(/\\;/g, ';') : undefined;
  };
  return { summary: get('SUMMARY') ?? '', start: icsDate(get('DTSTART')), end: icsDate(get('DTEND')), location: get('LOCATION') };
}

export function parseMessage(m: GMessage): ParsedMessage {
  const h = m.payload?.headers;
  let html = '';
  let text = '';
  let calendar: ParsedMessage['calendar'];
  const attachments: Attachment[] = [];
  walk(m.payload, (p) => {
    const filename = p.filename ?? '';
    const cid = header(p.headers, 'Content-ID').replace(/^<|>$/g, '');
    const disposition = header(p.headers, 'Content-Disposition').toLowerCase();
    if (p.mimeType === 'text/calendar' && p.body?.data) {
      calendar = parseIcs(decodeText(p.body.data, charsetOf(p)));
    }
    if (filename || (p.body?.attachmentId && !p.mimeType.startsWith('multipart/'))) {
      attachments.push({
        messageId: m.id,
        attachmentId: p.body?.attachmentId,
        inlineData: p.body?.data,
        filename: filename || 'attachment',
        mimeType: p.mimeType,
        size: p.body?.size ?? 0,
        contentId: cid || undefined,
        inline: !!cid && !disposition.startsWith('attachment')
      });
      return;
    }
    if (p.mimeType === 'text/html' && p.body?.data && !html) html = decodeText(p.body.data, charsetOf(p));
    else if (p.mimeType === 'text/plain' && p.body?.data && !text) text = decodeText(p.body.data, charsetOf(p));
  });
  const dateHeader = header(h, 'Date');
  const date = m.internalDate ? new Date(Number(m.internalDate)) : new Date(dateHeader || Date.now());
  return {
    id: m.id,
    threadId: m.threadId,
    labelIds: m.labelIds ?? [],
    snippet: repairMojibake(decodeEntities(m.snippet ?? '')),
    date,
    from: parseAddress(header(h, 'From')),
    to: parseAddressList(header(h, 'To')),
    cc: parseAddressList(header(h, 'Cc')),
    bcc: parseAddressList(header(h, 'Bcc')),
    replyTo: parseAddressList(header(h, 'Reply-To')),
    subject: repairMojibake(header(h, 'Subject')),
    messageId: header(h, 'Message-ID') || header(h, 'Message-Id'),
    references: header(h, 'References'),
    listUnsubscribe: header(h, 'List-Unsubscribe'),
    html,
    text,
    attachments,
    calendar
  };
}

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  const el = document.createElement('textarea');
  el.innerHTML = s;
  return el.value;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function textToHtml(text: string): string {
  const esc = escapeHtml(text);
  const linked = esc.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (u) => `<a href="${u}">${u}</a>`);
  return `<div style="white-space:pre-wrap;font-family:inherit">${linked}</div>`;
}

export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
  doc.querySelectorAll('p,div,li,tr,h1,h2,h3,h4,blockquote').forEach((el) => el.append('\n'));
  doc.querySelectorAll('li').forEach((el) => el.prepend('• '));
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

export interface OutgoingAttachment {
  filename: string;
  mimeType: string;
  base64: string;
}

export interface Outgoing {
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  html: string;
  inReplyTo?: string;
  references?: string;
  attachments: OutgoingAttachment[];
}

function wrap76(b64: string): string {
  return b64.replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

function boundary() {
  return '=_mm_' + crypto.getRandomValues(new Uint32Array(3)).join('');
}

function encodeFilename(name: string): string {
  return /[^\x20-\x7e]/.test(name) || /["\\]/.test(name)
    ? `filename*=UTF-8''${encodeURIComponent(name)}`
    : `filename="${name}"`;
}

export function buildMime(o: Outgoing): string {
  const lines: string[] = [];
  const hdr = (k: string, v: string) => v && lines.push(`${k}: ${v}`);
  hdr('From', formatAddress(o.from));
  hdr('To', o.to.map(formatAddress).join(', '));
  hdr('Cc', o.cc.map(formatAddress).join(', '));
  hdr('Bcc', o.bcc.map(formatAddress).join(', '));
  hdr('Subject', encodeWord(o.subject));
  hdr('In-Reply-To', o.inReplyTo ?? '');
  hdr('References', o.references ?? '');
  hdr('Date', new Date().toUTCString().replace('GMT', '+0000'));
  lines.push('MIME-Version: 1.0');
  const alt = boundary();
  const altBody = [
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(bytesToB64(new TextEncoder().encode(htmlToText(o.html)))),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(bytesToB64(new TextEncoder().encode(o.html))),
    `--${alt}--`
  ].join('\r\n');
  if (!o.attachments.length) {
    lines.push(`Content-Type: multipart/alternative; boundary="${alt}"`, '', altBody);
    return lines.join('\r\n');
  }
  const mixed = boundary();
  lines.push(`Content-Type: multipart/mixed; boundary="${mixed}"`, '', `--${mixed}`);
  lines.push(`Content-Type: multipart/alternative; boundary="${alt}"`, '', altBody);
  for (const a of o.attachments) {
    lines.push(
      `--${mixed}`,
      `Content-Type: ${a.mimeType || 'application/octet-stream'}; name="${a.filename.replace(/"/g, '')}"`,
      `Content-Disposition: attachment; ${encodeFilename(a.filename)}`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(a.base64)
    );
  }
  lines.push(`--${mixed}--`);
  return lines.join('\r\n');
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
