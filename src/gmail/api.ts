import { config } from '../config';
import { currentToken, dropSession } from '../auth';
import type {
  CalendarEvent,
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
  ListThreadsParams,
  MailBackend,
  NotesMap,
  TaskItem
} from './types';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class AuthRequired extends Error {}

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

async function request<T>(url: string, init: RequestInit & { query?: Query } = {}, attempt = 0): Promise<T> {
  const token = currentToken();
  if (!token) throw new AuthRequired();
  const res = await fetch(url + qs(init.query), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {})
    }
  });
  if (res.status === 401) {
    dropSession();
    throw new AuthRequired();
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 400 * 2 ** attempt + Math.random() * 200));
    return request<T>(url, init, attempt + 1);
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = j?.error?.message || msg;
    } catch {
      /* empty */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
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

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const NOTES_FILE = 'maillo-notes.json';
// Notes saved before the rename to Maillo keep their original file name.
const LEGACY_NOTES_FILE = 'mailmax-notes.json';
let notesFileId: string | undefined;

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
      metadataHeaders: format === 'metadata' ? ['From', 'To', 'Subject', 'Date'] : undefined
    }),
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
