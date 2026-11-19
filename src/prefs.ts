import type { ChimeId } from './chime';

export type NotifyScope = 'all' | 'primary' | 'important' | 'none';

export interface NotifyPrefs {
  enabled: boolean;
  /** Which inbox mail notifies. */
  scope: NotifyScope;
  /** Always notify for mail from these addresses or domains, whatever the scope. */
  vips: string[];
  /** Always notify for mail given these label IDs. */
  labels: string[];
  preview: boolean;
  sound: boolean;
  chime: ChimeId;
  volume: number;
  /** While Maillo is the window in front: show the notification too, only chime, or stay silent. */
  focused: 'notify' | 'chime' | 'silent';
  quiet: boolean;
  quietFrom: string;
  quietTo: string;
  badge: boolean;
}

export interface Prefs {
  density: 'comfortable' | 'compact';
  pane: 'right' | 'off';
  undoSeconds: number;
  images: 'always' | 'ask';
  imageSenders: string[];
  shortcuts: boolean;
  pageSize: number;
  tabs: boolean;
  sidebarCollapsed: boolean;
  mode: 'system' | 'light' | 'dark';
  theme: string;
  /** Put a "-- " line above the signature, like Gmail does by default. */
  signatureDash: boolean;
  notify: NotifyPrefs;
}

const KEY = 'maillo.prefs';

const defaults: Prefs = {
  density: 'comfortable',
  pane: 'right',
  undoSeconds: 10,
  images: 'ask',
  imageSenders: [],
  shortcuts: true,
  pageSize: 50,
  tabs: true,
  sidebarCollapsed: false,
  mode: 'system',
  theme: '',
  signatureDash: true,
  notify: {
    enabled: false,
    scope: 'primary',
    vips: [],
    labels: [],
    preview: true,
    sound: true,
    chime: 'mellow',
    volume: 0.6,
    focused: 'chime',
    quiet: false,
    quietFrom: '22:00',
    quietTo: '07:00',
    badge: true
  }
};

function read(): Prefs {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Prefs>;
    return { ...defaults, ...stored, notify: { ...defaults.notify, ...(stored.notify ?? {}) } };
  } catch {
    return { ...defaults, notify: { ...defaults.notify } };
  }
}

let prefs = read();
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  return prefs;
}

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  localStorage.setItem(KEY, JSON.stringify(prefs));
  listeners.forEach((l) => l());
}

export function onPrefs(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function setNotifyPrefs(patch: Partial<NotifyPrefs>) {
  setPrefs({ notify: { ...prefs.notify, ...patch } });
}
