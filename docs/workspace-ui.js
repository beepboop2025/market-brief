import { WATCH_KEY, MAX_WATCHED, parseWatch, serializeWatch, toggleWatch, selectCards, summarizeReview } from './watchboard.js';
import { createResearchHandoff } from './handoff.js';

const $ = id => document.getElementById(id);
const node = (tag, value, className = '') => {
  const element = document.createElement(tag);
  element.textContent = value; element.className = className;
  return element;
};

/** The workspace stores identities only; market values remain in the existing optional baseline. */
export function createWorkspace({ getCurrent, renderCards, recordCopy, isBusy = () => false }) {
  let watched = [], saved = false, view = 'all', topic = 'all', packet = null;
  const status = message => { $('watch-status').textContent = message; };
  try {
    const raw = localStorage.getItem(WATCH_KEY), parsed = parseWatch(raw);
    if (parsed !== null) { watched = parsed; saved = true; }
    else if (raw !== null) status('The saved watchboard could not be read. Choose observations again; no market values were loaded.');
  } catch { status('Browser storage is unavailable. You can still watch observations in this tab.'); }
  if (watched.length) view = 'watched';

  function controls() {
    $('remember-watch').checked = saved;
    $('clear-watch').disabled = watched.length === 0 && !saved;
    document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  }
  function update(id, shouldWatch) {
    let base = watched;
    if (saved) {
      try {
        // A different tab can revoke persistence without this tab opting it back in.
        const latest = parseWatch(localStorage.getItem(WATCH_KEY));
        if (latest === null) {
          saved = false;
          base = [];
          status('Saving was turned off in another tab. These choices now stay in this tab only.');
        } else base = latest;
      } catch {
        status('The browser could not save that change. Your watchboard was kept as it was.');
        return false;
      }
    }
    // Apply the explicit add/remove intent to the latest saved IDs, retaining other tabs' choices.
    const next = base.includes(id) === shouldWatch ? base : toggleWatch(base, id);
    if (saved) {
      try { localStorage.setItem(WATCH_KEY, serializeWatch(next)); }
      catch { status('The browser could not save that change. Your watchboard was kept as it was.'); return false; }
    }
    watched = next;
    controls(); renderCards();
    return true;
  }
  function select(cards, selectedTopic = topic) {
    return selectCards(cards, { topic: selectedTopic, view, watched });
  }
  function renderSummary(selectedTopic) {
    if (packet) clearHandoff();
    topic = selectedTopic;
    controls();
    const current = getCurrent();
    if (!current) {
      $('open-handoff').disabled = true;
      $('review-summary').textContent = `No current brief. ${watched.length}/${MAX_WATCHED} observations watched. Build a brief to review their latest source responses.`;
      return;
    }
    const scoped = current.cards.filter(card => topic === 'all' || card.topic === topic);
    const selectedIds = watched.filter(id => topic === 'all' || id.startsWith(`${topic}:`));
    const summary = summarizeReview(scoped, { watched: selectedIds });
    $('review-summary').textContent = `${summary.changed} value or source-state changes · ${summary.gaps} evidence gaps · ${watched.length}/${MAX_WATCHED} watched${summary.missingWatched.length ? ` · ${summary.missingWatched.length} watched observations not returned` : ''}. ${current.comparison_status === 'no_baseline' ? 'No saved comparison: changes cannot yet be established.' : 'Counts refer to the selected topic; gaps include stale, undated or incomparable evidence.'}`;
    const missing = selectedIds.filter(id => !current.cards.some(card => card.id === id));
    $('open-handoff').disabled = isBusy() || select(scoped).length === 0 && !(view === 'watched' && missing.length);
  }
  function watchButton(card) {
    const button = node('button', watched.includes(card.id) ? 'Watching' : 'Watch observation', 'watch-button');
    button.type = 'button'; button.dataset.watchId = card.id;
    button.setAttribute('aria-pressed', String(watched.includes(card.id)));
    button.setAttribute('aria-label', `${watched.includes(card.id) ? 'Unwatch' : 'Watch'} ${card.label}`);
    button.addEventListener('click', () => {
      try {
        if (update(card.id, !watched.includes(card.id))) {
          status(`${watched.length}/${MAX_WATCHED} observations watched. ${saved ? 'Choices are saved on this device.' : 'Choices stay in this tab. Enable remembering to keep them for your next visit.'}`);
          const replacement = [...document.querySelectorAll('[data-watch-id]')].find(item => item.dataset.watchId === card.id);
          (replacement || $('clear-watch')).focus();
        }
      } catch { status(`You can watch up to ${MAX_WATCHED} observations. Unwatch one to add another.`); }
    });
    return button;
  }
  function appendMissing(container) {
    const current = getCurrent();
    if (!current || view !== 'watched') return;
    for (const id of watched.filter(id => (topic === 'all' || id.startsWith(`${topic}:`)) && !current.cards.some(card => card.id === id))) {
      const article = node('article', '', 'data-card unavailable');
      article.append(node('p', 'WATCHED · NOT RETURNED', 'index'), node('h3', id),
        node('p', 'Not reported', 'value'), node('p', 'This observation is absent from the latest brief. Its previous value has not been carried forward.', 'quiet'),
        watchButton({ id, label: id }));
      container.append(article);
    }
  }
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    view = button.dataset.view; controls();
    $('observations').open = true;
    renderCards();
  }));
  $('remember-watch').addEventListener('change', () => {
    try {
      if ($('remember-watch').checked) {
        localStorage.setItem(WATCH_KEY, serializeWatch(watched)); saved = true;
        status('Watch choices saved on this device. Only observation IDs are stored; no background checks run.');
      } else {
        localStorage.removeItem(WATCH_KEY); saved = false;
        status('Saved choices removed. Your current watchboard stays in this tab.');
      }
    } catch { status('The browser could not change saved choices. Clear this site’s storage in browser settings if needed.'); }
    controls();
  });
  $('clear-watch').addEventListener('click', () => {
    let removed = true;
    try {
      localStorage.removeItem(WATCH_KEY);
    } catch { removed = false; }
    watched = []; saved = false; controls(); renderCards();
    status(removed ? 'Watchboard cleared from this device and this tab.'
      : 'Watchboard cleared in this tab. The browser could not remove saved choices; clear this site’s storage in browser settings to remove them.');
  });
  window.addEventListener('storage', event => {
    if (event.key !== WATCH_KEY && event.key !== null) return;
    try {
      const parsed = parseWatch(localStorage.getItem(WATCH_KEY));
      watched = parsed || []; saved = parsed !== null;
      controls(); renderCards(); status('Watchboard updated from another tab.');
    } catch { status('The watchboard could not be read from browser storage.'); }
  });
  $('open-handoff').addEventListener('click', () => {
    const current = getCurrent();
    if (!current || isBusy()) return;
    try {
      const missingWatched = view === 'watched' ? watched.filter(id => (topic === 'all' || id.startsWith(`${topic}:`)) && !current.cards.some(card => card.id === id)) : [];
      packet = createResearchHandoff(current, { cards: select(current.cards), missingWatched });
      $('handoff-preview').value = packet.text;
      $('handoff-scope').textContent = `${packet.observationCount} observations · ${packet.missingCount} watched observations absent. View: ${view}. Retrieved ${current.fetched_at}.`;
      $('handoff-result').textContent = 'Prepared locally. Review the packet before copying it.';
      $('handoff-dialog').showModal();
    } catch { packet = null; status('This research packet could not be prepared. Rebuild the brief and try again.'); }
  });
  $('close-handoff').addEventListener('click', () => $('handoff-dialog').close());
  $('copy-handoff').addEventListener('click', async () => {
    if (!packet) return;
    try {
      await navigator.clipboard.writeText(packet.text); recordCopy();
      $('handoff-result').textContent = 'Copied. Paste into your chosen assistant when ready.';
    } catch { $('handoff-preview').focus(); $('handoff-preview').select(); $('handoff-result').textContent = 'Clipboard unavailable. The packet is selected for manual copying.'; }
  });
  $('download-handoff').addEventListener('click', () => {
    if (!packet) return;
    const url = URL.createObjectURL(new Blob([packet.text], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'market-brief-research.md'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('handoff-result').textContent = 'Markdown prepared for download. No assistant was contacted.';
  });
  function clearHandoff() {
    packet = null; $('handoff-preview').value = ''; $('handoff-dialog').close(); $('open-handoff').disabled = true;
  }
  controls();
  return { select, renderSummary, watchButton, appendMissing,
    revealAfterBuild: () => view !== 'all',
    clearHandoff,
  };
}
