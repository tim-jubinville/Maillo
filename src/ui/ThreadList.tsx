import { useRef } from 'preact/hooks';
import { t, type StringKey } from '../i18n';
import { labelColor, labelDisplayName, listDate, nudgeDays, SYSTEM_LABELS, type ThreadRow } from '../model';
import { getPrefs } from '../prefs';
import { dropZone, endDrag, startThreadDrag } from '../dnd';
import { CATEGORIES, go, listHash, type Category, type MailRoute } from '../route';
import { actions, loadList, pileOf, PILES, nextPage, openRow, prevPage, refresh, selectAll, toggleSelect, type AppState } from '../store';
import { Avatar, Ribbon } from './common';
import { BarButtons, fitItems, MoreMenu, useWidth, type BarItem } from './BarItems';
import { InboxZero } from './InboxZero';
import { CIcon, type ColorIconName } from './ColorIcons';
import { Icon } from './Icon';
import { LabelList, LabelMenu, MoveList, MoveMenu } from './Menus';
import { PILE_ICON } from './Piles';

const CAT_ICON: Record<Category, ColorIconName> = {
  primary: 'inbox',
  promotions: 'cat-promo',
  social: 'cat-social',
  updates: 'cat-updates',
  forums: 'cat-forums'
};

export function ThreadList({ s, route, split }: { s: AppState; route: MailRoute; split: boolean }) {
  const prefs = getPrefs();
  const rows = s.list.rows;
  const ids = rows.map((r) => r.id);
  const sel = [...s.selected];
  const all = ids.length > 0 && sel.length === ids.length;
  const folder = route.folder;
  const title = route.q !== undefined
    ? t('search.results')
    : route.label
      ? s.labels.find((l) => l.id === route.label)?.name ?? ''
      : t(`nav.${folder ?? 'inbox'}` as StringKey);
  const showTabs = folder === 'inbox' && route.q === undefined && !route.label && prefs.tabs;
  const start = s.list.page * prefs.pageSize;
  const compact = prefs.density === 'compact';
  const addChip = (token: string) => {
    const q = route.q ?? '';
    const next = q.includes(token) ? q.replace(token, '').replace(/\s+/g, ' ').trim() : `${q} ${token}`.trim();
    go(`#/search/${encodeURIComponent(next)}`);
  };
  // Slide the list in from the side of the category tab that was picked.
  const catIndex = showTabs ? CATEGORIES.indexOf(route.category) : -1;
  const lastCat = useRef(catIndex);
  const slide = useRef('');
  if (catIndex !== lastCat.current) {
    slide.current = catIndex >= 0 && lastCat.current >= 0 ? (catIndex > lastCat.current ? 'from-right' : 'from-left') : '';
    lastCat.current = catIndex;
  }
  const rowsKey = `${s.list.key}|${s.list.loading && !rows.length ? 'loading' : 'ready'}`;

  return (
    <section class={`listcol ${split ? 'split' : 'full'}`} aria-label={t('list.label')}>
      <div class="listhead">
      <div class="toolbar">
        <input type="checkbox" class="cb" aria-label={t('list.selectAll')} checked={all} indeterminate={sel.length > 0 && !all} onChange={() => selectAll(!all)} />
          <>
            <button class="ib" style={{ color: 'var(--c-scheduled)' }} aria-label={t('list.refresh')} title={t('list.refresh')} onClick={() => refresh()}><Icon name="refresh" /></button>
            <h1 class="ell">{title}</h1>
            <span class="range">
              {rows.length ? t('list.range', { from: start + 1, to: start + rows.length }) : ''}
            </span>
            <button class="ib" aria-label={t('list.newer')} title={t('list.newer')} disabled={s.list.page === 0} onClick={prevPage}><Icon name="chevLeft" /></button>
            <button class="ib" aria-label={t('list.older')} title={t('list.older')} disabled={!s.list.next} onClick={nextPage}><Icon name="chevRight" /></button>
          </>
      </div>

      {showTabs && (
        <div class="tabs" role="tablist" aria-label={t('cat.label')}>
          {CATEGORIES.map((c) => {
            const on = route.category === c;
            const n = s.catNew[c] ?? 0;
            const name = t(`cat.${c}` as StringKey);
            const fresh = c !== 'primary' && n > 0;
            const label = fresh ? `${name}, ${t('cat.new', { n })}` : name;
            return (
              <button
                role="tab"
                aria-selected={on}
                aria-label={label}
                title={on ? undefined : label}
                class={`tab tab-${c} ${on ? "on" : ""}`}
                onClick={() => go(listHash({ ...route, category: c, thread: undefined }))}
              >
                <span class="tab-ic">
                  <CIcon name={CAT_ICON[c]} size={20} />
                  {fresh && !on && <span class="tab-dot" aria-hidden="true" />}
                </span>
                {on && <span aria-hidden="true">{name}</span>}
              </button>
            );
          })}
        </div>
      )}

      {route.q !== undefined && (
        <div class="chips">
          {[
            ['has:attachment', t('search.hasAttachment'), 'clip'],
            ['is:unread', t('search.unread'), ''],
            ['newer_than:7d', t('search.lastWeek'), ''],
            ['from:me', t('search.fromMe'), ''],
            ['-filename:ics', t('search.excludeCalendar'), '']
          ].map(([token, label, icon]) => (
            <button class={`chip ${route.q!.includes(token) ? 'on' : ''}`} aria-pressed={route.q!.includes(token)} onClick={() => addChip(token)}>
              {icon && <Icon name={icon} size={14} />}
              {label}
            </button>
          ))}
        </div>
      )}

      </div>

      <div class={`rows ${showTabs ? `in ${slide.current}` : ''}`} role="list" key={rowsKey}>
        {s.list.loading && !rows.length && Array.from({ length: 6 }, () => <div class="skeleton" />)}
        {s.list.error && !rows.length && (
          <div class="empty">
            <b>{t('list.loadError')}</b>
            <span>{s.list.error}</span>
            <button class="btn sm" onClick={() => loadList(true)}>{t('list.retry')}</button>
          </div>
        )}
        {!s.list.loading && !s.list.error && !rows.length && folder === 'inbox' && route.q === undefined && !route.label && (
          <InboxZero
            title={!showTabs || route.category === 'primary' ? t('zero.title') : t('zero.cat', { name: t(`cat.${route.category}` as StringKey) })}
            sub={t('zero.sub')}
            celebrate={s.celebrate === s.list.key}
          />
        )}
        {!s.list.loading && !s.list.error && !rows.length && !(folder === 'inbox' && route.q === undefined && !route.label) && (
          <div class="empty">
            <Icon name="inbox" size={32} style={{ strokeWidth: '1.4' }} />
            <b>{t('list.empty')}</b>
            <span>{route.q !== undefined ? t('list.emptySearch') : t('list.emptyFolder', { name: title })}</span>
          </div>
        )}
        {rows.map((r) => (
          <Row s={s} r={r} route={route} compact={compact} split={split} />
        ))}
      </div>
      {sel.length > 0 && <BulkRibbon s={s} route={route} sel={sel} />}
    </section>
  );
}

