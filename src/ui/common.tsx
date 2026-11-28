import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { config, defaultAppName } from '../config';
import { WORDMARK_PATH, WORDMARK_RATIO, WORDMARK_VIEWBOX } from './wordmark';
import type { Address } from '../gmail/mime';
import { avatarColor, initials } from '../model';
import { getState, personName } from '../store';
import { ribbonMotion } from './ribbonMotion';
import { keyProps } from '../tooltip';

/** The built-in app icon. `dark` forces one variant; otherwise it follows the colour mode. */
export function AppIcon({ size = 30, dark }: { size?: number; dark?: boolean }) {
  const s = { width: `${size}px`, height: `${size}px` };
  if (dark !== undefined) return <img class="app-icon" src={dark ? './icon-dark.png' : './icon.png'} alt="" style={s} />;
  return (
    <span class="app-icon" aria-hidden="true" style={s}>
      <img class="only-light" src="./icon.png" alt="" />
      <img class="only-dark" src="./icon-dark.png" alt="" />
    </span>
  );
}

/** The app name: the outlined Maillo wordmark for the default name, plain text for any other name. */
export function AppName({ height = 20, color }: { height?: number; color?: string }) {
  if (config.appName === defaultAppName) {
    return (
      <svg class="wordmark" viewBox={WORDMARK_VIEWBOX} aria-hidden="true" style={{ height: `${height}px`, width: `${Math.round(height * WORDMARK_RATIO)}px`, color }}>
        <path d={WORDMARK_PATH} fill="currentColor" />
      </svg>
    );
  }
  return <span class="brand-name" style={{ color }}>{config.appName}</span>;
}

export function Brand({ compact }: { compact?: boolean }) {
  if (config.logoUrl) {
    return (
      <a class="brand" href="#/inbox" aria-label={config.logoText ? `${config.appName} ${config.logoText}` : config.appName}>
        <Logo src={config.logoUrl} invert={config.logoInvertDark} />
        {!compact && config.logoText && <span class="brand-name">{config.logoText}</span>}
      </a>
    );
  }
  return (
    <a class="brand" href="#/inbox" aria-label={config.appName}>
      <AppIcon />
      {!compact && <AppName />}
    </a>
  );
}

export function isSvgUrl(src: string) {
  return /^data:image\/svg\+xml/i.test(src) || /\.svg(\?|#|$)/i.test(src);
}

export function Logo({ src, invert, height = 24, color }: { src: string; invert?: boolean; height?: number; color?: string }) {
  const [ratio, setRatio] = useState(0);
  const svg = isSvgUrl(src);
  useEffect(() => {
    if (!svg) return;
    const img = new Image();
    img.onload = () => setRatio(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 4);
    img.onerror = () => setRatio(4);
    img.src = src;
  }, [src]);
  if (!svg) return <img class={`brand-logo ${invert ? 'mono' : ''}`} src={src} alt="" style={{ height: `${height}px` }} />;
  const url = `url("${src.replace(/"/g, '%22')}")`;
  return (
    <span
      class="brand-logo tinted"
      aria-hidden="true"
      style={{
        height: `${height}px`,
        width: `${Math.round(height * (ratio || 4))}px`,
        background: color ?? 'var(--logo-color)',
        WebkitMaskImage: url,
        maskImage: url,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'left center',
        maskPosition: 'left center'
      }}
    />
  );
}

/** A profile photo that falls back to `fallback` if it fails to load. */
export function Photo({ src, fallback }: { src?: string; fallback: ComponentChildren }) {
  const [broken, setBroken] = useState<string>();
  if (!src || broken === src) return <>{fallback}</>;
  // Google photo URLs can refuse requests that carry a referrer.
  return <img class="photo" src={src} alt="" referrerpolicy="no-referrer" onError={() => setBroken(src)} />;
}

function ownPhoto(email: string): string | undefined {
  const s = getState();
  if (!s.mePhoto) return undefined;
  const e = email.toLowerCase();
  return e === s.me.toLowerCase() || s.sendAs.some((x) => x.sendAsEmail.toLowerCase() === e) ? s.mePhoto : undefined;
}

export function Avatar({ a, size = '' }: { a: Address; size?: '' | 'sm' | 'lg' | 'xl' }) {
  const photo = ownPhoto(a.email) ?? getState().contactPhotos[a.email.toLowerCase()];
  if (photo) {
    return (
      <span class={`av ${size}`} aria-hidden="true">
        <Photo src={photo} fallback={<AvatarInitials a={a.name ? a : { ...a, name: personName(a) }} size={size} />} />
      </span>
    );
  }
  return <AvatarInitials a={a.name ? a : { ...a, name: personName(a) }} size={size} />;
}

function AvatarInitials({ a, size }: { a: Address; size: string }) {
  return (
    <span
      class={`av ${size}`}
      aria-hidden="true"
      style={{ background: `linear-gradient(140deg, rgba(255,255,255,.6), rgba(255,255,255,0) 65%), ${avatarColor(a.email.toLowerCase())}` }}
    >
      {initials(a)}
    </span>
  );
}

export function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return ref;
}

