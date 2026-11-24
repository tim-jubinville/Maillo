import type { ComponentChildren } from 'preact';

export type AiAction = 'summarize' | 'proofread' | 'draft';

/** An AI action's icon: its own glyph with a small spark, always in the AI gradient. */
export function AiIcon({ action, size = 20 }: { action: AiAction; size?: number }) {
  return (
    <svg class="ai-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <use href={`#mmc-ai-${action}`} />
    </svg>
  );
}

/**
 * Every AI action uses this button: no fill, the action's icon and a gradient label. AI never runs
 * on its own in Maillo; each request starts from one of these.
 */
export function AiButton({
  action,
  label,
  onClick,
  busy = false,
  busyLabel,
  sm = false,
  title,
  children
}: {
  action: AiAction;
  label: string;
  onClick: () => void;
  busy?: boolean;
  busyLabel?: string;
  sm?: boolean;
  title?: string;
  children?: ComponentChildren;
}) {
  return (
    <button type="button" class={`ai-btn ${sm ? 'sm' : ''}`} aria-busy={busy || undefined} disabled={busy} title={title} onClick={onClick}>
      <AiIcon action={action} size={sm ? 18 : 20} />
      <span class="ai-lab">{busy && busyLabel ? busyLabel : label}</span>
      {children}
    </button>
  );
}
