import {SCENARIOS, readDemoPack, scenarioFromSearch, scenarioURL, scenarioTitle, actionLabel, scenarioMarkdown} from './copilot-model.js';
import {DEMO_PACK} from './copilot-pack-ref.js';
import {ACTIVITY_KEY, createActivity, parseActivity, recordActivity, activityReport} from './activity.js';

const $ = id => document.getElementById(id);
const element = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
let pack = null, selected = null, revision = 0, loading = false, activity = null;
const format = value => value === null ? 'Not reported' : value.toLocaleString('en-US', {maximumSignificantDigits: 12});
const utc = value => value.replace('T', ' ').replace('+00:00', ' UTC');
function download(content, type, name) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const anchor = element('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readActivity() { return parseActivity(localStorage.getItem(ACTIVITY_KEY)); }
function describeActivity(message) {
  $('demo-consent').checked = Boolean(activity); $('demo-activity-export').disabled = !activity;
  const report = activity ? activityReport(activity) : null;
  $('demo-activity-status').textContent = message || (report
    ? `${report.totals.demo_views} scenario selections on ${report.distinct_demo_days} UTC days; ${report.totals.demo_copies} scenario reports copied or downloaded. These are unverified counts from this browser.`
    : 'Off. No activity is being recorded.');
}
function record(event) {
  if (!activity) return;
  try {
    const current = readActivity();
    if (!current) { activity = null; describeActivity(); return; }
    activity = recordActivity(current, event); localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity)); describeActivity();
  } catch { activity = null; describeActivity('Recording stopped because this browser could not save activity. Nothing was sent.'); }
}
try { activity = readActivity(); } catch { /* Optional storage must not block the demo. */ }
describeActivity();
window.addEventListener('storage', event => {
  if (event.key === ACTIVITY_KEY || event.key === null) {
    try { activity = readActivity(); } catch { activity = null; }
    describeActivity();
  }
});
$('demo-consent').addEventListener('change', () => {
  if ($('demo-consent').checked) {
    try { activity = readActivity() || createActivity(); localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity)); describeActivity(); }
    catch { activity = null; describeActivity('This browser cannot save an activity log. No activity is being recorded.'); }
  } else {
    activity = null;
    try { localStorage.removeItem(ACTIVITY_KEY); describeActivity('Activity log deleted. Recording is off.'); }
    catch {
      try { localStorage.setItem(ACTIVITY_KEY, '{}'); describeActivity('Activity log cleared. Recording is off.'); }
      catch { describeActivity('Recording stopped here, but the browser could not erase the saved log. Clear this site’s storage in browser settings.'); }
    }
  }
});
$('demo-activity-export').addEventListener('click', () => {
  try {
    activity = readActivity(); describeActivity(); if (!activity) return;
    const report = activityReport(activity); download(JSON.stringify(report, null, 2), 'application/json', `market-brief-activity-${report.as_of_day}.json`);
  } catch { activity = null; describeActivity('The activity report could not be read. Nothing was exported.'); }
});

