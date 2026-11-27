// Notifications while Maillo is closed (features.push), kept by push.php: in the browser, this device's web push
// subscription; in the iOS app, its APNs device token (sent through the web install set in pushServer).
import { currentToken, onAuthChange } from './auth';
import { config, isNative } from './config';
import { lang } from './i18n';
import { getPrefs, onPrefs } from './prefs';
import { swRegistration } from './pwa';
import { go, threadHash } from './route';

const FLAG = 'maillo.push';
// The iOS app's APNs token, as push.php knows this device ("apns:<token>").
const APNS = 'maillo.apnsToken';

declare const __NATIVE_BUILD__: boolean;
const native = (): Promise<typeof import('./native')> => (__NATIVE_BUILD__ ? import('./native') : Promise.reject(new Error('not_native')));

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
  apns?: boolean;
}

export const pushSupported = isNative || (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);

/** Whether this device gets pushed notifications, so the open page doesn't notify a second time. */
export function pushActive(): boolean {
  return config.features.push && localStorage.getItem(FLAG) === '1';
}

async function call(fields: Record<string, string>): Promise<PushStatus> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set('token', currentToken() ?? '');
  try {
    const r = isNative
      ? await fetch(`${config.pushServer}push.php`, { method: 'POST', body: form, credentials: 'omit' })
      : await fetch('./push.php', { method: 'POST', body: form, credentials: 'same-origin' });
    const j = (await r.json().catch(() => null)) as PushStatus | null;
    return j ?? { ok: false, error: r.status === 404 ? 'unavailable' : `http_${r.status}` };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** The device's rules from Settings → Notifications, plus what push.php needs to apply them. */
function rules(): string {
  const n = getPrefs().notify;
  return JSON.stringify({ ...n, badge: n.badge ? n.badgeCount : 'off', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, lang });
}

async function subscription(): Promise<PushSubscription | null> {
  const reg = await swRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** How push.php knows this device: the web push endpoint, or "apns:<token>" in the iOS app. */
async function deviceId(): Promise<string> {
  if (isNative) {
    const token = localStorage.getItem(APNS);
    return token ? `apns:${token}` : '';
  }
  return (await subscription().catch(() => null))?.endpoint ?? '';
}

export async function pushStatus(): Promise<PushStatus> {
  const id = await deviceId();
  const s = await call({ action: 'status', endpoint: id });
  // Set up here but forgotten by the server (or the other way round): the flag follows the server.
  if (s.ok) {
    if (s.device && id) localStorage.setItem(FLAG, '1');
    else localStorage.removeItem(FLAG);
  }
  return s;
}

function keyBytes(b64url: string): Uint8Array {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** The iOS app: asks iOS for a device token (and permission, when ask is true) and hands it to push.php. */
async function enableNative(ask: boolean): Promise<PushStatus> {
  const r = await (await native()).nativeRegisterPush(ask);
  if ('error' in r) return { ok: false, error: r.error };
  const previous = localStorage.getItem(APNS);
  const s = await call({ action: 'subscribe', apnsToken: r.token, env: r.env, prefs: rules() });
  if (!s.ok) return s;
  localStorage.setItem(APNS, r.token);
  localStorage.setItem(FLAG, '1');
  // A new token (after a reinstall or restore): the old one is of no use any more.
  if (previous && previous !== r.token) call({ action: 'unsubscribe', endpoint: `apns:${previous}` }).catch(() => undefined);
  return s;
}

export async function enablePush(vapidPublic: string): Promise<PushStatus> {
  if (isNative) return enableNative(true);
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
  const id = await deviceId();
  localStorage.removeItem(FLAG);
  const r = id ? await call({ action: 'unsubscribe', endpoint: id }) : { ok: true };
  if (isNative) {
    localStorage.removeItem(APNS);
    (await native()).nativeSetBadge(0);
  } else await (await subscription().catch(() => null))?.unsubscribe().catch(() => undefined);
  return r;
}

export async function testPush(): Promise<PushStatus> {
  const id = await deviceId();
  if (!id) return { ok: false, error: 'not_subscribed' };
  return call({ action: 'test', endpoint: id });
}

let syncTimer: number | undefined;
let lastRules = '';

/** Sends changed notification rules to push.php, so pushed notifications follow them too. */
export function initPushSync() {
  if (isNative) initNative();
  if (!config.features.push || config.demo) return;
  lastRules = rules();
  onPrefs(() => {
    if (!pushActive()) return;
    clearTimeout(syncTimer);
    syncTimer = window.setTimeout(async () => {
      const next = rules();
      if (next === lastRules) return;
      const id = await deviceId();
      if (!id || !currentToken()) return;
      const r = await call({ action: 'prefs', endpoint: id, prefs: next });
      if (r.ok) lastRules = next;
    }, 1500);
  });
}

/** The iOS app: tapping a notification opens its conversation, and the device token is refreshed at each launch. */
function initNative() {
  native()
    .then((m) => m.onNotificationTap((id) => id && go(threadHash({ view: 'mail', folder: 'inbox', category: 'primary' }, id))))
    .catch(() => undefined);
  if (!config.features.push || config.demo) return;
  let refreshed = false;
  const refresh = () => {
    if (refreshed || !currentToken() || !pushActive()) return;
    refreshed = true;
    // Never prompts: if notifications were turned off in iOS Settings, the device simply stays as it was.
    enableNative(false).catch(() => undefined);
  };
  onAuthChange(refresh);
  refresh();
}
