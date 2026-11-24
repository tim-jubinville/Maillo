import { useEffect, useState } from 'preact/hooks';
import { config, isAllowedAccount, setup } from './config';
import { currentToken, hadServerSession, hasServerSession, lastingSignIn, onAuthChange, prepareAuth, rememberAccount, rememberedAccount, renewFromServer, signIn, signOut, tokenExpiresSoon } from './auth';
import { AuthRequired, gmailBackend, pool, quotaHeadroom, RateLimited } from './gmail/api';
import { demoBackend } from './gmail/demo';
import {
  buildMime,
  displayName,
  escapeHtml,
  formatAddress,
  parseMessage,
  strToB64url,
  textToHtml,
  type Address,
  type OutgoingAttachment,
  type ParsedMessage
} from './gmail/mime';
import type { GLabel, GSendAs, GThread, MailBackend, NotesMap } from './gmail/types';
import { t, type StringKey } from './i18n';
import { CATEGORY_LABEL, listParams, rowFromThread, stripSubjectPrefix, fullDate, type ThreadRow } from './model';
import { getPrefs, onPrefs, setPrefs, type PanelId } from './prefs';
import type { DragKind } from './dnd';
import { startStickies } from './stickies';
import { startSync } from './sync';
import { clearCache, getThread as cachedThread, openCache, putThread, saveMeta, saveRows, type ListSnap, type Warm } from './cache';
import { checkForUpdate } from './updates';
import { CATEGORIES, go, listHash, parseHash, threadHash, type Category, type MailRoute, type Route } from './route';

export const api: MailBackend = config.demo ? demoBackend : gmailBackend;

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  timeout: number;
  progress?: boolean;
}

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward' | 'draft';

export interface ComposeAttachment extends OutgoingAttachment {
  id: string;
  size: number;
  loading?: boolean;
}

export interface ComposeState {
  key: number;
  mode: ComposeMode;
  threadId?: string;
  draftId?: string;
  from: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  showCc: boolean;
  subject: string;
  html: string;
  quoted: string;
  inReplyTo?: string;
  references?: string;
  attachments: ComposeAttachment[];
  minimized: boolean;
  maximized: boolean;
  /** Shown in its own browser window. */
  popout?: boolean;
  status: 'idle' | 'saving' | 'saved' | 'error';
}

export interface ListState {
  key: string;
  rows: ThreadRow[];
  loading: boolean;
  error?: string;
  page: number;
  tokens: (string | undefined)[];
  next?: string;
  estimate?: number;
}

export interface OpenThread {
  id: string;
  loading: boolean;
  error?: string;
  messages: ParsedMessage[];
  labelIds: string[];
}

export type PileId = 'action' | 'aside';
export const PILES: PileId[] = ['action', 'aside'];

export interface Pile {
  labelId?: string;
  rows: ThreadRow[];
}

export const notesEnabled = config.demo || config.features.notes;

export interface AppState {
  phase: 'boot' | 'signin' | 'denied' | 'ready';
  authError?: string;
  deniedEmail?: string;
  sessionExpired: boolean;
  me: string;
  /** Google profile photo URL for the signed-in account, when available. */
  mePhoto?: string;
  /** Full name of the signed-in Google account. */
  meName?: string;
  /** Contact photo URLs by lower-case email (empty unless features.contactPhotos is on). */
  contactPhotos: Record<string, string>;
  route: Route;
  labels: GLabel[];
  counts: Record<string, number>;
  catNew: Partial<Record<Category, number>>;
  list: ListState;
  selected: Set<string>;
  focusId?: string;
  open?: OpenThread;
  compose?: ComposeState;
  toasts: Toast[];
  panel?: PanelId;
  /** Phones: a side panel app shown full screen, opened from the bottom of the mailbox drawer. Not remembered. */
  sheet?: PanelId;
  sendAs: GSendAs[];
  showKeys: boolean;
  /** A newer release the server can install, from update.php's daily check. */
  update?: { version: string; url: string; canInstall: boolean };
  sidebarOpen: boolean;
  recent: Address[];
  piles: Record<PileId, Pile>;
  notes: NotesMap;
  noteEditing?: string;
  /** What is being dragged, so drop targets can show themselves. */
  dragging?: DragKind;
  /** Key of the list the user just emptied themselves, so Inbox Zero can celebrate once. */
  celebrate?: string;
}

const PHOTO_CACHE = 'maillo.contactPhotos';
const PHOTO_TTL = 12 * 60 * 60 * 1000;

let state: AppState = {
  phase: 'boot',
  sessionExpired: false,
  me: '',
  panel: getPrefs().panel || undefined,
  contactPhotos: readPhotoCache(),
  route: parseHash(),
  labels: [],
  counts: {},
  catNew: {},
  list: { key: '', rows: [], loading: true, page: 0, tokens: [undefined] },
  selected: new Set(),
  toasts: [],
  sendAs: [],
  showKeys: false,
  sidebarOpen: false,
  recent: [],
  piles: { action: { rows: [] }, aside: { rows: [] } },
  notes: {}
};

const listeners = new Set<() => void>();

export function getState() {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  const panelBefore = state.panel;
  state = { ...state, ...p };
  // Remember the open side panel for next time.
  if ('panel' in p && state.panel !== panelBefore) setPrefs({ panel: state.panel ?? '' });
  listeners.forEach((l) => l());
}

export function onState(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useApp(): AppState {
  const [, force] = useState(0);
  const rendered = state;
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    const off = onPrefs(fn);
    // State can change between the first render and this effect (boot() may finish synchronously).
    if (state !== rendered) fn();
    return () => {
      listeners.delete(fn);
      off();
    };
  }, []);
  return state;
}

const LEGACY_ROW_CACHE = 'maillo.rows';
const ROW_CACHE_MAX = 1500;

/** Conversation headers in memory, written through to this device's cache (IndexedDB) a moment after each change. */
class RowCache extends Map<string, ThreadRow> {
  private dirty = new Set<string>();
  private timer: number | undefined;
  set(id: string, row: ThreadRow) {
    super.set(id, row);
    this.touch(id);
    return this;
  }
  delete(id: string) {
    const had = super.delete(id);
    if (had) this.touch(id);
    return had;
  }
  /** Fills the cache from disk without writing it back. */
  load(rows: ThreadRow[]) {
    for (const r of rows) super.set(r.id, r);
  }
  forget() {
    super.clear();
    this.dirty.clear();
    clearTimeout(this.timer);
  }
  private touch(id: string) {
    if (!persist) return;
    this.dirty.add(id);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), 1200);
  }
  private flush() {
    while (this.size > ROW_CACHE_MAX) this.delete(this.keys().next().value!);
    const put: ThreadRow[] = [];
    const remove: string[] = [];
    for (const id of this.dirty) {
      const r = super.get(id);
      if (r) put.push(r);
      else remove.push(id);
    }
    this.dirty.clear();
    saveRows(put, remove);
  }
}

const rowCache = new RowCache();
// Demo mode has its own sample data and never touches the device's cache.
let persist = false;
/** What each list last showed, by list key, so switching back to it is instant. */
let listSnaps: Record<string, ListSnap> = {};

/** Opens this device's cache for an account: headers, lists, labels, counts and piles from last time. */
async function loadRowCache(me: string): Promise<Warm> {
  if (config.demo) return { rows: [], meta: {} };
  persist = false;
  rowCache.forget();
  const warm = await openCache(me);
  rowCache.load(warm.rows);
  listSnaps = (warm.meta.lists as Record<string, ListSnap> | undefined) ?? {};
  persist = true;
  // Headers kept in local storage before 0.6.10 move over once.
  try {
    const old = JSON.parse(localStorage.getItem(LEGACY_ROW_CACHE) || 'null') as { me: string; rows: ThreadRow[] } | null;
    localStorage.removeItem(LEGACY_ROW_CACHE);
    if (old?.me === me.toLowerCase() && Array.isArray(old.rows)) for (const r of old.rows) if (r?.id && !rowCache.has(r.id)) rowCache.set(r.id, { ...r, date: new Date(r.date) });
  } catch {
    /* start empty */
  }
  return warm;
}

