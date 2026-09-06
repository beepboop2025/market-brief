import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchBrief, projectSources, SOURCE_ENDPOINTS, InvalidBaselineError } from '../docs/data.js';

const FETCHED = '2026-09-06T12:00:00.000Z';
const nativeId = 'money-market:US-USD:US.NYFED.SOFR';
function fixtures() {
  // Rights fields and hierarchy mirror the inspected public financial-evidence packet.
  const documents = [{
    schema: 'seiche.global-money-markets.v1', ok: true, generated_at: FETCHED, status: 'PARTIAL',
    coverage: { live_benchmarks: 1, declared_markets: 3 },
    markets: [
      { market_id: 'US-USD', status: 'LIVE_REFERENCE', benchmark: { id: 'US.NYFED.SOFR', label: 'SOFR', value: 3.66, unit: '%', availability: 'AVAILABLE', redistribution_status: 'allowed', status: 'FRESH', event_time: '2026-09-03T00:00:00+00:00', asof: '2026-09-03', source_url: 'https://fred.stlouisfed.org/' } },
      { market_id: 'UK-GBP', status: 'DERIVED_CONTEXT', benchmark: null, derived_benchmark: { id: 'GB.BOE.SONIA', label: 'SONIA', value: null, unit: '%', availability: 'DERIVED_CONTEXT', redistribution_status: 'derived_only', status: 'FRESH' } },
      { market_id: 'CN-CNY', status: 'DECLARED_UNAVAILABLE', benchmark: null },
    ],
  }, {
    schema: 'seiche.world-markets.v1', ok: true, selection: 'capital_markets', generated_at: FETCHED,
    capital_markets: { risk_context: { status: 'derived', as_of: '2026-09-03',
      funding_stress: { value: 44.9, regime: 'EROSION' },
      market_vs_plumbing: { asof: '2026-09-03', reading: 'plumbing leads price', components: { VIX: { unit: 'pts' }, HY_OAS: { unit: '%' } } },
      market_prices: { vix: { status: 'observed', value: 14.32, as_of: '2026-09-03' }, high_yield_oas: { status: 'observed', value: 2.65, as_of: '2026-09-03' } },
    } },
  }, { asof: '2026-09-06', funding_regime: 'EROSION', segments: { UST: 'PARTIAL', IG: 'NORMAL', CRYPTO: 'PARTIAL' } }];
  return SOURCE_ENDPOINTS.map((s, i) => ({ topic: s.topic, source_url: s.url, retrieved_at: FETCHED, ok: true, document: documents[i] }));
}
const find = (snapshot, id = nativeId) => snapshot.cards.find(c => c.id === id);
const native = sources => sources[0].document.markets[0].benchmark;
const snapshot = sources => projectSources(sources, FETCHED);
const response = document => new Response(JSON.stringify(document), { headers: { 'content-type': 'application/json; charset=utf-8' } });

test('projects explicit rights and source states without promoting transport to evidence freshness', () => {
  const result = snapshot(fixtures());
  assert.equal(result.schema, 'market-brief.browser.v1');
  assert.equal(result.transport_status, 'complete');
  assert.equal(result.comparison_status, 'no_baseline');
  assert.equal(find(result).value, 3.66);
  assert.equal(find(result).state, 'FRESH');
  assert.equal(find(result).observed_at, '2026-09-03T00:00:00+00:00');
  assert.equal(find(result, 'money-market:UK-GBP:GB.BOE.SONIA').availability, 'withheld');
  assert.equal(find(result, 'money-market:UK-GBP:GB.BOE.SONIA').value, null);
  assert.equal(find(result, 'money-market:CN-CNY:benchmark-unavailable').availability, 'unavailable');
  assert.equal(find(result, 'money-market:coverage').value, '1 / 3');
  assert.equal(find(result, 'money-market:coverage').observed_at, null);
  assert.equal(find(result, 'capital-market:vix').evidence_class, 'observed');
  assert.equal(find(result, 'capital-market:source-reading').evidence_class, 'derived');
  assert.match(result.limitations.join(' '), /freshness has not been independently verified/);
});

test('reordering source envelopes, market rows and segment keys preserves output', () => {
  const sources = fixtures(), original = snapshot(sources);
  sources[0].document.markets.reverse();
  sources[2].document.segments = { CRYPTO: 'PARTIAL', IG: 'NORMAL', UST: 'PARTIAL' };
  sources.reverse();
  assert.deepEqual(snapshot(sources), original);
});

