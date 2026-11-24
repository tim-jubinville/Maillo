import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { config } from '../config';
import { b64urlToBase64, displayName, type Attachment, type ParsedMessage } from '../gmail/mime';
import { locale, t } from '../i18n';
import { fullDate, labelColor, labelDisplayName, listDate, sizeLabel } from '../model';
import { bindSwipe, setSwipeHandler, takeSwipeDir, useNarrow } from '../mobile';
import { go, listHash, threadHash, type MailRoute } from '../route';
import { actions, api, closeThread, defaultReplyMode, expandQuickReply, replyAllExtras, notesEnabled, pileLabelIds, pileOf, PILES, openCompose, openDraft, personName, quickReply, senderName, setNote, setState, toast, type AppState } from '../store';
import type { ThreadNote } from '../gmail/types';
import { Avatar, Menu, Ribbon, downloadBase64 } from './common';
import { CIcon } from './ColorIcons';
import { Icon } from './Icon';
import { BarButtons, fitItems, MoreMenu, useWidth, type BarItem } from './BarItems';
import { LabelList, LabelMenu, MoveList, MoveMenu } from './Menus';
import { MessageBody } from './MessageBody';
import { PILE_ICON, pileKey } from './Piles';

const TINTS: [RegExp, string][] = [
  [/pdf/, '#EE8F78'],
  [/sheet|excel|csv/, '#93DCC2'],
  [/word|document|text/, '#9CC4EC'],
  [/image/, '#AE9FE6'],
  [/zip|compressed/, '#93A6C0'],
  [/presentation|powerpoint/, '#FFBE7A'],
  [/calendar/, '#F1B3C2']
];

function tint(mime: string) {
  return TINTS.find(([re]) => re.test(mime))?.[1] ?? '#CBC2F0';
}

function ext(name: string) {
  const e = name.split('.').pop() ?? '';
  return e.length <= 4 ? e : 'file';
}

async function fetchAttachment(a: Attachment): Promise<string> {
  const data = a.inlineData ?? (a.attachmentId ? await api.getAttachment(a.messageId, a.attachmentId) : '');
  return b64urlToBase64(data);
}

async function openAttachment(a: Attachment, download: boolean) {
  try {
    const b64 = await fetchAttachment(a);
    if (download || !/^(image\/|application\/pdf|text\/plain)/.test(a.mimeType)) {
      downloadBase64(b64, a.filename, a.mimeType);
      return;
    }
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: a.mimeType }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    toast(t('toast.error', { msg: e instanceof Error ? e.message : String(e) }));
  }
}

