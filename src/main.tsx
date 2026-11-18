import { render } from 'preact';
import { config } from './config';
import { boot } from './store';
import { App } from './ui/App';
import './styles.css';

document.title = config.appName;
document.documentElement.style.setProperty('--accent', config.accentColor);

const letter = (config.appName.trim()[0] || 'M').toUpperCase().replace(/[<>&"]/g, '');
const icon = config.logoUrl
  ? config.logoUrl
  : 'data:image/svg+xml,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6A58B4"/><stop offset=".72" stop-color="${config.accentColor}"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#g)"/><text x="32" y="44" font-family="Inter,Arial,sans-serif" font-size="34" font-weight="800" fill="#fff" text-anchor="middle">${letter}</text></svg>`
    );
const link = document.createElement('link');
link.rel = 'icon';
link.href = icon;
document.head.appendChild(link);

render(<App />, document.getElementById('app')!);
boot();
