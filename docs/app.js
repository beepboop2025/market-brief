import { fetchBrief } from './data.js';
import { orderCards } from './priorities.js';
import { parseShareContext, createSharePreview, formatShareText, telegramShareUrl } from './sharing.js';
import { createShareCard } from './share-card.js';
import { ACTIVITY_KEY, createActivity, parseActivity, recordActivity, activityReport } from './activity.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'market-brief.browser.v1';
const INSTALL = 'npx skills add https://github.com/beepboop2025/market-brief/tree/v0.1.0 --skill market-brief';
let current = null;
let baseline = null;
const arrival = parseShareContext(location.search);
let topic = arrival.topic;
let activity = null;
let sharePreview = null;
const copyStates = new WeakMap();
let busy = false;
let lastRequest = 0;
const topicNames = {'money-market':'Funding','capital-market':'Capital','market-liquidity':'Liquidity'};

function describeActivity(message = '') {
  $('pilot-consent').checked = Boolean(activity);
  $('pilot-export').disabled = !activity;
  const report = activity ? activityReport(activity) : null;
  $('pilot-summary').textContent = message || (report
    ? `${report.totals.checks} completed checks on ${report.distinct_check_days} UTC day${report.distinct_check_days === 1 ? '' : 's'}. Saved only on this device; nothing has been sent.`
    : 'Off. No activity is being recorded.');
}
function record(event) {
  if (!activity) return;
  try {
    // Re-read consent so another tab's opt-out cannot be overwritten.
    const stored = parseActivity(localStorage.getItem(ACTIVITY_KEY));
    if (!stored) { activity = null; describeActivity(); return; }
    activity = recordActivity(stored, event);
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity));
    describeActivity();
  } catch { activity = null; describeActivity('Recording stopped because this browser could not save activity. No data was sent.'); }
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function readActivity() {
  const raw = localStorage.getItem(ACTIVITY_KEY), parsed = parseActivity(raw);
  if (parsed && JSON.stringify(parsed) !== raw) localStorage.setItem(ACTIVITY_KEY, JSON.stringify(parsed));
  else if (raw && !parsed) localStorage.removeItem(ACTIVITY_KEY);
  return parsed;
}
try { activity = readActivity(); } catch { activity = null; }
describeActivity();
window.addEventListener('storage', event => {
  if (event.key === ACTIVITY_KEY || event.key === null) {
    try { activity = readActivity(); } catch { activity = null; }
    describeActivity();
  }
});
document.querySelectorAll('[data-topic]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.topic === topic)));
if (arrival.ref || topic !== 'all') {
  $('shared-arrival').hidden = false;
  $('shared-arrival').textContent = `${topicNames[topic] || 'Funding and liquidity'} context, ready to check. Build a brief to request the latest source responses. This link contains no saved market values.`;
}

function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
}
function date(value) {
  if (!value) return 'Not reported';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().replace('.000Z', ' UTC').replace('T',' ') : String(value);
}
function text(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}
function link(label, url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    const a = text('a', label);
    a.href = parsed.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  } catch { return null; }
}
function displayValue(card) {
  if (card.value === null || card.value === undefined || card.availability !== 'reported') return card.availability === 'withheld' ? 'Value withheld' : 'Not reported';
  return typeof card.value === 'number' ? card.value.toLocaleString('en-US',{maximumFractionDigits:6}) : String(card.value);
}
function changeText(card) {
  const labels = {no_baseline:'No earlier brief to compare',unchanged:'No value or source-state change',state_changed:'Source state changed',added:'New in this comparison',withheld:'Evidence is now withheld',not_comparable:'Comparison unavailable: check units and source dates'};
  if (card.changeKind === 'value_changed') {
    const before = card.previousValue === null || card.previousValue === undefined ? 'not reported' : String(card.previousValue);
    return `Previously ${before}${card.previousUnit ? ' '+card.previousUnit : ''}${Number.isFinite(card.delta) ? ' · change '+(card.delta>0?'+':'')+Number(card.delta.toPrecision(8))+' '+(card.unit||'') : ''}${card.changeBasis === 'same_observation_time' ? ' · same observation date; possible revision' : ''}`;
  }
  return labels[card.changeKind] || 'Comparison unavailable';
}
function highlightEntries() {
  const find = id => current.cards.find(c=>c.id===id && c.availability==='reported');
  const funding=find('money-market:coverage'), regime=find('capital-market:funding-regime');
  const vix=find('capital-market:vix');
  const segments=current.cards.filter(c=>c.id.startsWith('market-liquidity:segment:') && c.availability==='reported');
  const partial=segments.filter(c=>c.availability==='reported' && c.value==='PARTIAL');
  return [
    {title:'Funding coverage',text:funding?`${funding.value} declared markets have a source-reported live benchmark.`:'Funding coverage could not be established.',detail:'Individual benchmarks keep their own dates and source states. Open the evidence to see what is missing.',source:funding?.source_url},
    {title:'Capital context',text:regime?`Seiche reports a ${regime.value} funding regime.`:'The funding regime is not available.',detail:vix?`VIX: ${vix.value} ${vix.unit} · ${date(vix.observed_at)}. The regime is product-derived context, not a price forecast.`:'No VIX observation is available to accompany this context.',source:regime?.source_url||vix?.source_url},
    {title:'Liquidity context',text:segments.length?`${partial.length} of ${segments.length} reported segment states are PARTIAL.`:'No liquidity segment states are available.',detail:'These are the publisher’s public context labels. They do not establish executable depth, safe position size, or why a ticker moved.',source:segments[0]?.source_url},
  ];
}
function renderHighlights() {
  $('highlights').replaceChildren();$('highlights').hidden=false;
  for(const item of highlightEntries()) {
    const article=document.createElement('article');article.className='highlight';
    article.append(text('p',item.title,'index'),text('h3',item.text),text('p',item.detail));
    const source=link('Read the source ↗',item.source);if(source)article.append(source);
    $('highlights').append(article);
  }
}
function render() {
  if (!current) return;
  $('cards').replaceChildren();
  const filtered = orderCards(current.cards).filter(card => topic === 'all' || card.topic === topic);
  for (const card of filtered) {
    const article = document.createElement('article');
    article.className = `data-card ${['reported','withheld','unavailable'].includes(card.availability)?card.availability:'unavailable'}`;
    const top = document.createElement('div'); top.className='card-top';
    top.append(text('span',topicNames[card.topic]||'Context','index'),text('span',card.evidence_class||'source reported','tag'));
    const value = text('p',displayValue(card),'value');
    if (String(displayValue(card)).length > 17) value.classList.add('long');
    if (card.unit && card.availability === 'reported' && card.value !== null) value.append(text('small',card.unit));
    const sources = document.createElement('div'); sources.className='card-source';
    for(const entry of [link(`${card.product} source ↗`,card.source_url),link('Original publisher ↗',card.original_url)]) if(entry) sources.append(entry);
    const change = text('p',changeText(card),'card-change');
    if(['withheld','not_comparable'].includes(card.changeKind)) change.classList.add('warn');
    article.append(top,text('h3',card.label),value,text('p',`Source reports: ${card.state||'not reported'}`,'card-state'));
    if(card.dayChange && Number.isFinite(card.dayChange.value) && card.availability === 'reported') article.append(text('p',`Publisher's one-observation change: ${card.dayChange.value > 0 ? '+' : ''}${card.dayChange.value} ${card.dayChange.unit}`,'card-state'));
    article.append(change,text('p',`Observation: ${date(card.observed_at)}`,'card-date'),sources);
    $('cards').append(article);
  }
  if (!filtered.length) $('cards').append(text('p','No observations are available for this topic.','placeholder-card'));
}
function describeBaseline() {
  $('forget').hidden = !baseline;
  $('baseline-note').textContent = baseline
    ? `Saved on this device: ${date(baseline.fetched_at)}. Comparisons use observation values and dates, not the retrieval timestamp.`
    : 'No saved baseline. Remember a brief to compare your next check; a first visit cannot establish what changed.';
}
function saveIfChosen() {
  if (!$('remember').checked || !current) return;
  if (current.transport_status === 'unavailable') {
    $('action-result').textContent = 'All sources unavailable; the previous baseline was kept.';
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY,JSON.stringify(current));
    baseline = current;
    describeBaseline();
  } catch { $('action-result').textContent='This browser could not save the baseline.'; }
}
function forgetBaseline() {
  try { localStorage.removeItem(STORAGE_KEY); }
  catch {
    $('remember').checked=Boolean(baseline);
    $('action-result').textContent='The browser could not remove the saved brief. Clear this site’s storage in browser settings.';
    return false;
  }
  baseline=null;$('remember').checked=false;describeBaseline();
  $('action-result').textContent='Saved baseline removed from this browser.';
  return true;
}
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && stored.length <= 200000) {
    const parsed=JSON.parse(stored);
    if(parsed.schema==='market-brief.browser.v1' && Array.isArray(parsed.cards)) {
      baseline=parsed; $('remember').checked=true;
    }
  }
} catch { baseline=null; }
describeBaseline();

