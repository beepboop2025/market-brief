// Shared presentation helpers. Query parameters can select a topic, never a source.
export const APP_URL = 'https://beepboop2025.github.io/market-brief/';
export const EMBED_URL = `${APP_URL}embed.html`;
export const TOPICS = Object.freeze({
  all: 'Funding, capital & liquidity',
  'money-market': 'Funding',
  'capital-market': 'Capital',
  'market-liquidity': 'Liquidity',
});
export const SKILL_INSTALL = 'npx skills add https://github.com/beepboop2025/market-brief/tree/v0.1.0 --skill market-brief';
export const PYTHON_INSTALL = 'git clone --branch v0.1.0 --depth 1 https://github.com/beepboop2025/market-brief.git\ncd market-brief\npython3 skills/market-brief/scripts/market_brief.py --format markdown';

export function normalizeTopic(value) {
  return typeof value === 'string' && Object.hasOwn(TOPICS, value) ? value : 'all';
}

export function topicFromSearch(search = '') {
  const values = new URLSearchParams(search).getAll('topic');
  return values.length === 1 ? normalizeTopic(values[0]) : 'all';
}

export function embedURL(topic = 'all') {
  const url = new URL(EMBED_URL);
  const selected = normalizeTopic(topic);
  if (selected !== 'all') url.searchParams.set('topic', selected);
  return url.href;
}

export function embedSnippet(topic = 'all') {
  return `<iframe\n  src="${embedURL(topic)}"\n  title="Market Brief: ${TOPICS[normalizeTopic(topic)].replaceAll('&', '&amp;')}"\n  width="100%" height="700"\n  style="border:0;display:block;max-width:100%"\n  loading="lazy" referrerpolicy="no-referrer"\n  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"\n></iframe>`;
}

export function newsletterTemplate() {
  return `<p>Before your next market check, review selected funding benchmarks, capital-market context and liquidity coverage. Market Brief keeps published dates, source links and missing evidence visible.</p>\n<p><a href="${APP_URL}">Build a free Market Brief</a></p>\n<!-- Optional editor-written excerpt: include the observation date, original source link, and any missing or withheld evidence. Verify upstream reuse rights before publishing values. -->`;
}

export function safeHTTPS(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function cardValue(card) {
  if (card.availability === 'withheld') return 'Value withheld';
  if (card.availability !== 'reported' || card.value === null || card.value === undefined) return 'Not reported';
  return typeof card.value === 'number' ? card.value.toLocaleString('en-US', { maximumFractionDigits: 6 }) : String(card.value);
}

export function availabilityCounts(cards) {
  const counts = { reported: 0, withheld: 0, unavailable: 0 };
  for (const card of cards) {
    const state = card.availability === 'reported' && card.value !== null && card.value !== undefined
      ? 'reported' : card.availability === 'withheld' ? 'withheld' : 'unavailable';
    counts[state] += 1;
  }
  return counts;
}