test('generated/retrieved timestamps alone do not manufacture changes', () => {
  const sources = fixtures(), prior = snapshot(sources);
  for (const s of sources) { s.retrieved_at = '2026-09-07T12:00:00Z'; s.document.generated_at = '2026-09-07T12:00:00Z'; }
  const result = projectSources(sources, '2026-09-07T12:00:01Z', prior);
  assert.equal(find(result).changeKind, 'unchanged');
  assert.equal(find(result, 'capital-market:source-reading').changeKind, 'unchanged');
  assert.equal(find(result, 'money-market:coverage').changeKind, 'not_comparable');
});

test('true numeric changes produce a delta and source state changes remain distinct', () => {
  const sources = fixtures(), prior = snapshot(sources);
  native(sources).value = 4;
  let card = find(projectSources(sources, FETCHED, prior));
  assert.equal(card.changeKind, 'value_changed');
  assert.equal(card.previousValue, 3.66);
  assert.ok(Math.abs(card.delta - 0.34) < 1e-12);
  assert.equal(card.changeBasis, 'same_observation_time');
  native(sources).event_time = '2026-09-04T00:00:00Z';
  assert.equal(find(projectSources(sources, FETCHED, prior)).changeBasis, 'new_observation_time');
  native(sources).status = 'STALE';
  card = find(projectSources(sources, FETCHED, prior));
  assert.equal(card.changeKind, 'state_changed');
  assert.equal(card.availability, 'reported');
  assert.equal(card.state, 'STALE');
});

test('source-reported one-observation changes remain separate from saved-brief deltas and respect rights', () => {
  const sources = fixtures(); native(sources).change_1_observation = -0.5; native(sources).change_unit = 'bp';
  let c = find(snapshot(sources));
  assert.deepEqual(c.dayChange, { value: -0.5, unit: 'bp', period: 'one_observation' });
  assert.equal(c.delta, undefined); assert.equal(c.changeKind, 'no_baseline');
  const prior = snapshot(sources);
  assert.equal(find(projectSources(sources, FETCHED, prior)).changeKind, 'unchanged');
  native(sources).redistribution_status = 'derived_only';
  c = find(snapshot(sources));
  assert.equal(c.value, null); assert.equal(c.dayChange, undefined); assert.equal(c.observed_at, null);
});

test('newer observations with equal values are unchanged; regressed/unknown clocks are not comparable', () => {
  const sources = fixtures(), prior = snapshot(sources);
  native(sources).event_time = '2026-09-04T00:00:00Z';
  assert.equal(find(projectSources(sources, FETCHED, prior)).changeKind, 'unchanged');
  native(sources).event_time = '2026-09-02T00:00:00Z';
  assert.equal(find(projectSources(sources, FETCHED, prior)).changeKind, 'not_comparable');
  native(sources).event_time = '2026-02-30';
  assert.equal(find(projectSources(sources, FETCHED, prior)).changeKind, 'not_comparable');
  delete native(sources).event_time; delete native(sources).asof;
  assert.equal(find(projectSources(sources, FETCHED, prior)).changeKind, 'not_comparable');
});

test('unit or provenance changes are not compared; a different benchmark identity is added', () => {
  const sources = fixtures(), prior = snapshot(sources);
  native(sources).unit = 'bp';
  assert.equal(find(projectSources(sources, FETCHED, prior)).changeKind, 'not_comparable');
  native(sources).unit = '%'; native(sources).source_url = 'https://example.com/other-source';
  assert.equal(find(projectSources(sources, FETCHED, prior)).changeKind, 'not_comparable');
  native(sources).id = 'US.NYFED.EFFR';
  assert.equal(find(projectSources(sources, FETCHED, prior), 'money-market:US-USD:US.NYFED.EFFR').changeKind, 'added');
});

test('unavailable, restricted, missing-rights and missing-availability values never become zero', () => {
  for (const mutate of [b => { b.redistribution_status = 'restricted'; }, b => { delete b.redistribution_status; }, b => { delete b.availability; }, b => { b.availability = 'UNAVAILABLE'; }]) {
    const sources = fixtures(); native(sources).value = 0; mutate(native(sources));
    const c = find(snapshot(sources));
    assert.equal(c.value, null); assert.notEqual(c.availability, 'reported');
  }
  const sources = fixtures(); native(sources).value = 0;
  assert.equal(find(snapshot(sources)).value, 0, 'an explicitly allowed actual zero remains zero');
  sources[1].document.capital_markets.risk_context.market_prices.vix.status = 'RESTRICTED';
  const c = find(snapshot(sources), 'capital-market:vix');
  assert.equal(c.availability, 'withheld'); assert.equal(c.value, null);
  sources[2].document.segments.IG = 'UNAVAILABLE';
  assert.equal(find(snapshot(sources), 'market-liquidity:segment:IG').value, null);
});