function saveListSnap(key: string, snap: ListSnap) {
  listSnaps = { ...listSnaps, [key]: snap };
  // Only the most recent lists are worth keeping.
  const keys = Object.keys(listSnaps);
  if (keys.length > 40) delete listSnaps[keys[0]];
  if (persist) saveMeta('lists', listSnaps);
}

/** A list as it was last time, if every one of its rows is still known. */
function snapRows(key: string): { rows: ThreadRow[]; snap: ListSnap } | undefined {
  const snap = listSnaps[key];
  if (!snap) return undefined;
  const rows = snap.ids.map((id) => rowCache.get(id)).filter((r): r is ThreadRow => !!r);
  return rows.length === snap.ids.length ? { rows, snap } : undefined;
}

export async function clearRowCache() {
  persist = false;
  rowCache.forget();
  listSnaps = {};
  localStorage.removeItem(LEGACY_ROW_CACHE);
  if (!config.demo) await clearCache();
}

/** Rows for listed threads, fetching only those that are new or changed since last time (in batches). */
async function fetchRows(list: { id: string; historyId?: string }[]): Promise<ThreadRow[]> {
  const stale = list.filter((x) => {
    const c = rowCache.get(x.id);
    return !c || !x.historyId || c.historyId !== x.historyId;
  });
  if (stale.length) {
    const ths = await api.getThreads(stale.map((x) => x.id));
    ths.forEach((th) => {
      if (!th) return;
      const row = rowFromThread(th, state.me);
      // Re-insert so the most recently seen rows are the last to be evicted.
      rowCache.delete(row.id);
      rowCache.set(row.id, row);
    });
  }
  return list.map((x) => rowCache.get(x.id)).filter((r): r is ThreadRow => !!r);
}

export { fetchRows };
let toastSeq = 1;
let listSeq = 0;
let openSeq = 0;

export function toast(text: string, opts: Partial<Omit<Toast, 'id' | 'text'>> = {}) {
  const id = toastSeq++;
  const item: Toast = { id, text, timeout: opts.timeout ?? 6000, action: opts.action, progress: opts.progress };
  setState((s) => ({ toasts: [...s.toasts.filter((x) => !x.progress || opts.progress), item].slice(-3) }));
  if (item.timeout > 0) setTimeout(() => dismissToast(id), item.timeout);
  return id;
}

export function dismissToast(id: number) {
  setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
}

function fail(e: unknown) {
  if (e instanceof AuthRequired) {
    setState({ sessionExpired: true });
    return;
  }
  const msg = e instanceof Error ? e.message : String(e);
  toast(t('toast.error', { msg }));
}

export async function boot() {
  window.addEventListener('hashchange', onHash);
  let lastRenew = 0;
  window.addEventListener('pointerdown', () => {
    if (config.demo || state.phase !== 'ready' || !tokenExpiresSoon() || Date.now() - lastRenew < 60_000) return;
    lastRenew = Date.now();
    signIn().catch(() => undefined);
  }, true);
  // Timers sleep with the tab or the computer; catch up when it's back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && hasServerSession() && (tokenExpiresSoon() || !currentToken())) renewFromServer().catch(() => undefined);
  });
  onAuthChange(() => {
    if (config.demo || state.phase !== 'ready' || currentToken()) return;
    // With a lasting session, a lapsed token is renewed quietly instead of asking to sign in.
    if (hasServerSession()) {
      renewFromServer().then((ok) => {
        if (ok) setState({ sessionExpired: false });
        else if (!currentToken()) setState({ sessionExpired: true });
      });
      return;
    }
    setState({ sessionExpired: true });
  });
  if (config.demo) return start();
  if (!config.googleClientId || (setup && !setup.ready)) return setState({ phase: 'signin' });
  // Signed in on this device before: show the mail it kept right away, while Google confirms the sign-in.
  const known = rememberedAccount();
  if (known && (currentToken() || hadServerSession())) await showCached(known);
  try {
    await prepareAuth();
  } catch (e) {
    // Google's sign-in script can't load offline: keep the kept mail on screen until the connection is back.
    if (shownFrom && state.phase === 'ready' && !navigator.onLine) {
      window.addEventListener('online', () => location.reload(), { once: true });
      return;
    }
    return setState({ phase: 'signin', authError: e instanceof Error ? e.message : String(e) });
  }
  if (lastingSignIn()) {
    // Signed in on this device before: get a token from the server, no Google popup.
    if (currentToken()) renewFromServer().catch(() => undefined);
    else if (await renewFromServer().catch(() => false)) return start();
  }
  if (currentToken()) return start();
  // Offline with mail kept on this device: keep showing it, and sign in again once back online.
  if (shownFrom && state.phase === 'ready' && (!navigator.onLine || hasServerSession())) {
    window.addEventListener('online', () => renewFromServer().then((ok) => (ok ? start() : setState({ phase: 'signin' }))).catch(() => undefined), { once: true });
    return;
  }
  setState({ phase: 'signin' });
}

export async function signInClick(switchAccount = false) {
  setState({ authError: undefined });
  if (switchAccount) {
    await clearRowCache();
    sessionStorage.removeItem(PHOTO_CACHE);
    setState({ contactPhotos: {} });
  }
  try {
    await signIn({ switchAccount });
    if (state.phase === 'ready') {
      setState({ sessionExpired: false });
      refresh();
      return;
    }
    await start();
  } catch (e) {
    const m = e instanceof Error ? e.message : '';
    if (m !== 'superseded') setState({ authError: t('auth.failed') });
  }
}

export async function signOutClick() {
  await signOut().catch(() => undefined);
  await clearRowCache();
  sessionStorage.removeItem(PHOTO_CACHE);
  location.hash = '';
  location.reload();
}

/** The account whose kept mail is on screen (instant start), before Google has confirmed the sign-in. */
let shownFrom = '';

/** Instant start: the inbox (and open conversation) as they were last time, from this device's cache. */
async function showCached(account: string) {
  const warm = await loadRowCache(account);
  const r = parseHash();
  const key = r.view === 'mail' ? listHash(r) : '';
  const list = key ? snapRows(key) : undefined;
  if (r.view === 'mail' && !list) return;
  const m = warm.meta as { labels?: GLabel[]; counts?: Record<string, number>; sendAs?: GSendAs[]; user?: { name?: string; photo?: string }; piles?: Record<PileId, { labelId?: string; ids: string[] }> };
  const piles = { ...state.piles };
  for (const p of PILES) {
    const kept = m.piles?.[p];
    if (kept) piles[p] = { labelId: kept.labelId, rows: kept.ids.map((id) => rowCache.get(id)).filter((x): x is ThreadRow => !!x) };
  }
  shownFrom = account.toLowerCase();
  setState({
    phase: 'ready',
    me: account,
    route: r,
    labels: m.labels ?? [],
    counts: m.counts ?? {},
    sendAs: m.sendAs ?? [],
    meName: m.user?.name,
    mePhoto: m.user?.photo,
    piles,
    ...(list ? { list: { key, rows: byDate(list.rows), loading: false, page: 0, tokens: [undefined], next: list.snap.next, estimate: list.snap.estimate } } : {})
  });
  if (r.view === 'mail' && r.thread) openThread(r.thread, false, true);
}

