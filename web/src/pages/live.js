import { h, clear, fmt } from '../lib/dom.js';
import { loadResults, loadReduced } from '../lib/data.js';
import { table, section, note } from '../lib/ui.js';
import { casesUrl, statusUrl, parseGdc, liveMetrics, getJson, API } from '../lib/gdc.js';

const SNAP = 'Snapshot, release 46';
const sInt = d => (d === 0 ? '0' : `${d > 0 ? '+' : '−'}${fmt.int(Math.abs(d))}`);
const sNum = (d, k = 2) => (Math.abs(d) < 0.5 * 10 ** -k ? '0' : fmt.signed(d, k));

const tile = (label, value, sub) => h('div', { class: 'metric' }, h('span', { text: label }), h('b', { text: value }), sub ? h('small', { text: sub }) : null);

function compareTable(snap, live) {
  const kap = m => `${fmt.num(m.kappa36, 2)} (${fmt.num(m.kappa_lo, 2)} to ${fmt.num(m.kappa_hi, 2)})`;
  const rows = [
    ['Patients analysed', fmt.int(snap.n), fmt.int(live.n), sInt(live.n - snap.n)],
    ['Deaths', fmt.int(snap.deaths), fmt.int(live.deaths), sInt(live.deaths - snap.deaths)],
    ['Median follow-up (months)', fmt.num(snap.followup_median, 1), fmt.num(live.followup_median, 1), sNum(live.followup_median - snap.followup_median, 1)],
    ['Uno C', fmt.num(snap.uno_c, 3), fmt.num(live.uno_c, 3), sNum(live.uno_c - snap.uno_c, 3)],
    ['AUC at 3 years', fmt.num(snap.auc36, 3), fmt.num(live.auc36, 3), sNum(live.auc36 - snap.auc36, 3)],
    ['3-year mortality, observed', fmt.pct(snap.obs36, 1), fmt.pct(live.obs36, 1), sNum(100 * (live.obs36 - snap.obs36), 1)],
    ['3-year mortality, model average', fmt.pct(snap.exp36, 1), fmt.pct(live.exp36, 1), sNum(100 * (live.exp36 - snap.exp36), 1)],
    ['Observed / expected at 3 years', fmt.num(snap.oe36, 2), fmt.num(live.oe36, 2), sNum(live.oe36 - snap.oe36, 2)],
    ['Local factor at 3 years (95% interval)', kap(snap), kap(live), ''],
  ];
  return table(['', SNAP, 'Live now', 'Difference'], rows, { caption: 'Headline checks on the snapshot and on the live records' });
}

function liveView(snap, st) {
  const { live, log, release, at } = st;
  const kept = log.slice(1).filter(r => r[1] > 0);
  const flow = table(['Step', 'Cases'], [[log[0][0], fmt.int(log[0][1])], ...kept.map(r => [`Left out: ${r[0]}`, fmt.int(r[1])]), ['Analysed', fmt.int(live.n)]], { caption: 'From the GDC response to the analysed patients', left: [0] });
  const times = live.oe36 > 0 ? 1 / live.oe36 : NaN;
  const headline = `On the live records the reduced model, built only from METABRIC, ranks TCGA patients with a Uno C of ${fmt.num(live.uno_c, 2)} but predicts about ${fmt.num(times, 1)} times the deaths observed at 3 years (observed over expected ${fmt.num(live.oe36, 2)}).`;
  const label = `In these records ${fmt.pct(live.unknown36, 0)} of patients have no known 3-year status. Counting censored patients as alive would give ${fmt.pct(live.naive36, 1)} mortality at 3 years; Kaplan-Meier gives ${fmt.pct(live.obs36, 1)}.`;
  return h('div', { class: 'stack' },
    h('div', { class: 'metric-grid' },
      tile('GDC data release', release ? release.replace(/^Data Release\s*/i, 'Release ').split(' - ')[0] : 'not reported', release && release.includes(' - ') ? release.split(' - ')[1] : null),
      tile('Cases returned', fmt.int(log[0][1]), 'project TCGA-BRCA'),
      tile('Patients analysed', fmt.int(live.n), `${fmt.int(live.deaths)} deaths`),
      tile('Median follow-up', fmt.months(live.followup_median), 'reverse Kaplan-Meier'),
      tile('Fetched', at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), at.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }))),
    h('p', { style: { maxWidth: '74ch' }, text: headline }),
    compareTable(snap, live),
    h('p', { class: 'ink2', style: { maxWidth: '74ch' }, text: label }),
    h('details', { class: 'adv' }, h('summary', { text: 'How the records were filtered' }), h('div', {}, flow,
      h('p', { class: 'small ink2', text: 'The snapshot also left out 2 patients treated before surgery, which cBioPortal records and these GDC fields do not, so a difference of a patient or two is expected.' }))));
}

