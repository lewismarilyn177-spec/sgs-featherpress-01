// A faster drop-in for makefun-site 1.0.0 (the reference of site-generator-speed-01).
// Same answer, path for path and byte for byte: front matter subset, its own Markdown, its template dialect,
// its slug rule and its build-report. The pipeline is the reference's, reworked so the per-document work is
// a few passes over the text instead of one call per character, and so templates compile to closures.

const RESERVED = ['posts', 'tags', 'page'];
const REPORT_FILE = 'build-report.txt';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/* ---------------------------------------------------------------- text */

const ENT = ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;'];
const ENT_CODE = new Int8Array(128).fill(-1);
ENT_CODE[38] = 0; ENT_CODE[60] = 1; ENT_CODE[62] = 2; ENT_CODE[34] = 3; ENT_CODE[39] = 4;

/** `s` with & < > " ' escaped, in one pass over its runs. */
function esc(s) {
  const n = s.length;
  let i = 0;
  let special = -1;
  for (; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c < 128 && ENT_CODE[c] !== -1) { special = i; break; }
  }
  if (special === -1) return s;
  let out = s.slice(0, special) + ENT[ENT_CODE[s.charCodeAt(special)]];
  let last = special + 1;
  for (i = special + 1; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c < 128 && ENT_CODE[c] !== -1) { out += s.slice(last, i) + ENT[ENT_CODE[c]]; last = i + 1; }
  }
  return out + s.slice(last);
}

const SLUG_MAX = 64;

/** The slug of `text`; the reference's rule, one pass with no joining string. */
const MARK_RE = /\p{M}/u;

function slugify(text) {
  const plain = text.normalize('NFKD');
  const parts = [];
  let gap = false;
  for (let i = 0; i < plain.length; ) {
    const cp = plain.codePointAt(i);
    const width = cp > 0xffff ? 2 : 1;
    i += width;
    if (cp >= 0x300 && MARK_RE.test(String.fromCodePoint(cp))) continue;
    let keep;
    if (cp >= 65 && cp <= 90) keep = String.fromCharCode(cp + 32);
    else if ((cp >= 97 && cp <= 122) || (cp >= 48 && cp <= 57)) keep = String.fromCodePoint(cp);
    else { gap = parts.length > 0; continue; }
    if (gap) { parts.push('-'); gap = false; }
    parts.push(keep);
  }
  let out = parts.join('');
  if (out.length > SLUG_MAX) out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
  return out === '' ? 'untitled' : out;
}

function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

function longDate(date) {
  const a = date.indexOf('-');
  const b = date.indexOf('-', a + 1);
  const d = Number(date.slice(b + 1));
  return `${d} ${MONTHS[Number(date.slice(a + 1, b)) - 1]} ${date.slice(0, a)}`;
}

/* ---------------------------------------------------------------- front matter */

