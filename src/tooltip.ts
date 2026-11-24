import { getPrefs } from './prefs';

// One shared tooltip for icon-only buttons and links, labelled from aria-label or title.
// Native title tooltips are held back while hovering so the setting decides alone.

const DELAY = 450;
let tip: HTMLDivElement | null = null;
let target: HTMLElement | null = null;
let timer = 0;

function labelOf(el: HTMLElement): string {
  return (el.getAttribute('aria-label') || el.dataset.tipTitle || '').trim();
}

/** Attributes for a button's keyboard shortcut, written as in the shortcuts sheet ("e", "Shift + u"). */
export function keyProps(key?: string): Record<string, string> {
  if (!key) return {};
  const aria = key.split(' + ').map((p, i, a) => (i === a.length - 1 && p.length === 1 ? p.toUpperCase() : p)).join('+');
  return { 'data-key': key, 'aria-keyshortcuts': aria };
}

function iconOnly(el: HTMLElement): boolean {
  return !(el.textContent ?? '').trim() && !!el.querySelector('svg, img');
}

function holdTitle(el: HTMLElement) {
  const t = el.getAttribute('title');
  if (t !== null) {
    el.dataset.tipTitle = t;
    el.removeAttribute('title');
  }
}

function restoreTitle(el: HTMLElement) {
  if (el.dataset.tipTitle !== undefined) {
    el.setAttribute('title', el.dataset.tipTitle);
    delete el.dataset.tipTitle;
  }
}

function hide() {
  clearTimeout(timer);
  if (target) restoreTitle(target);
  target = null;
  if (tip) tip.hidden = true;
}

function show(el: HTMLElement) {
  const text = labelOf(el);
  if (!text || !el.isConnected) return;
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  tip.textContent = text;
  const key = el.dataset.key;
  if (key && getPrefs().shortcuts) {
    const k = document.createElement('kbd');
    k.className = 'tip-key';
    k.textContent = key;
    tip.append(k);
  }
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const left = Math.min(Math.max(6, r.left + r.width / 2 - w / 2), window.innerWidth - w - 6);
  const below = r.bottom + 6 + h < window.innerHeight;
  tip.style.left = `${left}px`;
  tip.style.top = `${below ? r.bottom + 6 : r.top - h - 6}px`;
}

export function initTooltips() {
  document.addEventListener('pointerover', (e) => {
    if ((e as PointerEvent).pointerType === 'touch') return;
    const el = (e.target as Element | null)?.closest?.<HTMLElement>('button, a, [role="button"]');
    if (el === target) return;
    hide();
    if (!el || !iconOnly(el)) return;
    holdTitle(el);
    target = el;
    if (getPrefs().tooltips) timer = window.setTimeout(() => show(el), DELAY);
  });
  document.addEventListener('pointerleave', hide);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', hide, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
}
