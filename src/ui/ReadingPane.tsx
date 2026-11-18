import { useState } from 'preact/hooks';
import { config } from '../config';
import { b64urlToBase64, displayName, type Attachment, type ParsedMessage } from '../gmail/mime';
import { locale, t } from '../i18n';
import { fullDate, labelColor, labelDisplayName, sizeLabel } from '../model';
import { go, listHash, threadHash, type MailRoute } from '../route';
import { actions, api, closeThread, openCompose, openDraft, senderName, toast, type AppState } from '../store';
import { Avatar, Menu, Ribbon, downloadBase64 } from './common';
import { CIcon } from './ColorIcons';
import { Icon } from './Icon';
import { LabelMenu, MoveMenu } from './Menus';
import { MessageBody } from './MessageBody';

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
  const ids = s.list.rows.map((r) => r.id);
  const idx = ids.indexOf(o.id);
  const id = [o.id];
  const inInbox = o.labelIds.includes('INBOX');
  const inSpam = o.labelIds.includes('SPAM');
  const inTrash = o.labelIds.includes('TRASH');
  const important = o.labelIds.includes('IMPORTANT');
  const msgs = o.messages.filter((m) => !m.labelIds.includes('DRAFT'));
  const draft = o.messages.find((m) => m.labelIds.includes('DRAFT'));
  const last = msgs[msgs.length - 1] ?? o.messages[o.messages.length - 1];
  const userLabels = s.labels.filter((l) => l.type === 'user' && o.labelIds.includes(l.id));
  const subject = (msgs[0] ?? last)?.subject || t('list.noSubject');

  return (
    <section class="readcol" aria-label={t('read.label')}>
      <Ribbon label={t('read.label')}>
      <div class="toolbar">
        {showBack && (
          <>
            <button class="ib" aria-label={t('act.back')} title={t('act.back')} onClick={closeThread}><Icon name="arrowLeft" /></button>
            <span class="sep" />
          </>
        )}
        {inSpam ? (
          <button class="btn sm" onClick={() => actions.notSpam(id)}>{t('act.notSpam')}</button>
        ) : inTrash ? (
          <button class="btn sm" onClick={() => actions.restore(id)}>{t('act.restore')}</button>
        ) : inInbox ? (
          <button class="ib" style={{ color: 'var(--c-sent)' }} aria-label={t('act.archive')} title={t('act.archive')} onClick={() => actions.archive(id)}><CIcon name="archive" /></button>
        ) : (
          <button class="ib" style={{ color: 'var(--c-inbox)' }} aria-label={t('act.moveInbox')} title={t('act.moveInbox')} onClick={() => actions.moveToInbox(id)}><CIcon name="inbox" /></button>
        )}
        {!inSpam && <button class="ib" style={{ color: 'var(--c-spam)' }} aria-label={t('act.spam')} title={t('act.spam')} onClick={() => actions.spam(id)}><CIcon name="spam" /></button>}
        {!inTrash && <button class="ib" style={{ color: 'var(--c-trash)' }} aria-label={t('act.delete')} title={t('act.delete')} onClick={() => actions.trash(id)}><CIcon name="trash" /></button>}
        <span class="sep" />
        <button class="ib" style={{ color: 'var(--c-inbox)' }} aria-label={t('act.markUnread')} title={t('act.markUnread')} onClick={() => actions.read(id, false)}><CIcon name="unread" /></button>
        {config.features.tasks && (
          <button class="ib" style={{ color: 'var(--c-tasks)' }} aria-label={t('act.addTask')} title={t('act.addTask')} onClick={() => actions.addTask(o.id)}><CIcon name="tasks" /></button>
        )}
        <span class="sep" />
        <MoveMenu s={s} ids={id} />
        <LabelMenu s={s} ids={id} current={o.labelIds} />
        <Menu label={t('act.more')} button={<CIcon name="more" />}>
          {(close) => (
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
        </Menu>
        {idx >= 0 && <span class="range">{t('read.position', { i: idx + 1, n: ids.length })}</span>}
        <button class="ib" aria-label={t('list.newer')} title={t('list.newer')} disabled={idx <= 0} onClick={() => go(threadHash(route, ids[idx - 1]))} style={idx < 0 ? { marginLeft: 'auto' } : undefined}>
          <Icon name="chevLeft" />
        </button>
        <button class="ib" aria-label={t('list.older')} title={t('list.older')} disabled={idx < 0 || idx >= ids.length - 1} onClick={() => go(threadHash(route, ids[idx + 1]))}>
          <Icon name="chevRight" />
        </button>
      </div>

      </Ribbon>

      <div class="readscroll">
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
          <div class="readinner">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <h2 class="subject">{subject}</h2>
              <div class="labels-line">
                {important && <span class="tag important" style={{ background: 'var(--warn-bg)' }}>{t('list.important')}</span>}
                {inInbox && <span class="tag">{t('nav.inbox')}</span>}
                {userLabels.map((l) => (
                  <span class="tag removable">
                    <span class="dot" style={{ background: labelColor(l) }} />
                    <span class="ell">{labelDisplayName(l)}</span>
                    <button class="x" aria-label={t('compose.removeRecipient', { name: l.name })} onClick={() => actions.label(id, [], [l.id])}>
                      <Icon name="x" size={12} />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {inSpam && (
              <div class="notice warn" role="note">
                <Icon name="spam" style={{ color: 'var(--c-spam)' }} />
                <span style={{ flex: 1 }}>{t('read.spamWarning')}</span>
                <button class="btn sm" onClick={() => actions.notSpam(id)}>{t('act.notSpam')}</button>
              </div>
            )}

            <div class="msgs">
              {msgs.map((m, i) => (
                <Message key={m.id} m={m} me={s.me} defaultOpen={i === msgs.length - 1 || m.labelIds.includes('UNREAD')} last={i === msgs.length - 1} />
              ))}
            </div>

            {last?.calendar && <Invite m={last} />}

            <div class="reply-row">
              {draft ? (
                <button class="btn primary" onClick={() => openDraft(o.id)}>
                  <Icon name="pencil" />
                  {t('act.editDraft')}
                </button>
              ) : (
                last && (
                  <>
                    <button class="btn" onClick={() => openCompose('reply', last)}><CIcon name="reply" size={18} />{t('act.reply')}</button>
                    {last.to.length + last.cc.length > 1 && (
                      <button class="btn" onClick={() => openCompose('replyAll', last)}><Icon name="replyAll" style={{ color: 'var(--c-snooze)' }} />{t('act.replyAll')}</button>
                    )}
                    <button class="btn" onClick={() => openCompose('forward', last)}><Icon name="forward" style={{ color: 'var(--c-sent)' }} />{t('act.forward')}</button>
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

function Message({ m, me, defaultOpen, last }: { m: ParsedMessage; me: string; defaultOpen: boolean; last: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [details, setDetails] = useState(false);
  const files = m.attachments.filter((a) => !a.inline && a.mimeType !== 'text/calendar');
  const meLc = me.toLowerCase();
  const toNames = [...m.to, ...m.cc].map((a) => (a.email.toLowerCase() === meLc ? t('list.me') : displayName(a)));
  if (!open) {
    return (
      <div class="msg">
        <button class="msg-collapsed" aria-label={t('read.expand', { name: displayName(m.from) })} onClick={() => setOpen(true)}>
          <Avatar a={m.from} size="sm" />
          <b style={{ fontSize: '14px', flex: 'none' }}>{senderName(m.from)}</b>
          <span class="ell" style={{ flex: 1, fontSize: '13px', color: 'var(--muted)' }}>{m.snippet}</span>
          {files.length > 0 && <Icon name="clip" size={14} style={{ color: 'var(--muted)' }} />}
          <span class="msg-time">{fullDate(m.date).split(' (')[0]}</span>
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
              <span class="name">{displayName(m.from)}</span>
              <span class="email">{m.from.email}</span>
              {m.listUnsubscribe && (
                <button style={{ fontSize: '12px', fontWeight: 500, textDecoration: 'underline', textDecorationColor: 'var(--blue)' }} onClick={() => unsubscribe(m)}>
                  {t('act.unsubscribe')}
                </button>
              )}
            </div>
            <button class="recips" aria-expanded={details} onClick={() => setDetails(!details)}>
              <span class="ell">{toNames.length ? t('read.to', { names: toNames.join(', ') }) : t('read.toMe')}</span>
              <Icon name={details ? 'chevUp' : 'chevDown'} size={14} />
            </button>
            {details && (
              <div style={{ fontSize: '12.5px', color: 'var(--muted)', lineHeight: 1.6, marginTop: '4px' }}>
                <div>{t('compose.from')}: {m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email}</div>
                {m.to.length > 0 && <div>{t('compose.to')}: {m.to.map((a) => a.email).join(', ')}</div>}
                {m.cc.length > 0 && <div>{t('compose.cc')}: {m.cc.map((a) => a.email).join(', ')}</div>}
                <div>{m.date.toLocaleString(locale())}</div>
              </div>
            )}
          </div>
          <span class="msg-time">{fullDate(m.date)}</span>
          <button class="ib" aria-label={t('act.reply')} title={t('act.reply')} onClick={() => openCompose('reply', m)}>
            <Icon name="reply" />
          </button>
          <Menu label={t('act.more')} align="right" button={<Icon name="more" />}>
            {(close) => (
              <>
                <button class="mi" onClick={() => { close(); openCompose('reply', m); }}><Icon name="reply" size={16} />{t('act.reply')}</button>
                <button class="mi" onClick={() => { close(); openCompose('replyAll', m); }}><Icon name="replyAll" size={16} />{t('act.replyAll')}</button>
                <button class="mi" onClick={() => { close(); openCompose('forward', m); }}><Icon name="forward" size={16} />{t('act.forward')}</button>
                <hr />
                <button class="mi" onClick={() => { close(); showOriginal(m.id); }}><Icon name="file" size={16} />{t('act.original')}</button>
              </>
            )}
          </Menu>
        </div>
        <div class="msg-body">
          <MessageBody m={m} showQuotedDefault={!last} />
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
                        <span class="ell" style={{ fontSize: '13px', fontWeight: 500 }}>{a.filename}</span>
                        <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{sizeLabel(a.size)}</span>
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
        <span style={{ fontSize: '16px', fontWeight: 700 }}>{c.summary}</span>
        {start && (
          <span style={{ fontSize: '13px' }}>
            {start.toLocaleString(loc, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            {c.end ? ` – ${c.end.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' })}` : ''}
          </span>
        )}
        {c.location && <span style={{ fontSize: '13px', color: 'var(--muted)' }}>{c.location}</span>}
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

