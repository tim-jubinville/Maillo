import { currentToken } from './auth';
import { config } from './config';
import { t, type StringKey } from './i18n';

// Talks to public/ai.php, which holds the Gemini API key server-side.

export interface AiStatus {
  ok: boolean;
  error?: string;
  configured?: boolean;
  source?: 'stored' | 'environment' | 'config' | null;
  model?: string;
  used?: number;
  limit?: number;
  writable?: boolean;
}

export interface AiResult {
  ok: boolean;
  error?: string;
  text?: string;
  model?: string;
  usage?: { input: number; output: number };
}

export class AiError extends Error {}

async function call<T extends { ok: boolean; error?: string }>(fields: Record<string, string>): Promise<T> {
  const token = currentToken();
  if (!token) throw new AiError('invalid_token');
  const form = new FormData();
  form.append('token', token);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  let res: Response;
  try {
    res = await fetch('./ai.php', { method: 'POST', body: form });
  } catch {
    throw new AiError('network');
  }
  try {
    return (await res.json()) as T;
  } catch {
    return { ok: false, error: 'unavailable' } as T;
  }
}

export const aiEnabled = () => config.features.ai && !config.demo;
/** Whether the AI buttons show. Demo mode shows them too, with made-up answers. */
export const aiActionsOn = () => config.features.ai || config.demo;

/** The error message for an ai.php error code. */
export function aiErrorText(code?: string): string {
  const key = `ai.err.${code}` as StringKey;
  const known = t(key);
  return known === key ? t('ai.err.generic', { code: code ?? 'unknown' }) : known;
}

export const aiStatus = () => call<AiStatus>({ action: 'status' });
export const aiSetKey = (key: string) => call<AiStatus>({ action: 'set_key', key });
export const aiRemoveKey = () => call<AiStatus>({ action: 'remove_key' });

export async function aiGenerate(instructions: string, input: string, opts: { json?: boolean; temperature?: number } = {}): Promise<string> {
  const r = await call<AiResult>({
    action: 'generate',
    instructions,
    input,
    json: opts.json ? '1' : '',
    ...(opts.temperature !== undefined ? { temperature: String(opts.temperature) } : {})
  });
  if (!r.ok || typeof r.text !== 'string') throw new AiError(r.error || 'unavailable');
  return r.text;
}
