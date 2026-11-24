import type { ComponentChildren, RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { AiError, aiErrorText } from '../ai';
import { proofread, writeDraft, type Draft, type Fix } from '../aiTasks';
import { htmlToText } from '../gmail/mime';
import { t, type StringKey } from '../i18n';
import { getState, type ComposeState } from '../store';
import { AiButton, AiIcon, type AiAction } from './AiButton';
import { Icon } from './Icon';

export type AiPanel = 'proof' | 'draft' | null;

// ---------- Reading and changing the editor ----------

interface Seg {
  node: Text;
  start: number;
}

const BLOCK = /^(DIV|P|LI|UL|OL|BLOCKQUOTE|H[1-6]|TR|TABLE|PRE)$/;

/**
 * The text the user wrote (signature left out), with a map back to the editor's text nodes. Block
 * ends become line breaks that map to no node, so a fix never spans two paragraphs. Non-breaking
 * spaces read as spaces (same length, so positions still line up).
 */
function editorText(root: HTMLElement): { text: string; segs: Seg[] } {
  let text = '';
  const segs: Seg[] = [];
  const walk = (n: Node) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === Node.TEXT_NODE) {
        segs.push({ node: c as Text, start: text.length });
        text += (c as Text).data.replace(/ /g, ' ');
      } else if (c.nodeType === Node.ELEMENT_NODE) {
        const el = c as HTMLElement;
        if (el.classList.contains('mm-signature')) continue;
        if (el.tagName === 'BR') {
          text += '\n';
          continue;
        }
        const block = BLOCK.test(el.tagName);
        if (block && text && !text.endsWith('\n')) text += '\n';
        walk(el);
        if (block && !text.endsWith('\n')) text += '\n';
      }
    }
  };
  walk(root);
  return { text, segs };
}

function rangeFor(root: HTMLElement, find: string): Range | null {
  if (!find || find.includes('\n')) return null;
  const { text, segs } = editorText(root);
  const i = text.indexOf(find);
  if (i < 0) return null;
  const j = i + find.length;
  const at = (pos: number, end: boolean) => {
    for (const s of segs) {
      const e = s.start + s.node.data.length;
      if (pos >= s.start && (end ? pos <= e : pos < e)) return { node: s.node, off: pos - s.start };
    }
    return null;
  };
  const a = at(i, false);
  const b = at(j, true);
  if (!a || !b) return null;
  const r = root.ownerDocument.createRange();
  r.setStart(a.node, a.off);
  r.setEnd(b.node, b.off);
  return r;
}

