/** A small XML tree for SVG cleanup: parse, optimize, and re-emit as SVG, JSX, or a data URI. */

export type XNode =
  | { type: 'el'; name: string; attrs: [string, string][]; children: XNode[] }
  | { type: 'text'; text: string }
  | { type: 'cdata'; text: string }
  | { type: 'comment'; text: string }
  | { type: 'pi' | 'doctype'; text: string };

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m));
const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function parseXml(src: string): XNode[] {
  let i = 0;
  const n = src.length;
  const root: XNode[] = [];
  const stack: { name: string; children: XNode[] }[] = [{ name: '#root', children: root }];
  const top = () => stack[stack.length - 1].children;
  while (i < n) {
    if (src.startsWith('<!--', i)) { const e = src.indexOf('-->', i + 4); if (e < 0) throw new Error('Unclosed comment'); top().push({ type: 'comment', text: src.slice(i + 4, e) }); i = e + 3; continue; }
    if (src.startsWith('<![CDATA[', i)) { const e = src.indexOf(']]>', i); if (e < 0) throw new Error('Unclosed CDATA'); top().push({ type: 'cdata', text: src.slice(i + 9, e) }); i = e + 3; continue; }
    if (src.startsWith('<?', i)) { const e = src.indexOf('?>', i); if (e < 0) throw new Error('Unclosed <?'); top().push({ type: 'pi', text: src.slice(i, e + 2) }); i = e + 2; continue; }
    if (src.startsWith('<!', i)) {
      // DOCTYPE, possibly with an internal [subset].
      let depth = 0, j = i + 2;
      for (; j < n; j++) { if (src[j] === '[') depth++; else if (src[j] === ']') depth--; else if (src[j] === '>' && depth <= 0) break; }
      top().push({ type: 'doctype', text: src.slice(i, j + 1) }); i = j + 1; continue;
    }
    if (src.startsWith('</', i)) {
      const e = src.indexOf('>', i);
      const name = src.slice(i + 2, e).trim();
      const open = stack.pop();
      if (!open || open.name !== name) throw new Error(`Mismatched </${name}>`);
      i = e + 1; continue;
    }
    if (src[i] === '<') {
      const m = /^<([A-Za-z_][\w:.-]*)/.exec(src.slice(i));
      if (!m) throw new Error(`Bad tag at ${i}`);
      const name = m[1];
      let j = i + m[0].length;
      const attrs: [string, string][] = [];
      for (;;) {
        while (/\s/.test(src[j] ?? '')) j++;
        if (src[j] === '/' && src[j + 1] === '>') { j += 2; top().push({ type: 'el', name, attrs, children: [] }); break; }
        if (src[j] === '>') { j++; const el: XNode = { type: 'el', name, attrs, children: [] }; top().push(el); stack.push({ name, children: el.children }); break; }
        const a = /^([^\s=/>]+)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/.exec(src.slice(j));
        if (!a) throw new Error(`Bad attribute in <${name}>`);
        attrs.push([a[1], decode(a[3] ?? a[4] ?? a[5] ?? '')]);
        j += a[0].length;
        if (j >= n) throw new Error(`Unclosed <${name}>`);
      }
      i = j; continue;
    }
    const e = src.indexOf('<', i);
    const text = src.slice(i, e < 0 ? n : e);
    top().push({ type: 'text', text: decode(text) });
    i = e < 0 ? n : e;
  }
  if (stack.length > 1) throw new Error(`Unclosed <${stack[stack.length - 1].name}>`);
  return root;
}

export function serialize(nodes: XNode[], pretty = false, depth = 0): string {
  const pad = pretty ? '  '.repeat(depth) : '';
  const nl = pretty ? '\n' : '';
  return nodes.map((x) => {
    if (x.type === 'text') return pretty ? (x.text.trim() ? pad + escText(x.text.trim()) + nl : '') : escText(x.text);
    if (x.type === 'cdata') return `${pad}<![CDATA[${x.text}]]>${nl}`;
    if (x.type === 'comment') return `${pad}<!--${x.text}-->${nl}`;
    if (x.type !== 'el') return x.text + nl;
    const attrs = x.attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
    if (!x.children.length) return `${pad}<${x.name}${attrs}/>${nl}`;
    const inline = x.children.every((c) => c.type === 'text' || c.type === 'cdata');
    if (inline || !pretty) return `${pad}<${x.name}${attrs}>${serialize(x.children, false)}</${x.name}>${nl}`;
    return `${pad}<${x.name}${attrs}>${nl}${serialize(x.children, true, depth + 1)}${pad}</${x.name}>${nl}`;
  }).join('');
}