async function start() {
  try {
    const p = await api.profile();
    if (!isAllowedAccount(p.emailAddress)) {
      signOut();
      setState({ phase: 'denied', deniedEmail: p.emailAddress });
      return;
    }
    if (!config.demo) rememberAccount(p.emailAddress);
    checkAccountOnServer(p.emailAddress);
    historyId = p.historyId;
    const warm = state.phase === 'ready' && shownFrom === p.emailAddress.toLowerCase();
    if (!warm) {
      // Another account's kept mail must not stay on screen.
      if (state.phase === 'ready') setState({ list: { key: '', rows: [], loading: true, page: 0, tokens: [undefined] }, labels: [], counts: {}, piles: { action: { rows: [] }, aside: { rows: [] } }, open: undefined });
      await loadRowCache(p.emailAddress);
    }
    shownFrom = '';
    setState({ phase: 'ready', me: p.emailAddress, route: parseHash(), sessionExpired: false });
    loadLabels().then(() => loadPiles());
    loadSendAs();
    loadUserInfo();
    loadContactPhotos();
    loadNotes();
    startSync(api);
    startStickies(api);
    watchForUpdates();
    // With the kept list on screen, refresh it quietly instead of showing a spinner.
    await loadList(true, warm && state.list.key === listHash(state.route as MailRoute));
    const r = state.route;
    if (r.view === 'mail' && r.thread) openThread(r.thread);
    startPolling();
  } catch (e) {
    if (e instanceof AuthRequired) setState({ phase: 'signin' });
    else setState({ phase: 'signin', authError: e instanceof Error ? e.message : String(e) });
  }
}

const ALLOWED_KEY = 'maillo.allowed';

/**
 * With maillo-config.php the browser doesn't know who is allowed, so it asks config.php once a day per
 * account, without holding up the inbox. Only an explicit "not allowed" signs out; Google still guards the mail.
 */
async function checkAccountOnServer(email: string) {
  if (!config.accountCheck || config.demo) return;
  const mark = `${email.toLowerCase()}|${new Date().toDateString()}`;
  if (localStorage.getItem(ALLOWED_KEY) === mark) return;
  try {
    const form = new FormData();
    form.set('action', 'check_account');
    form.set('token', currentToken() ?? '');
    const r = await fetch('./config.php', { method: 'POST', body: form, credentials: 'same-origin' });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (r.ok && j?.ok) localStorage.setItem(ALLOWED_KEY, mark);
    else if (j?.error === 'not_allowed') {
      localStorage.removeItem(ALLOWED_KEY);
      await clearRowCache();
      await signOut().catch(() => undefined);
      setState({ phase: 'denied', deniedEmail: email, open: undefined });
    }
  } catch {
    /* can't tell: carry on */
  }
}

// Optional: installs or sessions without the profile scope keep the initial.
// Kept for the browser session only, like the sign-in token, so a reload doesn't refetch every contact.
function readPhotoCache(): Record<string, string> {
  try {
    const c = JSON.parse(sessionStorage.getItem(PHOTO_CACHE) || 'null') as { at: number; photos: Record<string, string> } | null;
    return c && typeof c.photos === 'object' ? c.photos : {};
  } catch {
    return {};
  }
}

async function loadContactPhotos() {
  if (!config.features.contactPhotos) return;
  try {
    const c = JSON.parse(sessionStorage.getItem(PHOTO_CACHE) || 'null') as { at: number } | null;
    if (c && Date.now() - c.at < PHOTO_TTL) return;
  } catch {
    /* refetch */
  }
  try {
    const photos = await api.contactPhotos();
    setState({ contactPhotos: photos });
    try {
      sessionStorage.setItem(PHOTO_CACHE, JSON.stringify({ at: Date.now(), photos }));
    } catch {
      /* storage full: keep them in memory */
    }
  } catch {
    /* initials stay */
  }
}

async function loadUserInfo() {
  try {
    const u = await api.userInfo();
    if (u.picture && /^https:\/\//.test(u.picture)) setState({ mePhoto: u.picture });
    if (u.name?.trim()) setState({ meName: u.name.trim() });
    if (persist) saveMeta('user', { name: state.meName, photo: state.mePhoto });
  } catch {
    /* keep the initial */
  }
}

function onHash() {
  const prev = state.route;
  const next = parseHash();
  setState({ route: next, sidebarOpen: false, showKeys: false, sheet: undefined });
  if (state.phase !== 'ready' || next.view !== 'mail') return;
  if (prev.view !== 'mail' || listHash(prev) !== listHash(next)) {
    setState({ selected: new Set(), list: { ...state.list, page: 0, tokens: [undefined] } });
    loadList(true);
  }
  if (next.thread && next.thread !== state.open?.id) openThread(next.thread);
  if (!next.thread && state.open) setState({ open: undefined });
}

let pollTimer: number | undefined;
let historyId: string | undefined;
let mailVersion = 0;
let seenVersion = 0;
let lastCheck = 0;
let checking: Promise<number> | null = null;

/**
 * Asks Gmail whether anything changed since the last look (2 quota units, instead of reloading
 * the list, piles and counts). Returns a version number that goes up with each change; calls
 * within a few seconds of each other share one check.
 */
export function pollChanges(): Promise<number> {
  if (checking) return checking;
  if (Date.now() - lastCheck < 10_000) return Promise.resolve(mailVersion);
  checking = (async () => {
    try {
      if (!historyId) {
        historyId = (await api.profile()).historyId;
        mailVersion++;
      } else {
        const h = await api.history(historyId);
        if (h.changed) mailVersion++;
        historyId = h.historyId ?? (h.changed ? (await api.profile()).historyId : historyId);
      }
      lastCheck = Date.now();
    } catch (e) {
      if (e instanceof AuthRequired) throw e;
      // Can't tell: assume something changed so nothing is missed.
      mailVersion++;
    } finally {
      checking = null;
    }
    return mailVersion;
  })();
  return checking;
}

/** Looks for changes right away (a push said new mail arrived), skipping the usual few seconds between checks. */
export function checkNow() {
  lastCheck = 0;
  pollTick();
}

async function pollTick() {
  if (state.phase !== 'ready' || state.sessionExpired) return;
  try {
    const v = await pollChanges();
    if (v === seenVersion) return;
    seenVersion = v;
    refresh(true);
  } catch (e) {
    fail(e);
  }
}

function startPolling() {
  clearInterval(pollTimer);
  seenVersion = mailVersion;
  pollTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') pollTick();
  }, 45_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pollTick();
  });
  window.addEventListener('online', () => pollTick());
}

export async function loadLabels() {
  try {
    const labels = await api.listLabels();
    setState({ labels });
    if (persist) saveMeta('labels', labels);
    await loadCounts(labels);
  } catch (e) {
    fail(e);
  }
}

let countsTimer: number | undefined;
let countsWaiters: (() => void)[] = [];
let catAt = 0;
let catKey = '';

/** Label counts, coalesced: several calls in quick succession make one batched request. */
function loadCounts(labels?: GLabel[]): Promise<void> {
  return new Promise((resolve) => {
    countsWaiters.push(resolve);
    clearTimeout(countsTimer);
    countsTimer = window.setTimeout(async () => {
      const done = countsWaiters;
      countsWaiters = [];
      try {
        await loadCountsNow(labels ?? state.labels);
      } catch (e) {
        if (e instanceof AuthRequired) fail(e);
      }
      done.forEach((d) => d());
    }, 400);
  });
}

async function loadCountsNow(labels: GLabel[]) {
  const ids = ['INBOX', 'DRAFT', 'SPAM', ...labels.filter((l) => l.type === 'user').map((l) => l.id)];
  const details = await api.getLabels(ids);
  const counts: Record<string, number> = {};
  details.forEach((d) => {
    if (!d) return;
    counts[d.id] = d.id === 'DRAFT' ? d.threadsTotal ?? 0 : d.threadsUnread ?? 0;
  });
  setState({ counts });
  if (persist) saveMeta('counts', counts);
  const r = state.route;
  if (!getPrefs().tabs || r.view !== 'mail' || r.folder !== 'inbox' || r.q !== undefined) return;
  // The "N new" figures on the category tabs cost 10 units each, so refresh them at most once a minute unless mail changed.
  const key = `${mailVersion}:${counts.INBOX ?? 0}`;
  if (key === catKey && Date.now() - catAt < 60_000) return;
  catKey = key;
  catAt = Date.now();
  const est = await pool(CATEGORIES.filter((c) => c !== 'primary'), 4, (c) =>
    api.listThreads({ labelIds: ['INBOX', CATEGORY_LABEL[c], 'UNREAD'], maxResults: 1 }).then((x) => [c, x.resultSizeEstimate ?? 0] as const).catch(() => [c, 0] as const)
  );
  setState({ catNew: Object.fromEntries(est) });
}

