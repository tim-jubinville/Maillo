import { config } from './config';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void;
}

interface CodeClient {
  requestCode(): void;
}

interface GoogleOAuth2 {
  initTokenClient(cfg: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type: string; message?: string }) => void;
    login_hint?: string;
    include_granted_scopes?: boolean;
  }): TokenClient;
  initCodeClient(cfg: {
    client_id: string;
    scope: string;
    ux_mode: 'popup';
    callback: (r: { code?: string; error?: string; error_description?: string }) => void;
    error_callback?: (e: { type: string; message?: string }) => void;
    login_hint?: string;
    prompt?: string;
    include_granted_scopes?: boolean;
  }): CodeClient;
  revoke(token: string, done?: () => void): void;
}

declare global {
  interface Window {
    google?: { accounts: { oauth2: GoogleOAuth2 } };
  }
}

const SESSION_KEY = 'maillo.session';
const HINT_KEY = 'maillo.hint';

export const SCOPES = (() => {
  const s = [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.settings.basic',
    // Name and profile photo only, for the account button.
    'https://www.googleapis.com/auth/userinfo.profile'
  ];
  if (config.features.calendar) {
    s.push(
      'https://www.googleapis.com/auth/calendar.events.readonly',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      'https://www.googleapis.com/auth/calendar.calendars.readonly'
    );
  }
  if (config.features.tasks) s.push('https://www.googleapis.com/auth/tasks');
  // Google Workspace only, and an admin must allow it (domain-wide delegation); see docs/INSTALL.md.
  if (config.features.keep) s.push('https://www.googleapis.com/auth/keep');
  if (config.features.notes || config.features.syncSettings) s.push('https://www.googleapis.com/auth/drive.appdata');
  if (config.features.contactPhotos) {
    s.push(
      'https://www.googleapis.com/auth/contacts.readonly',
      'https://www.googleapis.com/auth/contacts.other.readonly',
      'https://www.googleapis.com/auth/directory.readonly'
    );
  }
  return s;
})();

interface Session {
  token: string;
  expiresAt: number;
}

let session: Session | null = readSession();
let client: TokenClient | null = null;
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;
const listeners = new Set<() => void>();

function readSession(): Session | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null') as Session | null;
    return s && s.expiresAt > Date.now() + 60_000 ? s : null;
  } catch {
    return null;
  }
}

function writeSession(s: Session | null) {
  session = s;
  if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else sessionStorage.removeItem(SESSION_KEY);
  listeners.forEach((l) => l());
}

export function onAuthChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function currentToken(): string | null {
  return session && session.expiresAt > Date.now() + 30_000 ? session.token : null;
}

export function tokenExpiresSoon(): boolean {
  return !!session && session.expiresAt - Date.now() < 5 * 60_000;
}

export function rememberAccount(email: string) {
  localStorage.setItem(HINT_KEY, email);
}

function loadScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-gsi]');
    const el = existing ?? document.createElement('script');
    el.addEventListener('load', () => resolve());
    el.addEventListener('error', () => reject(new Error('Google sign-in could not load.')));
    if (!existing) {
      el.src = 'https://accounts.google.com/gsi/client';
      el.async = true;
      el.dataset.gsi = '1';
      document.head.appendChild(el);
    }
  });
}

export async function prepareAuth(): Promise<void> {
  if (config.demo || !config.googleClientId) return;
  const ready = staySignedIn() ? sessionCall({ action: 'ready' }).then((r) => (serverReady = !!(r.ok && r.configured))) : undefined;
  await loadScript();
  await ready;
  client = window.google!.accounts.oauth2.initTokenClient({
    client_id: config.googleClientId,
    scope: SCOPES.join(' '),
    include_granted_scopes: true,
    callback: (r) => {
      const p = pending;
      pending = null;
      if (r.error || !r.access_token) {
        p?.reject(new Error(r.error_description || r.error || 'auth_failed'));
        return;
      }
      writeSession({ token: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 });
      p?.resolve(r.access_token);
    },
    error_callback: (e) => {
      const p = pending;
      pending = null;
      p?.reject(new Error(e.type || 'auth_failed'));
    }
  });
}

// ---- Staying signed in (features.staySignedIn, through public/session.php) ----

export const staySignedIn = () => config.features.staySignedIn && !config.demo;
let renewTimer: number | undefined;
/** Whether this device has a server session (so tokens renew without a Google popup). */
let serverSession = false;

export interface SessionReply {
  ok: boolean;
  error?: string;
  access_token?: string;
  expires_in?: number;
  persistent?: boolean;
  configured?: boolean;
  source?: 'stored' | 'environment';
  writable?: boolean;
  crypto?: boolean;
}