export interface SvgOptions { precision: number; removeDimensions: boolean; keepTitle: boolean; currentColor: boolean; pretty: boolean }
export const SVG_DEFAULTS: SvgOptions = { precision: 3, removeDimensions: false, keepTitle: false, currentColor: false, pretty: false };

const EDITOR_NS = /^(inkscape|sodipodi|sketch|serif|dc|cc|rdf|i|x|a|graph|figma|vectornator):/;
const DROP_ELEMENTS = new Set(['metadata', 'sodipodi:namedview', 'inkscape:perspective', 'inkscape:path-effect']);
const NUMERIC = new Set(['d', 'points', 'transform', 'viewBox', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'stroke-width', 'offset', 'fx', 'fy', 'dx', 'dy', 'stroke-dashoffset', 'stroke-dasharray', 'gradientTransform', 'patternTransform']);

function roundNumbers(v: string, p: number, compact: boolean): string {
  let out = v.replace(/-?(?:\d+\.\d+|\.\d+|\d+)(?:e[-+]?\d+)?/gi, (m) => {
    const num = Number(m);
    if (!Number.isFinite(num)) return m;
    let s = String(Number(num.toFixed(p)));
    if (compact) s = s.replace(/^(-?)0\./, '$1.');
    return s;
  });
  if (compact) out = out.replace(/,/g, ' ').replace(/\s+/g, ' ').replace(/\s*([A-Za-z])\s*/g, '$1').replace(/,?\s*(-)/g, '$1').trim();
  return out;
}