async function loadSendAs() {
  try {
    const sendAs = await api.listSendAs();
    setState({ sendAs });
    if (persist) saveMeta('sendAs', sendAs);
  } catch {
    /* empty */
  }
}

export async function loadList(reset = false, silent = false) {
  const r = state.route;
  if (r.view !== 'mail') return;
  const key = listHash(r);
  const mine = ++listSeq;
  const page = reset ? 0 : state.list.page;
  const tokens = reset ? [undefined] : state.list.tokens;
  // Switching to a list seen before shows it as it was at once; the fresh one replaces it when it arrives.
  const snap = !silent && state.list.key !== key && page === 0 ? snapRows(key) : undefined;
  if (!silent) setState({ list: { ...state.list, key, loading: true, error: undefined, page, tokens, rows: state.list.key === key ? state.list.rows : snap ? byDate(snap.rows) : [] } });
  try {
    let res = await api.listThreads({ ...listParams(r, getPrefs().tabs), pageToken: tokens[page], maxResults: getPrefs().pageSize });
    // Mailboxes Gmail never sorted into categories have no Primary label: fall back to Gmail's search.
    if (!res.threads?.length && !page && getPrefs().tabs && r.q === undefined && !r.label && (r.folder ?? 'inbox') === 'inbox' && r.category === 'primary')
      res = await api.listThreads({ q: 'in:inbox category:primary', maxResults: getPrefs().pageSize });
    const ids = res.threads ?? [];
    // Show what's cached right away while the changed rows load.
    if (!silent && state.list.key !== key) {
      const cached = ids.map((x) => rowCache.get(x.id)).filter((x): x is ThreadRow => !!x);
      if (cached.length === ids.length && cached.length) setState({ list: { ...state.list, key, rows: byDate(cached) } });
    }
    const rows = byDate(await fetchRows(ids));
    if (mine !== listSeq) return;
    clearTimeout(retryTimer);
    const visible = new Set(rows.map((x) => x.id));
    const selected = new Set([...state.selected].filter((id) => visible.has(id)));
    const recent = collectRecent(rows);
    setState({ list: { key, rows, loading: false, page, tokens, next: res.nextPageToken, estimate: res.resultSizeEstimate }, selected, recent });
    if (page === 0 && !config.demo) saveListSnap(key, { ids: rows.map((x) => x.id), next: res.nextPageToken, estimate: res.resultSizeEstimate });
  } catch (e) {
    if (mine !== listSeq) return;
    if (e instanceof AuthRequired) return fail(e);
    const limited = e instanceof RateLimited;
    // Keep showing what's there when a background refresh hits Google's rate limit; try again shortly.
    if (limited) {
      clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => loadList(false, true), 30_000);
      if (state.list.key === key && state.list.rows.length) return setState({ list: { ...state.list, loading: false } });
    }
    setState({ list: { ...state.list, key, loading: false, error: limited ? t('list.rateLimited') : e instanceof Error ? e.message : String(e) } });
  }
}

let retryTimer: number | undefined;

/** Newest first, by the date each row shows (Gmail's order can differ when a thread has drafts or chats). */
function byDate(rows: ThreadRow[]): ThreadRow[] {
  return [...rows].sort((a, b) => b.date.getTime() - a.date.getTime());
}

function pileLabelName(p: PileId): string {
  return p === 'aside' ? config.setAsideLabel : config.actionLabel;
}

function setPile(p: PileId, pile: Pile) {
  setState((st) => ({ piles: { ...st.piles, [p]: pile } }));
}

function findPileLabel(p: PileId, labels = state.labels): string | undefined {
  const name = pileLabelName(p).toLowerCase();
  return labels.find((l) => l.type === 'user' && l.name.toLowerCase() === name)?.id;
}

async function loadPile(p: PileId) {
  const labelId = state.piles[p].labelId ?? findPileLabel(p);
  if (labelId?.startsWith('pending:')) return;
  if (!labelId) return setPile(p, { rows: [] });
  try {
    const res = await api.listThreads({ labelIds: [labelId], maxResults: 100 });
    const rows = await fetchRows(res.threads ?? []);
    setPile(p, { labelId, rows });
    if (persist) saveMeta('piles', Object.fromEntries(PILES.map((x) => [x, { labelId: state.piles[x].labelId, ids: state.piles[x].rows.map((r) => r.id) }])));
  } catch (e) {
    if (e instanceof AuthRequired) fail(e);
  }
}

export function loadPiles() {
  return Promise.all(PILES.map(loadPile));
}

async function ensurePileLabel(p: PileId): Promise<string> {
  const cur = state.piles[p].labelId;
  const known = (cur && !cur.startsWith('pending:') ? cur : undefined) ?? findPileLabel(p);
  if (known) return known;
  const l = await api.createLabel(pileLabelName(p));
  setState((st) => ({ labels: [...st.labels, l], piles: { ...st.piles, [p]: { ...st.piles[p], labelId: l.id } } }));
  return l.id;
}

/** Swaps a stand-in label id for the real one everywhere it's shown. */
function renameLocalLabel(from: string, to: string) {
  const fix = (r: ThreadRow) => (r.labelIds.includes(from) ? { ...r, labelIds: r.labelIds.map((l) => (l === from ? to : l)) } : r);
  const piles = { ...state.piles };
  for (const p of PILES) piles[p] = { ...piles[p], rows: piles[p].rows.map(fix) };
  const o = state.open;
  setState({
    piles,
    list: { ...state.list, rows: state.list.rows.map(fix) },
    open: o && o.labelIds.includes(from) ? { ...o, labelIds: o.labelIds.map((l) => (l === from ? to : l)) } : o
  });
  for (const [id, r] of rowCache) if (r.labelIds.includes(from)) rowCache.set(id, fix(r));
}

export function pileOf(labelIds: string[]): PileId | undefined {
  return PILES.find((p) => {
    const id = state.piles[p].labelId;
    return !!id && labelIds.includes(id);
  });
}

export function pileLabelIds(): string[] {
  return PILES.map((p) => state.piles[p].labelId).filter((x): x is string => !!x);
}

export async function loadNotes() {
  if (!notesEnabled) return;
  try {
    setState({ notes: await api.loadNotes() });
  } catch (e) {
    if (e instanceof AuthRequired) return fail(e);
    toast(t('note.loadFailed'));
  }
}

let noteQueue: Promise<void> = Promise.resolve();

// Re-reads the file before writing so a note saved on another device isn't overwritten.
export function setNote(threadId: string, text: string, opts: { undo?: boolean } = {}) {
  const prev = state.notes[threadId];
  const clean = text.replace(/\s+$/, '');
  const notes = { ...state.notes };
  if (clean.trim()) notes[threadId] = { text: clean, updated: Date.now() };
  else delete notes[threadId];
  setState({ notes, noteEditing: undefined });
  const entry = notes[threadId];
  noteQueue = noteQueue.then(async () => {
    try {
      const remote = await api.loadNotes();
      if (entry) remote[threadId] = entry;
      else delete remote[threadId];
      await api.saveNotes(remote);
      setState({ notes: { ...remote } });
      if (!entry && prev && opts.undo !== false)
        toast(t('note.deleted'), { action: { label: t('toast.undo'), run: () => setNote(threadId, prev.text, { undo: false }) } });
    } catch (e) {
      if (e instanceof AuthRequired) return fail(e);
      toast(t('note.saveFailed'));
      const back = { ...state.notes };
      if (prev) back[threadId] = prev;
      else delete back[threadId];
      setState({ notes: back });
    }
  });
}

function collectRecent(rows: ThreadRow[]): Address[] {
  const map = new Map(state.recent.map((a) => [a.email.toLowerCase(), a]));
  for (const r of rows) for (const a of [r.firstFrom, r.lastFrom, ...r.recipients]) {
    if (a.email && a.email.toLowerCase() !== state.me.toLowerCase() && !/no-?reply/i.test(a.email)) map.set(a.email.toLowerCase(), a);
  }
  return [...map.values()].slice(-400);
}

