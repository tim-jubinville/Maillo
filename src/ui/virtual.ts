import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

/** How far past the visible part rows are kept rendered, in pixels, so fast scrolling doesn't show gaps. */
const OVERSCAN = 700;

export interface VirtualRows {
  /** Indexes of the rows to render: the visible ones, plus any that must stay (focus, drag). */
  indexes: number[];
  top: (i: number) => number;
  total: number;
  /** Ref callback for each rendered row, so its real height replaces the estimate. */
  measure: (el: HTMLElement | null) => void;
  /** Scrolls just enough for a row to be fully visible. */
  reveal: (i: number) => void;
}

/**
 * Renders only the rows on screen in a scrolling list whose rows can differ in height.
 * Heights start as an estimate and are corrected as rows are measured.
 */
export function useVirtualRows(ids: string[], estimate: number, scroller: RefObject<HTMLElement | null>, keep: Set<string>): VirtualRows {
  const heights = useRef(new Map<string, number>());
  const [version, bump] = useState(0);
  const [view, setView] = useState({ top: 0, height: 900 });

  const observerRef = useRef<ResizeObserver | null>(null);
  const observer = useMemo(
    () =>
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            let changed = false;
            for (const e of entries) {
              const el = e.target as HTMLElement;
              // Rows scrolled out of view are removed from the page: stop watching them.
              if (!el.isConnected) {
                observerRef.current?.unobserve(el);
                continue;
              }
              const id = el.dataset.id;
              const h = el.offsetHeight;
              if (id && h && heights.current.get(id) !== h) {
                heights.current.set(id, h);
                changed = true;
              }
            }
            if (changed) bump((n) => n + 1);
          }),
    []
  );
  observerRef.current = observer;
  useEffect(() => () => observer?.disconnect(), [observer]);

  // A new density or layout changes every row's height: measure again.
  const lastEstimate = useRef(estimate);
  if (lastEstimate.current !== estimate) {
    lastEstimate.current = estimate;
    heights.current.clear();
  }

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      setView((v) => (v.top === el.scrollTop && v.height === el.clientHeight ? v : { top: el.scrollTop, height: el.clientHeight }));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onScroll);
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [scroller.current]);

  const tops = useMemo(() => {
    const out: number[] = new Array(ids.length + 1);
    let y = 0;
    for (let i = 0; i < ids.length; i++) {
      out[i] = y;
      y += heights.current.get(ids[i]) ?? estimate;
    }
    out[ids.length] = y;
    return out;
    // version: heights changed.
  }, [ids, estimate, version]);

  const from = view.top - OVERSCAN;
  const to = view.top + view.height + OVERSCAN;
  const indexes: number[] = [];
  // Rows are in order, so the visible ones are a single run.
  let lo = 0;
  let hi = ids.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tops[mid + 1] <= from) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < ids.length && tops[i] < to; i++) indexes.push(i);
  for (const id of keep) {
    const i = ids.indexOf(id);
    if (i >= 0 && !indexes.includes(i)) indexes.push(i);
  }
  indexes.sort((a, b) => a - b);

  return {
    indexes,
    top: (i) => tops[i],
    total: tops[ids.length],
    measure: (el) => {
      if (el && observer) observer.observe(el);
    },
    reveal: (i) => {
      const el = scroller.current;
      if (!el || i < 0 || i >= ids.length) return;
      const a = tops[i];
      const b = tops[i + 1];
      if (a < el.scrollTop) el.scrollTop = a;
      else if (b > el.scrollTop + el.clientHeight) el.scrollTop = b - el.clientHeight;
    }
  };
}
