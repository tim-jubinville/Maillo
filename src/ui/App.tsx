import { useEffect, useRef, useState } from 'preact/hooks';
import { config } from '../config';
import { t } from '../i18n';
import { labelColor, labelDisplayName } from '../model';
import { getPrefs } from '../prefs';
import { go, listHash, type Folder, type MailRoute } from '../route';
import { dismissToast, openCompose, setState, signInClick, signOutClick, useApp, type AppState } from '../store';
import { Brand, Menu } from './common';
import { Compose } from './Compose';
import { Icon } from './Icon';
import { KeyHelp, useShortcuts } from './Keys';
import { ReadingPane } from './ReadingPane';
import { Settings } from './Settings';
import { SidePanel } from './SidePanel';
import { ThreadList } from './ThreadList';

export function App() {
  const s = useApp();
  useShortcuts(s);
  if (s.phase === 'boot') return <div class="center"><p>{t('app.loading')}</p></div>;
  if (s.phase === 'signin' || s.phase === 'denied') return <SignIn s={s} />;
  return (
    <div class="app">
      <Header s={s} />
      {s.sessionExpired && (
        <div class="banner" role="alert">
          <Icon name="info" />
          <span style={{ flex: 1 }}>{t('auth.expired')}</span>
          <button class="btn sm primary" onClick={() => signInClick()}>{t('auth.button')}</button>
        </div>
      )}
      <div class="main">
        <Rail s={s} />
        <Sidebar s={s} />
        <div class={`overlay-sidebar ${s.sidebarOpen ? 'open' : ''}`} onClick={() => setState({ sidebarOpen: false })} />
        {s.route.view === 'settings' ? <Settings s={s} section={s.route.section} /> : <MailCard s={s} route={s.route} />}
        <SideIcons s={s} />
      </div>
      {s.compose && <Compose key={s.compose.key} s={s} c={s.compose} />}
      <Toasts s={s} />
      {s.showKeys && <KeyHelp />}
    </div>
  );
}

function SignIn({ s }: { s: AppState }) {
  return (
    <div class="center">
      <div class="glass signin">
        <Brand />
        <h1>{t('auth.title')}</h1>
        {s.phase === 'denied' ? (
          <p class="err">{t('auth.notAllowed', { email: s.deniedEmail ?? '' })}</p>
        ) : !config.googleClientId && !config.demo ? (
          <p>{t('auth.missingClient')}</p>
        ) : (
          <p>{t('auth.body')}</p>
        )}
        {s.authError && <p class="err" role="alert">{s.authError}</p>}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {config.googleClientId && (
            <button class="btn primary" onClick={() => signInClick(s.phase === 'denied')}>
              {s.phase === 'denied' ? t('auth.switch') : t('auth.button')}
            </button>
          )}
          {!config.googleClientId && (
            <a class="btn" href="?demo">{t('auth.demo')}</a>
          )}
        </div>
      </div>
    </div>
  );
}

