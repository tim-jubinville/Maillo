import { useRef } from 'preact/hooks';
import { t } from '../i18n';
import { DEFAULT_LAYOUT, getPrefs, setPrefs, type LayoutPrefs } from '../prefs';

const LIMITS: Record<keyof LayoutPrefs, [number, number]> = {
  sidebar: [180, 380],
  list: [300, 820],
  panel: [260, 560]
};

const clamp = (k: keyof LayoutPrefs, v: number) => Math.round(Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v)));

/** CSS variables for the saved column widths, to set on the card. */
export function layoutVars(): Record<string, string> {
  const l = getPrefs().layout;
  return { '--w-sidebar': `${clamp('sidebar', l.sidebar)}px`, '--w-list': `${clamp('list', l.list)}px`, '--w-panel': `${clamp('panel', l.panel)}px` };
}

/**
 * Drag handle between two columns. `col` is the column it resizes; `side` says which edge of that
 * column the handle sits on, so dragging away from the column always makes it wider.
 */
export function Splitter({ col, side = 'right' }: { col: keyof LayoutPrefs; side?: 'left' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = () => clamp(col, getPrefs().layout[col]);
  const apply = (v: number) => ref.current?.closest<HTMLElement>('.card')?.style.setProperty(`--w-${col}`, `${v}px`);
  const save = (v: number) => setPrefs({ layout: { ...getPrefs().layout, [col]: v } });
  const label = t(`layout.resize.${col}`);

  return (
    <div
      ref={ref}
      class="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      aria-valuenow={width()}
      aria-valuemin={LIMITS[col][0]}
      aria-valuemax={LIMITS[col][1]}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture(e.pointerId);
        el.classList.add('dragging');
        document.body.classList.add('resizing');
        const startX = e.clientX;
        const start = width();
        let v = start;
        const move = (ev: PointerEvent) => {
          const dx = ev.clientX - startX;
          v = clamp(col, start + (side === 'right' ? dx : -dx));
          apply(v);
        };
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          el.classList.remove('dragging');
          document.body.classList.remove('resizing');
          if (v !== start) save(v);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      }}
      onDblClick={() => {
        apply(DEFAULT_LAYOUT[col]);
        save(DEFAULT_LAYOUT[col]);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        const grow = side === 'right' ? 'ArrowRight' : 'ArrowLeft';
        const shrink = side === 'right' ? 'ArrowLeft' : 'ArrowRight';
        let v: number | undefined;
        if (e.key === grow) v = clamp(col, width() + step);
        else if (e.key === shrink) v = clamp(col, width() - step);
        else if (e.key === 'Home') v = DEFAULT_LAYOUT[col];
        if (v === undefined) return;
        e.preventDefault();
        apply(v);
        save(v);
      }}
    />
  );
}
