import { fetchBrief, SOURCE_ENDPOINTS } from './data.js';
import { orderCards } from './priorities.js';
import { TOPICS, topicFromSearch, safeHTTPS, cardValue, availabilityCounts } from './embed-model.js';

const $ = id => document.getElementById(id);
const topic = topicFromSearch(location.search);
let busy = false;
let lastRequest = -Infinity;

function text(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}

function link(label, href) {
  const safe = safeHTTPS(href);
  if (!safe) return null;
  const node = text('a', label);
  node.href = safe;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

function render(brief) {
  const cards = orderCards(brief.cards).filter(card => topic === 'all' || card.topic === topic);
  const counts = availabilityCounts(cards);
  $('cards').replaceChildren();
  for (const card of cards) {
    const article = document.createElement('article');
    article.className = `data-card ${['reported', 'withheld', 'unavailable'].includes(card.availability) ? card.availability : 'unavailable'}`;
    const top = text('div', '', 'card-top');
    top.append(text('span', TOPICS[card.topic] || 'Context'), text('span', (card.evidence_class || 'not evaluated').replaceAll('_', ' ')));
    const shownValue = cardValue(card);
    const value = text('p', shownValue, `value${shownValue.length > 18 ? ' long' : ''}`);
    if (card.unit && card.availability === 'reported' && card.value !== null && card.value !== undefined) value.append(text('small', card.unit));
    article.append(top, text('h3', card.label), value,
      text('p', `Source reports: ${card.state || 'Not reported'}`, 'card-state'),
      text('p', `Observation: ${card.observed_at || 'Not reported'}`, 'card-clock'),
      text('p', `Source generated: ${card.source_generated_at || 'Not reported'}`, 'card-clock'));
    const sources = text('div', '', 'card-links');
    for (const source of [link(`${card.product} source ↗`, card.source_url), link('Original publisher ↗', card.original_url)]) if (source) sources.append(source);
    article.append(sources);
    $('cards').append(article);
  }
  if (!cards.length) $('cards').append(text('p', 'No observations were returned for this topic.', 'data-card'));
  $('counts').textContent = `${counts.reported} reported · ${counts.withheld} withheld · ${counts.unavailable} unavailable`;
  $('retrieved').textContent = `Retrieved: ${brief.fetched_at}. Observation dates below can be older.`;
  $('source-errors').replaceChildren();
  for (const source of SOURCE_ENDPOINTS) {
    const error = brief.errors.find(item => item.topic === source.topic);
    const row = text('p', `${TOPICS[source.topic]}: ${error ? `unavailable — ${error.message}` : 'source responded; check individual dates and states'}. `);
    const sourceLink = link('Source ↗', source.url);
    if (sourceLink) row.append(sourceLink);
    $('source-errors').append(row);
  }
  $('limitations').replaceChildren(...brief.limitations.map(item => text('li', item)));
  $('evidence').hidden = false;
  document.querySelector('.widget').classList.add('has-brief');
  $('source-notes').open = brief.errors.length > 0;
  const received = SOURCE_ENDPOINTS.length - brief.errors.length;
  status(brief.transport_status === 'unavailable'
    ? 'The public sources could not be read. No current values are available; try again later.'
    : `${received} of ${SOURCE_ENDPOINTS.length} sources responded. ${TOPICS[topic]} shown below. Coverage and freshness still depend on each source.`, brief.errors.length > 0);
}

$('topic-label').textContent = TOPICS[topic];
$('build').addEventListener('click', async () => {
  if (busy) return;
  if (performance.now() - lastRequest < 60000) {
    status('Please allow a minute between checks. Sources follow their own publication cadence.');
    return;
  }
  busy = true;
  lastRequest = performance.now();
  $('build').disabled = true;
  $('build').textContent = 'Building brief…';
  $('evidence').hidden = true;
  $('cards').replaceChildren();
  $('evidence').setAttribute('aria-busy', 'true');
  status('Reading the three public sources. Their observation dates will stay visible.');
  try {
    render(await fetchBrief());
  } catch {
    $('evidence').hidden = true;
    status('The brief could not be built. No previous values are being presented as current. Please try again later.', true);
  } finally {
    busy = false;
    $('build').disabled = false;
    $('build').textContent = 'Refresh brief ↗';
    $('evidence').removeAttribute('aria-busy');
  }
});
