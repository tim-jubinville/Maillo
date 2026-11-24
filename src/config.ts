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
  features: { calendar: boolean; tasks: boolean; notes: boolean; ai: boolean; contactPhotos: boolean; staySignedIn: boolean; syncSettings: boolean; keep: boolean; push: boolean };
  links: {
    chat: string;
    meet: string;
    calendar: string;
    keep: string;
    contacts: string;
    gmailSettings: string;
  };
  demo: boolean;
  /** Settings come from maillo-config.php, which keeps the allowed accounts on the server: ask it after signing in. */
  accountCheck: boolean;
}

/** config.php's setup checklist (yes/no answers), present while required settings are missing. */
export interface SetupState {
  ready: boolean;
  required: string[];
  checks: Record<string, boolean>;
  line?: number;
}

declare global {
  interface Window {
    MAILLO_CONFIG?: Partial<AppConfig>;
    MAILLO_SETUP?: SetupState;
  }
}

/** True in the demo build published with the website (MAILLO_DEMO=1 npm run build). */
declare const __DEMO_BUILD__: boolean;
/** True in the iOS app build (MAILLO_NATIVE=1, Capacitor). */
declare const __NATIVE_BUILD__: boolean;
export const isNative = __NATIVE_BUILD__;

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
  features: { calendar: false, tasks: false, notes: false, ai: false, contactPhotos: false, staySignedIn: false, syncSettings: false, keep: false, push: false },
  links: {
    chat: 'https://mail.google.com/chat/',
    meet: 'https://meet.google.com/',
    calendar: 'https://calendar.google.com/',
    keep: 'https://keep.google.com/',
    contacts: 'https://contacts.google.com/',
    gmailSettings: 'https://mail.google.com/mail/u/0/#settings/general'
  },
  demo: false,
  accountCheck: false
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

/** True when config.php gave no settings and no checklist: the host didn't run it (no PHP) or it's missing. */
export const configMissing = !window.MAILLO_CONFIG && !window.MAILLO_SETUP;

/** The setup checklist from config.php, while maillo-config.php isn't filled in or the server isn't ready. */
export const setup: SetupState | undefined = window.MAILLO_SETUP && typeof window.MAILLO_SETUP === 'object' ? window.MAILLO_SETUP : undefined;

/** The settings file, for messages that say where to change something. */
export const configFile = 'maillo-config.php';

function load(): AppConfig {
  const raw = (window.MAILLO_CONFIG ?? {}) as Partial<AppConfig>;
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
      ai: !isNative && !!raw.features?.ai,
      contactPhotos: !!raw.features?.contactPhotos,
      // The iOS app has no server behind it: it stays signed in on its own, and these need one.
      staySignedIn: !isNative && !!raw.features?.staySignedIn,
      syncSettings: !!raw.features?.syncSettings,
      keep: !isNative && !!raw.features?.keep,
      push: !isNative && !!raw.features?.push
    },
    links: { ...defaults.links, ...(raw.links ?? {}) },
    demo: __DEMO_BUILD__ || !!raw.demo || params.has('demo'),
    accountCheck: !isNative && raw.accountCheck === true
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
