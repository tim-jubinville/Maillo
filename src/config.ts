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
  features: { calendar: boolean; tasks: boolean };
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
    MAILMAX_CONFIG?: Partial<AppConfig>;
  }
}

const defaults: AppConfig = {
  appName: 'Mailmax',
  logoUrl: '',
  logoText: 'Mail',
  logoInvertDark: true,
  theme: 'sky',
  googleClientId: '',
  allowedAccounts: [],
  allowedDomains: [],
  language: 'auto',
  accentColor: '',
  features: { calendar: false, tasks: false },
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

function load(): AppConfig {
  const raw = (window.MAILMAX_CONFIG ?? {}) as Partial<AppConfig>;
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
    features: {
      calendar: !!raw.features?.calendar,
      tasks: !!raw.features?.tasks
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
