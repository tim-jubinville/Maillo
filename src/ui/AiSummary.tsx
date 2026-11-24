import { useEffect, useState } from 'preact/hooks';
import { AiError, aiErrorText } from '../ai';
import { summarize, type Summary } from '../aiTasks';
import type { Address, ParsedMessage } from '../gmail/mime';
import { t } from '../i18n';
import { AiButton, AiIcon } from './AiButton';
import { Icon } from './Icon';

// Summaries live in memory for this session only, per conversation, and are made only on request.
interface Entry {
  status: 'loading' | 'done' | 'error';
  /** The newest message when the summary was asked for: a newer one makes it stale. */
  lastId: string;
  data?: Summary;
  error?: string;
  detail?: string;
  hidden?: boolean;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

function useEntry(threadId: string): Entry | undefined {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  }, []);
  return entries.get(threadId);
}

async function run(threadId: string, msgs: ParsedMessage[], owner: Address) {
  const lastId = msgs[msgs.length - 1]?.id ?? '';
  entries.set(threadId, { status: 'loading', lastId });
  emit();
  try {
    entries.set(threadId, { status: 'done', lastId, data: await summarize(msgs, owner) });
  } catch (e) {
    entries.set(threadId, { status: 'error', lastId, error: e instanceof AiError ? e.message : 'unavailable', detail: e instanceof AiError ? e.detail : undefined });
  }
  emit();
}

function reveal() {
  requestAnimationFrame(() => document.querySelector('.ai-card')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}

/** Shows the summary again if one is current, otherwise asks for a new one. */
export function requestSummary(threadId: string, msgs: ParsedMessage[], owner: Address) {
  const e = entries.get(threadId);
  if (e?.status === 'loading') return;
  if (e?.status === 'done' && e.lastId === msgs[msgs.length - 1]?.id) {
    entries.set(threadId, { ...e, hidden: false });
    emit();
  } else run(threadId, msgs, owner);
  reveal();
}

export function SummarizeButton({ threadId, msgs, owner }: { threadId: string; msgs: ParsedMessage[]; owner: Address }) {
  const e = useEntry(threadId);
  return (
    <AiButton
      action="summarize"
      label={t('ai.summarize')}
      busyLabel={t('ai.summarizing')}
      busy={e?.status === 'loading'}
      onClick={() => requestSummary(threadId, msgs, owner)}
    />
  );
}

export function SummaryCard({ threadId, msgs, owner }: { threadId: string; msgs: ParsedMessage[]; owner: Address }) {
  const e = useEntry(threadId);
  if (!e || e.hidden) return null;
  const stale = e.status === 'done' && e.lastId !== msgs[msgs.length - 1]?.id;
  const close = () => {
    entries.set(threadId, { ...e, hidden: true });
    emit();
  };
  return (
    <section class="ai-card" aria-label={t('ai.summary')} aria-busy={e.status === 'loading'}>
      <div class="ai-card-head">
        <AiIcon action="summarize" size={18} />
        <span class="ai-card-title">{t('ai.summary')}</span>
        {stale && <span class="ai-card-meta">{t('ai.stale')}</span>}
        {stale && <AiButton action="summarize" sm label={t('ai.refresh')} onClick={() => run(threadId, msgs, owner)} />}
        <button class="ib sm" style={{ marginLeft: stale ? undefined : 'auto' }} aria-label={t('ai.close')} title={t('ai.close')} onClick={close}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <div aria-live="polite">
        {e.status === 'loading' ? (
          <div class="ai-loading">
            <div class="skeleton" style={{ width: '92%' }} />
            <div class="skeleton" style={{ width: '70%' }} />
            <div class="skeleton" style={{ width: '48%' }} />
          </div>
        ) : e.status === 'error' ? (
          <div class="ai-error">
            <span>{aiErrorText(e.error, e.detail)}</span>
            <AiButton action="summarize" sm label={t('ai.retry')} onClick={() => run(threadId, msgs, owner)} />
          </div>
        ) : (
          e.data && (
            <div class="ai-card-body">
              <p>{e.data.summary}</p>
              {e.data.points.length > 0 && (
                <ul>
                  {e.data.points.map((p) => (
                    <li>{p}</li>
                  ))}
                </ul>
              )}
              {e.data.asks.length > 0 && (
                <div class="ai-asks">
                  <span class="caps">{t('ai.asksYou')}</span>
                  <ul>
                    {e.data.asks.map((p) => (
                      <li>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )
        )}
      </div>
    </section>
  );
}
