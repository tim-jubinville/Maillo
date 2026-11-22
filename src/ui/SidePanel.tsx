import { useEffect, useState } from 'preact/hooks';
import { config } from '../config';
import type { CalendarEvent, KeepNote, TaskItem } from '../gmail/types';
import { locale, t } from '../i18n';
import { api, setState, toast, type AppState } from '../store';
import { CIcon, type ColorIconName } from './ColorIcons';
import { ContactsPanel } from './ContactsPanel';
import { Icon } from './Icon';

export function SidePanel({ s }: { s: AppState }) {
  const titles = { calendar: t('panel.calendar'), tasks: t('panel.tasks'), keep: t('panel.keep'), contacts: t('panel.contacts') };
  const p = s.panel!;
  return (
    <aside class="panel" aria-label={titles[p]}>
      <div class="panel-head">
        <span style={{ flex: 1 }}>{titles[p]}</span>
        <button class="ib" aria-label={t('panel.close')} onClick={() => setState({ panel: undefined })}>
          <Icon name="x" />
        </button>
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

function OpenLink({ name, href, hint }: { name: string; href: string; hint?: boolean }) {
  return (
    <>
      {hint && <p style={{ margin: 0, fontSize: 'calc(13px * var(--ts, 1))', color: 'var(--muted)' }}>{t('panel.enable')}</p>}
      <a class="btn sm" href={href} target="_blank" rel="noopener noreferrer" style={{ alignSelf: 'flex-start' }}>
        <Icon name="external" size={16} />
        {t('panel.open', { name })}
      </a>
    </>
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
  useEffect(() => {
    if (!config.features.calendar && !config.demo) return;
    api.todayEvents().then(setEvents).catch((e) => toast(t('toast.error', { msg: e.message })));
  }, []);
  if (!config.features.calendar && !config.demo)
    return (
      <PanelEmpty icon="calendar" title={t('empty.calOffTitle')} sub={t('empty.calOff')}>
        <OpenLink name={t('panel.calendar')} href={config.links.calendar} />
      </PanelEmpty>
    );
  const today = new Date().toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <>
      <span class="caps">{t('panel.today')} · {today}</span>
      {events === null && <div class="skeleton" style={{ margin: 0 }} />}
      {events?.length === 0 && <PanelEmpty icon="calendar" title={t('panel.noEvents')} sub={t('empty.calSub')} />}
      {events?.map((e) => {
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
      })}
      <OpenLink name={t('panel.calendar')} href={config.links.calendar} />
    </>
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
      <PanelEmpty icon="tasks" title={t('empty.tasksOffTitle')} sub={t('empty.tasksOff')}>
        <OpenLink name={t('panel.tasks')} href="https://tasks.google.com/" />
      </PanelEmpty>
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
      <PanelEmpty icon="keep" title={t('empty.keepOffTitle')} sub={t('empty.keepOff')}>
        <OpenLink name={t('panel.keep')} href={config.links.keep} />
      </PanelEmpty>
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
      <OpenLink name={t('panel.keep')} href={config.links.keep} />
    </>
  );
}
