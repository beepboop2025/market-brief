import test from 'node:test';
import assert from 'node:assert/strict';
import { WATCH_KEY, MAX_WATCHED, parseWatch, serializeWatch, toggleWatch, selectCards, summarizeReview } from '../docs/watchboard.js';

const FUNDING = 'money-market:US-USD:US.NYFED.SOFR';
const VIX = 'capital-market:vix';
const LIQUIDITY = 'market-liquidity:segment:IG';
const record = (id, extra = {}) => ({
  id, topic: id.split(':')[0], value: 3.66, availability: 'reported', state: 'FRESH',
  observed_at: '2026-09-08', changeKind: 'unchanged', ...extra,
});

test('saved watch preferences round trip only bounded IDs and the schema', () => {
  const ids = [FUNDING, VIX, LIQUIDITY], raw = serializeWatch(ids);
  assert.deepEqual(JSON.parse(raw), { schema: WATCH_KEY, ids });
  assert.deepEqual(parseWatch(raw), ids);
  assert.notStrictEqual(parseWatch(raw), ids);
  assert.deepEqual(parseWatch(serializeWatch([])), []);
  const maximumIds = Array.from({ length: MAX_WATCHED }, (_, i) => `money-market:${'a'.repeat(118)}${String(i).padStart(2, '0')}:${'b'.repeat(120)}`);
  // The longest valid adapter components remain within the storage bound.
  assert.deepEqual(parseWatch(serializeWatch(maximumIds)), maximumIds);
});

test('preferences reject unknown fields, schemas, identities, duplicates and oversized inputs', () => {
  const setting = ids => JSON.stringify({ schema: WATCH_KEY, ids });
  for (const raw of [null, undefined, {}, '', 'not json', 'null', '[]', '{}',
    JSON.stringify({ schema: 'future.v2', ids: [VIX] }),
    JSON.stringify({ schema: WATCH_KEY, ids: [VIX], value: 19 }),
    JSON.stringify({ schema: WATCH_KEY, ids: [VIX], notes: 'freeform' }),
    setting([VIX, VIX]), setting(Array.from({ length: 13 }, (_, i) => `capital-market:item${i}`)),
    setting(['unknown-topic:vix']), setting(['capital-market:']), setting(['capital-market:<script>']),
    setting(['capital-market:vix\n']), setting(['capital-market:a:b:c']), setting([`capital-market:${'a'.repeat(121)}`]),
    setting([7]), setting([{ id: VIX }]), setting('capital-market:vix'), ' '.repeat(4097),
  ]) assert.equal(parseWatch(raw), null);
  assert.throws(() => serializeWatch([VIX, VIX]), TypeError);
  assert.throws(() => serializeWatch([`capital-market:${'a'.repeat(300)}`]), TypeError);
  assert.throws(() => serializeWatch(Array.from({ length: 13 }, (_, i) => `capital-market:item${i}`)), RangeError);
});

test('non-JSON list properties, holes and accessors cannot enter persisted preferences', () => {
  const extra = [VIX]; extra.note = 'not persisted';
  const symbol = [VIX]; symbol[Symbol('note')] = 'not persisted';
  const accessor = [VIX]; Object.defineProperty(accessor, 0, { get() { throw new Error('accessor executed'); } });
  for (const ids of [Array(1), extra, symbol, accessor, { 0: VIX, length: 1 }]) {
    assert.throws(() => serializeWatch(ids), error => error instanceof TypeError && !/accessor executed/.test(error.message));
  }
});

test('toggling preserves selection order, permits removal at capacity and never mutates input', () => {
  const initial = Object.freeze([FUNDING]);
  assert.deepEqual(toggleWatch(initial, VIX), [FUNDING, VIX]);
  assert.deepEqual(toggleWatch(initial, FUNDING), []);
  assert.deepEqual(initial, [FUNDING]);
  const full = Object.freeze(Array.from({ length: MAX_WATCHED }, (_, i) => `capital-market:item${i}`));
  assert.throws(() => toggleWatch(full, VIX), RangeError);
  assert.deepEqual(toggleWatch(full, full[2]), full.filter((_, i) => i !== 2));
  assert.throws(() => toggleWatch(initial, 'arbitrary:note'), TypeError);
  assert.throws(() => toggleWatch([FUNDING, FUNDING], VIX), TypeError);
});

