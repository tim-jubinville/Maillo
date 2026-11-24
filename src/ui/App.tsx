import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { config, configMissing, setup } from '../config';
import { t, type StringKey } from '../i18n';
import { labelColor, labelDisplayName } from '../model';
import { getPrefs, setPrefs } from '../prefs';
import { go, listHash, type Folder, type MailRoute } from '../route';
import { actions, dismissToast, openCompose, pileLabelIds, setState, signInClick, signOutClick, useApp, type AppState } from '../store';
import { Brand, Menu, Photo } from './common';
import { dropZone, endDrag, startLabelDrag } from '../dnd';
import { Compose } from './Compose';
import { composeInWindow, PopoutWindow } from './Popout';
import { SearchBox } from './SearchBox';
import { layoutVars, Splitter } from './Splitter';
import { CIcon, ColorSprite, type ColorIconName } from './ColorIcons';
import { Icon } from './Icon';
import { KeyHelp, useShortcuts } from './Keys';
import { ReadingPane } from './ReadingPane';
import { inInbox, PileBar } from './Piles';
import { Settings } from './Settings';
import { PanelBody, SidePanel } from './SidePanel';
import { ThreadList } from './ThreadList';

export function App() {
  const s = useApp();
  useShortcuts(s);
  const unread = s.phase === 'ready' ? s.counts.INBOX ?? 0 : 0;
  useEffect(() => {
    document.title = unread ? `(${unread > 999 ? '999+' : unread}) ${config.appName}` : config.appName;
  }, [unread]);
  if (s.phase === 'boot') return <div class="center"><p>{t('app.loading')}</p></div>;
  if (s.phase === 'signin' || s.phase === 'denied') return <SignIn s={s} />;
  return (
    <div class={`app ${inInbox(s) && (s.piles.aside.rows.length || s.piles.action.rows.length) ? 'has-pile' : ''}`}>
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
      </div>
      <PileBar s={s} />
      {/* Phones: compose floats at the bottom right, within thumb reach. */}
      <button class="compose-fab" aria-label={t('nav.compose')} title={t('nav.compose')} onClick={() => openCompose()}>
        <Icon name="pencil" />
      </button>
      {s.compose && !s.compose.popout && <Compose key={s.compose.key} s={s} c={s.compose} />}
      {s.compose?.popout && (
        <PopoutWindow title={s.compose.subject || t('compose.new')}>
          <Compose key={`pop-${s.compose.key}`} s={s} c={s.compose} />
        </PopoutWindow>
      )}
      <Toasts s={s} />
      {s.showKeys && <KeyHelp />}
    </div>
  );
}

const SETUP_ITEMS = ['configFile', 'configValid', 'clientId', 'allowed', 'php', 'htaccess', 'writable', 'openssl', 'curl'] as const;

/** First run: what's still missing in maillo-config.php or on the server, as plain yes/no items. */
function SetupChecklist() {
  const st = setup!;
  // Nothing else matters until the file exists and can be read.
  const items = SETUP_ITEMS.filter((k) => (k === 'configFile' ? true : st.checks.configFile && (k === 'configValid' || st.checks.configValid)));
  return (
    <div class="center">
      <div class="glass signin setup">
        <Brand />
        <h1>{t('setup.title')}</h1>
        <p>{t('setup.body')}</p>
        <ul class="setup-list">
          {items.map((k) => {
            const ok = !!st.checks[k];
            const needed = st.required.includes(k);
            const fix = k === 'configValid' && st.line ? t('setup.configValid.line', { line: st.line }) : t(`setup.${k}.fix` as StringKey);
            return (
              <li class={`${ok ? 'ok' : 'no'} ${needed ? '' : 'soft'}`}>
                <span class="mark" aria-hidden="true"><Icon name={ok ? 'tick' : needed ? 'x' : 'info'} size={15} /></span>
                <div>
                  <b>{t(`setup.${k}` as StringKey)}<span class="sr-only">: {ok ? t('setup.ok') : t('setup.missing')}</span></b>
                  {!ok && <span>{fix}</span>}
                  {!ok && <span class="tagline">{needed ? t('setup.needed') : t('setup.forFeatures')}</span>}
                </div>
              </li>
            );
          })}
        </ul>
        <p class="setup-note">{t('setup.private')}</p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button class="btn primary" onClick={() => location.reload()}>{t('setup.again')}</button>
          <a class="btn" href="?demo">{t('auth.demo')}</a>
        </div>
      </div>
    </div>
  );
}

