import test from 'node:test';
import assert from 'node:assert/strict';
import {createActivity, parseActivity, recordActivity, activityReport} from '../docs/activity.js';
const first = Date.parse('2026-09-06T12:00:00Z');
const day = 86400000;

test('old activity logs remain readable and demo activity does not count as a research check', () => {
  const old = recordActivity(createActivity(first), 'checks', first);
  for (const key of ['demo_views', 'demo_copies', 'demo_link_copies']) delete old.days[0][key];
  const parsed = parseActivity(JSON.stringify(old), first);
  assert.equal(parsed.days[0].demo_views, 0);
  const selected = recordActivity(parsed, 'demo_views', first + 7 * day);
  const copied = recordActivity(selected, 'demo_copies', first + 7 * day);
  const report = activityReport(copied, first + 7 * day);
  assert.equal(report.totals.checks, 1); assert.equal(report.totals.demo_views, 1); assert.equal(report.totals.demo_copies, 1);
  assert.equal(report.distinct_check_days, 1); assert.equal(report.distinct_demo_days, 1);
  assert.equal(report.returned_in_second_week, null, 'a synthetic demo must not establish a returning research user');
});
test('malformed demo counts are rejected and selection names are never retained', () => {
  const log = recordActivity(createActivity(first), 'demo_views', first);
  log.days[0].scenario = 'DO_NOT_RETAIN';
  assert.equal(JSON.stringify(activityReport(log, first)).includes('DO_NOT_RETAIN'), false);
  for (const bad of [null, '1', -1, 0.1, 10001]) {
    const changed = structuredClone(log); changed.days[0].demo_views = bad;
    assert.equal(parseActivity(JSON.stringify(changed), first), null);
  }
});

test('consent creates an empty log and unknown attribution is discarded', () => {
  const log = createActivity(first, 'private@example.test');
  assert.deepEqual(log.days, []);
  assert.equal(log.entry_source, 'direct');
  assert.equal(activityReport(log, first).returned_in_second_week, null);
});
test('counts days and share intents separately without modifying previous records', () => {
  const log = createActivity(first, 'partner');
  const checked = recordActivity(log, 'checks', first);
  const again = recordActivity(checked, 'checks', first + 1);
  const shared = recordActivity(again, 'share_intents', first + day);
  assert.deepEqual(log.days, []);
  assert.equal(checked.days[0].checks, 1);
  const report = activityReport(shared, first + day);
  assert.equal(report.totals.checks, 2);
  assert.equal(report.totals.share_intents, 1);
  assert.equal(report.distinct_check_days, 1);
  assert.equal(report.returned_in_second_week, null);
  assert.equal(report.scope, 'voluntary_single_browser_unverified');
});
test('second-week measurement uses distinct UTC check days and incomplete windows stay unknown', () => {
  let log = recordActivity(createActivity(first), 'checks', first);
  log = recordActivity(log, 'checks', first + 6 * day);
  assert.equal(activityReport(log, first + 6 * day).returned_in_second_week, null);
  assert.equal(activityReport(log, first + 13 * day).returned_in_second_week, null);
  assert.equal(activityReport(log, first + 14 * day).returned_in_second_week, false);
  log = recordActivity(log, 'checks', first + 7 * day);
  assert.equal(activityReport(log, first + 7 * day).returned_in_second_week, true);
});
test('keeps only 35 days and exports an allowlisted projection', () => {
  let log = createActivity(first);
  for (let n = 0; n < 40; n++) log = recordActivity(log, 'checks', first + n * day);
  log.identity = 'private'; log.days[0].portfolio = 'private';
  const report = activityReport(log, first + 39 * day);
  assert.equal(report.days.length, 35);
  assert.equal(report.distinct_check_days, 35);
  assert.equal(JSON.stringify(report).includes('private'), false);
});
test('rejects corrupt, future, duplicate and unbounded stored activity', () => {
  const valid = recordActivity(createActivity(first), 'checks', first);
  for (const mutate of [
    x => {x.days[0].checks = -1;},
    x => {x.days[0].checks = 10001;},
    x => {x.days[0].checks = 1.2;},
    x => {x.days[0].day = '2026-09-07';},
    x => {x.days[0].day = '2026-02-31';},
    x => {x.days.push(x.days[0]);},
    x => {x.consent_day = '2027-01-01';},
  ]) {const value = structuredClone(valid); mutate(value); assert.equal(parseActivity(JSON.stringify(value), first), null);}
  assert.equal(parseActivity('x'.repeat(16001), first), null);
  assert.equal(parseActivity('{', first), null);
  assert.throws(() => recordActivity(valid, 'portfolio', first), /Unknown/);
});
