export interface AppConfig {
  appName: string;
  logoUrl: string;
  logoText: string;
  logoInvertDark: boolean;
  theme: string;
  googleClientId: string;
  allowedAccounts: string[];
  allowedDomains: string[];
  language: 'auto' | 'en' | 'fr';
  accentColor: string;
  setAsideLabel: string;
  actionLabel: string;
  features: { calendar: boolean; tasks: boolean; notes: boolean; ai: boolean; contactPhotos: boolean; staySignedIn: boolean; syncSettings: boolean; keep: boolean };
  links: {
    chat: string;
    meet: string;
    calendar: string;
    keep: string;
    contacts: string;
    gmailSettings: string;
  };
  demo: boolean;
}

declare global {
  interface Window {
    MAILLO_CONFIG?: Partial<AppConfig>;
    /** Former name, still read so older config.js files keep working. */
    MAILMAX_CONFIG?: Partial<AppConfig>;
  }
}

export const defaultAppName = 'Maillo';

const defaults: AppConfig = {
  appName: defaultAppName,
  logoUrl: '',
  logoText: '',
  logoInvertDark: true,
  theme: 'sky',
  googleClientId: '',
  allowedAccounts: [],
  allowedDomains: [],
  language: 'auto',
  accentColor: '',
  setAsideLabel: 'Set aside',
  actionLabel: 'Action required',
  features: { calendar: false, tasks: false, notes: false, ai: false, contactPhotos: false, staySignedIn: false, syncSettings: false, keep: false },
  links: {
    chat: 'https://mail.google.com/chat/',
    meet: 'https://meet.google.com/',
    calendar: 'https://calendar.google.com/',
    keep: 'https://keep.google.com/',
    contacts: 'https://contacts.google.com/',
    gmailSettings: 'https://mail.google.com/mail/u/0/#settings/general'
  },
  demo: false
};

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x).trim().toLowerCase()).filter(Boolean) : [];
}

function color(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.trim()) ? v.trim() : fallback;
}

export interface Branding {
  logoUrl?: string;
  logoText?: string;
  logoInvertDark?: boolean;
}

export function applyBranding(b: Branding | null | undefined) {
  if (!b) return;
  if (typeof b.logoUrl === 'string') config.logoUrl = b.logoUrl;
  if (typeof b.logoText === 'string') config.logoText = b.logoText;
  if (typeof b.logoInvertDark === 'boolean') config.logoInvertDark = b.logoInvertDark;
}

/** True when config.js is missing or has a syntax error, so the sign-in screen can say so. */
export const configMissing = !window.MAILLO_CONFIG && !window.MAILMAX_CONFIG;

function load(): AppConfig {
  const raw = (window.MAILLO_CONFIG ?? window.MAILMAX_CONFIG ?? {}) as Partial<AppConfig>;
  const params = new URLSearchParams(location.search);
  return {
    appName: (raw.appName ?? '').trim() || defaults.appName,
    logoUrl: (raw.logoUrl ?? '').trim(),
    logoText: typeof raw.logoText === 'string' ? raw.logoText.trim() : defaults.logoText,
    logoInvertDark: raw.logoInvertDark !== false,
    theme: typeof raw.theme === 'string' && raw.theme.trim() ? raw.theme.trim().toLowerCase() : defaults.theme,
    googleClientId: (raw.googleClientId ?? '').trim(),
    allowedAccounts: list(raw.allowedAccounts),
    allowedDomains: list(raw.allowedDomains).map((d) => d.replace(/^@/, '')),
    language: raw.language === 'en' || raw.language === 'fr' ? raw.language : 'auto',
    accentColor: color(raw.accentColor, defaults.accentColor),
    setAsideLabel: typeof raw.setAsideLabel === 'string' && raw.setAsideLabel.trim() ? raw.setAsideLabel.trim() : defaults.setAsideLabel,
    actionLabel: typeof raw.actionLabel === 'string' && raw.actionLabel.trim() ? raw.actionLabel.trim() : defaults.actionLabel,
    features: {
      calendar: !!raw.features?.calendar,
      tasks: !!raw.features?.tasks,
      notes: !!raw.features?.notes,
      ai: !!raw.features?.ai,
      contactPhotos: !!raw.features?.contactPhotos,
      staySignedIn: !!raw.features?.staySignedIn,
      syncSettings: !!raw.features?.syncSettings,
      keep: !!raw.features?.keep
    },
    links: { ...defaults.links, ...(raw.links ?? {}) },
    demo: !!raw.demo || params.has('demo')
  };
}

export const config = load();

export function isAllowedAccount(email: string): boolean {
  const e = email.trim().toLowerCase();
  const { allowedAccounts, allowedDomains } = config;
  if (!allowedAccounts.length && !allowedDomains.length) return true;
  if (allowedAccounts.includes(e)) return true;
  const domain = e.split('@')[1] ?? '';
  return allowedDomains.includes(domain);
}
