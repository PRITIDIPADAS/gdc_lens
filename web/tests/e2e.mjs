// End-to-end checks in a real browser against the built site.
//   npm run build && node tests/e2e.mjs
// Needs Playwright with Chromium (npm i --no-save playwright && npx playwright install chromium).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  console.error('Playwright is not installed. Run: npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (!fs.existsSync(path.join(ROOT, 'index.html'))) { console.error('Build the site first: npm run build'); process.exit(2); }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.csv': 'text/csv; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// Synthetic GDC response: 420 usable cases and a few the page must leave out.
function fakeGdc() {
  let s = 20260101; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const hits = [];
  for (let i = 0; i < 420; i++) {
    const dead = rnd() < 0.13, days = Math.floor(40 + rnd() * 2600);
    hits.push({ submitter_id: `SYN-${i}`, demographic: { vital_status: dead ? 'Dead' : 'Alive', days_to_death: dead ? days : null },
      diagnoses: [{ age_at_diagnosis: Math.floor((30 + rnd() * 55) * 365.25), ajcc_pathologic_t: pick(['T1', 'T1c', 'T2', 'T2', 'T3', 'T4b']), ajcc_pathologic_n: pick(['N0', 'N0', 'N1', 'N1a', 'N2', 'N3']), ajcc_pathologic_m: 'M0', days_to_last_follow_up: dead ? null : days }], follow_ups: [] });
  }
  const bad = (id, dx) => hits.push({ submitter_id: id, demographic: { vital_status: 'Alive' }, diagnoses: [{ age_at_diagnosis: 50 * 365.25, ajcc_pathologic_t: 'T2', ajcc_pathologic_n: 'N0', ajcc_pathologic_m: 'M0', days_to_last_follow_up: 400, ...dx }], follow_ups: [] });
  bad('SYN-tx', { ajcc_pathologic_t: 'TX' }); bad('SYN-m1', { ajcc_pathologic_m: 'M1' }); bad('SYN-noage', { age_at_diagnosis: null });
  return { data: { hits }, warnings: {} };
}

const results = [];
async function test(name, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  const t0 = Date.now();
  try {
    await fn(page, ctx);
    const allowed = page.__allowedErrors || [];
    const real = problems.filter(p => !allowed.some(a => p.includes(a)));
    assert.deepEqual(real, [], 'unexpected browser errors');
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`ok   ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}\n     ${String(e.message).split('\n').join('\n     ')}`);
  } finally { await ctx.close(); }
}
const go = async (page, route) => { await page.goto(`${BASE}#/${route}`); await page.waitForSelector('main#main .wrap h1, #main h1', { timeout: 15000 }); };
const hash = page => page.evaluate(() => decodeURIComponent(location.hash));
const radio = (page, group, v) => page.locator(`[role=radiogroup][aria-label="${group}"] [data-v="${v}"]`);

const browser = await chromium.launch();

await test('every page loads with one heading and no errors', async page => {
  for (const r of ['predict', 'evidence', 'labels', 'hospital', 'methods']) {
    await go(page, r);
    assert.equal(await page.locator('h1').count(), 1, `${r}: one h1`);
    assert.equal(await page.locator('.nav a[aria-current=page]').getAttribute('data-route'), r);
  }
});

await test('predict: inputs update the estimate and the address', async page => {
  await go(page, 'predict');
  await page.waitForSelector('.verdict');
  await radio(page, 'Tumour size', 3).click();
  await radio(page, 'Lymph nodes', 2).click();
  assert.match(await hash(page), /T=3/); assert.match(await hash(page), /N=2/);
  await page.fill('#age-num', '70'); await page.dispatchEvent('#age-num', 'change');
  assert.match(await hash(page), /age=70/);
  await page.reload(); await page.waitForSelector('.verdict');
  assert.equal(await radio(page, 'Tumour size', 3).getAttribute('aria-checked'), 'true');
  assert.equal(await page.inputValue('#age-num'), '70');
  await page.click('text=Node-positive, triple negative');
  assert.match(await hash(page), /ER=neg/);
  const risk = async () => (await page.locator('.verdict').count()) && (await page.locator('.est-big').first().innerText());
  assert.ok(await risk(), 'an estimate or a withheld notice is shown');
});

await test('predict: keyboard moves a segmented control and a figure has a table view', async page => {
  await go(page, 'predict');
  await radio(page, 'Lymph nodes', 0).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await radio(page, 'Lymph nodes', 1).getAttribute('aria-checked'), 'true');
  const toggle = page.locator('figure.fig .fig-toggle').first();
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  assert.ok(await page.locator('figure.fig .tbl-wrap:not([hidden]) table').count() >= 1, 'table view visible');
});

await test('predict: a local factor rescales the estimate', async page => {
  await go(page, 'predict');
  await page.click('text=Small, node-negative, hormone-receptor positive');
  const anyway = page.locator('text=Show the estimate anyway'); if (await anyway.count()) await anyway.click();
  const before = await page.locator('.est-big').first().innerText();
  await page.click('summary:has-text("Calibrate to a hospital")');
  await page.fill('input[aria-label="Local factor"], input[aria-label="Local calibration factor"]', '0.5');
  await page.dispatchEvent('input[aria-label="Local calibration factor"]', 'change');
  const anyway2 = page.locator('text=Show the estimate anyway'); if (await anyway2.count()) await anyway2.click();
  const after = await page.locator('.est-big').first().innerText();
  assert.notEqual(before, after);
  assert.ok(await page.locator('text=Local factor 0.50 applied.').count() === 1);
});

