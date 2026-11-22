import { header, parseAddress, displayName, decodeEntities, repairMojibake, type Address } from './gmail/mime';
import type { GLabel, GThread, ListThreadsParams } from './gmail/types';
import { t, locale, type StringKey } from './i18n';
import type { Category, Folder, MailRoute } from './route';

export interface ThreadRow {
  id: string;
  historyId?: string;
  subject: string;
  snippet: string;
  senders: { name: string; unread: boolean; me: boolean }[];
  firstFrom: Address;
  lastFrom: Address;
  recipients: Address[];
  count: number;
  date: Date;
  unread: boolean;
  starred: boolean;
  important: boolean;
  hasDraft: boolean;
  attachment: boolean;
  labelIds: string[];
  lastFromMe: boolean;
}

export const SYSTEM_LABELS = new Set([
  'INBOX', 'SPAM', 'TRASH', 'UNREAD', 'STARRED', 'IMPORTANT', 'SENT', 'DRAFT', 'CHAT',
  'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'
]);

export const CATEGORY_LABEL: Record<Category, string> = {
  primary: 'CATEGORY_PERSONAL',
  promotions: 'CATEGORY_PROMOTIONS',
  social: 'CATEGORY_SOCIAL',
  updates: 'CATEGORY_UPDATES',
  forums: 'CATEGORY_FORUMS'
};

const FOLDER_QUERY: Record<Folder, ListThreadsParams> = {
  inbox: { q: 'in:inbox' },
  starred: { q: 'is:starred' },
  snoozed: { q: 'in:snoozed' },
  important: { q: 'is:important' },
  sent: { q: 'in:sent' },
  scheduled: { q: 'in:scheduled' },
  drafts: { q: 'in:drafts' },
  all: {},
  spam: { labelIds: ['SPAM'], includeSpamTrash: true },
  trash: { labelIds: ['TRASH'], includeSpamTrash: true }
};

export function listParams(r: MailRoute, tabs: boolean): ListThreadsParams {
  if (r.q !== undefined) return { q: r.q };
  if (r.label) return { labelIds: [r.label] };
  const f = r.folder ?? 'inbox';
  // Labels rather than a search: searches can lag behind new mail and skip conversations.
  if (f === 'inbox' && tabs) return { labelIds: ['INBOX', CATEGORY_LABEL[r.category]] };
  return { ...FOLDER_QUERY[f] };
}

export function rowFromThread(th: GThread, me: string): ThreadRow {
  const msgs = th.messages ?? [];
  const visible = msgs.filter((m) => !m.labelIds?.includes('DRAFT'));
  const base = visible.length ? visible : msgs;
  const first = base[0];
  const last = base[base.length - 1] ?? first;
  const labels = new Set<string>();
  msgs.forEach((m) => m.labelIds?.forEach((l) => labels.add(l)));
  const meLc = me.toLowerCase();
  const seen = new Map<string, { name: string; unread: boolean; me: boolean }>();
  for (const m of base) {
    const a = parseAddress(header(m.payload?.headers, 'From'));
    const isMe = a.email.toLowerCase() === meLc;
    const key = a.email.toLowerCase();
    const unread = !!m.labelIds?.includes('UNREAD');
    const prev = seen.get(key);
    if (prev) {
      prev.unread ||= unread;
      seen.delete(key);
      seen.set(key, prev);
    } else seen.set(key, { name: isMe ? t('list.me') : displayName(a), unread, me: isMe });
  }
  const lastFrom = parseAddress(header(last?.payload?.headers, 'From'));
  const ct = msgs.map((m) => header(m.payload?.headers, 'Content-Type').toLowerCase());
  return {
    id: th.id,
    historyId: th.historyId,
    subject: repairMojibake(header(first?.payload?.headers, 'Subject')),
    snippet: repairMojibake(decodeEntities(last?.snippet ?? th.snippet ?? '')),
    senders: [...seen.values()],
    firstFrom: parseAddress(header(first?.payload?.headers, 'From')),
    lastFrom,
    recipients: [header(last?.payload?.headers, 'To')].join(',').split(',').filter(Boolean).map(parseAddress),
    count: base.length,
    date: new Date(Number(last?.internalDate ?? Date.now())),
    unread: labels.has('UNREAD'),
    starred: labels.has('STARRED'),
    important: labels.has('IMPORTANT'),
    hasDraft: labels.has('DRAFT'),
    attachment: ct.some((c) => c.startsWith('multipart/mixed')),
    labelIds: [...labels],
    lastFromMe: lastFrom.email.toLowerCase() === meLc
  };
}