function Header({ s }: { s: AppState }) {
  const r = s.route;
  const [q, setQ] = useState(r.view === 'mail' && r.q !== undefined ? r.q : '');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setQ(r.view === 'mail' && r.q !== undefined ? r.q : '');
  }, [r.view === 'mail' ? r.q : undefined]);
  const submit = (e: Event) => {
    e.preventDefault();
    const v = q.trim();
    go(v ? `#/search/${encodeURIComponent(v)}` : '#/inbox');
  };
  const online = navigator.onLine;
  return (
    <header class="header">
      <div class="brandbox">
        <button class="ib" aria-label={t('nav.menu')} onClick={() => setState({ sidebarOpen: !s.sidebarOpen })}>
          <Icon name="menu" />
        </button>
        <Brand />
      </div>
      <form class="search" role="search" onSubmit={submit}>
        <Icon name="search" />
        <label for="mm-search" class="sr-only">{t('search.label')}</label>
        <input
          id="mm-search"
          ref={input}
          type="search"
          value={q}
          placeholder={t('search.placeholder')}
          autoComplete="off"
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        />
        {q && (
          <button type="button" class="ib sm" aria-label={t('search.clear')} onClick={() => { setQ(''); go('#/inbox'); }}>
            <Icon name="x" />
          </button>
        )}
        <span class="kbd" aria-hidden="true">/</span>
      </form>
      <div class="header-right">
        <span class="status">
          <span class={`glowdot ${online ? '' : 'off'}`} aria-hidden="true" />
          {config.demo ? t('header.demo') : online ? t('header.synced') : t('header.offline')}
        </span>
        <button class="ib" aria-label={t('header.help')} title={t('header.help')} onClick={() => setState({ showKeys: true })}>
          <Icon name="help" style={{ color: 'var(--c-sent)' }} />
        </button>
        <a class="ib" href="#/settings/general" aria-label={t('header.settings')} title={t('header.settings')}>
          <Icon name="gear" />
        </a>
        <Menu
          label={t('header.account', { email: s.me })}
          class="avatar-btn"
          align="right"
          button={<span aria-hidden="true">{(s.me[0] || '?').toUpperCase()}</span>}
        >
          {(close) => (
            <>
              <div class="pop-h">{s.me}</div>
              <a class="mi" href="#/settings/general" onClick={close}><Icon name="gear" />{t('header.settings')}</a>
              {!config.demo && (
                <button class="mi" onClick={() => { close(); signInClick(true); }}><Icon name="user" />{t('auth.switch')}</button>
              )}
              {!config.demo && (
                <button class="mi" onClick={signOutClick}><Icon name="logout" />{t('auth.signOut')}</button>
              )}
            </>
          )}
        </Menu>
      </div>
    </header>
  );
}

function Rail({ s }: { s: AppState }) {
  return (
    <nav class="rail" aria-label={t('nav.apps')}>
      <a class="rl on" href="#/inbox" aria-current="page">
        <span class="rl-i" style={{ color: 'var(--c-inbox)' }}>
          <Icon name="mail" />
          {(s.counts.INBOX ?? 0) > 0 && <span class="badge">{s.counts.INBOX > 99 ? '99+' : s.counts.INBOX}</span>}
        </span>
        {t('nav.mail')}
      </a>
      <a class="rl" href={config.links.chat} target="_blank" rel="noopener noreferrer">
        <span class="rl-i" style={{ color: 'var(--c-tasks)' }}><Icon name="chat" /></span>
        {t('nav.chat')}
      </a>
      <a class="rl" href={config.links.meet} target="_blank" rel="noopener noreferrer">
        <span class="rl-i" style={{ color: 'var(--c-important)' }}><Icon name="video" /></span>
        {t('nav.meet')}
      </a>
    </nav>
  );
}

const FOLDER_ICON: Record<Folder, [string, string]> = {
  inbox: ['inbox', 'var(--c-inbox)'],
  starred: ['star', 'var(--c-star)'],
  snoozed: ['clock', 'var(--c-snooze)'],
  important: ['important', 'var(--c-important)'],
  sent: ['send', 'var(--c-sent)'],
  scheduled: ['scheduled', 'var(--c-scheduled)'],
  drafts: ['file', 'var(--c-drafts)'],
  all: ['layers', 'var(--c-all)'],
  spam: ['spam', 'var(--c-spam)'],
  trash: ['trash', 'var(--c-trash)']
};

