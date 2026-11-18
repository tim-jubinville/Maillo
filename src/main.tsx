import { render } from 'preact';
import { applyBranding, config, type Branding } from './config';
import { boot } from './store';
import { initTheme } from './theme';
import { App } from './ui/App';
import './styles.css';

document.title = config.appName;
initTheme();

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
  render(<App />, document.getElementById('app')!);
  boot();
});
