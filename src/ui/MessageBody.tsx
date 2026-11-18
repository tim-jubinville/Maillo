import DOMPurify from 'dompurify';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { b64urlToBase64, textToHtml, type ParsedMessage } from '../gmail/mime';
import { t } from '../i18n';
import { getPrefs, setPrefs } from '../prefs';
import { api } from '../store';
import { Icon } from './Icon';

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

const REMOTE = /<img[^>]+src\s*=\s*["']?\s*(https?:)?\/\/|url\(\s*["']?\s*(https?:)?\/\//i;

const BASE_CSS = `
html,body{margin:0;padding:0;background:transparent}
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
  const prefs = getPrefs();
  const sender = m.from.email.toLowerCase();
  const imagesAllowed = prefs.images === 'always' || allowOnce || prefs.imageSenders.includes(sender);

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

  const source = m.html || textToHtml(m.text || m.snippet);
  const hasRemote = REMOTE.test(source);
  const hasQuote = /class=["']?gmail_quote|<blockquote[^>]+type=["']?cite/i.test(source);

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
    const hideQuote = hasQuote && !showQuoted ? '.gmail_quote,blockquote[type=cite]{display:none!important}' : '';
    const body = html.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '');
    const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? '';
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>${BASE_CSS}${hideQuote}</style>${head}</head><body>${body}</body></html>`;
  }, [source, cids, imagesAllowed, showQuoted]);

  useEffect(() => {
    const f = frame.current;
    if (!f) return;
    let ro: ResizeObserver | undefined;
    const measure = () => {
      const d = f.contentDocument;
      if (!d?.documentElement) return;
      setHeight(Math.max(40, d.documentElement.scrollHeight, d.body?.scrollHeight ?? 0) + 4);
    };
    const onLoad = () => {
      measure();
      const d = f.contentDocument;
      if (d?.body) {
        ro = new ResizeObserver(measure);
        ro.observe(d.body);
        d.querySelectorAll('img').forEach((i) => i.addEventListener('load', measure));
      }
    };
    f.addEventListener('load', onLoad);
    return () => {
      f.removeEventListener('load', onLoad);
      ro?.disconnect();
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
      <iframe
        ref={frame}
        title={m.subject || t('compose.body')}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={doc}
        style={{ height: `${height}px` }}
      />
      {hasQuote && (
        <button class="trim-btn" aria-label={t('read.trimmed')} title={t('read.trimmed')} aria-expanded={showQuoted} onClick={() => setShowQuoted(!showQuoted)}>
          ···
        </button>
      )}
    </div>
  );
}