export function nextPage() {
  if (!state.list.next) return;
  const tokens = [...state.list.tokens];
  tokens[state.list.page + 1] = state.list.next;
  setState({ list: { ...state.list, tokens, page: state.list.page + 1 } });
  loadList();
}

export function prevPage() {
  if (state.list.page === 0) return;
  setState({ list: { ...state.list, page: state.list.page - 1 } });
  loadList();
}

export function refresh(silent = false) {
  seenVersion = mailVersion;
  loadList(false, silent);
  loadPiles();
  loadCounts().catch(() => undefined);
  if (state.open && !silent) openThread(state.open.id, true);
}

function openFrom(id: string, th: GThread): OpenThread {
  const messages = (th.messages ?? []).map(parseMessage);
  return { id, loading: false, messages, labelIds: [...new Set(messages.flatMap((m) => m.labelIds))] };
}

/**
 * Opens a conversation. A copy kept on this device shows at once; when it's as new as the list says
 * (same history id), Google isn't asked again. Offline, the kept copy stays on screen.
 */
export async function openThread(id: string, quiet = false, cacheOnly = false) {
  const mine = ++openSeq;
  const row = state.list.rows.find((x) => x.id === id) ?? rowCache.get(id);
  if (!quiet) setState({ open: { id, loading: true, messages: [], labelIds: [] }, focusId: id });
  const cached = quiet ? undefined : await cachedThread(id);
  if (mine !== openSeq) return;
  if (cached) setState({ open: openFrom(id, cached) });
  const fresh = !!cached && !!row?.historyId && cached.historyId === row.historyId;
  if (cacheOnly || fresh) {
    if (fresh) {
      markOpenedRead(id, cached!);
      prefetchAround(id);
    }
    return;
  }
  try {
    const th = await api.getThread(id, 'full');
    if (mine !== openSeq) return;
    putThread(th);
    setState({ open: openFrom(id, th) });
    markOpenedRead(id, th);
    prefetchAround(id);
  } catch (e) {
    if (mine !== openSeq) return;
    if (e instanceof AuthRequired) return fail(e);
    if (cached) return;
    setState({ open: { id, loading: false, messages: [], labelIds: [], error: e instanceof Error ? e.message : String(e) } });
  }
}

function markOpenedRead(id: string, th: GThread) {
  const labelIds = [...new Set((th.messages ?? []).flatMap((m) => m.labelIds ?? []))];
  if (labelIds.includes('UNREAD')) {
    const snap = snapshot([id]);
    applyLocal([id], { add: [], remove: ['UNREAD'] }, false);
    api.modifyThread(id, [], ['UNREAD']).then(() => loadCounts()).catch((e) => rollback(snap, e));
    // The kept copy reads as read too (it's refreshed next time, its history id having moved on).
    putThread({ ...th, messages: th.messages?.map((m) => ({ ...m, labelIds: m.labelIds?.filter((l) => l !== 'UNREAD') })) });
  }
}

let prefetchTimer: number | undefined;

/**
 * Fetches the conversations either side of the open one, so the ribbon arrows (and j/k) open them at once.
 * Only while online and visible, and only when the minute's Gmail quota has plenty of room (20 units at most).
 */
function prefetchAround(id: string) {
  clearTimeout(prefetchTimer);
  prefetchTimer = window.setTimeout(async () => {
    const rows = state.list.rows;
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0 || state.open?.id !== id) return;
    for (const n of [rows[i + 1], rows[i - 1]]) {
      if (!n || !navigator.onLine || document.visibilityState !== 'visible' || quotaHeadroom() < 0.5 || state.open?.id !== id) return;
      const c = await cachedThread(n.id);
      if (c && n.historyId && c.historyId === n.historyId) continue;
      try {
        putThread(await api.getThread(n.id, 'full'));
      } catch {
        return;
      }
    }
  }, 500);
}

export function openRow(id: string) {
  const r = state.route;
  if (r.view !== 'mail') return;
  const row = state.list.rows.find((x) => x.id === id);
  const draftOnly = row && row.hasDraft && row.count <= 1 && !row.labelIds.some((l) => ['INBOX', 'SENT', 'SPAM', 'TRASH'].includes(l));
  if (draftOnly) {
    openDraft(id);
    return;
  }
  go(threadHash(r, id));
}

export function closeThread() {
  const r = state.route;
  if (r.view === 'mail') go(listHash(r));
}

function dropRows(ids: string[]) {
  const set = new Set(ids);
  const rows = state.list.rows;
  const idx = rows.findIndex((r) => set.has(r.id));
  const remaining = rows.filter((r) => !set.has(r.id));
  const selected = new Set([...state.selected].filter((x) => !set.has(x)));
  const emptied = rows.length > 0 && remaining.length === 0 && !state.list.next && state.list.page === 0;
  setState({ list: { ...state.list, rows: remaining }, selected, ...(emptied ? { celebrate: state.list.key } : {}) });
  if (state.open && set.has(state.open.id)) {
    const nextRow = remaining[Math.min(idx, remaining.length - 1)];
    const r = state.route as MailRoute;
    if (getPrefs().pane === 'right' && nextRow) go(threadHash(r, nextRow.id), true);
    else go(listHash(r), true);
  }
}

type LabelOp = { add: string[]; remove: string[] };
type Op = LabelOp | 'trash' | 'untrash';

function opLabels(op: Op): LabelOp {
  if (op === 'trash') return { add: ['TRASH'], remove: [] };
  if (op === 'untrash') return { add: [], remove: ['TRASH'] };
  return op;
}

/** A row with labels added and removed, and the flags that follow from them. */
function withLabels(r: ThreadRow, add: string[], remove: string[]): ThreadRow {
  const labelIds = [...new Set([...r.labelIds.filter((l) => !remove.includes(l)), ...add])];
  return { ...r, labelIds, unread: labelIds.includes('UNREAD'), starred: labelIds.includes('STARRED'), important: labelIds.includes('IMPORTANT') };
}

/** What the affected conversations looked like before a change, so it can be put back exactly. */
interface Snapshot {
  listKey: string;
  rows: Map<string, ThreadRow>;
  inList: Set<string>;
  piles: Record<PileId, Set<string>>;
  open?: { id: string; labelIds: string[] };
  counts: Record<string, number>;
}

function knownRow(id: string): ThreadRow | undefined {
  return state.list.rows.find((x) => x.id === id) ?? PILES.flatMap((p) => state.piles[p].rows).find((x) => x.id === id) ?? rowCache.get(id);
}

function snapshot(ids: string[]): Snapshot {
  const rows = new Map<string, ThreadRow>();
  for (const id of ids) {
    const r = knownRow(id);
    if (r) rows.set(id, r);
  }
  const set = new Set(ids);
  return {
    listKey: state.list.key,
    rows,
    inList: new Set(state.list.rows.filter((r) => set.has(r.id)).map((r) => r.id)),
    piles: Object.fromEntries(PILES.map((p) => [p, new Set(state.piles[p].rows.filter((r) => set.has(r.id)).map((r) => r.id))])) as Record<PileId, Set<string>>,
    open: state.open && set.has(state.open.id) ? { id: state.open.id, labelIds: state.open.labelIds } : undefined,
    counts: state.counts
  };
}

// Unread figures beside folders and labels, moved by hand until Gmail's own come back.
function adjustCounts(before: ThreadRow[], after: ThreadRow[]): Record<string, number> {
  const counts = { ...state.counts };
  const live = (r: ThreadRow, l: string) => r.unread && r.labelIds.includes(l) && !r.labelIds.includes('TRASH') && !r.labelIds.includes('SPAM');
  for (let i = 0; i < before.length; i++) {
    for (const l of Object.keys(counts)) {
      if (l === 'DRAFT' || l === 'SPAM') continue;
      const d = Number(live(after[i], l)) - Number(live(before[i], l));
      if (d) counts[l] = Math.max(0, (counts[l] ?? 0) + d);
    }
  }
  return counts;
}

