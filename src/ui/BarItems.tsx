import type { ComponentChildren, RefObject } from 'preact';
import { useLayoutEffect, useState } from 'preact/hooks';
import { t } from '../i18n';
import { CIcon, type ColorIconName } from './ColorIcons';
import { Menu } from './common';
import { Icon } from './Icon';
import { keyProps } from '../tooltip';

/** One ribbon action. Items that don't fit move into the "…" menu, lowest `prio` first. */
export interface BarItem {
  id: string;
  group: number;
  prio: number;
  /** Width in the bar, in pixels. */
  w: number;
  label: string;
  icon: ColorIconName;
  text?: boolean;
  /** Keyboard shortcut, shown small in the tooltip. */
  key?: string;
  /** Shown pressed in; clicking it again undoes it (e.g. take a conversation out of a pile). */
  pressed?: boolean;
  run?: () => void;
  menu?: ComponentChildren;
  /** Content shown when this item is opened from the "…" menu. */
  sub?: (close: () => void) => ComponentChildren;
}

export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(2000);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.offsetWidth));
    ro.observe(el);
    setWidth(el.offsetWidth);
    return () => ro.disconnect();
  }, []);
  return width;
}

/** Picks the items that fit in `room` pixels, by priority, counting a separator between groups. */
export function fitItems(items: BarItem[], room: number): { shown: Set<string>; room: number } {
  const shown = new Set<string>();
  const groupsUsed = new Set<number>();
  for (const it of [...items].sort((a, b) => b.prio - a.prio)) {
    const sep = groupsUsed.size > 0 && !groupsUsed.has(it.group) ? 14 : 0;
    if (it.w + sep <= room) {
      shown.add(it.id);
      groupsUsed.add(it.group);
      room -= it.w + sep;
    }
  }
  return { shown, room };
}

export function BarButtons({ items, shown }: { items: BarItem[]; shown: Set<string> }) {
  let lastGroup = -1;
  return (
    <>
      {items.filter((i) => shown.has(i.id)).map((i) => {
        const sep = lastGroup !== -1 && i.group !== lastGroup;
        lastGroup = i.group;
        return (
          <>
            {sep && <span class="sep" />}
            {i.menu ?? (i.text ? (
              <button class="btn sm" onClick={i.run}>{i.label}</button>
            ) : (
              <button class={`ib ${i.pressed ? 'pressed' : ''}`} aria-label={i.label} title={i.label} aria-pressed={i.pressed === undefined ? undefined : i.pressed} {...keyProps(i.key)} onClick={i.run}><CIcon name={i.icon} /></button>
            ))}
          </>
        );
      })}
    </>
  );
}

/** Opens a ribbon's Move to / Label as menu, from the "…" menu if it has folded there. */
export function openBarMenu(bar: 'thread' | 'bulk', label: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-bar="${bar}"]`);
  if (!el) return false;
  const direct = [...el.querySelectorAll<HTMLButtonElement>('button[aria-haspopup]')].find((b) => b.getAttribute('aria-label') === label);
  if (direct) {
    if (direct.getAttribute('aria-expanded') !== 'true') direct.click();
    return true;
  }
  const more = [...el.querySelectorAll<HTMLButtonElement>('button[aria-haspopup]')].find((b) => b.getAttribute('aria-label') === t('act.more'));
  if (!more) return false;
  if (more.getAttribute('aria-expanded') !== 'true') more.click();
  requestAnimationFrame(() => {
    const item = [...el.querySelectorAll<HTMLButtonElement>('.pop .mi')].find((b) => b.textContent?.trim() === label);
    item?.click();
  });
  return true;
}

export function MoreMenu({ hidden, more, align }: { hidden: BarItem[]; more?: (close: () => void) => ComponentChildren; align?: 'left' | 'right' }) {
  return (
    <Menu label={t('act.more')} button={<CIcon name="more" />} align={align}>
      {(close) => <MoreItems hidden={hidden} more={more} close={close} />}
    </Menu>
  );
}

function MoreItems({ hidden, more, close }: { hidden: BarItem[]; more?: (close: () => void) => ComponentChildren; close: () => void }) {
  // Items with their own list (Move to, Label as) open in place, with a way back.
  const [drill, setDrill] = useState<BarItem | null>(null);
  if (drill?.sub) {
    return (
      <>
        <button class="mi pop-back" onClick={() => setDrill(null)}>
          <Icon name="arrowLeft" size={16} />
          <b>{drill.label}</b>
        </button>
        {drill.sub(close)}
      </>
    );
  }
  return (
    <>
      {hidden.map((i) => (
        <button class="mi" aria-pressed={i.pressed} onClick={() => (i.sub ? setDrill(i) : (close(), i.run?.()))}>
          <CIcon name={i.icon} size={18} />
          <span class="ell">{i.label}</span>
          {i.pressed && <Icon name="check" size={14} style={{ marginLeft: 'auto', color: 'var(--accent)' }} />}
          {i.sub && <Icon name="chevRight" size={14} style={{ marginLeft: 'auto', color: 'var(--muted)' }} />}
        </button>
      ))}
      {more && hidden.length > 0 && <hr />}
      {more?.(close)}
    </>
  );
}
