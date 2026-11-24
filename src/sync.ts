import { AuthRequired } from './gmail/api';
import { config } from './config';
import { getPrefs, onPrefsPatch, setPrefs, type NotifyPrefs, type Prefs } from './prefs';


// Keeps settings the same on every device through a hidden file in Drive's app folder
// (features.syncSettings). The newest change wins, setting by setting group.

const STAMP_KEY = 'maillo.prefs.updated';
const LANG_KEY = 'maillo.lang';

/** Settings that belong to one device (screen size, its own notifications) and never sync. */
const LOCAL: (keyof Prefs)[] = ['layout', 'panel', 'sidebarCollapsed', 'textScale', 'calView'];
const LOCAL_NOTIFY: (keyof NotifyPrefs)[] = ['enabled'];

export const syncEnabled = () => config.features.syncSettings || config.demo;

type Backend = {
  loadSettings(): Promise<{ version: 1; updated: number; prefs: Record<string, unknown> } | null>;
  saveSettings(d: { version: 1; updated: number; prefs: Record<string, unknown> }): Promise<void>;
};

let api: Backend | null = null;
let timer: number | undefined;
let lastPull = 0;
let status: { state: 'idle' | 'saving' | 'saved' | 'error'; at?: number } = { state: 'idle' };
const listeners = new Set<() => void>();

export function syncStatus() {
  return status;
}

export function onSyncStatus(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function setStatus(s: typeof status) {
  status = s;
  listeners.forEach((l) => l());
}

function stamp(): number {
  return Number(localStorage.getItem(STAMP_KEY)) || 0;
}

function shared(): Record<string, unknown> {
  const p: Record<string, unknown> = { ...getPrefs() };
  for (const k of LOCAL) delete p[k];
  const n: Record<string, unknown> = { ...getPrefs().notify };
  for (const k of LOCAL_NOTIFY) delete n[k];
  p.notify = n;
  p.language = localStorage.getItem(LANG_KEY) || 'auto';
  return p;
}

function apply(remote: Record<string, unknown>) {
  const cur = getPrefs();
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(remote)) {
    if (k === 'language' || k === 'notify' || (LOCAL as string[]).includes(k) || !(k in cur)) continue;
    if (JSON.stringify(v) !== JSON.stringify(cur[k as keyof Prefs])) patch[k] = v;
  }
  if (remote.notify && typeof remote.notify === 'object') {
    const n = { ...cur.notify, ...(remote.notify as Partial<NotifyPrefs>) };
    for (const k of LOCAL_NOTIFY) (n as unknown as Record<string, unknown>)[k] = cur.notify[k];
    if (JSON.stringify(n) !== JSON.stringify(cur.notify)) patch.notify = n;
  }
  if (Object.keys(patch).length) setPrefs(patch as Partial<Prefs>, { remote: true });
  const lang = remote.language;
  if ((lang === 'en' || lang === 'fr' || lang === 'auto') && localStorage.getItem(LANG_KEY) !== lang) {
    if (lang === 'auto') localStorage.removeItem(LANG_KEY);
    else localStorage.setItem(LANG_KEY, lang);
    // Interface strings are picked at load time.
    location.reload();
  }
}

async function push() {
  if (!api) return;
  setStatus({ state: 'saving' });
  try {
    await api.saveSettings({ version: 1, updated: stamp() || Date.now(), prefs: shared() });
    setStatus({ state: 'saved', at: Date.now() });
  } catch (e) {
    setStatus({ state: 'error' });
    if (e instanceof AuthRequired) return;
  }
}

/** Fetches the shared copy and applies it if it's newer than this device's settings. */
export async function pull(force = false) {
  if (!api || (!force && Date.now() - lastPull < 5 * 60_000)) return;
  lastPull = Date.now();
  try {
    const remote = await api.loadSettings();
    const mine = stamp();
    if (remote && remote.version === 1 && remote.updated > mine && remote.prefs && typeof remote.prefs === 'object') {
      localStorage.setItem(STAMP_KEY, String(remote.updated));
      apply(remote.prefs);
      setStatus({ state: 'saved', at: Date.now() });
    } else if (!remote || mine > remote.updated) {
      // First device to sync, or this one changed while offline.
      if (!mine) localStorage.setItem(STAMP_KEY, String(Date.now()));
      await push();
    } else setStatus({ state: 'saved', at: Date.now() });
  } catch {
    setStatus({ state: 'error' });
  }
}

let started = false;

export function startSync(backend: Backend) {
  if (!syncEnabled() || started) return;
  started = true;
  api = backend;
  onPrefsPatch((patch, remote) => {
    if (remote) return;
    const keys = Object.keys(patch) as (keyof Prefs)[];
    if (keys.every((k) => LOCAL.includes(k))) return;
    localStorage.setItem(STAMP_KEY, String(Date.now()));
    clearTimeout(timer);
    timer = window.setTimeout(push, 2500);
  });
  pull(true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pull();
  });
}

/** Changes the interface language (stored apart from the other settings), shares it, then reloads. */
export async function changeLanguage(next: 'en' | 'fr' | 'auto') {
  if (next === 'auto') localStorage.removeItem(LANG_KEY);
  else localStorage.setItem(LANG_KEY, next);
  if (api) {
    localStorage.setItem(STAMP_KEY, String(Date.now()));
    clearTimeout(timer);
    await Promise.race([push(), new Promise((r) => setTimeout(r, 3000))]);
  }
  location.reload();
}
