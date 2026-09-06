// Manual browser proof. Fresh context; never uses a personal browser profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.MARKET_BRIEF_URL || 'http://127.0.0.1:8106/';
const output = process.env.MARKET_BRIEF_ARTIFACTS || 'artifacts/growth-browser';
const activityKey = 'market-brief.activity.v1', baselineKey = 'market-brief.browser.v1';
await fs.mkdir(output, {recursive: true});
const browser = await chromium.launch({headless: true, channel: process.env.PLAYWRIGHT_CHANNEL});
const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
const page = await context.newPage(), errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => requests.push(request.url()));
const sources = () => requests.filter(url => url.startsWith('https://api.seiche.info/'));
const stored = key => page.evaluate(key => localStorage.getItem(key), key);
async function build() {
  await page.locator('#build').click();
  await page.waitForFunction(() => !document.getElementById('build').disabled, {}, {timeout: 35000});
}
async function download(button, name) {
  const event = page.waitForEvent('download');
  await page.locator(button).click();
  await (await event).saveAs(path.join(output, name));
  return fs.readFile(path.join(output, name));
}
try {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {value: {writeText: async value => {window.testClipboard = value;}}});
    Object.defineProperty(navigator, 'share', {value: async value => {window.testShare = value; throw new DOMException('Cancelled by test', 'AbortError');}});
  });
  await page.goto(base, {waitUntil: 'networkidle'});
  assert.equal(sources().length, 0);
  assert.equal(await stored(activityKey), null);
  assert.equal(await page.locator('#open-share').isDisabled(), true);
  await build();
  assert.match(await page.locator('#notice').innerText(), /reported observations/);
  assert.equal(await stored(activityKey), null, 'No activity before consent');
  await page.locator('#open-share').click();
  assert.equal(await page.locator('#share-dialog').evaluate(node => node.open), true);
  assert.ok(await page.locator('.share-observation').count() <= 3);
  assert.match(await page.locator('#share-scope').innerText(), /Retrieved/);
  const sharedLink = new URL(await page.locator('#share-link').inputValue());
  assert.equal(sharedLink.origin, 'https://beepboop2025.github.io');
  assert.equal(sharedLink.searchParams.get('ref'), 'share');
  assert.equal(sharedLink.hash, '');
  const telegram = new URL(await page.locator('#telegram-share').getAttribute('href'));
  assert.equal(telegram.origin, 'https://t.me');
  assert.equal(telegram.pathname, '/share/url');
  assert.match(telegram.searchParams.get('text'), /Source generated:/);
  await page.locator('#copy-share').click();
  await page.locator('#copy-share').click();
  await page.waitForFunction(() => document.getElementById('copy-share').textContent === 'Copy preview');
  assert.match(await page.evaluate(() => window.testClipboard), /Check latest:/);
  assert.doesNotMatch(await page.evaluate(() => window.testClipboard), /previousValue|Previous baseline/);
  await page.locator('#native-share').click();
  assert.match(await page.locator('#share-result').innerText(), /cancelled/);
  assert.equal(await stored(activityKey), null, 'Sharing does not imply consent');
  const png = await download('#save-card', 'share-card.png');
  assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.ok(png.readUInt32BE(20) > 1000);
  await page.setViewportSize({width: 390, height: 844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({path: path.join(output, 'mobile-sharing.png'), fullPage: true});
  await page.locator('#close-share').click();
  await page.locator('#pilot > summary').click();
  await page.locator('#pilot-consent').check();
  assert.deepEqual(JSON.parse(await stored(activityKey)).days, [], 'No retroactive activity');
  await page.locator('#observations-label').click();
  await page.locator('#remember').check();
  await page.reload({waitUntil: 'networkidle'});
  assert.equal(await page.locator('#pilot-consent').isChecked(), true);
  assert.equal(await page.locator('#remember').isChecked(), true);
  await build();
  await page.locator('#copy').click();
  await page.locator('#pilot > summary').click();
  const report = JSON.parse(await download('#pilot-export', 'pilot-report.json'));
  assert.equal(report.totals.checks, 1);
  assert.equal(report.totals.copies, 1);
  assert.equal(report.distinct_check_days, 1);
  assert.equal(report.returned_in_second_week, null);
  assert.equal(report.scope, 'voluntary_single_browser_unverified');
  assert.doesNotMatch(JSON.stringify(report), /previousValue|observed_at|api\.seiche|identifier":/);
  await page.locator('#pilot-consent').uncheck();
  assert.equal(await stored(activityKey), null);
  assert.ok(await stored(baselineKey), 'Pilot opt-out preserves comparison');
  await page.locator('#pilot-consent').check();
  await page.evaluate(key => {
    localStorage.removeItem(key);
    document.getElementById('pilot-export').click();
  }, activityKey);
  assert.equal(await page.locator('#pilot-export').isDisabled(), true, 'Export re-checks consent synchronously');
  await page.locator('#pilot-consent').check();
  const other = await context.newPage();
  await other.goto(base, {waitUntil: 'networkidle'});
  await other.evaluate(key => localStorage.removeItem(key), activityKey);
  await page.waitForFunction(() => !document.getElementById('pilot-consent').checked);
  await page.locator('#copy').click();
  assert.equal(await stored(activityKey), null, 'Another tab cannot resurrect revoked consent');
  await other.close();
  const beforeArrival = sources().length;
  await page.goto(`${base}?topic=capital-market&ref=partner&snapshot=untrusted`, {waitUntil: 'networkidle'});
  assert.equal(sources().length, beforeArrival);
  assert.equal(await page.locator('[data-topic="capital-market"]').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('#shared-arrival').innerText(), /no saved market values/);
  await page.route('https://api.seiche.info/**', route => route.abort());
  await build();
  assert.match(await page.locator('#notice').innerText(), /could not be read/);
  await page.locator('#open-share').click();
  assert.match(await page.locator('#share-scope').innerText(), /0 reported/);
  assert.ok((await page.locator('.share-value').allTextContents()).every(value => /Not reported|withheld/.test(value)));
  await page.locator('#close-share').click();
  await page.screenshot({path: path.join(output, 'mobile-unavailable.png'), fullPage: true});
  assert.equal(errors.length, 0, errors.join('\n'));
  const unexpected = requests.filter(url => !url.startsWith(base) && !url.startsWith('https://api.seiche.info/'));
  const proof = {url: base, checked_at: new Date().toISOString(), source_requests: sources().length,
    share_preview: true, image_download: true, native_cancellation: true, telegram_composer_checked_without_sending: true,
    no_preconsent_activity: true, no_retroactive_activity: true, pilot_export: true, independent_opt_out: true,
    cross_tab_opt_out: true, arrival_no_autofetch: true, unavailable_sources: true, mobile_no_overflow: true,
    functional_checks: 'passed', network_check: unexpected.length ? 'failed' : 'passed',
    unexpected_request_count: unexpected.length,
    no_remote_telemetry: unexpected.length ? null : true, page_errors: errors};
  await fs.writeFile(path.join(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
  assert.equal(unexpected.length, 0, 'Unexpected network requests; see the separate network check in proof.json');
} finally {await context.close(); await browser.close();}