async function showOriginal(id: string) {
  try {
    const raw = await api.getRawMessage(id);
    const bytes = Uint8Array.from(atob(b64urlToBase64(raw)), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'text/plain;charset=utf-8' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    toast(t('toast.error', { msg: e instanceof Error ? e.message : String(e) }));
  }
}

function unsubscribe(m: ParsedMessage) {
  const links = [...m.listUnsubscribe.matchAll(/<([^>]+)>/g)].map((x) => x[1]);
  const http = links.find((l) => /^https?:/i.test(l));
  const mailto = links.find((l) => /^mailto:/i.test(l));
  if (http) window.open(http, '_blank', 'noopener,noreferrer');
  else if (mailto) {
    const u = new URL(mailto);
    openCompose('new', undefined, {
      to: [{ name: '', email: decodeURIComponent(u.pathname) }],
      subject: u.searchParams.get('subject') || 'unsubscribe',
      html: `<div>${u.searchParams.get('body') || 'unsubscribe'}</div>`
    });
  }
}

export function ReadingPane({ s, route, showBack }: { s: AppState; route: MailRoute; showBack: boolean }) {
  const o = s.open;
  const narrow = useNarrow();
  const scroller = useRef<HTMLDivElement>(null);
  const enter = useRef<{ id: string; cls: string }>({ id: '', cls: '' });
  // Phones: swipe sideways for the next or previous conversation.
  const ids = s.list.rows.map((r) => r.id);
  const idx = o ? ids.indexOf(o.id) : -1;
  useEffect(() => {
    setSwipeHandler((dir) => {
      const next = ids[idx + dir];
      if (idx >= 0 && next) go(threadHash(route, next));
    });
    return () => setSwipeHandler(null);
  });
  useEffect(() => (scroller.current ? bindSwipe(scroller.current) : undefined), [!!scroller.current, o?.id]);
  if (o && enter.current.id !== o.id) {
    const d = takeSwipeDir();
    enter.current = { id: o.id, cls: d ? (d > 0 ? 'enter-next' : 'enter-prev') : '' };
  }
  if (!o || !route.thread) {
    return (
      <section class="readcol" aria-label={t('read.label')}>
        <div class="empty" style={{ margin: 'auto' }}>
          <Icon name="mail" size={34} style={{ strokeWidth: '1.4', color: 'var(--c-inbox)' }} />
          <span>{t('read.empty')}</span>
        </div>
      </section>
    );
  }
  const id = [o.id];
  const inInbox = o.labelIds.includes('INBOX');
  const inSpam = o.labelIds.includes('SPAM');
  const inTrash = o.labelIds.includes('TRASH');
  const important = o.labelIds.includes('IMPORTANT');
  const msgs = o.messages.filter((m) => !m.labelIds.includes('DRAFT'));
  const draft = o.messages.find((m) => m.labelIds.includes('DRAFT'));
  const last = msgs[msgs.length - 1] ?? o.messages[o.messages.length - 1];
  const userLabels = s.labels.filter((l) => l.type === 'user' && o.labelIds.includes(l.id) && !pileLabelIds().includes(l.id));
  const subject = (msgs[0] ?? last)?.subject || t('list.noSubject');
  const pile = pileOf(o.labelIds);
  const note = s.notes[o.id];
  const editingNote = s.noteEditing === o.id;

  return (
    <section class="readcol" aria-label={t('read.label')}>
      <Ribbon label={t('read.label')} class="read-ribbon">
      <RibbonBar
        showBack={showBack}
        position={idx >= 0 ? t('read.position', { i: idx + 1, n: ids.length }) : ''}
        canPrev={idx > 0}
        canNext={idx >= 0 && idx < ids.length - 1}
        onPrev={() => go(threadHash(route, ids[idx - 1]))}
        onNext={() => go(threadHash(route, ids[idx + 1]))}
        items={[
          // Phones: the ribbon sits at the bottom, so replying is in thumb reach.
          ...(narrow && last && !draft
            ? [
                { id: 'reply', group: 0, prio: 9.5, w: 38, label: t(defaultReplyMode(last) === 'replyAll' ? 'act.replyAll' : 'act.reply'), icon: defaultReplyMode(last), run: () => openCompose(defaultReplyMode(last), last) },
                { id: 'forward', group: 0, prio: 2, w: 38, label: t('act.forward'), icon: 'forward' as const, run: () => openCompose('forward', last) }
              ]
            : []),
          ...(inSpam
            ? [{ id: 'notspam', group: 1, prio: 10, w: 104, label: t('act.notSpam'), icon: 'spam' as const, text: true, run: () => actions.notSpam(id) }]
            : inTrash
              ? [{ id: 'restore', group: 1, prio: 10, w: 96, label: t('act.restore'), icon: 'inbox' as const, text: true, run: () => actions.restore(id) }]
              : pile
                ? [{ id: 'done', group: 1, prio: 10, w: 38, label: t('act.asideDone'), icon: 'archive' as const, run: () => actions.unpin(id, false) }]
                : inInbox
                  ? [{ id: 'archive', group: 1, prio: 10, w: 38, label: t('act.archive'), icon: 'archive' as const, run: () => actions.archive(id) }]
                  : [{ id: 'inbox', group: 1, prio: 10, w: 38, label: t('act.moveInbox'), icon: 'inbox' as const, run: () => actions.moveToInbox(id) }]),
          ...(!inSpam ? [{ id: 'spam', group: 1, prio: 6, w: 38, label: t('act.spam'), icon: 'spam' as const, run: () => actions.spam(id) }] : []),
          ...(!inTrash ? [{ id: 'trash', group: 1, prio: 9, w: 38, label: t('act.delete'), icon: 'trash' as const, run: () => actions.trash(id) }] : []),
          ...(!inSpam && !inTrash
            ? PILES.map((p, i) =>
                pile === p
                  ? { id: `pile-${p}`, group: 2, prio: 8.5 - i * 0.2, w: 38, label: t(p === 'aside' ? 'act.unpin.aside' : 'act.unpin.action'), icon: PILE_ICON[p], pressed: true, run: () => actions.unpin(id, true) }
                  : { id: `pile-${p}`, group: 2, prio: 8.5 - i * 0.2, w: 38, label: t(p === 'aside' ? 'act.pin.aside' : 'act.pin.action'), icon: PILE_ICON[p], pressed: false, run: () => actions.pin(p, id) }
              )
            : []),
          ...(notesEnabled && !note ? [{ id: 'note', group: 2, prio: 7.5, w: 38, label: t('act.addNote'), icon: 'note' as const, run: () => setState({ noteEditing: o.id }) }] : []),
          { id: 'unread', group: 2, prio: 7, w: 38, label: t('act.markUnread'), icon: 'unread' as const, run: () => actions.read(id, false) },
          ...(config.features.tasks ? [{ id: 'tasks', group: 2, prio: 3, w: 38, label: t('act.addTask'), icon: 'tasks' as const, run: () => actions.addTask(o.id) }] : []),
          { id: 'move', group: 3, prio: 5, w: 38, label: t('act.moveTo'), icon: 'move' as const, menu: <MoveMenu s={s} ids={id} />, sub: (close) => <MoveList s={s} ids={id} onDone={close} /> },
          { id: 'labels', group: 3, prio: 4, w: 38, label: t('act.labelAs'), icon: 'label' as const, menu: <LabelMenu s={s} ids={id} current={o.labelIds} />, sub: (close) => <LabelList s={s} ids={id} current={o.labelIds} onDone={close} /> }
        ]}
        more={(close) => (
          <>
            <button class="mi" onClick={() => { actions.important(id, !important); close(); }}>
              <Icon name="important" size={16} style={{ color: 'var(--c-important)' }} />
              {important ? t('act.markNotImportant') : t('act.markImportant')}
            </button>
            <a class="mi" href="#/settings/filters" onClick={close}>
              <Icon name="filter" size={16} style={{ color: 'var(--c-sent)' }} />
              {t('act.filterLike')}
            </a>
            <hr />
            <button class="mi" onClick={() => { close(); window.print(); }}>
              <Icon name="printer" size={16} />
              {t('act.print')}
            </button>
            {last && (
              <button class="mi" onClick={() => { close(); showOriginal(last.id); }}>
                <Icon name="file" size={16} />
                {t('act.original')}
              </button>
            )}
            {!config.demo && (
              <a class="mi" href={`https://mail.google.com/mail/u/0/#all/${o.id}`} target="_blank" rel="noopener noreferrer" onClick={close}>
                <Icon name="external" size={16} />
                {t('act.newWindow')}
              </a>
            )}
          </>
        )}
      />

      </Ribbon>
      {showBack && (
        <button class="read-back" aria-label={t('act.back')} title={t('act.back')} onClick={closeThread}><Icon name="arrowLeft" /></button>
      )}

      <div class="readscroll" ref={scroller}>
        {o.loading ? (
          <div class="readinner">
            <div class="skeleton" style={{ height: '34px', width: '60%', margin: 0 }} />
            <div class="skeleton" style={{ height: '220px', margin: 0 }} />
          </div>
        ) : o.error ? (
          <div class="empty">
            <b>{t('list.loadError')}</b>
            <span>{o.error}</span>
            <button class="btn sm" onClick={() => go(listHash(route))}>{t('act.back')}</button>
          </div>
        ) : (
          <div class={`readinner ${enter.current.cls}`} key={o.id}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <h2 class="subject">{subject}</h2>
              <div class="labels-line">
                {important && <span class="tag important" style={{ background: 'var(--warn-bg)' }}>{t('list.important')}</span>}
                {inInbox && <span class="tag">{t('nav.inbox')}</span>}
                {pile && <span class="tag aside-tag"><CIcon name={PILE_ICON[pile]} size={14} />{t(pileKey(pile, 'title'))}</span>}
                {userLabels.map((l) => (
                  <span class="tag lbl removable" style={{ '--lc': labelColor(l) }}>
                    <span class="dot" />
                    <span class="ell">{labelDisplayName(l)}</span>
                    <button class="x" aria-label={t('compose.removeRecipient', { name: l.name })} onClick={() => actions.label(id, [], [l.id])}>
                      <Icon name="x" size={12} />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {notesEnabled && (note || editingNote) && (
              <StickyNote key={o.id} threadId={o.id} note={note} editing={editingNote} />
            )}

            {inSpam && (
              <div class="notice warn" role="note">
                <Icon name="spam" style={{ color: 'var(--c-spam)' }} />
                <span style={{ flex: 1 }}>{t('read.spamWarning')}</span>
                <button class="btn sm" onClick={() => actions.notSpam(id)}>{t('act.notSpam')}</button>
              </div>
            )}

            <div class="msgs">
              {msgs.map((m, i) => (
                <Message key={m.id} m={m} me={s.me} defaultOpen={i === msgs.length - 1 || m.labelIds.includes('UNREAD')} />
              ))}
            </div>

            {last?.calendar && <Invite m={last} />}

            {!draft && last && <QuickReply key={o.id} m={last} />}

            <div class="reply-row">
              {draft ? (
                <button class="btn primary" onClick={() => openDraft(o.id)}>
                  <Icon name="pencil" />
                  {t('act.editDraft')}
                </button>
              ) : (
                last && (
                  <>
                    {replyButtons(last)}
                  </>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function StickyNote({ threadId, note, editing }: { threadId: string; note?: ThreadNote; editing: boolean }) {
  const [text, setText] = useState(note?.text ?? '');
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing) return;
    setText(note?.text ?? '');
    const el = area.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text, editing]);
  const save = () => setNote(threadId, text);
  const cancel = () => setState({ noteEditing: undefined });
  const date = note ? new Date(note.updated).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: new Date(note.updated).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : '';
  return (
    <aside class={`sticky ${editing ? 'editing' : ''}`} aria-label={t('note.title')}>
      <div class="sticky-head">
        <CIcon name="note" size={18} />
        <span class="caps">{t('note.title')}</span>
        <span class="sticky-meta">{editing ? t('note.hint') : note ? t('note.updated', { date }) : ''}</span>
        {!editing && (
          <>
            <button class="ib sm" aria-label={t('note.edit')} title={t('note.edit')} onClick={() => setState({ noteEditing: threadId })}>
              <Icon name="pencil" size={16} />
            </button>
            <button class="ib sm" aria-label={t('note.delete')} title={t('note.delete')} onClick={() => setNote(threadId, '')}>
              <Icon name="trash" size={16} />
            </button>
          </>
        )}
      </div>
      {editing ? (
        <>
          <label class="sr-only" for={`note-${threadId}`}>{t('note.title')}</label>
          <textarea
            id={`note-${threadId}`}
            ref={area}
            rows={2}
            value={text}
            placeholder={t('note.placeholder')}
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                save();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cancel();
              }
            }}
          />
          <div class="sticky-actions">
            <span class="sticky-meta">{t('note.saveHint')}</span>
            <button class="btn sm" onClick={cancel}>{t('note.cancel')}</button>
            <button class="btn sm primary" onClick={save}>{t('note.save')}</button>
          </div>
        </>
      ) : (
        <button class="sticky-text" onClick={() => setState({ noteEditing: threadId })} aria-label={`${t('note.edit')}: ${note?.text ?? ''}`}>
          {note?.text}
        </button>
      )}
    </aside>
  );
}

function Message({ m, me, defaultOpen }: { m: ParsedMessage; me: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [details, setDetails] = useState(false);
  const files = m.attachments.filter((a) => !a.inline && a.mimeType !== 'text/calendar');
  const meLc = me.toLowerCase();
  const toNames = [...m.to, ...m.cc].map((a) => (a.email.toLowerCase() === meLc ? t('list.me') : displayName(a)));
  if (!open) {
    return (
      <div class="msg">
        <button class="msg-collapsed" aria-label={t('read.expand', { name: personName(m.from) })} onClick={() => setOpen(true)}>
          <Avatar a={m.from} size="sm" />
          <b style={{ fontSize: 'calc(14px * var(--ts, 1))', flex: 'none' }}>{senderName(m.from)}</b>
          <span class="ell" style={{ flex: 1, fontSize: 'calc(13px * var(--ts, 1))', color: 'var(--muted)' }}>{m.snippet}</span>
          {files.length > 0 && <Icon name="clip" size={14} style={{ color: 'var(--muted)' }} />}
          <span class="msg-time"><span class="d-long">{fullDate(m.date).split(' (')[0]}</span><span class="d-short">{listDate(m.date)}</span></span>
        </button>
      </div>
    );
  }
  return (
    <div class="msg">
      <div class="msg-full">
        <div class="msg-head">
          <Avatar a={m.from} size="lg" />
          <div class="msg-who">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
              <span class="name">{personName(m.from)}</span>
              <span class="email">{m.from.email}</span>
              {m.listUnsubscribe && (
                <button class="unsub-inline" style={{ fontSize: 'calc(12px * var(--ts, 1))', fontWeight: 500, textDecoration: 'underline', textDecorationColor: 'var(--blue)' }} onClick={() => unsubscribe(m)}>
                  {t('act.unsubscribe')}
                </button>
              )}
            </div>
            <button class="recips" aria-expanded={details} onClick={() => setDetails(!details)}>
              <span class="ell">{toNames.length ? t('read.to', { names: toNames.join(', ') }) : t('read.toMe')}</span>
              <Icon name={details ? 'chevUp' : 'chevDown'} size={14} />
            </button>
            {details && (
              <div style={{ fontSize: 'calc(12.5px * var(--ts, 1))', color: 'var(--muted)', lineHeight: 1.6, marginTop: '4px' }}>
                <div>{t('compose.from')}: {m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email}</div>
                {m.to.length > 0 && <div>{t('compose.to')}: {m.to.map((a) => a.email).join(', ')}</div>}
                {m.cc.length > 0 && <div>{t('compose.cc')}: {m.cc.map((a) => a.email).join(', ')}</div>}
                <div>{m.date.toLocaleString(locale())}</div>
              </div>
            )}
          </div>
          <span class="msg-time" title={m.date.toLocaleString(locale())}><span class="d-long">{fullDate(m.date)}</span><span class="d-short">{listDate(m.date)}</span></span>
          {(() => {
            const mode = defaultReplyMode(m);
            const label = t(mode === 'replyAll' ? 'act.replyAll' : 'act.reply');
            return (
              <button class="ib" aria-label={label} title={label} onClick={() => openCompose(mode, m)}>
                <Icon name={mode} />
              </button>
            );
          })()}
          <Menu label={t('act.more')} align="right" button={<Icon name="more" />}>
            {(close) => (
              <>
                <button class="mi" onClick={() => { close(); openCompose('reply', m); }}><Icon name="reply" size={16} />{t('act.reply')}</button>
                <button class="mi" onClick={() => { close(); openCompose('replyAll', m); }}><Icon name="replyAll" size={16} />{t('act.replyAll')}</button>
                <button class="mi" onClick={() => { close(); openCompose('forward', m); }}><Icon name="forward" size={16} />{t('act.forward')}</button>
                <hr />
                {m.listUnsubscribe && (
                  <button class="mi mi-phone" onClick={() => { close(); unsubscribe(m); }}><Icon name="logout" size={16} />{t('act.unsubscribe')}</button>
                )}
                <button class="mi" onClick={() => { close(); showOriginal(m.id); }}><Icon name="file" size={16} />{t('act.original')}</button>
              </>
            )}
          </Menu>
        </div>
        <div class="msg-body">
          <MessageBody m={m} showQuotedDefault={false} />
          {files.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '18px' }}>
              <span class="caps">{t('read.attachments', { n: files.length })}</span>
              <div class="atts">
                {files.map((a) => (
                  <div class="att-card">
                    <button style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0, textAlign: 'left' }} onClick={() => openAttachment(a, false)}>
                      <span class="filebadge" aria-hidden="true" style={{ background: `linear-gradient(140deg, rgba(255,255,255,.6), rgba(255,255,255,0) 65%), ${tint(a.mimeType)}` }}>
                        {ext(a.filename)}
                      </span>
                      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span class="ell" style={{ fontSize: 'calc(13px * var(--ts, 1))', fontWeight: 500 }}>{a.filename}</span>
                        <span style={{ fontSize: 'calc(12px * var(--ts, 1))', color: 'var(--muted)' }}>{sizeLabel(a.size)}</span>
                      </span>
                    </button>
                    <button class="ib sm" aria-label={`${t('act.download')} ${a.filename}`} title={t('act.download')} onClick={() => openAttachment(a, true)}>
                      <Icon name="download" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Invite({ m }: { m: ParsedMessage }) {
  const c = m.calendar!;
  const loc = locale();
  const start = c.start;
  return (
    <div class="invite">
      {start && (
        <div class="calbox" aria-hidden="true">
          <div class="m">{start.toLocaleDateString(loc, { month: 'short' })}</div>
          <div class="d">{start.getDate()}</div>
          <div class="w">{start.toLocaleDateString(loc, { weekday: 'short' })}</div>
        </div>
      )}
      <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <span class="caps">{t('read.invite')}</span>
        <span style={{ fontSize: 'calc(16px * var(--ts, 1))', fontWeight: 700 }}>{c.summary}</span>
        {start && (
          <span style={{ fontSize: 'calc(13px * var(--ts, 1))' }}>
            {start.toLocaleString(loc, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            {c.end ? ` – ${c.end.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' })}` : ''}
          </span>
        )}
        {c.location && <span style={{ fontSize: 'calc(13px * var(--ts, 1))', color: 'var(--muted)' }}>{c.location}</span>}
        <div style={{ paddingTop: '6px' }}>
          <a class="btn sm" href={config.links.calendar} target="_blank" rel="noopener noreferrer">
            <Icon name="calendar" size={16} style={{ color: 'var(--c-inbox)' }} />
            {t('read.openCalendar')}
          </a>
        </div>
      </div>
    </div>
  );
}


function RibbonBar({
  items,
  more,
  showBack,
  position,
  canPrev,
  canNext,
  onPrev,
  onNext
}: {
  items: BarItem[];
  more: (close: () => void) => ComponentChildren;
  showBack: boolean;
  position: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const width = useWidth(bar);
  const narrow = useNarrow();
  const fixed = 18 + 38 + 76 + (showBack && !narrow ? 52 : 0);
  const posW = position ? 72 : 0;
  const { shown, room } = fitItems(items, width - fixed);
  const showPos = !!position && room >= posW && shown.size === items.length;
  const hidden = items.filter((i) => !shown.has(i.id));

  return (
    <div class="toolbar nowrap" data-bar="thread" ref={bar}>
      {showBack && (
        <>
          <button class="ib rb-back" aria-label={t('act.back')} title={t('act.back')} onClick={closeThread}><Icon name="arrowLeft" /></button>
          <span class="sep rb-back" />
        </>
      )}
      <BarButtons items={items} shown={shown} />
      <MoreMenu hidden={hidden} more={more} />
      <span class="range">{showPos ? position : ''}</span>
      <button class="ib" aria-label={t('list.newer')} title={t('list.newer')} disabled={!canPrev} onClick={onPrev}><Icon name="chevLeft" /></button>
      <button class="ib" aria-label={t('list.older')} title={t('list.older')} disabled={!canNext} onClick={onNext}><Icon name="chevRight" /></button>
    </div>
  );
}

/** Reply, Reply all and Forward under a conversation; the default reply comes first. */
function replyButtons(last: ParsedMessage) {
  const reply = (
    <button class="btn" onClick={() => openCompose('reply', last)}><CIcon name="reply" size={18} />{t('act.reply')}</button>
  );
  const all = replyAllExtras(last).length > 0 && (
    <button class="btn" onClick={() => openCompose('replyAll', last)}><CIcon name="replyAll" size={18} />{t('act.replyAll')}</button>
  );
  return (
    <>
      {defaultReplyMode(last) === 'replyAll' ? <>{all}{reply}</> : <>{reply}{all}</>}
      <button class="btn" onClick={() => openCompose('forward', last)}><CIcon name="forward" size={18} />{t('act.forward')}</button>
    </>
  );
}

function QuickReply({ m }: { m: ParsedMessage }) {
  const [text, setText] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  };
  const target = m.replyTo[0] ?? m.from;
  const extras = defaultReplyMode(m) === 'replyAll' ? replyAllExtras(m).length : 0;
  const send = async () => {
    const v = text.trim();
    if (!v) return;
    setText('');
    requestAnimationFrame(resize);
    await quickReply(m, v);
  };
  const expand = () => {
    const v = text;
    setText('');
    expandQuickReply(m, v);
  };
  return (
    <div class="quick">
      <label for={`quick-${m.id}`} class="sr-only">{t('quick.label')}</label>
      <textarea
        id={`quick-${m.id}`}
        ref={area}
        rows={1}
        value={text}
        placeholder={extras ? t('quick.placeholderAll', { name: senderName(target), n: extras }) : t('quick.placeholder', { name: senderName(target) })}
        onInput={(e) => {
          setText((e.target as HTMLTextAreaElement).value);
          resize();
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            send();
          }
        }}
      />
      {text.trim() && (
        <button class="ib" aria-label={t('quick.expand')} title={t('quick.expand')} onClick={expand}>
          <Icon name="maximize" />
        </button>
      )}
      <button class="quick-send" aria-label={t('compose.send')} title={`${t('compose.send')} (Ctrl/⌘ + Enter)`} disabled={!text.trim()} onClick={send}>
        <Icon name="send" size={17} />
      </button>
    </div>
  );
}
