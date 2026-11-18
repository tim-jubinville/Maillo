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

interface GoogleOAuth2 {
  initTokenClient(cfg: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type: string; message?: string }) => void;
    login_hint?: string;
    include_granted_scopes?: boolean;
  }): TokenClient;
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
    'https://www.googleapis.com/auth/gmail.settings.basic'
  ];
  if (config.features.calendar) s.push('https://www.googleapis.com/auth/calendar.events.readonly');
  if (config.features.tasks) s.push('https://www.googleapis.com/auth/tasks');
  if (config.features.notes) s.push('https://www.googleapis.com/auth/drive.appdata');
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
  await loadScript();
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

export function signIn(opts: { switchAccount?: boolean } = {}): Promise<string> {
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

export function signOut() {
  const token = session?.token;
  writeSession(null);
  localStorage.removeItem(HINT_KEY);
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token);
}

export function dropSession() {
  writeSession(null);
}
