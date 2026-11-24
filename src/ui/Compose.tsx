import DOMPurify from 'dompurify';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { fileToBase64, htmlToText, parseAddressList, type Address } from '../gmail/mime';
import { t, type StringKey } from '../i18n';
import { sizeLabel } from '../model';
import { closeCompose, discardCompose, getState, saveDraft, sendCompose, signatureBlock, signatureHtml, toast, updateCompose, type AppState, type ComposeState } from '../store';
import { popInCompose, popOutCompose } from './Popout';
import { Avatar } from './common';
import { Icon } from './Icon';

const EMAIL = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;

export function Compose({ s, c }: { s: AppState; c: ComposeState }) {
  const editor = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [fmt, setFmt] = useState(true);
  const [showQuoted, setShowQuoted] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const htmlTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (editor.current) {
      editor.current.innerHTML = DOMPurify.sanitize(c.html);
      const target = c.to.length ? editor.current : editor.current.ownerDocument.getElementById(`to-${c.key}`);
      (target as HTMLElement | null)?.focus();
    }
    return () => {
      clearTimeout(saveTimer.current);
      clearTimeout(htmlTimer.current);
    };
  }, []);

  const scheduleSave = () => {
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveDraft(), 2500);
  };

  const patch = (p: Partial<ComposeState>) => {
    updateCompose(p);
    scheduleSave();
  };

  const syncHtml = (immediate = false) => {
    clearTimeout(htmlTimer.current);
    const run = () => editor.current && updateCompose({ html: editor.current.innerHTML });
    if (immediate) run();
    else htmlTimer.current = window.setTimeout(run, 300);
    scheduleSave();
  };

  // Switching the From address swaps in that address's signature (or removes it when it has none).
  const changeFrom = (from: string) => {
    const ed = editor.current;
    if (ed) {
      const inner = DOMPurify.sanitize(signatureHtml(from));
      const block = ed.querySelector<HTMLElement>('.mm-signature');
      if (block) {
        if (inner) block.innerHTML = inner;
        else {
          const prev = block.previousElementSibling;
          if (prev?.tagName === 'BR') prev.remove();
          block.remove();
        }
      } else if (inner) {
        const div = ed.ownerDocument.createElement('div');
        div.className = 'mm-signature';
        div.innerHTML = inner;
        ed.append(ed.ownerDocument.createElement('br'), div);
      }
    }
    patch({ from, ...(ed ? { html: ed.innerHTML } : {}) });
  };

  const exec = (cmd: string, value?: string) => {
    editor.current?.focus();
    // The editor may live in the pop-out window, which has its own document.
    (editor.current?.ownerDocument ?? document).execCommand(cmd, false, value);
    syncHtml();
  };

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    const added = await Promise.all(
      list.map(async (f, i) => ({ id: `${Date.now()}-${i}`, filename: f.name, mimeType: f.type || 'application/octet-stream', size: f.size, base64: await fileToBase64(f) }))
    );
    const cur = getState().compose;
    if (!cur || cur.key !== c.key) return;
    updateCompose({ attachments: [...cur.attachments, ...added] });
    scheduleSave();
  };

  const send = () => {
    syncHtml(true);
    clearTimeout(saveTimer.current);
    sendCompose();
  };

  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      syncHtml(true);
      closeCompose();
    }
  };

  const title = c.subject || t((c.mode === 'forward' ? 'compose.forward' : c.mode === 'reply' || c.mode === 'replyAll' ? 'compose.reply' : 'compose.new') as StringKey);
  const status = c.status === 'saving' ? t('compose.saving') : c.status === 'saved' ? t('compose.saved') : '';
  const fromOptions = s.sendAs.filter((x) => !x.verificationStatus || x.verificationStatus === 'accepted');

  return (
    <div
      class={`compose ${c.popout ? 'popped' : ''} ${c.maximized && !c.popout ? 'max' : ''} ${c.minimized && !c.popout ? 'min' : ''}`}
      role="dialog"
      aria-label={title}
      onKeyDown={onKey}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
      }}
    >
      <div class="compose-head" onDblClick={() => !c.popout && updateCompose({ minimized: !c.minimized })}>
        <b class="ell">{title}</b>
        {(!c.minimized || c.popout) && <span class="st" aria-live="polite">{status}</span>}
        {c.popout ? (
          <button class="ib sm" aria-label={t('compose.popIn')} title={t('compose.popIn')} onClick={() => { syncHtml(true); popInCompose(); }}>
            <Icon name="popIn" />
          </button>
        ) : (
          <>
            <button class="ib sm" aria-label={t('compose.minimize')} title={t('compose.minimize')} onClick={() => updateCompose({ minimized: !c.minimized, maximized: false })}>
              <Icon name={c.minimized ? 'chevUp' : 'minimize'} />
            </button>
            <button class="ib sm desk-only" aria-label={t('compose.popOut')} title={t('compose.popOut')} onClick={() => { syncHtml(true); if (!popOutCompose()) toast(t('compose.popupBlocked')); }}>
              <Icon name="external" />
            </button>
            <button class="ib sm desk-only" aria-label={t('compose.expand')} title={t('compose.expand')} onClick={() => updateCompose({ maximized: !c.maximized, minimized: false })}>
              <Icon name="maximize" />
            </button>
          </>
        )}
        <button class="ib sm" aria-label={t('compose.close')} title={t('compose.close')} onClick={() => { syncHtml(true); closeCompose(); }}>
          <Icon name="x" />
        </button>
      </div>

      <div style={{ display: c.minimized ? 'none' : 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {fromOptions.length > 1 && (
          <div class="field">
            <label for={`from-${c.key}`}>{t('compose.from')}</label>
            <select id={`from-${c.key}`} class="bare" value={c.from} onChange={(e) => changeFrom((e.target as HTMLSelectElement).value)}>
              {fromOptions.map((x) => (
                <option value={x.sendAsEmail}>{x.displayName ? `${x.displayName} <${x.sendAsEmail}>` : x.sendAsEmail}</option>
              ))}
            </select>
          </div>
        )}
        <RecipientField id={`to-${c.key}`} label={t('compose.to')} value={c.to} recent={s.recent} onChange={(to) => patch({ to })}>
          {!c.showCc && (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: '10px', fontSize: 'calc(13px * var(--ts, 1))' }}>
              <button onClick={() => updateCompose({ showCc: true })}>{t('compose.cc')}</button>
              <button onClick={() => updateCompose({ showCc: true })}>{t('compose.bcc')}</button>
            </span>
          )}
        </RecipientField>
        {c.showCc && <RecipientField id={`cc-${c.key}`} label={t('compose.cc')} value={c.cc} recent={s.recent} onChange={(cc) => patch({ cc })} />}
        {c.showCc && <RecipientField id={`bcc-${c.key}`} label={t('compose.bcc')} value={c.bcc} recent={s.recent} onChange={(bcc) => patch({ bcc })} />}
        <div class="field">
          <label for={`subj-${c.key}`}>{t('compose.subject')}</label>
          <input id={`subj-${c.key}`} class="bare" value={c.subject} onInput={(e) => patch({ subject: (e.target as HTMLInputElement).value })} />
        </div>

        <div
          ref={editor}
          class="editor"
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-label={t('compose.body')}
          spellcheck
          onInput={() => syncHtml()}
          onPaste={(e) => {
            const html = e.clipboardData?.getData('text/html');
            if (!html) return;
            e.preventDefault();
            (editor.current?.ownerDocument ?? document).execCommand('insertHTML', false, DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'meta', 'link'] }));
            syncHtml();
          }}
        />

        {c.quoted && (
          <div class="quoted">
            <button class="trim-btn" aria-label={t('compose.showQuoted')} title={t('compose.showQuoted')} aria-expanded={showQuoted} onClick={() => setShowQuoted(!showQuoted)}>···</button>
            {showQuoted && <div class="quoted-body" style={{ whiteSpace: 'pre-wrap', marginTop: '8px' }}>{htmlToText(c.quoted)}</div>}
          </div>
        )}

        {c.attachments.length > 0 && (
          <div class="c-atts">
            {c.attachments.map((a) => (
              <span class="c-att">
                <Icon name="clip" size={14} />
                <span class="ell">{a.filename}</span>
                <span style={{ color: 'var(--muted)', fontSize: 'calc(12px * var(--ts, 1))', flex: 'none' }}>{a.loading ? '…' : sizeLabel(a.size)}</span>
                <button class="ib sm" aria-label={t('compose.removeAttachment', { name: a.filename })} onClick={() => patch({ attachments: c.attachments.filter((x) => x.id !== a.id) })}>
                  <Icon name="x" size={14} />
                </button>
              </span>
            ))}
          </div>
        )}

        {fmt && (
          <div class="fmtbar" role="toolbar" aria-label="Formatting">
            <button class="ib" aria-label={t('compose.undo')} title={t('compose.undo')} onClick={() => exec('undo')}><Icon name="undo" /></button>
            <button class="ib" aria-label={t('compose.redo')} title={t('compose.redo')} onClick={() => exec('redo')}><Icon name="redo" /></button>
            <span class="sep" />
            <button class="ib" aria-label={t('compose.bold')} title={t('compose.bold')} onClick={() => exec('bold')}><Icon name="bold" /></button>
            <button class="ib" aria-label={t('compose.italic')} title={t('compose.italic')} onClick={() => exec('italic')}><Icon name="italic" /></button>
            <button class="ib" aria-label={t('compose.underline')} title={t('compose.underline')} onClick={() => exec('underline')}><Icon name="underline" /></button>
            <button class="ib" aria-label={t('compose.strike')} title={t('compose.strike')} onClick={() => exec('strikeThrough')}><Icon name="strike" /></button>
            <span class="sep" />
            <button class="ib" aria-label={t('compose.numbers')} title={t('compose.numbers')} onClick={() => exec('insertOrderedList')}><Icon name="listNum" /></button>
            <button class="ib" aria-label={t('compose.bullets')} title={t('compose.bullets')} onClick={() => exec('insertUnorderedList')}><Icon name="list" /></button>
            <button class="ib" aria-label={t('compose.quote')} title={t('compose.quote')} onClick={() => exec('formatBlock', 'blockquote')}><Icon name="quote" /></button>
            <button class="ib" aria-label={t('compose.clear')} title={t('compose.clear')} onClick={() => exec('removeFormat')}><Icon name="clearFormat" /></button>
          </div>
        )}

        <div class="compose-foot">
          <button class="sendbtn" onClick={send} title="Ctrl/⌘ + Enter">{t('compose.send')}</button>
          <button class="ib" aria-pressed={fmt} aria-label="Formatting" title="Formatting" onClick={() => setFmt(!fmt)} style={fmt ? { background: 'var(--hover)', color: 'var(--ink)' } : undefined}>
            <Icon name="italic" />
          </button>
          <button class="ib" style={{ color: 'var(--c-scheduled)' }} aria-label={t('compose.attach')} title={t('compose.attach')} onClick={() => fileInput.current?.click()}>
            <Icon name="clip" />
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const el = e.target as HTMLInputElement;
              if (el.files?.length) addFiles(el.files);
              el.value = '';
            }}
          />
          <button
            class="ib"
            style={{ color: 'var(--c-sent)' }}
            aria-label={t('compose.link')}
            title={t('compose.link')}
            onClick={() => {
              const url = prompt(t('compose.linkPrompt'), 'https://');
              if (url && /^(https?:|mailto:)/i.test(url)) exec('createLink', url);
            }}
          >
            <Icon name="link" />
          </button>
          {s.sendAs.find((x) => x.sendAsEmail === c.from)?.signature && (
            <button
              class="ib"
              style={{ color: 'var(--c-drafts)' }}
              aria-label={t('compose.signature')}
              title={t('compose.signature')}
              onClick={() => exec('insertHTML', `<div class="mm-signature">${signatureBlock(DOMPurify.sanitize(s.sendAs.find((x) => x.sendAsEmail === c.from)!.signature!))}</div>`)}
            >
              <Icon name="signature" />
            </button>
          )}
          <button class="ib" style={{ marginLeft: 'auto', color: 'var(--c-trash)' }} aria-label={t('compose.discard')} title={t('compose.discard')} onClick={discardCompose}>
            <Icon name="trash" />
          </button>
        </div>
      </div>
    </div>
  );
}

