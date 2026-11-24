import { useState } from 'preact/hooks';
import { copyDiagnostics } from '../diagnostics';
import { t } from '../i18n';
import { Icon } from './Icon';

/** Copies a bug-report summary and shows it, so people can see what they're sharing (and copy it by hand). */
export function DiagnosticsButton() {
  const [text, setText] = useState('');
  const [state, setStateMsg] = useState<'' | 'busy' | 'copied' | 'manual'>('');
  return (
    <div class="diag">
      <button
        class="btn sm"
        disabled={state === 'busy'}
        onClick={async () => {
          setStateMsg('busy');
          const r = await copyDiagnostics();
          setText(r.text);
          setStateMsg(r.copied ? 'copied' : 'manual');
        }}
      >
        <Icon name={state === 'copied' ? 'tick' : 'copy'} size={14} />
        {state === 'copied' ? t('diag.copied') : t('diag.copy')}
      </button>
      {state === 'manual' && <span class="diag-note" role="status">{t('diag.manual')}</span>}
      {text && <textarea class="textarea diag-text" readOnly rows={8} aria-label={t('diag.title')} value={text} onFocus={(e) => (e.target as HTMLTextAreaElement).select()} />}
    </div>
  );
}
