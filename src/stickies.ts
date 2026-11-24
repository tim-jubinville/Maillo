import type { StickiesFile, Sticky, StickyColor } from './gmail/types';

// Stickies live in one JSON file in Drive's hidden app folder (features.stickies), next to
// the synced settings and conversation notes. Each save merges with the copy in Drive, so two
// devices editing different stickies never undo each other: the newest change to a sticky
// wins, and deletions are remembered for a while so they reach every device.

export const STICKY_COLORS: StickyColor[] = ['yellow', 'orange', 'pink', 'purple', 'blue', 'green', 'grey'];
const FORGET_DELETED = 60 * 86_400_000;
const LAST_COLOR = 'maillo.stickyColor';

type Backend = {
  loadStickies(): Promise<StickiesFile | null>;
  saveStickies(f: StickiesFile): Promise<void>;
};

export type StickiesState = { stickies: Sticky[] | null; error: boolean; saving: boolean };

let api: Backend | null = null;
let file: StickiesFile = { version: 1, stickies: [], deleted: {} };
let state: StickiesState = { stickies: null, error: false, saving: false };
let lastPull = 0;
let timer: number | undefined;
let dirty = false;
const listeners = new Set<() => void>();

function emit(patch: Partial<StickiesState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function stickiesState() {
  return state;
}

export function onStickies(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const sorted = (list: Sticky[]) => [...list].sort((a, b) => b.created - a.created);

function clean(raw: unknown): StickiesFile {
  const f = raw as Partial<StickiesFile> | null;
  const stickies: Sticky[] = [];
  for (const s of Array.isArray(f?.stickies) ? f!.stickies : []) {
    if (!s || typeof s.id !== 'string' || typeof s.text !== 'string') continue;
    stickies.push({
      id: s.id,
      text: s.text,
      color: STICKY_COLORS.includes(s.color) ? s.color : 'yellow',
      created: Number(s.created) || 0,
      updated: Number(s.updated) || 0
    });
  }
  const deleted: Record<string, number> = {};
  const now = Date.now();
  for (const [id, at] of Object.entries(f?.deleted && typeof f.deleted === 'object' ? f.deleted : {})) {
    if (Number(at) > now - FORGET_DELETED) deleted[id] = Number(at);
  }
  return { version: 1, stickies, deleted };
}

/** Newest change per sticky; a deletion wins over any edit made before it. */
function merge(a: StickiesFile, b: StickiesFile): StickiesFile {
  const deleted = { ...a.deleted };
  for (const [id, at] of Object.entries(b.deleted)) deleted[id] = Math.max(deleted[id] ?? 0, at);
  const byId = new Map<string, Sticky>();
  for (const s of [...a.stickies, ...b.stickies]) {
    const cur = byId.get(s.id);
    if (!cur || s.updated > cur.updated) byId.set(s.id, s);
  }
  const stickies = [...byId.values()].filter((s) => !(deleted[s.id] >= s.updated));
  return { version: 1, stickies: sorted(stickies), deleted };
}

export function startStickies(backend: Backend) {
  api = backend;
}

/** Loads the stickies from Drive (at most once a minute unless forced). */
export async function pullStickies(force = false) {
  if (!api || dirty || (!force && Date.now() - lastPull < 60_000 && state.stickies)) return;
  lastPull = Date.now();
  try {
    const remote = clean(await api.loadStickies());
    file = state.stickies ? merge(file, remote) : { ...remote, stickies: sorted(remote.stickies) };
    emit({ stickies: file.stickies, error: false });
  } catch {
    emit({ error: !state.stickies });
  }
}

async function push() {
  if (!api) return;
  emit({ saving: true });
  try {
    const remote = clean(await api.loadStickies());
    file = merge(remote, file);
    await api.saveStickies(file);
    dirty = false;
    emit({ stickies: file.stickies, saving: false });
  } catch {
    // Try again shortly; the local copy stays as it is.
    emit({ saving: false });
    clearTimeout(timer);
    timer = window.setTimeout(push, 15_000);
  }
}

function changed() {
  dirty = true;
  emit({ stickies: file.stickies });
  clearTimeout(timer);
  timer = window.setTimeout(push, 1200);
}

/** Saves right away (when the panel closes or the page is hidden). */
export function flushStickies() {
  if (!dirty) return;
  clearTimeout(timer);
  push();
}

export function lastStickyColor(): StickyColor {
  const c = localStorage.getItem(LAST_COLOR) as StickyColor | null;
  return c && STICKY_COLORS.includes(c) ? c : 'yellow';
}

export function addSticky(color = lastStickyColor()): Sticky {
  const now = Date.now();
  const s: Sticky = { id: `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`, text: '', color, created: now, updated: now };
  file = { ...file, stickies: [s, ...file.stickies] };
  // An empty sticky isn't saved until something is written on it.
  emit({ stickies: file.stickies });
  return s;
}

export function updateSticky(id: string, patch: Partial<Pick<Sticky, 'text' | 'color'>>) {
  if (patch.color) localStorage.setItem(LAST_COLOR, patch.color);
  file = { ...file, stickies: file.stickies.map((s) => (s.id === id ? { ...s, ...patch, updated: Date.now() } : s)) };
  changed();
}

export function removeSticky(id: string) {
  file = { ...file, stickies: file.stickies.filter((s) => s.id !== id), deleted: { ...file.deleted, [id]: Date.now() } };
  changed();
}

/** Drops a sticky that was never written on, without remembering it as deleted. */
export function discardEmpty(id: string) {
  const s = file.stickies.find((x) => x.id === id);
  if (!s || s.text.trim()) return;
  // One that was saved before being emptied is deleted properly, so Drive's copy goes too.
  if (s.updated > s.created) return removeSticky(id);
  file = { ...file, stickies: file.stickies.filter((x) => x.id !== id) };
  emit({ stickies: file.stickies });
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushStickies();
    else if (state.stickies) pullStickies();
  });
}

/** Puts back a sticky that was just deleted (Undo). */
export function restoreSticky(s: Sticky) {
  const deleted = { ...file.deleted };
  delete deleted[s.id];
  file = { ...file, stickies: sorted([{ ...s, updated: Date.now() }, ...file.stickies.filter((x) => x.id !== s.id)]), deleted };
  changed();
}
