import { useEffect, useState } from 'preact/hooks';
import { config } from '../config';
import type { CalendarEvent, KeepNote, TaskItem } from '../gmail/types';
import { locale, t } from '../i18n';
import { getPrefs, setPrefs } from '../prefs';
import { api, toast, type AppState } from '../store';
import { CIcon, type ColorIconName } from './ColorIcons';
import { ContactsPanel } from './ContactsPanel';
import { Icon } from './Icon';

export function SidePanel({ s }: { s: AppState }) {
  const titles = { calendar: t('panel.calendar'), tasks: t('panel.tasks'), keep: t('panel.keep'), contacts: t('panel.contacts') };
  const p = s.panel!;
  const apps = { calendar: config.links.calendar, tasks: 'https://tasks.google.com/', keep: config.links.keep, contacts: config.links.contacts };
  const open = t('panel.open', { name: titles[p] });
  return (
    <aside class="panel" aria-label={titles[p]}>
      <div class="panel-head">
        <span style={{ flex: 1 }}>{titles[p]}</span>
        <a class="ib sm panel-open" href={apps[p]} target="_blank" rel="noopener noreferrer" aria-label={open} title={open}>
          <Icon name="arrowUpRight" size={18} />
        </a>
      </div>
      <div class="panel-body">
        {p === 'calendar' && <Calendar />}
        {p === 'tasks' && <Tasks />}
        {p === 'keep' && <Keep />}
        {p === 'contacts' && <ContactsPanel s={s} />}
      </div>
    </aside>
  );
}

/** A friendly empty panel: a big icon, a line or two, and what to do next. */
export function PanelEmpty({ icon, title, sub, children }: { icon: ColorIconName; title: string; sub?: string; children?: preact.ComponentChildren }) {
  return (
    <div class={`pempty pempty-${icon}`}>
      <span class="pempty-art" aria-hidden="true">
        <span class="pempty-ring" />
        <span class="pempty-ring r2" />
        <CIcon name={icon} size={40} />
      </span>
      <b>{title}</b>
      {sub && <span>{sub}</span>}
      {children && <div class="pempty-actions">{children}</div>}
    </div>
  );
}

function time(e: CalendarEvent) {
  const loc = locale();
  if (e.start?.date) return t('misc.today');
  const s = e.start?.dateTime ? new Date(e.start.dateTime) : undefined;
  const en = e.end?.dateTime ? new Date(e.end.dateTime) : undefined;
  const f = (d?: Date) => d?.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' }) ?? '';
  return `${f(s)} – ${f(en)}`;
}

