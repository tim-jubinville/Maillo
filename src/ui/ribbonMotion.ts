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

/** Cut the ribbon back to its old outline and let it flow out to the new one. Its shadow stays whole throughout. */
function flow(el: HTMLElement, from: { left: number; right: number }, duration = 560) {
  const r = el.getBoundingClientRect();
  const l = Math.max(0, from.left - r.left);
  const rt = Math.max(0, r.right - from.right);
  if (rt < 2) return;
  // Ribbons grow to the right; one that would also grow to the left just settles in place.
  if (l > 2) return;
  el.style.setProperty('--flow-rad', getComputedStyle(el).borderTopRightRadius === '0px' ? '0px' : '16px');
  el.classList.add('flowing');
  const a = el.animate([{ '--flow-r': `${rt}px` }, { '--flow-r': '0px' }] as Keyframe[], { duration, easing: SPRING });
  const done = () => el.classList.remove('flowing');
  a.onfinish = done;
  a.oncancel = done;
}

/**
 * A ribbon that goes away (closing a conversation) leaves a stand-in that flows back into its leading edge,
 * its buttons shrinking out from the far end. Called just before the ribbon leaves the page.
 */
const LOOK = ['background', 'boxShadow', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'borderRadius', 'backdropFilter', 'color', 'display', 'alignItems', 'gap', 'padding', 'boxSizing'] as const;
type Snap = { rect: DOMRect; look: Partial<Record<(typeof LOOK)[number], string>>; webkitBlur: string; rightRadius: string };

/** The ribbon's place and look, kept up to date while it's on screen: by the time it leaves, its neighbours may already have changed it. */
function snapshot(el: HTMLElement): Snap {
  const cs = getComputedStyle(el);
  const look: Snap['look'] = {};
  for (const k of LOOK) look[k] = cs[k];
  return { rect: el.getBoundingClientRect(), look, webkitBlur: cs.getPropertyValue('-webkit-backdrop-filter'), rightRadius: cs.borderTopRightRadius };
}

function retract(el: HTMLElement, snap: Snap) {
  if (reduced() || !el.isConnected) return;
  const r = snap.rect;
  if (r.width < 60 || r.height === 0) return;
  const g = el.cloneNode(true) as HTMLElement;
  // The stand-in lives outside the columns, so it takes the ribbon's look with it.
  for (const k of LOOK) g.style[k] = snap.look[k] ?? '';
  g.style.setProperty('-webkit-backdrop-filter', snap.webkitBlur);
  Object.assign(g.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, right: 'auto', bottom: 'auto', width: `${r.width}px`, height: `${r.height}px`, margin: '0', zIndex: '40', pointerEvents: 'none' });
  g.removeAttribute('role');
  g.setAttribute('aria-hidden', 'true');
  g.inert = true;
  g.classList.remove('glint');
  g.style.setProperty('--flow-rad', snap.rightRadius === '0px' ? '0px' : '16px');
  g.classList.add('flowing');
  document.body.appendChild(g);
  // Joined to the list ribbon: keep that one joined until the stand-in has flowed all the way back into it,
  // so the bar shrinks as one piece instead of splitting in two.
  const joinedLeft = (snap.look.borderRadius ?? '').startsWith('0px');
  const list = joinedLeft ? document.querySelector<HTMLElement>('.list-ribbon') : null;
  list?.setAttribute('data-hold', '');
  const duration = 420;
  const a = g.animate(
    joinedLeft
      ? ([{ '--flow-r': '0px', opacity: 1 }, { opacity: 1, offset: 0.85 }, { '--flow-r': `${r.width + 16}px`, opacity: 0 }] as Keyframe[])
      : ([{ '--flow-r': '0px', opacity: 1 }, { opacity: 1, offset: 0.7 }, { '--flow-r': `${Math.max(0, r.width - 48)}px`, opacity: 0 }] as Keyframe[]),
    { duration, easing: 'cubic-bezier(0.55, 0, 0.75, 0.2)', fill: 'forwards' }
  );
  items(g)
    .reverse()
    .slice(0, 24)
    .forEach((x, i) =>
      x.animate(
        [
          { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
          { opacity: 0, transform: 'scale(0.55)', filter: 'blur(5px)' }
        ],
        { duration: 220, delay: i * 14, easing: 'ease-in', fill: 'forwards' }
      )
    );
  const done = () => {
    g.remove();
    list?.removeAttribute('data-hold');
  };
  a.onfinish = done;
  a.oncancel = done;
  window.setTimeout(done, duration + 2000);
}

export function ribbonMotion(el: HTMLElement, kind: string): () => void {
  if (typeof el.animate !== 'function') return () => undefined;
  let sig = signature(el);
  let rect = el.getBoundingClientRect();
  let snap = snapshot(el);

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
    snap = snapshot(el);
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
    // Only the reading ribbon: the list ribbon leaves with the whole list (settings, a full-width conversation).
    // First, before anything reads the page's layout, so the list ribbon never shows unjoined in between.
    if (kind === 'read-ribbon') retract(el, snap);
    gone.set(kind, { rect: snap.rect, sig, at: performance.now() });
  };
}
