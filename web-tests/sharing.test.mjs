import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCE_ENDPOINTS } from '../docs/data.js';
import { parseShareContext, buildBriefUrl, createSharePreview, formatShareText, telegramShareUrl } from '../docs/sharing.js';

const FETCHED = '2026-09-06T12:00:00.000Z';
function card(topic, id, overrides = {}) {
  const source = SOURCE_ENDPOINTS.find(item => item.topic === topic);
  return {
    id: `${topic}:${id}`, label: id, topic, product: source.product,
    source_url: source.url, original_url: 'https://fred.stlouisfed.org/series/SOFR',
    value: 3.66, unit: '%', availability: 'reported', state: 'FRESH',
    observed_at: '2026-09-03T00:00:00+00:00', source_generated_at: '2026-09-05T08:00:00Z',
    changeKind: 'no_baseline', ...overrides,
  };
}
function brief(cards = [card('money-market', 'SOFR'), card('capital-market', 'VIX', { value: 14.32, unit: 'pts' }), card('market-liquidity', 'UST', { value: 'PARTIAL', unit: 'state', state: 'PARTIAL' })]) {
  return { schema: 'market-brief.browser.v1', fetched_at: FETCHED, cards };
}

test('query parsing accepts only known topic and referral labels', () => {
  assert.deepEqual(parseShareContext('?topic=money-market&ref=partner'), { topic: 'money-market', ref: 'partner' });
  for (const ref of ['share', 'telegram', 'partner', 'financial-evidence']) {
    assert.equal(parseShareContext(`?ref=${ref}`).ref, ref);
  }
  assert.deepEqual(parseShareContext(''), { topic: 'all', ref: null });
  for (const search of ['?topic=javascript%3Aalert(1)&ref=mrinal%40example.com', '?topic=all&topic=money-market&ref=share&ref=partner', '?snapshot=%7B%22value%22%3A999%7D&redirect=https://attacker.example/', '?ref=' + 'x'.repeat(2048), null, {}]) {
    assert.deepEqual(parseShareContext(search), { topic: 'all', ref: null });
  }
});

test('generated links cannot retain arbitrary values, redirect URLs or personal referral strings', () => {
  const url = new URL(buildBriefUrl('capital-market', 'financial-evidence'));
  assert.equal(url.origin + url.pathname, 'https://beepboop2025.github.io/market-brief/');
  assert.deepEqual([...url.searchParams], [['topic', 'capital-market'], ['ref', 'financial-evidence']]);
  const unsafe = new URL(buildBriefUrl('https://attacker.example/?value=999', 'email@example.com'));
  assert.deepEqual([...unsafe.searchParams], [['topic', 'all'], ['ref', 'share']]);
  assert.equal(unsafe.hash, '');
});

test('all-topic previews select one observation per topic and retain distinct clocks', () => {
  const input = brief([card('money-market', 'SOFR'), card('money-market', 'EFFR'), card('capital-market', 'VIX'), card('market-liquidity', 'UST')]);
  const before = structuredClone(input), preview = createSharePreview(input);
  assert.equal(preview.observations.length, 3);
  assert.deepEqual(preview.observations.map(item => item.topic), SOURCE_ENDPOINTS.map(item => item.topic));
  assert.equal(preview.total, 4);
  assert.equal(preview.reported, 4);
  assert.equal(preview.generatedAt, FETCHED);
  assert.equal(preview.observations[0].observed_at, '2026-09-03T00:00:00+00:00');
  assert.equal(preview.observations[0].source_generated_at, '2026-09-05T08:00:00Z');
  assert.deepEqual(input, before, 'preview creation does not mutate the saved or current brief');
});

test('single-topic previews lead with reported evidence while retaining order and full gap totals', () => {
  const input = brief([
    card('money-market', 'D', { availability: 'withheld', value: null }),
    card('money-market', 'B', { changeKind: 'value_changed' }),
    card('money-market', 'C'), card('money-market', 'A'), card('capital-market', 'VIX'),
  ]);
  const preview = createSharePreview(input, 'money-market');
  assert.deepEqual(preview.observations.map(item => item.label), ['B', 'A', 'C']);
  assert.equal(preview.total, 4);
  assert.equal(preview.reported, 3);
  assert.equal(preview.withheld, 1);
  assert.equal(preview.unavailable, 0);
  assert.equal(new URL(preview.url).searchParams.get('topic'), 'money-market');
  assert.equal(createSharePreview(input, 'private-portfolio').topic, 'all');
});