test('parent restrictions propagate through every capital-market evidence path', () => {
  const selectors = [d => d, d => d.capital_markets, d => d.capital_markets.risk_context];
  for (const select of selectors) for (const [field, value, expected] of [
    ['status', 'restricted', 'withheld'], ['availability', 'UNAVAILABLE', 'unavailable'],
    ['evidence_status', 'BLOCKED', 'unavailable'], ['redistribution_status', 'denied', 'withheld'],
  ]) {
    const sources = fixtures(); select(sources[1].document)[field] = value;
    const cards = snapshot(sources).cards.filter(c => c.topic === 'capital-market');
    assert.equal(cards.length, 4);
    for (const c of cards) {
      assert.equal(c.availability, expected, `${field} must deny ${c.id}`);
      assert.equal(c.value, null); assert.equal(c.observed_at, null);
      assert.equal(c.state, value); assert.notEqual(c.evidence_class, 'observed');
    }
  }
  const sources = fixtures(), r = sources[1].document.capital_markets.risk_context;
  r.market_prices.redistribution_status = 'restricted';
  r.funding_stress.evidence_status = 'UNAVAILABLE';
  r.market_vs_plumbing.availability = 'BLOCKED';
  assert.ok(snapshot(sources).cards.filter(c => c.topic === 'capital-market').every(c => c.value === null));
});

test('money-market ancestor and native benchmark failures suppress values and source changes', () => {
  const selectors = [d => d, d => d.markets[0], d => d.markets[0].benchmark];
  for (const select of selectors) for (const [field, value] of [
    ['status', 'UNAVAILABLE'], ['status', 'DEAD'], ['status', 'BLOCKED'],
    ['availability', 'restricted'], ['evidence_status', 'UNAVAILABLE'], ['redistribution_status', 'denied'],
  ]) {
    const sources = fixtures(); native(sources).change_1_observation = 3; native(sources).change_unit = 'bp';
    select(sources[0].document)[field] = value;
    const c = find(snapshot(sources));
    assert.equal(c.value, null, `${field}:${value} must suppress benchmark`);
    assert.notEqual(c.availability, 'reported'); assert.notEqual(c.evidence_class, 'observed');
    assert.equal(c.dayChange, undefined); assert.equal(c.observed_at, null);
  }
  const sources = fixtures(); sources[0].document.status = 'restricted';
  assert.equal(find(snapshot(sources), 'money-market:coverage').value, null);
});

test('liquidity document and segment-container restrictions suppress all affected states', () => {
  for (const [field, value] of [['status', 'restricted'], ['availability', 'UNAVAILABLE'], ['evidence_status', 'DEAD'], ['redistribution_status', 'denied']]) {
    const sources = fixtures(); sources[2].document[field] = value;
    for (const c of snapshot(sources).cards.filter(c => c.topic === 'market-liquidity')) {
      assert.equal(c.value, null); assert.notEqual(c.availability, 'reported'); assert.equal(c.state, value);
    }
    const nested = fixtures(); nested[2].document.segments[field] = value;
    const result = snapshot(nested);
    assert.equal(find(result, 'market-liquidity:funding-regime').value, 'EROSION');
    assert.ok(result.cards.filter(c => c.id.startsWith('market-liquidity:segment:')).every(c => c.value === null));
    assert.equal(result.cards.some(c => c.id === `market-liquidity:segment:${field}`), false);
  }
});

test('unknown native and source states remain not evaluated, while stale ancestors remain stale', () => {
  for (const status of ['FUTURE_STATUS', 'PARTIAL', null]) {
    const sources = fixtures(); native(sources).status = status;
    const c = find(snapshot(sources));
    assert.equal(c.value, null); assert.equal(c.availability, 'unavailable');
    assert.equal(c.evidence_class, 'not_evaluated');
  }
  const sources = fixtures(); sources[1].document.status = 'FUTURE_STATUS';
  sources[2].document.segments.IG = 'FUTURE_STATUS';
  for (const id of ['capital-market:vix', 'market-liquidity:segment:IG']) {
    const c = find(snapshot(sources), id);
    assert.equal(c.value, null); assert.equal(c.evidence_class, 'not_evaluated');
  }
  const stale = fixtures(); stale[0].document.status = 'STALE';
  assert.equal(find(snapshot(stale)).state, 'STALE');
  assert.equal(find(snapshot(stale)).value, 3.66);
});

