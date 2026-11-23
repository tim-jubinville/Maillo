// Notifications while Maillo is closed (features.push): this device's web push subscription, kept by push.php.
import { currentToken } from './auth';
import { config } from './config';
import { lang } from './i18n';
import { getPrefs, onPrefs } from './prefs';
import { swRegistration } from './pwa';

const FLAG = 'maillo.push';

export interface PushStatus {
  ok: boolean;
  error?: string;
  detail?: string;
  topic?: boolean;
  staySignedIn?: boolean;
  vapidPublic?: string;
  endpoint?: string;
  renewUrl?: string;
  device?: boolean;
  devices?: number;
  expiration?: number;
  watchError?: string;
  tokenError?: boolean;
  crypto?: boolean;
}

export const pushSupported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Whether this device gets pushed notifications, so the open page doesn't notify a second time. */
export function pushActive(): boolean {
  return config.features.push && localStorage.getItem(FLAG) === '1';
}

async function call(fields: Record<string, string>): Promise<PushStatus> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set('token', currentToken() ?? '');
  try {
    const r = await fetch('./push.php', { method: 'POST', body: form, credentials: 'same-origin' });
    const j = (await r.json().catch(() => null)) as PushStatus | null;
    return j ?? { ok: false, error: r.status === 404 ? 'unavailable' : `http_${r.status}` };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** The device's rules from Settings → Notifications, plus what push.php needs to apply them. */
function rules(): string {
  const n = getPrefs().notify;
  return JSON.stringify({ ...n, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, lang });
}

async function subscription(): Promise<PushSubscription | null> {
  const reg = await swRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function pushStatus(): Promise<PushStatus> {
  const sub = await subscription().catch(() => null);
  const s = await call({ action: 'status', endpoint: sub?.endpoint ?? '' });
  // Subscribed here but forgotten by the server (or the other way round): the flag follows the server.
  if (s.ok) {
    if (s.device && sub) localStorage.setItem(FLAG, '1');
    else localStorage.removeItem(FLAG);
  }
  return s;
}

function keyBytes(b64url: string): Uint8Array {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export async function enablePush(vapidPublic: string): Promise<PushStatus> {
  if ((await Notification.requestPermission()) !== 'granted') return { ok: false, error: 'permission' };
  const reg = await swRegistration();
  if (!reg) return { ok: false, error: 'no_worker' };
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another key (a different install on this address) can't be reused.
  const own = sub?.options.applicationServerKey;
  if (sub && own && btoa(String.fromCharCode(...new Uint8Array(own))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== vapidPublic) {
    await sub.unsubscribe().catch(() => undefined);
    sub = null;
  }
  try {
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublic) as BufferSource });
  } catch {
    return { ok: false, error: 'subscribe_failed' };
  }
  const r = await call({ action: 'subscribe', subscription: JSON.stringify(sub.toJSON()), prefs: rules() });
  if (r.ok) localStorage.setItem(FLAG, '1');
  return r;
}

export async function disablePush(): Promise<PushStatus> {
  const sub = await subscription().catch(() => null);
  localStorage.removeItem(FLAG);
  const r = sub ? await call({ action: 'unsubscribe', endpoint: sub.endpoint }) : { ok: true };
  await sub?.unsubscribe().catch(() => undefined);
  return r;
}

export async function testPush(): Promise<PushStatus> {
  const sub = await subscription().catch(() => null);
  if (!sub) return { ok: false, error: 'not_subscribed' };
  return call({ action: 'test', endpoint: sub.endpoint });
}

let syncTimer: number | undefined;
let lastRules = '';

/** Sends changed notification rules to push.php, so pushed notifications follow them too. */
export function initPushSync() {
  if (!config.features.push || config.demo) return;
  lastRules = rules();
  onPrefs(() => {
    if (!pushActive()) return;
    clearTimeout(syncTimer);
    syncTimer = window.setTimeout(async () => {
      const next = rules();
      if (next === lastRules) return;
      const sub = await subscription().catch(() => null);
      if (!sub || !currentToken()) return;
      const r = await call({ action: 'prefs', endpoint: sub.endpoint, prefs: next });
      if (r.ok) lastRules = next;
    }, 1500);
  });
}
