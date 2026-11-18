import { useEffect, useState } from 'preact/hooks';
import { config } from '../config';
import type { CalendarEvent, TaskItem } from '../gmail/types';
import { locale, t } from '../i18n';
import { api, openCompose, setState, toast, type AppState } from '../store';
import { Avatar } from './common';
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
        {p === 'contacts' && <Contact s={s} />}
      </div>
    </aside>
  );
}

function OpenLink({ name, href, hint }: { name: string; href: string; hint?: boolean }) {
  return (
    <>
      {hint && <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>{t('panel.enable')}</p>}
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
      {events?.map((e) => (
        <a class="pcard" href={e.htmlLink ?? config.links.calendar} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
          <span class="bar" />
          <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <b style={{ fontSize: '13px' }}>{e.summary}</b>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{time(e)}</span>
          </span>
        </a>
      ))}
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
            <span style={{ fontSize: '13px', fontWeight: 500 }}>{k.title}</span>
            {k.due && <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{new Date(k.due).toLocaleDateString(locale(), { month: 'short', day: 'numeric' })}</span>}
          </span>
        </label>
      ))}
    </>
  );
}

function Contact({ s }: { s: AppState }) {
  const m = s.open?.messages.find((x) => x.from.email.toLowerCase() !== s.me.toLowerCase()) ?? s.open?.messages[0];
  if (!m) return <OpenLink name={t('panel.contacts')} href={config.links.contacts} />;
  const a = m.from;
  return (
    <>
      <span class="caps">{t('panel.contactFrom')}</span>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '12px 0', textAlign: 'center' }}>
        <Avatar a={a} size="xl" />
        <b style={{ fontSize: '16px' }}>{a.name || a.email}</b>
        <span style={{ fontSize: '13px', color: 'var(--muted)', overflowWrap: 'anywhere' }}>{a.email}</span>
        <button class="btn sm" onClick={() => openCompose('new', undefined, { to: [a] })}>
          <Icon name="mail" size={16} />
          {t('panel.email')}
        </button>
      </div>
      <OpenLink name={t('panel.contacts')} href={config.links.contacts} />
    </>
  );
}
