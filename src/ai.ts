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
  detail?: string;
  text?: string;
  model?: string;
  usage?: { input: number; output: number };
}

export class AiError extends Error {
  /** Extra words from Google or the server, shown after the message. */
  detail?: string;
  constructor(code: string, detail?: string) {
    super(code);
    this.detail = detail;
  }
}

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
  const body = await res.text().catch(() => '');
  try {
    return JSON.parse(body) as T;
  } catch {
    // Something printed before Maillo's own answer (an older install's PHP warnings): read the answer itself.
    const at = body.lastIndexOf('{"ok":');
    if (at >= 0) {
      try {
        return JSON.parse(body.slice(at)) as T;
      } catch {
        /* not Maillo's answer after all */
      }
    }
    // Not Maillo's answer: a firewall's or the server's own error page, or a missing file.
    const error = res.status === 403 || res.status === 406 || res.status === 501 ? 'blocked' : res.status >= 500 ? 'server_error' : 'unavailable';
    return { ok: false, error: error === 'unavailable' ? error : `${error}:${res.status}` } as T;
  }
}

/** UTF-8 text as base64, so firewalls on the host don't inspect (and block) email text and prompts. */
function b64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export const aiEnabled = () => config.features.ai && !config.demo;
/** Whether the AI buttons show. Demo mode shows them too, with made-up answers. */
export const aiActionsOn = () => config.features.ai || config.demo;

/** The error message for an ai.php error code. */
export function aiErrorText(code?: string, detail?: string): string {
  const [name, status = ''] = (code ?? '').split(':');
  const key = `ai.err.${name}` as StringKey;
  const known = t(key, { status });
  const text = known === key ? t('ai.err.generic', { code: code ?? 'unknown' }) : known;
  return detail ? `${text} (${detail})` : text;
}

export const aiStatus = () => call<AiStatus>({ action: 'status' });
export const aiSetKey = (key: string) => call<AiStatus>({ action: 'set_key', key });
export const aiRemoveKey = () => call<AiStatus>({ action: 'remove_key' });

export async function aiGenerate(instructions: string, input: string, opts: { json?: boolean; temperature?: number } = {}): Promise<string> {
  const r = await call<AiResult>({
    action: 'generate',
    enc: 'b64',
    instructions: b64(instructions),
    input: b64(input),
    json: opts.json ? '1' : '',
    ...(opts.temperature !== undefined ? { temperature: String(opts.temperature) } : {})
  });
  if (!r.ok || typeof r.text !== 'string') throw new AiError(r.error || 'unavailable', r.detail);
  return r.text;
}
