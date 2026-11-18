import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { config } from '../config';
import type { Address } from '../gmail/mime';
import { avatarColor, initials } from '../model';

export function Brand({ compact }: { compact?: boolean }) {
  const letter = (config.appName.trim()[0] || 'M').toUpperCase();
  return (
    <a class="brand" href="#/inbox" aria-label={config.appName}>
      <span class="brand-mark" aria-hidden="true">
        {config.logoUrl ? <img src={config.logoUrl} alt="" /> : letter}
      </span>
      {!compact && <span class="brand-name">{config.appName}</span>}
    </a>
  );
}

export function Avatar({ a, size = '' }: { a: Address; size?: '' | 'sm' | 'lg' | 'xl' }) {
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
  style
}: {
  button: ComponentChildren;
  label: string;
  children: (close: () => void) => ComponentChildren;
  align?: 'left' | 'right';
  class?: string;
  style?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useOutside(open, close);
  return (
    <div class="menu-wrap" ref={ref}>
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