const KEYS = new Set(['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary']);
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME_RE = /^[a-z0-9-]+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_RE = /^[^"[\]]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    const last = raw.length - 1;
    for (let i = 1; i < last; i++) {
      const c = raw[i];
      if (c === '\\') {
        const nx = raw[i + 1];
        if ((nx !== '"' && nx !== '\\') || i + 1 === last) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += nx;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function valueOf(key, raw) {
  if (key === 'title' || key === 'summary') {
    const s = stringOf(raw);
    return s.error !== undefined ? { error: `key "${key}": ${s.error}` } : s;
  }
  if (key === 'date') {
    const m = DATE_RE.exec(raw);
    if (m === null) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
    const y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
    return { value: raw };
  }
  if (key === 'tags') {
    if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
    const inner = raw.slice(1, -1);
    if (inner.trim() === '') return { value: [] };
    const tags = inner.split(',');
    for (let i = 0; i < tags.length; i++) {
      const t = tags[i].trim();
      if (t === '' || !TAG_RE.test(t)) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      tags[i] = t;
    }
    return { value: tags };
  }
  if (key === 'draft') return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
  if (key === 'layout') return NAME_RE.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
  if (key === 'slug') return raw.length <= 64 && SLUG_RE.test(raw) ? { value: raw } : { error: 'key "slug": not a slug' };
  return { error: `unknown key "${key}"` };
}

function parseFrontMatter(text) {
  if (text === '---') return { error: 'the front matter is not closed' };
  if (!text.startsWith('---\n')) return { error: 'no front matter' };
  // only the front matter is split into lines; the body stays one slice
  const fmLines = [];
  let start = 4;
  let close = -1;
  let fmEnd = -1;
  for (;;) {
    const nl = text.indexOf('\n', start);
    const line = nl === -1 ? text.slice(start) : text.slice(start, nl);
    if (line === '---') { close = 1; fmEnd = nl === -1 ? text.length : nl + 1; break; }
    fmLines.push(line);
    if (nl === -1) break;
    start = nl + 1;
  }
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  for (let k = 0; k < fmLines.length; k++) {
    const line = fmLines[k];
    const lineNo = k + 2;
    if (line === '') continue;
    const c0 = line.charCodeAt(0);
    if (c0 === 32 || c0 === 9) { if (/^[ \t]*$/.test(line)) continue; }
    if (c0 === 35) continue;
    const colon = line.indexOf(':');
    if (colon < 1) return { error: `line ${lineNo} is not "key: value"` };
    const key = line.slice(0, colon);
    if (colon + 1 < line.length && line.charCodeAt(colon + 1) !== 32) return { error: `line ${lineNo} is not "key: value"` };
    if (!/^[a-z_]+$/.test(key)) return { error: `line ${lineNo} is not "key: value"` };
    let raw = colon + 1 < line.length ? line.slice(colon + 2) : '';
    let e = raw.length;
    while (e > 0) {
      const c = raw.charCodeAt(e - 1);
      if (c === 32 || c === 9) e--; else break;
    }
    if (e !== raw.length) raw = raw.slice(0, e);
    if (!KEYS.has(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if (v.error !== undefined) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: text.slice(fmEnd) };
}

/* ---------------------------------------------------------------- markdown */

const ESCAPABLE = new Uint8Array(128);
for (const ch of '\\`*_[]()#+-.!>') ESCAPABLE[ch.charCodeAt(0)] = 1;

const isBlank = (l) => {
  for (let i = 0; i < l.length; i++) { const c = l.charCodeAt(i); if (c !== 32 && c !== 9) return false; }
  return true;
};

function isFenceOpen(l) {
  if (l.length < 3 || l.charCodeAt(0) !== 96 || l.charCodeAt(1) !== 96 || l.charCodeAt(2) !== 96) return null;
  let i = 3;
  while (i < l.length) { const c = l.charCodeAt(i); if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 43 || c === 45)) break; i++; }
  const lang = l.slice(3, i);
  for (; i < l.length; i++) { const c = l.charCodeAt(i); if (c !== 32 && c !== 9) return null; }
  return lang;
}

function isFenceClose(l) {
  if (l.length < 3 || l.charCodeAt(0) !== 96 || l.charCodeAt(1) !== 96 || l.charCodeAt(2) !== 96) return false;
  for (let i = 3; i < l.length; i++) { const c = l.charCodeAt(i); if (c !== 32 && c !== 9) return false; }
  return true;
}

/** { depth, text } for an ATX heading line whose text is not empty, else null. */
function headingOf(l) {
  let h = 0;
  while (h < l.length && h < 6 && l.charCodeAt(h) === 35) h++;
  if (h === 0) return null;
  const c = l.charCodeAt(h);
  if (c !== 32 && c !== 9) return null;
  let i = h;
  while (i < l.length) { const d = l.charCodeAt(i); if (d === 32 || d === 9) i++; else break; }
  let e = l.length;
  while (e > i) { const d = l.charCodeAt(e - 1); if (d === 32 || d === 9) e--; else break; }
  const text = l.slice(i, e);
  return text === '' ? null : { depth: h, text };
}

function isHr(l) {
  const c0 = l.charCodeAt(0);
  if (c0 !== 45 && c0 !== 42) return false;
  if (l.length < 3 || l.charCodeAt(1) !== c0 || l.charCodeAt(2) !== c0) return false;
  if (l.length > 3 && l.charCodeAt(3) === c0) return false;
  for (let i = 3; i < l.length; i++) { const c = l.charCodeAt(i); if (c !== 32 && c !== 9) return false; }
  return true;
}

const trimLine = (l) => {
  let a = 0, b = l.length;
  while (a < b) { const c = l.charCodeAt(a); if (c === 32 || c === 9) a++; else break; }
  while (b > a) { const c = l.charCodeAt(b - 1); if (c === 32 || c === 9) b--; else break; }
  return a === 0 && b === l.length ? l : l.slice(a, b);
};

function endsParagraph(l) {
  if (isBlank(l)) return true;
  if (isFenceOpen(l) !== null) return true;
  if (headingOf(l) !== null) return true;
  return isHr(l);
}

function lex(src) {
  const lines = src.split('\n');
  const tokens = [];
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    const lang = isFenceOpen(line);
    if (lang !== null) {
      const body = [];
      i++;
      while (i < n && !isFenceClose(lines[i])) body.push(lines[i++]);
      i++;
      tokens.push({ type: 1, lang, lines: body });
      continue;
    }
    const h = headingOf(line);
    if (h !== null) { tokens.push({ type: 2, depth: h.depth, text: h.text }); i++; continue; }
    if (isHr(line)) { tokens.push({ type: 3 }); i++; continue; }
    if (line.charCodeAt(0) === 62) {
      const body = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        const l = lines[i++];
        body.push(l.length > 1 && l.charCodeAt(1) === 32 ? l.slice(2) : l.slice(1));
      }
      const out = [];
      for (let k = 0; k < body.length; k++) { const t = trimLine(body[k]); if (t !== '') out.push(t); }
      tokens.push({ type: 4, lines: out });
      continue;
    }
    const bullet = line.length > 1 && (line.charCodeAt(0) === 45 || line.charCodeAt(0) === 42) && line.charCodeAt(1) === 32;
    let orderedStart = 0;
    let ordered = false;
    if (!bullet) {
      let j = 0;
      while (j < 9 && j < line.length) { const c = line.charCodeAt(j); if (c < 48 || c > 57) break; j++; }
      if (j > 0 && j + 1 < line.length && line.charCodeAt(j) === 46 && line.charCodeAt(j + 1) === 32) { ordered = true; orderedStart = Number(line.slice(0, j)); }
    }
    if (bullet || ordered) {
      const items = [];
      while (i < n) {
        const l = lines[i];
        let item = null;
        if (ordered) {
          let j = 0;
          while (j < 9 && j < l.length) { const c = l.charCodeAt(j); if (c < 48 || c > 57) break; j++; }
          if (j > 0 && j + 1 < l.length && l.charCodeAt(j) === 46 && l.charCodeAt(j + 1) === 32) item = l.slice(j + 2);
        } else if (l.length > 1 && (l.charCodeAt(0) === 45 || l.charCodeAt(0) === 42) && l.charCodeAt(1) === 32) item = l.slice(2);
        if (item !== null) { items.push([trimLine(item)]); i++; continue; }
        // a continuation line: two spaces or more, then a non-space
        let k = 0;
        while (k < l.length) { const c = l.charCodeAt(k); if (c !== 32) break; k++; }
        if (k >= 2 && k < l.length && l.charCodeAt(k) !== 9) { items[items.length - 1].push(trimLine(l)); i++; continue; }
        break;
      }
      const joined = new Array(items.length);
      for (let k = 0; k < items.length; k++) joined[k] = items[k].join('\n');
      tokens.push({ type: 5, ordered, start: ordered ? orderedStart : 1, items: joined });
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < n && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    tokens.push({ type: 6, text: body.join('\n') });
  }
  return tokens;
}

function findUnescaped(s, what, from) {
  const n = s.length;
  for (let j = from; j <= n - what.length; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < n) { const nx = s.charCodeAt(j + 1); if (nx < 128 && ESCAPABLE[nx] === 1) { j++; continue; } }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

function findSingleStar(s, from) {
  const n = s.length;
  for (let j = from; j < n; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < n) { const nx = s.charCodeAt(j + 1); if (nx < 128 && ESCAPABLE[nx] === 1) { j++; continue; } }
    if (c !== 42) continue;
    if (s.charCodeAt(j + 1) === 42) { j++; continue; }
    return j;
  }
  return -1;
}

/** The chars that change how `inline` scans: markup and the plain specials it escapes. */
const INLINE_MARK_RE = /[`\\*[&<>"']/g;

/** `s` rendered inline (Markdown's inline subset), `env.link(target)` a link's href. */
function inline(s, env) {
  let out = '';
  let i = 0;
  const n = s.length;
  let plain = 0;
  for (;;) {
    INLINE_MARK_RE.lastIndex = i;
    const m = INLINE_MARK_RE.exec(s);
    const j = m === null ? n : m.index;
    if (j > plain) out += s.slice(plain, j);
    if (j === n) return out;
    i = j;
    const c = s.charCodeAt(i);
    if (c === 38 || c === 60 || c === 62 || c === 34 || c === 39) {
      out += ENT[ENT_CODE[c]];
      i++;
      plain = i;
      continue;
    }
    if (c === 92) {
      const nx = i + 1 < n ? s.charCodeAt(i + 1) : -1;
      if (nx !== -1 && nx < 128 && ESCAPABLE[nx] === 1) {
        out += esc(s[i + 1]);
        i += 2;
        plain = i;
        continue;
      }
      // a lone backslash: it stays, and the scan moves past it
      out += '\\';
      i++;
      plain = i;
      continue;
    }
    if (c === 96) {
      const k = s.indexOf('`', i + 1);
      if (k > i + 1) {
        out += '<code>' + esc(s.slice(i + 1, k)) + '</code>';
        i = k + 1;
        plain = i;
        continue;
      }
      out += '`';
      i++;
      plain = i;
      continue;
    }
    if (c === 42) {
      if (s.charCodeAt(i + 1) === 42) {
        const k = findUnescaped(s, '**', i + 2);
        if (k > i + 2) {
          out += '<strong>' + inline(s.slice(i + 2, k), env) + '</strong>';
          i = k + 2;
        } else {
          out += '**';
          i += 2;
        }
        plain = i;
        continue;
      }
      const k = findSingleStar(s, i + 1);
      if (k > i + 1) {
        out += '<em>' + inline(s.slice(i + 1, k), env) + '</em>';
        i = k + 1;
      } else {
        out += '*';
        i++;
      }
      plain = i;
      continue;
    }
    // c === 91: a link opener
    if (c === 91) {
      const k = findUnescaped(s, ']', i + 1);
      const close = k !== -1 && s.charCodeAt(k + 1) === 40 ? s.indexOf(')', k + 2) : -1;
      const target = close === -1 ? '' : s.slice(k + 2, close);
      if (target !== '' && !/\s/.test(target)) {
        out += '<a href="' + esc(env.link(target)) + '">' + inline(s.slice(i + 1, k), env) + '</a>';
        i = close + 1;
        plain = i;
        continue;
      }
      out += '[';
      i++;
      plain = i;
      continue;
    }
    // unreachable: every char the jump regex finds is handled above
    i++;
    plain = i;
  }
}

