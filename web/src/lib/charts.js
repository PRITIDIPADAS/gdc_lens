// Chart toolkit: figure frame with table view, xy (lines, bands, points, whiskers), forest plot, horizontal bars.
// Marks follow fixed specs: 2 px lines, markers of at least 8 px with a surface ring, hairline solid grid, bars at most 24 px.
import { h, svg, clear, debounce, fmt, showTip, hideTip } from './dom.js';
import { scrollable } from './ui.js';

export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];
const NEUTRAL = 'var(--muted)';
const f1 = v => (Math.round(v * 10) / 10).toString();
let uid = 0;

// ---------- scales and ticks ----------
export function niceTicks(lo, hi, n = 5) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toPrecision(12));
  return out;
}
const logTicks = (lo, hi) => [0.0625, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16].filter(v => v >= lo * 0.999 && v <= hi * 1.001);
export function scale(kind, d0, d1, r0, r1) {
  if (kind === 'log') {
    const a = Math.log(d0), b = Math.log(d1);
    return v => r0 + (Math.log(Math.max(v, d0 * 1e-6)) - a) / (b - a) * (r1 - r0);
  }
  return v => r0 + (v - d0) / (d1 - d0) * (r1 - r0);
}
const tickFmt = (ticks, custom) => {
  if (custom) return custom;
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
  const d = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
  return v => fmt.num(v, d);
};

// ---------- figure frame ----------
export function figure({ title, caption, draw, table, legend }) {
  const body = h('div', { class: 'fig-body' });
  const tbl = h('div', { class: 'tbl-wrap', hidden: true });
  let showTable = false, built = false, lastW = 0;
  const toggle = h('button', { class: 'fig-toggle', type: 'button', 'aria-pressed': 'false', text: 'Table view' });
  const render = () => {
    const w = Math.floor(body.clientWidth);
    if (!w || (w === lastW && body.firstChild)) return;
    lastW = w;
    clear(body);
    draw(body, w);
  };
  toggle.addEventListener('click', () => {
    showTable = !showTable;
    toggle.setAttribute('aria-pressed', String(showTable));
    toggle.textContent = showTable ? 'Chart view' : 'Table view';
    body.hidden = showTable; tbl.hidden = !showTable;
    if (legendEl) legendEl.hidden = showTable;
    if (showTable && !built) { buildTable(tbl, table()); scrollable(tbl, `${title}, as a table`); built = true; }
    if (!showTable) { lastW = 0; requestAnimationFrame(render); }
  });
  const legendEl = legend && legend.length > 1 ? makeLegend(legend) : null;
  const fig = h('figure', { class: 'fig' },
    h('div', { class: 'fig-head' }, h('div', { class: 'fig-title', text: title }), table ? toggle : null),
    legendEl, body, tbl, caption ? h('figcaption', { class: 'fig-cap' }, caption) : null);
  new ResizeObserver(debounce(render, 60)).observe(body);
  fig.redraw = () => { lastW = 0; render(); };
  return fig;
}

export function makeLegend(items) {
  return h('div', { class: 'legend' }, items.map(it => h('span', {},
    h('i', { class: `swatch ${it.kind === 'line' ? 'line' : ''} ${it.ring ? 'ring' : ''}`, style: { background: it.color, color: it.color } }), it.name)));
}

function buildTable(host, t) {
  clear(host);
  host.append(h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, t.head.map(c => h('th', { scope: 'col', text: c })))),
    h('tbody', {}, t.rows.map(r => h('tr', {}, r.map((c, i) => h(i === 0 ? 'th' : 'td', { scope: i === 0 ? 'row' : null, text: c, style: i === 0 ? { fontWeight: 500, textAlign: 'left' } : null })))))));
}

// ---------- helpers ----------
function root(w, hgt, label, extra = {}) {
  return svg('svg', { class: 'ch', viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, role: 'img', 'aria-label': label, ...extra });
}
const line = (x1, y1, x2, y2, cls, extra) => svg('line', { x1: f1(x1), y1: f1(y1), x2: f1(x2), y2: f1(y2), class: cls, ...extra });
const text = (x, y, s, anchor = 'start', cls, extra) => svg('text', { x: f1(x), y: f1(y), 'text-anchor': anchor, class: cls, ...extra }, s);
function tipAt(el, title, rows) {
  const show = e => {
    if (e.clientX !== undefined && e.type !== 'focus') showTip(title, rows, e.clientX, e.clientY);
    else { const r = el.getBoundingClientRect(); showTip(title, rows, r.left + r.width / 2, r.top + r.height / 2); }
  };
  el.addEventListener('pointerenter', show);
  el.addEventListener('pointermove', show);
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('focus', show);
  el.addEventListener('blur', hideTip);
}
const ring = 'var(--surface)';

