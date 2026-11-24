// The iOS app (Capacitor). Sign-in runs in the system's sign-in sheet (ASWebAuthenticationSession) with
// PKCE and the iOS OAuth client, which has no secret. The refresh token never reaches the web view:
// the native plugin (ios/App/App/MailloNativePlugin.swift) keeps it in the Keychain and hands out access tokens.
import { registerPlugin } from '@capacitor/core';

export interface NativeToken {
  access_token: string;
  expires_in: number;
}

interface MailloNativePlugin {
  /** Opens the sign-in sheet at url and resolves with the URL Google sends back to callbackScheme. */
  authorize(o: { url: string; callbackScheme: string }): Promise<{ url: string }>;
  /** Trades the code for tokens; keeps the refresh token in the Keychain. */
  exchange(o: { clientId: string; code: string; verifier: string; redirectUri: string }): Promise<NativeToken>;
  /** A new access token from the Keychain's refresh token. Rejects with "no_session", "ended" or "network". */
  refresh(o: { clientId: string }): Promise<NativeToken>;
  hasSession(): Promise<{ value: boolean }>;
  /** Removes the refresh token and asks Google to end it. */
  signOut(opts: { revoke: boolean }): Promise<void>;
}

const Native = registerPlugin<MailloNativePlugin>('MailloNative');

/** iOS clients sign in through a redirect to their client ID reversed (com.googleusercontent.apps.…). */
function redirectScheme(clientId: string): string {
  return clientId.split('.').reverse().join('.');
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Signs in with Google in the system sheet. Rejects with "superseded" if the person cancels. */
export async function nativeSignIn(clientId: string, scopes: string[], opts: { hint?: string; switchAccount?: boolean }): Promise<NativeToken> {
  const scheme = redirectScheme(clientId);
  const redirectUri = `${scheme}:/oauth2redirect`;
  const verifier = randomString();
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = randomString();
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    include_granted_scopes: 'true'
  });
  if (opts.switchAccount || !opts.hint) q.set('prompt', 'select_account');
  else q.set('login_hint', opts.hint);
  let back: URL;
  try {
    back = new URL((await Native.authorize({ url: `https://accounts.google.com/o/oauth2/v2/auth?${q}`, callbackScheme: scheme })).url);
  } catch (e) {
    const m = message(e);
    throw new Error(/cancel/i.test(m) ? 'superseded' : m || 'auth_failed');
  }
  const p = back.searchParams;
  if (p.get('state') !== state) throw new Error('auth_failed');
  const code = p.get('code');
  if (!code) throw new Error(p.get('error') || 'auth_failed');
  return Native.exchange({ clientId, code, verifier, redirectUri });
}

export async function hasNativeSession(): Promise<boolean> {
  try {
    return (await Native.hasSession()).value;
  } catch {
    return false;
  }
}

/** A new access token. Null when there's no session or Google ended it; throws "network" when it can't tell. */
export async function nativeRefresh(clientId: string): Promise<NativeToken | null> {
  try {
    return await Native.refresh({ clientId });
  } catch (e) {
    const m = message(e);
    if (m === 'no_session' || m === 'ended') return null;
    throw new Error('network');
  }
}

export function nativeSignOut(revoke = false): Promise<void> {
  return Native.signOut({ revoke }).catch(() => undefined);
}