function RecipientField({
  id,
  label,
  value,
  recent,
  onChange,
  children
}: {
  id: string;
  label: string;
  value: Address[];
  recent: Address[];
  onChange: (v: Address[]) => void;
  children?: ComponentChildren;
}) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const q = text.trim().toLowerCase();
  const taken = new Set(value.map((a) => a.email.toLowerCase()));
  const suggestions = q
    ? recent.filter((a) => !taken.has(a.email.toLowerCase()) && (a.email.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))).slice(0, 6)
    : [];

  const commit = (raw = text) => {
    const parsed = parseAddressList(raw).filter((a) => a.email);
    if (parsed.length) onChange([...value, ...parsed.filter((a) => !taken.has(a.email.toLowerCase()))]);
    setText('');
    setActive(0);
  };

  return (
    <div class="field">
      <label for={id}>{label}</label>
      {value.map((a) => (
        <span class={`rchip ${EMAIL.test(a.email) ? '' : 'bad'}`} title={a.email}>
          <Avatar a={a} size="sm" />
          <span class="ell">{a.name || a.email}</span>
          <button aria-label={t('compose.removeRecipient', { name: a.name || a.email })} onClick={() => onChange(value.filter((x) => x !== a))}>
            <Icon name="x" size={12} />
          </button>
        </span>
      ))}
      <input
        id={id}
        class="bare"
        value={text}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={suggestions.length > 0}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          if (/[,;]\s*$/.test(v)) commit(v);
          else setText(v);
        }}
        onKeyDown={(e) => {
          if (suggestions.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
          } else if ((e.key === 'Enter' || e.key === 'Tab') && text.trim()) {
            if (e.key === 'Enter') e.preventDefault();
            const pick = suggestions[active];
            if (pick) {
              e.preventDefault();
              onChange([...value, pick]);
              setText('');
            } else commit();
          } else if (e.key === 'Backspace' && !text && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => setTimeout(() => text.trim() && commit(), 120)}
        onPaste={(e) => {
          const v = e.clipboardData?.getData('text') ?? '';
          if (/[,;\n]/.test(v)) {
            e.preventDefault();
            commit(v.replace(/\n/g, ','));
          }
        }}
      />
      {children}
      {suggestions.length > 0 && (
        <div class="suggest" role="listbox">
          {suggestions.map((a, i) => (
            <button
              role="option"
              aria-selected={i === active}
              class={`mi ${i === active ? 'active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange([...value, a]);
                setText('');
              }}
            >
              <Avatar a={a} size="sm" />
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span class="ell">{a.name || a.email}</span>
                {a.name && <span class="ell" style={{ fontSize: 'calc(12px * var(--ts, 1))', color: 'var(--muted)' }}>{a.email}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