export async function sessionCall(fields: Record<string, string>, withToken = false): Promise<SessionReply> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (withToken && session) form.append('token', session.token);
  let res: Response;
  try {
    res = await fetch('./session.php', { method: 'POST', body: form, credentials: 'same-origin', headers: { 'X-Maillo': '1' } });
  } catch {
    return { ok: false, error: 'network' };
  }
  try {
    return (await res.json()) as SessionReply;
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}

function useServerToken(r: SessionReply): boolean {
  if (!r.ok || !r.access_token) return false;
  writeSession({ token: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 });
  scheduleRenew();
  return true;
}

// Fetch a fresh token a few minutes before this one runs out; no popup needed.
function scheduleRenew() {
  clearTimeout(renewTimer);
  if (!serverSession || !session) return;
  const wait = Math.max(30_000, session.expiresAt - Date.now() - 5 * 60_000);
  renewTimer = window.setTimeout(() => {
    renewFromServer().catch(() => undefined);
  }, wait);
}

let renewing: Promise<boolean> | null = null;

/** A new access token from this device's server session. False when there is none (or it ended). */
export function renewFromServer(): Promise<boolean> {
  if (!staySignedIn()) return Promise.resolve(false);
  if (renewing) return renewing;
  renewing = (async () => {
    const r = await sessionCall({ action: 'token' });
    serverSession = !!r.ok;
    // Offline or a server hiccup: keep the session and try again in a minute.
    if (!r.ok && (r.error === 'network' || r.error === 'google_unreachable')) {
      serverSession = true;
      clearTimeout(renewTimer);
      renewTimer = window.setTimeout(() => renewFromServer().catch(() => undefined), 60_000);
      return false;
    }
    return useServerToken(r);
  })().finally(() => {
    renewing = null;
  });
  return renewing;
}

export function hasServerSession() {
  return serverSession;
}

let codeClient: CodeClient | null = null;
let codePending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

function initCode(hint?: string) {
  codeClient = window.google!.accounts.oauth2.initCodeClient({
    client_id: config.googleClientId,
    scope: SCOPES.join(' '),
    ux_mode: 'popup',
    include_granted_scopes: true,
    login_hint: hint,
    // Google only hands out a refresh token when consent is shown, so each device can get its own.
    prompt: hint ? 'consent' : 'select_account consent',
    callback: async (r) => {
      const p = codePending;
      codePending = null;
      if (r.error || !r.code) return p?.reject(new Error(r.error_description || r.error || 'auth_failed'));
      const res = await sessionCall({ action: 'exchange', code: r.code });
      if (!res.ok || !res.access_token) return p?.reject(new Error(res.error || 'auth_failed'));
      serverSession = !!res.persistent;
      useServerToken(res);
      p?.resolve(res.access_token);
    },
    error_callback: (e) => {
      const p = codePending;
      codePending = null;
      p?.reject(new Error(e.type || 'auth_failed'));
    }
  });
}

/** Signs in through session.php so this device stays signed in. Rejects with "no_secret" if the server isn't set up. */
function signInWithCode(switchAccount: boolean): Promise<string> {
  codePending?.reject(new Error('superseded'));
  initCode(switchAccount ? undefined : localStorage.getItem(HINT_KEY) || undefined);
  return new Promise((resolve, reject) => {
    codePending = { resolve, reject };
    codeClient!.requestCode();
  });
}

export function signIn(opts: { switchAccount?: boolean } = {}): Promise<string> {
  if (!client) return Promise.reject(new Error('auth_not_ready'));
  // Signed in on the server already: no popup needed.
  if (serverSession && !opts.switchAccount) {
    return renewFromServer().then((ok) => (ok && session ? session.token : signInPopup(opts)));
  }
  // Without the client secret on the server (or without PHP), sign-in is the hourly kind.
  if (staySignedIn() && serverReady) return signInWithCode(!!opts.switchAccount);
  return signInPopup(opts);
}

/** Lets Settings switch to the lasting sign-in as soon as the secret is saved. */
export function setServerReady(v: boolean) {
  serverReady = v;
}

let serverReady: boolean | undefined;

function signInPopup(opts: { switchAccount?: boolean } = {}): Promise<string> {
  if (!client) return Promise.reject(new Error('auth_not_ready'));
  pending?.reject(new Error('superseded'));
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    const hint = opts.switchAccount ? undefined : localStorage.getItem(HINT_KEY) || undefined;
    client!.requestAccessToken({
      prompt: opts.switchAccount ? 'select_account' : hint ? '' : 'select_account',
      login_hint: hint
    });
  });
}

export async function signOut(): Promise<void> {
  const token = session?.token;
  clearTimeout(renewTimer);
  const ending = serverSession ? sessionCall({ action: 'signout' }) : undefined;
  serverSession = false;
  writeSession(null);
  localStorage.removeItem(HINT_KEY);
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token);
  await ending;
}

export function dropSession() {
  writeSession(null);
}
