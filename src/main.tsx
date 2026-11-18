import './migrate';
import { render } from 'preact';
import { applyBranding, config, type Branding } from './config';
import { unlockAudioOnGesture } from './chime';
import { handleOpenFromNotification, initNotifier } from './notify';
import { initPwa } from './pwa';
import { boot, getState, openCompose } from './store';
import { initTheme } from './theme';
import { App } from './ui/App';
import './styles.css';

document.title = config.appName;
initTheme();
initPwa(handleOpenFromNotification);
initNotifier();
unlockAudioOnGesture();

// The installed app's "Compose" shortcut opens #/compose.
const wantsCompose = location.hash === '#/compose';
if (wantsCompose) history.replaceState(null, '', '#/inbox');

async function loadBranding() {
  try {
    const local = localStorage.getItem('maillo.branding');
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
  boot().then(() => {
    if (wantsCompose && getState().phase === 'ready') openCompose();
  });
});