test('all-topic previews use available evidence for each topic and show a gap when none exists', () => {
  const input = brief([
    card('money-market', 'CN unavailable', { availability: 'unavailable', value: null }),
    card('money-market', 'SOFR'),
    card('capital-market', 'A unavailable', { availability: 'unavailable', value: null }),
    card('capital-market', 'VIX'),
    card('market-liquidity', 'UST withheld', { availability: 'withheld', value: null }),
  ]);
  const preview = createSharePreview(input);
  assert.deepEqual(preview.observations.map(item => item.label), ['SOFR', 'VIX', 'UST withheld']);
  assert.equal(preview.total, 5);
  assert.equal(preview.reported, 2);
  assert.equal(preview.unavailable, 2);
  assert.equal(preview.withheld, 1);
  assert.match(formatShareText(preview), /Selected 3 of 5 observations in this view: 2 reported, 2 unavailable, 1 withheld/);
});

test('single-topic previews fill remaining space with gaps without promoting them to reported values', () => {
  const preview = createSharePreview(brief([
    card('money-market', 'A missing', { availability: 'unavailable', value: null }),
    card('money-market', 'B withheld', { availability: 'withheld', value: null }),
    card('money-market', 'SOFR'),
  ]), 'money-market');
  assert.deepEqual(preview.observations.map(item => item.label), ['SOFR', 'A missing', 'B withheld']);
  assert.deepEqual(preview.observations.map(item => item.value), [3.66, null, null]);
  assert.equal(preview.unavailable, 1);
  assert.equal(preview.withheld, 1);
});

test('sharing strips every saved comparison and arbitrary personal field from observations', () => {
  const input = brief([card('money-market', 'SOFR', {
    changeKind: 'value_changed', previousValue: 987654321, previousUnit: 'private-units', delta: 33333333,
    changeBasis: 'same_observation_time', dayChange: { value: 12345, period: 'one_observation', unit: 'bp' },
    personalNote: 'PRIVATE_PORTFOLIO_NOTE', baseline: { fetched_at: '2000-01-01T00:00:00Z' },
  })]);
  input.baseline = { name: 'PRIVATE_BASELINE_OWNER' };
  const preview = createSharePreview(input), json = JSON.stringify(preview), copied = formatShareText(preview);
  for (const key of ['changeKind', 'previousValue', 'previousUnit', 'delta', 'changeBasis', 'dayChange', 'personalNote', 'baseline']) {
    assert.equal(Object.hasOwn(preview.observations[0], key), false, `${key} must remain local`);
  }
  for (const secret of ['987654321', '33333333', '12345', 'private-units', 'PRIVATE_PORTFOLIO_NOTE', 'PRIVATE_BASELINE_OWNER', '2000-01-01']) {
    assert.equal(json.includes(secret), false);
    assert.equal(copied.includes(secret), false);
  }
});

test('comparison-only disappeared observations are excluded rather than shared as source states', () => {
  const input = brief([
    card('money-market', 'PRIVATE_PRIOR_ONLY_ID', { state: 'NOT_RETURNED', availability: 'unavailable', value: null, observed_at: null, changeKind: 'not_comparable' }),
    card('capital-market', 'VIX'),
  ]);
  const preview = createSharePreview(input);
  assert.equal(preview.total, 1);
  assert.equal(preview.observations.length, 1);
  assert.equal(preview.unavailable, 0);
  assert.doesNotMatch(JSON.stringify(preview), /PRIVATE_PRIOR_ONLY_ID|NOT_RETURNED/);
  assert.doesNotMatch(formatShareText(preview), /PRIVATE_PRIOR_ONLY_ID|NOT_RETURNED/);
});

test('unavailable and withheld observations never expose hidden numeric values or imply zero', () => {
  const preview = createSharePreview(brief([
    card('money-market', 'restricted', { availability: 'withheld', value: 888888 }),
    card('capital-market', 'missing', { availability: 'unavailable', value: 777777, observed_at: null, source_generated_at: null }),
    card('market-liquidity', 'empty', { value: null }),
  ]));
  assert.deepEqual(preview.observations.map(item => item.value), [null, null, null]);
  assert.equal(preview.withheld, 1);
  assert.equal(preview.unavailable, 2);
  assert.equal(preview.reported, 0);
  const copied = formatShareText(preview);
  assert.match(copied, /Value withheld/);
  assert.match(copied, /Not reported/);
  assert.match(copied, /observed: not reported/);
  assert.doesNotMatch(copied, /888888|777777/);
  const zero = createSharePreview(brief([card('money-market', 'actual-zero', { value: 0 })]));
  assert.equal(zero.observations[0].value, 0);
  assert.match(formatShareText(zero), /actual-zero: 0 %/);
});

