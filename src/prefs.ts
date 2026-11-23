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

export type PanelId = 'calendar' | 'tasks' | 'keep' | 'contacts';

/** Column widths in pixels. */
export interface LayoutPrefs {
  sidebar: number;
  list: number;
  panel: number;
}

export const DEFAULT_LAYOUT: LayoutPrefs = { sidebar: 236, list: 460, panel: 300 };

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
  layout: LayoutPrefs;
  /** Side panel left open last time. */
  panel: PanelId | '';
  /** Coloured icons, or plain outlines everywhere. */
  icons: 'color' | 'outline';
  /** Interface text size, as a multiple of the default. */
  textScale: number;
  /** Show a label when hovering icon-only buttons. */
  tooltips: boolean;
  /** What Reply does when a conversation has several people in it. */
  replyDefault: 'reply' | 'replyAll';
}

export const TEXT_SCALES = [0.88, 0.94, 1, 1.08, 1.16, 1.25];

const KEY = 'maillo.prefs';

const defaults: Prefs = {
  density: 'comfortable',
  // Like Gmail: conversations open in place of the list.
  pane: 'off',
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
  layout: { ...DEFAULT_LAYOUT },
  panel: '',
  icons: 'color',
  textScale: 1,
  tooltips: true,
  replyDefault: 'reply',
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
    return { ...defaults, ...stored, notify: { ...defaults.notify, ...(stored.notify ?? {}) }, layout: { ...defaults.layout, ...(stored.layout ?? {}) } };
  } catch {
    return { ...defaults, notify: { ...defaults.notify }, layout: { ...defaults.layout } };
  }
}

let prefs = read();
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  return prefs;
}

const patchListeners = new Set<(patch: Partial<Prefs>, remote: boolean) => void>();

/** `remote` marks changes that came from another device (so they aren't sent back). */
export function setPrefs(patch: Partial<Prefs>, opts: { remote?: boolean } = {}) {
  prefs = { ...prefs, ...patch };
  localStorage.setItem(KEY, JSON.stringify(prefs));
  patchListeners.forEach((l) => l(patch, !!opts.remote));
  listeners.forEach((l) => l());
}

/** Called with what changed in each setPrefs call. */
export function onPrefsPatch(fn: (patch: Partial<Prefs>, remote: boolean) => void) {
  patchListeners.add(fn);
  return () => {
    patchListeners.delete(fn);
  };
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