for (const choice of SCENARIOS) {
  const button = element('button', choice.label); button.type = 'button'; button.dataset.scenario = choice.id;
  button.setAttribute('aria-pressed', 'false'); button.disabled = true;
  button.addEventListener('click', () => {
    show(choice.id); history.replaceState(null, '', `${location.pathname}?scenario=${choice.id}`); record('demo_views');
  });
  $('scenario-choices').append(button);
}
function definitionList(target, rows) {
  target.replaceChildren();
  for (const [label, value] of rows) target.append(element('dt', label), element('dd', typeof value === 'number' || value === null ? format(value) : value));
}
function chart(scenario) {
  const svg = $('scenario-chart'), ns = 'http://www.w3.org/2000/svg', bars = scenario.inputs.bars;
  const width = Math.max(300, Math.round(svg.getBoundingClientRect().width)), right = width - 8;
  svg.setAttribute('viewBox', `0 0 ${width} 220`);
  const node = (tag, attributes, text) => { const item = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attributes)) item.setAttribute(key, String(value)); if (text) item.textContent = text; return item; };
  svg.replaceChildren(node('title', {id: 'chart-title'}, 'Synthetic price path'), node('desc', {id: 'chart-description'}, `${bars.length} invented price bars for ${scenarioTitle(scenario.id)}. These are not market observations.`));
  const min = Math.min(...bars.map(bar => bar.close)), max = Math.max(...bars.map(bar => bar.close)), range = max - min || 1;
  const first = Date.parse(bars[0].at), duration = Date.parse(bars.at(-1).at) - first || 1;
  const points = bars.map(bar => `${66 + (Date.parse(bar.at) - first) / duration * (right - 66)},${175 - (bar.close - min) / range * 150}`).join(' ');
  svg.append(node('line', {x1: 66, x2: right, y1: 175, y2: 175}), node('line', {x1: 66, x2: right, y1: 25, y2: 25}),
    node('text', {x: 0, y: 29}, '$' + Math.round(max).toLocaleString('en-US')),
    node('text', {x: 0, y: 179}, '$' + Math.round(min).toLocaleString('en-US')),
    node('polyline', {points}), node('text', {x: 66, y: 210}, bars[0].at.slice(5, 16).replace('T', ' ') + ' UTC'),
    node('text', {x: right, y: 210, 'text-anchor': 'end'}, bars.at(-1).at.slice(5, 16).replace('T', ' ') + ' UTC'));
  $('chart-caption').textContent = `${bars.length} invented USD price bars in the year 2000. The strategy’s synthetic clock is ${utc(scenario.inputs.synthetic_now)}. The line is not a backtest or a return forecast.`;
}
function show(id) {
  revision += 1; selected = pack?.scenarios.find(scenario => scenario.id === id) ?? null;
  $('demo-action-status').textContent = ''; $('scenario-detail').hidden = !selected;
  document.querySelectorAll('[data-scenario]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scenario === selected?.id)));
  if (!selected) { $('demo-status').textContent = 'That scenario link is unavailable. Choose one of the six examples.'; return; }
  $('demo-status').textContent = 'Published synthetic examples. No current market data is requested and no orders can be submitted here.';
  $('scenario-title').textContent = scenarioTitle(id); $('scenario-question').textContent = SCENARIOS.find(choice => choice.id === id).question;
  $('scenario-action').textContent = actionLabel(selected.action); $('scenario-share-url').href = scenarioURL(id);
  chart(selected);
  $('scenario-facts').replaceChildren(...[
    ['Hypothetical proposal', selected.notional_usd === null ? 'No notional proposed' : `$${format(selected.notional_usd)} USD`], ['Synthetic funding state', selected.inputs.synthetic_regime],
    ['Reported bar age', selected.metrics.latest_bar_age_seconds === null ? 'Not reported' : `${format(selected.metrics.latest_bar_age_seconds)} seconds`],
  ].map(([label, value]) => { const p = element('p', label); p.append(element('strong', value)); return p; }));
  $('scenario-reasons').replaceChildren(...selected.explanation.map(item => element('li', item.detail)));
  $('scenario-gates').replaceChildren(...selected.gates.map(gate => {
    const article = element('article'), heading = element('h4', gate.product); heading.append(element('small', 'Not evaluated'));
    article.append(heading, element('p', gate.verify)); return article;
  }));
  $('scenario-countercase').textContent = selected.countercase;
  definitionList($('scenario-portfolio'), Object.entries(selected.inputs.portfolio).map(([key, value]) => [key.replaceAll('_', ' '), value]));
  definitionList($('scenario-metrics'), Object.entries(selected.metrics).map(([key, value]) => [key.replaceAll('_', ' '), value]));
  definitionList($('scenario-settings'), Object.entries(selected.inputs.strategy_config).map(([key, value]) => [key.replaceAll('_', ' '), value]));
}
async function load() {
  if (loading) return;
  loading = true; revision += 1; pack = selected = null; $('scenario-detail').hidden = true; $('demo-retry').hidden = true;
  document.querySelectorAll('[data-scenario]').forEach(button => { button.disabled = true; button.setAttribute('aria-pressed', 'false'); });
  $('demo-status').textContent = 'Loading the published examples…';
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(DEMO_PACK.path, {signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer'});
    if (!response.ok) throw new Error('Examples unavailable.');
    const verified = await readDemoPack(await response.arrayBuffer(), DEMO_PACK.sha256);
    if (verified.provenance.source_ref !== DEMO_PACK.source_ref) throw new Error('Source revision mismatch.');
    pack = verified;
    document.querySelectorAll('[data-scenario]').forEach(button => { button.disabled = false; button.append(element('span', actionLabel(pack.scenarios.find(scenario => scenario.id === button.dataset.scenario).action))); });
    $('demo-source-link').href = pack.provenance.source_url;
    definitionList($('demo-provenance'), [['Source commit', pack.provenance.source_ref], ['Strategy SHA-256', pack.provenance.strategy_sha256], ['Synthetic dataset SHA-256', pack.provenance.dataset_sha256], ['Pack file SHA-256', DEMO_PACK.sha256]]);
    $('demo-source-command').textContent = `From that source checkout: PYTHONPATH=integrations/trading-copilot/src python3 -S -B -m liquilens_trading_copilot.demo --all --source-ref ${pack.provenance.source_ref}`;
    show(scenarioFromSearch(location.search));
  } catch {
    $('demo-status').textContent = 'The published examples could not be verified. Retry the examples, or use the source-checkout demo below.';
    $('demo-retry').hidden = false;
  } finally { loading = false; clearTimeout(timeout); }
}
$('demo-retry').addEventListener('click', () => { void load(); });
window.addEventListener('popstate', () => { if (pack) show(scenarioFromSearch(location.search)); });
window.addEventListener('resize', () => { if (selected) chart(selected); });
async function copy(text, success, event) {
  const current = ++revision;
  try { await navigator.clipboard.writeText(text); if (current === revision) { $('demo-action-status').textContent = success; record(event); } }
  catch { if (current === revision) $('demo-action-status').textContent = 'Clipboard unavailable. Download the scenario, or use the visible scenario link.'; }
}
$('demo-copy').addEventListener('click', () => { if (pack && selected) void copy(scenarioMarkdown(pack, selected), 'Scenario copied with its synthetic inputs, source revision and unevaluated checks.', 'demo_copies'); });
$('demo-link').addEventListener('click', () => { if (selected) void copy(scenarioURL(selected.id), 'Scenario link copied. It opens the current published example.', 'demo_link_copies'); });
$('demo-download').addEventListener('click', () => {
  if (!pack || !selected) return;
  revision += 1;
  download(scenarioMarkdown(pack, selected), 'text/markdown;charset=utf-8', `copilot-synthetic-${selected.id}.md`);
  $('demo-action-status').textContent = 'Synthetic scenario prepared for download with its source and limits.'; record('demo_copies');
});
void load();
