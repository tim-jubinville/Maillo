import { useEffect, useRef, useState } from 'preact/hooks';
import { config, configMissing } from '../config';
import { t } from '../i18n';
import { labelColor, labelDisplayName } from '../model';
import { getPrefs } from '../prefs';
import { go, listHash, type Folder, type MailRoute } from '../route';
import { actions, dismissToast, openCompose, pileLabelIds, setState, signInClick, signOutClick, useApp, type AppState } from '../store';
import { Brand, Menu, Photo } from './common';
import { dropZone, endDrag, startLabelDrag } from '../dnd';
import { Compose } from './Compose';
import { CIcon, ColorSprite, type ColorIconName } from './ColorIcons';
import { Icon } from './Icon';
import { KeyHelp, SEARCH_KEY, useShortcuts } from './Keys';
import { ReadingPane } from './ReadingPane';
import { PileBar } from './Piles';
import { Settings } from './Settings';
import { SidePanel } from './SidePanel';
import { ThreadList } from './ThreadList';

export function App() {
  const s = useApp();
  useShortcuts(s);
  if (s.phase === 'boot') return <div class="center"><p>{t('app.loading')}</p></div>;
  if (s.phase === 'signin' || s.phase === 'denied') return <SignIn s={s} />;
  return (
    <div class={`app ${s.piles.aside.rows.length || s.piles.action.rows.length ? 'has-pile' : ''}`}>
      <ColorSprite />
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
        <div class={`overlay-sidebar ${s.sidebarOpen ? 'open' : ''}`} onClick={() => setState({ sidebarOpen: false })} />
        {s.route.view === 'settings' ? (
          <div class="card glass settings-card">
            <Settings s={s} section={s.route.section} />
          </div>
        ) : (
          <MailCard s={s} route={s.route} />
        )}
        <SideIcons s={s} />
      </div>
      <PileBar s={s} />
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
        ) : configMissing && !config.demo ? (
          <p class="err" role="alert">{t('auth.configError')}</p>
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
          aria-keyshortcuts="Meta+K Control+K"
          autoComplete="off"
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        />
        {q && (
          <button type="button" class="ib sm" aria-label={t('search.clear')} onClick={() => { setQ(''); go('#/inbox'); }}>
            <Icon name="x" />
          </button>
        )}
        <span class="kbd" aria-hidden="true">{SEARCH_KEY}</span>
      </form>
      <div class="header-right">
        <span class="status">
          <span class={`glowdot ${online ? '' : 'off'}`} aria-hidden="true" />
          {config.demo ? t('header.demo') : online ? t('header.synced') : t('header.offline')}
        </span>
        <button class="ib" aria-label={t('header.help')} title={t('header.help')} onClick={() => setState({ showKeys: true })}>
          <Icon name="help" style={{ color: 'var(--c-sent)' }} />
        </button>
        <Menu
          label={t('header.account', { email: s.me })}
          class="avatar-btn"
          align="right"
          button={<span aria-hidden="true"><Photo src={s.mePhoto} fallback={(s.me[0] || '?').toUpperCase()} /></span>}
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
      <a class={`rl ${s.route.view === 'mail' ? 'on' : ''}`} href="#/inbox" aria-current={s.route.view === 'mail' ? 'page' : undefined}>
        <span class="rl-i">
          <CIcon name="mail" size={26} />
          {(s.counts.INBOX ?? 0) > 0 && <span class="badge">{s.counts.INBOX > 99 ? '99+' : s.counts.INBOX}</span>}
        </span>
        {t('nav.mail')}
      </a>
      <a class="rl" href={config.links.chat} target="_blank" rel="noopener noreferrer">
        <span class="rl-i"><CIcon name="chat" size={26} /></span>
        {t('nav.chat')}
      </a>
      <a class="rl" href={config.links.meet} target="_blank" rel="noopener noreferrer">
        <span class="rl-i"><CIcon name="meet" size={26} /></span>
        {t('nav.meet')}
      </a>
      <a class={`rl ${s.route.view === 'settings' ? 'on' : ''}`} href="#/settings/general" aria-current={s.route.view === 'settings' ? 'page' : undefined}>
        <span class="rl-i"><CIcon name="settings" size={26} /></span>
        {t('header.settings')}
      </a>
    </nav>
  );
}

