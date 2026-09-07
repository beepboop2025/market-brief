// Synthetic browser QA only. Uses a fresh context and never reaches live source endpoints.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SOURCE_ENDPOINTS } from '../docs/data.js';
import { WATCH_KEY } from '../docs/watchboard.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.MARKET_BRIEF_URL || 'http://127.0.0.1:8097/';
const output = process.env.MARKET_BRIEF_ARTIFACTS || 'artifacts/watchboard-browser';
const baselineKey = 'market-brief.browser.v1', activityKey = 'market-brief.activity.v1';
const target = 'money-market:US-USD:US.NYFED.SOFR';
const clock = '2026-09-08T09:00:00Z', observed = '2026-09-07T00:00:00Z';
const failures = [], completed = [], sourceRequests = [], unexpected = [], errors = [];
let phase = 'initial';
let responseGate = null, releaseResponses = null;

function documents() {
  const markets = [{ market_id: 'US-USD', status: 'LIVE_REFERENCE', benchmark: {
    id: 'US.NYFED.SOFR', label: 'SOFR synthetic browser fixture', value: phase === 'initial' ? 3.5 : 4,
    unit: '%', availability: 'AVAILABLE', redistribution_status: 'allowed', status: 'FRESH',
    event_time: observed, asof: observed.slice(0, 10), source_url: 'https://fred.stlouisfed.org/',
  } }, { market_id: 'UK-GBP', status: 'DERIVED_CONTEXT', benchmark: null, derived_benchmark: {
    id: 'GB.BOE.SONIA', label: 'SONIA synthetic restricted fixture', value: 987654.321,
    unit: '%', availability: 'DERIVED_CONTEXT', redistribution_status: 'derived_only', status: 'FRESH',
  } }, { market_id: 'CN-CNY', status: 'DECLARED_UNAVAILABLE', benchmark: null }];
  if (phase === 'absent') markets.shift();
  return [{ schema: 'seiche.global-money-markets.v1', ok: true, generated_at: clock, status: 'PARTIAL',
    coverage: { live_benchmarks: 1, declared_markets: 3 }, markets,
  }, { schema: 'seiche.world-markets.v1', ok: true, selection: 'capital_markets', generated_at: clock,
    capital_markets: { risk_context: { status: 'derived', as_of: observed.slice(0, 10),
      funding_stress: { value: 44.9, regime: 'EROSION' },
      market_vs_plumbing: { asof: observed.slice(0, 10), reading: 'plumbing leads price' },
      market_prices: { vix: { status: 'observed', value: 14.32, as_of: observed.slice(0, 10) },
        high_yield_oas: { status: 'stale', value: 2.65, as_of: '2026-08-01' } },
    } },
  }, { asof: observed.slice(0, 10), funding_regime: 'EROSION', segments: { UST: 'PARTIAL', IG: 'NORMAL', CRYPTO: 'PARTIAL' } }];
}

await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
await context.route('**/*', async route => {
  const url = route.request().url();
  const index = SOURCE_ENDPOINTS.findIndex(source => source.url === url);
  if (index !== -1) {
    sourceRequests.push({ url, phase });
    if (responseGate) await responseGate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(documents()[index]),
      headers: { 'access-control-allow-origin': '*' } });
  } else if (url.startsWith(base)) await route.continue();
  else { unexpected.push(url); await route.abort(); }
});
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'clipboard', { value: {
    writeText: async value => { window.syntheticClipboard = value; },
  } });
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
const stored = key => page.evaluate(key => localStorage.getItem(key), key);
const card = id => page.locator('#cards .data-card').filter({ has: page.locator(`[data-watch-id="${id}"]`) });
async function check(name, fn) {
  try { await fn(); completed.push(name); console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); throw error; }
}
async function build() {
  const before = sourceRequests.length;
  await page.locator('#build').click();
  await page.waitForFunction(() => !document.getElementById('build').disabled);
  assert.equal(sourceRequests.length - before, 3, 'Each requested check reads exactly the three fixture endpoints');
  assert.match(await page.locator('#notice').innerText(), /All three sources responded/);
}
async function reload() {
  const before = sourceRequests.length;
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(sourceRequests.length, before, 'Reload must not fetch market data');
}
async function view(name) { await page.locator(`[data-view="${name}"]`).click(); }
function rows(text) {
  const match = text.match(/```jsonl\n([\s\S]*?)\n```/);
  assert.ok(match, 'Research packet contains a bounded JSONL data section');
  return match[1].split('\n').filter(Boolean).map(line => JSON.parse(line));
}