function SignIn({ s }: { s: AppState }) {
  if (setup && !setup.ready && !config.demo) return <SetupChecklist />;
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
  const online = navigator.onLine;
  const ref = useRef<HTMLElement>(null);
  // Its height, for sliding it away while scrolling on phones.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--hh', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <header class="header" ref={ref}>
      <div class="brandbox">
        <button
          class="ib"
          aria-label={t('nav.menu')}
          onClick={() => {
            // Narrow screens slide the sidebar over the content; wider ones hide or show it, and remember.
            if (window.innerWidth <= 900) setState({ sidebarOpen: !s.sidebarOpen });
            else setPrefs({ sidebarCollapsed: !getPrefs().sidebarCollapsed });
          }}
        >
          <Icon name="menu" />
        </button>
        <Brand />
      </div>
      <SearchBox s={s} />
      <div class="header-right">
        <Menu
          label={t('header.account', { email: s.me })}
          class={`avatar-btn ${online || config.demo ? '' : 'offline'} ${s.update ? 'has-update' : ''}`}
          align="right"
          hover
          button={<span aria-hidden="true"><Photo src={s.mePhoto} fallback={(s.me[0] || '?').toUpperCase()} /></span>}
        >
          {(close) => (
            <>
              <div class="pop-h acct-h">
                <span class="ell">{s.me}</span>
                <span class="acct-status">
                  <span class={`glowdot ${online ? '' : 'off'}`} aria-hidden="true" />
                  {config.demo ? t('header.demo') : online ? t('header.synced') : t('header.offline')}
                </span>
              </div>
              {s.update && (
                <a class="mi mi-update" href="#/settings/updates" onClick={close}><Icon name="download" />{t('header.update', { v: s.update.version })}<span class="update-dot" aria-hidden="true" /></a>
              )}
              <a class="mi" href="#/settings/general" onClick={close}><Icon name="gear" />{t('header.settings')}</a>
              <button class="mi" onClick={() => { close(); setState({ showKeys: true }); }}><Icon name="keyboard" />{t('header.help')}<span class="kbd mi-kbd" aria-hidden="true">?</span></button>
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
      <button class="compose-btn" title={t('compose.shiftHint')} onClick={(e) => (e.shiftKey ? composeInWindow() : openCompose())}>
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
            <svg class="ldot" viewBox="0 0 24 24" aria-hidden="true" style={{ color: labelColor(l) }}>
              <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7.4a2 2 0 0 1 1.4.6l7.1 7.1a2 2 0 0 1 0 2.8l-6.6 6.6a2 2 0 0 1-2.8 0L3.6 12.9A2 2 0 0 1 3 11.5z" fill="currentColor" />
              <circle cx="8" cy="8" r="1.7" fill="var(--surface)" />
            </svg>
            <span class="nav-t">{labelDisplayName(l)}</span>
            {n > 0 && <span class="nav-c quiet">{n}</span>}
          </a>
        );
      })}
    </nav>
  );
}

function MailCard({ s, route }: { s: AppState; route: MailRoute }) {
  const prefs = getPrefs();
  const pane = prefs.pane;
  const reading = !!route.thread;
  const showList = pane === 'right' || !reading;
  const showRead = pane === 'right' || reading;
  return (
    <div class={`card glass ${reading ? 'reading' : ''} ${prefs.sidebarCollapsed ? 'no-sidebar' : ''}`} style={layoutVars()}>
      <Sidebar s={s} />
      {!prefs.sidebarCollapsed && <Splitter col="sidebar" />}
      {showList && <ThreadList s={s} route={route} split={pane === 'right'} />}
      {showList && showRead && pane === 'right' && <Splitter col="list" />}
      {showRead && <ReadingPane s={s} route={route} showBack={pane === 'off' || window.innerWidth <= 900} />}
      {s.panel && <Splitter col="panel" side="left" />}
      {s.panel && <SidePanel s={s} />}
      <SideIcons s={s} />
    </div>
  );
}

type PanelId = NonNullable<AppState['panel']>;

function SideIcons({ s }: { s: AppState }) {
  const items: { id: PanelId; icon: ColorIconName; label: string }[] = [
    { id: 'calendar', icon: 'calendar', label: t('panel.calendar') },
    ...(config.features.stickies || config.demo ? [{ id: 'stickies' as const, icon: 'stickies' as const, label: t('panel.stickies') }] : []),
    { id: 'tasks', icon: 'tasks', label: t('panel.tasks') },
    { id: 'contacts', icon: 'contacts', label: t('panel.contacts') }
  ];
  // Hover previews: resting on an icon while the side panel is closed shows that app in a popover.
  const [peek, setPeek] = useState<{ id: PanelId; top: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const enabled = getPrefs().sidePeek && !s.panel;
  const show = (id: PanelId, el: HTMLElement) => {
    clearTimeout(timer.current);
    if (!enabled) return;
    const top = el.getBoundingClientRect().top;
    timer.current = window.setTimeout(() => setPeek({ id, top }), peek ? 120 : 450);
  };
  const hide = () => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPeek(null), 220);
  };
  const stay = () => clearTimeout(timer.current);
  useEffect(() => {
    if (!enabled) setPeek(null);
  }, [enabled]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!peek) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setPeek(null);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [!!peek]);
  const name = peek ? items.find((i) => i.id === peek.id)?.label ?? '' : '';
  return (
    <div class="side-icons">
      {items.map((i) => (
        <button
          class={`sp ${s.panel === i.id ? 'on' : ''} ${peek?.id === i.id ? 'peeking' : ''}`}
          aria-label={i.label}
          title={enabled ? undefined : i.label}
          aria-pressed={s.panel === i.id}
          onMouseEnter={(e) => show(i.id, e.currentTarget)}
          onMouseLeave={hide}
          onClick={() => {
            clearTimeout(timer.current);
            setPeek(null);
            setState({ panel: s.panel === i.id ? undefined : i.id });
          }}
        >
          <CIcon name={i.icon} size={20} />
        </button>
      ))}
      {peek && (
        <div
          class="peek"
          key={peek.id}
          role="dialog"
          aria-label={name}
          style={{ '--peek-top': `${peek.top}px` }}
          onMouseEnter={stay}
          onMouseLeave={hide}
        >
          <div class="peek-head">
            <span>{name}</span>
            <button
              class="ib sm"
              aria-label={t('panel.pin', { name })}
              title={t('panel.pin', { name })}
              onClick={() => {
                setPeek(null);
                setState({ panel: peek.id });
              }}
            >
              <Icon name="pin" size={16} />
            </button>
          </div>
          <div class="panel-body peek-body">
            <PanelBody s={s} p={peek.id} />
          </div>
        </div>
      )}
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
