// Small DOM helpers, number formatting, tooltip, downloads.
const SVG_NS = 'http://www.w3.org/2000/svg';
const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'indeterminate']);

export function h(tag, props, ...kids) {
  const isSvg = tag.startsWith('svg:');
  const el = isSvg ? document.createElementNS(SVG_NS, tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (!isSvg && PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, kids);
  return el;
}
export const svg = (tag, props, ...kids) => h('svg:' + tag, props, ...kids);
export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return el;
}
export const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const debounce = (fn, ms = 120) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const nextFrame = () => new Promise(r => setTimeout(r, 0));

// ---- formatting (true minus sign, thin grouping)
const MINUS = '−';
const ok = x => x != null && Number.isFinite(x);
export const fmt = {
  pct: (x, d = 0) => ok(x) ? `${(100 * x).toFixed(d)}%`.replace('-', MINUS) : 'n/a',
  pct1: x => fmt.pct(x, 1),
  num: (x, d = 2) => ok(x) ? x.toFixed(d).replace('-', MINUS) : 'n/a',
  int: x => ok(x) ? Math.round(x).toLocaleString('en-US') : 'n/a',
  signed: (x, d = 2) => ok(x) ? (x >= 0 ? '+' : MINUS) + Math.abs(x).toFixed(d) : 'n/a',
  pts: (x, d = 1) => ok(x) ? (x >= 0 ? '+' : MINUS) + Math.abs(100 * x).toFixed(d) + ' points' : 'n/a',
  range: (lo, hi, d = 2) => `${fmt.num(lo, d)} to ${fmt.num(hi, d)}`,
  prange: (lo, hi, d = 0) => `${fmt.pct(lo, d)} to ${fmt.pct(hi, d)}`,
  months: x => ok(x) ? `${x.toFixed(0)} months` : 'n/a',
  p: x => !ok(x) ? 'n/a' : x < 0.001 ? 'p < 0.001' : `p = ${x.toFixed(x < 0.01 ? 3 : 2)}`,
};

// ---- tooltip (single shared element; text only, never markup)
let tipEl;
const tip = () => (tipEl ||= document.getElementById('tip'));
export function showTip(title, rows, x, y) {
  const el = tip();
  clear(el);
  if (title) el.append(h('div', { class: 'tip-title', text: title }));
  for (const r of rows) {
    el.append(h('div', { class: 'tip-row' },
      r.color ? h('span', { class: 'tip-key', style: { background: r.color } }) : null,
      h('span', { class: 'tip-val', text: r.value }),
      r.name ? h('span', { class: 'tip-name', text: r.name }) : null));
  }
  el.hidden = false;
  const w = el.offsetWidth, hgt = el.offsetHeight, pad = 12;
  let left = x + 14, top = y + 14;
  if (left + w + pad > innerWidth) left = x - w - 14;
  if (left < pad) left = pad;
  if (top + hgt + pad > innerHeight) top = y - hgt - 14;
  if (top < pad) top = pad;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}
export const hideTip = () => { const el = tip(); if (el) el.hidden = true; };

export function download(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Typographic tidy for strings produced by the analysis code: ranges read "a to b", negatives use a true minus.
export const tidy = s => String(s).replace(/(\d)-(\d)/g, '$1 to $2').replace(/(^|[\s(])-(?=\d)/g, '$1\u2212').replace(/I-squared/g, 'I\u00B2');

export const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage can be unavailable */ } },
};