/**
 * Keeps an open menu inside the visible screen: flips it above or below its button, whichever has room,
 * slides it sideways off the edges and caps its height (the visual viewport, so the iOS keyboard counts).
 * Refits when its content changes (Move to / Label as open in place) and when the viewport resizes.
 */
function useFitPop(open: boolean, wrap: { current: HTMLElement | null }, pop: { current: HTMLElement | null }) {
  useLayoutEffect(() => {
    const el = pop.current;
    const anchor = wrap.current;
    if (!open || !el || !anchor) return;
    const m = 8;
    // Placed from the button's position, never by putting the menu back where it would overflow and measuring
    // again: a menu past the edge widens the page, and iOS then reports a wider viewport.
    const fit = () => {
      const vv = window.visualViewport;
      const vw = document.documentElement.clientWidth;
      const top0 = vv?.offsetTop ?? 0;
      const vh = vv ? vv.height + top0 : window.innerHeight;
      const a = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const natural = el.classList.contains('right') ? a.right - w : a.left;
      const left = Math.max(m, Math.min(natural, vw - m - w));
      el.style.left = `${Math.round(left - a.left)}px`;
      el.style.right = 'auto';
      const below = vh - a.bottom - 6 - m;
      const above = a.top - top0 - 6 - m;
      const need = el.scrollHeight;
      const upFirst = !!el.closest('.ribbon.bottom');
      const up = upFirst ? !(need > above && below > above) : need > below && above > below;
      el.style.top = up ? 'auto' : 'calc(100% + 6px)';
      el.style.bottom = up ? 'calc(100% + 6px)' : 'auto';
      el.style.maxHeight = `${Math.max(120, Math.min(up ? above : below, 520))}px`;
    };
    fit();
    const mo = new MutationObserver(() => requestAnimationFrame(fit));
    mo.observe(el, { childList: true, subtree: true });
    window.visualViewport?.addEventListener('resize', fit);
    window.addEventListener('resize', fit);
    return () => {
      mo.disconnect();
      window.visualViewport?.removeEventListener('resize', fit);
      window.removeEventListener('resize', fit);
    };
  }, [open]);
}

export function Menu({
  button,
  label,
  children,
  align = 'left',
  class: cls = 'ib',
  style,
  hover,
  shortcut
}: {
  button: ComponentChildren;
  label: string;
  children: (close: () => void) => ComponentChildren;
  align?: 'left' | 'right';
  class?: string;
  style?: Record<string, string>;
  /** Also open while the pointer rests on it (devices with hover only). */
  hover?: boolean;
  /** Keyboard shortcut, shown small in the tooltip. */
  shortcut?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useOutside(open, close);
  const popRef = useRef<HTMLDivElement>(null);
  useFitPop(open, ref, popRef);
  const timer = useRef<number | undefined>(undefined);
  const canHover = hover && window.matchMedia('(hover: hover)').matches;
  const hoverProps = canHover
    ? {
        onMouseEnter: () => {
          clearTimeout(timer.current);
          setOpen(true);
        },
        onMouseLeave: () => {
          clearTimeout(timer.current);
          timer.current = window.setTimeout(close, 220);
        }
      }
    : {};
  return (
    <div class="menu-wrap" ref={ref} {...hoverProps}>
      <button class={cls} style={style} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} {...keyProps(shortcut)} onClick={() => setOpen(!open)}>
        {button}
      </button>
      {open && (
        <div class={`pop ${align === 'right' ? 'right' : ''}`} ref={popRef} role="menu" aria-label={label}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return <button type="button" role="switch" class="sw" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function Seg<T extends string | number>({
  value,
  options,
  label,
  onChange,
  disabled
}: {
  value: T;
  options: { value: T; label: string }[];
  label: string;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div class="seg" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}>
      {options.map((o) => (
        <button type="button" role="radio" disabled={disabled} aria-checked={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function downloadBase64(b64: string, filename: string, mimeType: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType || 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Frosted ribbon floating over its parent; sets `--rh` (or `--rhb` at the bottom) so content can make room. */
export function Ribbon({ children, label, bottom, inline, class: cls = '' }: { children: ComponentChildren; label: string; bottom?: boolean; inline?: boolean; class?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent || inline) return;
    const prop = bottom ? '--rhb' : '--rh';
    const set = () => parent.style.setProperty(prop, `${el.offsetHeight + 20}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      parent.style.removeProperty(prop);
    };
  }, []);
  useLayoutEffect(() => (ref.current ? ribbonMotion(ref.current, bottom ? 'bottom' : cls.split(' ')[0] || 'ribbon') : undefined), []);
  return (
    <div class={`ribbon ${bottom ? 'bottom' : ''} ${inline ? 'inline' : ''} ${cls}`} ref={ref} role="group" aria-label={label}>
      {children}
    </div>
  );
}
