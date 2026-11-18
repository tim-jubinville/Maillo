import { playChime } from './chime';
import { config } from './config';
import { deliverDemoMail } from './gmail/demo';
import { decodeEntities, displayName, header, parseAddress } from './gmail/mime';
import type { GThread, ListThreadsParams } from './gmail/types';
import { t } from './i18n';
import { getPrefs, type NotifyPrefs, type NotifyScope } from './prefs';
import { swRegistration } from './pwa';
import { go, parseHash, threadHash, type MailRoute } from './route';
import { api, getState, onState, refresh } from './store';

export interface NewMail {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
}

const SEEN_KEY = 'maillo.notify.seen';
const INTERVAL = 60_000;

const SCOPE_QUERY: Record<Exclude<NotifyScope, 'none'>, string> = {
  all: 'in:inbox',
  primary: 'in:inbox category:primary',
  important: 'in:inbox is:important'
};

export const notifySupported = typeof window !== 'undefined' && 'Notification' in window;

export function permission(): NotificationPermission | 'unsupported' {
  return notifySupported ? Notification.permission : 'unsupported';
}

export async function askPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notifySupported) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]') as string[]);
  } catch {
    return new Set();
  }
}

let seen = loadSeen();
// Mail that arrived before this session started is already on screen, so only newer mail notifies.
let since = Date.now();
const threadVersions = new Map<string, string>();
let timer: number | undefined;
let running = false;
let pausedNotice = false;

function saveSeen() {
  const list = [...seen].slice(-400);
  seen = new Set(list);
  localStorage.setItem(SEEN_KEY, JSON.stringify(list));
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function inQuietHours(n: NotifyPrefs, now = new Date()): boolean {
  if (!n.quiet) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const a = minutes(n.quietFrom);
  const b = minutes(n.quietTo);
  if (a === b) return false;
  return a < b ? cur >= a && cur < b : cur >= a || cur < b;
}

function quoteAddr(v: string): string {
  return /^[\w.+@-]+$/.test(v) ? v : `"${v.replace(/"/g, '')}"`;
}

function sources(n: NotifyPrefs): ListThreadsParams[] {
  const base = 'is:unread newer_than:2d -in:chats';
  const out: ListThreadsParams[] = [];
  if (n.scope !== 'none') out.push({ q: `${base} ${SCOPE_QUERY[n.scope]}`, maxResults: 15 });
  const vips = n.vips.map((v) => v.trim().replace(/^@/, '')).filter(Boolean);
  if (vips.length) out.push({ q: `${base} -in:spam -in:trash from:(${vips.map(quoteAddr).join(' OR ')})`, maxResults: 15 });
  for (const id of n.labels) out.push({ q: base, labelIds: [id], maxResults: 15 });
  return out;
}

function newMessages(th: GThread, me: string): NewMail[] {
  const out: NewMail[] = [];
  const subject = header(th.messages?.[0]?.payload?.headers, 'Subject');
  for (const m of th.messages ?? []) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    const from = parseAddress(header(m.payload?.headers, 'From'));
    const fresh = Number(m.internalDate ?? 0) >= since - 30_000;
    if (!fresh || !m.labelIds?.includes('UNREAD') || m.labelIds.includes('DRAFT') || from.email.toLowerCase() === me.toLowerCase()) continue;
    out.push({
      id: m.id,
      threadId: th.id,
      from: displayName(from),
      subject: header(m.payload?.headers, 'Subject') || subject || t('list.noSubject'),
      snippet: decodeEntities(m.snippet ?? '')
    });
  }
  return out;
}

async function check() {
  const n = getPrefs().notify;
  const s = getState();
  if (running || !n.enabled || s.phase !== 'ready' || s.sessionExpired) return;
  running = true;
  try {
    const lists = await Promise.all(sources(n).map((p) => api.listThreads(p).catch(() => ({ threads: [] }))));
    const changed = new Map<string, string>();
    for (const l of lists) for (const x of l.threads ?? []) {
      if (threadVersions.get(x.id) !== x.historyId) changed.set(x.id, x.historyId ?? '');
    }
    const found: NewMail[] = [];
    for (const [id, version] of changed) {
      const th = await api.getThread(id, 'metadata').catch(() => undefined);
      if (!th) continue;
      threadVersions.set(id, version);
      found.push(...newMessages(th, s.me));
    }
    saveSeen();
    if (found.length) {
      await announce(found);
      refresh(true);
    }
  } finally {
    running = false;
  }
}

