import { useEffect, useRef } from 'preact/hooks';
import { t, type StringKey } from '../i18n';
import { openBarMenu } from './BarItems';
import { getPrefs } from '../prefs';
import { go, listHash, threadHash, type MailRoute } from '../route';
import { actions, closeThread, defaultReplyMode, getState, notesEnabled, pileOf, openCompose, openRow, setState, targetIds, toggleSelect, type AppState } from '../store';
import { Icon } from './Icon';
import { revealRow } from './ThreadList';

export const SEARCH_KEY = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? '⌘ K' : 'Ctrl + K';

const MAP: [string, StringKey][] = [
  ['c', 'keys.compose'],
  [SEARCH_KEY, 'keys.search'],
  ['j', 'keys.next'],
  ['k', 'keys.prev'],
  ['o / Enter', 'keys.open'],
  ['u', 'keys.back'],
  ['e', 'keys.archive'],
  ['#', 'keys.delete'],
  ['!', 'keys.spam'],
  ['s', 'keys.star'],
  ['p', 'keys.pin.aside'],
  ['t', 'keys.pin.action'],
  ['n', 'keys.note'],
  ['x', 'keys.select'],
  ['v', 'keys.moveTo'],
  ['l', 'keys.labelAs'],
  ['r', 'keys.reply'],
  ['a', 'keys.replyAll'],
  ['f', 'keys.forward'],
  ['Shift + i', 'keys.read'],
  ['Shift + u', 'keys.unread'],
  ['g then i', 'keys.goInbox'],
  ['g then s', 'keys.goStarred'],
  ['g then t', 'keys.goSent'],
  ['g then d', 'keys.goDrafts'],
  ['Ctrl/⌘ + Enter', 'keys.send'],
  ['Esc', 'keys.close'],
  ['?', 'keys.help']
];

function typing(el: EventTarget | null) {
  const e = el as HTMLElement | null;
  // Keys inside an open menu belong to the menu (Enter picks the focused item).
  return !!e && (e.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName) || !!e.closest?.('[role="menu"]'));
}

export function useShortcuts(s: AppState) {
  const gPressed = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = getState();
      if (st.phase !== 'ready') return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        if ((e.target as HTMLElement | null)?.isContentEditable) return;
        e.preventDefault();
        setState({ showKeys: false });
        const el = document.getElementById('mm-search') as HTMLInputElement | null;
        el?.focus();
        el?.select();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (st.showKeys) setState({ showKeys: false });
        else if (st.sheet) setState({ sheet: undefined });
        return;
      }
      if (!getPrefs().shortcuts || typing(e.target) || st.compose && !st.compose.minimized) return;
      const r = st.route;
      if (r.view !== 'mail') {
        if (e.key === '?') setState({ showKeys: true });
        return;
      }
      const rows = st.list.rows;
      const cur = st.open?.id ?? st.focusId;
      const idx = rows.findIndex((x) => x.id === cur);
      const move = (d: number) => {
        const next = rows[Math.max(0, Math.min(rows.length - 1, (idx < 0 ? -1 : idx) + d))];
        if (!next) return;
        if (st.open) go(threadHash(r as MailRoute, next.id), true);
        else {
          setState({ focusId: next.id });
          revealRow(next.id);
        }
      };
      const last = st.open?.messages.filter((m) => !m.labelIds.includes('DRAFT')).at(-1);
      if (Date.now() - gPressed.current < 1200) {
        gPressed.current = 0;
        const dest = { i: '#/inbox', s: '#/starred', t: '#/sent', d: '#/drafts' }[e.key];
        if (dest) {
          e.preventDefault();
          go(dest);
          return;
        }
      }
      const ids = targetIds();
      const handled = (() => {
        switch (e.key) {
          case 'g': gPressed.current = Date.now(); return true;
          case 'c': openCompose(); return true;
          case '?': setState({ showKeys: true }); return true;
          case 'j': move(1); return true;
          case 'k': move(-1); return true;
          case 'o':
          case 'Enter': if (cur && !st.open) openRow(cur); return !!cur;
          case 'u': if (st.open) closeThread(); else go(listHash(r)); return true;
          case 'e':
            if (st.open && !st.selected.size && pileOf(st.open.labelIds)) actions.unpin(ids, false);
            else actions.archive(ids);
            return true;
          case 'p':
          case 't': {
            const p = e.key === 'p' ? 'aside' : 'action';
            if (st.open && !st.selected.size && pileOf(st.open.labelIds) === p) actions.unpin(ids, true);
            else actions.pin(p, ids);
            return ids.length > 0;
          }
          case 'n':
            if (!notesEnabled || !st.open) return false;
            setState({ noteEditing: st.open.id });
            return true;
          case '#': actions.trash(ids); return true;
          case '!': actions.spam(ids); return true;
          case 's': {
            const row = rows.find((x) => x.id === ids[0]);
            actions.star(ids, !(row?.starred ?? false));
            return true;
          }
          case 'x': if (cur) toggleSelect(cur); return !!cur;
          case 'r': if (last) openCompose(defaultReplyMode(last), last); return !!last;
          case 'a': if (last) openCompose('replyAll', last); return !!last;
          case 'f': if (last) openCompose('forward', last); return !!last;
          case 'v':
          case 'l': {
            const label = t(e.key === 'v' ? 'act.moveTo' : 'act.labelAs');
            if (st.open) return openBarMenu('thread', label);
            return st.selected.size > 0 && openBarMenu('bulk', label);
          }
          case 'I': actions.read(ids, true); return true;
          case 'U': actions.read(ids, false); return true;
          default: return false;
        }
      })();
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.phase]);
}

export function KeyHelp() {
  return (
    <div class="scrim" onClick={() => setState({ showKeys: false })}>
      <div class="dialog" role="dialog" aria-modal="true" aria-label={t('keys.title')} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Icon name="keyboard" style={{ color: 'var(--c-trash)' }} />
          <h2 style={{ margin: 0, fontSize: 'calc(20px * var(--ts, 1))', fontWeight: 800, flex: 1 }}>{t('keys.title')}</h2>
          <button class="ib" aria-label={t('misc.close')} onClick={() => setState({ showKeys: false })} autoFocus>
            <Icon name="x" />
          </button>
        </div>
        <KeyList />
      </div>
    </div>
  );
}

export function KeyList() {
  return (
    <div class="keys">
      {MAP.map(([k, label]) => (
        <div>
          <span>{t(label)}</span>
          <span class="kbd">{k}</span>
        </div>
      ))}
    </div>
  );
}
