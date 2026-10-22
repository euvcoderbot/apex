/* Session analysis: Pirelli compound helpers. */
// Pirelli Tyre Compounds Helpers
function getCompoundCode(compound, nominated) {
  if (!nominated || nominated.length < 3) return compound;
  const comp = String(compound).toUpperCase().replace(/\s+/g, '');
  if (comp === 'HARD') return `HARD (${nominated[0]})`;
  if (comp === 'MEDIUM') return `MEDIUM (${nominated[1]})`;
  if (comp === 'SOFT') return `SOFT (${nominated[2]})`;
  return compound;
}

function getCompoundToneClass(compound) {
  const value = String(compound || '').toUpperCase().replace(/\s+/g, '');
  if (value.includes('INTER')) return 'compound-intermediate';
  if (value.includes('WET')) return 'compound-wet';
  if (value.includes('MEDIUM')) return 'compound-medium';
  if (value.includes('HARD')) return 'compound-hard';
  if (value.includes('SOFT')) return 'compound-soft';
  return 'compound-unknown';
}

function getCompoundAbbreviation(comp) {
  const c = String(comp).toUpperCase().replace(/\s+/g, '');
  if (c.includes('HYPER')) return 'HS';
  if (c.includes('ULTRA')) return 'US';
  if (c.includes('SUPER')) return 'SS';
  if (c.includes('SOFT')) return 'S';
  if (c.includes('MEDIUM')) return 'M';
  if (c.includes('HARD')) return 'H';
  if (c.includes('WET')) return 'W';
  if (c.includes('INTER')) return 'I';
  return comp;
}

function renderTireNomination() {
  const card = $('#tireCard');
  const root = $('#tireNomination');
  if (!card || !root) return;
  
  if (!nominatedCompounds || !nominatedCompounds.length) {
    card.style.display = 'none';
    return;
  }
  
  card.style.display = '';
  
  const labels = ['Hard', 'Medium', 'Soft'];
  const colors = ['#ffffff', '#ffd700', '#ff0055']; // White, Yellow, Red
  
  root.innerHTML = nominatedCompounds.map((comp, i) => {
    const isC = /^C[0-6]$/i.test(comp);
    const label = isC ? (labels[i] || 'Nominated') : comp;
    const displayVal = isC ? comp : getCompoundAbbreviation(comp);
    const color = colors[i] || '#888888';
    
    return `
      <div class="tire-option tire-${String(label).toLowerCase()}" style="--tire-color:${color}">
        ${compoundBadgeMarkup(label)}
        <span class="tire-copy"><strong>${escapeUI(label)}${isC ? ` · ${escapeUI(displayVal)}` : ''}</strong>${isC ? '' : `<small>${escapeUI(displayVal)}</small>`}</span>
      </div>
    `;
  }).join('');
}
