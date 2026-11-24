import DOMPurify from 'dompurify';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { b64urlToBase64, htmlToText, textToHtml, type ParsedMessage } from '../gmail/mime';
import { t } from '../i18n';
import { getPrefs, setPrefs } from '../prefs';
import { api } from '../store';
import { bindSwipe } from '../mobile';
import { isDark } from '../theme';
import { Icon } from './Icon';

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

const REMOTE = /<img[^>]+src\s*=\s*["']?\s*(https?:)?\/\/|url\(\s*["']?\s*(https?:)?\/\//i;

// Quoted earlier messages: Gmail, Apple Mail, Yahoo, Thunderbird, Proton, and Outlook's reply header (which starts a tail).
const QUOTE_BLOCKS = '.mm-textquote, .gmail_quote, blockquote[type=cite], .yahoo_quoted, .protonmail_quote, div[name="messageReplySection"], div[id^="mail-editor-reference-message-container"]';
const QUOTE_TAILS = '#divRplyFwdMsg, #appendonsend, .moz-cite-prefix';
const FORWARD = /^\s*(-{3,}\s*forwarded message|begin forwarded message|-{3,}\s*message transf[ée]r[ée]|d[ée]but du message r[ée]exp[ée]di[ée])/i;
const TEXT_QUOTE_START = /^(on .{3,200} wrote:|le .{3,200} a [ée]crit\s?:|-{2,}\s*original message\s*-{2,}|-{2,}\s*message d'origine\s*-{2,}|from: .+|de\s?: .+)\s*$/i;

/**
 * Marks quoted earlier messages with data-mq so they can be hidden. Forwarded messages, and
 * messages that are nothing but a quote, are left alone.
 */
function markQuotes(bodyHtml: string): { html: string; found: boolean } {
  const doc = new DOMParser().parseFromString(`<body>${bodyHtml}</body>`, 'text/html');
  const marked: Element[] = [];
  doc.body.querySelectorAll(QUOTE_BLOCKS).forEach((el) => {
    if (!marked.some((m) => m.contains(el)) && !FORWARD.test(el.textContent ?? '')) marked.push(el);
  });
  const tail = doc.body.querySelector(QUOTE_TAILS);
  if (tail && !marked.some((m) => m.contains(tail))) {
    // Outlook: the header block and everything after it at the same level (plus a separator line just before it).
    const prev = tail.previousElementSibling;
    if (prev?.tagName === 'HR') marked.push(prev);
    for (let el: Element | null = tail; el; el = el.nextElementSibling) marked.push(el);
  }
  if (!marked.length) return { html: bodyHtml, found: false };
  marked.forEach((el) => el.setAttribute('data-mq', ''));
  const clone = doc.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-mq]').forEach((el) => el.remove());
  if (!(clone.textContent ?? '').trim() && !clone.querySelector('img')) return { html: bodyHtml, found: false };
  return { html: doc.body.innerHTML, found: true };
}

/** Plain-text emails: split off the quoted tail ("On … wrote:" followed by "> " lines, or an original-message header). */
function splitTextQuote(text: string): { main: string; quoted: string } {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    const next = lines.slice(i + 1).find((x) => x.trim());
    const startsQuote = (TEXT_QUOTE_START.test(l) && (/^(-|from|de)/i.test(l) || next?.trim().startsWith('>'))) || (l.startsWith('>') && lines.slice(i).every((x) => !x.trim() || x.trim().startsWith('>')));
    if (startsQuote && lines.slice(0, i).join('\n').trim() && !FORWARD.test(lines.slice(i).join('\n'))) {
      return { main: lines.slice(0, i).join('\n').replace(/\s+$/, ''), quoted: lines.slice(i).join('\n') };
    }
  }
  return { main: text, quoted: '' };
}

/** A message's own words as plain text, without the quoted earlier messages (for AI summaries and drafts). */
export function messageMainText(m: ParsedMessage): string {
  if (m.html) {
    const { html, found } = markQuotes(m.html);
    if (!found) return htmlToText(html);
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    doc.body.querySelectorAll('[data-mq]').forEach((el) => el.remove());
    return htmlToText(doc.body.innerHTML);
  }
  return splitTextQuote(m.text).main;
}

