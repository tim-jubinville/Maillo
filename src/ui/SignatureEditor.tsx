import DOMPurify from 'dompurify';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { Icon } from './Icon';

const clean = (html: string) => DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'meta', 'link'] });

/** Rich-text signature editor, with a switch to edit the HTML directly. */
export function SignatureEditor({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (html: string) => void }) {
  const ed = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState(false);

  // The editable area is uncontrolled: only load the value when it first appears or when leaving HTML mode.
  useEffect(() => {
    if (!source && ed.current) ed.current.innerHTML = clean(value);
  }, [source, id]);

  const emit = () => ed.current && onChange(ed.current.innerHTML);
  const exec = (cmd: string, arg?: string) => {
    ed.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };

  return (
    <div class="sig-box">
      <div class="sig-bar" role="toolbar" aria-label={label}>
        <button type="button" class="ib sm" disabled={source} aria-label={t('compose.bold')} title={t('compose.bold')} onClick={() => exec('bold')}><Icon name="bold" /></button>
        <button type="button" class="ib sm" disabled={source} aria-label={t('compose.italic')} title={t('compose.italic')} onClick={() => exec('italic')}><Icon name="italic" /></button>
        <button type="button" class="ib sm" disabled={source} aria-label={t('compose.underline')} title={t('compose.underline')} onClick={() => exec('underline')}><Icon name="underline" /></button>
        <button
          type="button"
          class="ib sm"
          disabled={source}
          aria-label={t('compose.link')}
          title={t('compose.link')}
          onClick={() => {
            const url = prompt(t('compose.linkPrompt'), 'https://');
            if (url && /^(https?:|mailto:|tel:)/i.test(url)) exec('createLink', url);
          }}
        >
          <Icon name="link" />
        </button>
        <button type="button" class="ib sm" disabled={source} aria-label={t('compose.clear')} title={t('compose.clear')} onClick={() => exec('removeFormat')}><Icon name="clearFormat" /></button>
        <button
          type="button"
          class="ib sm sig-src"
          aria-pressed={source}
          aria-label={t('settings.signatureHtml')}
          title={t('settings.signatureHtml')}
          onClick={() => {
            if (!source) emit();
            setSource(!source);
          }}
        >
          <Icon name="code" />
        </button>
      </div>
      {source ? (
        <textarea id={id} class="sig-code" aria-label={label} spellcheck={false} value={value} onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)} />
      ) : (
        <div
          id={id}
          ref={ed}
          class="sig-ed"
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          onInput={emit}
          onPaste={(e) => {
            const html = e.clipboardData?.getData('text/html');
            if (!html) return;
            e.preventDefault();
            document.execCommand('insertHTML', false, clean(html));
            emit();
          }}
        />
      )}
    </div>
  );
}