const FOLDER_ICON: Record<Folder, ColorIconName> = {
  inbox: 'inbox',
  starred: 'starred',
  snoozed: 'snoozed',
  important: 'important',
  sent: 'sent',
  scheduled: 'scheduled',
  drafts: 'drafts',
  all: 'all',
  spam: 'spam',
  trash: 'trash'
};

function Sidebar({ s }: { s: AppState }) {
  const [more, setMore] = useState(false);
  const r = s.route;
  const active = (f: Folder) => r.view === 'mail' && r.q === undefined && !r.label && (r.folder ?? 'inbox') === f;
  const primary: Folder[] = ['inbox', 'starred', 'snoozed', 'important', 'sent', 'scheduled', 'drafts'];
  const secondary: Folder[] = ['all', 'spam', 'trash'];
  const pileIds = pileLabelIds();
  const userLabels = s.labels
    .filter((l) => l.type === 'user' && l.labelListVisibility !== 'labelHide' && !pileIds.includes(l.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const count = (f: Folder) => (f === 'inbox' ? s.counts.INBOX : f === 'drafts' ? s.counts.DRAFT : f === 'spam' ? s.counts.SPAM : 0) ?? 0;
  // Folders that conversations can be dragged onto, and what dropping there does.
  const folderDrop: Partial<Record<Folder, (ids: string[]) => void>> = {
    inbox: actions.moveToInbox,
    starred: (ids) => actions.star(ids, true),
    important: (ids) => actions.important(ids, true),
    all: actions.archive,
    spam: actions.spam,
    trash: actions.trash
  };
  const item = (f: Folder) => {
    const icon = FOLDER_ICON[f];
    const n = count(f);
    const onDrop = !active(f) ? folderDrop[f] : undefined;
    return (
      <a
        class={`nav ${active(f) ? 'on' : ''} ${onDrop && s.dragging === 'threads' ? 'drop-ok' : ''}`}
        href={`#/${f}`}
        aria-current={active(f) ? 'page' : undefined}
        draggable={false}
        {...(onDrop ? dropZone('threads', onDrop) : {})}
      >
        <CIcon name={icon} size={24} />
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
          <a
            class={`nav ${on ? 'on' : ''} ${!on && s.dragging === 'threads' ? 'drop-ok' : ''}`}
            href={`#/label/${encodeURIComponent(l.id)}`}
            style={{ paddingLeft: `${12 + depth * 18}px` }}
            aria-current={on ? 'page' : undefined}
            draggable
            onDragStart={(e) => startLabelDrag(e, l.id, labelDisplayName(l))}
            onDragEnd={endDrag}
            {...(!on ? dropZone('threads', (ids) => actions.moveTo(ids, l.id)) : {})}
          >
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
      <Sidebar s={s} />
      {showList && <ThreadList s={s} route={route} split={pane === 'right'} />}
      {showRead && <ReadingPane s={s} route={route} showBack={pane === 'off' || window.innerWidth <= 900} />}
      {s.panel && <SidePanel s={s} />}
    </div>
  );
}

function SideIcons({ s }: { s: AppState }) {
  const items: { id: NonNullable<AppState['panel']>; icon: ColorIconName; label: string }[] = [
    { id: 'calendar', icon: 'calendar', label: t('panel.calendar') },
    { id: 'keep', icon: 'keep', label: t('panel.keep') },
    { id: 'tasks', icon: 'tasks', label: t('panel.tasks') },
    { id: 'contacts', icon: 'contacts', label: t('panel.contacts') }
  ];
  return (
    <div class="side-icons">
      {items.map((i) => (
        <button
          class={`sp ${s.panel === i.id ? 'on' : ''}`}
          aria-label={i.label}
          title={i.label}
          aria-pressed={s.panel === i.id}
          onClick={() => setState({ panel: s.panel === i.id ? undefined : i.id })}
        >
          <CIcon name={i.icon} size={26} />
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
