import { SOURCE_ENDPOINTS } from './data.js';
import { orderCards } from './priorities.js';

const CANONICAL_URL = 'https://beepboop2025.github.io/market-brief/';
const TOPICS = ['all', ...SOURCE_ENDPOINTS.map(source => source.topic)];
const REFS = ['share', 'telegram', 'partner', 'financial-evidence'];
const TOPIC_LABELS = { all: 'Funding and liquidity', 'money-market': 'Funding', 'capital-market': 'Capital markets', 'market-liquidity': 'Liquidity' };
const AVAILABILITIES = ['reported', 'unavailable', 'withheld'];
const MAX_CARDS = 100;
const NOTE = 'Partial research coverage. Source dates and gaps apply; freshness is not independently verified. Not trading advice.';

const topicOf = value => TOPICS.includes(value) ? value : 'all';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function text(value, limit) {
  if (typeof value !== 'string') return '';
  const clean = value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}
function clock(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return null;
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(Date.parse(value)) && Number.isFinite(+day) && day.toISOString().slice(0, 10) === value.slice(0, 10) ? value : null;
}
function originalUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** URL inputs select a view only. Values, snapshots and unknown referral strings are ignored. */
export function parseShareContext(search) {
  if (typeof search !== 'string' || search.length > 2048) return { topic: 'all', ref: null };
  const params = new URLSearchParams(search);
  const topic = params.getAll('topic'), ref = params.getAll('ref');
  return {
    topic: topic.length === 1 ? topicOf(topic[0]) : 'all',
    ref: ref.length === 1 && REFS.includes(ref[0]) ? ref[0] : null,
  };
}

export function buildBriefUrl(topic = 'all', ref = 'share') {
  const url = new URL(CANONICAL_URL);
  url.searchParams.set('topic', topicOf(topic));
  url.searchParams.set('ref', REFS.includes(ref) ? ref : 'share');
  return url.href;
}

function publicObservation(card) {
  const source = SOURCE_ENDPOINTS.find(item => item.topic === card?.topic);
  if (!object(card) || !source || card.source_url !== source.url || card.product !== source.product
    || typeof card.id !== 'string' || !card.id.startsWith(`${source.topic}:`) || card.id.length > 300
    || text(card.id, 300) !== card.id
    || !text(card.label, 160) || !AVAILABILITIES.includes(card.availability)) {
    throw new TypeError('A share observation must use a known projected source and identity.');
  }
  let availability = card.availability;
  const value = typeof card.value === 'number' && Number.isFinite(card.value)
    ? card.value : typeof card.value === 'string' ? text(card.value, 240) || null : null;
  if (availability === 'reported' && value === null) availability = 'unavailable';
  // Construct each field explicitly: never copy saved comparison or arbitrary payload fields.
  return {
    id: text(card.id, 300), label: text(card.label, 160), topic: source.topic, product: source.product,
    value: availability === 'reported' ? value : null,
    unit: text(card.unit, 80) || 'not supplied', availability,
    state: text(card.state, 128) || 'NOT_EVALUATED',
    observed_at: clock(card.observed_at), source_generated_at: clock(card.source_generated_at),
    source_url: source.url, original_url: originalUrl(card.original_url),
  };
}

/** A small public-data excerpt, not a portable saved baseline or a historical permalink. */
export function createSharePreview(current, topic = 'all') {
  if (!object(current) || current.schema !== 'market-brief.browser.v1' || !clock(current.fetched_at)
    || !current.fetched_at.includes('T') || !Array.isArray(current.cards) || current.cards.length > MAX_CARDS) {
    throw new TypeError('Build a valid brief before creating a share preview.');
  }
  // NOT_RETURNED is a local comparison tombstone, not a current source observation.
  const currentCards = current.cards.filter(card => card?.state !== 'NOT_RETURNED');
  const selectedTopic = topicOf(topic), publicCards = currentCards.map(publicObservation);
  if (new Set(publicCards.map(card => card.id)).size !== publicCards.length) throw new TypeError('Share observations must have unique identities.');
  const byId = new Map(publicCards.map(card => [card.id, card]));
  const scoped = orderCards(currentCards).map(card => byId.get(card.id))
    .filter(card => selectedTopic === 'all' || card.topic === selectedTopic);
  // Lead with available readings without changing the full scope's gap counts.
  const reported = scoped.filter(card => card.availability === 'reported');
  const observations = selectedTopic === 'all'
    ? SOURCE_ENDPOINTS.map(source => reported.find(card => card.topic === source.topic)
      || scoped.find(card => card.topic === source.topic)).filter(Boolean)
    : [...reported, ...scoped.filter(card => card.availability !== 'reported')].slice(0, 3);
  return {
    title: `Market Brief · ${TOPIC_LABELS[selectedTopic]}`,
    generatedAt: current.fetched_at, topic: selectedTopic, observations,
    total: scoped.length,
    reported: reported.length,
    unavailable: scoped.filter(card => card.availability === 'unavailable').length,
    withheld: scoped.filter(card => card.availability === 'withheld').length,
    note: NOTE, url: buildBriefUrl(selectedTopic),
  };
}

function shareLines(preview, ref) {
  if (!object(preview) || !clock(preview.generatedAt) || !Array.isArray(preview.observations)
    || preview.observations.length > 3 || !['total', 'reported', 'unavailable', 'withheld'].every(key => Number.isSafeInteger(preview[key]) && preview[key] >= 0 && preview[key] <= MAX_CARDS)
    || preview.reported + preview.unavailable + preview.withheld !== preview.total || preview.observations.length > preview.total) {
    throw new TypeError('Invalid share preview.');
  }
  const topic = topicOf(preview.topic), cards = preview.observations.map(publicObservation);
  if (new Set(cards.map(card => card.id)).size !== cards.length
    || topic !== 'all' && cards.some(card => card.topic !== topic)
    || AVAILABILITIES.some(availability => cards.filter(card => card.availability === availability).length > preview[availability])) {
    throw new TypeError('Invalid share preview observation scope.');
  }
  const lines = [`Market Brief · ${TOPIC_LABELS[topic]}`, `Retrieved: ${preview.generatedAt}`, ''];
  for (const card of cards) {
    const value = card.availability === 'reported'
      ? `${card.value}${card.unit === 'not supplied' ? '' : ` ${card.unit}`}`
      : card.availability === 'withheld' ? 'Value withheld' : 'Not reported';
    lines.push(`${card.label}: ${value}`, `Source state: ${card.state} · observed: ${card.observed_at || 'not reported'}`,
      `Source generated: ${card.source_generated_at || 'not reported'}`, `Source: ${card.source_url}`);
    if (card.original_url) lines.push(`Original publisher: ${card.original_url}`);
    lines.push('');
  }
  lines.push(`Selected ${cards.length} of ${preview.total} observations in this view: ${preview.reported} reported, ${preview.unavailable} unavailable, ${preview.withheld} withheld.`,
    NOTE, `Check latest: ${buildBriefUrl(topic, ref)}`,
    'The link opens the latest view; it does not reproduce this dated excerpt.');
  return lines;
}

export function formatShareText(preview) {
  return shareLines(preview, 'share').join('\n');
}

/** Opens Telegram's editable sharing composer; it does not confirm message delivery. */
export function telegramShareUrl(preview) {
  const url = new URL('https://t.me/share/url');
  url.searchParams.set('url', buildBriefUrl(preview?.topic, 'telegram'));
  url.searchParams.set('text', shareLines(preview, 'telegram').join('\n'));
  return url.href;
}