/** `src` rendered: { html, toc, excerpt }. */
function renderMarkdown(src, env) {
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  const toks = lex(src);
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    switch (t.type) {
      case 2: {
        const id = uniqueSlug(slugify(t.text), ids);
        const html = inline(t.text, env);
        blocks.push(`<h${t.depth} id="${esc(id)}">${html}</h${t.depth}>`);
        if (t.depth === 2 || t.depth === 3) toc.push({ level: t.depth, id, html });
        break;
      }
      case 1: {
        const cls = t.lang === '' ? '' : ` class="language-${esc(t.lang)}"`;
        let inner = '';
        for (let q = 0; q < t.lines.length; q++) inner += esc(t.lines[q]) + '\n';
        blocks.push(`<pre><code${cls}>${inner}</code></pre>`);
        break;
      }
      case 3:
        blocks.push('<hr>');
        break;
      case 4:
        blocks.push(t.lines.length === 0 ? '<blockquote>\n</blockquote>' : `<blockquote>\n<p>${inline(t.lines.join('\n'), env)}</p>\n</blockquote>`);
        break;
      case 5: {
        const tag = t.ordered ? 'ol' : 'ul';
        const open = t.ordered && t.start !== 1 ? `<ol start="${t.start}">` : `<${tag}>`;
        let body = open + '\n';
        for (let q = 0; q < t.items.length; q++) body += '<li>' + inline(t.items[q], env) + '</li>\n';
        blocks.push(body + `</${tag}>`);
        break;
      }
      case 6: {
        const html = inline(t.text, env);
        if (excerpt === null) excerpt = html;
        blocks.push('<p>' + html + '</p>');
        break;
      }
    }
  }
  let html = '';
  for (let k = 0; k < blocks.length; k++) html += blocks[k] + '\n';
  return { html, toc, excerpt: excerpt ?? '' };
}