$('build').addEventListener('click',async()=>{
  if(busy) return;
  if(Date.now()-lastRequest<60000){notice('Please allow a minute between checks. These sources update at their own publication cadence.');return;}
  busy=true;lastRequest=Date.now();$('build').disabled=true;$('build').textContent='Building your brief…';
  $('cards').setAttribute('aria-busy','true');$('action-result').textContent='';
  notice('Reading the three public sources. Their observation dates will stay visible.');
  try {
    const comparedWith=baseline?.fetched_at;
    current=await fetchBrief({previous:baseline});
    render();
    renderHighlights();
    $('observations').open=false;
    $('observations-label').textContent=`Inspect all ${current.cards.length} observations and comparison settings`;
    const errors=current.errors.length;
    const changed=current.cards.filter(c=>['value_changed','state_changed'].includes(c.changeKind)).length;
    notice(current.transport_status==='unavailable'
      ? 'The public sources could not be read. No current observations are being shown; try again later.'
      : `${current.cards.filter(c=>c.availability==='reported').length} reported observations · ${errors ? `${errors} source${errors>1?'s':''} unavailable. ` : 'All three sources responded. '}${comparedWith ? `${changed} value or source-state changes since the saved brief at ${date(comparedWith)}.` : 'First check: no baseline for changes.'} Coverage and freshness still depend on the source.`,errors>0);
    $('clock').textContent=`Retrieved ${date(current.fetched_at)}`;
    $('copy').disabled=false;$('download').disabled=false;$('open-share').disabled=false;
    record('checks');
    saveIfChosen();
  } catch(error) {
    current=null;$('cards').replaceChildren(text('p','The brief could not be built. No previous values are being presented as current.','placeholder-card'));
    $('highlights').hidden=true;$('observations').open=true;
    $('copy').disabled=true;$('download').disabled=true;$('open-share').disabled=true;
    notice(`Could not build the brief. ${baseline ? 'A saved comparison may be incompatible; use “Forget saved brief” and try again.' : 'Please try again later.'}`,true);
  } finally {busy=false;$('build').disabled=false;$('build').innerText='Build my brief ↗';$('cards').removeAttribute('aria-busy');}
});
document.querySelectorAll('[data-topic]').forEach(button=>button.addEventListener('click',()=>{
  topic=button.dataset.topic;
  document.querySelectorAll('[data-topic]').forEach(other=>other.setAttribute('aria-pressed',String(other===button)));
  render();
}));
$('remember').addEventListener('change',()=>{
  if($('remember').checked) saveIfChosen();
  else forgetBaseline();
});
$('forget').addEventListener('click',forgetBaseline);
async function copy(value, button, result = $('action-result')) {
  if (!copyStates.has(button)) copyStates.set(button, {label: button.textContent, timer: null});
  const state = copyStates.get(button);
  try {
    await navigator.clipboard.writeText(value); button.textContent = 'Copied';
    result.textContent = 'Copied. Nothing has been sent.';
    clearTimeout(state.timer);
    state.timer = setTimeout(() => button.textContent = state.label, 2000); return true;
  } catch { result.textContent = 'Clipboard unavailable. Select the visible link or use an export.'; return false; }
}
$('copy').addEventListener('click',async()=>{
  if(!current)return;
  if (await copy(formatShareText(createSharePreview(current, topic)), $('copy'))) record('copies');
});
$('copy-install').addEventListener('click',()=>copy(INSTALL,$('copy-install')));
$('download').addEventListener('click',()=>{
  if(!current)return;
  downloadBlob(new Blob([JSON.stringify(current,null,2)],{type:'application/json'}), `market-brief-${current.fetched_at.slice(0,10)}.json`);
});

