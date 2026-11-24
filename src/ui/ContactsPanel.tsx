import { useEffect, useMemo, useState } from 'preact/hooks';
import { config } from '../config';
import type { ContactCard, PersonHit } from '../gmail/types';
import type { Address } from '../gmail/mime';
import { t } from '../i18n';
import { go } from '../route';
import { api, getState, openCompose, setState, toast, type AppState } from '../store';
import { Avatar } from './common';
import { Icon } from './Icon';
import { PanelEmpty } from './SidePanel';

const SHOW = 80;

// Kept for the session so reopening the panel is instant.
let contactsCache: ContactCard[] | null = null;
let contactsLoading: Promise<ContactCard[]> | null = null;

function fold(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Word-start match on the name, or start of any email address. */
function matches(c: { name: string; emails: string[] }, q: string) {
  if (!q) return true;
  const name = fold(c.name);
  return name.startsWith(q) || name.split(/[\s\-'.]+/).some((w) => w.startsWith(q)) || c.emails.some((e) => fold(e).startsWith(q));
}

/** Adds photos we just learned about to the shared avatar cache. */
function rememberPhotos(cards: { emails: string[]; photo?: string }[]) {
  const known = getState().contactPhotos;
  const add: Record<string, string> = {};
  for (const c of cards) {
    if (!c.photo) continue;
    for (const e of c.emails) if (!known[e.toLowerCase()]) add[e.toLowerCase()] = c.photo;
  }
  if (Object.keys(add).length) setState({ contactPhotos: { ...known, ...add } });
}

function loadContacts(): Promise<ContactCard[]> {
  if (contactsCache) return Promise.resolve(contactsCache);
  contactsLoading ??= api.listContacts().then((list) => {
    contactsCache = list;
    rememberPhotos(list);
    return list;
  }).finally(() => {
    contactsLoading = null;
  });
  return contactsLoading;
}

function isMine(s: AppState, email: string) {
  const e = email.toLowerCase();
  return e === s.me.toLowerCase() || s.sendAs.some((x) => x.sendAsEmail.toLowerCase() === e);
}

function blankCard(a: Address): ContactCard {
  return { id: '', source: 'other', name: a.name, emails: [a.email], phones: [], addresses: [], urls: [] };
}

export function ContactsPanel({ s }: { s: AppState }) {
  const enabled = config.features.contactPhotos || config.demo;
  const [list, setList] = useState<ContactCard[] | null>(contactsCache);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PersonHit[]>([]);
  const [open, setOpen] = useState<ContactCard | null>(null);

  useEffect(() => {
    if (!enabled || list) return;
    loadContacts().then(setList, () => setFailed(true));
  }, []);

  const query = fold(q.trim());

  // Beyond your own contacts: the directory and "Other contacts", once a few letters are typed.
  useEffect(() => {
    setHits([]);
    if (!enabled || query.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      api.searchPeople(q.trim()).then((r) => live && setHits(r), () => undefined);
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  // People in the open conversation, without you.
  const inThread = useMemo(() => {
    const seen = new Map<string, Address>();
    for (const m of s.open?.messages ?? []) {
      for (const a of [m.from, ...m.to, ...m.cc]) {
        const k = a.email.toLowerCase();
        if (!a.email || isMine(s, a.email)) continue;
        const prev = seen.get(k);
        if (!prev || (!prev.name && a.name)) seen.set(k, a);
      }
    }
    return [...seen.values()].slice(0, 12);
  }, [s.open, s.me, s.sendAs]);

  if (open) return <ContactDetail card={open} onBack={() => setOpen(null)} />;

  const shown = (list ?? []).filter((c) => matches(c, query));
  const known = new Set(shown.flatMap((c) => c.emails.map((e) => e.toLowerCase())));
  const extra = hits.filter((h) => !known.has(h.email.toLowerCase()));
  const fromList = (a: Address) => (list ?? []).find((c) => c.emails.some((e) => e.toLowerCase() === a.email.toLowerCase())) ?? blankCard(a);

  return (
    <>
      <div class="ct-search">
        <Icon name="search" size={16} />
        <input
          class="input"
          type="search"
          value={q}
          placeholder={t('ct.search')}
          aria-label={t('ct.search')}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        />
      </div>

      {!query && inThread.length > 0 && (
        <>
          <span class="caps">{t('ct.inThread')}</span>
          <div class="ct-list">
            {inThread.map((a) => <PersonRow a={a} sub={a.email} onClick={() => setOpen(fromList(a))} />)}
          </div>
        </>
      )}

      {!enabled ? (
        <>
          <PanelEmpty icon="contacts" title={t('empty.ctOffTitle')} sub={inThread.length === 0 ? `${t('ct.noThread')} ${t('ct.enable')}` : t('ct.enable')} />
        </>
      ) : failed ? (
        <p class="ct-note">{t('ct.failed')}</p>
      ) : !list ? (
        <p class="ct-note">{t('ct.loading')}</p>
      ) : (
        <>
          <span class="caps">{query ? t('ct.results') : t('ct.all', { n: list.length })}</span>
          {shown.length === 0 && extra.length === 0 && (query ? <p class="ct-note">{t('ct.none')}</p> : <PanelEmpty icon="contacts" title={t('ct.empty')} sub={t('empty.ctSub')} />)}
          <div class="ct-list">
            {shown.slice(0, SHOW).map((c) => (
              <PersonRow a={{ name: c.name, email: c.emails[0] ?? '' }} sub={c.title && c.org ? `${c.title} · ${c.org}` : c.org || c.emails[0] || c.phones[0]?.value || ''} onClick={() => setOpen(c)} />
            ))}
          </div>
          {shown.length > SHOW && <p class="ct-note">{t('ct.more', { n: shown.length - SHOW })}</p>}
          {extra.length > 0 && (
            <>
              <span class="caps">{t('ct.elsewhere')}</span>
              <div class="ct-list">
                {extra.map((h) => <PersonRow a={h} sub={h.email} onClick={() => setOpen(blankCard(h))} />)}
              </div>
            </>
          )}
        </>
      )}

    </>
  );
}

function PersonRow({ a, sub, onClick }: { a: Address; sub: string; onClick: () => void }) {
  return (
    <button type="button" class="ct-row" onClick={onClick}>
      <Avatar a={a} size="sm" />
      <span class="ct-row-t">
        <b class="ell">{a.name || a.email || '—'}</b>
        {sub && sub !== a.name && <span class="ell">{sub}</span>}
      </span>
    </button>
  );
}

function ContactDetail({ card, onBack }: { card: ContactCard; onBack: () => void }) {
  const [c, setC] = useState(card);
  const email = card.emails[0] ?? '';

  // The list holds a short version; fetch the full card (and people who aren't in your contacts).
  useEffect(() => {
    if (!(config.features.contactPhotos || config.demo) || !email) return;
    let live = true;
    api.findContact(email).then((full) => {
      if (!live || !full) return;
      rememberPhotos([full]);
      setC({ ...full, emails: [...new Set([...card.emails, ...full.emails])], name: full.name || card.name });
    }, () => undefined);
    return () => {
      live = false;
    };
  }, [email]);

  const a: Address = { name: c.name, email };
  const copy = (v: string) => {
    navigator.clipboard?.writeText(v).then(() => toast(t('ct.copied')), () => undefined);
  };
  const gcLink = c.source === 'contact' && c.id.startsWith('people/') && /^https:\/\/contacts\.google\.com\//.test(config.links.contacts)
    ? new URL(`person/${c.id.slice(7)}`, config.links.contacts).href
    : config.links.contacts;

  return (
    <>
      <button type="button" class="ct-back" onClick={onBack}>
        <Icon name="arrowLeft" size={16} />
        {t('ct.back')}
      </button>
      <div class="ct-card">
        <Avatar a={a} size="xl" />
        <b class="ct-name">{c.name || email}</b>
        {(c.title || c.org) && <span class="ct-sub">{[c.title, c.org].filter(Boolean).join(' · ')}</span>}
        <div class="ct-actions">
          {email && (
            <button class="btn sm primary" onClick={() => openCompose('new', undefined, { to: [a] })}>
              <Icon name="mail" size={16} />
              {t('panel.email')}
            </button>
          )}
          {email && (
            <button class="btn sm" onClick={() => go(`#/search/${encodeURIComponent(`from:${email} OR to:${email}`)}`)}>
              <Icon name="search" size={16} />
              {t('ct.findMail')}
            </button>
          )}
        </div>
      </div>

      <div class="ct-fields">
        {c.emails.map((e) => (
          <div class="ct-field">
            <Icon name="mail" size={16} />
            <button type="button" class="ct-link ell" onClick={() => openCompose('new', undefined, { to: [{ name: c.name, email: e }] })}>{e}</button>
            <button type="button" class="ib sm" aria-label={t('ct.copy', { v: e })} onClick={() => copy(e)}><Icon name="copy" size={15} /></button>
          </div>
        ))}
        {c.phones.map((p) => (
          <div class="ct-field">
            <Icon name="phone" size={16} />
            <a class="ct-link ell" href={`tel:${p.value.replace(/[^\d+]/g, '')}`}>{p.value}</a>
            {p.type && <span class="ct-type">{p.type}</span>}
            <button type="button" class="ib sm" aria-label={t('ct.copy', { v: p.value })} onClick={() => copy(p.value)}><Icon name="copy" size={15} /></button>
          </div>
        ))}
        {c.addresses.map((ad) => (
          <div class="ct-field">
            <Icon name="pin" size={16} />
            <span class="ct-text">{ad}</span>
          </div>
        ))}
        {c.birthday && (
          <div class="ct-field">
            <Icon name="calendar" size={16} />
            <span class="ct-text">{t('ct.birthday', { d: c.birthday })}</span>
          </div>
        )}
        {c.urls.map((u) => (
          <div class="ct-field">
            <Icon name="globe" size={16} />
            <a class="ct-link ell" href={u} target="_blank" rel="noopener noreferrer">{u.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>
          </div>
        ))}
        {c.note && <p class="ct-text ct-bio">{c.note}</p>}
      </div>

      {c.source === 'directory' && <p class="ct-note">{t('ct.fromDirectory')}</p>}
      <a class="btn sm" href={gcLink} target="_blank" rel="noopener noreferrer" style={{ alignSelf: 'flex-start' }}>
        <Icon name="external" size={16} />
        {c.source === 'contact' ? t('ct.openInContacts') : t('panel.open', { name: t('panel.contacts') })}
      </a>
    </>
  );
}
