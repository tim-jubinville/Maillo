import { isNative } from './config';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallState = 'installed' | 'ready' | 'ios' | 'manual' | 'unsupported';

let deferred: InstallPromptEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function onInstallChange(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function isStandalone(): boolean {
  return isNative || installedNow || matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

const ua = navigator.userAgent;
const isIos = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua);
const isFirefox = /firefox|fxios/i.test(ua);

export function installState(): InstallState {
  if (isStandalone()) return 'installed';
  if (deferred) return 'ready';
  if (isIos) return 'ios';
  if (isSafari) return 'manual';
  if (isFirefox) return 'unsupported';
  return 'manual';
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  emit();
  return outcome === 'accepted';
}

let registration: Promise<ServiceWorkerRegistration | undefined> = Promise.resolve(undefined);

export function swRegistration() {
  return registration;
}

export function initPwa(onOpenThread: (threadId: string) => void, onNewMail: () => void = () => undefined) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installedNow = true;
    emit();
  });
  // The worker is only built for production; dev and preview without it fall back to page notifications.
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD || isNative) return;
  registration = navigator.serviceWorker
    .register('./sw.js', { scope: './' })
    .then(() => navigator.serviceWorker.ready)
    .catch(() => undefined);
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data as { type?: string; threadId?: string } | null;
    if (d?.type === 'maillo:open') onOpenThread(d.threadId ?? '');
    if (d?.type === 'maillo:mail') onNewMail();
  });
}
