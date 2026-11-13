// Shared interface pieces: status glyphs, segmented controls, hypothesis status marks.
import { h, svg } from './dom.js';

const KEYS = { G: 'good', A: 'caution', R: 'fail' };
export function light(kind, size = 22) {
  const common = { class: 'light', viewBox: '0 0 24 24', width: size, height: size, role: 'img', 'aria-label': { G: 'Pass', A: 'Borderline', R: 'Fail' }[kind] };
  if (kind === 'G') return svg('svg', common, svg('circle', { cx: 12, cy: 12, r: 10.5, style: { fill: 'var(--good)' } }),
    svg('path', { d: 'M7 12.6l3.3 3.2 6.7-7', fill: 'none', stroke: '#fff', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  if (kind === 'A') return svg('svg', common, svg('path', { d: 'M12 2.4 22.6 21H1.4Z', style: { fill: 'var(--warn)' }, 'stroke-linejoin': 'round' }),
    svg('path', { d: 'M12 9v5.4', stroke: '#241800', 'stroke-width': 2.4, 'stroke-linecap': 'round' }), svg('circle', { cx: 12, cy: 17.6, r: 1.5, fill: '#241800' }));
  return svg('svg', common, svg('rect', { x: 1.8, y: 1.8, width: 20.4, height: 20.4, rx: 5.5, style: { fill: 'var(--crit)' } }),
    svg('path', { d: 'M8 8l8 8M16 8l-8 8', stroke: '#fff', 'stroke-width': 2.4, 'stroke-linecap': 'round' }));
}
export { KEYS };

// Hypothesis status marks: filled = supported, half = partly, outline = not supported (shape and label, not colour alone).
export function statusMark(status) {
  const base = { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': 'true' };
  const ring = svg('circle', { cx: 12, cy: 12, r: 9.5, fill: 'none', style: { stroke: 'var(--hema)' }, 'stroke-width': 2 });
  if (status === 'supported') return svg('svg', base, svg('circle', { cx: 12, cy: 12, r: 10.5, style: { fill: 'var(--hema)' } }), svg('path', { d: 'M7 12.5l3.3 3.2 6.7-7', fill: 'none', stroke: 'var(--surface)', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  if (status === 'partly supported') return svg('svg', base, ring, svg('path', { d: 'M12 2.5a9.5 9.5 0 0 1 0 19Z', style: { fill: 'var(--hema)' } }));
  return svg('svg', base, ring, svg('path', { d: 'M8 12h8', style: { stroke: 'var(--hema)' }, 'stroke-width': 2.4, 'stroke-linecap': 'round' }));
}

// Segmented control with radio semantics and arrow-key navigation.
export function seg({ label, options, value, onChange }) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
  const btns = options.map(o => h('button', { type: 'button', role: 'radio', 'aria-checked': String(o.value === value), tabindex: o.value === value ? 0 : -1, 'data-v': o.value },
    o.label, o.sub ? h('small', { text: o.sub }) : null));
  const select = (i, focus) => {
    btns.forEach((b, j) => { b.setAttribute('aria-checked', String(i === j)); b.tabIndex = i === j ? 0 : -1; });
    if (focus) btns[i].focus();
    onChange(options[i].value);
  };
  btns.forEach((b, i) => {
    b.addEventListener('click', () => select(i));
    b.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); select((i + 1) % btns.length, true); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); select((i + btns.length - 1) % btns.length, true); }
    });
  });
  wrap.append(...btns);
  return wrap;
}

export const note = (text, kind = '') => h('div', { class: `note ${kind}` }, text);

// A table wider than its box scrolls sideways, and keyboard users must be able to focus it to scroll.
export function scrollable(wrap, label) {
  const check = () => {
    if (wrap.scrollWidth > wrap.clientWidth + 1) { wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', label); }
    else { wrap.removeAttribute('tabindex'); wrap.removeAttribute('role'); wrap.removeAttribute('aria-label'); }
  };
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(check);
    ro.observe(wrap);
    if (wrap.firstElementChild) ro.observe(wrap.firstElementChild);
  }
  check();
  return wrap;
}

export function table(head, rows, opts = {}) {
  return scrollable(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
    opts.caption ? h('caption', { class: 'visually-hidden', text: opts.caption }) : null,
    h('thead', {}, h('tr', {}, head.map((c, i) => h('th', { scope: 'col', class: opts.left?.includes(i) ? 'l' : null }, c === '' ? h('span', { class: 'visually-hidden', text: 'Measure' }) : c)))),
    h('tbody', {}, rows.map(r => h('tr', { class: r.hl ? 'hl' : null }, (r.cells || r).map((c, i) => h(i === 0 ? 'th' : 'td', { scope: i === 0 ? 'row' : null, class: opts.left?.includes(i) ? 'l' : null, style: i === 0 ? { fontWeight: 500, textAlign: 'left' } : null }, c))))))), opts.caption || 'Table');
}

export const section = (id, title, lede, ...kids) => h('section', { class: 'section', id }, h('div', { class: 'section-head' }, h('h2', { text: title }), lede ? h('p', { text: lede }) : null), ...kids);