function Sidebar({ s }: { s: AppState }) {
  const [more, setMore] = useState(false);
  const r = s.route;
  const active = (f: Folder) => r.view === 'mail' && r.q === undefined && !r.label && (r.folder ?? 'inbox') === f;
  const primary: Folder[] = ['inbox', 'starred', 'snoozed', 'important', 'sent', 'scheduled', 'drafts'];
  const secondary: Folder[] = ['all', 'spam', 'trash'];
  const userLabels = s.labels
    .filter((l) => l.type === 'user' && l.labelListVisibility !== 'labelHide')
    .sort((a, b) => a.name.localeCompare(b.name));
  const count = (f: Folder) => (f === 'inbox' ? s.counts.INBOX : f === 'drafts' ? s.counts.DRAFT : f === 'spam' ? s.counts.SPAM : 0) ?? 0;
  const item = (f: Folder) => {
    const [icon, color] = FOLDER_ICON[f];
    const n = count(f);
    return (
      <a class={`nav ${active(f) ? 'on' : ''}`} href={`#/${f}`} aria-current={active(f) ? 'page' : undefined}>
        <Icon name={icon} style={{ color }} fill={f === 'starred' ? '#FFD84D' : undefined} />
        <span class="nav-t">{t(`nav.${f}`)}</span>
        {n > 0 && <span class={`nav-c ${f === 'inbox' ? '' : 'quiet'}`}>{n}</span>}
      </a>
    );
  };
  return (
    <nav class={`sidebar ${s.sidebarOpen ? 'open' : ''}`} aria-label={t('nav.mailboxes')}>
      <button class="compose-btn" onClick={() => openCompose()}>
        <Icon name="pencil" />
        {t('nav.compose')}
      </button>
      {primary.map(item)}
      {more ? secondary.map(item) : secondary.filter(active).map(item)}
      <button class="nav" onClick={() => setMore(!more)} aria-expanded={more}>
        <Icon name={more ? 'chevUp' : 'chevDown'} />
        <span class="nav-t">{more ? t('nav.less') : t('nav.more')}</span>
      </button>
      <div class="nav-head">
        <span class="caps">{t('nav.labels')}</span>
        <a class="ib sm" href="#/settings/labels" aria-label={t('nav.newLabel')} title={t('nav.newLabel')}>
          <Icon name="plus" />
        </a>
      </div>
      {userLabels.map((l) => {
        const on = r.view === 'mail' && r.label === l.id;
        const depth = l.name.split('/').length - 1;
        const n = s.counts[l.id] ?? 0;
        return (
          <a class={`nav ${on ? 'on' : ''}`} href={`#/label/${encodeURIComponent(l.id)}`} style={{ paddingLeft: `${12 + depth * 18}px` }} aria-current={on ? 'page' : undefined}>
            <span class="ldot" aria-hidden="true" style={{ background: labelColor(l) }} />
            <span class="nav-t">{labelDisplayName(l)}</span>
            {n > 0 && <span class="nav-c quiet">{n}</span>}
          </a>
        );
      })}
    </nav>
  );
}

function MailCard({ s, route }: { s: AppState; route: MailRoute }) {
  const pane = getPrefs().pane;
  const reading = !!route.thread;
  const showList = pane === 'right' || !reading;
  const showRead = pane === 'right' || reading;
  return (
    <div class={`card glass ${reading ? 'reading' : ''}`}>
      {showList && <ThreadList s={s} route={route} split={pane === 'right'} />}
      {showRead && <ReadingPane s={s} route={route} showBack={pane === 'off' || window.innerWidth <= 900} />}
      {s.panel && <SidePanel s={s} />}
    </div>
  );
}

function SideIcons({ s }: { s: AppState }) {
  const items: { id: NonNullable<AppState['panel']>; icon: string; color: string; label: string }[] = [
    { id: 'calendar', icon: 'calendar', color: 'var(--c-inbox)', label: t('panel.calendar') },
    { id: 'keep', icon: 'bulb', color: 'var(--c-star)', label: t('panel.keep') },
    { id: 'tasks', icon: 'check', color: 'var(--c-sent)', label: t('panel.tasks') },
    { id: 'contacts', icon: 'user', color: 'var(--c-snooze)', label: t('panel.contacts') }
  ];
  return (
    <div class="side-icons">
      {items.map((i) => (
        <button
          class={`sp ${s.panel === i.id ? 'on' : ''}`}
          style={{ color: i.color }}
          aria-label={i.label}
          title={i.label}
          aria-pressed={s.panel === i.id}
          onClick={() => setState({ panel: s.panel === i.id ? undefined : i.id })}
        >
          <Icon name={i.icon} />
        </button>
      ))}
    </div>
  );
}

function Toasts({ s }: { s: AppState }) {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {s.toasts.map((x) => (
        <div class="toast" key={x.id}>
          <span>{x.text}</span>
          {x.action && (
            <button class="act" onClick={() => { dismissToast(x.id); x.action!.run(); }}>
              {x.action.label}
            </button>
          )}
          <button class="x" aria-label={t('toast.dismiss')} onClick={() => dismissToast(x.id)}>
            <Icon name="x" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function backToList(route: MailRoute) {
  go(listHash(route));
}