export function nudgeDays(r: ThreadRow, folder?: Folder): number {
  if (folder !== 'inbox' || r.unread || r.lastFromMe || !r.important) return 0;
  const days = Math.floor((Date.now() - r.date.getTime()) / 86_400_000);
  return days >= 2 && days <= 14 ? days : 0;
}

export function listDate(d: Date): string {
  const now = new Date();
  const loc = locale();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(loc, { month: 'short', day: 'numeric' });
  return d.toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fullDate(d: Date): string {
  const loc = locale();
  const ago = Date.now() - d.getTime();
  const base = d.toLocaleString(loc, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  if (ago < 86_400_000 && ago >= 0) {
    const rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' });
    const mins = Math.round(ago / 60_000);
    const rel = mins < 60 ? rtf.format(-mins, 'minute') : rtf.format(-Math.round(mins / 60), 'hour');
    return `${base} (${rel})`;
  }
  return base;
}

export function sizeLabel(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const AVATARS = ['#9CC4EC', '#93DCC2', '#93A6C0', '#F1B3C2', '#FFBE7A', '#A6C49A', '#AE9FE6', '#CBC2F0', '#F2D98A', '#EE8F78', '#C79BDD', '#93DCC2'];

export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATARS[h % AVATARS.length];
}

export function initials(a: Address): string {
  const n = (a.name || a.email).replace(/["']/g, '').trim();
  const words = n.split(/[\s._-]+/).filter(Boolean);
  const s = words.length >= 2 ? words[0][0] + words[words.length - 1][0] : n.slice(0, 2);
  return s.toUpperCase();
}

export function folderName(f: Folder): string {
  return t(`nav.${f}` as StringKey);
}

export function labelDisplayName(l: GLabel): string {
  return l.name.split('/').pop() ?? l.name;
}

const LABEL_FALLBACK = ['#3D7BE8', '#EC5A3C', '#14A3A1', '#7350E0', '#F07F1E', '#2E9E62', '#A548C9', '#C2833E'];

/** Gmail's label palette is often pastel; push saturation up and lightness into a mid range so labels read clearly. */
function vivid(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  // Greys stay grey; colours get at least 62% saturation and 42–56% lightness.
  const s2 = s < 0.08 ? s : Math.max(s, 0.62);
  const l2 = Math.min(0.56, Math.max(0.42, l));
  const c = (1 - Math.abs(2 * l2 - 1)) * s2;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const o = l2 - c / 2;
  const [r2, g2, b2] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r2, g2, b2].map((v) => Math.round((v + o) * 255).toString(16).padStart(2, '0')).join('');
}

const vividCache = new Map<string, string>();

export function labelColor(l: GLabel): string {
  const base = l.color?.backgroundColor || LABEL_FALLBACK[Math.abs([...l.id].reduce((a, c) => a * 7 + c.charCodeAt(0), 3)) % LABEL_FALLBACK.length];
  let v = vividCache.get(base);
  if (!v) vividCache.set(base, (v = vivid(base)));
  return v;
}

export function stripSubjectPrefix(s: string): string {
  return s.replace(/^\s*((re|fwd?|tr|réf|ré)\s*:\s*)+/i, '');
}
