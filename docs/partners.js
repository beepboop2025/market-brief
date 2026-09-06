import { TOPICS, topicFromSearch, embedSnippet, newsletterTemplate, SKILL_INSTALL, PYTHON_INSTALL } from './embed-model.js';

const $ = id => document.getElementById(id);
$('topic').value = topicFromSearch(location.search);

function updatePreview() {
  const topic = $('topic').value;
  $('embed-code').value = embedSnippet(topic);
  const preview = new URL('embed.html', location.href);
  if (topic !== 'all') preview.searchParams.set('topic', topic);
  if ($('preview').src !== preview.href) $('preview').src = preview.href;
  $('preview').title = `Market Brief live preview: ${TOPICS[topic]}`;
}

updatePreview();
$('topic').addEventListener('change', updatePreview);
$('newsletter-code').value = newsletterTemplate();
$('skill-code').value = SKILL_INSTALL;
$('python-code').value = PYTHON_INSTALL;

let feedbackTimer;
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const field = $(button.dataset.copy);
    clearTimeout(feedbackTimer);
    try {
      await navigator.clipboard.writeText(field.value);
      $('copy-status').textContent = 'Copied. Paste it into your editor.';
    } catch {
      field.focus();
      field.select();
      $('copy-status').textContent = 'Clipboard unavailable. The text is selected; use your browser’s Copy command.';
    }
    feedbackTimer = setTimeout(() => { $('copy-status').textContent = ''; }, 6000);
  });
}
