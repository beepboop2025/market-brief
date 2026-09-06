import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_URL, EMBED_URL, TOPICS, SKILL_INSTALL, PYTHON_INSTALL, normalizeTopic, topicFromSearch, embedURL, embedSnippet, newsletterTemplate, safeHTTPS, cardValue, availabilityCounts } from '../docs/embed-model.js';

test('query configuration selects only a known topic; duplicate and unknown inputs fail to all', () => {
  for (const topic of Object.keys(TOPICS)) assert.equal(topicFromSearch(`?topic=${topic}`), topic);
  for (const search of ['', '?topic=constructor', '?topic=__proto__', '?topic=all&topic=money-market', '?topic=money-market&topic=money-market', '?topic=https://evil.test/', '?source=https://evil.test/&parent_origin=https://evil.test', '?topic=%22%3E%3Cscript%3E']) {
    assert.equal(topicFromSearch(search), 'all');
  }
  assert.equal(normalizeTopic({ toString: () => 'money-market' }), 'all');
});

test('embed snippets always use the fixed HTTPS host and escape the all-topics title', () => {
  assert.equal(embedURL(), EMBED_URL);
  assert.equal(embedURL('money-market'), `${EMBED_URL}?topic=money-market`);
  const hostile = '\"><script src="https://evil.test/payload.js"></script>';
  assert.equal(embedURL(hostile), EMBED_URL);
  assert.equal(embedSnippet(hostile), embedSnippet('all'));
  assert.match(embedSnippet(), /Funding, capital &amp; liquidity/);
  assert.match(embedSnippet(), /referrerpolicy="no-referrer"/);
  assert.match(embedSnippet(), /sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"/);
  assert.doesNotMatch(embedSnippet(), /parent_origin|allow-top-navigation|allow-forms/);
});

test('newsletter markup contains a usable link without scripts, frames or invented readings', () => {
  const template = newsletterTemplate();
  assert.ok(template.includes(`href="${APP_URL}"`));
  assert.match(template, /observation date, original source link/);
  assert.match(template, /missing or withheld evidence/);
  assert.doesNotMatch(template, /<script|<iframe|<img|\b\d+(?:\.\d+)?%|FRESH|NORMAL|EROSION/);
});

test('source links reject executable schemes, credentials, relative paths and control characters', () => {
  assert.equal(safeHTTPS('https://api.seiche.info/api/v2/world-markets?section=capital_markets'), 'https://api.seiche.info/api/v2/world-markets?section=capital_markets');
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'http://example.com', '//example.com', '/local', 'https://user:secret@example.com', 'https://example.com\n.evil.test', ' https://example.com', 'https://example.com/a b', null, {}, 'https://example.com/' + 'a'.repeat(2048)]) assert.equal(safeHTTPS(value), null);
});

test('missing and withheld values remain distinct from a reported zero in values and counts', () => {
  const cards = [
    { availability: 'reported', value: 0 },
    { availability: 'reported', value: 'PARTIAL' },
    { availability: 'withheld', value: 99 },
    { availability: 'reported', value: null },
    { availability: 'unavailable', value: 99 },
    { availability: 'unexpected', value: 99 },
  ];
  assert.deepEqual(cards.map(cardValue), ['0', 'PARTIAL', 'Value withheld', 'Not reported', 'Not reported', 'Not reported']);
  assert.deepEqual(availabilityCounts(cards), { reported: 2, withheld: 1, unavailable: 3 });
  assert.deepEqual(availabilityCounts([]), { reported: 0, withheld: 0, unavailable: 0 });
});

test('copyable install instructions keep the reviewed v0.1.0 release identity', () => {
  assert.equal(SKILL_INSTALL, 'npx skills add https://github.com/beepboop2025/market-brief/tree/v0.1.0 --skill market-brief');
  assert.equal(PYTHON_INSTALL, 'git clone --branch v0.1.0 --depth 1 https://github.com/beepboop2025/market-brief.git\ncd market-brief\npython3 skills/market-brief/scripts/market_brief.py --format markdown');
});