$('open-share').addEventListener('click', () => {
  if (!current) return;
  sharePreview = createSharePreview(current, topic);
  $('share-title').textContent = sharePreview.title;
  $('share-scope').textContent = `Retrieved ${date(sharePreview.generatedAt)}. Showing ${sharePreview.observations.length} of ${sharePreview.total} observations: ${sharePreview.reported} reported, ${sharePreview.unavailable} unavailable, ${sharePreview.withheld} withheld.`;
  $('share-observations').replaceChildren();
  for (const observation of sharePreview.observations) {
    const row = document.createElement('article'); row.className = 'share-observation';
    row.append(text('h3', observation.label), text('p', `${displayValue(observation)}${observation.availability === 'reported' ? ' ' + observation.unit : ''}`, 'share-value'),
      text('p', `Observed ${date(observation.observed_at)} · Source reports ${observation.state}`, 'quiet'),
      text('p', `Source generated ${date(observation.source_generated_at)}`, 'quiet'));
    const source = link('Read source', observation.source_url), original = link('Original publisher', observation.original_url);
    if (source) row.append(source); if (original) row.append(original);
    $('share-observations').append(row);
  }
  $('share-link').value = sharePreview.url;
  $('telegram-share').href = telegramShareUrl(sharePreview);
  $('native-share').hidden = typeof navigator.share !== 'function';
  $('share-result').textContent = '';
  $('share-dialog').showModal();
});
$('close-share').addEventListener('click', () => $('share-dialog').close());
$('native-share').addEventListener('click', async () => {
  if (!sharePreview || typeof navigator.share !== 'function') return;
  record('share_intents');
  try {
    await navigator.share({title: sharePreview.title, text: formatShareText(sharePreview), url: sharePreview.url});
    $('share-result').textContent = 'Sharing dialog completed. Delivery is not confirmed by this app.';
  } catch (error) {
    $('share-result').textContent = error.name === 'AbortError' ? 'Sharing cancelled.' : 'Sharing is unavailable here. Copy the link or save the image.';
  }
});
$('telegram-share').addEventListener('click', () => record('share_intents'));
$('copy-share').addEventListener('click', async () => {
  if (sharePreview && await copy(formatShareText(sharePreview), $('copy-share'), $('share-result'))) record('copies');
});
$('copy-link').addEventListener('click', async () => {
  if (sharePreview && await copy(sharePreview.url, $('copy-link'), $('share-result'))) record('copies');
});
$('save-card').addEventListener('click', async () => {
  if (!sharePreview) return;
  const preview = sharePreview;
  $('save-card').disabled = true;
  try {
    const blob = await createShareCard(preview);
    downloadBlob(blob, `market-brief-${(preview.generatedAt || new Date().toISOString()).slice(0, 10)}.png`);
    record('cards_saved'); $('share-result').textContent = 'Image prepared for download. Source dates are included.';
  } catch { $('share-result').textContent = 'The image could not be created. Copy the preview or link instead.'; }
  finally { $('save-card').disabled = false; }
});
$('pilot-consent').addEventListener('change', () => {
  if ($('pilot-consent').checked) {
    try {
      activity = createActivity(Date.now(), arrival.ref || 'direct');
      localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity)); describeActivity();
    } catch { activity = null; describeActivity('This browser cannot save an activity log. No activity is being recorded.'); }
  } else {
    activity = null;
    try { localStorage.removeItem(ACTIVITY_KEY); describeActivity('Activity log deleted. No activity is being recorded.'); }
    catch {
      try { localStorage.setItem(ACTIVITY_KEY, '{}'); describeActivity('Activity log cleared. No activity is being recorded.'); }
      catch { describeActivity('Recording stopped in this tab. Clear this site’s data in browser settings to remove the saved log.'); }
    }
  }
});
$('pilot-export').addEventListener('click', () => {
  try {
    activity = readActivity(); describeActivity();
    if (!activity) return;
    const report = activityReport(activity);
    downloadBlob(new Blob([JSON.stringify(report, null, 2)], {type: 'application/json'}), `market-brief-activity-${report.as_of_day}.json`);
  } catch { activity = null; describeActivity('The saved log could not be read. No activity report was exported.'); }
});
document.addEventListener('click', event => {
  const source = event.target.closest?.('a');
  if (source && source.closest('.card-source, .highlight, .share-observation')) record('source_opens');
});