await test('evidence: the figures draw', async page => {
  await go(page, 'evidence');
  await page.waitForFunction(() => document.querySelectorAll('figure.fig svg').length >= 6, null, { timeout: 15000 });
});

await test('label audit: horizon switch and a browser simulation', async page => {
  await go(page, 'labels');
  await radio(page, 'Horizon', 60).click();
  assert.equal(await radio(page, 'Horizon', 60).getAttribute('aria-checked'), 'true');
  await page.click('button:has-text("Run 200 cohorts")');
  await page.waitForSelector('text=/Your run: 200 cohorts/', { timeout: 60000 });
});

await test('hospital: example file, report and predictions download', async page => {
  await go(page, 'hospital');
  await page.click('button:has-text("Use the example file")');
  await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Download the report')); return b && !b.disabled; }, null, { timeout: 60000 });
  const [d1] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Download the report")')]);
  assert.equal(d1.suggestedFilename(), 'gdc_lens_local_check.md');
  const text = fs.readFileSync(await d1.path(), 'utf8');
  assert.match(text, /Research use only/); assert.match(text, /Uno C/i);
  const [d2] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Download predictions (CSV)")')]);
  assert.equal(d2.suggestedFilename(), 'gdc_lens_predictions.csv');
  const lines = fs.readFileSync(await d2.path(), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1501, 'header plus 1,500 patients');
  await page.click('button:has-text("Remove the data from this page")');
  assert.equal(await page.locator('button:has-text("Download the report")').count(), 0);
});

await test('hospital: a file missing a column is refused with a reason', async page => {
  await go(page, 'hospital');
  const f = path.join(os.tmpdir(), 'gdc_lens_e2e_bad.csv');
  fs.writeFileSync(f, 'age,pT\n50,T2\n61,T1\n');
  await page.setInputFiles('input[type=file]', f);
  await page.waitForSelector('text=/Missing required column/');
  assert.equal(await page.locator('button:has-text("Download the report")').count(), 0);
  fs.rmSync(f, { force: true });
});

await test('live GDC: reads the records and compares with the snapshot', async page => {
  const body = JSON.stringify(fakeGdc());
  await page.route('https://api.gdc.cancer.gov/**', route => {
    const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (route.request().url().includes('/status')) return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ status: 'OK', data_release: 'Data Release 46.0 - May 21, 2026', version: '6.2.0' }) });
    return route.fulfill({ status: 200, headers: cors, body });
  });
  await go(page, 'live');
  await page.waitForSelector('text=Patients analysed', { timeout: 30000 });
  assert.ok(await page.locator('text=Release 46.0').count() >= 1, 'release shown');
  assert.ok(await page.locator('table:has-text("Live now")').count() === 1, 'comparison table');
  const rows = await page.locator('table:has-text("Live now") tbody tr').allInnerTexts();
  assert.ok(rows.some(r => r.includes('Patients analysed') && r.includes('420')), 'analysed count');
});

await test('live GDC: falls back to the snapshot when the service is unreachable', async page => {
  await page.route('https://api.gdc.cancer.gov/**', route => route.abort());
  page.__allowedErrors = ['Failed to load resource', 'net::ERR', 'blocked', 'CORS'];
  await go(page, 'live');
  await page.waitForSelector('text=/Showing the snapshot recorded when this site was built/', { timeout: 30000 });
  assert.ok(await page.locator('text=Snapshot values').count() >= 1);
});

await test('methods: the audit is re-derived in the browser', async page => {
  await go(page, 'methods');
  await page.click('button:has-text("Re-derive the audit here")');
  await page.waitForSelector('text=/Same result as the published audit/', { timeout: 60000 });
  assert.ok(await page.locator('blockquote.quote').count() >= 10, 'published statements are listed');
});

await test('theme toggle flips the colour scheme', async page => {
  await go(page, 'predict');
  const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.click('button[aria-label="Switch colour theme"]');
  const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  assert.ok(attr === 'dark' || attr === 'light');
  const after = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.notEqual(before, after);
});

await test('phone width: no sideways scrolling on any page', async (page, ctx) => {
  await page.setViewportSize({ width: 390, height: 800 });
  for (const r of ['predict', 'evidence', 'labels', 'hospital', 'live', 'methods']) {
    await page.route('https://api.gdc.cancer.gov/**', route => route.abort());
    await go(page, r);
    await page.waitForTimeout(600);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 1, `${r}: ${over}px wider than the screen`);
  }
  page.__allowedErrors = ['Failed to load resource', 'net::ERR', 'blocked', 'CORS'];
});

let axeSource = null;
try { axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'); } catch { console.log('skip accessibility check: axe-core is not installed (npm i --no-save axe-core)'); }
if (axeSource) await test('accessibility: no automated violations on any page, in both themes and at phone width', async (page, ctx) => {
  await page.route('https://api.gdc.cancer.gov/**', route => route.abort());
  page.__allowedErrors = ['Failed to load resource', 'net::ERR', 'blocked', 'CORS'];
  const found = [];
  for (const size of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    for (const r of ['predict', 'evidence', 'labels', 'hospital', 'live', 'methods']) {
      await go(page, r);
      await page.waitForTimeout(700);
      if (r === 'hospital') { await page.getByRole('button', { name: /example file/i }).click(); await page.waitForTimeout(2200); }
      for (const theme of ['light', 'dark']) {
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: axeSource });
        const res = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }));
        for (const v of res.violations) found.push(`${r} ${theme} ${size.width}px: ${v.id} (${v.nodes.length}) ${v.nodes[0].target.join(' ')}`);
      }
    }
  }
  assert.deepEqual(found, [], 'accessibility violations');
});

await browser.close(); server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