function openThread(threadId: string) {
  window.focus();
  if (!threadId) return;
  const r = parseHash();
  const base: MailRoute = r.view === 'mail' ? { ...r, thread: undefined } : { view: 'mail', folder: 'inbox', category: 'primary' };
  go(threadHash(base, threadId));
}

export function handleOpenFromNotification(threadId: string) {
  openThread(threadId);
}

interface Popup {
  title: string;
  body: string;
  tag: string;
  threadId: string;
}

async function showPopup(p: Popup, silent: boolean) {
  const opts: NotificationOptions & { renotify?: boolean } = {
    body: p.body,
    tag: p.tag,
    renotify: true,
    silent,
    icon: './icon-192.png',
    badge: './badge-96.png',
    data: { threadId: p.threadId, url: p.threadId ? `./#/inbox/t/${encodeURIComponent(p.threadId)}` : './#/inbox' }
  };
  const reg = await Promise.race([swRegistration(), new Promise<undefined>((r) => setTimeout(() => r(undefined), 2000))]);
  if (reg) {
    await reg.showNotification(p.title, opts);
    return;
  }
  const note = new Notification(p.title, opts);
  note.onclick = () => {
    note.close();
    openThread(p.threadId);
  };
}

function popupsFor(items: NewMail[], preview: boolean): Popup[] {
  if (items.length > 3) {
    const names = [...new Set(items.map((i) => i.from))];
    return [{ title: t('notify.many', { n: items.length }), body: names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : ''), tag: 'maillo-summary', threadId: '' }];
  }
  return items.map((i) => ({
    title: i.from,
    body: preview ? `${i.subject}\n${i.snippet}`.trim() : i.subject,
    tag: `thread-${i.threadId}`,
    threadId: i.threadId
  }));
}

export async function announce(items: NewMail[], opts: { test?: boolean } = {}) {
  const n = getPrefs().notify;
  if (!opts.test && inQuietHours(n)) return;
  const front = document.visibilityState === 'visible' && document.hasFocus();
  const wantPopup = opts.test || !front || n.focused === 'notify';
  const wantSound = n.sound && (opts.test || !front || n.focused !== 'silent');
  const played = wantSound ? await playChime(n.chime, n.volume) : false;
  if (!wantPopup || permission() !== 'granted') return;
  // When our chime played, the system sound is turned off so the two don't overlap.
  for (const p of popupsFor(items, n.preview)) await showPopup(p, played || !n.sound).catch(() => undefined);
}

export function sendTest() {
  return announce(
    [{ id: 'test', threadId: '', from: t('notify.testFrom'), subject: t('notify.testSubject'), snippet: t('notify.testBody') }],
    { test: true }
  );
}

async function sessionPaused() {
  const n = getPrefs().notify;
  if (!n.enabled || pausedNotice || permission() !== 'granted' || document.visibilityState === 'visible') return;
  pausedNotice = true;
  await showPopup({ title: t('notify.pausedTitle'), body: t('notify.pausedBody'), tag: 'maillo-session', threadId: '' }, true).catch(() => undefined);
}

let lastBadge = -1;
function updateBadge() {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  if (!nav.setAppBadge) return;
  const s = getState();
  const n = getPrefs().notify;
  const count = n.badge && s.phase === 'ready' ? s.counts.INBOX ?? 0 : 0;
  if (count === lastBadge) return;
  lastBadge = count;
  (count ? nav.setAppBadge(count) : nav.clearAppBadge?.())?.catch(() => undefined);
}

export function initNotifier() {
  let wasReady = false;
  let wasExpired = false;
  onState(() => {
    const s = getState();
    updateBadge();
    if (s.phase === 'ready' && !wasReady) {
      wasReady = true;
      since = Date.now();
      clearInterval(timer);
      // Timers keep running in background tabs (at most once a minute), which is all this needs.
      timer = window.setInterval(() => check().catch(() => undefined), INTERVAL);
      setTimeout(() => check().catch(() => undefined), 8000);
      if (config.demo) {
        const demo = window.setInterval(() => {
          if (!getPrefs().notify.enabled) return;
          clearInterval(demo);
          deliverDemoMail();
          check().catch(() => undefined);
        }, 20_000);
      }
    }
    if (s.sessionExpired && !wasExpired) sessionPaused();
    if (!s.sessionExpired && wasExpired) {
      pausedNotice = false;
      setTimeout(() => check().catch(() => undefined), 2000);
    }
    wasExpired = s.sessionExpired;
  });
  window.addEventListener('online', () => check().catch(() => undefined));
}
