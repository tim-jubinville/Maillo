import DOMPurify from 'dompurify';

// A small Markdown renderer for stickies: headings, bold, italic, strikethrough, code, links,
// quotes, lists and to-do items. Text is escaped first and the result sanitised, so a sticky
// can never inject markup. To-do boxes (role=checkbox) carry data-line, the source line they toggle.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(raw: string): string {
  const codes: string[] = [];
  let s = esc(raw).replace(/`([^`]+)`/g, (_, c: string) => {
    codes.push(`<code>${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  const links: string[] = [];
  const keep = (html: string) => {
    links.push(html);
    return `\u0001${links.length - 1}\u0001`;
  };
  s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_, label: string, url: string) => keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`));
  s = s.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+[^\s<).,!?;:])/g, (_, pre: string, url: string) => pre + keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url.replace(/^https?:\/\//, '')}</a>`));
  s = s
    .replace(/\*\*(?=\S)(.+?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)(.+?\S)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=\S)(.+?\S)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?=\S)(.+?\S)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)(.+?\S)~~/g, '<del>$1</del>');
  return s.replace(/\u0001(\d+)\u0001/g, (_, i: string) => links[+i]).replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[+i]);
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line.trim())) {
      flushPara();
      closeList();
      const code: string[] = [];
      while (++i < lines.length && !/^```/.test(lines[i].trim())) code.push(lines[i]);
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      flushPara();
      closeList();
      out.push(`<h${m[1].length + 2}>${inline(m[2])}</h${m[1].length + 2}>`);
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara();
      closeList();
      out.push('<hr>');
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara();
      closeList();
      out.push(`<blockquote>${inline(m[1])}</blockquote>`);
    } else if ((m = line.match(/^\s*[-*+]\s+\[([ xX])\]\s*(.*)$/))) {
      flushPara();
      if (list !== 'ul') {
        closeList();
        out.push('<ul>');
        list = 'ul';
      }
      const done = m[1] !== ' ';
      out.push(`<li class="todo${done ? ' done' : ''}"><span class="todo-box" role="checkbox" tabindex="0" aria-checked="${done}" data-line="${i}"></span><span>${inline(m[2])}</span></li>`);
    } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ul') {
        closeList();
        out.push('<ul>');
        list = 'ul';
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ol') {
        closeList();
        out.push('<ol>');
        list = 'ol';
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return DOMPurify.sanitize(out.join(''), {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'a', 'ul', 'ol', 'li', 'span', 'h3', 'h4', 'h5', 'blockquote', 'hr'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'data-line', 'class', 'role', 'tabindex', 'aria-checked'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i
  });
}

/** Flips the to-do box on one source line. */
export function toggleTodo(src: string, line: number): string {
  const lines = src.split('\n');
  const l = lines[line];
  if (l === undefined) return src;
  lines[line] = l.replace(/^(\s*[-*+]\s+\[)([ xX])(\])/, (_, a: string, c: string, b: string) => a + (c === ' ' ? 'x' : ' ') + b);
  return lines.join('\n');
}