test('topic and watched views intersect without reordering or copying source records', () => {
  const cards = Object.freeze([record(LIQUIDITY), record(VIX), record(FUNDING)].map(Object.freeze));
  const watched = Object.freeze([FUNDING, LIQUIDITY]);
  const selected = selectCards(cards, { view: 'watched', watched });
  assert.deepEqual(selected, [cards[0], cards[2]]);
  assert.strictEqual(selected[0], cards[0]);
  assert.deepEqual(selectCards(cards, { topic: 'money-market', view: 'watched', watched }), [cards[2]]);
  assert.deepEqual(selectCards(cards, { topic: 'capital-market', view: 'watched', watched }), []);
  assert.deepEqual(selectCards(cards), cards);
  assert.notStrictEqual(selectCards(cards), cards);
});

test('changes include comparable state and value changes, excluding additions and incomparable records', () => {
  const kinds = ['no_baseline', 'value_changed', 'state_changed', 'added', 'withheld', 'not_comparable', 'unchanged'];
  const cards = kinds.map((changeKind, i) => record(`capital-market:item${i}`, { changeKind }));
  const selected = selectCards(cards, { view: 'changes' });
  assert.deepEqual(selected.map(card => card.changeKind), ['value_changed', 'state_changed']);
  assert.equal(summarizeReview(cards).changed, 2);
});

test('gaps preserve withheld, unavailable, incomparable, source-stale and unclocked coverage records', () => {
  const cards = [
    record(FUNDING, { value: 0 }),
    record(VIX, { value: null, availability: 'withheld', changeKind: 'withheld' }),
    record(LIQUIDITY, { value: null, availability: 'unavailable' }),
    record('capital-market:hy-oas', { changeKind: 'not_comparable' }),
    record('capital-market:funding-regime', { state: ' stale ' }),
    record('money-market:coverage', { value: '4 / 12', evidence_class: 'coverage', observed_at: null }),
    record('capital-market:source-reading', { observed_at: '' }),
  ];
  const before = structuredClone(cards), gaps = selectCards(cards, { view: 'gaps' });
  assert.deepEqual(gaps, cards.slice(1));
  assert.equal(gaps[0].value, null);
  assert.equal(gaps[1].value, null);
  assert.equal(summarizeReview(cards).reported, 5);
  assert.equal(summarizeReview(cards).gaps, 6);
  assert.deepEqual(cards, before);
});

test('missing watched identities remain explicit through disappearance and tombstone expiry', () => {
  const watched = [FUNDING, VIX, LIQUIDITY], cards = [record(FUNDING), record(VIX, {
    value: null, availability: 'unavailable', state: 'NOT_RETURNED', observed_at: null, changeKind: 'not_comparable',
  })];
  assert.deepEqual(summarizeReview(cards, { watched }), {
    total: 2, reported: 1, changed: 0, gaps: 1, watched: 1, missingWatched: [VIX, LIQUIDITY],
  });
  const selected = selectCards(cards, { watched, view: 'watched' });
  assert.equal(selected.length, 2, 'the tombstone remains visible for the source comparison that supplies it');
  assert.equal(selected[1].value, null);
  const after = summarizeReview([cards[0]], { watched });
  assert.deepEqual(after.missingWatched, [VIX, LIQUIDITY]);
  assert.deepEqual(parseWatch(serializeWatch(watched)), watched, 'absence does not delete saved selections');
  assert.deepEqual(selectCards([], { watched, view: 'watched' }), []);
  assert.deepEqual(summarizeReview([], { watched }).missingWatched, watched);
});

test('malformed optional settings fall back predictably without executing accessors', () => {
  const cards = [record(FUNDING), record(VIX)];
  for (const settings of [null, [], 'changes', 1, { topic: 'unknown', view: 'unknown' },
    { get topic() { throw new Error('accessor executed'); }, get view() { throw new Error('accessor executed'); } },
  ]) assert.deepEqual(selectCards(cards, settings), cards);
  for (const watched of [null, 'all', [VIX, VIX], [{ id: VIX }], Array(13).fill(VIX)]) {
    assert.deepEqual(selectCards(cards, { view: 'watched', watched }), []);
    assert.equal(summarizeReview(cards, { watched }).watched, 0);
  }
  assert.equal(summarizeReview(cards, { get watched() { throw new Error('accessor executed'); } }).watched, 0);
  assert.throws(() => selectCards(Array(101).fill(cards[0])), TypeError);
  assert.throws(() => selectCards(Array(1)), TypeError);
  assert.throws(() => summarizeReview(null), TypeError);
});
