import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useLayoutEffect, useState } from 'preact/hooks';
import { closeCompose, getState, openCompose, updateCompose } from '../store';
import { ColorSprite } from './ColorIcons';

// The compose window can move into its own browser window. It stays part of this page
// (same state, same sign-in): the popup is an empty window that this page draws into.

let popup: Window | null = null;
let closingOnPurpose = false;

function openWindow(): Window | null {
  const w = Math.min(720, screen.availWidth - 40);
  const h = Math.min(780, screen.availHeight - 60);
  const left = Math.max(0, (window.screenX || 0) + (window.outerWidth - w) / 2);
  const top = Math.max(0, (window.screenY || 0) + 60);
  // Must run during the click, or the browser blocks the popup.
  return window.open('', `maillo-compose-${Date.now()}`, `popup,width=${w},height=${h},left=${Math.round(left)},top=${Math.round(top)}`);
}

/** Moves the open draft into its own window. Returns false if the browser blocked the popup. */
export function popOutCompose(): boolean {
  if (!getState().compose) return false;
  const w = openWindow();
  if (!w) return false;
  popup = w;
  updateCompose({ popout: true, minimized: false, maximized: false });
  return true;
}

/** New message straight in its own window (Shift + click on Compose). */
export function composeInWindow() {
  const w = openWindow();
  openCompose();
  if (!w) return;
  popup = w;
  updateCompose({ popout: true });
}

export function popInCompose() {
  updateCompose({ popout: false });
}

function copyLook(doc: Document) {
  const root = document.documentElement;
  for (const a of ['data-mode', 'data-icons', 'style', 'lang']) {
    const v = root.getAttribute(a);
    if (v === null) doc.documentElement.removeAttribute(a);
    else doc.documentElement.setAttribute(a, v);
  }
}

/** Renders its children in the popup window for as long as it's mounted. */
export function PopoutWindow({ title, children }: { title: string; children: ComponentChildren }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const w = popup;
    if (!w || w.closed) {
      popInCompose();
      return;
    }
    const doc = w.document;
    doc.open();
    doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body class="popout-body"></body></html>');
    doc.close();
    for (const el of document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style')) {
      const copy = doc.importNode(el, true);
      if (el.tagName === 'LINK') (copy as HTMLLinkElement).href = (el as HTMLLinkElement).href;
      doc.head.append(copy);
    }
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) {
      const l = doc.createElement('link');
      l.rel = 'icon';
      l.href = icon.href;
      doc.head.append(l);
    }
    copyLook(doc);
    // Follow theme and mode changes made in the main window.
    const mo = new MutationObserver(() => copyLook(doc));
    mo.observe(document.documentElement, { attributes: true });
    const div = doc.createElement('div');
    div.className = 'popout-root';
    doc.body.append(div);
    setHost(div);

    // Closing the window keeps the draft, like the ✕ button.
    const onGone = () => {
      if (closingOnPurpose) return;
      if (getState().compose?.popout) closeCompose();
    };
    w.addEventListener('pagehide', onGone);
    const onMainGone = () => w.close();
    window.addEventListener('pagehide', onMainGone);
    w.focus();
    return () => {
      mo.disconnect();
      window.removeEventListener('pagehide', onMainGone);
      w.removeEventListener('pagehide', onGone);
      closingOnPurpose = true;
      if (!w.closed) w.close();
      closingOnPurpose = false;
      if (popup === w) popup = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (popup && !popup.closed) popup.document.title = title;
  }, [title, host]);

  if (!host) return null;
  return createPortal(
    <>
      <ColorSprite />
      {children}
    </>,
    host
  );
}
