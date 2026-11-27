// Haptics in the iOS app: archive, send, piles, pull to refresh and swipes. The web app stays silent,
// except for the long-press buzz on phones that support navigator.vibrate.
import type { HapticKind } from './native';

declare const __NATIVE_BUILD__: boolean;

let native: typeof import('./native') | undefined;
if (__NATIVE_BUILD__) import('./native').then((m) => (native = m)).catch(() => undefined);

/** A short tap. On the web, `webMs` vibrates for that long where supported; without it, nothing happens. */
export function haptic(kind: HapticKind, webMs?: number): void {
  if (__NATIVE_BUILD__) native?.nativeHaptic(kind);
  else if (webMs) navigator.vibrate?.(webMs);
}
