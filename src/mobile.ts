import { useEffect, useState } from 'preact/hooks';

/** Phones and other narrow screens: the same breakpoint as the single-column layout in styles.css. */
const NARROW = '(max-width: 900px)';
const mq = typeof matchMedia === 'function' ? matchMedia(NARROW) : undefined;

export function isNarrow(): boolean {
  return !!mq?.matches;
}

export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(isNarrow());
  useEffect(() => {
    if (!mq) return;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

function appEl() {
  return document.querySelector<HTMLElement>('.app');
}

function setHeaderHidden(hidden: boolean) {
  appEl()?.classList.toggle('head-hidden', hidden);
}

/**
 * Phone behaviours that don't belong to one component:
 * - the header slides away while scrolling down a list or conversation, and comes back when scrolling up;
 * - the visible area above the on-screen keyboard is kept in --vvh / --vvt, so full-screen compose fits above it.
 */
export function initMobile() {
  const last = new WeakMap<EventTarget, number>();
  document.addEventListener(
    'scroll',
    (e) => {
      const el = e.target as HTMLElement;
      if (!isNarrow() || !(el instanceof HTMLElement) || !el.matches('.readscroll, .rows')) return;
      const y = el.scrollTop;
      const prev = last.get(el) ?? y;
      last.set(el, y);
      if (y < 40) setHeaderHidden(false);
      else if (y - prev > 6) setHeaderHidden(true);
      else if (prev - y > 6) setHeaderHidden(false);
    },
    { capture: true, passive: true }
  );
  window.addEventListener('hashchange', () => setHeaderHidden(false));
  mq?.addEventListener('change', () => setHeaderHidden(false));

  const vv = window.visualViewport;
  if (vv) {
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty('--vvh', `${vv.height}px`);
      root.style.setProperty('--vvt', `${vv.offsetTop}px`);
      const kb = window.innerHeight - vv.height > 120;
      appEl()?.classList.toggle('kb-open', kb && isNarrow());
      // Keep the field being typed in visible once the keyboard is up.
      const a = document.activeElement as HTMLElement | null;
      if (kb && a?.closest('.quick')) a.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
  }
}

/* Swiping between conversations. */

type SwipeHandler = (dir: 1 | -1) => void;
let swipeHandler: SwipeHandler | null = null;
let swipeDir: 1 | -1 | 0 = 0;

/** The reading view registers what a sideways swipe does: 1 is the next (older) conversation, -1 the previous one. */
export function setSwipeHandler(h: SwipeHandler | null) {
  swipeHandler = h;
}

/** Direction of the swipe that opened the current conversation, once, for its slide-in. */
export function takeSwipeDir(): 1 | -1 | 0 {
  const d = swipeDir;
  swipeDir = 0;
  return d;
}

function scrollsSideways(target: EventTarget | null, doc: Document): boolean {
  const root = doc.documentElement;
  if (root.scrollWidth > root.clientWidth + 1 && doc !== document) return true;
  for (let el = target instanceof Element ? target : null; el && el !== doc.body; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const o = getComputedStyle(el).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
  }
  return false;
}

/** Listens for quick sideways swipes on an element or a message frame's document. Returns the cleanup. */
export function bindSwipe(target: HTMLElement | Document): () => void {
  // A message frame's document belongs to the frame's window, so check the node type rather than instanceof.
  const doc = target.nodeType === Node.DOCUMENT_NODE ? (target as Document) : (target as HTMLElement).ownerDocument;
  let start: { x: number; y: number; t: number } | null = null;
  const down = (e: TouchEvent) => {
    const p = e.touches[0];
    // Leave the screen edge to the browser's own back gesture, and wide content to its own scrolling.
    start = e.touches.length === 1 && p.screenX > 24 && !scrollsSideways(e.target, doc) ? { x: p.clientX, y: p.clientY, t: Date.now() } : null;
  };
  const up = (e: TouchEvent) => {
    if (!start || !swipeHandler || !isNarrow()) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - start.x;
    const dy = p.clientY - start.y;
    const fast = Date.now() - start.t < 600;
    start = null;
    if (fast && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) {
      const dir = dx < 0 ? 1 : -1;
      swipeDir = dir;
      swipeHandler(dir);
    }
  };
  target.addEventListener('touchstart', down as EventListener, { passive: true });
  target.addEventListener('touchend', up as EventListener, { passive: true });
  return () => {
    target.removeEventListener('touchstart', down as EventListener);
    target.removeEventListener('touchend', up as EventListener);
  };
}
