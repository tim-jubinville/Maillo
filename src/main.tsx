import { render } from 'preact';
import { applyBranding, config, type Branding } from './config';
import { onPrefs } from './prefs';
import { boot } from './store';
import { currentTheme, initTheme } from './theme';
import { App } from './ui/App';
import './styles.css';

document.title = config.appName;
initTheme();

function setFavicon() {
  const letter = (config.appName.trim()[0] || 'M').toUpperCase().replace(/[<>&"]/g, '');
  const accent = currentTheme().accent;
  const href =
    'data:image/svg+xml,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".35"/><stop offset=".7" stop-color="#ffffff" stop-opacity="0"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="${accent}"/><rect width="64" height="64" rx="16" fill="url(#g)"/><text x="32" y="44" font-family="Inter,Arial,sans-serif" font-size="34" font-weight="800" fill="#fff" text-anchor="middle">${letter}</text></svg>`
    );
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = href;
}

async function loadBranding() {
  try {
    const local = localStorage.getItem('mailmax.branding');
    if (local) applyBranding(JSON.parse(local) as Branding);
  } catch {
    /* empty */
  }
  try {
    const r = await fetch('./branding.json', { cache: 'no-store' });
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) applyBranding((await r.json()) as Branding);
  } catch {
    /* empty */
  }
}

loadBranding().finally(() => {
  setFavicon();
  onPrefs(setFavicon);
  render(<App />, document.getElementById('app')!);
  boot();
});