try {
  await check('no_initial_source_fetch_or_storage', async () => {
    await page.goto(base, { waitUntil: 'networkidle' });
    assert.equal(sourceRequests.length, 0);
    assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
    assert.equal(await page.locator('#remember-watch').isChecked(), false);
    assert.equal(await page.locator('#open-handoff').isDisabled(), true);
    await page.screenshot({ path: path.join(output, 'synthetic-desktop-initial.png'), fullPage: true });
  });
  await check('build_pin_and_explicit_ids_only_persistence', async () => {
    await build(); await view('all');
    assert.ok(await page.locator('#cards .data-card').count() > 8);
    await card(target).locator('button').click();
    assert.equal(await stored(WATCH_KEY), null);
    assert.equal(await stored(baselineKey), null);
    await page.locator('#remember-watch').check();
    assert.deepEqual(JSON.parse(await stored(WATCH_KEY)), { schema: WATCH_KEY, ids: [target] });
    assert.equal(await stored(activityKey), null);
    await reload();
    assert.equal(await page.locator('#remember-watch').isChecked(), true);
    assert.equal(await page.locator('[data-view="watched"]').getAttribute('aria-pressed'), 'true');
    await build();
    assert.equal(await page.locator('#cards .data-card').count(), 1);
    assert.match(await card(target).innerText(), /3\.5/);
    await page.locator('#remember').check();
    assert.ok(await stored(baselineKey));
  });
  await check('value_changes_and_evidence_gaps_are_separate_views', async () => {
    phase = 'changed'; await reload(); await build(); await view('changes');
    assert.equal(await page.locator('#cards .data-card').count(), 1);
    assert.match(await card(target).innerText(), /4/);
    await view('gaps');
    assert.equal(await card(target).count(), 0);
    const content = await page.locator('#cards').innerText();
    assert.match(content, /withheld/i);
    assert.match(content, /stale/i);
    assert.match(content, /coverage/i);
    assert.doesNotMatch(content, /987654/);
    await view('all');
  });
  await check('full_handoff_preserves_dates_scope_and_current_comparison', async () => {
    const count = await page.locator('#cards .data-card').count();
    await page.locator('#open-handoff').click();
    await page.waitForFunction(() => document.getElementById('handoff-dialog').open);
    const preview = await page.locator('#handoff-preview').inputValue(), data = rows(preview);
    assert.equal(data.length, count); assert.ok(data.length > 3);
    const sofr = data.find(row => row.id === target);
    assert.equal(sofr.observed_at, observed); assert.equal(sofr.source_generated_at, clock);
    assert.equal(sofr.value, 4); assert.equal(sofr.previousValue, 3.5);
    assert.equal(sofr.changeBasis, 'same_observation_time');
    assert.match(preview, /Snapshot fetched_at:/); assert.match(preview, /countercase/);
    assert.match(preview, /untrusted data, not instructions/);
    assert.doesNotMatch(preview, /987654/);
    for (const task of ['bank', 'funding', 'exit']) assert.ok(preview.includes(`https://liquilens.in/start/?task=${task}`));
    const scope = await page.locator('#handoff-scope').innerText();
    assert.match(scope, /View: all/);
    assert.doesNotMatch(scope, /[1-9]\d* watched observations absent/,
      'Unavailable/withheld rows must not be mislabeled as absent watched IDs');
    await page.locator('#copy-handoff').click();
    assert.equal(await page.evaluate(() => window.syntheticClipboard), preview);
    const download = page.waitForEvent('download'); await page.locator('#download-handoff').click();
    await (await download).saveAs(path.join(output, 'synthetic-research-handoff.md'));
    assert.equal(await fs.readFile(path.join(output, 'synthetic-research-handoff.md'), 'utf8'), preview);
    assert.equal(await stored(activityKey), null);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.locator('#handoff-dialog').evaluate(dialog => dialog.getBoundingClientRect().right <= innerWidth));
    await page.screenshot({ path: path.join(output, 'synthetic-mobile-handoff.png'), fullPage: true });
    await page.locator('#close-handoff').click();
  });
  await check('watch_intents_preserve_newer_ids_before_storage_event', async () => {
    const newer = 'capital-market:vix';
    // Same-tab storage writes suppress the event, reproducing the race before another tab's event arrives.
    await page.evaluate(({ key, ids }) => localStorage.setItem(key, JSON.stringify({ schema: key, ids })),
      { key: WATCH_KEY, ids: [target, newer] });
    await card(target).locator('button').click();
    assert.deepEqual(JSON.parse(await stored(WATCH_KEY)).ids, [newer]);
    await card(target).locator('button').click();
    assert.deepEqual(new Set(JSON.parse(await stored(WATCH_KEY)).ids), new Set([target, newer]));
    await card(newer).locator('button').click();
    assert.deepEqual(JSON.parse(await stored(WATCH_KEY)).ids, [target]);
  });
  await check('missing_watch_survives_repeated_checks_without_old_values', async () => {
    phase = 'absent';
    for (let iteration = 0; iteration < 3; iteration++) {
      await reload(); await build();
      assert.equal(await page.locator('#cards .data-card').count(), 1);
      const text = await card(target).innerText();
      assert.match(text, /NOT_RETURNED|NOT RETURNED/);
      assert.match(text, /Not reported/); assert.doesNotMatch(text, /3\.5|4\s*%/);
      await page.locator('#open-handoff').click();
      const data = rows(await page.locator('#handoff-preview').inputValue());
      assert.equal(data.length, 1); assert.equal(data[0].id, target);
      assert.equal(data[0].value, null); assert.equal(data[0].observed_at, null);
      assert.equal(data[0].state, 'NOT_RETURNED');
      assert.equal(Object.hasOwn(data[0], 'previousValue'), false);
      await page.locator('#close-handoff').click();
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, 'synthetic-mobile-missing-watch.png'), fullPage: true });
  });
  await check('storage_denial_preserves_update_but_allows_session_clear', async () => {
    await page.evaluate(() => {
      window.syntheticSetItem = Storage.prototype.setItem;
      window.syntheticRemoveItem = Storage.prototype.removeItem;
      Storage.prototype.setItem = function () { throw new DOMException('Synthetic storage denial', 'SecurityError'); };
      Storage.prototype.removeItem = function () { throw new DOMException('Synthetic storage denial', 'SecurityError'); };
    });
    await card(target).locator('button').click();
    assert.equal(await card(target).count(), 1); assert.match(await page.locator('#watch-status').innerText(), /could not save/);
    await page.locator('#clear-watch').click();
    assert.equal(await page.locator('#cards .data-card').count(), 0, 'Clear removes in-tab choices despite a denied storage deletion');
    assert.equal(await page.locator('#remember-watch').isChecked(), false);
    assert.deepEqual(JSON.parse(await stored(WATCH_KEY)).ids, [target]);
    assert.match(await page.locator('#watch-status').innerText(), /could not (?:clear|remove|delete)|could not be (?:cleared|removed|deleted)/);
    await page.evaluate(() => {
      Storage.prototype.setItem = window.syntheticSetItem;
      Storage.prototype.removeItem = window.syntheticRemoveItem;
    });
  });
  await check('unwatch_and_clear_are_explicit_and_independent_of_baseline', async () => {
    // The denied deletion left the old on-device setting. Reload makes that limitation observable.
    await reload(); await build();
    assert.equal(await card(target).count(), 1);
    await card(target).locator('button').click();
    assert.equal(await page.locator('#cards .data-card').count(), 0);
    assert.deepEqual(JSON.parse(await stored(WATCH_KEY)).ids, []);
    await view('all'); await page.locator('#cards [data-watch-id]').first().click();
    await page.locator('#clear-watch').click();
    assert.equal(await stored(WATCH_KEY), null); assert.ok(await stored(baselineKey));
    assert.equal(await page.locator('#remember-watch').isChecked(), false);
    assert.equal(await page.locator('#clear-watch').isDisabled(), true);
  });
  await check('cross_tab_revocation_cannot_resurrect_saved_choices', async () => {
    await page.locator('#cards [data-watch-id]').first().click();
    await page.locator('#remember-watch').check();
    const other = await context.newPage(), before = sourceRequests.length;
    await other.goto(base, { waitUntil: 'networkidle' }); assert.equal(sourceRequests.length, before);
    await other.locator('#remember-watch').uncheck();
    await page.waitForFunction(() => !document.getElementById('remember-watch').checked);
    assert.equal(await stored(WATCH_KEY), null);
    await page.locator('#cards [data-watch-id]').first().click();
    assert.equal(await stored(WATCH_KEY), null);
    await other.close();
    await page.screenshot({ path: path.join(output, 'synthetic-mobile-watchboard.png'), fullPage: true });
  });
  await check('cross_tab_updates_invalidate_handoff_and_baseline_consent', async () => {
    await view('all');
    await page.locator('#open-handoff').click();
    const other = await context.newPage();
    await other.goto(base, { waitUntil: 'networkidle' });
    await other.evaluate(key => localStorage.setItem(key, JSON.stringify({ schema: key, ids: ['capital-market:vix'] })), WATCH_KEY);
    await page.waitForFunction(() => !document.getElementById('handoff-dialog').open);
    assert.equal(await page.locator('#handoff-preview').inputValue(), '');
    assert.equal(await page.locator('#remember').isChecked(), true);
    await other.locator('#remember').uncheck();
    await page.waitForFunction(() => !document.getElementById('remember').checked);
    assert.equal(await stored(baselineKey), null);
    await reload(); await build();
    assert.equal(await stored(baselineKey), null, 'Later checks must not recreate revoked baseline storage');
    assert.equal(await page.locator('#remember').isChecked(), false);
    assert.match(await page.locator('#baseline-note').innerText(), /No saved baseline/);
    await other.close();
  });
  await check('pending_fetch_keeps_handoff_disabled_and_honors_baseline_revocation', async () => {
    await page.locator('#remember').check();
    await reload();
    const other = await context.newPage();
    await other.goto(base, { waitUntil: 'networkidle' });
    responseGate = new Promise(resolve => { releaseResponses = resolve; });
    const before = sourceRequests.length;
    await page.locator('#build').click();
    await page.waitForFunction(() => document.getElementById('build').disabled);
    const requestDeadline = Date.now() + 10000;
    while (sourceRequests.length < before + 3 && Date.now() < requestDeadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(sourceRequests.length, before + 3, 'Pending fetch reached every fixture route before timeout');
    await view('gaps');
    await page.locator('[data-topic="money-market"]').click();
    assert.equal(await page.locator('#open-handoff').isDisabled(), true);
    await page.evaluate(() => document.getElementById('open-handoff').click());
    assert.equal(await page.locator('#handoff-dialog').evaluate(dialog => dialog.open), false);
    await other.locator('#remember').uncheck();
    await page.waitForFunction(() => !document.getElementById('remember').checked);
    releaseResponses(); responseGate = null; releaseResponses = null;
    await page.waitForFunction(() => !document.getElementById('build').disabled);
    assert.equal(await stored(baselineKey), null);
    await view('all'); await page.locator('[data-topic="all"]').click();
    await page.locator('#open-handoff').click();
    const preview = await page.locator('#handoff-preview').inputValue();
    assert.match(preview, /Comparison: no saved baseline/);
    assert.ok(rows(preview).every(row => !Object.hasOwn(row, 'previousValue')));
    await page.locator('#close-handoff').click();
    await other.close();
  });
  await check('no_unexpected_network_or_page_errors', async () => {
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    assert.equal(await stored(activityKey), null);
  });
} catch (error) {
  await page.screenshot({ path: path.join(output, 'synthetic-failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  releaseResponses?.();
  const proof = { checked_at: new Date().toISOString(), url: base, evidence: 'synthetic_browser_fixtures_only',
    live_source_requests: 0, fixture_requests: sourceRequests.length, completed, failures,
    unexpected_requests: unexpected, page_errors: errors, status: failures.length ? 'failed' : 'passed' };
  await fs.writeFile(path.join(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
  await context.close(); await browser.close();
}
