import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { config, defaultAppName } from '../config';
import { WORDMARK_PATH, WORDMARK_RATIO, WORDMARK_VIEWBOX } from './wordmark';
import type { Address } from '../gmail/mime';
import { avatarColor, initials } from '../model';
import { getState, personName } from '../store';

/** The built-in app icon. `dark` forces one variant; otherwise it follows the colour mode. */
export function AppIcon({ size = 30, dark }: { size?: number; dark?: boolean }) {
  const s = { width: `${size}px`, height: `${size}px` };
  if (dark !== undefined) return <img class="app-icon" src={dark ? './icon-dark.svg' : './icon.svg'} alt="" style={s} />;
  return (
    <span class="app-icon" aria-hidden="true" style={s}>
      <img class="only-light" src="./icon.svg" alt="" />
      <img class="only-dark" src="./icon-dark.svg" alt="" />
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

export function Menu({
  button,
  label,
  children,
  align = 'left',
  class: cls = 'ib',
  style,
  hover
}: {
  button: ComponentChildren;
  label: string;
  children: (close: () => void) => ComponentChildren;
  align?: 'left' | 'right';
  class?: string;
  style?: Record<string, string>;
  /** Also open while the pointer rests on it (devices with hover only). */
  hover?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useOutside(open, close);
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
      <button class={cls} style={style} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {button}
      </button>
      {open && (
        <div class={`pop ${align === 'right' ? 'right' : ''}`} role="menu" aria-label={label}>
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
  onChange
}: {
  value: T;
  options: { value: T; label: string }[];
  label: string;
  onChange: (v: T) => void;
}) {
  return (
    <div class="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>
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
export function Ribbon({ children, label, bottom }: { children: ComponentChildren; label: string; bottom?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
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
  return (
    <div class={`ribbon ${bottom ? 'bottom' : ''}`} ref={ref} role="group" aria-label={label}>
      {children}
    </div>
  );
}
