import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { labelColor, SYSTEM_LABELS } from '../model';
import { actions, type AppState } from '../store';
import { Menu } from './common';
import { CIcon } from './ColorIcons';
import { Icon } from './Icon';

function userLabels(s: AppState) {
  return s.labels.filter((l) => l.type === 'user').sort((a, b) => a.name.localeCompare(b.name));
}

const matches = (name: string, q: string) => name.toLowerCase().includes(q.trim().toLowerCase());

/**
 * Filter field that takes focus when its list appears. ↑/↓ move the highlight through the list
 * (focus stays in the field so typing keeps filtering), Enter runs the highlighted item.
 */
function FilterInput({ label, value, onInput, count, active, setActive, onPick }: {
  label: string;
  value: string;
  onInput: (v: string) => void;
  count: number;
  active: number;
  setActive: (i: number) => void;
  onPick: (i: number) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // On touch screens the keyboard would cover the list; the search is one tap away.
    if (!window.matchMedia('(pointer: coarse)').matches) ref.current?.focus();
  }, []);
  return (
    <input
      ref={ref}
      type="search"
      placeholder={label}
      aria-label={label}
      value={value}
      onInput={(e) => {
        onInput((e.target as HTMLInputElement).value);
        setActive(0);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (count) onPick(Math.min(active, count - 1));
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!count) return;
          const next = (active + (e.key === 'ArrowDown' ? 1 : -1) + count) % count;
          setActive(next);
          ref.current?.parentElement?.querySelectorAll('.mi')[next]?.scrollIntoView({ block: 'nearest' });
        }
      }}
    />
  );
}

/** Filterable "Label as" list. `current` is the thread's labels; without it, a label counts as on when every selected row has it. */
export function LabelList({ s, ids, current, onDone }: { s: AppState; ids: string[]; current?: string[]; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const rows = s.list.rows.filter((r) => ids.includes(r.id));
  const has = (id: string) => (current ? current.includes(id) : rows.length > 0 && rows.every((r) => r.labelIds.includes(id)));
  const list = userLabels(s).filter((l) => matches(l.name, q));
  const toggle = (id: string) => {
    const on = has(id);
    actions.label(ids, on ? [] : [id], on ? [id] : []);
    onDone();
  };
  return (
    <>
      <FilterInput label={t('act.searchLabels')} value={q} onInput={setQ} count={list.length} active={active} setActive={setActive} onPick={(i) => toggle(list[i].id)} />
      {list.map((l, i) => {
        const on = has(l.id);
        return (
          <button role="menuitemcheckbox" aria-checked={on} class={`mi ${i === active ? 'active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => toggle(l.id)}>
            <Icon name={on ? 'check' : 'tag'} size={16} style={{ color: labelColor(l) }} />
            <span class="ell">{l.name}</span>
          </button>
        );
      })}
      {!q.trim() && (
        <>
          <hr />
          <a class="mi" href="#/settings/labels" onClick={onDone}>{t('act.manageLabels')}</a>
        </>
      )}
    </>
  );
}

/** Filterable "Move to" list: Inbox, then user labels; Spam and Trash when not filtering. */
export function MoveList({ s, ids, onDone }: { s: AppState; ids: string[]; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const targets = [
    { id: 'INBOX', name: t('nav.inbox') },
    ...userLabels(s).filter((l) => !SYSTEM_LABELS.has(l.id)).map((l) => ({ id: l.id, name: l.name }))
  ].filter((x) => matches(x.name, q));
  const move = (id: string) => {
    if (id === 'INBOX') actions.moveToInbox(ids);
    else actions.moveTo(ids, id);
    onDone();
  };
  return (
    <>
      <FilterInput label={t('act.searchFolders')} value={q} onInput={setQ} count={targets.length} active={active} setActive={setActive} onPick={(i) => move(targets[i].id)} />
      {targets.map((x, i) => {
        const l = s.labels.find((y) => y.id === x.id);
        return (
          <button class={`mi ${i === active ? 'active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => move(x.id)}>
            {l ? (
              <span aria-hidden="true" style={{ width: '10px', height: '10px', borderRadius: '3px', background: labelColor(l), margin: '0 3px' }} />
            ) : (
              <Icon name="inbox" size={16} style={{ color: 'var(--c-inbox)' }} />
            )}
            <span class="ell">{x.name}</span>
          </button>
        );
      })}
      {!q.trim() && (
        <>
          <hr />
          <button class="mi" onClick={() => { actions.spam(ids); onDone(); }}>
            <Icon name="spam" size={16} style={{ color: 'var(--c-spam)' }} />
            {t('nav.spam')}
          </button>
          <button class="mi" onClick={() => { actions.trash(ids); onDone(); }}>
            <Icon name="trash" size={16} style={{ color: 'var(--c-trash)' }} />
            {t('nav.trash')}
          </button>
        </>
      )}
    </>
  );
}

export function LabelMenu({ s, ids, current }: { s: AppState; ids: string[]; current?: string[] }) {
  return (
    <Menu label={t('act.labelAs')} button={<CIcon name="label" />} shortcut="l">
      {(close) => (
        <>
          <div class="pop-h">{t('act.labelAs')}</div>
          <LabelList s={s} ids={ids} current={current} onDone={close} />
        </>
      )}
    </Menu>
  );
}

export function MoveMenu({ s, ids }: { s: AppState; ids: string[] }) {
  return (
    <Menu label={t('act.moveTo')} button={<CIcon name="move" />} shortcut="v">
      {(close) => (
        <>
          <div class="pop-h">{t('act.moveTo')}</div>
          <MoveList s={s} ids={ids} onDone={close} />
        </>
      )}
    </Menu>
  );
}