const CALL_LINK = /https:\/\/(?:[\w-]+\.)*(?:zoom\.us\/(?:j|my|w)\/|teams\.microsoft\.com\/l\/meetup-join\/|teams\.live\.com\/meet\/|meet\.google\.com\/|[\w-]+\.webex\.com\/)[^\s"'<>)]*/i;

/** The event's video-call link: Google Meet, or a Meet/Zoom/Teams/Webex link in its conference data, location or description. */
function joinLink(e: CalendarEvent): string | undefined {
  const fromConf = e.conferenceData?.entryPoints?.find((x) => x.entryPointType === 'video')?.uri;
  const link = e.hangoutLink || fromConf || e.location?.match(CALL_LINK)?.[0] || e.description?.match(CALL_LINK)?.[0];
  // Links pulled from text can end with sentence punctuation.
  const clean = link?.replace(/[.,;:!?]+$/, '');
  return clean && /^https:\/\//.test(clean) ? clean : undefined;
}

function Calendar() {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [view, setView] = useState(getPrefs().calView);
  useEffect(() => {
    if (!config.features.calendar && !config.demo) return;
    api.todayEvents().then(setEvents).catch((e) => toast(t('toast.error', { msg: e.message })));
  }, []);
  if (!config.features.calendar && !config.demo)
    return (
      <PanelEmpty icon="calendar" title={t('empty.calOffTitle')} sub={t('empty.calOff')} />
    );
  const today = new Date().toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric' });
  const pick = (v: 'list' | 'day') => {
    setView(v);
    setPrefs({ calView: v });
  };
  return (
    <>
      <div class="cal-top">
        <span class="caps">{t('panel.today')} · {today}</span>
        <div class="cal-views" role="radiogroup" aria-label={t('panel.calView')}>
          {(['list', 'day'] as const).map((v) => {
            const label = v === 'list' ? t('panel.calList') : t('panel.calDay');
            return (
              <button type="button" role="radio" aria-checked={view === v} aria-label={label} title={label} onClick={() => pick(v)}>
                <Icon name={v === 'list' ? 'list' : 'calendar'} size={15} />
              </button>
            );
          })}
        </div>
      </div>
      {events === null && <div class="skeleton" style={{ margin: 0 }} />}
      {events?.length === 0 && <PanelEmpty icon="calendar" title={t('panel.noEvents')} sub={t('empty.calSub')} />}
      {!!events?.length && (view === 'day' ? <DayView events={events} /> : events.map((e) => <EventCard e={e} />))}
    </>
  );
}

function EventCard({ e }: { e: CalendarEvent }) {
  const join = joinLink(e);
  const ended = !!e.end?.dateTime && new Date(e.end.dateTime).getTime() < Date.now();
  return (
    <div class={`pcard ev ${ended ? 'past' : ''}`} style={{ '--ec': e.color ?? 'var(--c-inbox)' }}>
      <span class="bar" />
      <a class="ev-main" href={e.htmlLink ?? config.links.calendar} target="_blank" rel="noopener noreferrer">
        <b>{e.summary || t('panel.noTitle')}</b>
        <span>{time(e)}</span>
      </a>
      {join && !ended && (
        <a class="ev-join" href={join} target="_blank" rel="noopener noreferrer" aria-label={t('panel.joinCall', { name: e.summary || t('panel.noTitle') })}>
          <Icon name="video" size={14} />
          {t('panel.join')}
        </a>
      )}
    </div>
  );
}

/** Minutes since local midnight, clamped to today. */
function minutesOf(iso: string | undefined, day: Date, fallback: number) {
  if (!iso) return fallback;
  const m = (new Date(iso).getTime() - day.getTime()) / 60_000;
  return Math.max(0, Math.min(1440, m));
}

interface Placed {
  e: CalendarEvent;
  top: number;
  end: number;
  col: number;
  cols: number;
}

/** Side by side columns for events that overlap, like Google Calendar's day view. */
function place(events: CalendarEvent[], day: Date): Placed[] {
  const items = events
    .map((e) => {
      const top = minutesOf(e.start?.dateTime, day, 0);
      // Very short events still get room for their title.
      return { e, top, end: Math.max(minutesOf(e.end?.dateTime, day, top + 30), top + 20), col: 0, cols: 1 };
    })
    .sort((a, b) => a.top - b.top || b.end - a.end);
  let group: Placed[] = [];
  let groupEnd = -1;
  const close = () => {
    const n = Math.max(...group.map((g) => g.col)) + 1;
    group.forEach((g) => (g.cols = n));
    group = [];
  };
  for (const it of items) {
    if (group.length && it.top >= groupEnd) close();
    const taken = new Set(group.filter((g) => g.end > it.top).map((g) => g.col));
    let col = 0;
    while (taken.has(col)) col++;
    it.col = col;
    group.push(it);
    groupEnd = Math.max(groupEnd, it.end);
  }
  if (group.length) close();
  return items;
}

/** Smallest hour height; the grid grows to fill the panel. */
const HOUR_PX = 40;

function DayView({ events }: { events: CalendarEvent[] }) {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const [now, setNow] = useState(() => (Date.now() - day.getTime()) / 60_000);
  useEffect(() => {
    const id = window.setInterval(() => setNow((Date.now() - day.getTime()) / 60_000), 60_000);
    return () => clearInterval(id);
  }, []);
  const allDay = events.filter((e) => e.start?.date);
  const timed = place(events.filter((e) => !e.start?.date), day);
  // Show working hours, widened to fit the day's events and the current time.
  const first = Math.min(8, ...timed.map((p) => Math.floor(p.top / 60)), Math.floor(now / 60));
  const last = Math.max(18, ...timed.map((p) => Math.ceil(p.end / 60)), Math.ceil(now / 60 + 0.01));
  const from = Math.max(0, first);
  const to = Math.min(24, last);
  const hours = Array.from({ length: to - from }, (_, i) => from + i);
  const y = (min: number) => `${((min - from * 60) / ((to - from) * 60)) * 100}%`;
  const loc = locale();
  const hourLabel = (h: number) => {
    const d = new Date(day);
    d.setHours(h);
    return d.toLocaleTimeString(loc, { hour: 'numeric' });
  };
  return (
    <div class="dayv">
      {allDay.length > 0 && (
        <div class="dayv-allday">
          <span class="dayv-lbl">{t('panel.allDay')}</span>
          <div>
            {allDay.map((e) => (
              <a class="dayv-chip" style={{ '--ec': e.color ?? 'var(--c-inbox)' }} href={e.htmlLink ?? config.links.calendar} target="_blank" rel="noopener noreferrer">
                {e.summary || t('panel.noTitle')}
              </a>
            ))}
          </div>
        </div>
      )}
      <div class="dayv-grid" style={{ minHeight: `calc(${(to - from) * HOUR_PX}px * var(--ts, 1))` }}>
        {hours.map((h) => (
          <div class="dayv-hour" style={{ top: y(h * 60) }}>
            <span>{hourLabel(h)}</span>
          </div>
        ))}
        <div class="dayv-events">
          {timed.map(({ e, top, end, col, cols }) => {
            const join = joinLink(e);
            const ended = end <= now;
            const short = end - top < 45;
            return (
              <div
                class={`dayv-ev ${ended ? 'past' : ''} ${short ? 'short' : ''}`}
                style={{ '--ec': e.color ?? 'var(--c-inbox)', top: y(top), height: `calc(${y(end)} - ${y(top)} - 2px)`, left: `${(col / cols) * 100}%`, width: `calc(${100 / cols}% - 2px)` }}
              >
                <a class="dayv-main" href={e.htmlLink ?? config.links.calendar} target="_blank" rel="noopener noreferrer">
                  <b>{e.summary || t('panel.noTitle')}</b>
                  <span>{time(e)}</span>
                </a>
                {join && !ended && (
                  <a class="dayv-join" href={join} target="_blank" rel="noopener noreferrer" aria-label={t('panel.joinCall', { name: e.summary || t('panel.noTitle') })} title={t('panel.join')}>
                    <Icon name="video" size={13} />
                  </a>
                )}
              </div>
            );
          })}
          {now >= from * 60 && now <= to * 60 && <div class="dayv-now" style={{ top: y(now) }} aria-hidden="true" />}
        </div>
      </div>
    </div>
  );
}

function Tasks() {
  const [items, setItems] = useState<TaskItem[] | null>(null);
  const [title, setTitle] = useState('');
  const load = () => api.listTasks().then(setItems).catch((e) => toast(t('toast.error', { msg: e.message })));
  useEffect(() => {
    if (config.features.tasks || config.demo) load();
  }, []);
  if (!config.features.tasks && !config.demo)
    return (
      <PanelEmpty icon="tasks" title={t('empty.tasksOffTitle')} sub={t('empty.tasksOff')} />
    );
  return (
    <>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          await api.addTask(title.trim());
          setTitle('');
          load();
        }}
      >
        <label class="sr-only" for="task-new">{t('panel.addTask')}</label>
        <input id="task-new" class="input" style={{ width: '100%' }} placeholder={t('panel.addTask')} value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
      </form>
      {items === null && <div class="skeleton" style={{ margin: 0 }} />}
      {items?.length === 0 && <PanelEmpty icon="tasks" title={t('panel.noTasks')} sub={t('empty.tasksSub')} />}
      {items?.map((k) => (
        <label class="pcard" style={{ cursor: 'pointer', alignItems: 'flex-start' }}>
          <input
            type="checkbox"
            style={{ width: '16px', height: '16px', marginTop: '2px', accentColor: 'var(--ink)' }}
            onChange={async () => {
              await api.completeTask(k.id, true);
              load();
            }}
          />
          <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: 'calc(13px * var(--ts, 1))', fontWeight: 500 }}>{k.title}</span>
            {k.due && <span style={{ fontSize: 'calc(12px * var(--ts, 1))', color: 'var(--muted)' }}>{new Date(k.due).toLocaleDateString(locale(), { month: 'short', day: 'numeric' })}</span>}
          </span>
        </label>
      ))}
    </>
  );
}