/* ---------------------------------------------------------------- templates */

const INCLUDE_DEPTH = 8;
const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

class TemplateError extends Error {}

function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) { text += src.slice(i); break; }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') { text += src.slice(i, open + 1); i = open + 1; continue; }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const before = src.slice(lineStart, open);
    const after = src.slice(end, lineEnd);
    const standalone = /^[ \t]*$/.test(before) && /^[ \t]*$/.test(after);
    if (standalone) {
      // the text carried so far ends at `open`; drop this line's indent from it
      const cut = open - lineStart;
      if (text.length >= cut) text = text.slice(0, text.length - cut);
      else text = '';
    }
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node); stack.push(node); body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node); stack.push(node); body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = []; body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

function lookup(scope, path) {
  let s = scope;
  const first = path[0];
  while (s !== null && !Object.hasOwn(s.vars, first)) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[first];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/**
 * A list of nodes as one function of the scope. Text and tags become string appends in order; a for's body is one
 * function called per element.
 */
function compile(nodes, templates) {
  const parts = [];
  for (const n of nodes) {
    switch (n.kind) {
      case 'text': {
        const t = n.text;
        parts.push((_scope, _depth) => t);
        break;
      }
      case 'var': {
        const p = n.path;
        parts.push((scope, _depth) => esc(textOf(lookup(scope, p))));
        break;
      }
      case 'raw': {
        const p = n.path;
        parts.push((scope, _depth) => textOf(lookup(scope, p)));
        break;
      }
      case 'if': {
        const p = n.path;
        const thenF = compile(n.then, templates);
        const elseF = n.else === null ? null : compile(n.else, templates);
        const not = n.not;
        parts.push((scope, depth) => {
          const v = truthy(lookup(scope, p));
          if (v !== not) return thenF(scope, depth);
          return elseF === null ? '' : elseF(scope, depth);
        });
        break;
      }
      case 'for': {
        const p = n.path;
        const key = n.name;
        const bodyF = compile(n.body, templates);
        parts.push((scope, depth) => {
          const xs = lookup(scope, p);
          if (!Array.isArray(xs)) return '';
          let s = '';
          const len = xs.length;
          for (let k = 0; k < len; k++) s += bodyF({ vars: { [key]: xs[k], loop: { index: k + 1, first: k === 0, last: k === len - 1, length: len } }, parent: scope }, depth);
          return s;
        });
        break;
      }
      case 'include': {
        const name = n.name;
        parts.push((scope, depth) => {
          if (depth >= INCLUDE_DEPTH) return '';
          const t = templates.get(name);
          return t === undefined ? '' : t(scope, depth + 1);
        });
        break;
      }
    }
  }
  if (parts.length === 0) return () => '';
  return (scope, depth) => {
    let s = '';
    for (let k = 0; k < parts.length; k++) s += parts[k](scope, depth);
    return s;
  };
}

/* ---------------------------------------------------------------- build */

function wordsOf(text) {
  let count = 0;
  let inWord = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const ch = text.charCodeAt(i);
    let isSpace;
    if (ch === 32 || (ch >= 9 && ch <= 13)) isSpace = true;
    else if (ch < 128) isSpace = false;
    else isSpace = /\s/u.test(text[i]);
    if (isSpace) inWord = false;
    else { if (!inWord) count++; inWord = true; }
  }
  return count;
}