// ---------- xy ----------
// o: {height, x:{domain,scale,ticks,format,label}, y:{...}, series:[{name,color,pts,kind:'line'|'step'|'points',band,whisk,endLabel,dashed,dot}],
//     refs:[{axis,v,label}], diag, cross, aria, tip:{title(x), fmtY}}
export function xy(host, w, o) {
  const H = o.height || 300;
  const endLen = Math.max(0, ...o.series.filter(s => s.endLabel).map(s => String(s.endLabel).length));
  const m = { t: o.y.label ? 22 : 10, r: 14 + (endLen ? endLen * 6.3 : 0), b: o.x.label ? 46 : 28, l: o.y.tickWidth || 46, ...(o.margin || {}) };
  const x0 = m.l, x1 = w - m.r, y0 = H - m.b, y1 = m.t;
  const sx = scale(o.x.scale, o.x.domain[0], o.x.domain[1], x0, x1);
  const sy = scale(o.y.scale, o.y.domain[0], o.y.domain[1], y0, y1);
  const xt = o.x.ticks || (o.x.scale === 'log' ? logTicks(...o.x.domain) : niceTicks(o.x.domain[0], o.x.domain[1], Math.max(3, Math.round((x1 - x0) / 90))));
  const yt = o.y.ticks || (o.y.scale === 'log' ? logTicks(...o.y.domain) : niceTicks(o.y.domain[0], o.y.domain[1], 5));
  const xf = tickFmt(xt, o.x.format), yf = tickFmt(yt, o.y.format);
  const s = root(w, H, o.aria || o.y.label || 'Chart', o.cross ? { tabindex: 0 } : {});
  yt.forEach(v => { s.append(line(x0, sy(v), x1, sy(v), 'gl')); s.append(text(x0 - 8, sy(v) + 4, yf(v), 'end')); });
  s.append(line(x0, y0, x1, y0, 'ax'));
  xt.forEach(v => { s.append(line(sx(v), y0, sx(v), y0 + 4, 'ax')); s.append(text(sx(v), y0 + 18, xf(v), 'middle')); });
  if (o.x.label) s.append(text((x0 + x1) / 2, H - 6, o.x.label, 'middle'));
  if (o.y.label) s.append(text(2, 12, o.y.label, 'start', 'strong'));
  (o.refs || []).forEach(r => {
    if (r.axis === 'y') { s.append(line(x0, sy(r.v), x1, sy(r.v), 'ref')); if (r.label) s.append(text(r.left ? x0 + 6 : x1, sy(r.v) - 5, r.label, r.left ? 'start' : 'end', 'ref-t')); }
    else { s.append(line(sx(r.v), y1, sx(r.v), y0, 'ref')); if (r.label) s.append(text(sx(r.v) + 5, y1 + 11, r.label, 'start', 'ref-t')); }
  });
  if (o.diag) s.append(line(sx(o.diag[0]), sy(o.diag[0]), sx(o.diag[1]), sy(o.diag[1]), 'ref', { 'stroke-dasharray': 'none', opacity: 0.55 }));
  const path = pts => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f1(sx(x))},${f1(sy(y))}`).join('');
  const cid = `clip${++uid}`;
  s.append(svg('defs', {}, svg('clipPath', { id: cid }, svg('rect', { x: x0 - 1, y: y1 - 2, width: x1 - x0 + 2, height: y0 - y1 + 4 }))));
  const plotG = svg('g', { 'clip-path': `url(#${cid})` });
  s.append(plotG);
  const inDom = (x, y) => x >= o.x.domain[0] && x <= o.x.domain[1] && y >= o.y.domain[0] && y <= o.y.domain[1];
  for (const se of o.series) {
    const col = se.color;
    if (se.band) {
      const up = se.pts.map(([x], i) => [x, se.band[i][1]]), dn = se.pts.map(([x], i) => [x, se.band[i][0]]).reverse();
      const d = path(up) + path(dn).replace(/^M/, 'L') + 'Z';
      plotG.append(svg('path', { d, style: { fill: col, opacity: 0.12 } }));
    }
    if (se.kind === 'points') continue;
    const d = se.kind === 'step' ? `M${f1(sx(se.pts[0][0]))},${f1(sy(se.pts[0][1]))}` + se.pts.slice(1).map(([x, y]) => `H${f1(sx(x))}V${f1(sy(y))}`).join('') : path(se.pts);
    plotG.append(svg('path', { d, fill: 'none', style: { stroke: col }, 'stroke-width': se.width || 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': se.dashed ? '6 5' : null }));
    if (se.dot !== false && se.pts.length && inDom(...se.pts[se.pts.length - 1])) {
      const [lx, ly] = se.pts[se.pts.length - 1];
      s.append(svg('circle', { cx: f1(sx(lx)), cy: f1(sy(ly)), r: 4, style: { fill: col, stroke: ring }, 'stroke-width': 2 }));
    }
    if (se.endLabel && se.pts.length) { const [lx, ly] = se.pts[se.pts.length - 1]; s.append(text(sx(lx) + 10, sy(ly) + 4, se.endLabel, 'start', 'strong')); }
  }
  // points with optional whiskers; each is its own focus/hover target
  for (const se of o.series.filter(q => q.kind === 'points')) {
    se.pts.forEach(([x, y], i) => {
      const wk = se.whisk && se.whisk[i];
      const g = svg('g', { class: 'mk', tabindex: 0, role: 'img', 'aria-label': `${se.name} ${(o.x.label || 'x')} ${xf(x)}, ${(o.y.label || 'y')} ${yf(y)}` });
      if (wk) { g.append(line(sx(x), sy(wk[0]), sx(x), sy(wk[1]), '', { style: { stroke: se.color }, 'stroke-width': 1.5 })); }
      g.append(svg('circle', { class: 'hit-ring', cx: f1(sx(x)), cy: f1(sy(y)), r: 9 }));
      g.append(svg('circle', { cx: f1(sx(x)), cy: f1(sy(y)), r: 4.5, style: { fill: se.color, stroke: ring }, 'stroke-width': 2 }));
      g.append(svg('circle', { cx: f1(sx(x)), cy: f1(sy(y)), r: 14, fill: 'transparent' }));
      const rows = [{ value: (o.tip?.fmtY || yf)(y), name: se.name, color: se.color }];
      if (wk) rows.push({ value: `${(o.tip?.fmtY || yf)(wk[0])} to ${(o.tip?.fmtY || yf)(wk[1])}`, name: '95% interval' });
      if (se.extra && se.extra[i]) rows.push(...se.extra[i]);
      tipAt(g, o.tip?.title ? o.tip.title(x) : `${o.x.label || 'x'} ${xf(x)}`, rows);
      s.append(g);
    });
  }
  if (o.cross) {
    const lines = o.series.filter(q => q.kind !== 'points' && q.pts.length);
    const xs = [...new Set(lines.flatMap(se => se.pts.map(p => p[0])))].sort((a, b) => a - b);
    const cross = line(0, y1, 0, y0, 'cross');
    cross.setAttribute('visibility', 'hidden');
    s.append(cross);
    const overlay = svg('rect', { x: x0, y: y1, width: x1 - x0, height: y0 - y1, fill: 'transparent' });
    let idx = Math.min(xs.length - 1, Math.max(0, Math.round(xs.length / 3)));
    const show = (i, cx, cy) => {
      idx = Math.max(0, Math.min(xs.length - 1, i));
      const xv = xs[idx];
      cross.setAttribute('x1', f1(sx(xv))); cross.setAttribute('x2', f1(sx(xv))); cross.setAttribute('visibility', 'visible');
      const rows = lines.map(se => {
        const q = se.pts.find(p => Math.abs(p[0] - xv) <= 1e-9 * Math.max(1, Math.abs(xv)));
        return q ? { value: (o.tip?.fmtY || yf)(q[1]), name: se.name, color: se.color } : null;
      }).filter(Boolean);
      let px = cx, py = cy;
      if (px === undefined) { const r = s.getBoundingClientRect(); px = r.left + sx(xv) * r.width / w; py = r.top + (y1 + 20) * r.height / H; }
      showTip(o.tip?.title ? o.tip.title(xv) : `${o.x.label || 'x'} ${xf(xv)}`, rows, px, py);
    };
    const near = e => { const r = s.getBoundingClientRect(); const px = (e.clientX - r.left) * w / r.width; let b = 0, bd = Infinity; xs.forEach((xv, i) => { const dd = Math.abs(sx(xv) - px); if (dd < bd) { bd = dd; b = i; } }); return b; };
    overlay.addEventListener('pointermove', e => show(near(e), e.clientX, e.clientY));
    overlay.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
    s.addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show(idx + (e.key === 'ArrowRight' ? 1 : -1)); } });
    s.addEventListener('focus', () => show(idx));
    s.addEventListener('blur', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
    s.append(overlay);
  }
  host.append(s);
  return s;
}

// ---------- forest ----------
// rows: {label, est, lo, hi, pi:[lo,hi], kind:'point'|'pooled'|'head'|'gap', color, right, tipRows}
export function forest(host, w, o) {
  const rows = o.rows;
  // On a phone the long "estimate (low to high)" text moves under each label so the plot keeps its width.
  const stack = w < 520 && rows.some(r => r.kind !== 'head' && r.kind !== 'gap' && r.est != null && r.right === undefined);
  const rowH = stack ? Math.max(o.rowH || 30, 42) : (o.rowH || 30);
  const lw = stack ? Math.min(o.labelWidth || 150, 156) : Math.min(o.labelWidth || 150, w * 0.34), rw = stack ? 0 : (o.rightWidth ?? 128);
  const top = 26, bot = 38;
  const H = top + rows.length * rowH + bot;
  const x0 = lw, x1 = w - rw - (stack ? 14 : 8);
  const sx = scale(o.scale, o.xdomain[0], o.xdomain[1], x0, x1);
  let ticks = o.ticks || (o.scale === 'log' ? logTicks(...o.xdomain) : niceTicks(o.xdomain[0], o.xdomain[1], Math.max(4, Math.round((x1 - x0) / 60))));
  const maxT = Math.max(2, Math.floor((x1 - x0) / 44));
  if (ticks.length > maxT) {
    const k = Math.ceil(ticks.length / maxT), a = o.ref != null ? Math.max(0, ticks.findIndex(v => Math.abs(v - o.ref) < 1e-9)) : 0;
    ticks = ticks.filter((_, i) => (((i - a) % k) + k) % k === 0);
  }
  const tf = tickFmt(ticks, o.format);
  const s = root(w, H, o.aria || 'Forest plot');
  ticks.forEach(v => { s.append(line(sx(v), top - 6, sx(v), H - bot + 2, 'gl')); s.append(text(sx(v), H - bot + 18, tf(v), 'middle')); });
  if (o.xlabel) s.append(text((x0 + x1) / 2, H - 6, o.xlabel, 'middle'));
  if (o.ref != null) { s.append(line(sx(o.ref), top - 6, sx(o.ref), H - bot + 2, 'ref')); if (o.refLabel) s.append(text(sx(o.ref), 10, o.refLabel, 'middle', 'ref-t')); }
  if (o.rightHead && !stack) s.append(text(w - 2, 14, o.rightHead, 'end', 'strong'));
  rows.forEach((r, i) => {
    const cy = top + i * rowH + rowH / 2;
    if (r.kind === 'gap') return;
    if (r.kind === 'head') { s.append(text(0, cy + 4, r.label, 'start', 'strong')); return; }
    if (r.est == null) {
      if (stack) { s.append(text(0, cy - 2, r.label, 'start')); s.append(text(0, cy + 12, r.right || 'not estimable', 'start', 'sub')); }
      else { s.append(text(0, cy + 4, r.label, 'start')); s.append(text(w - 2, cy + 4, r.right || 'not estimable', 'end')); }
      return;
    }
    const g = svg('g', { class: 'mk', tabindex: 0, role: 'img', 'aria-label': `${r.label}: ${(o.fmtEst || tf)(r.est)}${r.lo != null ? `, interval ${(o.fmtEst || tf)(r.lo)} to ${(o.fmtEst || tf)(r.hi)}` : ''}` });
    g.append(svg('rect', { x: 0, y: f1(cy - rowH / 2), width: w, height: rowH, fill: 'transparent' }));
    g.append(text(0, stack ? cy - 2 : cy + 4, r.label, 'start', r.kind === 'pooled' ? 'strong' : ''));
    const col = r.color || (r.kind === 'pooled' ? 'var(--s1)' : 'var(--ink-2)');
    if (r.pi) {
      g.append(line(sx(r.pi[0]), cy, sx(r.pi[1]), cy, '', { style: { stroke: 'var(--ink-2)' }, 'stroke-width': 1 }));
      [r.pi[0], r.pi[1]].forEach(v => g.append(line(sx(v), cy - 5, sx(v), cy + 5, '', { style: { stroke: 'var(--ink-2)' }, 'stroke-width': 1 })));
    }
    if (r.kind === 'pooled') {
      const d = `M${f1(sx(r.lo))},${f1(cy)}L${f1(sx(r.est))},${f1(cy - 8)}L${f1(sx(r.hi))},${f1(cy)}L${f1(sx(r.est))},${f1(cy + 8)}Z`;
      g.append(svg('path', { d, style: { fill: col, stroke: ring }, 'stroke-width': 1.5 }));
    } else {
      if (r.lo != null && r.hi != null) g.append(line(sx(r.lo), cy, sx(r.hi), cy, '', { style: { stroke: col }, 'stroke-width': 2, 'stroke-linecap': 'round' }));
      g.append(svg('circle', { class: 'hit-ring', cx: f1(sx(r.est)), cy: f1(cy), r: 9 }));
      g.append(svg('circle', { cx: f1(sx(r.est)), cy: f1(cy), r: 4.5, style: { fill: col, stroke: ring }, 'stroke-width': 2 }));
    }
    if (r.right !== null) {
      const rt = r.right ?? `${(o.fmtEst || tf)(r.est)} (${(o.fmtEst || tf)(r.lo)} to ${(o.fmtEst || tf)(r.hi)})`;
      g.append(stack ? text(0, cy + 12, rt, 'start', 'sub') : text(w - 2, cy + 4, rt, 'end'));
    }
    const fe = o.fmtEst || tf;
    const tr = [{ value: fe(r.est), name: o.estName || 'estimate' }];
    if (r.lo != null) tr.push({ value: `${fe(r.lo)} to ${fe(r.hi)}`, name: '95% interval' });
    if (r.pi) tr.push({ value: `${fe(r.pi[0])} to ${fe(r.pi[1])}`, name: '95% prediction interval' });
    if (r.tipRows) tr.push(...r.tipRows);
    tipAt(g, r.label, tr);
    s.append(g);
  });
  host.append(s);
  return s;
}

// ---------- horizontal bars ----------
// rows: {label, value, lo, hi, color, text}
export function bars(host, w, o) {
  const rowH = o.rowH || 34, lw = Math.min(o.labelWidth || 150, w * 0.36), rw = 64;
  const top = 8, bot = 34, rows = o.rows, H = top + rows.length * rowH + bot;
  const x0 = lw, x1 = w - rw;
  const sx = scale('linear', 0, o.max, x0, x1);
  const ticks = niceTicks(0, o.max, 5), tf = tickFmt(ticks, o.format);
  const s = root(w, H, o.aria || 'Bar chart');
  ticks.forEach(v => { s.append(line(sx(v), top, sx(v), H - bot, 'gl')); s.append(text(sx(v), H - bot + 18, tf(v), 'middle')); });
  s.append(line(x0, top, x0, H - bot, 'ax'));
  if (o.xlabel) s.append(text((x0 + x1) / 2, H - 4, o.xlabel, 'middle'));
  (o.refs || []).forEach(r => { s.append(line(sx(r.v), top, sx(r.v), H - bot, 'ref')); if (r.label) s.append(text(sx(r.v) + 4, top + 10, r.label, 'start', 'ref-t')); });
  rows.forEach((r, i) => {
    const cy = top + i * rowH + rowH / 2, bh = Math.min(24, rowH - 10), len = Math.max(0, sx(r.value) - x0), rad = Math.min(4, len / 2);
    const g = svg('g', { class: 'mk', tabindex: 0, role: 'img', 'aria-label': `${r.label}: ${(o.fmtVal || tf)(r.value)}` });
    g.append(svg('rect', { x: 0, y: f1(cy - rowH / 2), width: w, height: rowH, fill: 'transparent' }));
    g.append(text(0, cy + 4, r.label, 'start'));
    const d = `M${f1(x0)},${f1(cy - bh / 2)}H${f1(x0 + len - rad)}Q${f1(x0 + len)},${f1(cy - bh / 2)} ${f1(x0 + len)},${f1(cy - bh / 2 + rad)}V${f1(cy + bh / 2 - rad)}Q${f1(x0 + len)},${f1(cy + bh / 2)} ${f1(x0 + len - rad)},${f1(cy + bh / 2)}H${f1(x0)}Z`;
    g.append(svg('path', { d, style: { fill: r.color || 'var(--s1)' } }));
    if (r.lo != null) g.append(line(sx(r.lo), cy, sx(r.hi), cy, '', { style: { stroke: 'var(--ink)' }, 'stroke-width': 1.5 }));
    g.append(text(Math.max(sx(r.value), r.hi != null ? sx(r.hi) : 0) + 8, cy + 4, r.text ?? (o.fmtVal || tf)(r.value), 'start', 'strong'));
    tipAt(g, r.label, [{ value: (o.fmtVal || tf)(r.value), name: o.valName || 'value' }, ...(r.lo != null ? [{ value: `${(o.fmtVal || tf)(r.lo)} to ${(o.fmtVal || tf)(r.hi)}`, name: '95% interval' }] : [])]);
    s.append(g);
  });
  host.append(s);
  return s;
}

export { NEUTRAL };