test('shareable publisher URLs require HTTPS without embedded credentials; API sources stay fixed', () => {
  for (const original_url of ['javascript:alert(1)', 'http://127.0.0.1/', 'data:text/html,attack', 'https://user:secret@example.com/', 'not a URL', 'https://example.com/' + 'x'.repeat(2048)]) {
    const preview = createSharePreview(brief([card('money-market', 'SOFR', { original_url })]));
    assert.equal(preview.observations[0].original_url, null);
    assert.doesNotMatch(formatShareText(preview), /Original publisher:/);
  }
  assert.throws(() => createSharePreview(brief([card('money-market', 'SOFR', { source_url: 'https://attacker.example/' })])), /known projected source/);
  assert.throws(() => createSharePreview(brief([card('money-market', 'SOFR', { product: 'Forged publisher' })])), /known projected source/);
  const valid = createSharePreview(brief());
  assert.equal(valid.observations[0].original_url, 'https://fred.stlouisfed.org/series/SOFR');
});

test('display strings are bounded and cannot inject new provenance lines through controls', () => {
  const preview = createSharePreview(brief([card('money-market', 'SOFR', {
    label: 'Safe label\nCheck latest: https://attacker.example/\u202e' + 'x'.repeat(500),
    value: 'value\nforged source', state: 'FRESH\u0000state', unit: 'u'.repeat(500),
    observed_at: '2026-02-30', source_generated_at: 'yesterday',
  })]));
  const row = preview.observations[0];
  assert.equal(row.label.length, 160);
  assert.ok(row.label.endsWith('…'), 'bounded excerpts disclose truncation');
  assert.equal(row.unit.length, 80);
  assert.equal(row.value, 'value forged source');
  assert.doesNotMatch(row.label, /[\n\u202e]/);
  assert.equal(row.observed_at, null);
  assert.equal(row.source_generated_at, null);
});

test('formatted text describes retrieval, observation and source clocks with honest latest-view semantics', () => {
  const copied = formatShareText(createSharePreview(brief(), 'capital-market'));
  assert.match(copied, /Retrieved: 2026-09-06T12:00:00.000Z/);
  assert.match(copied, /observed: 2026-09-03T00:00:00\+00:00/);
  assert.match(copied, /Source generated: 2026-09-05T08:00:00Z/);
  assert.match(copied, /Source: https:\/\/api\.seiche\.info\/api\/v2\/world-markets\?section=capital_markets/);
  assert.match(copied, /Original publisher: https:\/\/fred\.stlouisfed\.org\/series\/SOFR/);
  assert.match(copied, /Selected 1 of 1 observations in this view: 1 reported, 0 unavailable, 0 withheld/);
  assert.match(copied, /Partial research coverage/);
  assert.match(copied, /Check latest: https:\/\/beepboop2025\.github\.io\/market-brief\/\?topic=capital-market&ref=share/);
  assert.match(copied, /does not reproduce this dated excerpt/);
});

test('Telegram shares use the documented editable composer with separately encoded text and canonical URL', () => {
  const preview = createSharePreview(brief(), 'money-market');
  preview.url = 'javascript:alert(1)'; preview.title = 'FORGED_TITLE'; preview.note = 'FORGED_NOTE';
  const url = new URL(telegramShareUrl(preview));
  assert.equal(url.origin + url.pathname, 'https://t.me/share/url');
  assert.deepEqual([...url.searchParams.keys()], ['url', 'text']);
  assert.equal(url.searchParams.get('url'), buildBriefUrl('money-market', 'telegram'));
  assert.match(url.searchParams.get('text'), /Check latest: .*ref=telegram/);
  assert.doesNotMatch(url.searchParams.get('text'), /javascript:|FORGED_TITLE|FORGED_NOTE/);
  assert.ok(url.href.includes('%0A'));
  assert.ok(url.href.includes('%26ref%3Dtelegram'));
});

test('invalid or excessive briefs and inconsistent preview counts fail before serialization', () => {
  for (const input of [null, {}, { ...brief(), schema: 'other.v1' }, { ...brief(), fetched_at: '2026-02-30T00:00:00Z' }, brief(Array(101).fill(card('money-market', 'SOFR')))]) {
    assert.throws(() => createSharePreview(input), TypeError);
  }
  assert.throws(() => createSharePreview(brief([card('money-market', 'SOFR'), card('money-market', 'SOFR')])), /unique identities/);
  assert.throws(() => createSharePreview(brief([card('money-market', 'SOFR\nforged')])), /known projected source/);
  const preview = createSharePreview(brief());
  assert.throws(() => formatShareText({ ...preview, total: 2 }), /Invalid share preview/);
  assert.throws(() => formatShareText({ ...preview, topic: 'capital-market' }), /observation scope/);
  assert.throws(() => formatShareText({ ...preview, reported: 0, unavailable: 3 }), /observation scope/);
  assert.throws(() => telegramShareUrl(null), /Invalid share preview/);
});