function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (parts.length === 0) return null; parts.pop(); }
    else parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** Whether any node of `nodes` reads a value named `leaf` (the last name of its path). */
function usesLeaf(nodes, leaf) {
  for (const n of nodes) {
    if (n.path !== undefined && n.path[n.path.length - 1] === leaf) return true;
    if (n.kind === 'for' && usesLeaf(n.body, leaf)) return true;
    if (n.kind === 'if' && (usesLeaf(n.then, leaf) || (n.else !== null && usesLeaf(n.else, leaf)))) return true;
  }
  return false;
}

export function run(input) {
  const base = input.site.base_url.replace(/\/+$/, '');
  const templates = new Map();
  const report = [];
  const tnames = Object.keys(input.templates).sort(cmp);
  for (const name of tnames) {
    try {
      templates.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  // compiled once per build; an include resolves at render time through the same map
  const compiled = new Map();
  for (const [name, nodes] of templates) compiled.set(name, compile(nodes, compiled));

  const files = input.files;
  const order = new Array(files.length);
  for (let i = 0; i < files.length; i++) order[i] = i;
  order.sort((a, b) => cmp(files[a].path, files[b].path));

  const sources = [];
  const statics = [];
  for (let k = 0; k < order.length; k++) {
    const f = files[order[k]];
    if (f.path.endsWith('.md')) sources.push({ path: f.path, text: f.content.includes('\r') ? f.content.replace(/\r\n?/g, '\n') : f.content });
    else statics.push(f);
  }

  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if (fm.error !== undefined) { report.push(`refused ${s.path}: ${fm.error}`); continue; }
    const data = fm.data;
    s.data = data;
    s.body = fm.body;
    const post = s.path.startsWith('posts/');
    s.post = post;
    let own;
    if (!post) {
      if (s.path.startsWith('tags/')) own = 'tags';
      else if (s.path.startsWith('page/')) own = 'page';
    }
    if (own !== undefined) { report.push(`refused ${s.path}: ${own}/ is the generator's own`); continue; }
    if (post && !Object.hasOwn(data, 'date')) { report.push(`refused ${s.path}: a post needs a date`); continue; }
    const layout = data.layout ?? (post ? 'post' : 'page');
    const nodes = compiled.get(layout);
    if (nodes === undefined) { report.push(`refused ${s.path}: layout "${layout}" is no template that parses`); continue; }
    s.layout = layout;
    s.render = nodes;
    if (data.draft === true) { report.push(`draft ${s.path}`); continue; }
    kept.push(s);
  }

  const bySource = new Map();
  const taken = new Map();
  const takenIn = (dir) => {
    let set = taken.get(dir);
    if (set === undefined) { set = new Set(dir === '' ? RESERVED : []); taken.set(dir, set); }
    return set;
  };
  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), takenIn(dir));
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  const staticPaths = new Set(statics.map((f) => f.path));
  const broken = new Set();
  for (const s of kept) {
    const dir = dirOf(s.path);
    const env = {
      link: (target) => {
        if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('/') || target.startsWith('#')) return target;
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const path = rel === '' ? null : resolvePath(dir, rel);
        if (path !== null) {
          const hit = bySource.get(path);
          if (hit !== undefined) return `${hit.url}${frag}`;
          if (staticPaths.has(path)) return `${base}/${path}${frag}`;
        }
        broken.add(`broken-link ${s.path} -> ${target}`);
        return target;
      },
    };
    const md = renderMarkdown(s.body, env);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  const posts = [];
  const pages0 = [];
  for (const s of kept) (s.post ? posts : pages0).push(s);
  posts.sort((x, y) => cmp(y.data.date, x.data.date) || cmp(x.slug, y.slug));
  const np = posts.length;
  for (let k = 0; k < np; k++) {
    const p = posts[k];
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === np - 1 ? null : posts[k + 1];
  }

  const bySlug = new Map();
  const ownTags = (s) => {
    const tags = s.data.tags;
    if (tags === undefined) return [];
    const seen = new Set();
    const out = [];
    for (let k = 0; k < tags.length; k++) {
      const slug = slugify(tags[k]);
      if (seen.has(slug)) continue;
      seen.add(slug);
      out.push({ name: tags[k], slug });
    }
    return out;
  };
  for (const p of posts) {
    const refs = [];
    const tags = p.data.tags;
    if (tags !== undefined) {
      const seen = new Set();
      for (let k = 0; k < tags.length; k++) {
        const name = tags[k];
        const slug = slugify(name);
        if (seen.has(slug)) continue;
        seen.add(slug);
        let tag = bySlug.get(slug);
        if (tag === undefined) { tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] }; bySlug.set(slug, tag); }
        tag.posts.push(p);
        refs.push(tag);
      }
    }
    p.tagRefs = refs;
  }
  for (const s of pages0) {
    const tags = s.data.tags;
    if (tags === undefined) { s.tagRefs = []; continue; }
    const seen = new Set();
    const refs = [];
    for (let k = 0; k < tags.length; k++) {
      const name = tags[k];
      const slug = slugify(name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      let tag = bySlug.get(slug);
      if (tag === undefined) tag = { name, slug, url: '', posts: [] };
      refs.push(tag);
    }
    s.tagRefs = refs;
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || cmp(x.slug, y.slug));

  // cards and pages, built once each
  let needsWords = false;
  for (const nodes of templates.values()) if (usesLeaf(nodes, 'reading_minutes')) { needsWords = true; break; }
  const cardOf = (s) => {
    const d = s.data;
    const hasDate = d.date !== undefined;
    const tagRefs = s.tagRefs;
    const t = new Array(tagRefs.length);
    for (let k = 0; k < tagRefs.length; k++) t[k] = { name: tagRefs[k].name, slug: tagRefs[k].slug, url: tagRefs[k].url };
    return {
      title: d.title,
      url: s.url,
      date: d.date ?? '',
      date_long: hasDate ? longDate(d.date) : '',
      summary: d.summary ?? '',
      excerpt: s.excerpt,
      reading_minutes: needsWords ? Math.max(1, Math.ceil(wordsOf(s.body) / 200)) : 1,
      tags: t,
    };
  };
  const cards = new Map();
  for (const p of posts) cards.set(p, cardOf(p));

  const site = { title: input.site.title, base_url: base };
  const allTags = new Array(tags.length);
  for (let k = 0; k < tags.length; k++) allTags[k] = { name: tags[k].name, slug: tags[k].slug, url: tags[k].url, count: tags[k].posts.length };
  const recent = [];
  const rec = input.site.recent;
  for (let k = 0; k < posts.length && k < rec; k++) recent.push(cards.get(posts[k]));

  const output = {};
  const rootVars = { site, tags: allTags, recent };

  const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });

  for (const s of kept) {
    const card = s.post ? cards.get(s) : cardOf(s);
    const page = {
      ...card,
      slug: s.slug,
      content: s.html,
      toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
      newer: linkOf(s.newer ?? null),
      older: linkOf(s.older ?? null),
      is_post: s.post,
    };
    output[`${s.outDir}/index.html`] = s.render({ vars: { ...rootVars, page }, parent: null }, 0);
  }

  const per = input.site.per_page;
  const pageCount = Math.max(1, Math.ceil(np / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  const indexT = compiled.get('index');
  if (indexT !== undefined) {
    for (let k = 1; k <= pageCount; k++) {
      const slice = [];
      for (let q = (k - 1) * per; q < k * per && q < np; q++) slice.push(cards.get(posts[q]));
      const html = indexT({
        vars: {
          ...rootVars,
          posts: slice,
          pager: { number: k, total: pageCount, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pageCount ? '' : indexUrl(k + 1) },
        },
        parent: null,
      }, 0);
      output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
    }
  }
  const tagT = compiled.get('tag');
  if (tagT !== undefined) {
    for (const t of tags) {
      const tag = { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) };
      output[`tags/${t.slug}/index.html`] = tagT({ vars: { ...rootVars, tag }, parent: null }, 0);
    }
  }
  const tagsT = compiled.get('tags');
  if (tagsT !== undefined) output['tags/index.html'] = tagsT({ vars: rootVars, parent: null }, 0);

  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  const lines = [...report, ...broken].sort(cmp);
  lines.push(`built ${np - posts.length + pages0.length} pages, ${np} posts, ${tags.length} tags and ${statics.length} static files`);
  output[REPORT_FILE] = `${lines.join('\n')}\n`;
  return output;
}
