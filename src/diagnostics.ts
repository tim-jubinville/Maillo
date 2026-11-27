/**
 * "Copy diagnostics": a plain-text summary for bug reports. Versions, browser and yes/no answers only,
 * never addresses, message content, keys or the values in maillo-config.php.
 */
import { currentToken, hasServerSession } from './auth';
import { config, isNative, setup } from './config';
import { locale } from './i18n';
import { permission } from './notify';
import { pushActive } from './push';
import { isStandalone } from './pwa';
import { isDark } from './theme';

declare const __APP_VERSION__: string;

interface ServerDiag {
  ok: boolean;
  error?: string;
  release?: string;
  php?: string;
  server?: string;
  extensions?: Record<string, boolean>;
  checks?: Record<string, boolean>;
  features?: Record<string, boolean>;
  clientSecret?: boolean;
  pushTopic?: boolean;
  apns?: boolean;
  apnsKey?: boolean;
  http2?: boolean;
  updateCheck?: boolean;
  updateChannel?: string;
}

const yes = (v: boolean | undefined) => (v === undefined ? '?' : v ? 'yes' : 'no');

/** The items that are on, or "none". */
const on = (m: Record<string, boolean> | undefined) => {
  const list = Object.entries(m ?? {}).filter(([, v]) => v).map(([k]) => k);
  return list.length ? list.join(', ') : 'none';
};

const missing = (m: Record<string, boolean> | undefined) => {
  const list = Object.entries(m ?? {}).filter(([, v]) => !v).map(([k]) => k);
  return list.length ? `missing: ${list.join(', ')}` : 'all OK';
};

async function serverDiag(): Promise<ServerDiag> {
  const token = currentToken();
  if (!token || config.demo || isNative) return { ok: false, error: config.demo ? 'demo' : isNative ? 'app' : 'signed_out' };
  const form = new FormData();
  form.set('action', 'diagnostics');
  form.set('token', token);
  try {
    const r = await fetch('./config.php', { method: 'POST', body: form, credentials: 'same-origin' });
    return ((await r.json().catch(() => null)) as ServerDiag | null) ?? { ok: false, error: `http_${r.status}` };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** The report, in English so it reads the same for whoever handles the issue. */
export async function diagnostics(): Promise<string> {
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '?';
  const lines = [
    `Maillo diagnostics, ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    '',
    `App: ${version}${isNative ? ' (iOS app)' : config.demo ? ' (demo)' : ''}`,
    `Browser: ${navigator.userAgent}`,
    `Screen: ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x, ${isDark() ? 'dark' : 'light'} mode`,
    `Language: app ${locale()}, browser ${navigator.language}`,
    `Installed as an app: ${yes(isStandalone())}`,
    `Notifications: ${permission()}, push on this device: ${yes(pushActive())}`,
    `Stays signed in on this device: ${yes(hasServerSession())}`,
    `Features: ${on(config.features as unknown as Record<string, boolean>)}`
  ];
  if (setup && !setup.ready) {
    // Still on the setup checklist: config.php already said what's missing.
    lines.push('', `Setup checklist: ${missing(setup.checks)}`);
    return lines.join('\n');
  }
  const s = await serverDiag();
  lines.push('');
  if (!s.ok) {
    lines.push(`Server: not available (${s.error ?? 'unknown'})`);
  } else {
    lines.push(
      `Server: PHP ${s.php}, ${s.server}, release ${s.release || '?'}`,
      `PHP extensions: ${on(s.extensions)}${Object.values(s.extensions ?? {}).some((v) => !v) ? ` (${missing(s.extensions)})` : ''}`,
      `Setup checklist: ${missing(s.checks)}`,
      `Server features: ${on(s.features)}`,
      `Client secret set: ${yes(s.clientSecret)}, Pub/Sub topic set: ${yes(s.pushTopic)}`,
      `iOS push (APNs) set: ${yes(s.apns)}, key uploaded: ${yes(s.apnsKey)}, curl HTTP/2: ${yes(s.http2)}`,
      `Updates: ${s.updateCheck ? `on, ${s.updateChannel} channel` : 'off'}`
    );
  }
  return lines.join('\n');
}

/**
 * Copies the report and returns it, with whether the copy worked. Safari only allows copying during the
 * click itself, so where ClipboardItem exists the text is handed over as a promise.
 */
export async function copyDiagnostics(): Promise<{ text: string; copied: boolean }> {
  const pending = diagnostics();
  let copied = false;
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': pending.then((t) => new Blob([t], { type: 'text/plain' })) })]);
    } else {
      await navigator.clipboard.writeText(await pending);
    }
    copied = true;
  } catch {
    copied = false;
  }
  return { text: await pending, copied };
}
