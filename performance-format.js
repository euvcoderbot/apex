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
export const color = value => /^#[a-f\d]{6}$/i.test(value || '') ? value : '#888888';
export const signed = (n, digits=3, suffix='%') => finite(n) ? `${n>0?'+':''}${Math.abs(n)<.5*10**(-digits)?(0).toFixed(digits):n.toFixed(digits)}${suffix}` : '—';
