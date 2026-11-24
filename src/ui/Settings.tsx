import DOMPurify from 'dompurify';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { aiGenerate, aiRemoveKey, aiSetKey, aiStatus, AiError, type AiStatus } from '../ai';
import { hasServerSession, sessionCall, setServerReady, staySignedIn, type SessionReply } from '../auth';
import { changeLanguage, onSyncStatus, pull, syncEnabled, syncStatus } from '../sync';
import { config } from '../config';
import type { GFilter, GSendAs, GVacation } from '../gmail/types';
import { t, type StringKey, locale } from '../i18n';
import { labelColor, sizeLabel } from '../model';
import { THEMES, currentTheme } from '../theme';
import { CHIMES, playChime } from '../chime';
import { askPermission, permission, sendTest } from '../notify';
import { disablePush, enablePush, pushStatus, pushSupported, testPush, type PushStatus } from '../push';
import { getPrefs, setNotifyPrefs, setPrefs, TEXT_SCALES, type NotifyPrefs } from '../prefs';
import { installState, isStandalone, onInstallChange, promptInstall } from '../pwa';
import { SETTINGS_SECTIONS, type SettingsSection } from '../route';
import { api, applyUpdateCheck, loadLabels, setState, toast, type AppState } from '../store';
import { callUpdater, checkForUpdate, type UpdateCheck, type UpdaterStatus } from '../updates';
import { AppIcon, AppName, Logo, Seg, Switch, isSvgUrl } from './common';
import { Icon } from './Icon';
import { SignatureEditor } from './SignatureEditor';
import { KeyList } from './Keys';

declare const __APP_VERSION__: string;

const ICONS: Record<SettingsSection, [string, string]> = {
  general: ['gear', 'var(--c-scheduled)'],
  appearance: ['sun', 'var(--c-important)'],
  notifications: ['bell', 'var(--c-snooze)'],
  app: ['device', 'var(--c-inbox)'],
  labels: ['tag', 'var(--c-drafts)'],
  filters: ['filter', 'var(--c-sent)'],
  accounts: ['user', 'var(--c-snooze)'],
  vacation: ['sun', 'var(--c-important)'],
  forwarding: ['forward', 'var(--c-tasks)'],
  shortcuts: ['keyboard', 'var(--c-trash)'],
  updates: ['download', 'var(--c-inbox)'],
  ai: ['bulb', 'var(--c-snooze)'],
  about: ['info', 'var(--c-all)']
};

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export function Settings({ s, section }: { s: AppState; section: SettingsSection }) {
  return (
    <div class="settings">
      <div class="settings-inner">
        <nav class="snav" aria-label={t('settings.title')}>
          <a class="nav" href="#/inbox">
            <Icon name="arrowLeft" />
            <span class="nav-t">{t('settings.back')}</span>
          </a>
          {SETTINGS_SECTIONS.filter((id) => id !== 'ai' || config.features.ai).map((id) => (
            <a class={`nav ${id === section ? 'on' : ''}`} href={`#/settings/${id}`} aria-current={id === section ? 'page' : undefined}>
              <Icon name={ICONS[id][0]} style={{ color: ICONS[id][1] }} />
              <span class="nav-t">{t(`settings.${id}` as StringKey)}</span>
            </a>
          ))}
        </nav>
        <main class="scontent">
          {section === 'general' && <General />}
          {section === 'appearance' && <Appearance />}
          {section === 'notifications' && <NotificationSettings s={s} />}
          {section === 'notifications' && <PushSettings />}
          {section === 'app' && <InstallApp />}
          {section === 'labels' && <Labels s={s} />}
          {section === 'filters' && <Filters s={s} />}
          {section === 'accounts' && (
            <>
              <StaySignedIn />
              <Accounts />
            </>
          )}
          {section === 'vacation' && <Vacation />}
          {section === 'forwarding' && <Forwarding />}
          {section === 'shortcuts' && (
            <Section title={t('settings.shortcuts')}>
              <div style={{ padding: '0 24px 20px' }}><KeyList /></div>
            </Section>
          )}
          {section === 'updates' && <Updates />}
          {section === 'ai' && <AiSettings />}
          {section === 'about' && (
            <Section title={t('settings.about')} note={t('settings.syncNote')}>
              <div class="srow"><div class="slbl"><b>{config.appName}</b><span>{t('settings.version', { v: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '' })}</span></div></div>
              <div class="srow"><div class="slbl"><b>{t('settings.account', { email: s.me })}</b></div></div>
            </Section>
          )}
        </main>
      </div>
    </div>
  );
}

