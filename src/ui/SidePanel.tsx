import { useEffect, useState } from 'preact/hooks';
import { config } from '../config';
import type { CalendarEvent, TaskItem } from '../gmail/types';
import { locale, t } from '../i18n';
import { api, setState, toast, type AppState } from '../store';
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
        {p === 'keep' && <OpenLink name={t('panel.keep')} href={config.links.keep} />}
        {p === 'contacts' && <ContactsPanel s={s} />}
      </div>
    </aside>
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
  if (!config.features.calendar && !config.demo) return <OpenLink name={t('panel.calendar')} href={config.links.calendar} hint />;
  const today = new Date().toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <>
      <span class="caps">{t('panel.today')} · {today}</span>
      {events === null && <div class="skeleton" style={{ margin: 0 }} />}
      {events?.length === 0 && <p style={{ margin: 0, color: 'var(--muted)' }}>{t('panel.noEvents')}</p>}
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
  if (!config.features.tasks && !config.demo) return <OpenLink name={t('panel.tasks')} href="https://tasks.google.com/" hint />;
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
      {items?.length === 0 && <p style={{ margin: 0, color: 'var(--muted)' }}>{t('panel.noTasks')}</p>}
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

