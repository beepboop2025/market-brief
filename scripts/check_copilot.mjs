// Fresh-browser QA for published synthetic examples. Blocks all off-origin requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DEMO_PACK} from '../docs/copilot-pack-ref.js';
import {ACTIVITY_KEY} from '../docs/activity.js';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.MARKET_BRIEF_URL || 'http://127.0.0.1:8112/';
const output = process.env.MARKET_BRIEF_ARTIFACTS || 'artifacts/copilot-browser';
const completed = [], failures = [], errors = [], unexpected = [];
let packRequests = 0, packState = 'normal';
await fs.mkdir(output, {recursive: true});
const browser = await chromium.launch({headless: true, channel: process.env.PLAYWRIGHT_CHANNEL});
const context = await browser.newContext({viewport: {width: 1440, height: 1000}, acceptDownloads: true});
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
await context.route('**/*', async route => {
  const url = route.request().url();
  if (!url.startsWith(base)) { unexpected.push(url); await route.abort(); return; }
  if (new URL(url).pathname.endsWith('/copilot-pack.json')) {
    packRequests += 1;
    if (packState === 'missing') { await route.fulfill({status: 503, body: 'Unavailable'}); return; }
    if (packState === 'corrupt') { await route.fulfill({status: 200, contentType: 'application/json', body: '{"synthetic":true}'}); return; }
  }
  await route.continue();
});
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'clipboard', {value: {writeText: async value => {
    window.copiedText = value;
    if (window.copyFailure) throw new Error('Clipboard fixture denied');
    if (window.delayCopy) await new Promise(resolve => { window.releaseCopy = resolve; });
  }}});
});
const page = await context.newPage(); page.setDefaultTimeout(10000);
const stored = () => page.evaluate(key => localStorage.getItem(key), ACTIVITY_KEY);
const choose = id => page.locator(`[data-scenario="${id}"]`).click();
async function ready(search = '') {
  await page.goto(`${base}copilot.html${search}`, {waitUntil: 'networkidle'});
  await page.waitForFunction(() => !document.querySelector('[data-scenario]').disabled);
}
async function check(name, fn) {
  try { await fn(); completed.push(name); console.log(`PASS ${name}`); }
  catch (error) { failures.push({name, error: error.message}); throw error; }
}
async function reportDownload(filename = 'scenario.md') {
  const pending = page.waitForEvent('download'); await page.locator('#demo-download').click();
  const download = await pending, target = path.join(output, filename); await download.saveAs(target);
  return fs.readFile(target, 'utf8');
}
try {
  await check('verified_pack_no_external_requests_or_initial_storage', async () => {
    await ready(); assert.equal(packRequests, 1); assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
    assert.equal(await page.locator('#scenario-action').innerText(), 'Entry proposed');
    assert.match(await page.locator('#demo-provenance').textContent(), new RegExp(DEMO_PACK.source_ref));
    assert.equal(await page.locator('#scenario-gates article').count(), 4);
    assert.equal(await page.locator('#scenario-gates small').allTextContents().then(text => text.every(value => value === 'Not evaluated')), true);
    await page.screenshot({path: path.join(output, 'desktop.png'), fullPage: true});
  });
  await check('all_six_actual_strategy_outputs_and_null_hold_notionals', async () => {
    const before = packRequests;
    for (const [id, action] of Object.entries({candidate: 'Entry proposed', reduction: 'Reduction proposed', 'stale-bars': 'Hold', 'loss-halt': 'Hold', 'funding-stress': 'Hold', 'small-residual': 'Hold'})) {
      await choose(id); assert.equal(await page.locator('#scenario-action').innerText(), action);
      assert.match(await page.locator('#chart-caption').innerText(), /invented.*year 2000/);
      if (action === 'Hold') assert.match(await page.locator('#scenario-facts').innerText(), /No notional proposed/);
      else assert.match(await page.locator('#scenario-facts').innerText(), /\$1,000 USD/);
      assert.match(await page.locator('.demo-blocked').innerText(), /No order is authorized/);
    }
    assert.equal(packRequests, before);
  });
  await check('copy_download_and_links_preserve_source_and_scope', async () => {
    await choose('stale-bars'); await page.locator('#demo-copy').click();
    const copied = await page.evaluate(() => window.copiedText);
    assert.equal(await reportDownload('synthetic-stale-bars.md'), copied);
    const data = JSON.parse(copied.match(/```json\n([\s\S]*?)\n```/)[1]);
    assert.equal(data.notional_usd, null); assert.ok(Object.values(data.execution).every(flag => flag === false));
    assert.match(copied, new RegExp(DEMO_PACK.source_ref)); assert.match(copied, /not an archived market record/);
    await page.evaluate(() => history.replaceState(null, '', '?scenario=stale-bars&private_note=never-copy#private'));
    await page.locator('#demo-link').click();
    assert.equal(await page.evaluate(() => window.copiedText), 'https://beepboop2025.github.io/market-brief/copilot.html?scenario=stale-bars');
    assert.equal(await stored(), null);
  });
  await check('late_clipboard_cannot_replace_new_selection_or_download', async () => {
    await page.evaluate(() => { window.delayCopy = true; });
    await page.locator('#demo-copy').click(); await page.waitForFunction(() => typeof window.releaseCopy === 'function');
    await choose('reduction'); await page.evaluate(() => { window.releaseCopy(); window.releaseCopy = null; });
    assert.equal(await page.locator('#demo-action-status').innerText(), '');
    await page.locator('#demo-copy').click(); await page.waitForFunction(() => typeof window.releaseCopy === 'function');
    await reportDownload('synthetic-reduction.md');
    await page.evaluate(() => { window.releaseCopy(); window.delayCopy = false; window.releaseCopy = null; });
    assert.match(await page.locator('#demo-action-status').innerText(), /prepared for download/);
  });
  await check('clipboard_failure_keeps_visible_link_and_download', async () => {
    await page.evaluate(() => { window.copyFailure = true; }); await page.locator('#demo-link').click();
    await page.waitForFunction(() => document.getElementById('demo-action-status').textContent.includes('Clipboard unavailable'));
    assert.match(await page.locator('#scenario-share-url').getAttribute('href'), /scenario=reduction$/);
    assert.match(await reportDownload('clipboard-fallback.md'), /Reduction proposed/);
    await page.evaluate(() => { window.copyFailure = false; });
  });
  await check('invalid_and_duplicate_links_do_not_select_another_scenario', async () => {
    for (const search of ['?scenario=missing', '?scenario=candidate&scenario=reduction']) {
      await ready(search); assert.equal(await page.locator('#scenario-detail').isVisible(), false);
      assert.match(await page.locator('#demo-status').innerText(), /unavailable.*Choose one/);
      assert.equal(await page.locator('[data-scenario][aria-pressed="true"]').count(), 0);
      await choose('loss-halt'); assert.equal(await page.locator('#scenario-action').innerText(), 'Hold');
    }
  });
  await check('missing_or_modified_pack_fails_closed_and_retry_recovers', async () => {
    for (const state of ['missing', 'corrupt']) {
      packState = state;
      await page.goto(`${base}copilot.html`, {waitUntil: 'networkidle'});
      assert.equal(await page.locator('#scenario-detail').isVisible(), false);
      assert.equal(await page.locator('[data-scenario]:disabled').count(), 6);
      assert.match(await page.locator('#demo-status').innerText(), /could not be verified/);
      packState = 'normal'; await page.locator('#demo-retry').click();
      await page.waitForFunction(() => !document.querySelector('[data-scenario]').disabled);
      assert.equal(await page.locator('#scenario-action').innerText(), 'Entry proposed');
      assert.equal(await page.locator('[data-scenario] span').count(), 6);
    }
  });
  await check('opt_in_demo_counts_are_separate_from_research_checks', async () => {
    await page.locator('.demo-pilot summary').click(); await page.locator('#demo-consent').check();
    await choose('funding-stress'); await page.locator('#demo-copy').click();
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).days[0].demo_copies === 1, ACTIVITY_KEY);
    await page.locator('#demo-link').click();
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).days[0].demo_link_copies === 1, ACTIVITY_KEY);
    const value = JSON.parse(await stored()), row = value.days[0];
    assert.equal(row.demo_views, 1); assert.equal(row.checks, 0); assert.equal(row.copies, 0);
    assert.doesNotMatch(JSON.stringify(value), /funding-stress|source_ref|notional|scenario/);
    const pending = page.waitForEvent('download'); await page.locator('#demo-activity-export').click();
    const file = path.join(output, 'activity.json'); await (await pending).saveAs(file);
    const report = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(report.distinct_demo_days, 1); assert.equal(report.distinct_check_days, 0); assert.equal(report.returned_in_second_week, null);
  });
  await check('cross_tab_revocation_does_not_resurrect_activity', async () => {
    const second = await context.newPage(); await second.goto(`${base}copilot.html`, {waitUntil: 'networkidle'});
    await second.locator('.demo-pilot summary').click(); assert.equal(await second.locator('#demo-consent').isChecked(), true);
    await second.locator('#demo-consent').uncheck();
    await page.waitForFunction(() => !document.getElementById('demo-consent').checked);
    await choose('candidate'); assert.equal(await stored(), null); await second.close();
  });
  await check('unavailable_storage_stops_recording_and_keeps_demo_usable', async () => {
    await page.locator('#demo-consent').check();
    await page.evaluate(() => { window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('Denied fixture'); }; });
    await choose('reduction'); assert.equal(await page.locator('#demo-consent').isChecked(), false);
    assert.match(await page.locator('#demo-activity-status').innerText(), /Recording stopped/);
    assert.equal(await page.locator('#scenario-action').innerText(), 'Reduction proposed');
    await page.evaluate(key => { Storage.prototype.setItem = window.originalSetItem; localStorage.removeItem(key); }, ACTIVITY_KEY);
  });
  await check('mobile_chart_keyboard_controls_and_layout', async () => {
    await page.setViewportSize({width: 390, height: 844}); await choose('candidate');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const sizing = await page.locator('#scenario-chart').evaluate(svg => ({width: svg.getBoundingClientRect().width, viewWidth: svg.viewBox.baseVal.width}));
    assert.ok(Math.abs(sizing.width - sizing.viewWidth) <= 1, 'Chart labels retain CSS pixel size on mobile');
    const button = page.locator('[data-scenario="loss-halt"]'); await button.focus(); await page.keyboard.press('Enter');
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    assert.ok(await button.evaluate(node => getComputedStyle(node).outlineStyle !== 'none'));
    await page.screenshot({path: path.join(output, 'mobile.png'), fullPage: true});
    assert.equal(unexpected.length, 0); assert.equal(errors.length, 0);
  });
} finally {
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({completed, failures, errors, unexpected, packRequests, source: DEMO_PACK.source_ref, packSHA256: DEMO_PACK.sha256}, null, 2));
  await browser.close();
}
assert.equal(failures.length, 0);
