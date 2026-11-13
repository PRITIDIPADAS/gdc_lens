import './style.css';
import { h, svg, clear, store } from './lib/dom.js';

const ROUTES = {
  predict: { label: 'Predict', title: 'Prognosis check', load: () => import('./pages/predict.js') },
  evidence: { label: 'Evidence', title: 'Evidence', load: () => import('./pages/evidence.js') },
  labels: { label: 'Label audit', title: 'Label audit', load: () => import('./pages/labels.js') },
  hospital: { label: 'Hospital', title: 'Hospital check', load: () => import('./pages/hospital.js') },
  live: { label: 'Live GDC', title: 'Live GDC', load: () => import('./pages/live.js') },
  methods: { label: 'Methods', title: 'Methods and limits', load: () => import('./pages/methods.js') },
};
const DEFAULT = 'predict';
const NAME = 'GDC Lens';

const lens = () => svg('svg', { viewBox: '0 0 64 64', 'aria-hidden': 'true' },
  svg('defs', {}, svg('linearGradient', { id: 'lensg', x1: 0, x2: 1, y1: 0, y2: 1 }, svg('stop', { offset: 0, 'stop-color': 'var(--brand-a)' }), svg('stop', { offset: 1, 'stop-color': 'var(--brand-b)' }))),
  svg('circle', { cx: 28, cy: 28, r: 17, fill: 'none', stroke: 'url(#lensg)', 'stroke-width': 7 }),
  svg('path', { d: 'M41 41l15 15', stroke: 'url(#lensg)', 'stroke-width': 7, 'stroke-linecap': 'round' }));

const sun = () => svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'aria-hidden': 'true' },
  svg('circle', { cx: 12, cy: 12, r: 4 }), svg('path', { d: 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' }));
const moon = () => svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, svg('path', { d: 'M20 14.5A8.5 8.5 0 1 1 9.5 4 6.7 6.7 0 0 0 20 14.5Z' }));

const isDark = () => {
  const t = document.documentElement.getAttribute('data-theme');
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};

function buildChrome() {
  const top = document.getElementById('top');
  const themeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Switch colour theme' });
  const setIcon = () => { clear(themeBtn); themeBtn.append(isDark() ? sun() : moon()); };
  themeBtn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store.set('gdclens-theme', next);
    setIcon();
  });
  setIcon();
  const nav = h('nav', { class: 'nav', 'aria-label': 'Sections' },
    Object.entries(ROUTES).map(([k, r]) => h('a', { href: `#/${k}`, 'data-route': k, text: r.label })));
  top.append(h('div', { class: 'top-in' },
    h('a', { class: 'brand', href: `#/${DEFAULT}`, 'aria-label': `${NAME}, home` }, lens(), h('span', { class: 'brand-word', text: NAME })),
    nav, h('div', { class: 'tools' },
      h('a', { class: 'btn quiet', href: 'https://github.com/PRITIDIPADAS/gdc_lens', target: '_blank', rel: 'noopener', text: 'Code' }), themeBtn)));
  document.getElementById('foot').append(h('div', { class: 'foot-in' },
    h('p', {}, 'Research use only. GDC Lens is not a medical device and its estimates are not for decisions about individual patients.'),
    h('p', {}, 'Data: NCI Genomic Data Commons (TCGA-BRCA, release 46) and METABRIC through cBioPortal. Everything on these pages runs in your browser; nothing you enter is sent anywhere, except the Live GDC page, which reads public cases from the GDC.'),
    h('p', {}, 'Code, analysis plan and deviations: ', h('a', { href: 'https://github.com/PRITIDIPADAS/gdc_lens', target: '_blank', rel: 'noopener', text: 'github.com/PRITIDIPADAS/gdc_lens' }), '. MIT licence. Fonts: Inter, Fraunces and JetBrains Mono (SIL Open Font License).')));
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const name = ROUTES[path] ? path : DEFAULT;
  return { name, params: new URLSearchParams(query || '') };
}

let token = 0;
async function show() {
  const my = ++token;
  const { name, params } = parseHash();
  const main = document.getElementById('main');
  document.querySelectorAll('.nav a').forEach(a => (a.dataset.route === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  document.title = `${ROUTES[name].title} | ${NAME}`;
  clear(main);
  main.append(h('div', { class: 'wrap' }, h('p', { class: 'muted', style: { padding: '40px 0' }, role: 'status', text: 'Loading' })));
  try {
    const mod = await ROUTES[name].load();
    if (my !== token) return;
    clear(main);
    const ctx = {
      params,
      setParams(obj) {
        const q = new URLSearchParams(obj);
        history.replaceState(null, '', `#/${name}?${q}`);
      },
    };
    await mod.render(main, ctx);
    if (my === token) window.scrollTo(0, 0);
  } catch (err) {
    if (my !== token) return;
    clear(main);
    main.append(h('div', { class: 'wrap' }, h('div', { class: 'note warn', style: { margin: '40px 0' }, role: 'alert' },
      h('p', { text: 'This page could not be loaded.' }), h('p', { class: 'small', text: String(err && err.message || err) }))));
    console.error(err);
  }
}

buildChrome();
addEventListener('hashchange', show);
show();