test('derived benchmark metadata cannot become a native observation even with permissive child flags', () => {
  const sources = fixtures(), market = sources[0].document.markets[1];
  market.status = 'LIVE_REFERENCE';
  Object.assign(market.derived_benchmark, { value: 4.5, availability: 'AVAILABLE', redistribution_status: 'allowed', event_time: '2026-09-03', source_url: 'https://example.com/derived', change_1_observation: 9, change_unit: 'bp' });
  const c = find(snapshot(sources), 'money-market:UK-GBP:GB.BOE.SONIA');
  assert.equal(c.value, null); assert.equal(c.availability, 'withheld');
  assert.equal(c.evidence_class, 'derived'); assert.equal(c.state, 'DERIVED_CONTEXT');
  assert.equal(c.original_url, null); assert.equal(c.observed_at, null); assert.equal(c.dayChange, undefined);
});

test('disappeared markets, changed identities and failed sources leave unavailable comparison records', () => {
  const sources = fixtures(), prior = snapshot(sources);
  sources[0].document.markets.shift(); delete sources[2].document.segments.IG;
  sources[1].ok = false;
  const result = projectSources(sources, FETCHED, prior);
  for (const id of [nativeId, 'market-liquidity:segment:IG', 'capital-market:vix']) {
    const c = find(result, id);
    assert.equal(c.state, 'NOT_RETURNED'); assert.equal(c.availability, 'unavailable');
    assert.equal(c.changeKind, 'not_comparable'); assert.equal(c.value, null);
    assert.equal(c.previousValue, undefined); assert.equal(c.delta, undefined); assert.equal(c.dayChange, undefined);
  }
  assert.doesNotThrow(() => projectSources(sources, FETCHED, result));
  const replacement = fixtures(); native(replacement).id = 'US.NYFED.EFFR';
  const changed = projectSources(replacement, FETCHED, prior);
  assert.equal(find(changed).state, 'NOT_RETURNED');
  assert.equal(find(changed, 'money-market:US-USD:US.NYFED.EFFR').changeKind, 'added');
});

test('capital units use the exact observation or adapter defaults, never unrelated components', () => {
  const sources = fixtures(), r = sources[1].document.capital_markets.risk_context;
  r.market_vs_plumbing.components.VIX.unit = 'unrelated dollars';
  r.market_vs_plumbing.components.HY_OAS.unit = 'unrelated contracts';
  assert.equal(find(snapshot(sources), 'capital-market:vix').unit, 'pts');
  assert.equal(find(snapshot(sources), 'capital-market:hy-oas').unit, '%');
  const prior = snapshot(sources);
  r.market_prices.vix.unit = 'index points'; r.market_prices.high_yield_oas.unit = 'bp';
  const result = projectSources(sources, FETCHED, prior);
  assert.equal(find(result, 'capital-market:vix').unit, 'index points');
  assert.equal(find(result, 'capital-market:hy-oas').unit, 'bp');
  assert.equal(find(result, 'capital-market:hy-oas').changeKind, 'not_comparable');
});

test('future saved comparisons raise InvalidBaselineError before network requests', async () => {
  const prior = snapshot(fixtures()); prior.fetched_at = '2026-09-07T00:00:00.000Z';
  assert.throws(() => projectSources(fixtures(), FETCHED, prior), e => e instanceof InvalidBaselineError && /future/.test(e.message));
  let calls = 0;
  await assert.rejects(fetchBrief({ previous: prior, now: () => new Date(FETCHED), fetchImpl: async () => { calls++; } }), InvalidBaselineError);
  assert.equal(calls, 0);
});

test('unknown schemas and duplicate source identities become explicit source failures', () => {
  const sources = fixtures(); sources[0].document.schema = 'future.v9';
  let result = snapshot(sources);
  assert.equal(result.transport_status, 'partial');
  assert.equal(find(result, 'money-market:unavailable').value, null);
  sources[0] = fixtures()[0]; sources[0].document.markets.push(structuredClone(sources[0].document.markets[0]));
  result = snapshot(sources);
  assert.match(result.errors[0].message, /duplicate market/i);
  result = snapshot([fixtures()[0], fixtures()[0]]);
  assert.equal(result.transport_status, 'unavailable');
  assert.match(result.errors[0].message, /duplicate source/i);
  const unknown = fixtures(); unknown[2].document.schema = 'new-summary.v2';
  assert.equal(find(snapshot(unknown), 'market-liquidity:unavailable').availability, 'unavailable');
});