function Row({ s, r, route, compact, split }: { s: AppState; r: ThreadRow; route: MailRoute; compact: boolean; split: boolean }) {
  const checked = s.selected.has(r.id);
  const open = s.open?.id === r.id && split;
  const focus = s.focusId === r.id;
  const labels = s.labels.filter((l) => r.labelIds.includes(l.id) && !SYSTEM_LABELS.has(l.id) && l.id !== route.label && l.type === 'user');
  const sentView = route.folder === 'sent' || route.folder === 'scheduled' || (route.folder === 'drafts' && r.count <= 1);
  const who = sentView && r.lastFromMe
    ? `${t('compose.to')}: ${r.recipients.map((a) => a.name || a.email).join(', ')}`
    : r.senders.slice(-3).map((x) => x.name).join(', ');
  const nudge = nudgeDays(r, route.folder);
  const hasNote = !!s.notes[r.id];
  const pile = pileOf(r.labelIds);
  const canAside = !r.labelIds.includes('SPAM') && !r.labelIds.includes('TRASH') && !(r.hasDraft && r.count <= 1 && !r.labelIds.includes('INBOX'));
  const cls = ['row', compact ? 'compact' : '', r.unread ? 'unread' : '', checked ? 'chk' : open ? 'sel' : '', focus ? 'focus' : ''].join(' ');
  return (
    <div
      class={`${cls} ${s.dragging === 'label' ? 'drop-ok' : ''}`}
      role="listitem"
      data-id={r.id}
      onClick={() => openRow(r.id)}
      draggable
      onDragStart={(e) => startThreadDrag(e, checked ? [...s.selected] : [r.id])}
      onDragEnd={endDrag}
      {...dropZone('label', ([labelId]) => actions.label(checked ? [...s.selected] : [r.id], [labelId], []))}
    >
      <input
        type="checkbox"
        class="cb"
        checked={checked}
        aria-label={t('list.select', { subject: r.subject || t('list.noSubject') })}
        onClick={(e) => e.stopPropagation()}
        onChange={() => toggleSelect(r.id)}
      />
      <button
        class={`star ${r.starred ? 'on' : ''}`}
        aria-label={r.starred ? t('list.unstar') : t('list.star')}
        aria-pressed={r.starred}
        onClick={(e) => {
          e.stopPropagation();
          actions.star([r.id], !r.starred);
        }}
      >
        <Icon name="star" fill={r.starred ? '#FFD84D' : undefined} />
      </button>
      <button class="row-main" onClick={(e) => { e.stopPropagation(); openRow(r.id); }}>
        {!compact && <Avatar a={sentView && r.recipients[0] ? r.recipients[0] : r.lastFrom} />}
        <span class="row-body">
          <span class="row-top">
            <span class="row-from ell">
              {r.hasDraft && route.folder !== 'drafts' ? <><span class="draft-tag">{t('list.draft')}</span>{who ? `, ${who}` : ''}</> : who || r.lastFrom.email}
            </span>
            {r.count > 1 && <span class="row-count">{r.count}</span>}
            {hasNote && (
              <span class="row-note" role="img" aria-label={t('note.has')} title={s.notes[r.id].text}><CIcon name="note" size={15} /></span>
            )}
            {r.important && <Icon name="important" size={14} style={{ color: 'var(--c-trash)' }} fill="#FFD84D" />}
            {!compact && <span class="row-time">{listDate(r.date)}</span>}
          </span>
          <span class="row-subject ell">
            {r.subject || t('list.noSubject')}
            {compact && <span class="row-snippet"> — {r.snippet}</span>}
          </span>
          {!compact && r.snippet && <span class="row-snippet ell">{r.snippet}</span>}
          {compact && <span class="row-time">{listDate(r.date)}</span>}
          {!compact && (labels.length > 0 || r.attachment || nudge > 0) && (
            <span class="row-meta">
              {labels.slice(0, 3).map((l) => (
                <span class="tag lbl" style={{ '--lc': labelColor(l) }}><span class="dot" /><span class="ell">{labelDisplayName(l)}</span></span>
              ))}
              {r.attachment && (
                <span class="att" role="img" aria-label={t('read.attachments', { n: 1 })}><Icon name="clip" size={12} /></span>
              )}
              {nudge > 0 && <span class="nudge">{t('list.nudge', { n: nudge })}</span>}
            </span>
          )}
        </span>
      </button>
      <span class="row-acts">
        {r.labelIds.includes('INBOX') && <RowAct label={t('act.archive')} icon="archive" run={() => actions.archive([r.id])} />}
        {!r.labelIds.includes('TRASH') && <RowAct label={t('act.delete')} icon="trash" run={() => actions.trash([r.id])} />}
        <RowAct label={r.unread ? t('act.markRead') : t('act.markUnread')} icon={r.unread ? 'mail' : 'unread'} run={() => actions.read([r.id], r.unread)} />
        {canAside && <span class="row-sep" aria-hidden="true" />}
        {canAside && PILES.map((p) => {
          const here = pile === p;
          return (
            <RowAct
              label={here ? t(p === 'aside' ? 'act.unpin.aside' : 'act.unpin.action') : t(p === 'aside' ? 'act.pin.aside' : 'act.pin.action')}
              icon={here ? 'inbox' : PILE_ICON[p]}
              run={() => (here ? actions.unpin([r.id], true) : actions.pin(p, [r.id]))}
            />
          );
        })}
      </span>
    </div>
  );
}