function snapshotView(snap) {
  const row = (l, v) => [l, v];
  return h('div', { class: 'stack' },
    h('div', { class: 'metric-grid' },
      tile('Patients analysed', fmt.int(snap.n), `${fmt.int(snap.deaths)} deaths`),
      tile('Median follow-up', fmt.months(snap.followup_median), 'reverse Kaplan-Meier'),
      tile('Uno C', fmt.num(snap.uno_c, 2), 'ranking'),
      tile('Observed / expected', fmt.num(snap.oe36, 2), 'level, at 3 years')),
    table(['Snapshot recorded when this site was built', 'Value'], [
      row('3-year mortality, observed', fmt.pct(snap.obs36, 1)), row('3-year mortality, model average', fmt.pct(snap.exp36, 1)),
      row('Local factor at 3 years (95% interval)', `${fmt.num(snap.kappa36, 2)} (${fmt.num(snap.kappa_lo, 2)} to ${fmt.num(snap.kappa_hi, 2)})`)], { caption: 'Snapshot values' }));
}

export async function render(root) {
  const [res, model] = await Promise.all([loadResults(), loadReduced()]);
  const snap = res.live_snapshot;
  const body = h('div', { class: 'stack', 'aria-live': 'polite' });
  const btn = h('button', { class: 'btn primary', type: 'button', text: 'Fetch again' });

  async function go() {
    btn.disabled = true;
    clear(body);
    body.append(h('p', { class: 'ink2', text: `Contacting ${API.replace('https://', '')}…` }), h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Fetching from the GDC' }, h('i', { style: { width: '60%' } })));
    try {
      const [st, cs] = await Promise.all([getJson(statusUrl()).catch(() => null), getJson(casesUrl())]);
      const hits = cs && cs.data && cs.data.hits;
      if (!Array.isArray(hits) || !hits.length) throw new Error('The GDC returned no cases');
      const { pts, log } = parseGdc(hits);
      if (pts.length < 100) throw new Error(`Only ${pts.length} records could be used`);
      const live = liveMetrics(model, pts);
      clear(body);
      body.append(liveView(snap, { live, log, release: st && st.data_release, at: new Date() }));
    } catch (e) {
      clear(body);
      body.append(note(`${e.message}. Showing the snapshot recorded when this site was built, from GDC data release 46.`, 'warn'), snapshotView(snap));
    } finally { btn.disabled = false; }
  }
  btn.addEventListener('click', go);

  root.append(h('div', { class: 'wrap' },
    h('div', { class: 'page-head' }, h('h1', { text: 'Re-run the checks on live GDC records' }),
      h('p', { class: 'lede', text: 'This page asks the NCI Genomic Data Commons for the current TCGA-BRCA clinical records and scores them with a model that never saw TCGA: the reduced model of age, pT and pN, built from METABRIC alone. If the main finding were an accident of one data freeze, it would move here.' })),
    section('live', 'Current records', null,
      h('div', { class: 'row' }, btn, h('span', { class: 'small ink2', text: 'One request for the clinical fields of the project, and one for the data release. Nothing else leaves this tab.' })),
      body),
    section('about', 'What this checks', null, h('div', { class: 'stack', style: { maxWidth: '74ch' } },
      h('p', {}, 'The reduced model uses only age, pT and pN because those are the clinical fields the GDC API returns for every TCGA case. Receptor status comes from cBioPortal for the main analysis and is not available here.'),
      h('p', {}, 'Records are filtered by the same rules as the main analysis: survival time and status present, positive follow-up, age, pT and pN known, no metastasis at diagnosis. If the GDC cannot be reached, the page shows the snapshot taken when the site was built.')))));
  go();
}