/** Shows a change right away: the list, the piles, the open conversation and the counts. */
function applyLocal(ids: string[], op: Op, drop: boolean) {
  const { add, remove } = opLabels(op);
  const set = new Set(ids);
  const before = ids.map(knownRow).filter((r): r is ThreadRow => !!r);
  const after = before.map((r) => withLabels(r, add, remove));
  const changed = new Map(after.map((r) => [r.id, r]));
  for (const r of after) rowCache.set(r.id, { ...r, historyId: undefined });
  const gone = add.includes('TRASH') || add.includes('SPAM');
  const piles = { ...state.piles };
  for (const p of PILES) {
    const labelId = piles[p].labelId;
    let rows = piles[p].rows.map((r) => changed.get(r.id) ?? r);
    if (labelId && (remove.includes(labelId) || gone)) rows = rows.filter((r) => !set.has(r.id));
    if (labelId && add.includes(labelId) && !gone) {
      const present = new Set(rows.map((r) => r.id));
      rows = [...after.filter((r) => !present.has(r.id)), ...rows];
    }
    piles[p] = { ...piles[p], rows };
  }
  const o = state.open;
  const open = o && set.has(o.id) ? { ...o, labelIds: [...new Set([...o.labelIds.filter((l) => !remove.includes(l)), ...add])] } : o;
  setState({ piles, open, counts: adjustCounts(before, after) });
  if (drop) dropRows(ids);
  else setState({ list: { ...state.list, rows: state.list.rows.map((r) => changed.get(r.id) ?? r) } });
}

/** Puts the affected conversations back as they were, leaving everything else alone. */
function restore(snap: Snapshot) {
  const ids = new Set(snap.rows.keys());
  for (const r of snap.rows.values()) rowCache.set(r.id, { ...r, historyId: undefined });
  const piles = { ...state.piles };
  for (const p of PILES) {
    const back = [...snap.piles[p]].map((id) => snap.rows.get(id)).filter((r): r is ThreadRow => !!r);
    piles[p] = { ...piles[p], rows: byDate([...piles[p].rows.filter((r) => !ids.has(r.id)), ...back]) };
  }
  const patch: Partial<AppState> = { piles, counts: snap.counts };
  if (state.list.key === snap.listKey) {
    const back = [...snap.inList].map((id) => snap.rows.get(id)).filter((r): r is ThreadRow => !!r);
    patch.list = { ...state.list, rows: byDate([...state.list.rows.filter((r) => !ids.has(r.id)), ...back]) };
  }
  if (snap.open && state.open?.id === snap.open.id) patch.open = { ...state.open, labelIds: snap.open.labelIds };
  setState(patch);
}

async function applyOp(ids: string[], op: Op) {
  await pool(ids, 6, (id) =>
    op === 'trash' ? api.trashThread(id) : op === 'untrash' ? api.untrashThread(id) : api.modifyThread(id, op.add, op.remove)
  );
}

/** For each conversation, the change that gives it back exactly the labels it had. */
function inverseOps(snap: Snapshot, ids: string[], op: Op): [string, Op][] {
  if (op === 'trash') return ids.map((id) => [id, 'untrash']);
  if (op === 'untrash') return ids.map((id) => [id, 'trash']);
  return ids.map((id) => {
    const had = snap.rows.get(id)?.labelIds;
    if (!had) return [id, { add: op.remove, remove: op.add }];
    return [id, { add: op.remove.filter((l) => had.includes(l)), remove: op.add.filter((l) => !had.includes(l)) }];
  });
}

/** Google refused a change: quietly put things back and say so. */
function rollback(snap: Snapshot, e: unknown) {
  restore(snap);
  if (e instanceof AuthRequired) return fail(e);
  toast(e instanceof RateLimited ? t('list.rateLimited') : t('toast.rolledBack'));
  refresh(true);
}

async function run(ids: string[], op: Op, opts: { drop: boolean; message?: string }) {
  if (!ids.length) return;
  const snap = snapshot(ids);
  applyLocal(ids, op, opts.drop);
  try {
    await applyOp(ids, op);
  } catch (e) {
    return rollback(snap, e);
  }
  if (opts.message)
    toast(opts.message, {
      action: {
        label: t('toast.undo'),
        run: () => {
          // Undo shows at once too; Google catches up behind it.
          const redo = snapshot(ids);
          restore(snap);
          pool(inverseOps(snap, ids, op), 6, ([id, inv]) =>
            inv === 'trash' ? api.trashThread(id) : inv === 'untrash' ? api.untrashThread(id) : api.modifyThread(id, inv.add, inv.remove)
          )
            .then(() => loadCounts())
            .catch((e) => rollback(redo, e));
        }
      }
    });
  loadCounts().catch(() => undefined);
}

function currentFolder(): string | undefined {
  const r = state.route;
  return r.view === 'mail' ? r.folder : undefined;
}

export const actions = {
  archive(ids: string[]) {
    const f = currentFolder();
    run(ids, { add: [], remove: ['INBOX'] }, { drop: f === 'inbox' || !!(state.route as MailRoute).label || f === undefined, message: t('toast.archived', { n: ids.length }) });
  },
  moveToInbox(ids: string[]) {
    run(ids, { add: ['INBOX'], remove: ['SPAM'] }, { drop: currentFolder() === 'spam', message: t('toast.restored') });
  },
  trash(ids: string[]) {
    if (currentFolder() === 'trash') return;
    run(ids, 'trash', { drop: true, message: t('toast.trashed', { n: ids.length }) });
  },
  restore(ids: string[]) {
    run(ids, 'untrash', { drop: true, message: t('toast.restored') });
  },
  spam(ids: string[]) {
    run(ids, { add: ['SPAM'], remove: ['INBOX'] }, { drop: true, message: t('toast.spam', { n: ids.length }) });
  },
  notSpam(ids: string[]) {
    run(ids, { add: ['INBOX'], remove: ['SPAM'] }, { drop: true, message: t('toast.notSpam') });
  },
  read(ids: string[], read: boolean) {
    run(ids, read ? { add: [], remove: ['UNREAD'] } : { add: ['UNREAD'], remove: [] }, { drop: false });
    if (!read && state.open && ids.includes(state.open.id)) closeThread();
  },
  star(ids: string[], on: boolean) {
    run(ids, on ? { add: ['STARRED'], remove: [] } : { add: [], remove: ['STARRED'] }, { drop: !on && currentFolder() === 'starred' });
  },
  important(ids: string[], on: boolean) {
    run(ids, on ? { add: ['IMPORTANT'], remove: [] } : { add: [], remove: ['IMPORTANT'] }, { drop: !on && currentFolder() === 'important' });
  },
  label(ids: string[], add: string[], remove: string[]) {
    const r = state.route as MailRoute;
    run(ids, { add, remove }, { drop: !!r.label && remove.includes(r.label), message: t('toast.labelled') });
  },
  // Inbox categories are exclusive: moving to one takes the others off.
  moveCategory(ids: string[], c: Category) {
    const add = CATEGORY_LABEL[c];
    const remove = Object.values(CATEGORY_LABEL).filter((x) => x !== add);
    const r = state.route as MailRoute;
    run(ids, { add: [add], remove }, { drop: r.category !== c, message: t('toast.moved', { name: t(`cat.${c}` as StringKey) }) });
  },
  moveTo(ids: string[], labelId: string) {
    const l = state.labels.find((x) => x.id === labelId);
    const r = state.route as MailRoute;
    const remove = r.label && r.label !== labelId ? [r.label, 'INBOX'] : ['INBOX'];
    run(ids, { add: [labelId], remove }, { drop: true, message: t('toast.moved', { name: l ? l.name : labelId }) });
  },
  // Piles are exclusive: moving a conversation to one pile takes it out of the other.
  async pin(p: PileId, ids: string[]) {
    if (!ids.length) return;
    const f = currentFolder();
    const r = state.route as MailRoute;
    const others = PILES.filter((x) => x !== p).map((x) => state.piles[x].labelId).filter((x): x is string => !!x);
    const known = state.piles[p].labelId ?? findPileLabel(p);
    const drop = (labelId: string) => f === 'inbox' || (!!r.label && r.label !== labelId) || f === undefined;
    const message = t(p === 'aside' ? 'toast.pin.aside' : 'toast.pin.action', { n: ids.length });
    if (known) {
      if (!state.piles[p].labelId) setPile(p, { ...state.piles[p], labelId: known });
      await run(ids, { add: [known], remove: ['INBOX', ...others] }, { drop: drop(known), message });
      loadPiles();
      return;
    }
    // First use: the pile's label doesn't exist yet. Show the move now under a stand-in label, then swap in the real one.
    const temp = `pending:${p}`;
    const snap = snapshot(ids);
    setPile(p, { ...state.piles[p], labelId: temp });
    applyLocal(ids, { add: [temp], remove: ['INBOX', ...others] }, drop(temp));
    let labelId: string;
    try {
      labelId = await ensurePileLabel(p);
    } catch (e) {
      setPile(p, { ...state.piles[p], labelId: undefined });
      return rollback(snap, e);
    }
    renameLocalLabel(temp, labelId);
    setPile(p, { ...state.piles[p], labelId });
    try {
      await applyOp(ids, { add: [labelId], remove: ['INBOX', ...others] });
    } catch (e) {
      return rollback(snap, e);
    }
    toast(message);
    loadCounts().catch(() => undefined);
    loadPiles();
  },
  async unpin(ids: string[], toInbox: boolean) {
    const labels = pileLabelIds();
    if (!labels.length || !ids.length) return;
    const r = state.route as MailRoute;
    const back = toInbox && currentFolder() === 'inbox';
    await run(ids, { add: toInbox ? ['INBOX'] : [], remove: labels }, {
      drop: (!!r.label && labels.includes(r.label)) || (toInbox ? false : currentFolder() === 'inbox'),
      message: toInbox ? t('toast.backToInbox') : t('toast.asideDone')
    });
    // Back in the Inbox: show it there at once, then let the list catch up.
    if (back) {
      const rows = ids.map((id) => rowCache.get(id)).filter((x): x is ThreadRow => !!x && !state.list.rows.some((y) => y.id === x.id));
      if (rows.length) setState({ list: { ...state.list, rows: byDate([...state.list.rows, ...rows]) } });
    }
    loadPiles();
    if (back) loadList(false, true);
  },
  async addTask(id: string) {
    const row = state.list.rows.find((r) => r.id === id);
    const subject = row?.subject || state.open?.messages[0]?.subject || '';
    try {
      await api.addTask(subject || t('list.noSubject'), config.demo ? undefined : `https://mail.google.com/mail/u/0/#all/${id}`);
      toast(t('toast.taskAdded'));
      setState({ panel: 'tasks' });
    } catch (e) {
      fail(e);
    }
  }
};