function Keep() {
  const [notes, setNotes] = useState<KeepNote[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const on = config.features.keep || config.demo;
  const load = () =>
    api.listKeepNotes().then(
      (n) => {
        setNotes(n);
        setFailed(false);
      },
      () => setFailed(true)
    );
  useEffect(() => {
    if (on) load();
  }, []);
  if (!on)
    return (
      <PanelEmpty icon="keep" title={t('empty.keepOffTitle')} sub={t('empty.keepOff')} />
    );
  const add = async (e: Event) => {
    e.preventDefault();
    if (!title.trim() && !text.trim()) return;
    setBusy(true);
    try {
      const n = await api.createKeepNote(title.trim(), text.trim());
      setNotes((cur) => [n, ...(cur ?? [])]);
      setTitle('');
      setText('');
    } catch (er) {
      toast(t('toast.error', { msg: er instanceof Error ? er.message : String(er) }));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (n: KeepNote) => {
    if (!confirm(t('keep.deleteConfirm'))) return;
    setNotes((cur) => cur?.filter((x) => x.name !== n.name) ?? null);
    try {
      await api.deleteKeepNote(n.name);
    } catch (er) {
      toast(t('toast.error', { msg: er instanceof Error ? er.message : String(er) }));
      load();
    }
  };
  return (
    <>
      <form class="keep-new" onSubmit={add}>
        <label class="sr-only" for="keep-title">{t('keep.title')}</label>
        <input id="keep-title" class="bare" placeholder={t('keep.title')} value={title} disabled={busy} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
        <label class="sr-only" for="keep-text">{t('keep.take')}</label>
        <textarea id="keep-text" class="bare" rows={2} placeholder={t('keep.take')} value={text} disabled={busy}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') add(e);
          }}
        />
        {(title.trim() || text.trim()) && <button class="btn sm primary" disabled={busy}>{t('keep.add')}</button>}
      </form>
      {failed && (
        <PanelEmpty icon="keep" title={t('keep.failedTitle')} sub={t('keep.failed')}>
          <button class="btn sm" onClick={load}>{t('list.retry')}</button>
        </PanelEmpty>
      )}
      {!failed && notes === null && <div class="skeleton" style={{ margin: 0 }} />}
      {!failed && notes?.length === 0 && <PanelEmpty icon="keep" title={t('keep.none')} sub={t('keep.noneSub')} />}
      {notes?.map((n) => (
        <div class="pcard keep-note">
          <div class="keep-body">
            {n.title && <b>{n.title}</b>}
            {n.text && <p>{n.text.length > 400 ? `${n.text.slice(0, 400)}…` : n.text}</p>}
            {n.items && (
              <ul>
                {n.items.slice(0, 8).map((i) => (
                  <li class={i.checked ? 'done' : ''}><Icon name={i.checked ? 'check' : 'square'} size={13} />{i.text}</li>
                ))}
                {n.items.length > 8 && <li class="more">{t('pile.more', { n: n.items.length - 8 })}</li>}
              </ul>
            )}
          </div>
          <button class="ib sm keep-del" aria-label={t('keep.delete')} title={t('keep.delete')} onClick={() => remove(n)}><Icon name="trash" size={15} /></button>
        </div>
      ))}
    </>
  );
}
