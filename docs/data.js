// A bounded projection of public evidence. Consumers must render strings as text, never HTML.
export const SOURCE_ENDPOINTS = Object.freeze([
  { topic: 'money-market', product: 'Seiche', url: 'https://api.seiche.info/api/v2/money-markets' },
  { topic: 'capital-market', product: 'Seiche', url: 'https://api.seiche.info/api/v2/world-markets?section=capital_markets' },
  { topic: 'market-liquidity', product: 'Undertow', url: 'https://api.seiche.info/undertow/x402/summary' },
].map(Object.freeze));
const SCHEMA = 'market-brief.browser.v1', MAX_BYTES = 1_572_864;
const AVAILABILITY = ['reported', 'withheld', 'unavailable'];
const CHANGES = ['no_baseline', 'unchanged', 'value_changed', 'state_changed', 'added', 'withheld', 'not_comparable'];
const CONTROL_FIELDS = ['status', 'availability', 'evidence_status', 'redistribution_status'];
const KNOWN_STATES = new Set(['FRESH', 'STALE', 'OBSERVED', 'DERIVED', 'PARTIAL', 'COMPLETE', 'AVAILABLE', 'REPORTED', 'LIVE_REFERENCE', 'NORMAL', 'LIVE', 'OK', 'EROSION', 'CALM', 'WATCH', 'STRESS', 'CRISIS']);
const normalize = v => typeof v === 'string' ? v.trim().toUpperCase().replace(/[\s-]+/g, '_') : '';
const LIMITATIONS = [
  'Source-reported states are retained; freshness has not been independently verified.',
  'This is partial research coverage, not executable quotes or trading instructions.',
  'Restricted and missing observations remain withheld or unavailable, never zero.',
  'Generated and fetched times do not advance observation clocks or count as evidence changes.',
  'Capital-market composite dates describe child evidence; they are not independent observation clocks.',
  'NOT_RETURNED marks an observation absent from the latest response, not a new source-reported market state.',
];
export class InvalidBaselineError extends TypeError {
  constructor(message) { super(message); this.name = 'InvalidBaselineError'; this.code = 'INVALID_BASELINE'; }
}
const text = (v, limit = 240) => typeof v === 'string' && v.trim() && v.length <= limit ? v : null;
const scalar = v => typeof v === 'number' && Number.isFinite(v) || !!text(v, 800);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const identity = v => text(v, 120) && /^[A-Za-z0-9_.-]+$/.test(v) ? v : null;
function date(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(v)) return null;
  const day = new Date(`${v.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(Date.parse(v)) && Number.isFinite(+day) && day.toISOString().slice(0, 10) === v.slice(0, 10) ? v : null;
}
function url(v) {
  if (!text(v, 2048)) return null;
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; }
  catch { return null; }
}
// Reject non-JSON objects/accessors, cycles and excessive structures before projection.
function validateJSON(root) {
  const seen = new WeakSet(); let nodes = 0;
  function visit(v, depth) {
    if (++nodes > 100_000 || depth > 12) throw new Error('Source structure exceeds its limit.');
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'string') { if (v.length > 4096) throw new Error('Source text exceeds its limit.'); return; }
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (typeof v !== 'object' || seen.has(v)) throw new Error('Source contains non-JSON values.');
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw new Error('Source contains a non-JSON object.');
    seen.add(v);
    const keys = Reflect.ownKeys(v).filter(k => !(array && k === 'length'));
    if (keys.length > (array ? 2048 : 256) || array && keys.length !== v.length) throw new Error('Source collection exceeds its limit or is sparse.');
    for (const k of keys) {
      const d = Object.getOwnPropertyDescriptor(v, k);
      if (typeof k !== 'string' || k.length > 160 || ['__proto__', 'prototype', 'constructor'].includes(k) || !d.enumerable || !('value' in d) || array && !/^(0|[1-9]\d*)$/.test(k)) throw new Error('Source contains an invalid JSON field.');
      visit(d.value, depth + 1);
    }
  }
  visit(root, 0);
}
function baseline(previous, fetchedAt) {
  if (previous === null) return null;
  try {
    validateJSON(previous);
    if (!object(previous) || previous.schema !== SCHEMA || !date(previous.fetched_at) || !previous.fetched_at.includes('T') || !['complete', 'partial', 'unavailable'].includes(previous.transport_status) || !['no_baseline', 'compared'].includes(previous.comparison_status) || !Array.isArray(previous.cards) || previous.cards.length > 100 || !Array.isArray(previous.errors) || !Array.isArray(previous.limitations)) throw new Error('Invalid browser snapshot.');
    if (fetchedAt && Date.parse(previous.fetched_at) > Date.parse(fetchedAt)) throw new Error('Saved comparison is from the future.');
    if (previous.cards.filter(c => c?.state !== 'NOT_RETURNED').length > 50) throw new Error('Too many current baseline cards.');
    if (previous.errors.length > 3 || previous.errors.some(e => !object(e) || !SOURCE_ENDPOINTS.some(s => s.topic === e.topic) || !text(e.message)) || previous.limitations.some(l => !text(l, 800))) throw new Error('Invalid baseline notes.');
    const map = new Map();
    for (const c of previous.cards) {
      const source = SOURCE_ENDPOINTS.find(s => s.topic === c?.topic);
      if (!object(c) || !text(c.id, 300) || map.has(c.id) || !text(c.label) || !source || c.product !== source.product || c.source_url !== source.url || !text(c.unit, 80) || !text(c.state, 128) || !text(c.evidence_class, 80) || !AVAILABILITY.includes(c.availability) || !CHANGES.includes(c.changeKind)) throw new Error('Invalid or duplicate baseline card.');
      if (c.original_url !== null && url(c.original_url) !== c.original_url || c.observed_at !== null && !date(c.observed_at) || c.source_generated_at !== null && !date(c.source_generated_at)) throw new Error('Invalid baseline provenance.');
      if (c.availability === 'reported' ? !scalar(c.value) : c.value !== null) throw new Error('Invalid baseline observation.');
      if ('delta' in c && (typeof c.delta !== 'number' || !Number.isFinite(c.delta)) || 'previousValue' in c && !scalar(c.previousValue) || 'previousUnit' in c && !text(c.previousUnit, 80)) throw new Error('Invalid baseline comparison.');
      if ('changeBasis' in c && !['same_observation_time', 'new_observation_time'].includes(c.changeBasis)) throw new Error('Invalid comparison time basis.');
      if ('dayChange' in c && (!object(c.dayChange) || c.availability !== 'reported' || typeof c.dayChange.value !== 'number' || !Number.isFinite(c.dayChange.value) || !text(c.dayChange.unit, 80) || c.dayChange.period !== 'one_observation')) throw new Error('Invalid source-reported change.');
      map.set(c.id, c);
    }
    return map;
  } catch (e) { throw new InvalidBaselineError(`Saved comparison is invalid: ${e.message}`); }
}
// Restrictions are monotone: no child can re-enable evidence denied by an ancestor.
function restriction(chain) {
  let failure = null;
  for (const node of chain.filter(object)) for (const field of CONTROL_FIELDS) {
    if (!Object.hasOwn(node, field)) continue;
    const raw = node[field], n = normalize(raw); let next = null;
    if (/(?:^|_)(RESTRICTED|WITHHELD|FORBIDDEN|DENIED|PROHIBITED|REDACTED)(?:_|$)/.test(n) || ['DERIVED_ONLY', 'DERIVED_CONTEXT', 'NOT_ALLOWED', 'NO_REDISTRIBUTION', 'LICENSE_REQUIRED'].includes(n)) next = { availability: 'withheld', evidence_class: 'restricted', rank: 3 };
    else if (/(?:^|_)(UNAVAILABLE|DEAD|BLOCKED|MISSING|FAILED|ERROR|DISABLED|SUSPENDED|EXPIRED|INELIGIBLE|QUARANTINE|HOLD)(?:_|$)/.test(n) || ['NOT_AVAILABLE', 'POLICY_ONLY'].includes(n)) next = { availability: 'unavailable', evidence_class: 'unavailable', rank: 2 };
    else if (field === 'redistribution_status' ? n !== 'ALLOWED' : !KNOWN_STATES.has(n)) next = { availability: 'unavailable', evidence_class: 'not_evaluated', rank: 1 };
    if (next && (!failure || next.rank > failure.rank)) failure = { ...next, state: text(raw, 128) || 'NOT_EVALUATED' };
  }
  return failure;
}
function card(source, d, id, label, value, unit, state, observed, evidence, original = null, availability = 'reported', parents = []) {
  const chain = [d, ...parents], failure = restriction(chain);
  const stale = chain.find(n => object(n) && normalize(n.status) === 'STALE')?.status;
  const result = { id: `${source.topic}:${id}`, label: text(label) || id, topic: source.topic, product: source.product,
    value: availability === 'reported' && scalar(value) ? value : null, unit: text(unit, 80) || 'not supplied',
    availability: availability === 'reported' && !scalar(value) ? 'unavailable' : availability,
    state: text(stale, 128) || text(state, 128) || 'NOT_EVALUATED', source_url: source.url, original_url: url(original),
    observed_at: date(observed), source_generated_at: date(d.generated_at), evidence_class: evidence, changeKind: 'no_baseline' };
  return failure ? { ...result, value: null, observed_at: null, state: failure.state,
    availability: availability === 'withheld' ? 'withheld' : failure.availability,
    evidence_class: availability === 'withheld' ? evidence === 'derived' ? 'derived' : 'restricted' : failure.evidence_class } : result;
}
function money(source, d) {
  if (d.schema !== 'seiche.global-money-markets.v1' || d.ok !== true || !Array.isArray(d.markets) || !object(d.coverage)) throw new Error('Unrecognized money-market schema.');
  const ids = new Set(), rows = [...d.markets];
  for (const m of rows) {
    if (!identity(m?.market_id) || ids.has(m.market_id)) throw new Error('Invalid or duplicate market identity.');
    ids.add(m.market_id);
  }
  const cards = rows.sort((a, b) => a.market_id.localeCompare(b.market_id)).slice(0, 12).map(m => {
    const b = m.benchmark;
    if (b !== null && b !== undefined && (!object(b) || !identity(b.id))) throw new Error('Invalid benchmark identity.');
    if (!b && m.derived_benchmark != null) {
      const meta = m.derived_benchmark;
      if (!object(meta) || !identity(meta.id)) throw new Error('Invalid derived benchmark metadata.');
      return card(source, d, `${m.market_id}:${meta.id}`, `${m.market_id} · ${text(meta.label, 120) || 'Derived benchmark context'}`, null, meta.unit, 'DERIVED_CONTEXT', null, 'derived', null, 'withheld', [m, meta]);
    }
    const permitted = normalize(b?.redistribution_status) === 'ALLOWED' && normalize(b?.availability) === 'AVAILABLE';
    const known = ['FRESH', 'STALE'].includes(normalize(b?.status));
    const withheld = !!b && !permitted && (normalize(b.redistribution_status) !== 'ALLOWED' || !text(b.availability) || normalize(b.availability) === 'DERIVED_CONTEXT');
    const availability = permitted && known && scalar(b?.value) ? 'reported' : withheld ? 'withheld' : 'unavailable';
    const evidence = withheld ? 'restricted' : b && !known ? 'not_evaluated' : b ? 'observed' : 'unavailable';
    const result = card(source, d, `${m.market_id}:${b?.id || 'benchmark-unavailable'}`, `${m.market_id} · ${text(b?.label, 120) || 'Funding benchmark'}`, b?.value, b?.unit, b?.status || m.status,
      availability === 'withheld' ? null : b?.event_time ?? b?.asof, evidence, b?.source_url, availability, [m, b, ...(b && !text(b.status) ? [{ status: 'NOT_EVALUATED' }] : [])]);
    if (result.availability === 'reported' && typeof b.change_1_observation === 'number' && Number.isFinite(b.change_1_observation) && text(b.change_unit, 80)) result.dayChange = { value: b.change_1_observation, unit: b.change_unit, period: 'one_observation' };
    return result;
  });
  const { live_benchmarks: live, declared_markets: declared } = d.coverage;
  const valid = Number.isSafeInteger(live) && Number.isSafeInteger(declared) && live >= 0 && declared > 0 && live <= declared;
  cards.push(card(source, d, 'coverage', 'Reported live funding coverage', valid ? `${live} / ${declared}` : null, 'declared markets', d.status, null, 'coverage', null, 'reported', [d.coverage]));
  return cards;
}
function capital(source, d) {
  if (d.schema !== 'seiche.world-markets.v1' || d.ok !== true || d.selection !== 'capital_markets' || !object(d.capital_markets?.risk_context)) throw new Error('Unrecognized capital-market schema.');
  const c = d.capital_markets, r = c.risk_context, m = r.market_vs_plumbing ?? {}, p = r.market_prices ?? {};
  // Fixed public adapter definitions: VIX is index points; HY OAS is percentage points (%).
  const priceUnit = (item, fallback) => object(item) && Object.hasOwn(item, 'unit') ? item.unit : fallback;
  const reported = (id, label, value, unit, status, observed, evidence = 'derived', nodes = []) => {
    const normalized = typeof status === 'string' ? status.toLowerCase() : '';
    const withheld = ['restricted', 'withheld'].includes(normalized);
    const availability = withheld ? 'withheld' : ['observed', 'derived', 'stale'].includes(normalized) ? 'reported' : 'unavailable';
    return card(source, d, id, label, value, unit, status, observed, evidence, null, availability, [c, r, ...nodes, { status: status ?? 'NOT_EVALUATED' }]);
  };
  return [
    reported('funding-regime', 'Funding regime', r.funding_stress?.regime, 'regime', r.status, r.as_of, 'derived', [r.funding_stress]),
    reported('vix', 'VIX', p.vix?.value, priceUnit(p.vix, 'pts'), p.vix?.status, p.vix?.as_of, 'observed', [p, p.vix]),
    reported('hy-oas', 'High-yield option-adjusted spread', p.high_yield_oas?.value, priceUnit(p.high_yield_oas, '%'), p.high_yield_oas?.status, p.high_yield_oas?.as_of, 'observed', [p, p.high_yield_oas]),
    reported('source-reading', 'Source-derived capital-market reading', m.reading, 'reading', r.status, m.asof, 'derived', [m]),
  ];
}
function liquidity(source, d) {
  // This public summary has no schema field; its exact structural contract is the discriminator.
  if ('schema' in d || !date(d.asof) || !text(d.funding_regime, 128) || !object(d.segments) || Object.keys(d.segments).length > 32) throw new Error('Unrecognized market-liquidity summary.');
  const stateAvailability = state => /restricted|withheld/i.test(state) ? 'withheld' : /unavailable|missing/i.test(state) ? 'unavailable' : 'reported';
  const cards = [card(source, d, 'funding-regime', 'Liquidity funding regime', d.funding_regime, 'regime', d.funding_regime, d.asof, 'derived', null, stateAvailability(d.funding_regime), [{ status: d.funding_regime }])];
  for (const [id, state] of Object.entries(d.segments).sort(([a], [b]) => a.localeCompare(b))) {
    if (CONTROL_FIELDS.includes(id)) continue;
    if (!identity(id) || !text(state, 128)) throw new Error('Invalid liquidity segment.');
    const availability = stateAvailability(state);
    cards.push(card(source, d, `segment:${id}`, `${id} liquidity coverage`, state, 'state', state, d.asof, 'source_reported_state', null, availability, [d.segments, { status: state }]));
  }
  return cards;
}
function compare(c, prior) {
  if (c.availability === 'withheld') return { ...c, changeKind: 'withheld' };
  if (prior === null) return c;
  const p = prior.get(c.id); let changeKind = 'not_comparable';
  if (!p && c.availability === 'reported') changeKind = 'added';
  else if (p && c.availability === 'reported' && p.availability === 'reported' && c.unit !== 'not supplied' && ['topic', 'product', 'unit', 'source_url', 'original_url', 'evidence_class'].every(k => c[k] === p[k]) && typeof c.value === typeof p.value && c.observed_at && p.observed_at && Date.parse(c.observed_at) >= Date.parse(p.observed_at)) {
    changeKind = c.state !== p.state ? 'state_changed' : c.value !== p.value ? 'value_changed' : 'unchanged';
    const delta = typeof c.value === 'number' ? c.value - p.value : null;
    const basis = c.value !== p.value ? { changeBasis: Date.parse(c.observed_at) === Date.parse(p.observed_at) ? 'same_observation_time' : 'new_observation_time' } : {};
    return { ...c, changeKind, previousValue: p.value, previousUnit: p.unit, ...basis, ...(Number.isFinite(delta) ? { delta } : {}) };
  }
  return { ...c, changeKind };
}
/** Pure input: [{topic, source_url, document, ok, error?}]; omitted topics become unavailable. */
export function projectSources(sources, fetchedAt, previous = null) {
  if (!date(fetchedAt) || !fetchedAt.includes('T')) throw new TypeError('fetchedAt must be an ISO timestamp.');
  const prior = baseline(previous, fetchedAt);
  if (!Array.isArray(sources) || sources.length > 3) throw new TypeError('At most three source envelopes are accepted.');
  const cards = [], errors = []; let successful = 0;
  for (const source of SOURCE_ENDPOINTS) {
    const matches = sources.filter(s => s?.topic === source.topic), envelope = matches[0];
    try {
      if (matches.length > 1) throw new Error('Duplicate source topic.');
      if (!envelope || envelope.ok !== true) throw new Error(text(envelope?.error, 200) || 'Source unavailable.');
      if (envelope.source_url !== source.url) throw new Error('Source URL does not match the fixed public endpoint.');
      validateJSON(envelope.document);
      const d = envelope.document;
      if (!object(d)) throw new Error('Source document must be a JSON object.');
      const projected = source.topic === 'money-market' ? money(source, d) : source.topic === 'capital-market' ? capital(source, d) : liquidity(source, d);
      cards.push(...projected); successful++;
    } catch (e) {
      errors.push({ topic: source.topic, message: text(e.message, 240) || 'Source validation failed.' });
      cards.push(card(source, {}, 'unavailable', `${source.product} ${source.topic}`, null, 'not supplied', 'UNAVAILABLE', null, 'unavailable', null, 'unavailable'));
    }
  }
  if (sources.some(s => !SOURCE_ENDPOINTS.some(x => x.topic === s?.topic))) throw new TypeError('Unknown source topic.');
  const current = new Set(cards.map(c => c.id));
  for (const p of prior?.values() ?? []) if (!current.has(p.id) && p.state !== 'NOT_RETURNED') {
    // Preserve disappearance for one comparison without retaining old values or growing forever.
    cards.push({ id: p.id, label: p.label, topic: p.topic, product: p.product, value: null, unit: p.unit,
      availability: 'unavailable', state: 'NOT_RETURNED', source_url: p.source_url, original_url: p.original_url,
      observed_at: null, source_generated_at: null, evidence_class: 'unavailable', changeKind: 'not_comparable' });
  }
  if (new Set(cards.map(c => c.id)).size !== cards.length) throw new TypeError('Duplicate projected identity.');
  return { schema: SCHEMA, fetched_at: new Date(fetchedAt).toISOString(), transport_status: successful === 3 ? 'complete' : successful ? 'partial' : 'unavailable',
    cards: cards.map(c => compare(c, prior)).sort((a, b) => a.id.localeCompare(b.id)), errors,
    comparison_status: prior === null ? 'no_baseline' : 'compared', limitations: [...LIMITATIONS] };
}
async function readSource(source, fetchImpl) {
  const controller = new AbortController(); let timer, reader;
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Source request exceeded 20 seconds.')); }, 20_000); });
    const work = async () => {
      const response = await fetchImpl(source.url, { method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!response.ok || response.redirected || response.url && response.url !== source.url) throw new Error('Source HTTP response was unsuccessful or redirected.');
      if (!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('Source did not return JSON content.');
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw new Error('Source exceeds the 1.5 MiB response limit.');
      if (!response.body?.getReader) throw new Error('Source streaming body is unavailable.');
      reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true }); let total = 0, raw = '';
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array) || (total += chunk.value.byteLength) > MAX_BYTES) throw new Error('Source exceeds the 1.5 MiB response limit.');
        raw += decoder.decode(chunk.value, { stream: true });
      }
      const document = JSON.parse(raw + decoder.decode()); validateJSON(document);
      return { topic: source.topic, source_url: source.url, ok: true, document };
    };
    return await Promise.race([work(), timeout]);
  } catch (e) {
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
    return { topic: source.topic, source_url: source.url, ok: false, error: text(e.message, 200) || 'Source request failed.' };
  } finally { clearTimeout(timer); }
}
export async function fetchBrief({ fetchImpl = fetch, now = () => new Date(), previous = null } = {}) {
  baseline(previous, now().toISOString()); // Reject corrupt or future local state before network work.
  const sources = await Promise.all(SOURCE_ENDPOINTS.map(source => readSource(source, fetchImpl)));
  return projectSources(sources, now().toISOString(), previous);
}
