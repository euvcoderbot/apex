// Car performance: number formatting, small statistics and HTML escaping.
// No page state: safe to import anywhere.
export const $ = id => document.getElementById(id);
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export const avg = values => { const a = values.filter(finite); return a.length ? a.reduce((s,v)=>s+v,0)/a.length : null; };
export const median = values => { const a=values.filter(finite).sort((a,b)=>a-b), i=Math.floor(a.length/2); return a.length ? a.length%2 ? a[i] : (a[i-1]+a[i])/2 : null; };
export const percentile = (values, fraction) => {
  const ordered=values.filter(finite).sort((a,b)=>a-b);
  if(!ordered.length)return null;
  const position=(ordered.length-1)*fraction, lower=Math.floor(position), upper=Math.ceil(position);
  return ordered[lower]+(ordered[upper]-ordered[lower])*(position-lower);
};
export const summarize = (values, mode) => mode==='median' ? median(values) : mode==='p75' ? percentile(values,.75) : avg(values);
export const fmt = (n, digits=3, suffix='') => finite(n) ? `${n.toFixed(digits)}${suffix}` : '—';
export const exactSeconds = n => finite(n) ? `${n} s` : '—';
// Team colours are drawn as formula1.com shows them (team-colours.js); without that script (tests, prerender) the data's colour is used.
export const color = value => /^#[a-f\d]{6}$/i.test(value || '') ? (globalThis.apexTeamColour?.(value) ?? value) : '#888888';
export const signed = (n, digits=3, suffix='%') => finite(n) ? `${n>0?'+':''}${Math.abs(n)<.5*10**(-digits)?(0).toFixed(digits):n.toFixed(digits)}${suffix}` : '—';
/** Compare the entrants with measurements on one shared set of GPs. Each draw resamples
 *  that set together and compares every entrant with the leader in that draw. */
export function sharedPace(entries, mode, draws = 600) {
  const measured = entries.map(entry => new Map(entry.filter(row => finite(row.value)).map(row => [row.event, row])));
  const eligible = measured.map((series, index) => ({series, index})).filter(row => row.series.size);
  const shared = [...(eligible[0]?.series.keys() || [])].filter(event => eligible.every(row => row.series.has(event)));
  const result = entries.map(() => ({value: null, range: null, count: 0, provisional: 0}));
  if (!shared.length || eligible.length < 2) return result;
  const rows = eligible.map(({series}) => shared.map(event => series.get(event)));
  const score = indices => {
    const centres = rows.map(series => summarize(indices.map(index => series[index].value), mode));
    const best = Math.min(...centres);
    return centres.map(value => ((value - best) / (100 + best)) * 100);
  };
  const values = score(shared.map((_, i) => i));
  const samples = rows.map(() => []);
  let seed = 0x2545f491 ^ shared.length;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  if (shared.length >= 4) {
    for (let draw = 0; draw < draws; draw++) {
      const indices = shared.map(() => Math.floor(random() * shared.length));
      score(indices).forEach((gap, i) => samples[i].push(gap));
    }
  }
  eligible.forEach(({index}, i) => {
    result[index] = {value: values[i], range: samples[i].length ? [percentile(samples[i], .05), percentile(samples[i], .95)] : null,
      count: shared.length, provisional: rows[i].filter(row => row.provisional).length};
  });
  return result;
}
