import { config } from './config';
import { getPrefs, onPrefs, setPrefs } from './prefs';

export interface Theme {
  id: string;
  accent: string;
  top: string;
  bottom: string;
}

export const THEMES: Theme[] = [
  { id: 'sky', accent: '#2B59E8', top: '#BCD6F8', bottom: '#F2F7FF' },
  { id: 'teal', accent: '#1F7F82', top: '#BDE2E2', bottom: '#F1FAFA' },
  { id: 'pine', accent: '#2F7A5E', top: '#C4E7D7', bottom: '#F2FBF6' },
  { id: 'iris', accent: '#5B46B8', top: '#D5CDF3', bottom: '#F6F4FE' },
  { id: 'plum', accent: '#7D4795', top: '#E2CEEB', bottom: '#FAF5FC' },
  { id: 'coral', accent: '#C0533B', top: '#F6CFC5', bottom: '#FFF6F3' },
  { id: 'tangerine', accent: '#B85A1A', top: '#FBDBBC', bottom: '#FFF8F1' },
  { id: 'cocoa', accent: '#8A5A3A', top: '#E8D9C7', bottom: '#FBF7F2' },
  { id: 'steel', accent: '#3F587E', top: '#CAD5E3', bottom: '#F4F7FA' }
];

export function currentTheme(): Theme {
  const id = getPrefs().theme || config.theme;
  const base = THEMES.find((t) => t.id === id) ?? THEMES[0];
  if (!getPrefs().theme && config.accentColor) return { ...base, accent: config.accentColor };
  return base;
}

const media = window.matchMedia?.('(prefers-color-scheme: dark)');

export function isDark(): boolean {
  const m = getPrefs().mode;
  return m === 'dark' || (m === 'system' && !!media?.matches);
}

export function applyTheme() {
  const th = currentTheme();
  const root = document.documentElement;
  const dark = isDark();
  root.dataset.mode = dark ? 'dark' : 'light';
  root.style.setProperty('--accent', th.accent);
  root.style.setProperty('--bg-top', th.top);
  root.style.setProperty('--bg-bottom', th.bottom);
  root.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#111827' : th.top);
}

export function initTheme() {
  applyTheme();
  onPrefs(applyTheme);
  media?.addEventListener?.('change', () => setPrefs({}));
}
