import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readDemoPack, validateDemoPack, scenarioURL, scenarioFromSearch, scenarioMarkdown, SCENARIOS} from '../docs/copilot-model.js';
import {DEMO_PACK} from '../docs/copilot-pack-ref.js';
const file = await fs.readFile(new URL('../docs/copilot-pack.json', import.meta.url));
const bytes = value => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
const raw = JSON.parse(file), clone = () => structuredClone(raw);

test('the committed pack is pinned to actual bytes and contains all six original strategy outputs', async () => {
  const projected = await readDemoPack(bytes(file), DEMO_PACK.sha256);
  assert.equal(projected.provenance.source_ref, DEMO_PACK.source_ref);
  assert.deepEqual(projected.scenarios.map(s => s.id), SCENARIOS.map(s => s.id));
  for (const scenario of projected.scenarios) {
    const original = raw.scenarios.find(s => s.scenario === scenario.id);
    assert.equal(scenario.action, original.strategy_decision.action);
    assert.equal(scenario.notional_usd, original.strategy_decision.notional_usd);
    assert.deepEqual(scenario.inputs.bars, original.inputs.bars);
    assert.deepEqual(scenario.inputs.portfolio, original.inputs.portfolio);
    assert.deepEqual(scenario.explanation, original.explanation);
  }
});
test('byte changes and incomplete or overlarge files are rejected before display', async () => {
  const changed = Buffer.from(file); changed[changed.length - 1] = 32;
  await assert.rejects(readDemoPack(bytes(changed), DEMO_PACK.sha256));
  await assert.rejects(readDemoPack(bytes(file.subarray(0, 100)), DEMO_PACK.sha256));
  await assert.rejects(readDemoPack(new ArrayBuffer(262145), DEMO_PACK.sha256));
  await assert.rejects(readDemoPack(bytes(file), 'wrong'));
});
test('execution permission, evaluated evidence or unverified source cannot be displayed as this demo', () => {
  const mutations = [
    p => {p.synthetic = false;}, p => {p.provenance.source_verified = false;},
    p => {p.provenance.source_ref = 'main';}, p => {p.provenance.source_url = 'https://other.example/strategy.py';},
    p => {p.policy_limits.execution_policy_evaluated = true;},
    p => {p.scenarios[0].required_gates[0].status = 'pass';}, p => {p.scenarios[0].required_gates.pop();},
  ];
  for (const name of ['order_authorized', 'order_submitted', 'receipt_issued', 'real_money_eligible']) {
    mutations.push(p => {p.execution[name] = true;}, p => {p.scenarios[0].execution[name] = true;});
  }
  for (const mutate of mutations) { const p = clone(); mutate(p); assert.throws(() => validateDemoPack(p)); }
});
test('missing, duplicated or inconsistent declared scenarios fail the complete-pack contract', () => {
  for (const mutate of [p => p.scenarios.pop(), p => {p.scenarios[1] = p.scenarios[0];}, p => {p.scenario_count = 5;}, p => p.scenario_order.reverse()]) {
    const p = clone(); mutate(p); assert.throws(() => validateDemoPack(p));
  }
});
test('synthetic clocks require real UTC calendar times and strictly increasing bars', () => {
  for (const value of ['2026-01-01T00:00:00Z', '2000-02-30T00:00:00Z', '2000-01-01T00:00:00+01:00', 'yesterday']) {
    const p = clone(); p.scenarios[0].inputs.synthetic_now = value; assert.throws(() => validateDemoPack(p));
  }
  const p = clone(); p.scenarios[0].inputs.bars[1].at = p.scenarios[0].inputs.bars[0].at;
  assert.throws(() => validateDemoPack(p));
});
test('HOLD keeps no proposed notional and absent metrics remain missing', () => {
  const pack = validateDemoPack(raw), hold = pack.scenarios.find(s => s.id === 'loss-halt');
  assert.equal(hold.notional_usd, null); assert.equal(hold.metrics.latest_bar_age_seconds, null);
  const text = scenarioMarkdown(pack, hold);
  assert.match(text, /No notional proposed/); assert.doesNotMatch(text, /Hypothetical notional: USD (?:0|null)/);
  assert.match(text, /"latest_bar_age_seconds": null/);
  const p = clone(); p.scenarios[0].strategy_decision.notional_usd = '1000'; assert.throws(() => validateDemoPack(p));
});
test('exports preserve source and unevaluated checks while excluding unrelated data', () => {
  const p = clone(); p.account = 'DO_NOT_EXPORT'; p.scenarios[0].private_note = 'DO_NOT_EXPORT';
  p.scenarios[0].inputs.strategy_config.private_account_number = 123456;
  p.scenarios[0].inputs.portfolio.private_account_number = 123456;
  p.scenarios[0].strategy_decision.metrics.private_token = 'DO_NOT_EXPORT';
  const before = JSON.stringify(p), pack = validateDemoPack(p), text = scenarioMarkdown(pack, pack.scenarios[0]);
  assert.equal(JSON.stringify(p), before);
  assert.doesNotMatch(text, /DO_NOT_EXPORT|private_account_number|private_token/);
  assert.match(text, /SYNTHETIC EDUCATIONAL DEMO/); assert.match(text, /No order is authorized or submitted/);
  assert.match(text, /2000-01-02T12:00:00\+00:00/); assert.ok(text.includes(pack.provenance.source_ref));
  assert.ok(text.includes(pack.provenance.strategy_sha256)); assert.match(text, /"order_authorized": false/);
  for (const name of ['Seiche', 'LiquiLens', 'Undertow', 'Operator and broker']) assert.ok(text.includes(name));
  assert.throws(() => scenarioMarkdown(pack, structuredClone(pack.scenarios[0])), /verified/);
});
test('scenario links accept one known ID and never include values or arbitrary navigation', () => {
  assert.equal(scenarioFromSearch(''), 'candidate'); assert.equal(scenarioFromSearch('?scenario=loss-halt'), 'loss-halt');
  assert.equal(scenarioFromSearch('?scenario=wrong'), null); assert.equal(scenarioFromSearch('?scenario=candidate&scenario=candidate'), null);
  const link = scenarioURL('loss-halt'); assert.equal(link, 'https://beepboop2025.github.io/market-brief/copilot.html?scenario=loss-halt');
  assert.throws(() => scenarioURL('candidate&token=private'));
  assert.equal(scenarioFromSearch('?scenario=candidate&token=private'), 'candidate');
});