function BulkRibbon({ s, route, sel }: { s: AppState; route: MailRoute; sel: string[] }) {
  const bar = useRef<HTMLDivElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  const width = useWidth(bar);
  const countW = useWidth(count);
  const folder = route.folder;
  const selRows = s.list.rows.filter((r) => s.selected.has(r.id));
  const anyUnread = selRows.some((r) => r.unread);
  const items: BarItem[] = [
    ...(folder === 'spam'
      ? [{ id: 'notspam', group: 1, prio: 10, w: 104, label: t('act.notSpam'), icon: 'spam' as const, text: true, run: () => actions.notSpam(sel) }]
      : folder === 'trash'
        ? [{ id: 'restore', group: 1, prio: 10, w: 96, label: t('act.restore'), icon: 'inbox' as const, text: true, run: () => actions.restore(sel) }]
        : [
            { id: 'archive', group: 1, prio: 10, w: 38, label: t('act.archive'), icon: 'archive' as const, run: () => actions.archive(sel) },
            { id: 'spam', group: 1, prio: 6, w: 38, label: t('act.spam'), icon: 'spam' as const, run: () => actions.spam(sel) },
            { id: 'trash', group: 1, prio: 9, w: 38, label: t('act.delete'), icon: 'trash' as const, run: () => actions.trash(sel) },
            ...PILES.map((p, i) => {
              const inPile = selRows.length > 0 && selRows.every((r) => pileOf(r.labelIds) === p);
              return inPile
                ? { id: `pile-${p}`, group: 2, prio: 8.5 - i * 0.2, w: 38, label: t(p === 'aside' ? 'act.unpin.aside' : 'act.unpin.action'), icon: 'inbox' as const, run: () => actions.unpin(sel, true) }
                : { id: `pile-${p}`, group: 2, prio: 8.5 - i * 0.2, w: 38, label: t(p === 'aside' ? 'act.pin.aside' : 'act.pin.action'), icon: PILE_ICON[p], run: () => actions.pin(p, sel) };
            })
          ]),
    { id: 'read', group: 2, prio: 7, w: 38, label: anyUnread ? t('act.markRead') : t('act.markUnread'), icon: anyUnread ? 'mail' : 'unread', run: () => actions.read(sel, anyUnread) },
    { id: 'star', group: 2, prio: 5.5, w: 38, label: t('list.star'), icon: 'starred', run: () => actions.star(sel, true) },
    { id: 'important', group: 2, prio: 3, w: 38, label: t('act.markImportant'), icon: 'important', run: () => actions.important(sel, true) },
    { id: 'move', group: 3, prio: 5, w: 38, label: t('act.moveTo'), icon: 'move', menu: <MoveMenu s={s} ids={sel} />, sub: (close) => <MoveList s={s} ids={sel} onDone={close} /> },
    { id: 'labels', group: 3, prio: 4, w: 38, label: t('act.labelAs'), icon: 'label', menu: <LabelMenu s={s} ids={sel} />, sub: (close) => <LabelList s={s} ids={sel} onDone={close} /> }
  ];
  // Padding, the count, "…" and the clear button.
  const fixed = 20 + (countW > 1000 ? 110 : countW + 14) + 38 + 38;
  const { shown } = fitItems(items, width - fixed);
  const hidden = items.filter((i) => !shown.has(i.id));
  return (
    <Ribbon label={t('list.selected', { n: sel.length })} bottom>
      <div class="toolbar nowrap" ref={bar}>
        <span class="sel-n" ref={count}>{t('list.selected', { n: sel.length })}</span>
        <BarButtons items={items} shown={shown} />
        <MoreMenu hidden={hidden} align="right" />
        <button class="ib clear-sel" aria-label={t('list.clearSelection')} title={t('list.clearSelection')} onClick={() => selectAll(false)}><Icon name="x" /></button>
      </div>
    </Ribbon>
  );
}

function RowAct({ label, icon, run }: { label: string; icon: ColorIconName; run: () => void }) {
  return (
    <button
      class="row-act"
      aria-label={label}
      title={label}
      draggable={false}
      onClick={(e) => {
        e.stopPropagation();
        run();
      }}
    >
      <CIcon name={icon} size={17} />
    </button>
  );
}