export function toggleSelect(id: string, on?: boolean) {
  const s = new Set(state.selected);
  if (on ?? !s.has(id)) s.add(id);
  else s.delete(id);
  setState({ selected: s });
}

export function selectAll(on: boolean) {
  setState({ selected: on ? new Set(state.list.rows.map((r) => r.id)) : new Set() });
}

export function targetIds(): string[] {
  if (state.selected.size) return [...state.selected];
  const id = state.open?.id ?? state.focusId;
  return id ? [id] : [];
}

let composeSeq = 1;

function defaultFrom(): string {
  return (state.sendAs.find((s) => s.isDefault) ?? state.sendAs[0])?.sendAsEmail ?? state.me;
}

function signatureFor(email: string): string {
  const inner = signatureHtml(email);
  return inner ? `<br><div class="mm-signature">${inner}</div>` : '';
}

/** The signature of one send-as address, ready to go inside the compose signature block ('' when it has none). */
export function signatureHtml(email: string): string {
  const sig = state.sendAs.find((s) => s.sendAsEmail === email)?.signature;
  return sig ? signatureBlock(sig) : '';
}

/** The signature, with Gmail's "-- " separator line unless turned off in Settings. */
export function signatureBlock(sig: string): string {
  return getPrefs().signatureDash ? `-- <br>${sig}` : sig;
}

function quoteHtml(m: ParsedMessage): string {
  const body = m.html || textToHtml(m.text);
  const who = escapeHtml(formatAddress(m.from));
  return `<div class="gmail_quote"><div>${escapeHtml(t('compose.wrote', { date: fullDate(m.date), from: '' }).replace(/,\s*$/, ''))} ${who}</div><blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${body}</blockquote></div>`;
}

function forwardHtml(m: ParsedMessage): string {
  const rows = [
    `${t('compose.from')}: ${escapeHtml(formatAddress(m.from))}`,
    `Date: ${escapeHtml(fullDate(m.date))}`,
    `${t('compose.subject')}: ${escapeHtml(m.subject)}`,
    `${t('compose.to')}: ${escapeHtml(m.to.map(formatAddress).join(', '))}`,
    m.cc.length ? `${t('compose.cc')}: ${escapeHtml(m.cc.map(formatAddress).join(', '))}` : ''
  ].filter(Boolean);
  return `<div class="gmail_quote"><div>${t('compose.forwarded')}<br>${rows.join('<br>')}</div><br>${m.html || textToHtml(m.text)}</div>`;
}

