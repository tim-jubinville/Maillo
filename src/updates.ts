import { currentToken } from './auth';
import { config, isNative } from './config';

export interface UpdaterStatus {
  ok: boolean;
  error?: string | null;
  version?: string;
  php?: string;
  zip?: boolean;
  writable?: boolean;
  maxUpload?: number;
  account?: string;
  backups?: { id: string; version: string }[];
  path?: string;
  current?: string;
  updateCheck?: boolean;
  updateChannel?: 'stable' | 'beta';
}

export interface UpdateCheck {
  ok: boolean;
  error?: string | null;
  enabled?: boolean;
  current?: string;
  latest?: string;
  url?: string;
  published?: string;
  available?: boolean;
  canInstall?: boolean;
  checked?: number;
  prerelease?: boolean;
  channel?: 'stable' | 'beta';
}

/** POST to update.php with the current Google token. Resolves with its JSON reply, or { ok: false, error: 'unavailable' }. */
export function callUpdater<T extends { ok: boolean; error?: string | null } = UpdaterStatus>(form: FormData, onProgress?: (pct: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const token = currentToken();
    if (!token) return reject(new Error('invalid_token'));
    form.append('token', token);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', './update.php');
    xhr.responseType = 'text';
    if (onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      try {
        resolve(JSON.parse(xhr.responseText) as T);
      } catch {
        resolve({ ok: false, error: 'unavailable' } as T);
      }
    };
    xhr.onerror = () => reject(new Error('network'));
    xhr.send(form);
  });
}

/** Asks the server whether a newer release is out (the server caches GitHub's answer for 12 hours). */
export async function checkForUpdate(force = false): Promise<UpdateCheck> {
  // The iOS app updates through TestFlight, not update.php.
  if (config.demo || isNative) return { ok: true, enabled: false };
  const f = new FormData();
  f.append('action', 'check');
  if (force) f.append('force', '1');
  try {
    return await callUpdater<UpdateCheck>(f);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network' };
  }
}
