// Voluntary device-local pilot counts. No identity, network or market data.
export const ACTIVITY_KEY = 'market-brief.activity.v1';
const SCHEMA = 'market-brief.activity.v1';
const DAY = 86_400_000;
const DEMO_EVENTS = Object.freeze(['demo_views', 'demo_copies', 'demo_link_copies']);
const EVENTS = Object.freeze(['checks', 'copies', 'share_intents', 'cards_saved', 'source_opens', ...DEMO_EVENTS]);
const SOURCES = new Set(['direct', 'share', 'telegram', 'partner', 'financial-evidence']);
const utcDay = now => new Date(now).toISOString().slice(0, 10);
const validDay = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
  && Number.isFinite(Date.parse(day)) && utcDay(Date.parse(day)) === day;
const emptyDay = day => Object.fromEntries([['day', day], ...EVENTS.map(event => [event, 0])]);

export function createActivity(now = Date.now(), source = 'direct') {
  return {schema: SCHEMA, consent_day: utcDay(now), entry_source: SOURCES.has(source) ? source : 'direct', days: []};
}

export function parseActivity(raw, now = Date.now()) {
  if (typeof raw !== 'string' || raw.length > 16000) return null;
  try {
    const value = JSON.parse(raw), today = utcDay(now);
    if (!value || value.schema !== SCHEMA || !validDay(value.consent_day) || value.consent_day > today
      || !SOURCES.has(value.entry_source) || !Array.isArray(value.days) || value.days.length > 35) return null;
    const seen = new Set(), days = [];
    for (const record of value.days) {
      if (!record || !validDay(record.day) || record.day > today || record.day < value.consent_day || seen.has(record.day)) return null;
      seen.add(record.day);
      const clean = emptyDay(record.day);
      for (const event of EVENTS) {
        if (DEMO_EVENTS.includes(event) && !Object.hasOwn(record, event)) continue;
        if (!Number.isSafeInteger(record[event]) || record[event] < 0 || record[event] > 10000) return null;
        clean[event] = record[event];
      }
      if (Date.parse(today) - Date.parse(record.day) < 35 * DAY) days.push(clean);
    }
    return {schema: SCHEMA, consent_day: value.consent_day, entry_source: value.entry_source, days: days.sort((a, b) => a.day.localeCompare(b.day))};
  } catch { return null; }
}

export function recordActivity(activity, event, now = Date.now()) {
  if (!EVENTS.includes(event)) throw new TypeError('Unknown pilot event.');
  const result = parseActivity(JSON.stringify(activity), now);
  if (!result) throw new TypeError('Invalid pilot activity.');
  const today = utcDay(now);
  let day = result.days.find(row => row.day === today);
  if (!day) { day = emptyDay(today); result.days.push(day); }
  day[event] = Math.min(10000, day[event] + 1);
  return result;
}

export function activityReport(activity, now = Date.now()) {
  const value = parseActivity(JSON.stringify(activity), now);
  if (!value) throw new TypeError('Invalid pilot activity.');
  const totals = Object.fromEntries(EVENTS.map(event => [event, value.days.reduce((n, day) => n + day[event], 0)]));
  const useDays = value.days.filter(day => day.checks > 0).map(day => day.day);
  const first = useDays[0], elapsed = first ? (Date.parse(utcDay(now)) - Date.parse(first)) / DAY : 0;
  const weekTwoReturn = first && useDays.some(day => {
    const offset = (Date.parse(day) - Date.parse(first)) / DAY;
    return offset >= 7 && offset <= 13;
  });
  return {
    schema: 'market-brief.pilot-report.v1', scope: 'voluntary_single_browser_unverified',
    as_of_day: utcDay(now), retained_days: 35, entry_source: value.entry_source,
    totals, distinct_check_days: useDays.length,
    distinct_demo_days: value.days.filter(day => day.demo_views > 0).length,
    returned_in_second_week: weekTwoReturn ? true : elapsed >= 14 ? false : null,
    days: value.days,
    notes: [
      'Counts begin only after local consent; they are not verified people or aggregate product usage.',
      'A completed check may contain partial, old or unavailable evidence; usefulness is not inferred.',
      'Share intents do not prove a message was sent, delivered or opened.',
      'Only the most recent 35 UTC days are retained; return measurement is relative to the first retained check.',
      'No identifier, market values, comparison history, full URLs or exact event times are included.',
      'Demo selections, copies and link copies concern synthetic examples; they are separate from research checks and do not establish trading use.',
    ],
  };
}
