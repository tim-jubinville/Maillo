/**
 * Mail kept on this device between visits, in IndexedDB: conversation headers (rows), what each list
 * showed last, labels and counts, and recently opened conversations for reading offline.
 * It belongs to one account: opening it for another account empties it first, and signing out deletes it.
 * Without IndexedDB (some private windows) everything still works, from memory only.
 */
import type { GThread } from './gmail/types';
import type { ThreadRow } from './model';

const DB = 'maillo-cache';
const VERSION = 1;
const ROWS = 'rows';
const THREADS = 'threads';
const META = 'meta';
/** Full conversations kept for offline reading; the least recently opened go first. */
const THREAD_MAX = 150;

let db: IDBDatabase | null = null;
let owner = '';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function open(): Promise<IDBDatabase | null> {
  if (db) return Promise.resolve(db);
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let r: IDBOpenDBRequest;
    try {
      r = indexedDB.open(DB, VERSION);
    } catch {
      return resolve(null);
    }
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains(ROWS)) d.createObjectStore(ROWS, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(THREADS)) d.createObjectStore(THREADS, { keyPath: 'id' }).createIndex('at', 'at');
      if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
    };
    r.onsuccess = () => {
      db = r.result;
      // Another tab deleting the cache (signing out) must not wait on this one.
      db.onversionchange = () => {
        db?.close();
        db = null;
      };
      resolve(db);
    };
    r.onerror = () => resolve(null);
    r.onblocked = () => resolve(null);
  });
}

export interface ListSnap {
  ids: string[];
  next?: string;
  estimate?: number;
}

export interface Warm {
  rows: ThreadRow[];
  meta: Record<string, unknown>;
}

/** Opens the cache for one account and reads what it holds; empties it if it belonged to someone else. */
export async function openCache(account: string): Promise<Warm> {
  const me = account.toLowerCase();
  const d = await open();
  owner = me;
  if (!d) return { rows: [], meta: {} };
  try {
    const tx = d.transaction([ROWS, META, THREADS], 'readwrite');
    const meta = tx.objectStore(META);
    const was = await req(meta.get('owner'));
    if (was !== me) {
      tx.objectStore(ROWS).clear();
      tx.objectStore(THREADS).clear();
      meta.clear();
      meta.put(me, 'owner');
      await done(tx);
      return { rows: [], meta: {} };
    }
    const [rows, keys, values] = await Promise.all([
      req(tx.objectStore(ROWS).getAll() as IDBRequest<ThreadRow[]>),
      req(meta.getAllKeys()),
      req(meta.getAll())
    ]);
    await done(tx);
    const out: Record<string, unknown> = {};
    keys.forEach((k, i) => (out[String(k)] = values[i]));
    return { rows: rows.filter((r) => r?.id).map((r) => ({ ...r, date: new Date(r.date) })), meta: out };
  } catch {
    return { rows: [], meta: {} };
  }
}

/** The account this device's cache belongs to, if it has one (without opening it for anyone). */
export async function cacheOwner(): Promise<string> {
  const d = await open();
  if (!d) return '';
  try {
    return String((await req(d.transaction(META).objectStore(META).get('owner'))) ?? '');
  } catch {
    return '';
  }
}

export async function saveRows(put: ThreadRow[], remove: string[]) {
  const d = await open();
  if (!d || !owner || (!put.length && !remove.length)) return;
  try {
    const tx = d.transaction(ROWS, 'readwrite');
    const s = tx.objectStore(ROWS);
    for (const r of put) s.put(r);
    for (const id of remove) s.delete(id);
    await done(tx);
  } catch {
    /* storage full or unavailable: memory only */
  }
}

export async function saveMeta(key: string, value: unknown) {
  const d = await open();
  if (!d || !owner) return;
  try {
    const tx = d.transaction(META, 'readwrite');
    tx.objectStore(META).put(value, key);
    await done(tx);
  } catch {
    /* memory only */
  }
}

// Recently opened conversations, in memory for this visit and on disk for the next (and for offline).
const threads = new Map<string, GThread>();

export async function getThread(id: string): Promise<GThread | undefined> {
  const hit = threads.get(id);
  if (hit) return hit;
  const d = await open();
  if (!d || !owner) return undefined;
  try {
    const rec = (await req(d.transaction(THREADS).objectStore(THREADS).get(id))) as { thread: GThread } | undefined;
    if (rec?.thread) threads.set(id, rec.thread);
    return rec?.thread;
  } catch {
    return undefined;
  }
}

let trimAt = 0;

export async function putThread(th: GThread) {
  threads.delete(th.id);
  threads.set(th.id, th);
  while (threads.size > THREAD_MAX) threads.delete(threads.keys().next().value!);
  const d = await open();
  if (!d || !owner) return;
  try {
    const tx = d.transaction(THREADS, 'readwrite');
    const s = tx.objectStore(THREADS);
    s.put({ id: th.id, at: Date.now(), thread: th });
    // Every so often, drop the conversations opened longest ago.
    if (Date.now() - trimAt > 60_000) {
      trimAt = Date.now();
      const count = await req(s.count());
      if (count > THREAD_MAX) {
        let extra = count - THREAD_MAX;
        const cur = s.index('at').openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c || extra-- <= 0) return;
          c.delete();
          c.continue();
        };
      }
    }
    await done(tx);
  } catch {
    /* memory only */
  }
}

export function forgetThread(id: string) {
  threads.delete(id);
}

/** Deletes everything kept on this device (signing out, or switching account). */
export async function clearCache() {
  threads.clear();
  owner = '';
  db?.close();
  db = null;
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve) => {
    try {
      const r = indexedDB.deleteDatabase(DB);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
