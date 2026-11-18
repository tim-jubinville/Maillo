export type Folder =
  | 'inbox'
  | 'starred'
  | 'snoozed'
  | 'important'
  | 'sent'
  | 'scheduled'
  | 'drafts'
  | 'all'
  | 'spam'
  | 'trash';

export type Category = 'primary' | 'promotions' | 'social' | 'updates' | 'forums';

export const FOLDERS: Folder[] = ['inbox', 'starred', 'snoozed', 'important', 'sent', 'scheduled', 'drafts', 'all', 'spam', 'trash'];
export const CATEGORIES: Category[] = ['primary', 'promotions', 'social', 'updates', 'forums'];

export type SettingsSection = 'general' | 'labels' | 'filters' | 'accounts' | 'vacation' | 'forwarding' | 'shortcuts' | 'updates' | 'about';
export const SETTINGS_SECTIONS: SettingsSection[] = ['general', 'labels', 'filters', 'accounts', 'vacation', 'forwarding', 'shortcuts', 'updates', 'about'];

export interface MailRoute {
  view: 'mail';
  folder?: Folder;
  label?: string;
  category: Category;
  q?: string;
  thread?: string;
}

export interface SettingsRoute {
  view: 'settings';
  section: SettingsSection;
}

export type Route = MailRoute | SettingsRoute;

export function parseHash(hash = location.hash): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const tIdx = parts.indexOf('t');
  const thread = tIdx >= 0 ? parts[tIdx + 1] : undefined;
  const head = tIdx >= 0 ? parts.slice(0, tIdx) : parts;
  const [a, b] = head;
  if (a === 'settings') {
    const section = (SETTINGS_SECTIONS as string[]).includes(b) ? (b as SettingsSection) : 'general';
    return { view: 'settings', section };
  }
  if (a === 'label' && b) return { view: 'mail', label: b, category: 'primary', thread };
  if (a === 'search' && b !== undefined) return { view: 'mail', q: b, category: 'primary', thread };
  const folder = (FOLDERS as string[]).includes(a) ? (a as Folder) : 'inbox';
  const category = folder === 'inbox' && (CATEGORIES as string[]).includes(b) ? (b as Category) : 'primary';
  return { view: 'mail', folder, category, thread };
}

export function listHash(r: Route): string {
  if (r.view === 'settings') return `#/settings/${r.section}`;
  if (r.q !== undefined) return `#/search/${encodeURIComponent(r.q)}`;
  if (r.label) return `#/label/${encodeURIComponent(r.label)}`;
  const f = r.folder ?? 'inbox';
  return f === 'inbox' && r.category !== 'primary' ? `#/inbox/${r.category}` : `#/${f}`;
}

export function threadHash(r: MailRoute, id: string): string {
  return `${listHash(r)}/t/${encodeURIComponent(id)}`;
}

export function go(hash: string, replace = false) {
  if (location.hash === hash) return;
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function sameList(a: Route, b: Route): boolean {
  return listHash(a) === listHash(b);
}
