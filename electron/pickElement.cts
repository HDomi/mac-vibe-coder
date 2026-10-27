/**
 * Element picker for the Browser panel: injected into the page's main world (so framework debug data
 * on DOM nodes is reachable), it outlines the element under the pointer and resolves with a
 * description of the one clicked, or null on Escape. The click itself never reaches the page.
 */
export const PICK_SCRIPT = String.raw`new Promise((resolve) => {
  const box = document.createElement('div');
  const tag = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #38bdf8;background:rgba(56,189,248,.12);border-radius:3px;transition:all .04s;';
  tag.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:#0c4a6e;color:#e0f2fe;font:11px/1.4 ui-monospace,Menlo,monospace;padding:2px 6px;border-radius:3px;white-space:nowrap;';
  document.documentElement.append(box, tag);
  let cur = null;
  const label = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + [...el.classList].slice(0, 2).map((c) => '.' + c).join('');
  const move = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === box || el === tag) return;
    cur = el;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    tag.textContent = label(el) + '  ' + Math.round(r.width) + '×' + Math.round(r.height);
    Object.assign(tag.style, { left: Math.max(0, r.left) + 'px', top: (r.top > 22 ? r.top - 22 : r.bottom + 4) + 'px' });
  };
  const goodClass = (c) => /^[a-zA-Z][\w-]{1,40}$/.test(c) && !/\d{3,}|^(css|sc|jsx|svelte|emotion)-/.test(c);
  const part = (el) => {
    if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) return '#' + el.id;
    const test = el.getAttribute('data-testid') || el.getAttribute('data-test');
    if (test) return el.tagName.toLowerCase() + '[data-testid="' + test + '"]';
    let s = el.tagName.toLowerCase() + [...el.classList].filter(goodClass).slice(0, 2).map((c) => '.' + CSS.escape(c)).join('');
    const sibs = el.parentElement ? [...el.parentElement.children].filter((x) => x.tagName === el.tagName) : [];
    if (sibs.length > 1) s += ':nth-of-type(' + (sibs.indexOf(el) + 1) + ')';
    return s;
  };
  const selector = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement && parts.length < 5; n = n.parentElement) {
      const p = part(n); parts.unshift(p);
      if (p.startsWith('#') || p.includes('[data-testid')) break;
    }
    return parts.join(' > ');
  };
  // Where the component was written, when the page is a dev build that keeps this on its nodes.
  const source = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const fiberKey = Object.keys(n).find((k) => k.startsWith('__reactFiber$'));
      for (let f = fiberKey ? n[fiberKey] : null, i = 0; f && i < 30; f = f.return, i++) {
        const s = f._debugSource;
        if (s && s.fileName) return s.fileName + ':' + s.lineNumber + (typeof f.type === 'function' && f.type.name ? ' (' + f.type.name + ')' : '');
      }
      const vue = n.__vueParentComponent;
      if (vue && vue.type && vue.type.__file) return vue.type.__file + (vue.type.__name ? ' (' + vue.type.__name + ')' : '');
      if (n.__svelte_meta && n.__svelte_meta.loc) return n.__svelte_meta.loc.file + ':' + n.__svelte_meta.loc.line;
      if (fiberKey || vue) break;
    }
    return null;
  };
  const STYLE_KEYS = ['display', 'position', 'width', 'height', 'margin', 'padding', 'color', 'background-color', 'font-size', 'font-weight', 'line-height', 'font-family', 'border', 'border-radius', 'gap', 'flex-direction', 'justify-content', 'align-items', 'grid-template-columns', 'opacity', 'z-index', 'box-shadow'];
  const SKIP = new Set(['none', 'normal', 'auto', '0px', 'static', 'rgba(0, 0, 0, 0)', '1', 'visible']);
  const finish = (value) => {
    removeEventListener('mousemove', move, true); removeEventListener('click', click, true); removeEventListener('keydown', key, true);
    removeEventListener('mousedown', swallow, true); removeEventListener('mouseup', swallow, true);
    box.remove(); tag.remove();
    resolve(value);
  };
  const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };
  const click = (e) => {
    swallow(e);
    const el = cur || document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return finish(null);
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const styles = {};
    const flex = /flex/.test(cs.display); const grid = /grid/.test(cs.display);
    for (const k of STYLE_KEYS) {
      let v = cs.getPropertyValue(k);
      if (!v || SKIP.has(v) || (k === 'border' && v.startsWith('0px'))) continue;
      if ((k === 'flex-direction' || k === 'justify-content' || k === 'align-items') && !flex) continue;
      if ((k === 'grid-template-columns' || k === 'gap') && !flex && !grid) continue;
      if (k === 'width' || k === 'height') v = Math.round(parseFloat(v)) + 'px';
      styles[k] = v;
    }
    const html = el.outerHTML.replace(/\s+/g, ' ');
    finish({ selector: selector(el), tag: el.tagName.toLowerCase(), text: (el.innerText || '').trim().slice(0, 160), html: html.length > 700 ? html.slice(0, 700) + '…' : html, styles, source: source(el), url: location.href, rect: { x: r.left, y: r.top, width: r.width, height: r.height }, viewport: { width: innerWidth, height: innerHeight } });
  };
  const key = (e) => { if (e.key === 'Escape') { swallow(e); finish(null); } };
  addEventListener('mousemove', move, true); addEventListener('click', click, true); addEventListener('keydown', key, true);
  addEventListener('mousedown', swallow, true); addEventListener('mouseup', swallow, true);
  setTimeout(() => finish(null), 120000);
})`;