const BASE_CSS = `
html,body{margin:0;padding:0;background:transparent;height:auto!important;min-height:0!important}
html{overflow-y:hidden;overflow-x:auto}
#mm-root{display:flow-root}
body{font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1b2945;overflow-wrap:anywhere;word-break:break-word}
img{max-width:100%;height:auto}
table{max-width:100%}
pre{white-space:pre-wrap}
a{color:#14213d;text-decoration-color:#7ba3d0;text-underline-offset:3px}
blockquote{margin:0 0 0 .8ex;border-left:2px solid #d5dae5;padding-left:1ex;color:#55607a}
`;

export function MessageBody({ m, showQuotedDefault }: { m: ParsedMessage; showQuotedDefault: boolean }) {
  const [cids, setCids] = useState<Record<string, string>>({});
  const [showQuoted, setShowQuoted] = useState(showQuotedDefault);
  const [allowOnce, setAllowOnce] = useState(false);
  const [height, setHeight] = useState(60);
  const frame = useRef<HTMLIFrameElement>(null);
  const quoteFound = useRef(false);
  const prefs = getPrefs();
  const sender = m.from.email.toLowerCase();
  const imagesAllowed = prefs.images === 'always' || allowOnce || prefs.imageSenders.includes(sender);
  const dark = isDark();
  const scale = prefs.textScale || 1;

  useEffect(() => {
    let cancelled = false;
    const inline = m.attachments.filter((a) => a.contentId);
    if (!inline.length) return;
    (async () => {
      const out: Record<string, string> = {};
      for (const a of inline) {
        try {
          const data = a.inlineData ?? (a.attachmentId ? await api.getAttachment(a.messageId, a.attachmentId) : '');
          if (data) out[a.contentId!] = `data:${a.mimeType};base64,${b64urlToBase64(data)}`;
        } catch {
          /* empty */
        }
      }
      if (!cancelled) setCids(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [m.id]);

  const source = useMemo(() => {
    if (m.html) return m.html;
    const { main, quoted } = splitTextQuote(m.text || m.snippet);
    return quoted ? `${textToHtml(main)}<div class="mm-textquote">${textToHtml(quoted)}</div>` : textToHtml(main);
  }, [m.id]);
  const hasRemote = REMOTE.test(source);
  const [hasQuote, setHasQuote] = useState(false);

  const doc = useMemo(() => {
    let html = source.replace(/(["'(])cid:([^"')\s]+)/gi, (all, q: string, id: string) => (cids[id] ? `${q}${cids[id]}` : all));
    html = DOMPurify.sanitize(html, {
      WHOLE_DOCUMENT: true,
      FORCE_BODY: true,
      ADD_TAGS: ['style'],
      ADD_ATTR: ['target'],
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'meta', 'link', 'base', 'frame', 'frameset'],
      ALLOW_DATA_ATTR: false
    }) as unknown as string;
    const img = imagesAllowed ? "data: blob: https: http:" : 'data: blob:';
    const style = imagesAllowed ? "'unsafe-inline' https:" : "'unsafe-inline'";
    const csp = `default-src 'none'; img-src ${img}; style-src ${style}; font-src data: ${imagesAllowed ? 'https:' : ''}; script-src 'none'; frame-src 'none'; form-action 'none'`;
    const hideQuote = showQuoted ? '' : '[data-mq]{display:none!important}';
    // The frame's colour scheme must match the page's, or the browser paints it with an opaque white backdrop.
    const scheme = `:root{color-scheme:${dark && !m.html ? 'dark' : 'light'}}`;
    const darkText = dark && !m.html ? 'body{color:#e7ecf6}a{color:#c9d8ff;text-decoration-color:#5e7db4}blockquote{border-left-color:#2f3b58;color:#9aa6bd}' : '';
    const rawBody = html.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '');
    const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? '';
    const { html: body, found } = markQuotes(rawBody);
    quoteFound.current = found;
    const textSize = scale === 1 ? '' : `body{font-size:${+(15 * scale).toFixed(2)}px}`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>${BASE_CSS}${textSize}${scheme}${hideQuote}${darkText}</style>${head}</head><body><div id="mm-root">${body}</div></body></html>`;
  }, [source, cids, imagesAllowed, showQuoted, dark, scale]);

  useEffect(() => setHasQuote(quoteFound.current), [doc]);

  // Size the frame to its content. Measure the wrapper, not the page: many emails set html/body to 100%
  // height, which would only ever report the frame's own height. Re-measure as images, fonts and width change.
  useEffect(() => {
    const f = frame.current;
    if (!f) return;
    let ro: ResizeObserver | undefined;
    let unswipe: (() => void) | undefined;
    const timers: number[] = [];
    // Emails built for a fixed width (often 600 px newsletters) are scaled down to fit the column, as phone mail apps do,
    // instead of being cut off. Past the smallest legible scale they scroll sideways.
    const fit = (d: Document, root: HTMLElement) => {
      if (!m.html) return;
      root.style.zoom = '';
      const avail = d.documentElement.clientWidth;
      const natural = d.documentElement.scrollWidth;
      const wide = avail > 0 && natural > avail + 1;
      if (wide) root.style.zoom = String(Math.max(0.4, Math.floor((avail / natural) * 1000) / 1000));
      f.parentElement?.classList.toggle('fit', wide);
    };
    const measure = () => {
      const d = f.contentDocument;
      const root = d?.getElementById('mm-root');
      if (!root) return;
      fit(d!, root);
      // Scaled heights land on fractions; round down so no sliver of the card shows below the email.
      const rh = root.getBoundingClientRect().height;
      const h = root.style.zoom ? Math.floor(rh) : Math.ceil(rh);
      const scrollbar = d!.documentElement.scrollWidth > d!.documentElement.clientWidth ? 16 : 0;
      // Scaled emails end flush with their own background; others get a little breathing room below.
      setHeight(Math.max(40, h + scrollbar + (root.style.zoom ? 0 : 8)));
    };
    const onLoad = () => {
      measure();
      const d = f.contentDocument;
      const root = d?.getElementById('mm-root');
      if (!d || !root) return;
      // Touches inside the frame never reach the page, so the frame listens for swipes itself.
      unswipe?.();
      unswipe = bindSwipe(d);
      ro = new ResizeObserver(measure);
      ro.observe(root);
      ro.observe(f);
      d.querySelectorAll('img').forEach((i) => {
        i.addEventListener('load', measure);
        i.addEventListener('error', measure);
      });
      d.fonts?.ready.then(measure).catch(() => undefined);
      for (const ms of [150, 600, 1500]) timers.push(window.setTimeout(measure, ms));
    };
    f.addEventListener('load', onLoad);
    if (f.contentDocument?.readyState === 'complete' && f.contentDocument.getElementById('mm-root')) onLoad();
    return () => {
      f.removeEventListener('load', onLoad);
      ro?.disconnect();
      unswipe?.();
      timers.forEach(clearTimeout);
    };
  }, [doc]);

  return (
    <div>
      {hasRemote && !imagesAllowed && (
        <div class="notice info" style={{ marginBottom: '12px' }}>
          <Icon name="image" />
          <span style={{ flex: 1 }}>{t('read.imagesHidden')}</span>
          <button class="btn sm" onClick={() => setAllowOnce(true)}>{t('read.showImages')}</button>
          <button class="btn sm" onClick={() => setPrefs({ imageSenders: [...prefs.imageSenders, sender] })}>
            {t('read.alwaysShow', { email: m.from.email })}
          </button>
        </div>
      )}
      <div class={m.html ? 'paper' : ''}>
      <iframe
        ref={frame}
        title={m.subject || t('compose.body')}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={doc}
        style={{ height: `${height}px` }}
      />
      </div>
      {hasQuote && (
        <button
          class="trim-btn"
          aria-label={showQuoted ? t('read.hideTrimmed') : t('read.trimmed')}
          title={showQuoted ? t('read.hideTrimmed') : t('read.trimmed')}
          aria-expanded={showQuoted}
          onClick={() => setShowQuoted(!showQuoted)}
        >
          <Icon name="dots" size={16} />
        </button>
      )}
    </div>
  );
}
