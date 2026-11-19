import { strToB64url } from './mime';
import type {
  GDraft,
  GFilter,
  GLabel,
  GMessage,
  GSendAs,
  GThread,
  GVacation,
  MailBackend,
  NotesMap,
  TaskItem
} from './types';

const ME = 'you@example.com';
const now = Date.now();
const H = 3_600_000;
const D = 24 * H;

interface Seed {
  from: string;
  to?: string;
  subject: string;
  body: string;
  ago: number;
  labels: string[];
  files?: { name: string; type: string; size: number }[];
  ics?: { summary: string; start: Date; end: Date; location: string };
  unsub?: boolean;
}

const seeds: Seed[][] = [
  [
    { from: 'Léa Fontaine <lea@studio.example>', subject: 'Q1 campaign brief: final review', body: 'Kicking off the Q1 brief. First draft attached. Main open question is the audience.', ago: 3 * D, labels: ['INBOX', 'CATEGORY_PERSONAL', 'Label_work'] },
    { from: `Me <${ME}>`, to: 'Léa Fontaine <lea@studio.example>', subject: 'Re: Q1 campaign brief: final review', body: 'Thanks Léa. A few notes on the audience section: lead with the people who already know us.', ago: 2 * D, labels: ['SENT', 'Label_work'] },
    { from: 'Léa Fontaine <lea@studio.example>', subject: 'Re: Q1 campaign brief: final review', body: '<p>Hi,</p><p>Attached is v3 of the Q1 brief. I folded in your notes on the audience section and tightened the key message to a single line.</p><p>Two things I still need before Friday:</p><ol><li>Sign-off on the budget split (60/40 paid vs. owned)</li><li>The final list of channels for launch week</li></ol><p>Happy to walk you through it on a quick call Thursday morning.</p><p>Thanks,<br>Léa</p><div class="gmail_quote">On Tue, you wrote:<blockquote>Thanks Léa. A few notes on the audience section.</blockquote></div>', ago: 0.8 * H, labels: ['INBOX', 'UNREAD', 'IMPORTANT', 'CATEGORY_PERSONAL', 'Label_work'], files: [{ name: 'Q1-brief-v3.pdf', type: 'application/pdf', size: 2_400_000 }, { name: 'Budget-split.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 86_000 }] }
  ],
  [
    { from: 'Marcus Chen <marcus@studio.example>', subject: 'Invitation: Design crit @ Thursday 2pm', body: '<p>Bringing the latest checkout flows. Come with one thing you would cut.</p><p>Marcus</p>', ago: 1.3 * H, labels: ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL', 'Label_work'], ics: { summary: 'Design crit', start: new Date(now + 2 * D), end: new Date(now + 2 * D + H), location: 'Video call' } }
  ],
  [
    { from: 'Atlantica Air <noreply@air.example>', subject: 'Your trip is confirmed: K7Q2PX', body: '<table style="width:100%;max-width:560px;font-family:Arial,sans-serif"><tr><td style="background:#0b3a5b;color:#fff;padding:20px;font-size:20px"><b>Booking confirmed</b></td></tr><tr><td style="padding:20px">Thanks for booking with us. Your e-ticket and itinerary are attached.<br><br><img src="https://picsum.photos/seed/flight/520/160" alt="" width="520" height="160"></td></tr></table>', ago: 2.6 * H, labels: ['CATEGORY_PERSONAL', 'Label_travel', 'Label_aside'], files: [{ name: 'E-ticket-K7Q2PX.pdf', type: 'application/pdf', size: 312_000 }] }
  ],
  [
    { from: 'Sofia Reyes <sofia@mail.example>', subject: 'Dinner Friday?', body: 'Dinner Friday? It has been way too long.', ago: 3 * D, labels: ['INBOX', 'CATEGORY_PERSONAL', 'Label_personal'] },
    { from: `Me <${ME}>`, to: 'Sofia Reyes <sofia@mail.example>', subject: 'Re: Dinner Friday?', body: 'Friday works! Where were you thinking?', ago: 2.5 * D, labels: ['SENT'] },
    { from: 'Sofia Reyes <sofia@mail.example>', subject: 'Re: Dinner Friday?', body: 'Perfect, I will book for 7:30. Bringing Daniel if that is ok!\n\nS.', ago: 20 * H, labels: ['INBOX', 'STARRED', 'CATEGORY_PERSONAL', 'Label_personal'] }
  ],
  [
    { from: 'Julien Roy <julien@law.example>', subject: 'Contract draft for review', body: 'Hi,\n\nAttaching the draft agreement. Let me know if clause 4 on usage rights works for you.\n\nJulien', ago: 3.2 * D, labels: ['IMPORTANT', 'CATEGORY_PERSONAL', 'Label_work', 'Label_action'], files: [{ name: 'Agreement-draft-v1.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 148_000 }] }
  ],
  [
    { from: 'Priya Shah <priya@mail.example>', subject: 'Photos from the cottage', body: '12 photos from the weekend. The sunrise ones came out great.', ago: 5 * D, labels: ['CATEGORY_PERSONAL', 'Label_personal', 'Label_aside'], files: [{ name: 'IMG_2041.jpg', type: 'image/jpeg', size: 4_200_000 }, { name: 'IMG_2044.jpg', type: 'image/jpeg', size: 3_800_000 }] }
  ],
  [
    { from: 'Club de design <info@club.example>', subject: 'Soirée des membres : programme de décembre', body: '<p>Bonjour à tous,</p><p>Voici le programme de notre soirée des membres : trois courtes présentations, suivies d’un apéro.</p><p>Au plaisir de vous y voir,<br>L’équipe du Club</p>', ago: 6 * D, labels: ['INBOX', 'CATEGORY_PERSONAL'] }
  ],
  [
    { from: 'Atelier Goods <hello@shop.example>', subject: 'Winter knitwear, 20% off for members', body: '<div style="text-align:center;font-family:Georgia,serif"><h1 style="font-weight:normal">The merino collection is back</h1><img src="https://picsum.photos/seed/knit/560/280" alt="Knitwear" width="560" height="280"><p>Free shipping over $100.</p></div>', ago: 3 * H, labels: ['INBOX', 'UNREAD', 'CATEGORY_PROMOTIONS'], unsub: true }
  ],
  [
    { from: 'Brightline Coffee <rewards@coffee.example>', subject: 'Your loyalty reward is waiting', body: 'You have earned a free bag of beans. Redeem by the end of the month.', ago: 4 * D, labels: ['INBOX', 'CATEGORY_PROMOTIONS'], unsub: true }
  ],
  [
    { from: 'Stride Club <notify@stride.example>', subject: 'Marc and 4 others gave kudos on your run', body: 'Sunday long run · 24.1 km · 5:12 /km', ago: 1 * D, labels: ['INBOX', 'UNREAD', 'CATEGORY_SOCIAL'] }
  ],
  [
    { from: 'Shop Orders <orders@store.example>', subject: 'Your order has shipped', body: 'Arriving Thursday. Track your package from your account.', ago: 5 * H, labels: ['INBOX', 'UNREAD', 'CATEGORY_UPDATES', 'Label_receipts'] }
  ],
  [
    { from: 'City Power <billing@power.example>', subject: 'Your monthly statement is ready', body: 'Amount due: $84.20. View your statement online.', ago: 1.2 * D, labels: ['INBOX', 'CATEGORY_UPDATES', 'Label_finance', 'Label_receipts'] }
  ],
  [
    { from: 'design-systems group <group@lists.example>', subject: 'Weekly digest: 12 new topics', body: 'Token naming, dark mode contrast, variables in components…', ago: 1.1 * D, labels: ['INBOX', 'CATEGORY_FORUMS'] }
  ],
  [
    { from: `Me <${ME}>`, to: 'Product team <team@studio.example>', subject: 'Monthly update', body: 'Highlights: new onboarding shipped, Q1 brief in final review.', ago: 1 * D, labels: ['DRAFT'] }
  ],
  [
    { from: 'Prize Center <winner@prize.example>', subject: 'Congratulations! You have been selected', body: 'Claim your gift card in the next 24 hours.', ago: 1 * D, labels: ['SPAM'] }
  ]
];

let seq = 1;
const threads: GThread[] = [];
const drafts: GDraft[] = [];

function payloadFor(s: Seed, id: string): GMessage['payload'] {
  const isHtml = s.body.trim().startsWith('<');
  const headers = [
    { name: 'From', value: s.from },
    { name: 'To', value: s.to ?? `Me <${ME}>` },
    { name: 'Subject', value: s.subject },
    { name: 'Date', value: new Date(now - s.ago).toUTCString() },
    { name: 'Message-ID', value: `<${id}@demo.example>` }
  ];
  if (s.unsub) headers.push({ name: 'List-Unsubscribe', value: '<https://example.com/unsubscribe>' });
  const parts: NonNullable<GMessage['payload']>['parts'] = [
    {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: isHtml ? 'text/html' : 'text/plain', headers: [{ name: 'Content-Type', value: `${isHtml ? 'text/html' : 'text/plain'}; charset=UTF-8` }], body: { size: s.body.length, data: strToB64url(s.body) } }
      ]
    }
  ];
  if (s.ics) {
    const f = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const ics = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:${s.ics.summary}\r\nDTSTART:${f(s.ics.start)}\r\nDTEND:${f(s.ics.end)}\r\nLOCATION:${s.ics.location}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    parts.push({ mimeType: 'text/calendar', headers: [{ name: 'Content-Type', value: 'text/calendar; charset=UTF-8; method=REQUEST' }], body: { size: ics.length, data: strToB64url(ics) } });
  }
  for (const f of s.files ?? []) {
    parts.push({ mimeType: f.type, filename: f.name, headers: [{ name: 'Content-Disposition', value: `attachment; filename="${f.name}"` }], body: { size: f.size, attachmentId: `att-${f.name}` } });
  }
  return { mimeType: 'multipart/mixed', headers, parts };
}

for (const group of seeds) {
  const tid = `t${seq++}`;
  const messages: GMessage[] = group.map((s) => {
    const id = `m${seq++}`;
    const text = s.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return { id, threadId: tid, labelIds: [...s.labels], snippet: text.slice(0, 140), internalDate: String(now - s.ago), historyId: '1', payload: payloadFor(s, id) };
  });
  threads.push({ id: tid, messages, historyId: '1', snippet: messages[messages.length - 1].snippet });
  if (group.some((s) => s.labels.includes('DRAFT'))) drafts.push({ id: `d${tid}`, message: messages[0] });
}

const labels: GLabel[] = [
  ...['INBOX', 'STARRED', 'IMPORTANT', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'UNREAD', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'].map(
    (id) => ({ id, name: id, type: 'system' as const })
  ),
  { id: 'Label_work', name: 'Work', type: 'user', color: { backgroundColor: '#4a86e8', textColor: '#ffffff' } },
  { id: 'Label_personal', name: 'Personal', type: 'user', color: { backgroundColor: '#ff7537', textColor: '#ffffff' } },
  { id: 'Label_travel', name: 'Travel', type: 'user', color: { backgroundColor: '#2da2bb', textColor: '#ffffff' } },
  { id: 'Label_finance', name: 'Finance', type: 'user', color: { backgroundColor: '#8e63ce', textColor: '#ffffff' } },
  { id: 'Label_receipts', name: 'Finance/Receipts', type: 'user', color: { backgroundColor: '#8e63ce', textColor: '#ffffff' } },
  { id: 'Label_aside', name: 'Set aside', type: 'user' },
  { id: 'Label_action', name: 'Action required', type: 'user' }
];

let sendAs: GSendAs[] = [{ sendAsEmail: ME, displayName: 'Demo User', isPrimary: true, isDefault: true, signature: '<div><b>Demo User</b></div><div><a href="mailto:you@example.com">you@example.com</a></div><div style="color:#000000">555 0100</div>' }];
let vacation: GVacation = { enableAutoReply: false, responseSubject: '', responseBodyPlainText: '' };
let filters: GFilter[] = [
  { id: 'f1', criteria: { from: '@studio.example' }, action: { addLabelIds: ['Label_work', 'IMPORTANT'] } },
  { id: 'f2', criteria: { subject: 'receipt OR invoice OR statement' }, action: { addLabelIds: ['Label_receipts'], removeLabelIds: ['INBOX'] } }
];
let notes: NotesMap = {};
let tasks: TaskItem[] = [
  { id: 'k1', title: 'Sign off Q1 budget split', status: 'needsAction', due: new Date(now + 3 * D).toISOString() },
  { id: 'k2', title: 'Send launch-week channel list', status: 'needsAction' }
];

const wait = <T>(v: T, ms = 120): Promise<T> => new Promise((r) => setTimeout(() => r(structuredClone(v)), ms));

function threadLabels(t: GThread): Set<string> {
  const s = new Set<string>();
  t.messages?.forEach((m) => m.labelIds?.forEach((l) => s.add(l)));
  return s;
}

function matches(t: GThread, q: string): boolean {
  const ls = threadLabels(t);
  const tokens = q.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  const text = (t.messages ?? [])
    .map((m) => [m.snippet, ...(m.payload?.headers ?? []).map((h) => h.value)].join(' '))
    .join(' ')
    .toLowerCase();
  const catMap: Record<string, string> = { primary: 'CATEGORY_PERSONAL', social: 'CATEGORY_SOCIAL', promotions: 'CATEGORY_PROMOTIONS', updates: 'CATEGORY_UPDATES', forums: 'CATEGORY_FORUMS' };
  for (const raw of tokens) {
    const neg = raw.startsWith('-');
    const tok = (neg ? raw.slice(1) : raw).toLowerCase().replace(/"/g, '');
    let ok = true;
    const [k, v] = tok.includes(':') ? tok.split(/:(.*)/s) : ['', tok];
    if (k === 'in' || k === 'is' || k === 'label') {
      const map: Record<string, string> = { inbox: 'INBOX', starred: 'STARRED', important: 'IMPORTANT', sent: 'SENT', drafts: 'DRAFT', draft: 'DRAFT', spam: 'SPAM', trash: 'TRASH', unread: 'UNREAD', snoozed: 'SNOOZED', scheduled: 'SCHEDULED' };
      if (v === 'read') ok = !ls.has('UNREAD');
      else if (v === 'anywhere') ok = true;
      else ok = ls.has(map[v] ?? v);
    } else if (k === 'category') ok = ls.has(catMap[v] ?? '');
    else if (k === 'has' && v === 'attachment') ok = !!t.messages?.some((m) => m.payload?.parts?.some((p) => p.filename));
    else if (k === 'from' || k === 'to' || k === 'subject') {
      ok = !!t.messages?.some((m) => (m.payload?.headers ?? []).some((h) => h.name.toLowerCase() === k && h.value.toLowerCase().includes(v)));
    } else if (k === 'newer_than' || k === 'older_than' || k === 'after' || k === 'before') ok = true;
    else ok = text.includes(tok);
    if (neg ? ok : !ok) return false;
  }
  return true;
}

function latest(t: GThread) {
  return Math.max(...(t.messages ?? []).map((m) => Number(m.internalDate)));
}

function bump(t: GThread) {
  t.historyId = String(Number(t.historyId ?? '1') + 1);
}

function decodeRaw(raw: string) {
  const bin = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
  const text = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  const [head] = text.split(/\r\n\r\n/);
  const headers = head.split(/\r\n/).filter((l) => /^[A-Za-z-]+: /.test(l)).map((l) => ({ name: l.split(':')[0], value: l.slice(l.indexOf(':') + 2) }));
  const htmlB64 = /Content-Type: text\/html[^]*?\r\n\r\n([^]*?)\r\n--/.exec(text)?.[1]?.replace(/\r\n/g, '') ?? '';
  const html = htmlB64 ? new TextDecoder().decode(Uint8Array.from(atob(htmlB64), (c) => c.charCodeAt(0))) : '';
  return { headers, html };
}

function messageFromRaw(raw: string, threadId: string, labelIds: string[]): GMessage {
  const { headers, html } = decodeRaw(raw);
  const id = `m${seq++}`;
  return {
    id,
    threadId,
    labelIds,
    snippet: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140),
    internalDate: String(Date.now()),
    payload: { mimeType: 'multipart/alternative', headers, parts: [{ mimeType: 'text/html', headers: [{ name: 'Content-Type', value: 'text/html; charset=UTF-8' }], body: { size: html.length, data: strToB64url(html) } }] }
  };
}

function attachToThread(msg: GMessage, threadId?: string): GThread {
  let t = threadId ? threads.find((x) => x.id === threadId) : undefined;
  if (!t) {
    t = { id: `t${seq++}`, messages: [], historyId: '1' };
    threads.push(t);
  }
  msg.threadId = t.id;
  t.messages!.push(msg);
  bump(t);
  return t;
}

export const demoBackend: MailBackend = {
  demo: true,
  profile: () => wait({ emailAddress: ME, messagesTotal: 18904, threadsTotal: 2431 }),
  userInfo: () => wait({ name: 'Demo User' }),
  contactPhotos: () => wait({}),
  searchPeople: () => wait([]),
  listLabels: () => wait(labels),
  getLabel: (id) => {
    const l = labels.find((x) => x.id === id)!;
    const ts = threads.filter((t) => threadLabels(t).has(id));
    return wait({ ...l, threadsTotal: ts.length, threadsUnread: ts.filter((t) => threadLabels(t).has('UNREAD')).length });
  },
  createLabel: (name) => {
    const l: GLabel = { id: `Label_${seq++}`, name, type: 'user' };
    labels.push(l);
    return wait(l);
  },
  updateLabel: (id, patch) => {
    const l = labels.find((x) => x.id === id)!;
    Object.assign(l, patch);
    return wait(l);
  },
  deleteLabel: (id) => {
    labels.splice(labels.findIndex((x) => x.id === id), 1);
    threads.forEach((t) => t.messages?.forEach((m) => (m.labelIds = m.labelIds?.filter((x) => x !== id))));
    return wait(undefined);
  },
  listThreads: (p) => {
    const list = threads
      .filter((t) => {
        const ls = threadLabels(t);
        if (!p.includeSpamTrash && (ls.has('SPAM') || ls.has('TRASH'))) {
          const wantsSpamTrash = p.labelIds?.some((l) => l === 'SPAM' || l === 'TRASH');
          if (!wantsSpamTrash) return false;
        }
        if (p.labelIds?.some((l) => !ls.has(l))) return false;
        return p.q ? matches(t, p.q) : true;
      })
      .sort((a, b) => latest(b) - latest(a));
    const start = Number(p.pageToken ?? 0);
    const size = p.maxResults ?? 50;
    const page = list.slice(start, start + size);
    return wait({
      threads: page.map((t) => ({ id: t.id, snippet: t.messages?.at(-1)?.snippet, historyId: t.historyId })),
      nextPageToken: start + size < list.length ? String(start + size) : undefined,
      resultSizeEstimate: list.length
    });
  },
  getThread: (id) => wait(threads.find((t) => t.id === id)!, 80),
  modifyThread: (id, add, remove) => {
    const t = threads.find((x) => x.id === id);
    t?.messages?.forEach((m) => {
      const s = new Set(m.labelIds);
      add.forEach((l) => s.add(l));
      remove.forEach((l) => s.delete(l));
      m.labelIds = [...s];
    });
    if (t) bump(t);
    return wait(undefined, 60);
  },
  trashThread: (id) => demoBackend.modifyThread(id, ['TRASH'], ['INBOX']),
  untrashThread: (id) => demoBackend.modifyThread(id, ['INBOX'], ['TRASH']),
  getAttachment: () => wait(strToB64url('This is a sample attachment from the demo.')),
  getRawMessage: (mid) => {
    const m = threads.flatMap((t) => t.messages ?? []).find((x) => x.id === mid);
    const head = (m?.payload?.headers ?? []).map((h) => `${h.name}: ${h.value}`).join('\r\n');
    return wait(strToB64url(`${head}\r\n\r\n(demo message)`));
  },
  send: (raw, threadId) => {
    const msg = messageFromRaw(raw, threadId ?? '', ['SENT']);
    attachToThread(msg, threadId);
    return wait(msg, 300);
  },
  listDrafts: () => wait(drafts),
  getDraft: (id) => wait(drafts.find((d) => d.id === id)!),
  createDraft: (raw, threadId) => {
    const msg = messageFromRaw(raw, threadId ?? '', ['DRAFT']);
    attachToThread(msg, threadId);
    const d = { id: `d${seq++}`, message: msg };
    drafts.push(d);
    return wait(d);
  },
  updateDraft: (id, raw) => {
    const d = drafts.find((x) => x.id === id)!;
    const t = threads.find((x) => x.id === d.message.threadId)!;
    const fresh = messageFromRaw(raw, t.id, ['DRAFT']);
    fresh.id = d.message.id;
    t.messages = t.messages!.map((m) => (m.id === fresh.id ? fresh : m));
    d.message = fresh;
    bump(t);
    return wait(d);
  },
  deleteDraft: (id) => {
    const i = drafts.findIndex((x) => x.id === id);
    if (i >= 0) {
      const d = drafts[i];
      drafts.splice(i, 1);
      const t = threads.find((x) => x.id === d.message.threadId);
      if (t) {
        t.messages = t.messages!.filter((m) => m.id !== d.message.id);
        if (!t.messages.length) threads.splice(threads.indexOf(t), 1);
      }
    }
    return wait(undefined);
  },
  sendDraft: (id) => {
    const d = drafts.find((x) => x.id === id)!;
    d.message.labelIds = ['SENT'];
    d.message.internalDate = String(Date.now());
    drafts.splice(drafts.indexOf(d), 1);
    const t = threads.find((x) => x.id === d.message.threadId);
    if (t) bump(t);
    return wait(d.message, 300);
  },
  listSendAs: () => wait(sendAs),
  updateSendAs: (email, patch) => {
    sendAs = sendAs.map((s) => (s.sendAsEmail === email ? { ...s, ...patch } : s));
    return wait(sendAs.find((s) => s.sendAsEmail === email)!);
  },
  getVacation: () => wait(vacation),
  setVacation: (v) => {
    vacation = v;
    return wait(v);
  },
  listFilters: () => wait(filters),
  createFilter: (f) => {
    const nf = { ...f, id: `f${seq++}` };
    filters = [...filters, nf];
    return wait(nf);
  },
  deleteFilter: (id) => {
    filters = filters.filter((f) => f.id !== id);
    return wait(undefined);
  },
  getImap: () => wait({ enabled: true }),
  getPop: () => wait({ accessWindow: 'disabled' }),
  getAutoForwarding: () => wait({ enabled: false }),
  todayEvents: () => {
    const d = (h: number, m = 0) => {
      const x = new Date();
      x.setHours(h, m, 0, 0);
      return x.toISOString();
    };
    return wait([
      { id: 'e1', summary: 'Weekly sync', start: { dateTime: d(10) }, end: { dateTime: d(10, 30) }, color: '#039be5', hangoutLink: 'https://meet.google.com/abc-defg-hij' },
      { id: 'e2', summary: 'Lunch', start: { dateTime: d(12, 30) }, end: { dateTime: d(13, 30) }, color: '#33b679' },
      { id: 'e3', summary: 'Q1 brief review', start: { dateTime: d(16) }, end: { dateTime: d(16, 45) }, color: '#f4511e', location: 'https://example.zoom.us/j/123456789' },
      { id: 'e4', summary: 'Late call', start: { dateTime: d(23, 30) }, end: { dateTime: d(23, 59) }, color: '#8e24aa', description: 'Join: https://teams.microsoft.com/l/meetup-join/abc' }
    ]);
  },
  listTasks: () => wait(tasks.filter((x) => x.status !== 'completed')),
  addTask: (title, notes) => {
    const k: TaskItem = { id: `k${seq++}`, title, notes, status: 'needsAction' };
    tasks = [k, ...tasks];
    return wait(k);
  },
  completeTask: (id, done) => {
    tasks = tasks.map((k) => (k.id === id ? { ...k, status: done ? 'completed' : 'needsAction' } : k));
    return wait(undefined);
  },
  loadNotes: () => wait(notes),
  saveNotes: (n) => {
    notes = structuredClone(n);
    return wait(undefined);
  }
};

const bill = threads.find((x) => x.messages?.[0]?.payload?.headers?.some((h) => h.name === 'Subject' && h.value.startsWith('Your monthly statement')));
if (bill) notes[bill.id] = { text: 'Paid Nov 14 by credit card. Confirmation #A-5521.', updated: now - 2 * D };

let delivered = false;

/** Demo only: one new message "arrives", so notifications can be tried without a real mailbox. */
export function deliverDemoMail(): boolean {
  if (delivered) return false;
  delivered = true;
  const s: Seed = {
    from: 'Noor Haddad <noor@studio.example>',
    subject: 'Coffee on Friday?',
    body: '<p>Hi! I’m around the office on Friday morning. Coffee at 10 by the window, if you’re free?</p><p>Noor</p>',
    ago: 0,
    labels: ['INBOX', 'UNREAD', 'IMPORTANT', 'CATEGORY_PERSONAL']
  };
  const tid = `t${seq++}`;
  const id = `m${seq++}`;
  const msg: GMessage = { id, threadId: tid, labelIds: [...s.labels], snippet: 'Hi! I’m around the office on Friday morning. Coffee at 10 by the window, if you’re free?', internalDate: String(Date.now()), historyId: '1', payload: payloadFor(s, id) };
  threads.push({ id: tid, messages: [msg], historyId: '1', snippet: msg.snippet });
  return true;
}
