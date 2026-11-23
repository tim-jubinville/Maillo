import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { listDate, type ThreadRow } from '../model';
import { go, threadHash, type MailRoute } from '../route';
import { Avatar, useOutside } from './common';
import { getPrefs } from '../prefs';
import { CIcon } from './ColorIcons';
import { Icon } from './Icon';
import { actions, PILES, type AppState, type PileId } from '../store';
import { dropZone } from '../dnd';
import type { ColorIconName } from './ColorIcons';
import type { StringKey } from '../i18n';

const MAX_FAN = 12;

export const PILE_ICON: Record<PileId, ColorIconName> = { action: 'action', aside: 'aside' };
export const pileKey = (p: PileId, k: 'title' | 'open' | 'fan' | 'viewAll') => `pile.${p}.${k}` as StringKey;

function openFromPile(s: AppState, p: PileId, id: string) {
  const r: MailRoute = s.route.view === 'mail' ? s.route : { view: 'mail', label: s.piles[p].labelId, category: 'primary' };
  go(threadHash({ ...r, thread: undefined }, id));
}

function who(r: ThreadRow) {
  return r.senders.slice(-2).map((x) => x.name).join(', ') || r.lastFrom.email;
}

export function PileBar({ s }: { s: AppState }) {
  const [open, setOpen] = useState<PileId | null>(null);
  // The fan folds back into its pile before it goes away.
  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef<number | undefined>(undefined);
  const refs = useRef<Partial<Record<PileId, HTMLButtonElement | null>>>({});
  const close = (refocus = true) => {
    const was = open;
    if (!was || leaving) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setLeaving(true);
    clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => {
      setOpen(null);
      setLeaving(false);
      if (refocus) refs.current[was]?.focus();
    }, reduce ? 0 : 320);
  };
  const toggle = (p: PileId) => {
    if (open === p) return close();
    clearTimeout(leaveTimer.current);
    setLeaving(false);
    setOpen(p);
  };
  const wrap = useOutside(!!open, () => close(!!wrap.current?.contains(document.activeElement)));
  useEffect(() => {
    if (open && s.piles[open].rows.length < 2) setOpen(null);
  }, [open && s.piles[open].rows.length]);
  const dragging = s.dragging === 'threads';
  // While dragging conversations, every pile shows as a drop target, even an empty one.
  const visible = PILES.filter((p) => dragging || s.piles[p].rows.length > 0);
  if (!visible.length) return null;
  return (
    <div ref={wrap} class={`pile-wrap ${open ? 'is-open' : ''}`}>
      {visible.map((p) => {
        const rows = s.piles[p].rows;
        const top = rows.slice(0, 3);
        const drop = dropZone('threads', (ids) => actions.pin(p, ids));
        if (!rows.length) {
          return (
            <div class={`pile pile-${p} pile-empty drop-ok`} {...drop}>
              <span class="pile-card d0">
                <CIcon name={PILE_ICON[p]} size={20} />
                <span class="pile-text"><b class="ell">{t(pileKey(p, 'title'))}</b></span>
              </span>
            </div>
          );
        }
        return (
          <button
            ref={(el) => { refs.current[p] = el; }}
            {...drop}
            class={`pile pile-${p} ${open === p ? 'on' : ''} ${dragging ? 'drop-ok' : ''}`}
            aria-label={t(pileKey(p, 'open'), { n: rows.length })}
            aria-expanded={rows.length > 1 ? open === p : undefined}
            aria-haspopup={rows.length > 1 ? 'true' : undefined}
            title={t(pileKey(p, 'title'))}
            onClick={() => (rows.length === 1 ? openFromPile(s, p, rows[0].id) : toggle(p))}
          >
            {[...top].reverse().map((r, i, arr) => {
              const depth = arr.length - 1 - i;
              return (
                <span class={`pile-card d${depth} ${r.id === s.open?.id ? 'cur' : ''}`} aria-hidden="true">
                  {depth === 0 && (
                    <>
                      <CIcon name={PILE_ICON[p]} size={20} />
                      <span class="pile-text">
                        <b class="ell">{who(r)}</b>
                        <span class="ell">{r.subject || t('list.noSubject')}</span>
                      </span>
                      {rows.length > 1 && <span class="pile-count">{rows.length}</span>}
                    </>
                  )}
                </span>
              );
            })}
          </button>
        );
      })}
      {open && <div class={`fan-scrim ${leaving ? 'leaving' : ''}`} aria-hidden="true" onClick={() => close(false)} />}
      {open && <Fan key={open} s={s} pile={open} rows={s.piles[open].rows} leaving={leaving} onClose={close} />}
    </div>
  );
}

