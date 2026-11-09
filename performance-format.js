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
export const middle50Label = (values, suffix='') => {
  const usable=values.filter(finite);
  return usable.length>=4 ? `${fmt(percentile(usable,.25),3)}–${fmt(percentile(usable,.75),3)}${suffix}` : null;
};
export const fmt = (n, digits=3, suffix='') => finite(n) ? `${n.toFixed(digits)}${suffix}` : '—';
export const exactSeconds = n => finite(n) ? `${n} s` : '—';
// Team colours are drawn as formula1.com shows them (team-colours.js); without that script (tests, prerender) the data's colour is used.
export const color = value => /^#[a-f\d]{6}$/i.test(value || '') ? (globalThis.apexTeamColour?.(value) ?? value) : '#888888';
export const signed = (n, digits=3, suffix='%') => finite(n) ? `${n>0?'+':''}${Math.abs(n)<.5*10**(-digits)?(0).toFixed(digits):n.toFixed(digits)}${suffix}` : '—';
/** Likely range (5th–95th percentile) of a season figure, by resampling its GPs with replacement. Deterministic, so the same
 *  data always draws the same whiskers. Needs four or more GPs; with fewer the range would mostly reflect the resampling. */
export const bootstrapRange = (values, mode = 'mean', draws = 600) => {
  const v = values.filter(finite);
  if (v.length < 4) return null;
  let seed = 0x2545f491 ^ v.length;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const stats = [];
  for (let d = 0; d < draws; d++) stats.push(summarize(Array.from(v, () => v[Math.floor(random() * v.length)]), mode));
  return [percentile(stats, .05), percentile(stats, .95)];
};