function Section({ title, note, actions, children }: { title: string; note?: string; actions?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class="glass section">
      <div class="section-head">
        <div style={{ flex: '1 1 280px' }}>
          <h2>{title}</h2>
          {note && <p>{note}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Row({ title, help, children }: { title: string; help?: string; children: ComponentChildren }) {
  return (
    <div class="srow">
      <div class="slbl"><b>{title}</b>{help && <span>{help}</span>}</div>
      {children}
    </div>
  );
}

function SyncRow() {
  const [, force] = useState(0);
  useEffect(() => onSyncStatus(() => force((n) => n + 1)), []);
  const st = syncStatus();
  const text =
    st.state === 'saving' ? t('sync.saving') : st.state === 'error' ? t('sync.error') : st.at ? t('sync.saved', { time: new Date(st.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }) : t('sync.waiting');
  return (
    <Row title={t('sync.title')} help={t('sync.help')}>
      <span style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <span role="status" style={{ fontSize: 'calc(13px * var(--ts, 1))', color: st.state === 'error' ? 'var(--danger, #c0392b)' : 'var(--muted)' }}>{text}</span>
        <button class="btn sm" onClick={() => pull(true)}>{t('sync.now')}</button>
      </span>
    </Row>
  );
}

function General() {
  const p = getPrefs();
  const stored = localStorage.getItem('maillo.lang');
  return (
    <Section title={t('settings.general')} note={syncEnabled() ? t('sync.note') : t('settings.syncNote')}>
      {syncEnabled() && <SyncRow />}
      <Row title={t('settings.density')} help={t('settings.densityHelp')}>
        <Seg label={t('settings.density')} value={p.density} onChange={(v) => setPrefs({ density: v })} options={[{ value: 'comfortable', label: t('settings.comfortable') }, { value: 'compact', label: t('settings.compact') }]} />
      </Row>
      <Row title={t('settings.pane')} help={t('settings.paneHelp')}>
        <Seg label={t('settings.pane')} value={p.pane} onChange={(v) => setPrefs({ pane: v })} options={[{ value: 'right', label: t('settings.paneRight') }, { value: 'off', label: t('settings.paneOff') }]} />
      </Row>
      <Row title={t('cat.label')}>
        <Switch label={t('cat.label')} on={p.tabs} onChange={(v) => { setPrefs({ tabs: v }); setState({ catNew: {} }); }} />
      </Row>
      <Row title={t('settings.undo')} help={t('settings.undoHelp')}>
        <Seg label={t('settings.undo')} value={p.undoSeconds} onChange={(v) => setPrefs({ undoSeconds: v })} options={[0, 5, 10, 20, 30].map((n) => ({ value: n, label: n ? `${n}s` : t('settings.off') }))} />
      </Row>
      <Row title={t('settings.replyDefault')} help={t('settings.replyDefaultHelp')}>
        <Seg label={t('settings.replyDefault')} value={p.replyDefault} onChange={(v) => setPrefs({ replyDefault: v })} options={[{ value: 'reply', label: t('settings.replySender') }, { value: 'replyAll', label: t('settings.replyAllDefault') }]} />
      </Row>
      <Row title={t('settings.images')} help={t('settings.imagesHelp')}>
        <Seg label={t('settings.images')} value={p.images} onChange={(v) => setPrefs({ images: v })} options={[{ value: 'ask', label: t('settings.imagesAsk') }, { value: 'always', label: t('settings.imagesAlways') }]} />
      </Row>
      <Row title={t('settings.pageSize')}>
        <Seg label={t('settings.pageSize')} value={p.pageSize} onChange={(v) => setPrefs({ pageSize: v })} options={[25, 50, 100].map((n) => ({ value: n, label: String(n) }))} />
      </Row>
      <Row title={t('settings.shortcutsToggle')} help={t('settings.shortcutsHelp')}>
        <Switch label={t('settings.shortcutsToggle')} on={p.shortcuts} onChange={(v) => setPrefs({ shortcuts: v })} />
      </Row>
      <Row title={t('settings.language')}>
        <Seg
          label={t('settings.language')}
          value={stored === 'en' || stored === 'fr' ? stored : 'auto'}
          onChange={(v) => changeLanguage(v as 'en' | 'fr' | 'auto')}
          options={[{ value: 'auto', label: t('settings.languageAuto') }, { value: 'en', label: 'English' }, { value: 'fr', label: 'Français' }]}
        />
      </Row>
    </Section>
  );
}

function Labels({ s }: { s: AppState }) {
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const labels = s.labels.filter((l) => l.type === 'user').sort((a, b) => a.name.localeCompare(b.name));
  const create = async (e: Event) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.createLabel(name.trim());
      setName('');
      await loadLabels();
      toast(t('toast.saved'));
    } catch (er) {
      toast(t('toast.error', { msg: errMsg(er) }));
    }
  };
  return (
    <Section title={t('settings.labels')}>
      <form class="frow" onSubmit={create}>
        <label class="sr-only" for="new-label">{t('settings.labelName')}</label>
        <input id="new-label" class="input" style={{ flex: '1 1 240px' }} placeholder={t('settings.newLabel')} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        <button class="btn primary sm" type="submit"><Icon name="plus" size={16} />{t('settings.create')}</button>
      </form>
      {!labels.length && <div class="frow" style={{ color: 'var(--muted)' }}>{t('settings.noLabels')}</div>}
      {labels.map((l) => (
        <div class="frow">
          <span aria-hidden="true" style={{ width: '10px', height: '10px', borderRadius: '3px', background: labelColor(l) }} />
          {editing === l.id ? (
            <form
              style={{ display: 'flex', gap: '8px', flex: 1, flexWrap: 'wrap' }}
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api.updateLabel(l.id, { name: draft.trim() });
                  setEditing(null);
                  loadLabels();
                } catch (er) {
                  toast(t('toast.error', { msg: errMsg(er) }));
                }
              }}
            >
              <input class="input" style={{ flex: 1 }} aria-label={t('settings.labelName')} value={draft} onInput={(e) => setDraft((e.target as HTMLInputElement).value)} autoFocus />
              <button class="btn sm primary" type="submit">{t('settings.save')}</button>
              <button class="btn sm" type="button" onClick={() => setEditing(null)}>{t('settings.cancel')}</button>
            </form>
          ) : (
            <>
              <span style={{ flex: 1, fontSize: 'calc(14px * var(--ts, 1))' }}>{l.name}</span>
              <span style={{ fontSize: 'calc(12px * var(--ts, 1))', color: 'var(--muted)' }}>{s.counts[l.id] ? `${s.counts[l.id]} ●` : ''}</span>
              <button class="btn sm" onClick={() => { setEditing(l.id); setDraft(l.name); }}>{t('settings.rename')}</button>
              <button
                class="btn sm danger"
                onClick={async () => {
                  if (!confirm(t('settings.confirmDeleteLabel', { name: l.name }))) return;
                  try {
                    await api.deleteLabel(l.id);
                    loadLabels();
                  } catch (er) {
                    toast(t('toast.error', { msg: errMsg(er) }));
                  }
                }}
              >
                {t('settings.delete')}
              </button>
            </>
          )}
        </div>
      ))}
    </Section>
  );
}

function describeFilter(f: GFilter, s: AppState) {
  const name = (id: string) => s.labels.find((l) => l.id === id)?.name ?? id;
  const c = f.criteria;
  const when = [
    c.from && `from:(${c.from})`,
    c.to && `to:(${c.to})`,
    c.subject && `subject:(${c.subject})`,
    c.query,
    c.negatedQuery && `-{${c.negatedQuery}}`,
    c.hasAttachment && 'has:attachment',
    c.size && `${c.sizeComparison ?? 'larger'}:${c.size}`
  ].filter(Boolean).join(' ');
  const a = f.action;
  const then: string[] = [];
  const add = a.addLabelIds ?? [];
  const rem = a.removeLabelIds ?? [];
  if (rem.includes('INBOX')) then.push(t('settings.aSkipInbox'));
  if (rem.includes('UNREAD')) then.push(t('settings.aMarkRead'));
  if (rem.includes('SPAM')) then.push(t('settings.aNeverSpam'));
  if (add.includes('STARRED')) then.push(t('settings.aStar'));
  if (add.includes('TRASH')) then.push(t('settings.aTrash'));
  if (add.includes('IMPORTANT')) then.push(t('settings.aImportant'));
  add.filter((x) => !['STARRED', 'TRASH', 'IMPORTANT'].includes(x)).forEach((x) => then.push(`${t('settings.aLabel')} ${name(x)}`));
  if (a.forward) then.push(`${t('settings.aForward')} ${a.forward}`);
  return { when, then: then.join(' · ') };
}

