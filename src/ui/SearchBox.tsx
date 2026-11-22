import { useEffect, useRef, useState } from 'preact/hooks';
import type { Address } from '../gmail/mime';
import type { PersonHit } from '../gmail/types';
import { t, type StringKey } from '../i18n';
import { labelColor, labelDisplayName, listDate } from '../model';
import { go, type Folder } from '../route';
import { api, fetchRows, pileLabelIds, type AppState } from '../store';
import { Avatar, Photo } from './common';
import { Icon } from './Icon';
import { SEARCH_KEY } from './Keys';

const RECENT_KEY = 'maillo.recentSearches';
const FOLDERS: Folder[] = ['inbox', 'starred', 'snoozed', 'important', 'sent', 'scheduled', 'drafts', 'all', 'spam', 'trash'];

type Item =
  | { kind: 'search'; q: string; recent?: boolean }
  | { kind: 'clear' }
  | { kind: 'place'; name: string; hash: string; color?: string }
  | { kind: 'person'; a: Address; photo?: string }
  | { kind: 'message'; id: string; subject: string; from: string; date: Date };

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

function remember(q: string) {
  const v = q.trim();
  if (!v) return;
  const next = [v, ...readRecent().filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

function forgetRecent() {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    /* storage unavailable */
  }
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** True when every typed word starts a word in `text` (so "le fo" finds "Léa Fontaine", not "example"). */
function wordMatch(text: string, q: string): boolean {
  const words = norm(text).split(/[^a-z0-9]+/).filter(Boolean);
  return norm(q).split(/\s+/).filter(Boolean).every((p) => words.some((w) => w.startsWith(p)));
}

function places(s: AppState, q: string): Item[] {
  const n = q.trim();
  const folders: Item[] = FOLDERS.map((f) => ({ kind: 'place' as const, name: t(`nav.${f}` as StringKey), hash: `#/${f}` }));
  const piles = pileLabelIds();
  const labels: Item[] = s.labels
    .filter((l) => l.type === 'user' && !piles.includes(l.id))
    .map((l) => ({ kind: 'place' as const, name: labelDisplayName(l), hash: `#/label/${encodeURIComponent(l.id)}`, color: labelColor(l) }));
  return [...folders, ...labels].filter((x) => x.kind === 'place' && wordMatch(x.name, n)).slice(0, 4);
}

function localPeople(s: AppState, q: string): Address[] {
  const n = norm(q.trim());
  return s.recent.filter((a) => wordMatch(a.name || '', n) || a.email.toLowerCase().startsWith(n)).slice(-5).reverse();
}

/** Search field with suggestions: recent searches, folders and labels, people, and matching conversations. */
export function SearchBox({ s }: { s: AppState }) {
  const r = s.route;
  const [q, setQ] = useState(r.view === 'mail' && r.q !== undefined ? r.q : '');
  const [open, setOpen] = useState(false);
  // Suggestions wait for the field to finish widening, so the menu doesn't stretch along with it.
  const [wide, setWide] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const wideTimer = useRef<number | undefined>(undefined);
  const [active, setActive] = useState(-1);
  const [people, setPeople] = useState<PersonHit[]>([]);
  const [messages, setMessages] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [, bump] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setQ(r.view === 'mail' && r.q !== undefined ? r.q : '');
  }, [r.view === 'mail' ? r.q : undefined]);

  // People and messages come from Google, so wait for a pause in typing and drop stale answers.
  useEffect(() => {
    clearTimeout(timer.current);
    const v = q.trim();
    const mine = ++seq.current;
    if (!open || v.length < 2) {
      setPeople([]);
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = window.setTimeout(async () => {
      const [p, m] = await Promise.allSettled([
        api.searchPeople(v),
        (async () => {
          const list = await api.listThreads({ q: v, maxResults: 4 });
          const rows = await fetchRows(list.threads ?? []);
          return rows.map((row): Item => {
            return { kind: 'message', id: row.id, subject: row.subject || t('list.noSubject'), from: row.lastFrom.name || row.lastFrom.email, date: row.date };
          });
        })()
      ]);
      if (mine !== seq.current) return;
      setPeople(p.status === 'fulfilled' ? p.value : []);
      setMessages(m.status === 'fulfilled' ? m.value : []);
      setLoading(false);
    }, 250);
    return () => clearTimeout(timer.current);
  }, [q, open]);

  const v = q.trim();
  const sections: { title?: string; items: Item[] }[] = [];
  if (!v) {
    const recent = readRecent();
    if (recent.length) sections.push({ title: t('search.recent'), items: [...recent.map((x): Item => ({ kind: 'search', q: x, recent: true })), { kind: 'clear' }] });
  } else {
    sections.push({ items: [{ kind: 'search', q: v }] });
    const pl = places(s, v);
    if (pl.length) sections.push({ title: t('search.places'), items: pl });
    const seen = new Set<string>();
    const ppl: Item[] = [];
    for (const a of localPeople(s, v)) {
      seen.add(a.email.toLowerCase());
      ppl.push({ kind: 'person', a, photo: s.contactPhotos[a.email.toLowerCase()] });
    }
    for (const h of people) {
      if (seen.has(h.email.toLowerCase())) continue;
      seen.add(h.email.toLowerCase());
      ppl.push({ kind: 'person', a: { name: h.name, email: h.email }, photo: h.photo });
    }
    if (ppl.length) sections.push({ title: t('search.people'), items: ppl.slice(0, 5) });
    if (messages.length) sections.push({ title: t('search.messages'), items: messages });
  }
  const flat = sections.flatMap((x) => x.items);
  const show = open && wide && flat.length > 0;

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  const focus = () => {
    setOpen(true);
    clearTimeout(wideTimer.current);
    const el = form.current;
    const dur = el ? parseFloat(getComputedStyle(el).transitionDuration) || 0 : 0;
    // Narrow screens and reduced motion don't animate the width.
    if (!el || dur === 0 || el.getBoundingClientRect().width >= el.parentElement!.getBoundingClientRect().width * 0.9) setWide(true);
    else wideTimer.current = window.setTimeout(() => setWide(true), 260);
  };

  const blur = () => {
    clearTimeout(wideTimer.current);
    setTimeout(() => {
      close();
      if (document.activeElement !== input.current) setWide(false);
    }, 120);
  };

  const pick = (it: Item) => {
    if (it.kind === 'clear') {
      forgetRecent();
      setActive(-1);
      bump((n) => n + 1);
      return;
    }
    close();
    input.current?.blur();
    if (it.kind === 'search') {
      remember(it.q);
      setQ(it.q);
      go(`#/search/${encodeURIComponent(it.q)}`);
    } else if (it.kind === 'place') {
      setQ('');
      go(it.hash);
    } else if (it.kind === 'person') {
      remember(it.a.email);
      setQ(it.a.email);
      go(`#/search/${encodeURIComponent(it.a.email)}`);
    } else {
      remember(v);
      go(`#/search/${encodeURIComponent(v)}/t/${encodeURIComponent(it.id)}`);
    }
  };

  const submit = (e: Event) => {
    e.preventDefault();
    if (show && active >= 0 && flat[active]) return pick(flat[active]);
    close();
    input.current?.blur();
    if (v) remember(v);
    go(v ? `#/search/${encodeURIComponent(v)}` : '#/inbox');
  };

  const optId = (i: number) => `mm-sugg-${i}`;
  let i = -1;

  return (
    <form
      class="search"
      role="search"
      ref={form}
      onSubmit={submit}
      onTransitionEnd={(e) => {
        if (e.target === form.current && e.propertyName === 'width' && document.activeElement === input.current) {
          clearTimeout(wideTimer.current);
          setWide(true);
        }
      }}
    >
      <Icon name="search" />
      <label for="mm-search" class="sr-only">{t('search.label')}</label>
      <input
        id="mm-search"
        ref={input}
        type="search"
        value={q}
        placeholder={t('search.placeholder')}
        aria-keyshortcuts="Meta+K Control+K"
        autoComplete="off"
        {...({ role: 'combobox' } as Record<string, string>)}
        aria-expanded={show}
        aria-controls="mm-suggestions"
        aria-autocomplete="list"
        aria-activedescendant={show && active >= 0 ? optId(active) : undefined}
        onFocus={focus}
        onBlur={blur}
        onInput={(e) => {
          setQ((e.target as HTMLInputElement).value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!flat.length) return;
            e.preventDefault();
            setOpen(true);
            const d = e.key === 'ArrowDown' ? 1 : -1;
            // Cycle through the options and back to the text field (-1).
            setActive((a) => {
              const next = a + d;
              return next >= flat.length ? -1 : next < -1 ? flat.length - 1 : next;
            });
          } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            close();
          }
        }}
      />
      {q && (
        <button type="button" class="ib sm" aria-label={t('search.clear')} onClick={() => { setQ(''); go('#/inbox'); input.current?.focus(); }}>
          <Icon name="x" />
        </button>
      )}
      <span class="kbd" aria-hidden="true">{SEARCH_KEY}</span>
      {show && (
        <div class="sugg" id="mm-suggestions" role="listbox" aria-label={t('search.suggestions')} onMouseDown={(e) => e.preventDefault()}>
          {sections.map((sec) => (
            <div role="group" aria-label={sec.title}>
              {sec.title && <div class="sugg-h" aria-hidden="true">{sec.title}</div>}
              {sec.items.map((it) => {
                const n = ++i;
                return (
                  <div
                    id={optId(n)}
                    role="option"
                    aria-selected={n === active}
                    class={`sugg-i ${n === active ? 'on' : ''}`}
                    onMouseEnter={() => setActive(n)}
                    onClick={() => pick(it)}
                  >
                    {it.kind === 'search' && (
                      <>
                        <span class="sugg-ic"><Icon name={it.recent ? 'clock' : 'search'} size={16} /></span>
                        <span class="sugg-t ell">{it.recent ? it.q : t('search.for', { q: it.q })}</span>
                      </>
                    )}
                    {it.kind === 'clear' && (
                      <>
                        <span class="sugg-ic"><Icon name="x" size={16} /></span>
                        <span class="sugg-t sugg-clear ell">{t('search.clearRecent')}</span>
                      </>
                    )}
                    {it.kind === 'place' && (
                      <>
                        <span class="sugg-ic">
                          {it.color ? <span class="sugg-dot" style={{ background: it.color }} /> : <Icon name="inbox" size={16} />}
                        </span>
                        <span class="sugg-t ell">{it.name}</span>
                      </>
                    )}
                    {it.kind === 'person' && (
                      <>
                        {it.photo ? (
                          <span class="av sm" aria-hidden="true"><Photo src={it.photo} fallback={<Avatar a={it.a} size="sm" />} /></span>
                        ) : (
                          <Avatar a={it.a} size="sm" />
                        )}
                        <span class="sugg-t ell">
                          {it.a.name || it.a.email}
                          {it.a.name && <span class="sugg-sub"> {it.a.email}</span>}
                        </span>
                      </>
                    )}
                    {it.kind === 'message' && (
                      <>
                        <span class="sugg-ic"><Icon name="mail" size={16} /></span>
                        <span class="sugg-t ell">
                          {it.subject}
                          <span class="sugg-sub"> {it.from}</span>
                        </span>
                        <span class="sugg-d">{listDate(it.date)}</span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {loading && <div class="sugg-loading" aria-hidden="true"><span /><span /><span /></div>}
        </div>
      )}
    </form>
  );
}