function select(root: HTMLElement, r: Range) {
  root.focus();
  const sel = root.ownerDocument.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const errorOf = (e: unknown) => aiErrorText(e instanceof AiError ? e.message : 'unavailable');

// ---------- Proofread ----------

export function ProofreadPanel({ editor, onChange, onClose }: { editor: RefObject<HTMLDivElement | null>; onChange: () => void; onClose: () => void }) {
  const [state, setState] = useState<'loading' | 'done' | 'error' | 'empty'>('loading');
  const [fixes, setFixes] = useState<Fix[]>([]);
  const [applied, setApplied] = useState(0);
  const [error, setError] = useState('');

  const check = async () => {
    const ed = editor.current;
    const text = ed ? editorText(ed).text.trim() : '';
    if (!text) {
      setState('empty');
      return;
    }
    setState('loading');
    setApplied(0);
    try {
      setFixes(await proofread(text));
      setState('done');
    } catch (e) {
      setError(errorOf(e));
      setState('error');
    }
  };
  useEffect(() => {
    check();
  }, []);

  // Each fix goes in through the editor's own typing, so Undo (and Ctrl/⌘ + Z) takes it back.
  const apply = (f: Fix): boolean => {
    const ed = editor.current;
    const r = ed && rangeFor(ed, f.find);
    if (!ed || !r) return false;
    select(ed, r);
    ed.ownerDocument.execCommand('insertText', false, f.replace);
    return true;
  };
  const accept = (f: Fix) => {
    apply(f);
    setFixes((l) => l.filter((x) => x !== f));
    setApplied((n) => n + 1);
    onChange();
  };
  const acceptAll = () => {
    let n = 0;
    for (const f of fixes) if (apply(f)) n++;
    setFixes([]);
    setApplied((a) => a + n);
    onChange();
  };
  const show = (f: Fix) => {
    const ed = editor.current;
    const r = ed && rangeFor(ed, f.find);
    if (!ed || !r) return;
    select(ed, r);
    (r.startContainer.parentElement ?? ed).scrollIntoView({ block: 'nearest' });
  };

  return (
    <Panel action="proofread" title={t('ai.proofTitle')} meta={state === 'done' && fixes.length ? t('ai.fixCount', { n: fixes.length }) : ''} onClose={onClose}
      actions={state === 'done' && fixes.length > 1 ? <button class="btn sm" onClick={acceptAll}>{t('ai.acceptAll')}</button> : null}>
      {state === 'loading' ? (
        <Loading />
      ) : state === 'error' ? (
        <div class="ai-error"><span>{error}</span><AiButton action="proofread" sm label={t('ai.retry')} onClick={check} /></div>
      ) : state === 'empty' ? (
        <p class="ai-note">{t('ai.emptyDraft')}</p>
      ) : fixes.length === 0 ? (
        <div class="ai-error">
          <span class="ai-note">{applied ? t('ai.allApplied') : t('ai.noFixes')}</span>
          <AiButton action="proofread" sm label={t('ai.checkAgain')} onClick={check} />
        </div>
      ) : (
        <ul class="ai-fixes">
          {fixes.map((f) => (
            <li>
              <button class="ai-fix-text" title={t('ai.showFix')} onClick={() => show(f)}>
                <del>{f.find}</del>
                <Icon name="arrowRight" size={13} />
                <ins>{f.replace}</ins>
              </button>
              {f.why && <span class="ai-why">{f.why}</span>}
              <span class="ai-fix-acts">
                <button class="btn sm" onClick={() => accept(f)}>{t('ai.accept')}</button>
                <button class="ib sm" aria-label={t('ai.skip')} title={t('ai.skip')} onClick={() => setFixes((l) => l.filter((x) => x !== f))}>
                  <Icon name="x" size={14} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ---------- Draft ----------

const QUICK: StringKey[] = ['ai.quick.yes', 'ai.quick.no', 'ai.quick.details', 'ai.quick.thanks'];

export function DraftPanel({
  c,
  editor,
  onInsert,
  onClose
}: {
  c: ComposeState;
  editor: RefObject<HTMLDivElement | null>;
  onInsert: (subject: string) => void;
  onClose: () => void;
}) {
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [versions, setVersions] = useState<Draft[]>([]);
  const [shown, setShown] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const reply = c.mode !== 'new';

  useEffect(() => area.current?.focus(), []);

  const run = async (instruction: string, another: boolean) => {
    const s = getState();
    const thread = c.threadId && s.open?.id === c.threadId ? s.open.messages.filter((m) => !m.labelIds.includes('DRAFT')) : [];
    const sendAs = s.sendAs.find((x) => x.sendAsEmail === c.from);
    const ed = editor.current;
    setBusy(true);
    setError('');
    try {
      const d = await writeDraft({
        instruction,
        thread,
        quoted: thread.length ? '' : htmlToText(c.quoted || ''),
        current: ed ? editorText(ed).text : '',
        from: { name: sendAs?.displayName ?? '', email: c.from },
        to: c.to,
        subject: c.subject,
        previous: another ? versions.map((v) => v.body) : []
      });
      const next = another ? [...versions, d] : [d];
      setVersions(next);
      setShown(next.length - 1);
    } catch (e) {
      setError(errorOf(e));
    }
    setBusy(false);
  };

  const insert = (d: Draft) => {
    const ed = editor.current;
    if (!ed) return;
    const doc = ed.ownerDocument;
    const sig = ed.querySelector('.mm-signature');
    const end = sig && sig.previousSibling?.nodeName === 'BR' ? sig.previousSibling : sig;
    const r = doc.createRange();
    r.setStart(ed, 0);
    if (end) r.setEndBefore(end);
    else r.setEnd(ed, ed.childNodes.length);
    const html = d.body
      .split(/\n{2,}/)
      .map((p) => `<div>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</div>`)
      .join('<div><br></div>');
    // An empty body is replaced; otherwise the draft goes after what's already written.
    if (r.toString().trim()) {
      r.collapse(false);
      select(ed, r);
      doc.execCommand('insertHTML', false, `<div><br></div>${html}<div><br></div>`);
    } else {
      select(ed, r);
      doc.execCommand('insertHTML', false, `${html}<div><br></div>`);
    }
    onInsert(d.subject);
  };

  const cur = versions[shown];
  return (
    <Panel action="draft" title={t('ai.draftTitle')} onClose={onClose}>
      <label class="sr-only" for={`ai-ask-${c.key}`}>{t('ai.draftPrompt')}</label>
      <textarea
        id={`ai-ask-${c.key}`}
        ref={area}
        class="ai-ask"
        rows={2}
        value={ask}
        placeholder={reply ? t('ai.draftPhReply') : t('ai.draftPhNew')}
        onInput={(e) => setAsk((e.target as HTMLTextAreaElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            e.stopPropagation();
            if (!busy) run(ask, false);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <div class="ai-row">
        {reply &&
          QUICK.map((k) => (
            <button class="chip" disabled={busy} onClick={() => { setAsk(t(k)); run(t(k), false); }}>{t(k)}</button>
          ))}
        <span style={{ flex: 1 }} />
        <AiButton action="draft" sm label={t('ai.write')} busyLabel={t('ai.drafting')} busy={busy && !versions.length} onClick={() => run(ask, false)} />
      </div>
      {error && <div class="ai-error"><span>{error}</span></div>}
      {busy && !versions.length && <Loading />}
      {cur && (
        <div class="ai-result" aria-live="polite" aria-busy={busy}>
          <div class="ai-draft-text">{cur.body}</div>
          <div class="ai-row">
            {versions.length > 1 && (
              <span class="ai-versions">
                <button class="ib sm" aria-label={t('ai.prevVersion')} title={t('ai.prevVersion')} disabled={shown === 0} onClick={() => setShown(shown - 1)}>
                  <Icon name="chevLeft" size={16} />
                </button>
                <span>{t('ai.version', { i: shown + 1, n: versions.length })}</span>
                <button class="ib sm" aria-label={t('ai.nextVersion')} title={t('ai.nextVersion')} disabled={shown === versions.length - 1} onClick={() => setShown(shown + 1)}>
                  <Icon name="chevRight" size={16} />
                </button>
              </span>
            )}
            <span style={{ flex: 1 }} />
            <AiButton action="draft" sm label={t('ai.another')} busyLabel={t('ai.drafting')} busy={busy} onClick={() => run(ask, true)} />
            <button class="btn sm primary" disabled={busy} onClick={() => insert(cur)}>{t('ai.insert')}</button>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---------- Shared bits ----------

function Panel({ action, title, meta, actions, onClose, children }: { action: AiAction; title: string; meta?: string; actions?: ComponentChildren; onClose: () => void; children: ComponentChildren }) {
  return (
    <section class="ai-panel" aria-label={title}>
      <div class="ai-card-head">
        <AiIcon action={action} size={18} />
        <span class="ai-card-title">{title}</span>
        {meta && <span class="ai-card-meta">{meta}</span>}
        <span style={{ flex: 1 }} />
        {actions}
        <button class="ib sm" aria-label={t('ai.close')} title={t('ai.close')} onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
      </div>
      {children}
    </section>
  );
}

function Loading() {
  return (
    <div class="ai-loading">
      <div class="skeleton" style={{ width: '88%' }} />
      <div class="skeleton" style={{ width: '64%' }} />
    </div>
  );
}
