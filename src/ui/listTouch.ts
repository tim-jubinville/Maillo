import { useEffect } from 'preact/hooks';
import type { RefObject } from 'preact';
import { t } from '../i18n';
import type { ThreadRow } from '../model';
import { isNarrow } from '../mobile';
import { iconUrl } from './Icon';
import { getPrefs, type SwipeAction } from '../prefs';
import { actions, getState, pileOf, refresh, toggleSelect } from '../store';

const ARM = 90;
const PULL_ARM = 64;

export const SWIPE_COLOR: Record<Exclude<SwipeAction, 'none'>, string> = {
  archive: '#25855f',
  trash: '#c8402f',
  read: '#2b59e8',
  aside: '#6b4fd6',
  action: '#c2581b'
};

/** What a swipe does on this row, or nothing when the action doesn't apply here. */
function swipeFor(kind: SwipeAction, r: ThreadRow): { label: string; color: string; icon: string; run: () => void } | null {
  const id = [r.id];
  const inTrash = r.labelIds.includes('TRASH');
  const inSpam = r.labelIds.includes('SPAM');
  switch (kind) {
    case 'archive':
      return r.labelIds.includes('INBOX') ? { label: t('act.archive'), color: SWIPE_COLOR.archive, icon: 'archive', run: () => actions.archive(id) } : null;
    case 'trash':
      return inTrash ? null : { label: t('act.delete'), color: SWIPE_COLOR.trash, icon: 'trash', run: () => actions.trash(id) };
    case 'read':
      return { label: r.unread ? t('act.markRead') : t('act.markUnread'), color: SWIPE_COLOR.read, icon: r.unread ? 'mailOpen' : 'mail', run: () => actions.read(id, r.unread) };
    case 'aside':
    case 'action': {
      if (inTrash || inSpam) return null;
      const here = pileOf(r.labelIds) === kind;
      const label = here ? t(kind === 'aside' ? 'act.unpin.aside' : 'act.unpin.action') : t(kind === 'aside' ? 'act.pin.aside' : 'act.pin.action');
      return { label, color: SWIPE_COLOR[kind], icon: kind === 'aside' ? 'layers' : 'important', run: () => (here ? actions.unpin(id, true) : actions.pin(kind, id)) };
    }
    default:
      return null;
  }
}

/**
 * Gestures on the conversation list. Phones: swipe a row for its swipe action, press and hold to select, tap to
 * add to a selection already started, and pull down at the top to refresh. Desktop: two-finger trackpad swipes.
 */
