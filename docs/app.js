import { fetchBrief } from './data.js';
import { orderCards } from './priorities.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'market-brief.browser.v1';
const INSTALL = 'npx skills add https://github.com/beepboop2025/market-brief/tree/v0.1.0 --skill market-brief';
let current = null;
let baseline = null;
let topic = 'all';
let busy = false;
let lastRequest = 0;
const topicNames = {'money-market':'Funding','capital-market':'Capital','market-liquidity':'Liquidity'};

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
    $('copy').disabled=false;$('download').disabled=false;
    saveIfChosen();
  } catch(error) {
    current=null;$('cards').replaceChildren(text('p','The brief could not be built. No previous values are being presented as current.','placeholder-card'));
    $('highlights').hidden=true;$('observations').open=true;
    $('copy').disabled=true;$('download').disabled=true;
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
async function copy(value,button) {
  try{await navigator.clipboard.writeText(value);button.textContent='Copied';setTimeout(()=>button.textContent=button.id==='copy-install'?'Copy install command':'Copy brief',2000);}
  catch{$('action-result').textContent='Clipboard unavailable. Use Export JSON or select the install command.';}
}
$('copy').addEventListener('click',()=>{
  if(!current)return;
  const lines=['Market Brief',`Retrieved: ${current.fetched_at}`,'Source-reported funding and liquidity context; not trading advice.',''];
  for(const h of highlightEntries()) lines.push(h.text,h.detail,h.source||'Source unavailable','');
  const cards=orderCards(current.cards).filter(c=>topic==='all'||c.topic===topic).slice(0,8);
  lines.push(`Selected observations (${cards.length} of ${current.cards.length}; full detail in Export JSON):`);
  for(const c of cards) lines.push(`${c.label}: ${displayValue(c)} ${c.unit||''}`,`Source reports ${c.state||'unknown'} · observation ${c.observed_at||'not reported'}`,changeText(c),c.source_url,'');
  lines.push('Coverage is partial. Retrieval does not independently verify freshness or rights.','https://beepboop2025.github.io/market-brief/');
  copy(lines.join('\n'),$('copy'));
});
$('copy-install').addEventListener('click',()=>copy(INSTALL,$('copy-install')));
$('download').addEventListener('click',()=>{
  if(!current)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(current,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=`market-brief-${current.fetched_at.slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