/** Ids that something references (url(#id), href="#id", aria-*), which must be kept. */
function referencedIds(nodes: XNode[], out = new Set<string>()): Set<string> {
  for (const x of nodes) {
    if (x.type === 'el') {
      for (const [k, v] of x.attrs) {
        for (const m of v.matchAll(/url\(\s*['"]?#([^'")\s]+)/g)) out.add(m[1]);
        if ((k === 'href' || k === 'xlink:href') && v.startsWith('#')) out.add(v.slice(1));
        if (k === 'aria-labelledby' || k === 'aria-describedby') v.split(/\s+/).forEach((id) => out.add(id));
      }
      referencedIds(x.children, out);
    } else if (x.type === 'text' || x.type === 'cdata') {
      for (const m of x.text.matchAll(/#([A-Za-z_][\w-]*)/g)) out.add(m[1]);
    }
  }
  return out;
}

export function optimizeSvg(src: string, o: SvgOptions = SVG_DEFAULTS): string {
  const tree = parseXml(src);
  const refs = referencedIds(tree);
  const svgRoot = tree.find((x): x is Extract<XNode, { type: 'el' }> => x.type === 'el' && x.name === 'svg');
  if (!svgRoot) throw new Error('No <svg> element');
  const clean = (nodes: XNode[], inText: boolean): XNode[] => {
    const out: XNode[] = [];
    for (const x of nodes) {
      if (x.type === 'comment' || x.type === 'pi' || x.type === 'doctype') continue;
      if (x.type === 'text') { if (inText ? x.text : x.text.trim()) out.push(inText ? x : { type: 'text', text: x.text.trim() }); continue; }
      if (x.type !== 'el') { out.push(x); continue; }
      if (DROP_ELEMENTS.has(x.name) || EDITOR_NS.test(x.name)) continue;
      if (!o.keepTitle && (x.name === 'title' || x.name === 'desc')) continue;
      let attrs = x.attrs.filter(([k, v]) =>
        !EDITOR_NS.test(k) && !/^xmlns:(inkscape|sodipodi|sketch|serif|dc|cc|rdf|i|x|a|graph|figma|vectornator)$/.test(k)
        && !(k === 'id' && !refs.has(v)) && k !== 'data-name' && k !== 'enable-background' && k !== 'xml:space'
        && !(x === svgRoot && (k === 'version' || k === 'baseProfile' || ((k === 'x' || k === 'y') && /^0(px)?$/.test(v.trim())) || k === 'xmlns:xlink' && !JSON.stringify(nodes).includes('xlink:'))));
      attrs = attrs.map(([k, v]) => [k, NUMERIC.has(k) ? roundNumbers(v, o.precision, k === 'd' || k === 'points') : k === 'style' ? v.replace(/\s*;\s*$/, '').replace(/\s*([:;])\s*/g, '$1').trim() : v.trim()]);
      if (o.currentColor) attrs = attrs.map(([k, v]) => [k, (k === 'fill' || k === 'stroke') && v !== 'none' && !v.startsWith('url(') ? 'currentColor' : v]);
      const children = clean(x.children, inText || x.name === 'text' || x.name === 'tspan' || x.name === 'style' || x.name === 'textPath');
      // An attribute-less <g> is only a wrapper; an empty <g>/<defs> does nothing.
      if ((x.name === 'g' || x.name === 'defs') && !children.length) continue;
      if (x.name === 'g' && !attrs.length) { out.push(...children); continue; }
      out.push({ type: 'el', name: x.name, attrs, children });
    }
    return out;
  };
  const [root] = clean([svgRoot], false) as Extract<XNode, { type: 'el' }>[];
  if (!root.attrs.some(([k]) => k === 'xmlns')) root.attrs.unshift(['xmlns', 'http://www.w3.org/2000/svg']);
  const get = (k: string) => root.attrs.find(([a]) => a === k)?.[1];
  if (o.removeDimensions) {
    const w = parseFloat(get('width') ?? ''), h = parseFloat(get('height') ?? '');
    if (!get('viewBox') && w && h) root.attrs.push(['viewBox', `0 0 ${w} ${h}`]);
    if (get('viewBox')) root.attrs = root.attrs.filter(([k]) => k !== 'width' && k !== 'height');
  }
  return serialize([root], o.pretty).trim();
}

const REACT_RENAME: Record<string, string> = { class: 'className', for: 'htmlFor', 'xlink:href': 'xlinkHref', 'xml:space': 'xmlSpace', 'xml:lang': 'xmlLang', 'xmlns:xlink': 'xmlnsXlink', tabindex: 'tabIndex' };
const camel = (k: string) => k.replace(/[:-]([a-z])/g, (_, c: string) => c.toUpperCase());

function styleObject(s: string): string {
  const pairs = s.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const i = d.indexOf(':'); return [camel(d.slice(0, i).trim()), d.slice(i + 1).trim()]; });
  return `{{ ${pairs.map(([k, v]) => `${k}: ${/^-?\d+(\.\d+)?$/.test(v) ? v : JSON.stringify(v)}`).join(', ')} }}`;
}

/** A typed React component from (already optimized) SVG text. */
export function svgToReact(svg: string, name = 'Icon'): string {
  const [root] = parseXml(svg).filter((x) => x.type === 'el') as Extract<XNode, { type: 'el' }>[];
  if (!root) throw new Error('No <svg> element');
  const jsx = (x: XNode, depth: number): string => {
    const pad = '  '.repeat(depth);
    if (x.type === 'text' || x.type === 'cdata') { const t = x.text.trim(); return t ? `${pad}${/[{}<>]/.test(t) ? `{${JSON.stringify(t)}}` : t}\n` : ''; }
    if (x.type !== 'el') return '';
    const attrs = x.attrs.filter(([k]) => k !== 'xmlns:xlink' || depth === 3).map(([k, v]) => {
      const key = REACT_RENAME[k] ?? (/^(data|aria)-/.test(k) ? k : camel(k));
      return key === 'style' ? `${key}=${styleObject(v)}` : `${key}=${JSON.stringify(v)}`;
    });
    if (x === root) attrs.push('{...props}');
    const open = `<${x.name}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
    if (x.name === 'style' && x.children.length) return `${pad}${open}>{${JSON.stringify(x.children.map((c) => ('text' in c ? c.text : '')).join(''))}}</${x.name}>\n`;
    if (!x.children.length) return `${pad}${open} />\n`;
    return `${pad}${open}>\n${x.children.map((c) => jsx(c, depth + 1)).join('')}${pad}</${x.name}>\n`;
  };
  return `import type { SVGProps } from 'react';\n\nexport default function ${name}(props: SVGProps<SVGSVGElement>) {\n  return (\n${jsx(root, 2).replace(/\n$/, '')}\n  );\n}\n`;
}

/** URL-encoded data URI: only the characters that break CSS url() or HTML attributes are escaped. Smaller than base64. */
export function svgDataUri(svg: string): string {
  const s = svg.trim().replace(/\s+/g, ' ').replace(/"/g, "'").replace(/[\r\n%#()<>?[\\\]^`{|}]/g, encodeURIComponent);
  return `data:image/svg+xml,${s}`;
}

export function svgBase64Uri(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

export function byteLength(s: string): number { return new TextEncoder().encode(s).length; }
