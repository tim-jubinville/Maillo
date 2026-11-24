import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { config } from '../config';
import type { Sticky, StickyColor } from '../gmail/types';
import { t, type StringKey } from '../i18n';
import { renderMarkdown, toggleTodo } from '../markdown';
import {
  addSticky,
  discardEmpty,
  flushStickies,
  onStickies,
  pullStickies,
  removeSticky,
  restoreSticky,
  STICKY_COLORS,
  stickiesState,
  updateSticky
} from '../stickies';
import { toast } from '../store';
import { Icon } from './Icon';
import { PanelEmpty } from './SidePanel';

/** The Stickies side panel: coloured Markdown notes kept in Drive's app folder. */
export function Stickies() {
  const [st, setSt] = useState(stickiesState());
  const [editing, setEditing] = useState<string | null>(null);
  const on = config.features.stickies || config.demo;
  useEffect(() => {
    if (!on) return;
    const off = onStickies(() => setSt(stickiesState()));
    pullStickies();
    return () => {
      off();
      flushStickies();
    };
  }, []);
  if (!on) return <PanelEmpty icon="stickies" title={t('stickies.offTitle')} sub={t('stickies.off')} />;

  const create = () => {
    const s = addSticky();
    setEditing(s.id);
  };
  const list = st.stickies;
  return (
    <div class="stickies">
      <button class="stk-new" onClick={create}>
        <Icon name="plus" size={16} />
        {t('stickies.new')}
      </button>
      {st.error && !list && (
        <PanelEmpty icon="stickies" title={t('stickies.failedTitle')} sub={t('stickies.failed')}>
          <button class="btn sm" onClick={() => pullStickies(true)}>{t('list.retry')}</button>
        </PanelEmpty>
      )}
      {!st.error && !list && <div class="skeleton" style={{ margin: 0 }} />}
      {list?.length === 0 && <PanelEmpty icon="stickies" title={t('stickies.none')} sub={t('stickies.noneSub')} />}
      {list?.map((s) => (
        <StickyCard key={s.id} s={s} editing={editing === s.id} onEdit={(v) => setEditing(v ? s.id : null)} />
      ))}
    </div>
  );
}

function StickyCard({ s, editing, onEdit }: { s: Sticky; editing: boolean; onEdit: (on: boolean) => void }) {
  const [colors, setColors] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(() => {
    if (!editing) return;
    fit();
    const el = area.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const stop = () => {
    onEdit(false);
    discardEmpty(s.id);
  };
  const del = () => {
    removeSticky(s.id);
    if (s.text.trim()) toast(t('stickies.deleted'), { action: { label: t('toast.undo'), run: () => restoreSticky(s) } });
  };
  const onViewClick = (e: MouseEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest('a')) return;
    const box = el.closest<HTMLElement>('.todo-box');
    if (box) return updateSticky(s.id, { text: toggleTodo(s.text, Number(box.dataset.line)) });
    onEdit(true);
  };
  const onViewKey = (e: KeyboardEvent) => {
    const box = (e.target as HTMLElement).closest<HTMLElement>('.todo-box');
    if (!box || (e.key !== ' ' && e.key !== 'Enter')) return;
    e.preventDefault();
    const line = box.dataset.line;
    updateSticky(s.id, { text: toggleTodo(s.text, Number(line)) });
    // Keep focus on the same box once the sticky re-renders.
    requestAnimationFrame(() => (document.querySelector(`#stk-view-${s.id} .todo-box[data-line="${line}"]`) as HTMLElement | null)?.focus());
  };
  const label = t(`stickies.color.${s.color}` as StringKey);

  return (
    <div class={`stk stk-${s.color}${editing ? ' editing' : ''}`}>
      {editing ? (
        <>
          <label class="sr-only" for={`stk-${s.id}`}>{t('stickies.edit')}</label>
          <textarea
            id={`stk-${s.id}`}
            ref={area}
            class="stk-text"
            value={s.text}
            placeholder={t('stickies.placeholder')}
            onInput={(e) => {
              updateSticky(s.id, { text: (e.target as HTMLTextAreaElement).value });
              fit();
            }}
            onBlur={stop}
            onKeyDown={(e) => {
              if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
                e.preventDefault();
                e.stopPropagation();
                stop();
              }
            }}
          />
          <span class="stk-hint" aria-hidden="true">{t('stickies.hint')}</span>
        </>
      ) : (
        <div class="stk-md" id={`stk-view-${s.id}`} onClick={onViewClick} onKeyDown={onViewKey} dangerouslySetInnerHTML={{ __html: renderMarkdown(s.text) || `<p class="stk-empty">${t('stickies.empty')}</p>` }} />
      )}
      {!editing && (
        <div class="stk-tools">
          {colors ? (
            <div class="stk-swatches" role="group" aria-label={t('stickies.colour')}>
              {STICKY_COLORS.map((c: StickyColor) => (
                <button
                  class={`stk-swatch stk-${c}`}
                  aria-label={t(`stickies.color.${c}` as StringKey)}
                  aria-pressed={c === s.color}
                  title={t(`stickies.color.${c}` as StringKey)}
                  onClick={() => {
                    updateSticky(s.id, { color: c });
                    setColors(false);
                  }}
                />
              ))}
            </div>
          ) : (
            <>
              <button class="ib sm" aria-label={t('stickies.colourOf', { c: label })} title={t('stickies.colourOf', { c: label })} onClick={() => setColors(true)}>
                <span class={`stk-dot stk-${s.color}`} />
              </button>
              <button class="ib sm" aria-label={t('stickies.edit')} title={t('stickies.edit')} onClick={() => onEdit(true)}>
                <Icon name="pencil" size={15} />
              </button>
              <button class="ib sm" aria-label={t('stickies.delete')} title={t('stickies.delete')} onClick={del}>
                <Icon name="trash" size={15} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