function Filters({ s }: { s: AppState }) {
  const [list, setList] = useState<GFilter[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const empty = { from: '', to: '', subject: '', query: '', hasAttachment: false, skip: false, read: false, star: false, label: '', trash: false, never: false, important: false };
  const [f, setF] = useState(empty);
  const load = () => api.listFilters().then(setList).catch((e) => setError(errMsg(e)));
  useEffect(() => {
    load();
  }, []);
  const save = async (e: Event) => {
    e.preventDefault();
    const add: string[] = [];
    const remove: string[] = [];
    if (f.skip) remove.push('INBOX');
    if (f.read) remove.push('UNREAD');
    if (f.never) remove.push('SPAM');
    if (f.star) add.push('STARRED');
    if (f.trash) add.push('TRASH');
    if (f.important) add.push('IMPORTANT');
    if (f.label) add.push(f.label);
    try {
      await api.createFilter({
        criteria: { from: f.from || undefined, to: f.to || undefined, subject: f.subject || undefined, query: f.query || undefined, hasAttachment: f.hasAttachment || undefined },
        action: { addLabelIds: add.length ? add : undefined, removeLabelIds: remove.length ? remove : undefined }
      });
      setF(empty);
      setOpen(false);
      load();
      toast(t('toast.saved'));
    } catch (er) {
      toast(t('toast.error', { msg: errMsg(er) }));
    }
  };
  const set = (k: keyof typeof empty) => (e: Event) => {
    const el = e.target as HTMLInputElement;
    setF({ ...f, [k]: el.type === 'checkbox' ? el.checked : el.value });
  };
  return (
    <Section
      title={t('settings.filters')}
      actions={<button class="btn primary sm" onClick={() => setOpen(!open)} aria-expanded={open}><Icon name="plus" size={16} />{t('settings.newFilter')}</button>}
    >
      {open && (
        <form onSubmit={save}>
          <div class="formgrid">
            <label>{t('settings.fFrom')}<input class="input" value={f.from} onInput={set('from')} /></label>
            <label>{t('settings.fTo')}<input class="input" value={f.to} onInput={set('to')} /></label>
            <label>{t('settings.fSubject')}<input class="input" value={f.subject} onInput={set('subject')} /></label>
            <label>{t('settings.fHas')}<input class="input" value={f.query} onInput={set('query')} /></label>
            <label class="checkline"><input type="checkbox" checked={f.hasAttachment} onChange={set('hasAttachment')} />{t('settings.fHasAttachment')}</label>
          </div>
          <div class="formgrid">
            <label class="checkline"><input type="checkbox" checked={f.skip} onChange={set('skip')} />{t('settings.aSkipInbox')}</label>
            <label class="checkline"><input type="checkbox" checked={f.read} onChange={set('read')} />{t('settings.aMarkRead')}</label>
            <label class="checkline"><input type="checkbox" checked={f.star} onChange={set('star')} />{t('settings.aStar')}</label>
            <label class="checkline"><input type="checkbox" checked={f.important} onChange={set('important')} />{t('settings.aImportant')}</label>
            <label class="checkline"><input type="checkbox" checked={f.never} onChange={set('never')} />{t('settings.aNeverSpam')}</label>
            <label class="checkline"><input type="checkbox" checked={f.trash} onChange={set('trash')} />{t('settings.aTrash')}</label>
            <label>
              {t('settings.aLabel')}
              <select class="select" value={f.label} onChange={set('label')}>
                <option value="">{t('settings.chooseLabel')}</option>
                {s.labels.filter((l) => l.type === 'user').map((l) => <option value={l.id}>{l.name}</option>)}
              </select>
            </label>
          </div>
          <div class="frow">
            <button class="btn primary sm" type="submit">{t('settings.create')}</button>
            <button class="btn sm" type="button" onClick={() => setOpen(false)}>{t('settings.cancel')}</button>
          </div>
        </form>
      )}
      {error && <div class="frow err">{t('settings.loadError')} {error}</div>}
      {list === null && !error && <div class="skeleton" />}
      {list?.length === 0 && <div class="frow" style={{ color: 'var(--muted)' }}>{t('settings.noFilters')}</div>}
      {list?.map((x) => {
        const d = describeFilter(x, s);
        return (
          <div class="frow">
            <span class="caps" style={{ width: '48px' }}>{t('settings.when')}</span>
            <span class="token">{d.when || '*'}</span>
            <span class="caps">{t('settings.then')}</span>
            <span style={{ fontSize: 'calc(13px * var(--ts, 1))', flex: '1 1 200px' }}>{d.then}</span>
            <button
              class="btn sm danger"
              onClick={async () => {
                if (!x.id || !confirm(t('settings.confirmDeleteFilter'))) return;
                try {
                  await api.deleteFilter(x.id);
                  load();
                } catch (er) {
                  toast(t('toast.error', { msg: errMsg(er) }));
                }
              }}
            >
              {t('settings.delete')}
            </button>
          </div>
        );
      })}
    </Section>
  );
}

function signInError(code?: string): string {
  const key = `stay.err.${code}` as StringKey;
  const known = t(key);
  return known === key ? t('ai.err.generic', { code: code ?? 'unknown' }) : known;
}

function StaySignedIn() {
  const [status, setStatus] = useState<SessionReply | null>(null);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => {
    if (!staySignedIn()) return;
    sessionCall({ action: 'secret_status' }, true).then(setStatus);
  };
  useEffect(load, []);
  if (config.demo) return null;
  const run = async (fields: Record<string, string>) => {
    setBusy(true);
    setError('');
    const r = await sessionCall(fields, true);
    setBusy(false);
    if (!r.ok) return setError(signInError(r.error));
    setSecret('');
    setStatus(r);
    setServerReady(!!r.configured);
  };
  const configured = !!status?.ok && status.configured;
  return (
    <Section title={t('stay.title')} note={t('stay.help')}>
      {!staySignedIn() && <div class="frow" style={{ color: 'var(--muted)' }}>{t('stay.off')}</div>}
      {staySignedIn() && status === null && <div class="frow" style={{ color: 'var(--muted)' }}>{t('upd.checking')}</div>}
      {status && !status.ok && <div class="frow err">{signInError(status.error)}</div>}
      {status?.ok && (
        <>
          <Row title={t('stay.device')} help={hasServerSession() ? t('stay.deviceOn') : configured ? t('stay.deviceOff') : t('stay.deviceNeedsSecret')}>
            <span class="tag" style={{ fontSize: 'calc(13px * var(--ts, 1))', height: '26px' }}>{hasServerSession() ? t('stay.on') : t('stay.hourly')}</span>
          </Row>
          {(status.source === 'environment' || status.source === 'config') && (
            <div class="frow" style={{ fontSize: 'calc(13px * var(--ts, 1))', color: 'var(--muted)' }}>{t('stay.secretFixed')}</div>
          )}
          {status.source !== 'environment' && status.source !== 'config' && (
            <div class="srow">
              <div class="slbl">
                <b><label for="oauth-secret">{configured ? t('stay.replace') : t('stay.add')}</label></b>
                <span>{t('stay.where')}</span>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input id="oauth-secret" class="input" type="password" autoComplete="off" spellcheck={false} style={{ flex: '1 1 240px' }} value={secret} disabled={busy} onInput={(e) => setSecret((e.target as HTMLInputElement).value)} />
                <button class="btn primary sm" disabled={!secret.trim() || busy} onClick={() => run({ action: 'set_secret', secret: secret.trim() })}>{t('ai.save')}</button>
                {configured && <button class="btn sm danger" disabled={busy} onClick={() => confirm(t('stay.removeConfirm')) && run({ action: 'remove_secret' })}>{t('ai.remove')}</button>}
              </div>
            </div>
          )}
          {configured && !hasServerSession() && (
            <div class="frow" style={{ fontSize: 'calc(13px * var(--ts, 1))', color: 'var(--muted)' }}>{t('stay.signInAgain')}</div>
          )}
        </>
      )}
      {error && <div class="frow err" role="alert">{error}</div>}
    </Section>
  );
}

function Accounts() {
  const [list, setList] = useState<GSendAs[] | null>(null);
  const [error, setError] = useState('');
  const [sigs, setSigs] = useState<Record<string, string>>({});
  const [dash, setDash] = useState(getPrefs().signatureDash);
  useEffect(() => {
    api.listSendAs().then((l) => {
      setList(l);
      setSigs(Object.fromEntries(l.map((x) => [x.sendAsEmail, x.signature ?? ''])));
    }).catch((e) => setError(errMsg(e)));
  }, []);
  return (
    <Section title={t('settings.accounts')} note={t('settings.signatureHelp')}>
      {error && <div class="frow err">{t('settings.loadError')} {error}</div>}
      <Row title={t('settings.signatureDash')} help={t('settings.signatureDashHelp')}>
        <Switch label={t('settings.signatureDash')} on={dash} onChange={(v) => { setPrefs({ signatureDash: v }); setDash(v); }} />
      </Row>
      {list === null && !error && <div class="skeleton" />}
      {list?.map((x) => (
        <div class="srow" style={{ alignItems: 'flex-start' }}>
          <div class="slbl">
            <b>{x.displayName ? `${x.displayName} <${x.sendAsEmail}>` : x.sendAsEmail}</b>
            <span>{x.isDefault ? t('settings.default') : t('settings.sendAs')}</span>
          </div>
          <div style={{ flex: '2 1 360px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span class="caps" aria-hidden="true">{t('settings.signature')}</span>
            <SignatureEditor
              id={`sig-${x.sendAsEmail}`}
              label={`${t('settings.signature')}: ${x.sendAsEmail}`}
              value={sigs[x.sendAsEmail] ?? ''}
              onChange={(html) => setSigs((prev) => ({ ...prev, [x.sendAsEmail]: html }))}
            />
            <button
              class="btn sm primary"
              style={{ alignSelf: 'flex-start' }}
              onClick={async () => {
                try {
                  await api.updateSendAs(x.sendAsEmail, { signature: DOMPurify.sanitize(sigs[x.sendAsEmail] ?? '') });
                  const sendAs = await api.listSendAs();
                  setState({ sendAs });
                  toast(t('toast.saved'));
                } catch (er) {
                  toast(t('toast.error', { msg: errMsg(er) }));
                }
              }}
            >
              {t('settings.save')}
            </button>
          </div>
        </div>
      ))}
    </Section>
  );
}

function toDateInput(ms?: string) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fromDateInput(v: string, end = false) {
  if (!v) return undefined;
  const [y, m, d] = v.split('-').map(Number);
  const date = end ? new Date(y, m - 1, d, 23, 59, 59) : new Date(y, m - 1, d, 0, 0, 0);
  return String(date.getTime());
}

function Vacation() {
  const [v, setV] = useState<GVacation | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.getVacation().then(setV).catch((e) => setError(errMsg(e)));
  }, []);
  const save = async () => {
    if (!v) return;
    try {
      const next = await api.setVacation(v);
      setV(next);
      toast(t('toast.saved'));
    } catch (er) {
      toast(t('toast.error', { msg: errMsg(er) }));
    }
  };
  return (
    <Section title={t('settings.vacation')} note={t('settings.vacationHelp')} actions={v && <Switch label={t('settings.vacationOn')} on={v.enableAutoReply} onChange={(on) => setV({ ...v, enableAutoReply: on })} />}>
      {error && <div class="frow err">{t('settings.loadError')} {error}</div>}
      {!v && !error && <div class="skeleton" />}
      {v && (
        <>
          <div class="formgrid">
            <label>{t('settings.firstDay')}<input class="input" type="date" value={toDateInput(v.startTime)} onInput={(e) => setV({ ...v, startTime: fromDateInput((e.target as HTMLInputElement).value) })} /></label>
            <label>{t('settings.lastDay')}<input class="input" type="date" value={toDateInput(v.endTime)} onInput={(e) => setV({ ...v, endTime: fromDateInput((e.target as HTMLInputElement).value, true) })} /></label>
            <label style={{ gridColumn: '1 / -1' }}>{t('settings.vSubject')}<input class="input" value={v.responseSubject ?? ''} onInput={(e) => setV({ ...v, responseSubject: (e.target as HTMLInputElement).value })} /></label>
            <label style={{ gridColumn: '1 / -1' }}>
              {t('settings.vMessage')}
              <textarea class="textarea" value={v.responseBodyPlainText ?? ''} onInput={(e) => setV({ ...v, responseBodyPlainText: (e.target as HTMLTextAreaElement).value, responseBodyHtml: undefined })} />
            </label>
            <label class="checkline"><input type="checkbox" checked={!!v.restrictToContacts} onChange={(e) => setV({ ...v, restrictToContacts: (e.target as HTMLInputElement).checked })} />{t('settings.contactsOnly')}</label>
            <label class="checkline"><input type="checkbox" checked={!!v.restrictToDomain} onChange={(e) => setV({ ...v, restrictToDomain: (e.target as HTMLInputElement).checked })} />{t('settings.domainOnly')}</label>
          </div>
          <div class="frow"><button class="btn primary sm" onClick={save}>{t('settings.save')}</button></div>
        </>
      )}
    </Section>
  );
}

function Forwarding() {
  const [data, setData] = useState<{ imap?: boolean; pop?: string; fwd?: { enabled?: boolean; emailAddress?: string } } | null>(null);
  useEffect(() => {
    Promise.all([api.getImap().catch(() => ({})), api.getPop().catch(() => ({})), api.getAutoForwarding().catch(() => ({}))]).then(([i, p, f]) =>
      setData({ imap: (i as { enabled?: boolean }).enabled, pop: (p as { accessWindow?: string }).accessWindow, fwd: f as { enabled?: boolean; emailAddress?: string } })
    );
  }, []);
  const status = (on?: boolean) => (
    <span class="tag" style={{ background: on ? 'color-mix(in srgb, #57997f 28%, var(--surface))' : 'var(--cloud)' }}>{on ? t('settings.enabled') : t('settings.disabled')}</span>
  );
  return (
    <Section
      title={t('settings.forwarding')}
      note={t('settings.manageInGmail')}
      actions={<a class="btn sm" href={config.links.gmailSettings} target="_blank" rel="noopener noreferrer"><Icon name="external" size={16} />{t('settings.openGmailSettings')}</a>}
    >
      {!data && <div class="skeleton" />}
      {data && (
        <>
          <Row title={t('settings.autoForward')} help={data.fwd?.emailAddress}>{status(data.fwd?.enabled)}</Row>
          <Row title={t('settings.imap')}>{status(data.imap)}</Row>
          <Row title={t('settings.pop')}>{status(!!data.pop && data.pop !== 'disabled')}</Row>
        </>
      )}
    </Section>
  );
}

function latestHelp(c: UpdateCheck): string {
  if (c.error === 'check_failed' && !c.latest) return t('upd.checkFailed');
  if (!c.latest) return '';
  if (!c.available) return t('upd.upToDate', { v: c.latest });
  return c.canInstall ? t('upd.available', { v: c.latest }) : t('upd.availableManual', { v: c.latest });
}

function updateError(r: UpdaterStatus): string {
  const key = `upd.err.${r.error}` as StringKey;
  const known = t(key);
  return known === key ? t('upd.err.generic', { code: r.error ?? 'unknown' }) : t(key, { path: r.path ?? '' });
}

function aiError(code?: string): string {
  const key = `ai.err.${code}` as StringKey;
  const known = t(key);
  return known === key ? t('ai.err.generic', { code: code ?? 'unknown' }) : known;
}

function AiSettings() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [test, setTest] = useState('');

  const load = () => {
    if (config.demo || !config.features.ai) return;
    aiStatus().then(setStatus).catch((e) => setStatus({ ok: false, error: e instanceof AiError ? e.message : 'unavailable' }));
  };
  useEffect(load, []);

  const run = async (fn: () => Promise<AiStatus>) => {
    setBusy(true);
    setError('');
    setTest('');
    try {
      const r = await fn();
      if (!r.ok) setError(aiError(r.error));
      else {
        setKey('');
        load();
      }
    } catch (e) {
      setError(aiError(e instanceof Error ? e.message : 'network'));
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setBusy(true);
    setError('');
    setTest('');
    try {
      const reply = await aiGenerate('Reply with the single word OK.', 'ping');
      setTest(t('ai.testOk', { reply: reply.trim().slice(0, 40) }));
      load();
    } catch (e) {
      setError(aiError(e instanceof Error ? e.message : 'network'));
    } finally {
      setBusy(false);
    }
  };

  const configured = !!status?.ok && status.configured;
  return (
    <Section title={t('settings.ai')} note={t('ai.help')}>
      {!config.features.ai && <div class="frow" style={{ color: 'var(--muted)' }}>{t('ai.off')}</div>}
      {config.demo && <div class="frow" style={{ color: 'var(--muted)' }}>{t('ai.demo')}</div>}
      {!config.demo && config.features.ai && status === null && <div class="frow" style={{ color: 'var(--muted)' }}>{t('upd.checking')}</div>}
      {status && !status.ok && <div class="frow err">{aiError(status.error)}</div>}
      {status?.ok && (
        <>
          <Row title={t('ai.key')} help={configured ? (status.source === 'environment' ? t('ai.keyEnv') : status.source === 'config' ? t('ai.keyConfig') : t('ai.keyStored')) : t('ai.keyMissing')}>
            <span class="tag" style={{ fontSize: 'calc(13px * var(--ts, 1))', height: '26px' }}>{configured ? t('ai.keySet') : t('ai.keyNotSet')}</span>
          </Row>
          <Row title={t('ai.model')} help={t('ai.modelHelp')}>
            <span class="tag" style={{ fontSize: 'calc(13px * var(--ts, 1))', height: '26px' }}>{status.model}</span>
          </Row>
          <Row title={t('ai.usage')}>
            <span style={{ fontSize: 'calc(13px * var(--ts, 1))' }}>{t('ai.usageValue', { used: status.used ?? 0, limit: status.limit ?? 0 })}</span>
          </Row>
          {status.source !== 'environment' && status.source !== 'config' && (
            <div class="srow">
              <div class="slbl">
                <b><label for="ai-key">{configured ? t('ai.replace') : t('ai.add')}</label></b>
                <span>{t('ai.keyWhere')}</span>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input id="ai-key" class="input" type="password" autoComplete="off" spellcheck={false} style={{ flex: '1 1 240px' }} value={key} disabled={busy} onInput={(e) => setKey((e.target as HTMLInputElement).value)} />
                <button class="btn primary sm" disabled={!key.trim() || busy} onClick={() => run(() => aiSetKey(key.trim()))}>{t('ai.save')}</button>
                {configured && <button class="btn sm danger" disabled={busy} onClick={() => confirm(t('ai.removeConfirm')) && run(aiRemoveKey)}>{t('ai.remove')}</button>}
              </div>
            </div>
          )}
          {configured && (
            <div class="frow" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button class="btn sm" disabled={busy} onClick={runTest}>{t('ai.test')}</button>
              {test && <span role="status" style={{ fontSize: 'calc(13px * var(--ts, 1))' }}>{test}</span>}
            </div>
          )}
        </>
      )}
      {error && <div class="frow err" role="alert">{error}</div>}
      <div class="frow" style={{ fontSize: 'calc(12.5px * var(--ts, 1))', color: 'var(--muted)' }}>{t('ai.privacy')}</div>
    </Section>
  );
}

function Updates() {
  const [status, setStatus] = useState<UpdaterStatus | null>(null);
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const current = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';

  const load = () => {
    if (config.demo) return;
    const f = new FormData();
    f.append('action', 'status');
    callUpdater(f).then(setStatus).catch(() => setStatus({ ok: false, error: 'unavailable' }));
    recheck(false);
  };
  useEffect(load, []);

  const recheck = (force: boolean) => {
    if (config.demo) return;
    if (force) setCheck((c) => (c ? { ...c, checked: -1 } : c));
    checkForUpdate(force).then((r) => {
      setCheck(r);
      applyUpdateCheck(r);
    });
  };

  const install = async (force = false, latest = false) => {
    if (!file && !latest) return;
    setError('');
    setBusy(latest ? t('upd.downloading') : t('upd.uploading', { pct: 0 }));
    const f = new FormData();
    f.append('action', 'update');
    if (latest) f.append('source', 'latest');
    else if (file) f.append('package', file);
    if (force) f.append('force', '1');
    try {
      const r = await callUpdater(f, latest ? undefined : (pct) => setBusy(pct >= 100 ? t('upd.installing') : t('upd.uploading', { pct })));
      if (r.ok) {
        setBusy(t('upd.done', { v: r.version ?? '' }));
        setTimeout(() => location.reload(), 1500);
        return;
      }
      setBusy('');
      if (r.error === 'downgrade' && confirm(t('upd.downgrade', { v: r.version ?? '', current: r.current ?? '' }))) return install(true, latest);
      setError(updateError(r));
    } catch (e) {
      setBusy('');
      setError(updateError({ ok: false, error: e instanceof Error ? e.message : 'network' }));
    }
  };

  const rollback = async () => {
    const prev = status?.backups?.[0]?.version ?? '';
    if (!confirm(t('upd.rollbackConfirm', { v: prev }))) return;
    setError('');
    setBusy(t('upd.installing'));
    const f = new FormData();
    f.append('action', 'rollback');
    try {
      const r = await callUpdater(f);
      if (r.ok) {
        setBusy(t('upd.rolledBack', { v: r.version ?? prev }));
        setTimeout(() => location.reload(), 1500);
        return;
      }
      setBusy('');
      setError(updateError(r));
    } catch (e) {
      setBusy('');
      setError(updateError({ ok: false, error: e instanceof Error ? e.message : 'network' }));
    }
  };

  const ready = !!status?.ok && status.zip && status.writable;
  return (
    <Section title={t('settings.updates')} note={t('upd.help')}>
      <Row title={t('upd.installed')} help={status?.ok ? t('upd.server', { php: status.php ?? '', email: status.account ?? '' }) : undefined}>
        <span class="tag" style={{ fontSize: 'calc(13px * var(--ts, 1))', height: '26px' }}>{status?.version || current || '—'}</span>
      </Row>
      {config.demo && <div class="frow" style={{ color: 'var(--muted)' }}>{t('upd.demo')}</div>}
      {!config.demo && status === null && <div class="frow" style={{ color: 'var(--muted)' }}>{t('upd.checking')}</div>}
      {!config.demo && status && !status.ok && status.error === 'unavailable' && <div class="frow" style={{ color: 'var(--muted)' }}>{t('upd.unavailable')}</div>}
      {!config.demo && status && !status.ok && status.error !== 'unavailable' && <div class="frow err">{updateError(status)}</div>}
      {!config.demo && status?.ok && !status.zip && <div class="frow err">{t('upd.err.zip_unavailable')}</div>}
      {!config.demo && status?.ok && status.zip && !status.writable && <div class="frow err">{t('upd.err.not_writable')}</div>}
      {!config.demo && check?.ok && check.enabled && (
        <Row title={t('upd.latest')} help={latestHelp(check)}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {check.available && check.url && (
              <a class="btn sm" href={check.url} target="_blank" rel="noopener noreferrer">{t('upd.notes')}</a>
            )}
            {check.available && ready && check.canInstall ? (
              <button class="btn primary sm" disabled={!!busy} onClick={() => install(false, true)}>
                <Icon name="download" size={16} />
                {t('upd.installVersion', { v: check.latest ?? '' })}
              </button>
            ) : (
              <button class="btn sm" disabled={!!busy || check.checked === -1} onClick={() => recheck(true)}>
                {check.checked === -1 ? t('upd.checkingNow') : t('upd.checkNow')}
              </button>
            )}
          </div>
        </Row>
      )}
      {!config.demo && check && !check.ok && check.error !== 'unavailable' && <div class="frow err">{updateError({ ok: false, error: check.error ?? 'network' })}</div>}
      {ready && (
        <>
          <div class="srow">
            <div class="slbl">
              <b><label for="upd-file">{check?.enabled ? t('upd.chooseManual') : t('upd.choose')}</label></b>
              {!!status?.maxUpload && <span>{t('upd.maxSize', { size: sizeLabel(status.maxUpload) })}</span>}
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input id="upd-file" type="file" accept=".zip,application/zip" disabled={!!busy} onChange={(e) => { setFile((e.target as HTMLInputElement).files?.[0] ?? null); setError(''); }} />
              <button class="btn primary sm" disabled={!file || !!busy} onClick={() => install()}>
                <Icon name="download" size={16} />
                {t('upd.install')}
              </button>
            </div>
          </div>
          {(busy || error) && (
            <div class={`frow ${error ? 'err' : ''}`} role="status" aria-live="polite">{error || busy}</div>
          )}
          {!!status?.backups?.length && (
            <Row title={t('upd.rollback')} help={t('upd.rollbackHelp', { v: status.backups[0].version || '?' })}>
              <button class="btn sm" disabled={!!busy} onClick={rollback}>{t('upd.rollback')}</button>
            </Row>
          )}
        </>
      )}
    </Section>
  );
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function Appearance() {
  const p = getPrefs();
  const active = currentTheme().id;
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState(config.logoUrl);
  const [text, setText] = useState(config.logoUrl ? config.logoText : '');
  const [invert, setInvert] = useState(config.logoInvertDark);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const saveLocal = async () => {
    const logoUrl = file ? await readDataUrl(file) : config.logoUrl;
    localStorage.setItem('maillo.branding', JSON.stringify({ logoUrl, logoText: text, logoInvertDark: invert }));
  };

  const save = async () => {
    setError('');
    if (file && file.size > 1024 * 1024) return setError(t('upd.err.logo_too_large'));
    setBusy(t('upd.installing'));
    try {
      if (config.demo) {
        await saveLocal();
        setBusy(t('app.logoLocal'));
      } else {
        const f = new FormData();
        f.append('action', 'branding');
        f.append('logoText', text);
        f.append('logoInvertDark', invert ? '1' : '0');
        if (file) f.append('logo', file);
        const r = await callUpdater(f).catch(() => ({ ok: false, error: 'unavailable' }) as UpdaterStatus);
        if (!r.ok && r.error !== 'unavailable') {
          setBusy('');
          return setError(updateError(r));
        }
        if (r.ok) localStorage.removeItem('maillo.branding');
        else await saveLocal();
        setBusy(r.ok ? t('app.logoSaved') : t('app.logoLocal'));
      }
      setTimeout(() => location.reload(), 1400);
    } catch (e) {
      setBusy('');
      setError(updateError({ ok: false, error: e instanceof Error ? e.message : 'network' }));
    }
  };

  const remove = async () => {
    setError('');
    localStorage.removeItem('maillo.branding');
    if (!config.demo) {
      const f = new FormData();
      f.append('action', 'branding_remove');
      await callUpdater(f).catch(() => undefined);
    }
    location.reload();
  };

  const sample = (dark: boolean) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '12px 16px', borderRadius: '14px', background: dark ? '#161f34' : '#ffffff', border: '1px solid var(--line)', minWidth: '220px' }}>
      {preview ? (
        isSvgUrl(preview) || file?.type === 'image/svg+xml' ? (
          <Logo src={preview} color={dark ? `color-mix(in srgb, ${currentTheme().accent} 35%, #ffffff)` : `color-mix(in srgb, ${currentTheme().accent} 82%, #14213d)`} />
        ) : (
          <img src={preview} alt="" style={{ height: '24px', width: 'auto', maxWidth: '180px', filter: dark && invert ? 'brightness(0) invert(1)' : undefined }} />
        )
      ) : (
        <AppIcon dark={dark} />
      )}
      {preview ? (
        text && <span style={{ fontWeight: 800, fontSize: 'calc(20px * var(--ts, 1))', letterSpacing: '-0.02em', color: dark ? '#e7ecf6' : '#14213d' }}>{text}</span>
      ) : (
        <AppName color={dark ? '#e7ecf6' : '#14213d'} />
      )}
    </div>
  );

  return (
    <>
      <Section title={t('settings.appearance')}>
        <Row title={t('app.mode')} help={t('app.modeHelp')}>
          <Seg label={t('app.mode')} value={p.mode} onChange={(v) => setPrefs({ mode: v })} options={[{ value: 'system', label: t('app.system') }, { value: 'light', label: t('app.light') }, { value: 'dark', label: t('app.dark') }]} />
        </Row>
        <Row title={t('app.textSize')} help={t('app.textSizeHelp')}>
          <Seg label={t('app.textSize')} value={p.textScale} onChange={(v) => setPrefs({ textScale: v })} options={TEXT_SCALES.map((n, i) => ({ value: n, label: t(`app.textSize${i}` as StringKey) }))} />
        </Row>
        <Row title={t('app.icons')} help={t('app.iconsHelp')}>
          <Seg label={t('app.icons')} value={p.icons} onChange={(v) => setPrefs({ icons: v })} options={[{ value: 'color', label: t('app.iconsColor') }, { value: 'outline', label: t('app.iconsOutline') }]} />
        </Row>
        <Row title={t('app.tooltips')} help={t('app.tooltipsHelp')}>
          <Switch label={t('app.tooltips')} on={p.tooltips} onChange={(v) => setPrefs({ tooltips: v })} />
        </Row>
        <div class="srow" style={{ alignItems: 'flex-start' }}>
          <div class="slbl"><b>{t('app.theme')}</b><span>{t('app.themeHelp')}</span></div>
          <div role="radiogroup" aria-label={t('app.theme')} style={{ flex: '2 1 380px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: '10px' }}>
            {THEMES.map((th) => {
              const on = th.id === active;
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPrefs({ theme: th.id })}
                  style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px', borderRadius: '14px', border: on ? `2px solid ${th.accent}` : '2px solid var(--line-soft)', background: 'var(--surface)', textAlign: 'left' }}
                >
                  <span aria-hidden="true" style={{ height: '46px', borderRadius: '9px', background: `linear-gradient(180deg, ${th.top}, ${th.bottom})`, position: 'relative', display: 'block' }}>
                    <span style={{ position: 'absolute', left: '8px', bottom: '8px', width: '28px', height: '12px', borderRadius: '6px', background: th.accent }} />
                  </span>
                  <span style={{ fontSize: 'calc(13px * var(--ts, 1))', fontWeight: on ? 700 : 500, color: 'var(--ink)' }}>{t(`theme.${th.id}` as StringKey)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </Section>
      <Section title={t('app.logo')} note={t('app.logoHelp')}>
        <div class="srow" style={{ alignItems: 'flex-start' }}>
          <div class="slbl"><b>{t('app.preview')}</b></div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>{sample(false)}{sample(true)}</div>
        </div>
        <div class="formgrid">
          <label>
            {t('app.logoChoose')}
            <input type="file" accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp" onChange={(e) => { setFile((e.target as HTMLInputElement).files?.[0] ?? null); setError(''); }} />
          </label>
          <label>
            {t('app.logoText')}
            <input class="input" value={text} maxLength={40} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
          </label>
          <label class="checkline" style={{ alignSelf: 'end', paddingBottom: '8px' }}>
            <input type="checkbox" checked={invert} onChange={(e) => setInvert((e.target as HTMLInputElement).checked)} />
            {t('app.logoInvert')}
          </label>
        </div>
        <div class="frow">
          <button class="btn primary sm" disabled={!!busy || (!file && !config.logoUrl)} onClick={save}>{t('app.logoSave')}</button>
          {config.logoUrl && <button class="btn sm" disabled={!!busy} onClick={remove}>{t('app.logoRemove')}</button>}
          {(busy || error) && <span class={error ? 'err' : ''} role="status" style={{ fontSize: 'calc(13px * var(--ts, 1))' }}>{error || busy}</span>}
        </div>
      </Section>
    </>
  );
}

function NotificationSettings({ s }: { s: AppState }) {
  const n = getPrefs().notify;
  const [perm, setPerm] = useState(permission());
  const [vips, setVips] = useState(n.vips.join(', '));
  const ios = installState() === 'ios';
  const set = (patch: Partial<NotifyPrefs>) => setNotifyPrefs(patch);
  const enable = async (on: boolean) => {
    if (!on) return set({ enabled: false });
    const p = await askPermission();
    setPerm(p);
    // Chimes still work without permission, so the setting turns on either way.
    set({ enabled: true });
  };
  const userLabels = s.labels.filter((l) => l.type === 'user').sort((a, b) => a.name.localeCompare(b.name));
  const toggleLabel = (id: string) => set({ labels: n.labels.includes(id) ? n.labels.filter((x) => x !== id) : [...n.labels, id] });
  const off = !n.enabled;
  return (
    <Section title={t('settings.notifications')} note={t('notify.note')} actions={<Switch label={t('notify.enable')} on={n.enabled} onChange={enable} />}>
      <Row title={t('notify.enable')} help={t('notify.enableHelp')}>
        <button class="btn sm" onClick={() => sendTest()} disabled={off}>
          <Icon name="bell" size={16} />
          {t('notify.test')}
        </button>
      </Row>
      {perm === 'denied' && <div class="frow err">{t('notify.blocked')}</div>}
      {perm === 'unsupported' && <div class="frow err">{ios && !isStandalone() ? t('notify.iosHint') : t('notify.unsupported')}</div>}
      <fieldset class="nset" disabled={off}>
        <Row title={t('notify.scope')} help={t('notify.scopeHelp')}>
          <Seg
            label={t('notify.scope')}
            value={n.scope}
            onChange={(v) => set({ scope: v })}
            options={[
              { value: 'all', label: t('notify.scopeAll') },
              { value: 'primary', label: t('notify.scopePrimary') },
              { value: 'important', label: t('notify.scopeImportant') },
              { value: 'none', label: t('notify.scopeNone') }
            ]}
          />
        </Row>
        <Row title={t('notify.vips')} help={t('notify.vipsHelp')}>
          <input
            class="input nset-wide"
            value={vips}
            placeholder={t('notify.vipsPlaceholder')}
            aria-label={t('notify.vips')}
            onInput={(e) => setVips((e.target as HTMLInputElement).value)}
            onBlur={() => set({ vips: vips.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean) })}
          />
        </Row>
        <Row title={t('notify.labels')} help={t('notify.labelsHelp')}>
          <div class="nset-chips" role="group" aria-label={t('notify.labels')}>
            {userLabels.length === 0 && <span class="nset-empty">{t('notify.noLabels')}</span>}
            {userLabels.map((l) => (
              <button type="button" class={`chip ${n.labels.includes(l.id) ? 'on' : ''}`} aria-pressed={n.labels.includes(l.id)} onClick={() => toggleLabel(l.id)}>
                {l.name}
              </button>
            ))}
          </div>
        </Row>
        <Row title={t('notify.preview')} help={t('notify.previewHelp')}>
          <Switch label={t('notify.preview')} on={n.preview} onChange={(v) => set({ preview: v })} />
        </Row>
        <Row title={t('notify.sound')} help={t('notify.gestureHint')}>
          <Switch label={t('notify.sound')} on={n.sound} onChange={(v) => set({ sound: v })} />
        </Row>
        <Row title={t('notify.chime')} help={t('notify.chimeHelp')}>
          <Seg
            label={t('notify.chime')}
            value={n.chime}
            onChange={(v) => {
              set({ chime: v });
              playChime(v, n.volume);
            }}
            options={CHIMES.map((c) => ({ value: c, label: t(`notify.chime.${c}` as StringKey) }))}
          />
        </Row>
        <Row title={t('notify.volume')}>
          <div class="nset-vol">
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={n.volume}
              aria-label={t('notify.volume')}
              onInput={(e) => set({ volume: Number((e.target as HTMLInputElement).value) })}
              onChange={() => playChime(getPrefs().notify.chime, getPrefs().notify.volume)}
            />
            <button type="button" class="ib" aria-label={t('notify.play')} title={t('notify.play')} onClick={() => playChime(n.chime, n.volume)}>
              <Icon name="play" size={18} />
            </button>
          </div>
        </Row>
        <Row title={t('notify.focused')} help={t('notify.focusedHelp')}>
          <Seg
            label={t('notify.focused')}
            value={n.focused}
            onChange={(v) => set({ focused: v })}
            options={[
              { value: 'notify', label: t('notify.focusedNotify') },
              { value: 'chime', label: t('notify.focusedChime') },
              { value: 'silent', label: t('notify.focusedSilent') }
            ]}
          />
        </Row>
        <Row title={t('notify.quiet')} help={t('notify.quietHelp')}>
          <div class="nset-quiet">
            <label>
              <span>{t('notify.quietFrom')}</span>
              <input class="input" type="time" value={n.quietFrom} disabled={off || !n.quiet} onInput={(e) => set({ quietFrom: (e.target as HTMLInputElement).value || '22:00' })} />
            </label>
            <label>
              <span>{t('notify.quietTo')}</span>
              <input class="input" type="time" value={n.quietTo} disabled={off || !n.quiet} onInput={(e) => set({ quietTo: (e.target as HTMLInputElement).value || '07:00' })} />
            </label>
            <Switch label={t('notify.quiet')} on={n.quiet} onChange={(v) => set({ quiet: v })} />
          </div>
        </Row>
        <Row title={t('notify.badge')} help={t('notify.badgeHelp')}>
          <Switch label={t('notify.badge')} on={n.badge} onChange={(v) => set({ badge: v })} />
        </Row>
      </fieldset>
    </Section>
  );
}

function pushError(r: PushStatus): string {
  const key = `push.err.${r.error}` as StringKey;
  const known = t(key, { detail: r.detail ?? '' });
  return known === key ? t('push.err.generic', { code: r.error ?? 'unknown' }) : known;
}

function CopyRow({ title, help, value }: { title: string; help: string; value: string }) {
  return (
    <div class="srow">
      <div class="slbl"><b>{title}</b><span>{help}</span></div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flex: '1 1 320px', minWidth: 0 }}>
        <input class="input" readOnly value={value} aria-label={title} style={{ flex: 1, fontFamily: 'ui-monospace, monospace', fontSize: 'calc(12px * var(--ts, 1))' }} onFocus={(e) => (e.target as HTMLInputElement).select()} />
        <button class="btn sm" onClick={() => navigator.clipboard?.writeText(value).then(() => toast(t('push.copied')), () => undefined)}>
          <Icon name="copy" size={15} />
          {t('push.copy')}
        </button>
      </div>
    </div>
  );
}

/** Notifications while Maillo is closed: this device's push subscription, and the server setup to finish in Google Cloud. */
function PushSettings() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const load = () => {
    pushStatus().then(setStatus);
  };
  useEffect(() => {
    if (config.features.push && !config.demo && pushSupported) load();
  }, []);
  const run = async (fn: () => Promise<PushStatus>, done?: string) => {
    setBusy(true);
    setError('');
    setNote('');
    const r = await fn();
    setBusy(false);
    if (!r.ok) return setError(pushError(r));
    if (done) setNote(done);
    load();
  };
  const on = !!status?.device;
  const blocker = status?.ok ? (!status.topic ? t('push.err.no_topic') : !status.staySignedIn ? t('push.err.needsStay') : !status.crypto ? t('push.err.no_crypto') : '') : '';
  return (
    <Section title={t('push.title')} note={t('push.help')}>
      {!config.features.push && <div class="frow" style={{ color: 'var(--muted)' }}>{t('push.offHelp')}</div>}
      {config.features.push && config.demo && <div class="frow" style={{ color: 'var(--muted)' }}>{t('ai.demo')}</div>}
      {config.features.push && !config.demo && !pushSupported && <div class="frow err">{t('push.unsupported')}</div>}
      {config.features.push && !config.demo && pushSupported && status === null && <div class="frow" style={{ color: 'var(--muted)' }}>{t('upd.checking')}</div>}
      {status && !status.ok && <div class="frow err">{pushError(status)}</div>}
      {status?.ok && (
        <>
          <Row title={t('push.device')} help={on && status.expiration ? t('push.watch', { date: new Date(status.expiration * 1000).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) }) : t('push.deviceHelp')}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span class="tag" style={{ fontSize: 'calc(13px * var(--ts, 1))', height: '26px' }}>{on ? t('push.on') : t('push.off')}</span>
              {on ? (
                <>
                  <button class="btn sm" disabled={busy} onClick={() => run(testPush, t('push.testSent'))}><Icon name="bell" size={16} />{t('push.test')}</button>
                  <button class="btn sm" disabled={busy} onClick={() => run(disablePush)}>{t('push.turnOff')}</button>
                </>
              ) : (
                <button class="btn primary sm" disabled={busy || !!blocker} onClick={() => run(() => enablePush(status.vapidPublic ?? ''))}>{t('push.turnOn')}</button>
              )}
            </div>
          </Row>
          {blocker && <div class="frow err">{blocker}</div>}
          {status.watchError && <div class="frow err">{t('push.err.watch_failed', { detail: status.watchError })}</div>}
          {status.tokenError && <div class="frow err">{t('push.err.tokenError')}</div>}
          {status.endpoint && <CopyRow title={t('push.endpoint')} help={t('push.endpointHelp')} value={status.endpoint} />}
          {status.renewUrl && <CopyRow title={t('push.renew')} help={t('push.renewHelp')} value={status.renewUrl} />}
        </>
      )}
      {(error || note) && <div class={`frow ${error ? 'err' : ''}`} role="status">{error || note}</div>}
    </Section>
  );
}

