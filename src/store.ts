import { useEffect, useState } from 'preact/hooks';
import { config, isAllowedAccount } from './config';
import { currentToken, onAuthChange, prepareAuth, rememberAccount, signIn, signOut, tokenExpiresSoon } from './auth';
import { AuthRequired, gmailBackend, pool } from './gmail/api';
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
import type { GLabel, GSendAs, MailBackend, NotesMap } from './gmail/types';
import { t } from './i18n';
import { listParams, rowFromThread, stripSubjectPrefix, fullDate, type ThreadRow } from './model';
import { getPrefs, onPrefs, setPrefs, type PanelId } from './prefs';
import type { DragKind } from './dnd';
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
  sendAs: GSendAs[];
  showKeys: boolean;
  sidebarOpen: boolean;
  recent: Address[];
  piles: Record<PileId, Pile>;
  notes: NotesMap;
  noteEditing?: string;
  /** What is being dragged, so drop targets can show themselves. */
  dragging?: DragKind;
}

let state: AppState = {
  phase: 'boot',
  sessionExpired: false,
  me: '',
  panel: getPrefs().panel || undefined,
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

const rowCache = new Map<string, ThreadRow>();
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
  onAuthChange(() => {
    if (!config.demo && state.phase === 'ready' && !currentToken()) setState({ sessionExpired: true });
  });
  if (config.demo) return start();
  if (!config.googleClientId) return setState({ phase: 'signin' });
  try {
    await prepareAuth();
  } catch (e) {
    return setState({ phase: 'signin', authError: e instanceof Error ? e.message : String(e) });
  }
  if (currentToken()) return start();
  setState({ phase: 'signin' });
}

export async function signInClick(switchAccount = false) {
  setState({ authError: undefined });
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

export function signOutClick() {
  signOut();
  location.hash = '';
  location.reload();
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
    setState({ phase: 'ready', me: p.emailAddress, route: parseHash(), sessionExpired: false });
    loadLabels().then(() => loadPiles());
    loadSendAs();
    loadUserInfo();
    loadNotes();
    await loadList(true);
    const r = state.route;
    if (r.view === 'mail' && r.thread) openThread(r.thread);
    startPolling();
  } catch (e) {
    if (e instanceof AuthRequired) setState({ phase: 'signin' });
    else setState({ phase: 'signin', authError: e instanceof Error ? e.message : String(e) });
  }
}

// Optional: installs or sessions without the profile scope keep the initial.
async function loadUserInfo() {
  try {
    const u = await api.userInfo();
    if (u.picture && /^https:\/\//.test(u.picture)) setState({ mePhoto: u.picture });
  } catch {
    /* keep the initial */
  }
}

function onHash() {
  const prev = state.route;
  const next = parseHash();
  setState({ route: next, sidebarOpen: false, showKeys: false });
  if (state.phase !== 'ready' || next.view !== 'mail') return;
  if (prev.view !== 'mail' || listHash(prev) !== listHash(next)) {
    setState({ selected: new Set(), list: { ...state.list, page: 0, tokens: [undefined] } });
    loadList(true);
  }
  if (next.thread && next.thread !== state.open?.id) openThread(next.thread);
  if (!next.thread && state.open) setState({ open: undefined });
}

let pollTimer: number | undefined;
function startPolling() {
  clearInterval(pollTimer);
  pollTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible' && !state.sessionExpired) refresh(true);
  }, 45_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.phase === 'ready') refresh(true);
  });
}

export async function loadLabels() {
  try {
    const labels = await api.listLabels();
    setState({ labels });
    await loadCounts(labels);
  } catch (e) {
    fail(e);
  }
}