test('source strings stay inert text and unsafe URLs are omitted', () => {
  const sources = fixtures(), attack = '<img src=x onerror="globalThis.pwned=true">';
  native(sources).label = attack; native(sources).source_url = 'javascript:alert(1)';
  sources[1].document.capital_markets.risk_context.market_vs_plumbing.reading = attack;
  const result = snapshot(sources);
  assert.equal(find(result).label, `US-USD · ${attack}`);
  assert.equal(find(result).original_url, null);
  assert.equal(find(result, 'capital-market:source-reading').value, attack);
  assert.equal(globalThis.pwned, undefined);
});

test('JSON shape bounds reject exotic, excessive and cyclic documents', () => {
  for (const invalid of [NaN, Infinity, new Date(), { get execute() { throw new Error('getter ran'); } }, JSON.parse('{"__proto__":{"polluted":true}}'), 'x'.repeat(4097), Array(2049).fill(null)]) {
    const sources = fixtures(); sources[0].document.extra = invalid;
    const result = snapshot(sources);
    assert.equal(find(result, 'money-market:unavailable').availability, 'unavailable');
    assert.doesNotMatch(result.errors[0].message, /getter ran/);
  }
  const sources = fixtures(); sources[0].document.loop = sources[0].document;
  assert.equal(snapshot(sources).transport_status, 'partial');
});

test('malformed saved comparisons throw a typed error before network requests', async () => {
  const prior = snapshot(fixtures());
  for (const mutate of [p => { p.schema = 'other'; }, p => { p.cards.push(structuredClone(p.cards[0])); }, p => { p.cards[0].value = NaN; }, p => { p.cards[0].observed_at = '2026-02-30'; }, p => { p.errors = [1]; }]) {
    const malformed = structuredClone(prior); mutate(malformed);
    assert.throws(() => projectSources(fixtures(), FETCHED, malformed), InvalidBaselineError);
  }
  let called = false;
  await assert.rejects(fetchBrief({ previous: {}, fetchImpl: async () => { called = true; } }), e => e.code === 'INVALID_BASELINE');
  assert.equal(called, false);
});

test('fetchBrief makes only fixed anonymous JSON requests and preserves partial failures', async () => {
  const sources = fixtures(), calls = [];
  const result = await fetchBrief({ now: () => new Date(FETCHED), fetchImpl: async (endpoint, options) => {
    calls.push(endpoint);
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.equal(options.referrerPolicy, 'no-referrer'); assert.equal(options.headers.Accept, 'application/json');
    assert.ok(options.signal instanceof AbortSignal);
    if (endpoint === SOURCE_ENDPOINTS[1].url) throw new Error('Network unavailable');
    return response(sources.find(s => s.source_url === endpoint).document);
  } });
  assert.deepEqual(calls.sort(), SOURCE_ENDPOINTS.map(s => s.url).sort());
  assert.equal(result.fetched_at, FETCHED); assert.equal(result.transport_status, 'partial');
  assert.equal(find(result).value, 3.66);
  assert.equal(find(result, 'capital-market:unavailable').availability, 'unavailable');
});

test('fetchBrief rejects wrong media types, invalid JSON, redirects and excessive bytes', async () => {
  for (const make of [
    () => new Response('<html>no</html>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('{"value": NaN}', { headers: { 'content-type': 'application/json' } }),
    () => new Response('{}', { status: 302, headers: { 'content-type': 'application/json' } }),
    () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '1572865' } }),
    () => new Response(' '.repeat(1_572_865), { headers: { 'content-type': 'application/json' } }),
  ]) {
    const result = await fetchBrief({ now: () => new Date(FETCHED), fetchImpl: async () => make() });
    assert.equal(result.transport_status, 'unavailable'); assert.equal(result.errors.length, 3);
    assert.ok(result.cards.every(c => c.value === null && c.availability === 'unavailable'));
  }
});

test('the request deadline ends even when a fetch implementation ignores abort', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const pending = fetchBrief({ now: () => new Date(FETCHED), fetchImpl: () => new Promise(() => {}) });
    t.mock.timers.tick(20_000);
    const result = await pending;
    assert.equal(result.transport_status, 'unavailable');
    assert.ok(result.errors.every(e => /20 seconds/.test(e.message)));
  } finally { t.mock.timers.reset(); }
});
