import { useEffect, useMemo, useState } from 'preact/hooks';
import { setState } from '../store';

const COLORS = ['var(--accent)', '#FFD24D', '#FF8A70', '#4FD1C2', '#9C85FF', '#6FD898', '#FFA45E', '#D08AEB'];

/** `celebrate` drops confetti, only when the user's own action just emptied the list. */
export function InboxZero({ title, sub, celebrate }: { title: string; sub: string; celebrate?: boolean }) {
  // Play once: keep it for this showing, and clear the flag so a reload or revisit stays calm.
  const [play] = useState(!!celebrate);
  useEffect(() => {
    if (play) setState({ celebrate: undefined });
  }, []);
  const pieces = useMemo(
    () =>
      Array.from({ length: 34 }, (_, i) => {
        const left = 4 + Math.random() * 92;
        const delay = Math.random() * 0.6;
        const dur = 1.9 + Math.random() * 1.4;
        const drift = (Math.random() - 0.5) * 120;
        const spin = (Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 540);
        const w = 6 + Math.random() * 6;
        const round = i % 4 === 0;
        return {
          style: {
            left: `${left}%`,
            width: `${w}px`,
            height: `${round ? w : w * 0.45}px`,
            borderRadius: round ? '50%' : '2px',
            background: COLORS[i % COLORS.length],
            animationDelay: `${delay}s`,
            animationDuration: `${dur}s`,
            '--drift': `${drift}px`,
            '--spin': `${spin}deg`
          } as Record<string, string>
        };
      }),
    []
  );
  return (
    <div class="zero" role="status">
      {play && (
        <div class="confetti" aria-hidden="true">
          {pieces.map((p) => (
            <i style={p.style} />
          ))}
        </div>
      )}
      <svg class="zero-art" viewBox="0 0 240 180" width="240" height="180" aria-hidden="true">
        <defs>
          <linearGradient id="zz-tray" x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0" style={{ stopColor: 'color-mix(in srgb, var(--accent) 55%, #ffffff)' }} />
            <stop offset="1" style={{ stopColor: 'var(--accent)' }} />
          </linearGradient>
          <linearGradient id="zz-back" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'color-mix(in srgb, var(--accent) 22%, #ffffff)' }} />
            <stop offset="1" style={{ stopColor: 'color-mix(in srgb, var(--accent) 40%, #ffffff)' }} />
          </linearGradient>
          <linearGradient id="zz-sun" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#FFE68A" />
            <stop offset="1" stop-color="#F5A623" />
          </linearGradient>
          <linearGradient id="zz-sheen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#ffffff" stop-opacity=".45" />
            <stop offset=".6" stop-color="#ffffff" stop-opacity="0" />
          </linearGradient>
        </defs>
        <ellipse cx="120" cy="164" rx="78" ry="8" fill="currentColor" opacity=".08" />
        <g class="zero-sun">
          <circle cx="120" cy="44" r="28" fill="url(#zz-sun)" />
          <circle cx="120" cy="44" r="28" fill="url(#zz-sheen)" />
          <path d="M107 44l9 9L134 34" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />
        </g>
        <path d="M44 104 60 76a8 8 0 0 1 7-4h106a8 8 0 0 1 7 4l16 28v42a10 10 0 0 1-10 10H54a10 10 0 0 1-10-10z" fill="url(#zz-back)" />
        <path d="M44 104h44l10 16h44l10-16h44v42a10 10 0 0 1-10 10H54a10 10 0 0 1-10-10z" fill="url(#zz-tray)" />
        <path d="M44 104h44l10 16h44l10-16h44v42a10 10 0 0 1-10 10H54a10 10 0 0 1-10-10z" fill="url(#zz-sheen)" />
        <g fill="#FFD24D">
          <path d="M40 40l2.4 6 6 2.4-6 2.4-2.4 6-2.4-6-6-2.4 6-2.4z" />
          <path d="M200 30l1.8 4.4 4.4 1.8-4.4 1.8-1.8 4.4-1.8-4.4-4.4-1.8 4.4-1.8z" />
        </g>
        <circle cx="186" cy="76" r="4" style={{ fill: 'color-mix(in srgb, var(--accent) 60%, #ffffff)' }} />
        <circle cx="56" cy="70" r="3" fill="#FF8A70" />
      </svg>
      <b class="zero-title">{title}</b>
      <span class="zero-sub">{sub}</span>
    </div>
  );
}