function InstallApp() {
  const [, force] = useState(0);
  useEffect(() => onInstallChange(() => force((x) => x + 1)), []);
  const st = installState();
  const install = async () => {
    await promptInstall();
    force((x) => x + 1);
  };
  return (
    <Section title={t('app.title')} note={t('app.note')}>
      <div class="app-hero">
        <img class="for-light" src="./icon.png" alt="" width={72} height={72} />
        <img class="for-dark" src="./icon-dark.png" alt="" width={72} height={72} />
        <div class="slbl">
          {st === 'installed' && <><b>{t('app.installed')}</b><span>{t('app.installedHelp')}</span></>}
          {st === 'ready' && <><b>{t('app.ready')}</b><span>{t('app.readyHelp')}</span></>}
          {st === 'ios' && <><b>{t('app.ios')}</b><span>{t('app.iosHelp')}</span></>}
          {st === 'manual' && <><b>{t('app.manual')}</b><span>{t('app.manualHelp')}</span></>}
          {st === 'unsupported' && <><b>{t('app.unsupported')}</b><span>{t('app.unsupportedHelp')}</span></>}
        </div>
        {st === 'ready' && (
          <button class="btn primary" onClick={install}>
            <Icon name="download" size={16} />
            {t('app.install')}
          </button>
        )}
        {st === 'installed' && <Icon name="check" size={22} style={{ color: 'var(--accent)' }} />}
      </div>
    </Section>
  );
}
