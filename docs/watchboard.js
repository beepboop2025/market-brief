import { SOURCE_ENDPOINTS } from './data.js';

export const WATCH_KEY = 'market-brief.watch.v1';
export const MAX_WATCHED = 12;
const MAX_SETTINGS_LENGTH = 4096, MAX_CARDS = 100;
const TOPICS = new Set(SOURCE_ENDPOINTS.map(source => source.topic));
const VIEWS = new Set(['all', 'watched', 'changes', 'gaps']);
const CHANGES = new Set(['value_changed', 'state_changed']);

function validId(id) {
  if (typeof id !== 'string' || id.length > 300) return false;
  const [topic, ...parts] = id.split(':');
  return TOPICS.has(topic) && parts.length >= 1 && parts.length <= 2
    && parts.every(part => /^[A-Za-z0-9_.-]{1,120}$/.test(part));
}

function watchIds(ids) {
  if (!Array.isArray(ids) || Object.getPrototypeOf(ids) !== Array.prototype) throw new TypeError('Watch selections must be an array of observation IDs.');
  if (ids.length > MAX_WATCHED) throw new RangeError(`Watch at most ${MAX_WATCHED} observations.`);
  const fields = Object.getOwnPropertyDescriptors(ids);
  if (Reflect.ownKeys(fields).length !== ids.length + 1) throw new TypeError('Watch selections must contain only observation IDs.');
  const result = [], seen = new Set();
  for (let i = 0; i < ids.length; i++) {
    const field = fields[i];
    if (!field || !field.enumerable || !Object.hasOwn(field, 'value') || !validId(field.value) || seen.has(field.value)) {
      throw new TypeError('Watch selections must contain unique, valid observation IDs.');
    }
    seen.add(field.value); result.push(field.value);
  }
  return result;
}

/** Strict, bounded local preferences. Values, timestamps and freeform notes are never accepted. */
export function parseWatch(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_SETTINGS_LENGTH) return null;
  try {
    const settings = JSON.parse(raw);
    if (!settings || Array.isArray(settings) || typeof settings !== 'object'
      || Object.keys(settings).length !== 2 || settings.schema !== WATCH_KEY || !Object.hasOwn(settings, 'ids')) return null;
    return watchIds(settings.ids);
  } catch { return null; }
}

export function serializeWatch(ids) {
  return JSON.stringify({ schema: WATCH_KEY, ids: watchIds(ids) });
}

/** Removing an existing selection works even at capacity. Inputs are never mutated. */
export function toggleWatch(ids, id) {
  const next = watchIds(ids);
  if (!validId(id)) throw new TypeError('Select a valid observation ID.');
  const index = next.indexOf(id);
  if (index !== -1) next.splice(index, 1);
  else {
    if (next.length === MAX_WATCHED) throw new RangeError(`Watch at most ${MAX_WATCHED} observations.`);
    next.push(id);
  }
  return next;
}

// UI settings are optional. Ignore malformed fields without executing settings accessors.
function option(settings, key, fallback) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return fallback;
  const field = Object.getOwnPropertyDescriptor(settings, key);
  return field && Object.hasOwn(field, 'value') ? field.value : fallback;
}
function watchedOf(settings) {
  try { return watchIds(option(settings, 'watched', [])); }
  catch { return []; }
}
function currentCards(cards) {
  if (!Array.isArray(cards) || cards.length > MAX_CARDS
    || Array.from(cards).some(card => !card || typeof card !== 'object' || Array.isArray(card))) {
    throw new TypeError('Review at most 100 projected observation cards.');
  }
  return cards;
}
function gap(card) {
  return card.availability !== 'reported' || card.changeKind === 'not_comparable'
    || typeof card.state === 'string' && card.state.trim().toUpperCase() === 'STALE'
    || typeof card.observed_at !== 'string' || !card.observed_at.trim();
}

/** Preserve source order and records; coverage without an observation clock remains a gap. */
export function selectCards(cards, settings = {}) {
  const requestedTopic = option(settings, 'topic', 'all'), requestedView = option(settings, 'view', 'all');
  const topic = TOPICS.has(requestedTopic) ? requestedTopic : 'all';
  const view = VIEWS.has(requestedView) ? requestedView : 'all';
  const watched = new Set(watchedOf(settings));
  return currentCards(cards).filter(card => (topic === 'all' || card.topic === topic)
    && (view === 'all' || view === 'watched' && watched.has(card.id)
      || view === 'changes' && CHANGES.has(card.changeKind) || view === 'gaps' && gap(card)));
}

/** Watched counts current source records; NOT_RETURNED also appears in missingWatched. */
export function summarizeReview(cards, settings = {}) {
  const current = currentCards(cards), watched = watchedOf(settings);
  const present = new Set(current.filter(card => card.state !== 'NOT_RETURNED').map(card => card.id));
  const missingWatched = watched.filter(id => !present.has(id));
  return {
    total: current.length,
    reported: current.filter(card => card.availability === 'reported').length,
    changed: current.filter(card => CHANGES.has(card.changeKind)).length,
    gaps: current.filter(gap).length,
    watched: watched.length - missingWatched.length,
    missingWatched,
  };
}