async function loadCounts(labels = state.labels) {
  const ids = ['INBOX', 'DRAFT', 'SPAM', ...labels.filter((l) => l.type === 'user').map((l) => l.id)];
  const details = await pool(ids, 6, (id) => api.getLabel(id).catch(() => undefined));
  const counts: Record<string, number> = {};
  details.forEach((d) => {
    if (!d) return;
    counts[d.id] = d.id === 'DRAFT' ? d.threadsTotal ?? 0 : d.threadsUnread ?? 0;
  });
  setState({ counts });
  const r = state.route;
  if (getPrefs().tabs && r.view === 'mail' && r.folder === 'inbox' && r.q === undefined) {
    const est = await pool(CATEGORIES.filter((c) => c !== 'primary'), 4, (c) =>
      api.listThreads({ q: `in:inbox category:${c} is:unread`, maxResults: 1 }).then((x) => [c, x.resultSizeEstimate ?? 0] as const).catch(() => [c, 0] as const)
    );
    setState({ catNew: Object.fromEntries(est) });
  }
}

async function loadSendAs() {
  try {
    const sendAs = await api.listSendAs();
    setState({ sendAs });
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
  if (!silent) setState({ list: { ...state.list, key, loading: true, error: undefined, page, tokens, rows: state.list.key === key ? state.list.rows : [] } });
  try {
    const res = await api.listThreads({ ...listParams(r, getPrefs().tabs), pageToken: tokens[page], maxResults: getPrefs().pageSize });
    const ids = res.threads ?? [];
    const rows = await pool(ids, 8, async (x) => {
      const c = rowCache.get(x.id);
      if (c && c.historyId === x.historyId) return c;
      const th = await api.getThread(x.id, 'metadata');
      const row = rowFromThread(th, state.me);
      rowCache.set(x.id, row);
      return row;
    });
    if (mine !== listSeq) return;
    const visible = new Set(rows.map((x) => x.id));
    const selected = new Set([...state.selected].filter((id) => visible.has(id)));
    const recent = collectRecent(rows);
    setState({ list: { key, rows, loading: false, page, tokens, next: res.nextPageToken, estimate: res.resultSizeEstimate }, selected, recent });
  } catch (e) {
    if (mine !== listSeq) return;
    if (e instanceof AuthRequired) return fail(e);
    setState({ list: { ...state.list, key, loading: false, error: e instanceof Error ? e.message : String(e) } });
  }
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
  if (!labelId) return setPile(p, { rows: [] });
  try {
    const res = await api.listThreads({ labelIds: [labelId], maxResults: 100 });
    const rows = await pool(res.threads ?? [], 8, async (x) => {
      const c = rowCache.get(x.id);
      if (c && c.historyId === x.historyId) return c;
      const row = rowFromThread(await api.getThread(x.id, 'metadata'), state.me);
      rowCache.set(x.id, row);
      return row;
    });
    setPile(p, { labelId, rows });
  } catch (e) {
    if (e instanceof AuthRequired) fail(e);
  }
}

export function loadPiles() {
  return Promise.all(PILES.map(loadPile));
}

async function ensurePileLabel(p: PileId): Promise<string> {
  const known = state.piles[p].labelId ?? findPileLabel(p);
  if (known) return known;
  const l = await api.createLabel(pileLabelName(p));
  setState((st) => ({ labels: [...st.labels, l], piles: { ...st.piles, [p]: { ...st.piles[p], labelId: l.id } } }));
  return l.id;
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
  loadList(false, silent);
  loadPiles();
  loadCounts().catch(() => undefined);
  if (state.open && !silent) openThread(state.open.id, true);
}

export async function openThread(id: string, quiet = false) {
  const mine = ++openSeq;
  if (!quiet) setState({ open: { id, loading: true, messages: [], labelIds: [] }, focusId: id });
  try {
    const th = await api.getThread(id, 'full');
    if (mine !== openSeq) return;
    const messages = (th.messages ?? []).map(parseMessage);
    const labelIds = [...new Set(messages.flatMap((m) => m.labelIds))];
    setState({ open: { id, loading: false, messages, labelIds } });
    if (labelIds.includes('UNREAD')) {
      patchRows([id], (r) => ({ ...r, unread: false }));
      api.modifyThread(id, [], ['UNREAD']).then(() => loadCounts()).catch(fail);
    }
  } catch (e) {
    if (mine !== openSeq) return;
    if (e instanceof AuthRequired) return fail(e);
    setState({ open: { id, loading: false, messages: [], labelIds: [], error: e instanceof Error ? e.message : String(e) } });
  }
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

function patchRows(ids: string[], fn: (r: ThreadRow) => ThreadRow) {
  const set = new Set(ids);
  const rows = state.list.rows.map((r) => {
    if (!set.has(r.id)) return r;
    const n = fn(r);
    rowCache.set(n.id, { ...n, historyId: undefined });
    return n;
  });
  setState({ list: { ...state.list, rows } });
}

function dropRows(ids: string[]) {
  const set = new Set(ids);
  const rows = state.list.rows;
  const idx = rows.findIndex((r) => set.has(r.id));
  const remaining = rows.filter((r) => !set.has(r.id));
  const selected = new Set([...state.selected].filter((x) => !set.has(x)));
  setState({ list: { ...state.list, rows: remaining }, selected });
  if (state.open && set.has(state.open.id)) {
    const nextRow = remaining[Math.min(idx, remaining.length - 1)];
    const r = state.route as MailRoute;
    if (getPrefs().pane === 'right' && nextRow) go(threadHash(r, nextRow.id), true);
    else go(listHash(r), true);
  }
}

type Op = { add: string[]; remove: string[] } | 'trash' | 'untrash';

async function applyOp(ids: string[], op: Op) {
  await pool(ids, 6, (id) =>
    op === 'trash' ? api.trashThread(id) : op === 'untrash' ? api.untrashThread(id) : api.modifyThread(id, op.add, op.remove)
  );
}

function invert(op: Op): Op {
  if (op === 'trash') return 'untrash';
  if (op === 'untrash') return 'trash';
  return { add: op.remove, remove: op.add };
}

async function run(ids: string[], op: Op, opts: { drop: boolean; message?: string; patch?: (r: ThreadRow) => ThreadRow }) {
  if (!ids.length) return;
  if (opts.drop) dropRows(ids);
  else if (opts.patch) patchRows(ids, opts.patch);
  try {
    await applyOp(ids, op);
    if (opts.message)
      toast(opts.message, {
        action: {
          label: t('toast.undo'),
          run: async () => {
            try {
              await applyOp(ids, invert(op));
              refresh(true);
            } catch (e) {
              fail(e);
            }
          }
        }
      });
    loadCounts().catch(() => undefined);
    if (state.open && ids.includes(state.open.id) && !opts.drop) openThread(state.open.id, true);
  } catch (e) {
    fail(e);
    refresh(true);
  }
}

function currentFolder(): string | undefined {
  const r = state.route;
  return r.view === 'mail' ? r.folder : undefined;
}

export const actions = {
  archive(ids: string[]) {
    const f = currentFolder();
    const remove = ['INBOX'];
    run(ids, { add: [], remove }, { drop: f === 'inbox' || !!(state.route as MailRoute).label || f === undefined, message: t('toast.archived', { n: ids.length }), patch: (r) => ({ ...r, labelIds: r.labelIds.filter((l) => l !== 'INBOX') }) });
  },
  moveToInbox(ids: string[]) {
    run(ids, { add: ['INBOX'], remove: ['SPAM'] }, { drop: currentFolder() === 'spam', message: t('toast.restored'), patch: (r) => ({ ...r, labelIds: [...r.labelIds, 'INBOX'] }) });
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
    run(ids, read ? { add: [], remove: ['UNREAD'] } : { add: ['UNREAD'], remove: [] }, {
      drop: false,
      patch: (r) => ({ ...r, unread: !read })
    });
    if (!read && state.open && ids.includes(state.open.id)) closeThread();
  },
  star(ids: string[], on: boolean) {
    run(ids, on ? { add: ['STARRED'], remove: [] } : { add: [], remove: ['STARRED'] }, {
      drop: !on && currentFolder() === 'starred',
      patch: (r) => ({ ...r, starred: on })
    });
  },
  important(ids: string[], on: boolean) {
    run(ids, on ? { add: ['IMPORTANT'], remove: [] } : { add: [], remove: ['IMPORTANT'] }, {
      drop: !on && currentFolder() === 'important',
      patch: (r) => ({ ...r, important: on })
    });
  },
  label(ids: string[], add: string[], remove: string[]) {
    const r = state.route as MailRoute;
    run(ids, { add, remove }, {
      drop: !!r.label && remove.includes(r.label),
      message: t('toast.labelled'),
      patch: (row) => ({ ...row, labelIds: [...new Set([...row.labelIds.filter((l) => !remove.includes(l)), ...add])] })
    });
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
    let labelId: string;
    try {
      labelId = await ensurePileLabel(p);
    } catch (e) {
      return fail(e);
    }
    const others = PILES.filter((x) => x !== p).map((x) => state.piles[x].labelId).filter((x): x is string => !!x);
    const remove = ['INBOX', ...others];
    const f = currentFolder();
    const r = state.route as MailRoute;
    const set = new Set(ids);
    const known = new Set(state.piles[p].rows.map((x) => x.id));
    const move = (row: ThreadRow) => ({ ...row, labelIds: [...row.labelIds.filter((l) => !remove.includes(l)), labelId] });
    const adding = ids
      .map((id) => state.list.rows.find((x) => x.id === id) ?? PILES.flatMap((x) => state.piles[x].rows).find((x) => x.id === id))
      .filter((x): x is ThreadRow => !!x && !known.has(x.id))
      .map(move);
    const piles = { ...state.piles };
    for (const x of PILES) piles[x] = x === p ? { labelId, rows: [...adding, ...piles[x].rows] } : { ...piles[x], rows: piles[x].rows.filter((row) => !set.has(row.id)) };
    setState({ piles });
    await run(ids, { add: [labelId], remove }, {
      drop: f === 'inbox' || (!!r.label && r.label !== labelId) || f === undefined,
      message: t(p === 'aside' ? 'toast.pin.aside' : 'toast.pin.action', { n: ids.length }),
      patch: move
    });
    loadPiles();
  },
  async unpin(ids: string[], toInbox: boolean) {
    const labels = pileLabelIds();
    if (!labels.length || !ids.length) return;
    const set = new Set(ids);
    const piles = { ...state.piles };
    for (const x of PILES) piles[x] = { ...piles[x], rows: piles[x].rows.filter((row) => !set.has(row.id)) };
    setState({ piles });
    const r = state.route as MailRoute;
    await run(ids, { add: toInbox ? ['INBOX'] : [], remove: labels }, {
      drop: (!!r.label && labels.includes(r.label)) || (toInbox ? false : currentFolder() === 'inbox'),
      message: toInbox ? t('toast.backToInbox') : t('toast.asideDone'),
      patch: (row) => ({ ...row, labelIds: [...row.labelIds.filter((l) => !labels.includes(l)), ...(toInbox ? ['INBOX'] : [])] })
    });
    loadPiles();
    if (toInbox && currentFolder() === 'inbox') loadList(false, true);
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
  const sig = state.sendAs.find((s) => s.sendAsEmail === email)?.signature;
  return sig ? `<br><div class="mm-signature">${signatureBlock(sig)}</div>` : '';
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
    from: { name: sa?.displayName ?? '', email: c.from },
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

export function senderName(a: Address) {
  return a.email.toLowerCase() === state.me.toLowerCase() ? t('list.me') : displayName(a);
}

function quickHtml(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => `<div>${l.trim() ? escapeHtml(l) : '<br>'}</div>`)
    .join('');
}

export async function quickReply(msg: ParsedMessage, text: string): Promise<void> {
  if (state.compose) await closeCompose();
  openCompose('reply', msg);
  const c = state.compose;
  if (!c) return;
  setState({ compose: { ...c, html: `${quickHtml(text)}${signatureFor(c.from)}`, minimized: true } });
  await sendCompose();
}

export async function expandQuickReply(msg: ParsedMessage, text: string): Promise<void> {
  if (state.compose) await closeCompose();
  openCompose('reply', msg);
  const c = state.compose;
  if (!c) return;
  setState({ compose: { ...c, html: `${quickHtml(text)}<div><br></div>${signatureFor(c.from)}` } });
}
