// Draw the selected public observations locally. No remote images or fonts.
function lines(context, value, width) {
  const result = [];
  for (const paragraph of String(value ?? '').split('\n')) {
    let line = '';
    for (const character of paragraph) {
      if (line && context.measureText(line + character).width > width) { result.push(line); line = ''; }
      line += character;
    }
    result.push(line);
  }
  return result;
}

export async function createShareCard(preview) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image export is unavailable in this browser.');
  const width = 1056, ops = []; let y = 80;
  function paragraph(value, size = 24, color = '#5e6962', gap = 17, family = 'Arial, sans-serif') {
    const font = `${size}px ${family}`; context.font = font;
    for (const line of lines(context, value, width)) {
      ops.push({text: line, x: 72, y, font, color}); y += size * 1.4;
    }
    y += gap;
  }
  paragraph('market brief', 29, '#166453', 27);
  paragraph(preview.title, 50, '#233a32', 20, 'Georgia, serif');
  paragraph(`Snapshot retrieved ${preview.generatedAt || 'at an unreported time'}`, 22);
  paragraph(`${preview.reported} reported · ${preview.unavailable} unavailable · ${preview.withheld} withheld in the selected coverage.`, 23);
  paragraph(`Selected observations: ${preview.observations.length} of ${preview.total}.`, 22, '#5e6962', 24);
  for (const observation of preview.observations) {
    ops.push({rule: true, y}); y += 37;
    paragraph(observation.label, 29, '#233a32', 9);
    const value = observation.availability === 'reported'
      ? `${observation.value}${observation.unit ? ' ' + observation.unit : ''}`
      : observation.availability === 'withheld' ? 'Value withheld' : 'Not reported';
    paragraph(value, 38, '#166453', 8, 'Georgia, serif');
    paragraph(`Source reports: ${observation.state || 'not reported'}`, 22, '#5e6962', 8);
    paragraph(`Observed: ${observation.observed_at || 'not reported'}`, 21, '#5e6962', 8);
    paragraph(`Source generated: ${observation.source_generated_at || 'not reported'}`, 21, '#5e6962', 10);
    paragraph(`Source: ${observation.source_url}`, 19, '#233a32', 8);
    if (observation.original_url) paragraph(`Original: ${observation.original_url}`, 19, '#233a32', 8);
    y += 20;
  }
  ops.push({rule: true, y}); y += 38;
  paragraph('Source-reported research context. Dates differ by observation; retrieval does not verify freshness or rights. Coverage is partial.', 22);
  paragraph('Check the latest responses:', 22, '#233a32', 6);
  paragraph(preview.url, 22, '#166453', 0);
  canvas.height = Math.ceil(y + 62);
  context.fillStyle = '#f4f2e9'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.textBaseline = 'top';
  for (const op of ops) {
    if (op.rule) {context.strokeStyle = '#d5d9ce'; context.beginPath(); context.moveTo(72, op.y); context.lineTo(1128, op.y); context.stroke();}
    else {context.fillStyle = op.color; context.font = op.font; context.fillText(op.text, op.x, op.y);}
  }
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image export failed.')), 'image/png'));
}
