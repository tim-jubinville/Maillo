import { locale } from '../i18n';
import { config } from '../config';
import { currentToken, dropKeepToken, dropSession, keepToken } from '../auth';
import type {
  CalendarEvent,
  ContactCard,
  GDraft,
  GFilter,
  GLabel,
  GMessage,
  GProfile,
  GUserInfo,
  PersonHit,
  GSendAs,
  GThread,
  GThreadList,
  GVacation,
  KeepNote,
  ListThreadsParams,
  MailBackend,
  NotesMap,
  SyncedSettings,
  TaskItem
} from './types';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const META_HEADERS = ['From', 'To', 'Subject', 'Date', 'Content-Type'];

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class AuthRequired extends Error {}

/** The Keep panel has no Keep token yet (or it ran out); it asks for one with requestKeepToken. */
export class KeepAuthRequired extends Error {}

type Query = Record<string, string | number | boolean | string[] | undefined>;

function qs(q?: Query): string {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
    else p.append(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Google's rate-limit answers: 429, or 403 with one of these reasons. */
function isRateLimit(status: number, reason?: string): boolean {
  return status === 429 || (status === 403 && /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(reason ?? ''));
}

export class RateLimited extends ApiError {}

// Gmail charges "quota units" per call (threads.get 10, threads.list 10, history 2…) with a per-user cap of 15,000 a minute.
// Spending is tracked here so bursts slow down instead of failing.
const UNIT_BUDGET = 11_000;
const spent: { at: number; units: number }[] = [];
let inFlight = 0;
const waiting: (() => void)[] = [];
const MAX_IN_FLIGHT = 8;

function unitsFor(url: string, method: string): number {
  if (!url.startsWith(GMAIL)) return 0;
  const path = url.slice(GMAIL.length);
  if (path.startsWith('/history')) return 2;
  if (/^\/labels\/[^/]+$/.test(path) && method === 'GET') return 1;
  if (path.startsWith('/labels') || path.startsWith('/settings') || path === '/profile') return 1;
  if (/\/(send)$/.test(path)) return 100;
  if (/\/attachments\//.test(path)) return 5;
  return 10;
}

async function budget(units: number) {
  if (!units) return;
  for (;;) {
    const now = Date.now();
    while (spent.length && now - spent[0].at > 60_000) spent.shift();
    const used = spent.reduce((n, x) => n + x.units, 0);
    if (used + units <= UNIT_BUDGET || !spent.length) break;
    await new Promise((r) => setTimeout(r, Math.min(5_000, 60_000 - (now - spent[0].at) + 50)));
  }
  spent.push({ at: Date.now(), units });
}

/** Share of the per-minute quota budget still free (0 to 1), so optional work like prefetching can hold back. */
export function quotaHeadroom(): number {
  const now = Date.now();
  const used = spent.filter((x) => now - x.at <= 60_000).reduce((n, x) => n + x.units, 0);
  return Math.max(0, 1 - used / UNIT_BUDGET);
}

async function slot<T>(run: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  try {
    return await run();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

function retryDelay(res: Response, attempt: number): number {
  const after = Number(res.headers.get('Retry-After'));
  if (after > 0) return Math.min(after, 30) * 1000;
  return 800 * 2 ** attempt + Math.random() * 400;
}

async function request<T>(url: string, init: RequestInit & { query?: Query; units?: number; keep?: boolean } = {}, attempt = 0): Promise<T> {
  const token = init.keep ? keepToken() : currentToken();
  if (!token) throw init.keep ? new KeepAuthRequired() : new AuthRequired();
  if (attempt === 0) await budget(init.units ?? unitsFor(url, init.method ?? 'GET'));
  const res = await slot(() =>
    fetch(url + qs(init.query), {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {})
      }
    })
  );
  if (res.status === 401) {
    if (init.keep) {
      dropKeepToken();
      throw new KeepAuthRequired();
    }
    dropSession();
    throw new AuthRequired();
  }
  let msg = res.statusText;
  let reason: string | undefined;
  if (!res.ok) {
    try {
      const j = await res.clone().json();
      msg = j?.error?.message || msg;
      reason = j?.error?.errors?.[0]?.reason || j?.error?.status;
    } catch {
      /* empty */
    }
  }
  const limited = isRateLimit(res.status, reason || msg);
  if ((limited || res.status >= 500) && attempt < 4) {
    await new Promise((r) => setTimeout(r, retryDelay(res, attempt)));
    return request<T>(url, init, attempt + 1);
  }
  if (!res.ok) {
    if (limited) throw new RateLimited(res.status, msg);
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if ((init as { raw?: boolean }).raw) return text as T;
  return (text ? JSON.parse(text) : undefined) as T;
}

const BATCH = 'https://www.googleapis.com/batch/gmail/v1';
const BATCH_SIZE = 20;

/**
 * Sends several Gmail GET requests in one HTTP call (Google's batch endpoint). Quota is the same,
 * but it's far faster than dozens of separate requests. Parts that fail are retried one by one.
 */
async function batchGet<T>(paths: string[]): Promise<(T | undefined)[]> {
  const out: (T | undefined)[] = new Array(paths.length);
  const chunks: number[][] = [];
  for (let i = 0; i < paths.length; i += BATCH_SIZE) chunks.push(paths.slice(i, i + BATCH_SIZE).map((_, j) => i + j));
  await Promise.all(
    chunks.map(async (idx) => {
      const retry: number[] = [];
      if (idx.length === 1) retry.push(idx[0]);
      else {
        const boundary = 'batch_maillo_' + Math.random().toString(36).slice(2);
        const body =
          idx
            .map((i) => `--${boundary}\r\nContent-Type: application/http\r\nContent-ID: <p${i}>\r\n\r\nGET /gmail/v1/users/me${paths[i]}\r\n`)
            .join('\r\n') + `\r\n--${boundary}--`;
        try {
          const units = idx.reduce((n, i) => n + unitsFor(GMAIL + paths[i].split('?')[0], 'GET'), 0);
          const raw = await request<string>(BATCH, {
            method: 'POST',
            body,
            units,
            headers: { 'Content-Type': `multipart/mixed; boundary=${boundary}` },
            // The response is multipart text, not JSON.
            ...({ raw: true } as object)
          }).catch((e) => {
            if (e instanceof AuthRequired) throw e;
            return '';
          });
          const parsed = parseBatch(typeof raw === 'string' ? raw : '');
          for (const i of idx) {
            const part = parsed.get(`p${i}`);
            if (part && part.status >= 200 && part.status < 300) out[i] = part.body as T;
            else if (part && part.status === 404) out[i] = undefined;
            else retry.push(i);
          }
        } catch (e) {
          if (e instanceof AuthRequired) throw e;
          retry.push(...idx);
        }
      }
      for (const i of retry) {
        try {
          out[i] = await request<T>(GMAIL + paths[i]);
        } catch (e) {
          if (e instanceof AuthRequired || e instanceof RateLimited) throw e;
          if (!(e instanceof ApiError && e.status === 404)) throw e;
        }
      }
    })
  );
  return out;
}

/** Splits a batch response into its parts, by Content-ID. */
export function parseBatch(text: string): Map<string, { status: number; body: unknown }> {
  const out = new Map<string, { status: number; body: unknown }>();
  const m = /^--(\S+)/m.exec(text);
  if (!m) return out;
  for (const chunk of text.split(`--${m[1]}`)) {
    const id = /Content-ID:\s*<?response-([^>\s]+)>?/i.exec(chunk)?.[1];
    const st = /HTTP\/[\d.]+\s+(\d{3})/.exec(chunk);
    if (!id || !st) continue;
    const start = chunk.indexOf('{');
    let body: unknown;
    if (start >= 0) {
      try {
        body = JSON.parse(chunk.slice(start, chunk.lastIndexOf('}') + 1));
      } catch {
        body = undefined;
      }
    }
    out.set(id, { status: Number(st[1]), body });
  }
  return out;
}

const get = <T>(path: string, query?: Query) => request<T>(GMAIL + path, { query });
const post = <T>(path: string, body?: unknown) =>
  request<T>(GMAIL + path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

// Google Calendar's event colours as its interface shows them (the API's own colour list is an older, paler palette).
const EVENT_COLORS: Record<string, string> = {
  '1': '#7986cb', // Lavender
  '2': '#33b679', // Sage
  '3': '#8e24aa', // Grape
  '4': '#e67c73', // Flamingo
  '5': '#f6bf26', // Banana
  '6': '#f4511e', // Tangerine
  '7': '#039be5', // Peacock
  '8': '#616161', // Graphite
  '9': '#3f51b5', // Blueberry
  '10': '#0b8043', // Basil
  '11': '#d50000' // Tomato
};
const CALENDAR_DEFAULT = '#039be5';

const KEEP = 'https://keep.googleapis.com/v1';

interface GKeepListItem {
  text?: { text?: string };
  checked?: boolean;
  childListItems?: GKeepListItem[];
}
interface GKeepNote {
  name: string;
  title?: string;
  updateTime?: string;
  body?: { text?: { text?: string }; list?: { listItems?: GKeepListItem[] } };
}

function toKeepNote(n: GKeepNote): KeepNote {
  const flat = (items: GKeepListItem[] = []): { text: string; checked: boolean }[] =>
    items.flatMap((i) => [{ text: i.text?.text ?? '', checked: !!i.checked }, ...flat(i.childListItems)]);
  return { name: n.name, title: n.title, text: n.body?.text?.text, items: n.body?.list ? flat(n.body.list.listItems) : undefined, updated: n.updateTime };
}

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const NOTES_FILE = 'maillo-notes.json';
// Notes saved before the rename to Maillo keep their original file name.
const LEGACY_NOTES_FILE = 'mailmax-notes.json';
let notesFileId: string | undefined;
const SETTINGS_FILE = 'maillo-settings.json';
let settingsFileId: string | undefined;

// Notes live in Drive's hidden per-app folder: invisible in Drive and Gmail, synced across devices.
async function findNotesFile(): Promise<string | undefined> {
  if (notesFileId) return notesFileId;
  const r = await request<{ files?: { id: string }[] }>(DRIVE, {
    query: { spaces: 'appDataFolder', q: `(name = '${NOTES_FILE}' or name = '${LEGACY_NOTES_FILE}') and trashed = false`, fields: 'files(id)', pageSize: 1 }
  });
  notesFileId = r.files?.[0]?.id;
  return notesFileId;
}

function cleanNotes(v: unknown): NotesMap {
  const raw = (v as { notes?: unknown } | null)?.notes;
  const out: NotesMap = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, n] of Object.entries(raw as Record<string, { text?: unknown; updated?: unknown }>)) {
    if (typeof n?.text === 'string' && n.text.trim()) out[id] = { text: n.text, updated: Number(n.updated) || 0 };
  }
  return out;
}

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

const PEOPLE = 'https://people.googleapis.com/v1';

interface GPerson {
  emailAddresses?: { value?: string }[];
  photos?: { url?: string; default?: boolean; metadata?: { primary?: boolean } }[];
}

// Reads every page of one People API listing (capped), keeping each person's real photo.
async function collectPhotos(url: string, query: Query, key: 'connections' | 'otherContacts' | 'people', into: Record<string, string>) {
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const r = await request<Record<string, unknown> & { nextPageToken?: string }>(url, { query: { ...query, pageSize: 1000, pageToken } });
    for (const p of (r[key] as GPerson[] | undefined) ?? []) {
      const photo = p.photos?.find((x) => !x.default && x.metadata?.primary) ?? p.photos?.find((x) => !x.default);
      if (!photo?.url || !/^https:\/\//.test(photo.url)) continue;
      for (const e of p.emailAddresses ?? []) {
        const k = e.value?.trim().toLowerCase();
        if (k && !into[k]) into[k] = photo.url;
      }
    }
    pageToken = r.nextPageToken;
    if (!pageToken) break;
  }
}

interface GSearchResult {
  results?: { person?: GPerson & { names?: { displayName?: string }[] } }[];
  people?: (GPerson & { names?: { displayName?: string }[] })[];
}

function toHits(people: (GPerson & { names?: { displayName?: string }[] })[], into: Map<string, PersonHit>) {
  for (const p of people) {
    const photo = p.photos?.find((x) => !x.default)?.url;
    for (const e of p.emailAddresses ?? []) {
      const email = e.value?.trim();
      if (!email || into.has(email.toLowerCase())) continue;
      into.set(email.toLowerCase(), { name: p.names?.[0]?.displayName ?? '', email, photo: photo && /^https:\/\//.test(photo) ? photo : undefined });
    }
  }
}

interface GFullPerson extends GPerson {
  resourceName?: string;
  names?: { displayName?: string }[];
  phoneNumbers?: { value?: string; formattedType?: string }[];
  organizations?: { name?: string; title?: string }[];
  addresses?: { formattedValue?: string }[];
  birthdays?: { date?: { year?: number; month?: number; day?: number }; text?: string }[];
  urls?: { value?: string }[];
  biographies?: { value?: string }[];
}

const CARD_FIELDS = 'names,emailAddresses,phoneNumbers,photos,organizations,addresses,birthdays,urls,biographies';
// "Other contacts" only expose these.
const OTHER_FIELDS = 'names,emailAddresses,phoneNumbers,photos';

function toCard(p: GFullPerson, source: ContactCard['source']): ContactCard {
  const photo = p.photos?.find((x) => !x.default)?.url;
  const b = p.birthdays?.find((x) => x.date?.month && x.date?.day);
  const birthday = b?.date
    ? new Date(b.date.year ?? 2000, (b.date.month ?? 1) - 1, b.date.day ?? 1).toLocaleDateString(locale(), { month: 'long', day: 'numeric', ...(b.date.year ? { year: 'numeric' } : {}) })
    : p.birthdays?.[0]?.text;
  return {
    id: p.resourceName ?? '',
    source,
    name: p.names?.[0]?.displayName ?? '',
    emails: [...new Set((p.emailAddresses ?? []).map((e) => e.value?.trim() ?? '').filter(Boolean))],
    phones: (p.phoneNumbers ?? []).filter((x) => x.value).map((x) => ({ value: x.value!, type: x.formattedType })),
    photo: photo && /^https:\/\//.test(photo) ? photo : undefined,
    org: p.organizations?.[0]?.name,
    title: p.organizations?.[0]?.title,
    addresses: (p.addresses ?? []).map((a) => a.formattedValue ?? '').filter(Boolean),
    birthday,
    urls: (p.urls ?? []).map((u) => u.value ?? '').filter((u) => /^https?:\/\//i.test(u)),
    note: p.biographies?.[0]?.value
  };
}

let peopleWarm = false;

export const gmailBackend: MailBackend = {
  demo: false,
  profile: () => get<GProfile>('/profile'),
  userInfo: () => request<GUserInfo>('https://www.googleapis.com/oauth2/v3/userinfo'),
  // Your own contacts win over the directory, which wins over "other contacts". Each source is optional:
  // personal accounts have no directory, and a missing permission just leaves that source out.
  searchPeople: async (q) => {
    if (!config.features.contactPhotos) return [];
    // Google asks for an empty "warm-up" search before the first real one, so its cache is ready.
    if (!peopleWarm) {
      peopleWarm = true;
      await Promise.allSettled([
        request(`${PEOPLE}/people:searchContacts`, { query: { query: '', readMask: 'names' } }),
        request(`${PEOPLE}/otherContacts:search`, { query: { query: '', readMask: 'names' } })
      ]);
    }
    const mask = 'names,emailAddresses,photos';
    const [mine, dir, other] = await Promise.allSettled([
      request<GSearchResult>(`${PEOPLE}/people:searchContacts`, { query: { query: q, readMask: mask, pageSize: 6 } }),
      request<GSearchResult>(`${PEOPLE}/people:searchDirectoryPeople`, { query: { query: q, readMask: mask, sources: 'DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE', pageSize: 6 } }),
      request<GSearchResult>(`${PEOPLE}/otherContacts:search`, { query: { query: q, readMask: mask, pageSize: 6 } })
    ]);
    const out = new Map<string, PersonHit>();
    if (mine.status === 'fulfilled') toHits((mine.value.results ?? []).map((r) => r.person ?? {}), out);
    if (dir.status === 'fulfilled') toHits(dir.value.people ?? [], out);
    if (other.status === 'fulfilled') toHits((other.value.results ?? []).map((r) => r.person ?? {}), out);
    return [...out.values()];
  },
  listContacts: async () => {
    if (!config.features.contactPhotos) return [];
    const out: ContactCard[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 5; page++) {
      const r = await request<{ connections?: GFullPerson[]; nextPageToken?: string }>(`${PEOPLE}/people/me/connections`, {
        query: { personFields: 'names,emailAddresses,phoneNumbers,photos,organizations', sortOrder: 'FIRST_NAME_ASCENDING', pageSize: 1000, pageToken }
      });
      for (const p of r.connections ?? []) {
        const c = toCard(p, 'contact');
        if (c.name || c.emails.length) out.push(c);
      }
      pageToken = r.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  },
  findContact: async (email) => {
    if (!config.features.contactPhotos) return null;
    const want = email.trim().toLowerCase();
    const match = (people: GFullPerson[]) => people.find((p) => p.emailAddresses?.some((e) => e.value?.trim().toLowerCase() === want));
    const tries: [() => Promise<GFullPerson[]>, ContactCard['source']][] = [
      [async () => ((await request<{ results?: { person?: GFullPerson }[] }>(`${PEOPLE}/people:searchContacts`, { query: { query: email, readMask: CARD_FIELDS, pageSize: 10 } })).results ?? []).map((r) => r.person ?? {}), 'contact'],
      [async () => (await request<{ people?: GFullPerson[] }>(`${PEOPLE}/people:searchDirectoryPeople`, { query: { query: email, readMask: CARD_FIELDS, sources: 'DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE', pageSize: 10 } })).people ?? [], 'directory'],
      [async () => ((await request<{ results?: { person?: GFullPerson }[] }>(`${PEOPLE}/otherContacts:search`, { query: { query: email, readMask: OTHER_FIELDS, pageSize: 10 } })).results ?? []).map((r) => r.person ?? {}), 'other']
    ];
    for (const [run, source] of tries) {
      try {
        const p = match(await run());
        if (p) return toCard(p, source);
      } catch (e) {
        if (e instanceof AuthRequired) throw e;
      }
    }
    return null;
  },
  contactPhotos: async () => {
    const out: Record<string, string> = {};
    const sources: [string, Query, 'connections' | 'otherContacts' | 'people'][] = [
      [`${PEOPLE}/people/me/connections`, { personFields: 'emailAddresses,photos' }, 'connections'],
      [`${PEOPLE}/people:listDirectoryPeople`, { readMask: 'emailAddresses,photos', sources: 'DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE' }, 'people'],
      [`${PEOPLE}/otherContacts`, { readMask: 'emailAddresses,photos' }, 'otherContacts']
    ];
    for (const [url, query, key] of sources) {
      try {
        await collectPhotos(url, query, key, out);
      } catch (e) {
        if (e instanceof AuthRequired) throw e;
      }
    }
    return out;
  },
  listLabels: async () => (await get<{ labels?: GLabel[] }>('/labels')).labels ?? [],
  getLabel: (id) => get<GLabel>(`/labels/${encodeURIComponent(id)}`),
  createLabel: (name) =>
    post<GLabel>('/labels', { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
  updateLabel: (id, patch) =>
    request<GLabel>(`${GMAIL}/labels/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteLabel: (id) => request<void>(`${GMAIL}/labels/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listThreads: (p: ListThreadsParams) =>
    get<GThreadList>('/threads', {
      q: p.q,
      labelIds: p.labelIds,
      pageToken: p.pageToken,
      maxResults: p.maxResults ?? 50,
      includeSpamTrash: p.includeSpamTrash || undefined
    }),
  getThread: (id, format) =>
    get<GThread>(`/threads/${id}`, {
      format,
      metadataHeaders: format === 'metadata' ? META_HEADERS : undefined
    }),
  getThreads: async (ids) => {
    const res = await batchGet<GThread>(ids.map((id) => `/threads/${encodeURIComponent(id)}${qs({ format: 'metadata', metadataHeaders: META_HEADERS })}`));
    return res;
  },
  getLabels: async (ids) => batchGet<GLabel>(ids.map((id) => `/labels/${encodeURIComponent(id)}`)),
  history: async (start) => {
    try {
      const r = await get<{ history?: unknown[]; historyId?: string; nextPageToken?: string }>('/history', {
        startHistoryId: start,
        maxResults: 1,
        fields: 'history/id,historyId,nextPageToken'
      });
      return { changed: !!(r.history?.length || r.nextPageToken), historyId: r.historyId };
    } catch (e) {
      // Too old a starting point (Google keeps about a week): treat everything as changed.
      if (e instanceof ApiError && e.status === 404) return { changed: true };
      throw e;
    }
  },
  modifyThread: async (id, add, remove) => {
    await post(`/threads/${id}/modify`, { addLabelIds: add, removeLabelIds: remove });
  },
  trashThread: async (id) => {
    await post(`/threads/${id}/trash`);
  },
  untrashThread: async (id) => {
    await post(`/threads/${id}/untrash`);
  },
  getAttachment: async (mid, aid) => (await get<{ data: string }>(`/messages/${mid}/attachments/${aid}`)).data,
  getRawMessage: async (mid) => (await get<GMessage>(`/messages/${mid}`, { format: 'raw' })).raw ?? '',
  send: (raw, threadId) => post<GMessage>('/messages/send', { raw, threadId }),
  listDrafts: async () => {
    const out: GDraft[] = [];
    let pageToken: string | undefined;
    do {
      const r = await get<{ drafts?: GDraft[]; nextPageToken?: string }>('/drafts', { pageToken, maxResults: 500 });
      out.push(...(r.drafts ?? []));
      pageToken = r.nextPageToken;
    } while (pageToken && out.length < 2000);
    return out;
  },
  getDraft: (id) => get<GDraft>(`/drafts/${id}`, { format: 'full' }),
  createDraft: (raw, threadId) => post<GDraft>('/drafts', { message: { raw, threadId } }),
  updateDraft: (id, raw, threadId) =>
    request<GDraft>(`${GMAIL}/drafts/${id}`, { method: 'PUT', body: JSON.stringify({ id, message: { raw, threadId } }) }),
  deleteDraft: (id) => request<void>(`${GMAIL}/drafts/${id}`, { method: 'DELETE' }),
  sendDraft: (id) => post<GMessage>('/drafts/send', { id }),
  listSendAs: async () => (await get<{ sendAs?: GSendAs[] }>('/settings/sendAs')).sendAs ?? [],
  updateSendAs: (email, patch) =>
    request<GSendAs>(`${GMAIL}/settings/sendAs/${encodeURIComponent(email)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    }),
  getVacation: () => get<GVacation>('/settings/vacation'),
  setVacation: (v) => request<GVacation>(`${GMAIL}/settings/vacation`, { method: 'PUT', body: JSON.stringify(v) }),
  listFilters: async () => (await get<{ filter?: GFilter[] }>('/settings/filters')).filter ?? [],
  createFilter: (f) => post<GFilter>('/settings/filters', f),
  deleteFilter: (id) => request<void>(`${GMAIL}/settings/filters/${id}`, { method: 'DELETE' }),
  getImap: () => get('/settings/imap'),
  getPop: () => get('/settings/pop'),
  getAutoForwarding: () => get('/settings/autoForwarding'),
  todayEvents: async () => {
    const from = startOfDay();
    const to = new Date(from.getTime() + 86_400_000);
    const hex = (c?: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : undefined);
    const [r, cal, labelled] = await Promise.all([
      // eventLabelVersion=1 makes Google include each event's label (Calendar's colour labels since mid-2026).
      request<{ items?: CalendarEvent[] }>('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        query: { timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 20, eventLabelVersion: 1 }
      }),
      // The calendar's own colour, for events without one. Needs the calendar-list permission; falls back to Google's default.
      request<{ backgroundColor?: string }>('https://www.googleapis.com/calendar/v3/users/me/calendarList/primary').catch(() => ({ backgroundColor: undefined })),
      // The calendar's colour labels (id → colour). Needs the calendars permission; without it, labelled events use the older colours.
      request<{ labelProperties?: { eventLabels?: { id?: string; backgroundColor?: string }[] } }>('https://www.googleapis.com/calendar/v3/calendars/primary', {
        query: { fields: 'labelProperties', eventLabelVersion: 1 }
      }).catch(() => ({ labelProperties: undefined }))
    ]);
    const labels = new Map<string, string>();
    for (const l of labelled.labelProperties?.eventLabels ?? []) {
      const c = hex(l.backgroundColor);
      if (l.id && c) labels.set(l.id, c);
    }
    const base = hex(cal.backgroundColor) ?? CALENDAR_DEFAULT;
    return (r.items ?? []).map((e) => ({
      ...e,
      color: (e.eventLabelId && labels.get(e.eventLabelId)) || (e.colorId && EVENT_COLORS[e.colorId]) || base
    }));
  },
  listTasks: async () => {
    const r = await request<{ items?: TaskItem[] }>('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', {
      query: { showCompleted: false, maxResults: 50 }
    });
    return r.items ?? [];
  },
  addTask: (title, notes) =>
    request<TaskItem>('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', {
      method: 'POST',
      body: JSON.stringify({ title, notes })
    }),
  completeTask: async (id, done) => {
    await request(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: done ? 'completed' : 'needsAction' })
    });
  },
  listKeepNotes: async () => {
    const out: KeepNote[] = [];
    let pageToken: string | undefined;
    // No filter: Google leaves trashed notes out by default, and it refuses some filter spellings (400).
    for (let page = 0; page < 3; page++) {
      const r = await request<{ notes?: GKeepNote[]; nextPageToken?: string }>(`${KEEP}/notes`, { keep: true, query: { pageSize: 50, pageToken } });
      out.push(...(r.notes ?? []).map(toKeepNote));
      pageToken = r.nextPageToken;
      if (!pageToken) break;
    }
    return out.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
  },
  createKeepNote: async (title, text) =>
    toKeepNote(await request<GKeepNote>(`${KEEP}/notes`, { keep: true, method: 'POST', body: JSON.stringify({ title, body: { text: { text } } }) })),
  deleteKeepNote: async (name) => {
    if (!/^notes\/[\w-]+$/.test(name)) throw new ApiError(400, 'bad note');
    await request(`${KEEP}/${name}`, { keep: true, method: 'DELETE' });
  },
  loadSettings: async () => {
    if (!settingsFileId) {
      const r = await request<{ files?: { id: string }[] }>(DRIVE, {
        query: { spaces: 'appDataFolder', q: `name = '${SETTINGS_FILE}' and trashed = false`, fields: 'files(id)', pageSize: 1 }
      });
      settingsFileId = r.files?.[0]?.id;
    }
    if (!settingsFileId) return null;
    return request<SyncedSettings>(`${DRIVE}/${settingsFileId}`, { query: { alt: 'media' } });
  },
  saveSettings: async (data) => {
    if (!settingsFileId) {
      await gmailBackend.loadSettings();
      if (!settingsFileId) {
        const f = await request<{ id: string }>(DRIVE, {
          method: 'POST',
          body: JSON.stringify({ name: SETTINGS_FILE, parents: ['appDataFolder'], mimeType: 'application/json' })
        });
        settingsFileId = f.id;
      }
    }
    await request(`${DRIVE_UPLOAD}/${settingsFileId}`, { method: 'PATCH', query: { uploadType: 'media' }, body: JSON.stringify(data) });
  },
  loadNotes: async () => {
    const id = await findNotesFile();
    if (!id) return {};
    return cleanNotes(await request<unknown>(`${DRIVE}/${id}`, { query: { alt: 'media' } }));
  },
  saveNotes: async (notes) => {
    let id = await findNotesFile();
    if (!id) {
      const f = await request<{ id: string }>(DRIVE, {
        method: 'POST',
        body: JSON.stringify({ name: NOTES_FILE, parents: ['appDataFolder'], mimeType: 'application/json' })
      });
      id = notesFileId = f.id;
    }
    await request(`${DRIVE_UPLOAD}/${id}`, {
      method: 'PATCH',
      query: { uploadType: 'media' },
      body: JSON.stringify({ version: 1, notes })
    });
  }
};

export async function pool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}