function Fan({ s, pile, rows, leaving, onClose }: { s: AppState; pile: PileId; rows: ThreadRow[]; leaving: boolean; onClose: (refocus?: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [settled, setSettled] = useState(false);
  const [px, setPx] = useState<number | null>(null);
  const [vw, setVw] = useState(window.innerWidth);
  const extra = rows.length > MAX_FAN ? rows.length - (MAX_FAN - 1) : 0;
  const cards = extra ? rows.slice(0, MAX_FAN - 1) : rows;
  const n = cards.length + (extra ? 1 : 0);

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    const timer = setTimeout(() => setSettled(true), 520);
    ref.current?.querySelector<HTMLButtonElement>('.fan-card')?.focus({ preventScroll: true });
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const onKey = (e: KeyboardEvent) => {
    const btns = [...(ref.current?.querySelectorAll<HTMLElement>('.fan-open, .fan-card.more') ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length];
      next?.focus();
    }
  };

  // Cards sit on a shallow arc that flattens as the pile grows, so the fan always fits the screen.
  const step = Math.min(150, (vw - 220) / Math.max(n - 1, 1));
  const xOf = (i: number) => (i - (n - 1) / 2) * step;
  const maxX = Math.abs(xOf(0));
  const R = Math.max(900, (maxX * maxX) / 80);
  const maxY = (maxX * maxX) / (2 * R);
  const place = (i: number) => {
    const x = xOf(i);
    const angle = (x / R) * (180 / Math.PI);
    const y = (x * x) / (2 * R) - maxY;
    let scale = 1;
    if (px !== null) scale = 1 + 0.2 * Math.max(0, 1 - Math.abs(px - x) / 170);
    const lift = (scale - 1) * 120;
    const out = shown && !leaving;
    return {
      '--i': i,
      '--r': n - 1 - i,
      transform: out
        ? `translate(${x}px, ${y - lift}px) rotate(${angle}deg) scale(${scale})`
        : `translate(0px, 90px) rotate(0deg) scale(0.6)`,
      zIndex: px === null ? i : Math.round(scale * 100)
    } as Record<string, string | number>;
  };

  return (
    <div
      ref={ref}
      class={`fan fan-${pile} ${shown ? 'shown' : ''} ${settled ? 'settled' : ''} ${leaving ? 'leaving' : ''}`}
      role="group"
      aria-label={t(pileKey(pile, 'fan'))}
      onKeyDown={onKey}
      onPointerMove={(e) => {
        // Over the "Go through all" button: no card should grow toward the pointer and cover it.
        if ((e.target as Element).closest?.('.fan-all')) return setPx(null);
        const box = ref.current?.getBoundingClientRect();
        if (box) setPx(e.clientX - (box.left + box.width / 2));
      }}
      onPointerLeave={() => setPx(null)}
    >
      {cards.map((r, i) => (
        <div class={`fan-card ${r.id === s.open?.id ? 'cur' : ''}`} style={place(i)}>
        <button
          class="fan-open"
          onFocus={() => setPx(xOf(i))}
          onClick={() => {
            onClose(false);
            openFromPile(s, pile, r.id);
          }}
        >
          <span class="fan-top">
            <Avatar a={r.lastFrom} size="sm" />
            <b class="ell">{who(r)}</b>
          </span>
          <span class="fan-subject">{r.subject || t('list.noSubject')}</span>
          <span class="fan-foot">
            <span>{listDate(r.date)}</span>
            {s.notes[r.id] && <span role="img" aria-label={t('note.has')}><CIcon name="note" size={14} /></span>}
            {r.attachment && <Icon name="clip" size={12} />}
          </span>
        </button>
        <button
          class="fan-x"
          aria-label={`${t(pile === 'aside' ? 'act.unpin.aside' : 'act.unpin.action')}: ${r.subject || t('list.noSubject')}`}
          title={t(pile === 'aside' ? 'act.unpin.aside' : 'act.unpin.action')}
          onFocus={() => setPx(xOf(i))}
          onClick={() => actions.unpin([r.id], true)}
        >
          <Icon name="x" size={14} />
        </button>
        </div>
      ))}
      {extra > 0 && (
        <button
          class="fan-card more"
          style={place(n - 1)}
          onFocus={() => setPx(xOf(n - 1))}
          onClick={() => {
            onClose(false);
          const id = s.piles[pile].labelId;
            if (id) go(`#/label/${encodeURIComponent(id)}`);
          }}
        >
          <b>{t('pile.more', { n: extra })}</b>
          <span>{t(pileKey(pile, 'viewAll'))}</span>
        </button>
      )}
      <button
        class="btn sm fan-all"
        onClick={() => {
          onClose(false);
          const id = s.piles[pile].labelId;
          // With the reading pane: open the first one beside the list. Without it: show the pile's list.
          if (id && rows[0] && getPrefs().pane === 'right') go(`#/label/${encodeURIComponent(id)}/t/${encodeURIComponent(rows[0].id)}`);
          else if (id) go(`#/label/${encodeURIComponent(id)}`);
        }}
      >
        <CIcon name={PILE_ICON[pile]} size={16} />
        {t('pile.seeAll', { n: rows.length })}
        <Icon name="chevRight" size={14} />
      </button>
    </div>
  );
}
