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

/** Filter field that takes focus when its list appears. Enter picks the first match, ↓ moves into the list. */
function FilterInput({ label, value, onInput, onEnter }: { label: string; value: string; onInput: (v: string) => void; onEnter: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <input
      ref={ref}
      type="search"
      placeholder={label}
      aria-label={label}
      value={value}
      onInput={(e) => onInput((e.target as HTMLInputElement).value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onEnter();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          (e.currentTarget.parentElement?.querySelector('.mi') as HTMLElement | null)?.focus();
        }
      }}
    />
  );
}

/** Filterable "Label as" list. `current` is the thread's labels; without it, a label counts as on when every selected row has it. */
export function LabelList({ s, ids, current, onDone }: { s: AppState; ids: string[]; current?: string[]; onDone: () => void }) {
  const [q, setQ] = useState('');
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
      <FilterInput label={t('act.searchLabels')} value={q} onInput={setQ} onEnter={() => list[0] && toggle(list[0].id)} />
      {list.map((l) => {
        const on = has(l.id);
        return (
          <button role="menuitemcheckbox" aria-checked={on} class="mi" onClick={() => toggle(l.id)}>
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
      <FilterInput label={t('act.searchFolders')} value={q} onInput={setQ} onEnter={() => targets[0] && move(targets[0].id)} />
      {targets.map((x) => {
        const l = s.labels.find((y) => y.id === x.id);
        return (
          <button class="mi" onClick={() => move(x.id)}>
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
    <Menu label={t('act.labelAs')} button={<CIcon name="label" />}>
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
    <Menu label={t('act.moveTo')} button={<CIcon name="move" />}>
      {(close) => (
        <>
          <div class="pop-h">{t('act.moveTo')}</div>
          <MoveList s={s} ids={ids} onDone={close} />
        </>
      )}
    </Menu>
  );
}
