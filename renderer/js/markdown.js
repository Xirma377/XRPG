// Minimal, CSP-safe Markdown -> HTML renderer (no innerHTML of untrusted raw;
// everything is escaped first, then a safe subset of formatting is applied).
// Supports: headings, bold, italic, code, blockquotes (incl. > ### sidebars),
// unordered/ordered lists, tables, hr, links (http only), line breaks.

import { escapeHtml } from './util.js';

function inline(text) {
  let s = escapeHtml(text);
  // inline code
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // bold then italic
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/\b_([^_]+)_\b/g, '<em>$1</em>');
  // links [text](http...)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" data-ext="1">$1</a>');
  return s;
}

export function renderMarkdown(md) {
  if (!md) return '';
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  const isTableSep = (l) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l) && l.includes('-');

  while (i < lines.length) {
    let line = lines[i];

    // blank
    if (/^\s*$/.test(line)) { i++; continue; }

    // hr
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr/>'); i++; continue; }

    // headings
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { const lvl = h[1].length; out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`); i++; continue; }

    // table
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i])); i++;
      }
      out.push('<table><thead><tr>' + header.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }

    // blockquote (collect consecutive)
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, '')); i++;
      }
      let cls = 'md-quote';
      // GM sidebar marker
      const joined = buf.join('\n');
      if (/^###\s/.test(buf[0] || '') || /🅂🄸🄳🄴🄱🄰🅁|SIDEBAR/i.test(joined)) cls = 'md-quote md-sidebar';
      out.push(`<blockquote class="${cls}">${renderMarkdown(joined)}</blockquote>`);
      continue;
    }

    // unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^\s*[-*+]\s+/, ''))); i++;
      }
      out.push('<ul>' + items.map((t) => `<li>${t}</li>`).join('') + '</ul>');
      continue;
    }

    // ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^\s*\d+[.)]\s+/, ''))); i++;
      }
      out.push('<ol>' + items.map((t) => `<li>${t}</li>`).join('') + '</ol>');
      continue;
    }

    // code fence
    if (/^\s*```/.test(line)) {
      i++;
      const code = [];
      while (i < lines.length && !/^\s*```/.test(lines[i])) { code.push(lines[i]); i++; }
      i++;
      out.push('<pre class="md-code"><code>' + escapeHtml(code.join('\n')) + '</code></pre>');
      continue;
    }

    // paragraph (collect until blank)
    const para = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) &&
           !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) && !/^\s*>/.test(lines[i]) &&
           !/^#{1,6}\s/.test(lines[i]) && !/^\s*```/.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    out.push('<p>' + para.map(inline).join('<br/>') + '</p>');
  }
  return out.join('\n');
}

function splitRow(line) {
  let l = line.trim();
  if (l.startsWith('|')) l = l.slice(1);
  if (l.endsWith('|')) l = l.slice(0, -1);
  return l.split('|').map((c) => c.trim());
}

// Render into a node and wire external links through the shell.
export function setMarkdown(node, md) {
  node.innerHTML = renderMarkdown(md);
  node.querySelectorAll('a[data-ext]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.xrpg) window.xrpg.shell.openExternal(a.getAttribute('href'));
    });
  });
  return node;
}
