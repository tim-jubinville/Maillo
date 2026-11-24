/**
 * Liquid-glass motion for ribbons: a ribbon that appears flows out from its leading edge, one that changes
 * size stretches and settles, and new buttons swell into place with a glint across the glass.
 */

const SPRING = 'cubic-bezier(0.3, 1.3, 0.5, 1)';
const ITEMS = 'button, .sep, .sel-n, .cb, .count';

// The last ribbon of each kind that went away, so its replacement can morph from it instead of flowing in anew.
const gone = new Map<string, { rect: DOMRect; sig: Set<string>; at: number }>();

const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function items(el: HTMLElement): HTMLElement[] {
  // Every visible control, however deeply BarItems nests it, but not the parts inside a button or an open menu.
  return [...el.querySelectorAll<HTMLElement>(ITEMS)].filter(
    (x) => !x.closest('.pop') && !x.parentElement?.closest('button') && x.offsetParent !== null
  );
}

function keyOf(x: HTMLElement): string {
  return x.getAttribute('aria-label') || x.className;
}

function signature(el: HTMLElement): Set<string> {
  return new Set(items(el).map(keyOf));
}

function radius(el: HTMLElement): string {
  const c = getComputedStyle(el);
  return `${c.borderTopLeftRadius} ${c.borderTopRightRadius} ${c.borderBottomRightRadius} ${c.borderBottomLeftRadius}`;
}

/** Joined to its neighbour: squashing it would open a seam, so it only flows. */
function joined(el: HTMLElement): boolean {
  const c = getComputedStyle(el);
  return c.borderTopLeftRadius === '0px' || c.borderTopRightRadius === '0px';
}

function glint(el: HTMLElement) {
  el.classList.remove('glint');
  void el.offsetWidth;
  el.classList.add('glint');
  window.setTimeout(() => el.classList.remove('glint'), 700);
}

function popIn(list: HTMLElement[]) {
  list.slice(0, 24).forEach((x, i) =>
    x.animate(
      [
        { opacity: 0, transform: 'scale(0.55)', filter: 'blur(5px)' },
        { opacity: 1, transform: 'scale(1.08)', filter: 'blur(0px)', offset: 0.65 },
        { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' }
      ],
      { duration: 380, delay: i * 18, easing: 'ease-out', fill: 'backwards' }
    )
  );
}

function squish(el: HTMLElement, wide: boolean) {
  if (joined(el)) return;
  el.animate(
    wide
      ? [{ transform: 'scale(1, 1)' }, { transform: 'scale(1.006, 0.94)', offset: 0.35 }, { transform: 'scale(0.998, 1.02)', offset: 0.7 }, { transform: 'scale(1, 1)' }]
      : [{ transform: 'scale(1, 1)' }, { transform: 'scale(1.01, 0.965)', offset: 0.4 }, { transform: 'scale(1, 1)' }],
    { duration: wide ? 520 : 360, easing: 'ease-out' }
  );
}

/** Clip the ribbon back to its old outline and let it flow out to the new one. */
function flow(el: HTMLElement, from: { left: number; right: number }, duration = 560) {
  const r = el.getBoundingClientRect();
  const l = Math.max(0, from.left - r.left);
  const rt = Math.max(0, r.right - from.right);
  if (l < 2 && rt < 2) return;
  const round = radius(el);
  el.animate([{ clipPath: `inset(0 ${rt}px 0 ${l}px round ${round})` }, { clipPath: `inset(0 0px 0 0px round ${round})` }], { duration, easing: SPRING });
}

export function ribbonMotion(el: HTMLElement, kind: string): () => void {
  if (typeof el.animate !== 'function') return () => undefined;
  let sig = signature(el);
  let rect = el.getBoundingClientRect();

  if (!reduced() && rect.width > 0) {
    const prev = gone.get(kind);
    if (prev && prev.rect.width > 0 && performance.now() - prev.at < 450) {
      // Replacing a ribbon of the same kind: morph from its outline, and only new buttons swell in.
      flow(el, prev.rect, 460);
      popIn(items(el).filter((x) => !prev.sig.has(keyOf(x))));
      glint(el);
    } else {
      // A ribbon appearing flows out from its leading edge.
      flow(el, { left: rect.left, right: rect.left + Math.min(rect.width, 48) }, 620);
      popIn(items(el));
      squish(el, true);
      glint(el);
    }
  }

  let frame = 0;
  let resizedAt = 0;
  const changed = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const next = signature(el);
      const added = items(el).filter((x) => !sig.has(keyOf(x)));
      const removed = [...sig].some((k) => !next.has(k));
      sig = next;
      // Buttons folding in and out of "…" while the ribbon is resized aren't news.
      if (reduced() || (!added.length && !removed) || performance.now() - resizedAt < 300) return;
      popIn(added);
      squish(el, false);
      glint(el);
    });
  };
  const mo = new MutationObserver(changed);
  mo.observe(el, { childList: true, subtree: true });

  const ro = new ResizeObserver(() => {
    const r = el.getBoundingClientRect();
    const grew = r.width - rect.width;
    const old = rect;
    rect = r;
    if (Math.abs(grew) >= 1) resizedAt = performance.now();
    if (reduced() || Math.abs(grew) < 24 || old.width === 0 || r.width === 0) return;
    // Wider: flow out from the old outline. Narrower: a soft squeeze.
    if (grew > 0) flow(el, old, 520);
    squish(el, grew > 0);
  });
  ro.observe(el);

  return () => {
    cancelAnimationFrame(frame);
    mo.disconnect();
    ro.disconnect();
    gone.set(kind, { rect: el.getBoundingClientRect(), sig, at: performance.now() });
  };
}