export function useListTouch(scroller: RefObject<HTMLDivElement | null>, ptr: RefObject<HTMLDivElement | null>, key: string) {
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    let start: { x: number; y: number; row: HTMLElement | null; id: string; top: boolean } | null = null;
    let mode: 'pending' | 'swipe' | 'pull' | 'scroll' | 'long' = 'scroll';
    let timer: number | undefined;
    let swipe: ReturnType<typeof swipeFor> = null;
    let armed = false;
    let dx = 0;
    let pull = 0;
    let suppress = false;
    let lastTouch = 0;

    const reset = (row: HTMLElement | null) => {
      if (!row) return;
      row.classList.remove('swiping', 'armed');
      row.style.removeProperty('--sx');
      row.style.removeProperty('--swipe-c');
      row.style.removeProperty('--swipe-icon');
      delete row.dataset.swipeLabel;
      delete row.dataset.side;
    };
    const setPull = (v: number) => {
      const el = ptr.current;
      if (!el) return;
      el.style.setProperty('--pull', `${v}px`);
      el.style.setProperty('--pull-r', `${v * 4}deg`);
      el.classList.toggle('on', v > 0);
      el.classList.toggle('armed', v >= PULL_ARM);
    };

    // Shared by touch and trackpad: follow the gesture, then act or settle back.
    const drag = (row: HTMLElement, id: string, mx: number) => {
      const r = getState().list.rows.find((x) => x.id === id);
      const prefs = getPrefs();
      const next = r ? swipeFor(mx > 0 ? prefs.swipeRight : prefs.swipeLeft, r) : null;
      // Nothing to do in that direction: the row barely moves.
      dx = next ? Math.max(-row.offsetWidth * 0.9, Math.min(row.offsetWidth * 0.9, mx)) : mx / 6;
      swipe = next;
      armed = !!next && Math.abs(mx) >= ARM;
      row.classList.add('swiping');
      row.classList.toggle('armed', armed);
      row.style.setProperty('--sx', `${dx}px`);
      row.dataset.side = mx > 0 ? 'right' : 'left';
      if (next) {
        row.style.setProperty('--swipe-c', next.color);
        row.style.setProperty('--swipe-icon', iconUrl(next.icon));
        row.dataset.swipeLabel = next.label;
      } else {
        row.style.removeProperty('--swipe-c');
        delete row.dataset.swipeLabel;
      }
    };
    const release = (row: HTMLElement) => {
      if (armed && swipe) {
        const run = swipe.run;
        row.style.setProperty('--sx', `${dx > 0 ? '' : '-'}110%`);
        row.classList.add('leaving');
        window.setTimeout(() => {
          row.classList.remove('leaving');
          reset(row);
          run();
        }, 170);
      } else {
        row.classList.add('settling');
        row.style.setProperty('--sx', '0px');
        window.setTimeout(() => {
          row.classList.remove('settling');
          reset(row);
        }, 180);
      }
      armed = false;
      swipe = null;
    };

    // Trackpads (desktop): a two-finger sideways scroll over a row swipes it. It acts once the fingers
    // and their momentum have stopped; momentum that keeps coming afterwards is swallowed.
    let wheel: { row: HTMLElement; id: string; mx: number; timer?: number } | null = null;
    let quietUntil = 0;
    const onWheel = (e: WheelEvent) => {
      if (isNarrow() || e.ctrlKey) return;
      const now = performance.now();
      if (!wheel) {
        if (Math.abs(e.deltaX) < 1 || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
        if (now < quietUntil) {
          quietUntil = now + 250;
          e.preventDefault();
          return;
        }
        const row = (e.target as Element).closest<HTMLElement>('.row[data-id]');
        if (!row) return;
        wheel = { row, id: row.dataset.id!, mx: 0 };
        armed = false;
        swipe = null;
      }
      e.preventDefault();
      wheel.mx -= e.deltaX * (e.deltaMode === 1 ? 16 : 1);
      drag(wheel.row, wheel.id, wheel.mx);
      clearTimeout(wheel.timer);
      wheel.timer = window.setTimeout(() => {
        if (!wheel) return;
        release(wheel.row);
        wheel = null;
        quietUntil = performance.now() + 250;
      }, 140);
    };

    const down = (e: TouchEvent) => {
      lastTouch = Date.now();
      if (!isNarrow() || e.touches.length !== 1) {
        start = null;
        return;
      }
      const p = e.touches[0];
      const row = (e.target as Element).closest<HTMLElement>('.row[data-id]');
      start = { x: p.clientX, y: p.clientY, row, id: row?.dataset.id ?? '', top: box.scrollTop <= 0 };
      mode = 'pending';
      armed = false;
      swipe = null;
      dx = 0;
      pull = 0;
      clearTimeout(timer);
      if (row && !(e.target as Element).closest('.cb, .star')) {
        timer = window.setTimeout(() => {
          if (mode !== 'pending' || !start) return;
          mode = 'long';
          suppress = true;
          toggleSelect(start.id);
          navigator.vibrate?.(12);
        }, 480);
      }
    };

    const move = (e: TouchEvent) => {
      if (!start) return;
      const p = e.touches[0];
      const mx = p.clientX - start.x;
      const my = p.clientY - start.y;
      if (mode === 'pending') {
        if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.5 && start.row) {
          mode = 'swipe';
          clearTimeout(timer);
        } else if (Math.abs(my) > 10) {
          mode = start.top && my > 0 ? 'pull' : 'scroll';
          clearTimeout(timer);
        } else return;
      }
      if (mode === 'swipe' && start.row) {
        e.preventDefault();
        drag(start.row, start.id, mx);
      } else if (mode === 'pull') {
        if (box.scrollTop > 0) return;
        pull = Math.min(my * 0.5, 90);
        setPull(Math.max(0, pull));
      }
    };

    const up = () => {
      clearTimeout(timer);
      if (!start) return;
      const row = start.row;
      if (mode === 'swipe' && row) {
        suppress = true;
        release(row);
      } else if (mode === 'pull') {
        if (pull >= PULL_ARM) {
          ptr.current?.classList.add('spin');
          setPull(PULL_ARM);
          Promise.resolve(refresh())
            .catch(() => undefined)
            .finally(() => {
              window.setTimeout(() => {
                ptr.current?.classList.remove('spin');
                setPull(0);
              }, 400);
            });
        } else setPull(0);
      }
      start = null;
      mode = 'scroll';
    };

    // Swallow the click that follows a swipe or a long press; once something is selected, taps add to the selection.
    const click = (e: MouseEvent) => {
      if (suppress) {
        suppress = false;
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      const touch = Date.now() - lastTouch < 800;
      const row = (e.target as Element).closest<HTMLElement>('.row[data-id]');
      if (touch && isNarrow() && row && getState().selected.size > 0 && !(e.target as Element).closest('.cb, .star')) {
        e.stopPropagation();
        e.preventDefault();
        toggleSelect(row.dataset.id!);
      }
    };
    const menu = (e: Event) => {
      if (mode === 'long' || suppress) e.preventDefault();
    };

    box.addEventListener('wheel', onWheel, { passive: false });
    box.addEventListener('touchstart', down, { passive: true });
    box.addEventListener('touchmove', move, { passive: false });
    box.addEventListener('touchend', up, { passive: true });
    box.addEventListener('touchcancel', up, { passive: true });
    box.addEventListener('click', click, true);
    box.addEventListener('contextmenu', menu);
    return () => {
      clearTimeout(timer);
      box.removeEventListener('wheel', onWheel);
      clearTimeout(wheel?.timer);
      box.removeEventListener('touchstart', down);
      box.removeEventListener('touchmove', move);
      box.removeEventListener('touchend', up);
      box.removeEventListener('touchcancel', up);
      box.removeEventListener('click', click, true);
      box.removeEventListener('contextmenu', menu);
    };
  }, [key]);
}