export function openCompose(mode: ComposeMode = 'new', msg?: ParsedMessage, preset?: Partial<ComposeState>) {
  const me = state.me.toLowerCase();
  const own = new Set([me, ...state.sendAs.map((s) => s.sendAsEmail.toLowerCase())]);
  const from = msg ? state.sendAs.find((s) => [...msg.to, ...msg.cc].some((a) => a.email.toLowerCase() === s.sendAsEmail.toLowerCase()))?.sendAsEmail ?? defaultFrom() : defaultFrom();
  const c: ComposeState = {
    key: composeSeq++,
    mode,
    from,
    to: [],
    cc: [],
    bcc: [],
    showCc: false,
    subject: '',
    html: `<div><br></div>${signatureFor(from)}`,
    quoted: '',
    attachments: [],
    minimized: false,
    maximized: false,
    status: 'idle',
    ...preset
  };
  if (msg) {
    const fromMe = own.has(msg.from.email.toLowerCase());
    const base = stripSubjectPrefix(msg.subject);
    c.threadId = msg.threadId;
    if (mode === 'reply' || mode === 'replyAll') {
      c.to = fromMe ? msg.to : msg.replyTo.length ? msg.replyTo : [msg.from];
      if (mode === 'replyAll') {
        const seen = new Set([...own, ...c.to.map((a) => a.email.toLowerCase())]);
        const rest = [...(fromMe ? [] : msg.to), ...msg.cc].filter((a) => {
          const k = a.email.toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        c.cc = rest;
        c.showCc = rest.length > 0;
      }
      c.subject = /^re:/i.test(msg.subject) ? msg.subject : `Re: ${base}`;
      c.inReplyTo = msg.messageId;
      c.references = [msg.references, msg.messageId].filter(Boolean).join(' ');
      c.quoted = quoteHtml(msg);
    } else if (mode === 'forward') {
      c.subject = `Fwd: ${base}`;
      c.quoted = forwardHtml(msg);
      c.threadId = undefined;
      c.attachments = msg.attachments
        .filter((a) => !a.inline)
        .map((a, i) => ({ id: `fw${i}`, filename: a.filename, mimeType: a.mimeType, base64: '', size: a.size, loading: true }));
      const key = c.key;
      msg.attachments.filter((a) => !a.inline).forEach(async (a, i) => {
        try {
          const data = a.inlineData ?? (a.attachmentId ? await api.getAttachment(a.messageId, a.attachmentId) : '');
          const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
          const cur = state.compose;
          if (!cur || cur.key !== key) return;
          setState({ compose: { ...cur, attachments: cur.attachments.map((x) => (x.id === `fw${i}` ? { ...x, base64: b64, loading: false } : x)) } });
        } catch (e) {
          fail(e);
        }
      });
    }
  }
  setState({ compose: c });
}

export async function openDraft(threadId: string) {
  try {
    const drafts = await api.listDrafts();
    const d = drafts.find((x) => x.message.threadId === threadId);
    if (!d) return go(threadHash(state.route as MailRoute, threadId));
    const full = await api.getDraft(d.id);
    const m = parseMessage(full.message);
    const thread = await api.getThread(threadId, 'metadata');
    const isReply = (thread.messages?.length ?? 1) > 1;
    openCompose('draft', undefined, {
      draftId: d.id,
      threadId: isReply ? threadId : undefined,
      from: m.from.email || defaultFrom(),
      to: m.to,
      cc: m.cc,
      bcc: m.bcc,
      showCc: m.cc.length + m.bcc.length > 0,
      subject: m.subject,
      html: m.html || textToHtml(m.text),
      inReplyTo: undefined,
      references: m.references || undefined,
      attachments: [],
      status: 'saved'
    });
  } catch (e) {
    fail(e);
  }
}

export function updateCompose(patch: Partial<ComposeState>) {
  if (!state.compose) return;
  setState({ compose: { ...state.compose, ...patch } });
}

function outgoing(c: ComposeState) {
  const sa = state.sendAs.find((s) => s.sendAsEmail === c.from);
  const html = `<div dir="auto">${c.html}${c.quoted ? `<br>${c.quoted}` : ''}</div>`;
  return buildMime({
    // Like Gmail: without a name set on the address, send under the account's own name.
    from: { name: sa?.displayName || state.meName || '', email: c.from },
    to: c.to,
    cc: c.cc,
    bcc: c.bcc,
    subject: c.subject,
    html,
    inReplyTo: c.inReplyTo,
    references: c.references,
    attachments: c.attachments.filter((a) => !a.loading)
  });
}

function hasContent(c: ComposeState): boolean {
  const text = c.html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  const sig = signatureFor(c.from).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  return !!(c.to.length || c.cc.length || c.bcc.length || c.subject.trim() || c.attachments.length || (text && text !== sig));
}

let saving: Promise<void> | null = null;

export async function saveDraft(): Promise<void> {
  const c = state.compose;
  if (!c || !hasContent(c)) return;
  if (saving) await saving;
  const cur = state.compose;
  if (!cur) return;
  const raw = strToB64url(outgoing(cur));
  updateCompose({ status: 'saving' });
  saving = (async () => {
    try {
      const d = cur.draftId ? await api.updateDraft(cur.draftId, raw, cur.threadId) : await api.createDraft(raw, cur.threadId);
      if (state.compose?.key === cur.key) updateCompose({ draftId: d.id, status: 'saved' });
    } catch (e) {
      if (state.compose?.key === cur.key) updateCompose({ status: 'error' });
      if (e instanceof AuthRequired) fail(e);
    } finally {
      saving = null;
    }
  })();
  return saving;
}

export async function closeCompose() {
  const c = state.compose;
  if (!c) return;
  await saveDraft();
  if (state.compose?.key === c.key) setState({ compose: undefined });
  if (c.draftId || state.compose?.draftId) refresh(true);
}

export async function discardCompose() {
  const c = state.compose;
  if (!c) return;
  setState({ compose: undefined });
  if (saving) await saving;
  const id = c.draftId;
  if (id) {
    try {
      await api.deleteDraft(id);
      toast(t('toast.draftDiscarded'));
      refresh(true);
    } catch (e) {
      fail(e);
    }
  }
}

export async function sendCompose() {
  const c = state.compose;
  if (!c) return;
  if (!c.to.length && !c.cc.length && !c.bcc.length) {
    toast(t('compose.noRecipients'));
    return;
  }
  const total = c.attachments.reduce((n, a) => n + a.size, 0);
  if (total > 25 * 1024 * 1024) {
    toast(t('compose.tooLarge'));
    return;
  }
  setState({ compose: undefined });
  let cancelled = false;
  const delay = Math.max(0, getPrefs().undoSeconds) * 1000;
  const tid = toast(t('toast.sending'), {
    timeout: delay || 30000,
    progress: true,
    action: delay
      ? {
          label: t('toast.undo'),
          run: () => {
            cancelled = true;
            setState({ compose: { ...c, minimized: false } });
          }
        }
      : undefined
  });
  if (delay) await new Promise((r) => setTimeout(r, delay));
  if (cancelled) return;
  dismissToast(tid);
  const sendingId = toast(t('toast.sending'), { timeout: 30000, progress: true });
  try {
    if (saving) await saving;
    const draftId = c.draftId ?? state.compose?.draftId;
    const raw = strToB64url(outgoing(c));
    let sent;
    if (draftId) {
      await api.updateDraft(draftId, raw, c.threadId);
      sent = await api.sendDraft(draftId);
    } else sent = await api.send(raw, c.threadId);
    dismissToast(sendingId);
    const r = state.route;
    toast(t('toast.sent'), {
      action: sent?.threadId && r.view === 'mail' ? { label: t('toast.view'), run: () => go(threadHash({ view: 'mail', folder: 'sent', category: 'primary' }, sent!.threadId)) } : undefined
    });
    refresh(true);
    if (state.open && c.threadId === state.open.id) openThread(state.open.id, true);
  } catch (e) {
    dismissToast(sendingId);
    setState({ compose: { ...c, minimized: false } });
    if (e instanceof AuthRequired) fail(e);
    else toast(t('toast.sendFailed'));
  }
}

/** A person's display name; your own addresses use their send-as name or your Google account name. */
export function personName(a: Address): string {
  if (a.name) return a.name;
  const e = a.email.toLowerCase();
  const own = state.sendAs.find((x) => x.sendAsEmail.toLowerCase() === e);
  if (own || e === state.me.toLowerCase()) return own?.displayName || state.meName || displayName(a);
  return displayName(a);
}

export function senderName(a: Address) {
  return a.email.toLowerCase() === state.me.toLowerCase() ? t('list.me') : displayName(a);
}

function quickHtml(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => `<div>${l.trim() ? escapeHtml(l) : '<br>'}</div>`)
    .join('');
}

/** People a reply-all would also reach, besides the one Reply goes to (never yourself). */
export function replyAllExtras(msg: ParsedMessage): Address[] {
  const own = new Set([state.me.toLowerCase(), ...state.sendAs.map((s) => s.sendAsEmail.toLowerCase())]);
  const fromMe = own.has(msg.from.email.toLowerCase());
  const main = fromMe ? msg.to : msg.replyTo.length ? msg.replyTo : [msg.from];
  const seen = new Set([...own, ...main.map((a) => a.email.toLowerCase())]);
  return [...(fromMe ? [] : msg.to), ...msg.cc].filter((a) => {
    const k = a.email.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Reply or Reply all, following the setting; plain Reply when there's nobody else to include. */
export function defaultReplyMode(msg: ParsedMessage): 'reply' | 'replyAll' {
  return getPrefs().replyDefault === 'replyAll' && replyAllExtras(msg).length ? 'replyAll' : 'reply';
}

export async function quickReply(msg: ParsedMessage, text: string): Promise<void> {
  if (state.compose) await closeCompose();
  openCompose(defaultReplyMode(msg), msg);
  const c = state.compose;
  if (!c) return;
  setState({ compose: { ...c, html: `${quickHtml(text)}${signatureFor(c.from)}`, minimized: true } });
  await sendCompose();
}

export async function expandQuickReply(msg: ParsedMessage, text: string): Promise<void> {
  if (state.compose) await closeCompose();
  openCompose(defaultReplyMode(msg), msg);
  const c = state.compose;
  if (!c) return;
  setState({ compose: { ...c, html: `${quickHtml(text)}<div><br></div>${signatureFor(c.from)}` } });
}

let updateTimer: ReturnType<typeof setInterval> | undefined;

/** Checks for a newer release shortly after start, then every 6 hours while Maillo stays open. */
function watchForUpdates() {
  if (config.demo || updateTimer) return;
  const run = () => checkForUpdate().then(applyUpdateCheck);
  setTimeout(run, 8000);
  updateTimer = setInterval(run, 6 * 3600_000);
}

export function applyUpdateCheck(r: Awaited<ReturnType<typeof checkForUpdate>>) {
  if (!r.ok) return;
  setState({ update: r.available && r.latest ? { version: r.latest, url: r.url ?? '', canInstall: !!r.canInstall } : undefined });
}
