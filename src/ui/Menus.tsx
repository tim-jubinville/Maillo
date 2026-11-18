import { useState } from 'preact/hooks';
import { t } from '../i18n';
import { labelColor, SYSTEM_LABELS } from '../model';
import { actions, type AppState } from '../store';
import { Menu } from './common';
import { CIcon } from './ColorIcons';
import { Icon } from './Icon';

function userLabels(s: AppState) {
  return s.labels.filter((l) => l.type === 'user').sort((a, b) => a.name.localeCompare(b.name));
}

export function LabelMenu({ s, ids, current }: { s: AppState; ids: string[]; current?: string[] }) {
  const [q, setQ] = useState('');
  const rows = s.list.rows.filter((r) => ids.includes(r.id));
  const has = (id: string) => {
    if (current) return current.includes(id);
    return rows.length > 0 && rows.every((r) => r.labelIds.includes(id));
  };
  return (
    <Menu label={t('act.labelAs')} button={<CIcon name="label" />}>
      {(close) => (
        <>
          <div class="pop-h">{t('act.labelAs')}</div>
          <input type="search" placeholder={t('act.searchLabels')} aria-label={t('act.searchLabels')} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
          {userLabels(s)
            .filter((l) => l.name.toLowerCase().includes(q.toLowerCase()))
            .map((l) => {
              const on = has(l.id);
              return (
                <button
                  role="menuitemcheckbox"
                  aria-checked={on}
                  class="mi"
                  onClick={() => {
                    actions.label(ids, on ? [] : [l.id], on ? [l.id] : []);
                    close();
                  }}
                >
                  <Icon name={on ? 'check' : 'tag'} size={16} style={{ color: labelColor(l) }} />
                  <span class="ell">{l.name}</span>
                </button>
              );
            })}
          <hr />
          <a class="mi" href="#/settings/labels" onClick={close}>{t('act.manageLabels')}</a>
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
          <button class="mi" onClick={() => { actions.moveToInbox(ids); close(); }}>
            <Icon name="inbox" size={16} style={{ color: 'var(--c-inbox)' }} />
            {t('nav.inbox')}
          </button>
          {userLabels(s).filter((l) => !SYSTEM_LABELS.has(l.id)).map((l) => (
            <button class="mi" onClick={() => { actions.moveTo(ids, l.id); close(); }}>
              <span aria-hidden="true" style={{ width: '10px', height: '10px', borderRadius: '3px', background: labelColor(l), margin: '0 3px' }} />
              <span class="ell">{l.name}</span>
            </button>
          ))}
          <hr />
          <button class="mi" onClick={() => { actions.spam(ids); close(); }}>
            <Icon name="spam" size={16} style={{ color: 'var(--c-spam)' }} />
            {t('nav.spam')}
          </button>
          <button class="mi" onClick={() => { actions.trash(ids); close(); }}>
            <Icon name="trash" size={16} style={{ color: 'var(--c-trash)' }} />
            {t('nav.trash')}
          </button>
        </>
      )}
    </Menu>
  );
}

export function MoveItems({ s, ids }: { s: AppState; ids: string[] }) {
  return (
    <>
      <button class="mi" onClick={() => actions.moveToInbox(ids)}>
        <Icon name="inbox" size={16} style={{ color: 'var(--c-inbox)' }} />
        {t('nav.inbox')}
      </button>
      {userLabels(s).filter((l) => !SYSTEM_LABELS.has(l.id)).map((l) => (
        <button class="mi" onClick={() => actions.moveTo(ids, l.id)}>
          <span aria-hidden="true" style={{ width: '10px', height: '10px', borderRadius: '3px', background: labelColor(l), margin: '0 3px' }} />
          <span class="ell">{l.name}</span>
        </button>
      ))}
    </>
  );
}

export function LabelItems({ s, ids, current }: { s: AppState; ids: string[]; current: string[] }) {
  return (
    <>
      {userLabels(s).map((l) => {
        const on = current.includes(l.id);
        return (
          <button role="menuitemcheckbox" aria-checked={on} class="mi" onClick={() => actions.label(ids, on ? [] : [l.id], on ? [l.id] : [])}>
            <Icon name={on ? 'check' : 'tag'} size={16} style={{ color: labelColor(l) }} />
            <span class="ell">{l.name}</span>
          </button>
        );
      })}
    </>
  );
}
