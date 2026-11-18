import DOMPurify from 'dompurify';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { config } from '../config';
import type { GFilter, GSendAs, GVacation } from '../gmail/types';
import { setLanguage, t, type StringKey } from '../i18n';
import { labelColor } from '../model';
import { getPrefs, setPrefs } from '../prefs';
import { SETTINGS_SECTIONS, type SettingsSection } from '../route';
import { api, loadLabels, setState, toast, type AppState } from '../store';
import { Seg, Switch } from './common';
import { Icon } from './Icon';
import { KeyList } from './Keys';

declare const __APP_VERSION__: string;

const ICONS: Record<SettingsSection, [string, string]> = {
  general: ['gear', 'var(--c-scheduled)'],
  labels: ['tag', 'var(--c-drafts)'],
  filters: ['filter', 'var(--c-sent)'],
  accounts: ['user', 'var(--c-snooze)'],
  vacation: ['sun', 'var(--c-important)'],
  forwarding: ['forward', 'var(--c-tasks)'],
  shortcuts: ['keyboard', 'var(--c-trash)'],
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
          {SETTINGS_SECTIONS.map((id) => (
            <a class={`nav ${id === section ? 'on' : ''}`} href={`#/settings/${id}`} aria-current={id === section ? 'page' : undefined}>
              <Icon name={ICONS[id][0]} style={{ color: ICONS[id][1] }} />
              <span class="nav-t">{t(`settings.${id}` as StringKey)}</span>
            </a>
          ))}
        </nav>
        <main class="scontent">
          {section === 'general' && <General />}
          {section === 'labels' && <Labels s={s} />}
          {section === 'filters' && <Filters s={s} />}
          {section === 'accounts' && <Accounts />}
          {section === 'vacation' && <Vacation />}
          {section === 'forwarding' && <Forwarding />}
          {section === 'shortcuts' && (
            <Section title={t('settings.shortcuts')}>
              <div style={{ padding: '0 24px 20px' }}><KeyList /></div>
            </Section>
          )}
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

function General() {
  const p = getPrefs();
  const stored = localStorage.getItem('mailmax.lang');
  return (
    <Section title={t('settings.general')} note={t('settings.syncNote')}>
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
          onChange={(v) => setLanguage(v as 'en' | 'fr' | 'auto')}
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
              <span style={{ flex: 1, fontSize: '14px' }}>{l.name}</span>
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{s.counts[l.id] ? `${s.counts[l.id]} ●` : ''}</span>
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
            <span style={{ fontSize: '13px', flex: '1 1 200px' }}>{d.then}</span>
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

function Accounts() {
  const [list, setList] = useState<GSendAs[] | null>(null);
  const [error, setError] = useState('');
  const [sigs, setSigs] = useState<Record<string, string>>({});
  useEffect(() => {
    api.listSendAs().then((l) => {
      setList(l);
      setSigs(Object.fromEntries(l.map((x) => [x.sendAsEmail, x.signature ?? ''])));
    }).catch((e) => setError(errMsg(e)));
  }, []);
  return (
    <Section title={t('settings.accounts')} note={t('settings.signatureHelp')}>
      {error && <div class="frow err">{t('settings.loadError')} {error}</div>}
      {list === null && !error && <div class="skeleton" />}
      {list?.map((x) => (
        <div class="srow" style={{ alignItems: 'flex-start' }}>
          <div class="slbl">
            <b>{x.displayName ? `${x.displayName} <${x.sendAsEmail}>` : x.sendAsEmail}</b>
            <span>{x.isDefault ? t('settings.default') : t('settings.sendAs')}</span>
          </div>
          <div style={{ flex: '2 1 360px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label class="caps" for={`sig-${x.sendAsEmail}`}>{t('settings.signature')}</label>
            <textarea id={`sig-${x.sendAsEmail}`} class="textarea" value={sigs[x.sendAsEmail] ?? ''} onInput={(e) => setSigs({ ...sigs, [x.sendAsEmail]: (e.target as HTMLTextAreaElement).value })} />
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
    <span class="tag" style={{ background: on ? 'linear-gradient(135deg,#d2f1e6,#e3f5ee)' : 'var(--cloud)' }}>{on ? t('settings.enabled') : t('settings.disabled')}</span>
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
