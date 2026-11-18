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
}

const KEY = 'mailmax.prefs';

const defaults: Prefs = {
  density: 'comfortable',
  pane: 'right',
  undoSeconds: 10,
  images: 'ask',
  imageSenders: [],
  shortcuts: true,
  pageSize: 50,
  tabs: true,
  sidebarCollapsed: false
};

function read(): Prefs {
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Prefs>) };
  } catch {
    return { ...defaults };
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
