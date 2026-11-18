import { t, type StringKey } from '../i18n';
import { labelColor, labelDisplayName, listDate, nudgeDays, SYSTEM_LABELS, type ThreadRow } from '../model';
import { getPrefs } from '../prefs';
import { CATEGORIES, go, listHash, type MailRoute } from '../route';
import { actions, loadList, nextPage, openRow, prevPage, refresh, selectAll, toggleSelect, type AppState } from '../store';
import { Avatar } from './common';
import { Icon } from './Icon';
import { LabelMenu, MoveMenu } from './Menus';

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
  const inSpam = folder === 'spam';
  const inTrash = folder === 'trash';
  const anyUnread = rows.some((r) => s.selected.has(r.id) && r.unread);
  const addChip = (token: string) => {
    const q = route.q ?? '';
    const next = q.includes(token) ? q.replace(token, '').replace(/\s+/g, ' ').trim() : `${q} ${token}`.trim();
    go(`#/search/${encodeURIComponent(next)}`);
  };

  return (
    <section class={`listcol ${split ? 'split' : 'full'}`} aria-label={t('list.label')}>
      <div class="toolbar">
        <input type="checkbox" class="cb" aria-label={t('list.selectAll')} checked={all} indeterminate={sel.length > 0 && !all} onChange={() => selectAll(!all)} />
        {sel.length > 0 ? (
          <>
            <span style={{ fontSize: '13px', fontWeight: 600, marginRight: '8px' }}>{t('list.selected', { n: sel.length })}</span>
            {inSpam ? (
              <button class="btn sm" onClick={() => actions.notSpam(sel)}>{t('act.notSpam')}</button>
            ) : inTrash ? (
              <button class="btn sm" onClick={() => actions.restore(sel)}>{t('act.restore')}</button>
            ) : (
              <>
                <button class="ib" style={{ color: 'var(--c-sent)' }} aria-label={t('act.archive')} title={t('act.archive')} onClick={() => actions.archive(sel)}><Icon name="archive" /></button>
                <button class="ib" style={{ color: 'var(--c-spam)' }} aria-label={t('act.spam')} title={t('act.spam')} onClick={() => actions.spam(sel)}><Icon name="spam" /></button>
                <button class="ib" style={{ color: 'var(--c-trash)' }} aria-label={t('act.delete')} title={t('act.delete')} onClick={() => actions.trash(sel)}><Icon name="trash" /></button>
              </>
            )}
            <span class="sep" />
            <button class="ib" style={{ color: 'var(--c-inbox)' }} aria-label={anyUnread ? t('act.markRead') : t('act.markUnread')} title={anyUnread ? t('act.markRead') : t('act.markUnread')} onClick={() => actions.read(sel, anyUnread)}>
              <Icon name={anyUnread ? 'mailOpen' : 'mail'} />
            </button>
            <button class="ib" style={{ color: 'var(--c-star)' }} aria-label={t('list.star')} title={t('list.star')} onClick={() => actions.star(sel, true)}><Icon name="star" /></button>
            <button class="ib" style={{ color: 'var(--c-important)' }} aria-label={t('act.markImportant')} title={t('act.markImportant')} onClick={() => actions.important(sel, true)}><Icon name="important" /></button>
            <span class="sep" />
            <MoveMenu s={s} ids={sel} />
            <LabelMenu s={s} ids={sel} />
          </>
        ) : (
          <>
            <button class="ib" style={{ color: 'var(--c-scheduled)' }} aria-label={t('list.refresh')} title={t('list.refresh')} onClick={() => refresh()}><Icon name="refresh" /></button>
            <h1 class="ell">{title}</h1>
            <span class="range">
              {rows.length ? t('list.range', { from: start + 1, to: start + rows.length }) : ''}
            </span>
            <button class="ib" aria-label={t('list.newer')} title={t('list.newer')} disabled={s.list.page === 0} onClick={prevPage}><Icon name="chevLeft" /></button>
            <button class="ib" aria-label={t('list.older')} title={t('list.older')} disabled={!s.list.next} onClick={nextPage}><Icon name="chevRight" /></button>
          </>
        )}
      </div>

      {showTabs && (
        <div class="tabs" role="tablist" aria-label={t('cat.label')}>
          {CATEGORIES.map((c) => {
            const on = route.category === c;
            const n = s.catNew[c] ?? 0;
            return (
              <button role="tab" aria-selected={on} class={`tab ${on ? 'on' : ''}`} onClick={() => go(listHash({ ...route, category: c, thread: undefined }))}>
                {t(`cat.${c}` as StringKey)}
                {c !== 'primary' && n > 0 && <span class="pill">{t('cat.new', { n })}</span>}
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

      <div class="rows" role="list">
        {s.list.loading && !rows.length && Array.from({ length: 6 }, () => <div class="skeleton" />)}
        {s.list.error && !rows.length && (
          <div class="empty">
            <b>{t('list.loadError')}</b>
            <span>{s.list.error}</span>
            <button class="btn sm" onClick={() => loadList(true)}>{t('list.retry')}</button>
          </div>
        )}
        {!s.list.loading && !s.list.error && !rows.length && (
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
  const cls = ['row', compact ? 'compact' : '', r.unread ? 'unread' : '', checked ? 'chk' : open ? 'sel' : '', focus ? 'focus' : ''].join(' ');
  return (
    <div class={cls} role="listitem" data-id={r.id} onClick={() => openRow(r.id)}>
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
                <span class="tag"><span class="dot" style={{ background: labelColor(l) }} /><span class="ell">{labelDisplayName(l)}</span></span>
              ))}
              {r.attachment && (
                <span class="att" role="img" aria-label={t('read.attachments', { n: 1 })}><Icon name="clip" size={12} /></span>
              )}
              {nudge > 0 && <span class="nudge">{t('list.nudge', { n: nudge })}</span>}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}
