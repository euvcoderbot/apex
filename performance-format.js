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

// A season score gives each field member equal weight, including self at zero.
// Every pair needs direct
// support on enough of the selected weekends. Event centering cancels out.
export function matchedRivalScores(series, minimum, estimate = median) {
  if (series.length < 3) return null;
  const contrasts = series.map(() => []);
  let minimumOverlap = Infinity, maximumOverlap = 0;
  for (const [i, own] of series.entries()) {
    for (let j=i+1; j<series.length; j++) {
      const other = series[j];
      const gaps = [];
      for (const [event, value] of own) if (other.has(event)) gaps.push(value-other.get(event));
      if (gaps.length < minimum) return null;
      minimumOverlap = Math.min(minimumOverlap, gaps.length);
      maximumOverlap = Math.max(maximumOverlap, gaps.length);
      const gap = estimate(gaps);
      contrasts[i].push(gap);
      contrasts[j].push(-gap);
    }
  }
  return {values: contrasts.map(gaps=>gaps.reduce((total,gap)=>total+gap,0)/series.length),
    overlap: [minimumOverlap,maximumOverlap]};
}

/** Compare the entrants with measurements on one shared set of GPs. Each draw resamples
 *  that set together and compares every entrant with the leader in that draw. */
export function sharedPace(entries, mode, draws = 600) {
  const measured = entries.map(entry => new Map(entry.filter(row => finite(row.value)&&row.value>-100).map(row => [row.event, row])));
  // An entrant measured in fewer than half of the GPs anyone was measured in stays unranked: it would otherwise shrink the
  // shared set for everyone (one missing team at nine of ten GPs would leave a single race to compare).
  const seen = new Set(measured.flatMap(series => [...series.keys()])).size;
  const eligible = measured.map((series, index) => ({series, index})).filter(row => row.series.size && row.series.size >= seen / 2);
  const shared = [...(eligible[0]?.series.keys() || [])].filter(event => eligible.every(row => row.series.has(event)));
  const result = entries.map((_, i) => ({value: null, range: null, count: 0, provisional: 0, own: measured[i].size, seen}));
  const minimum = Math.ceil(seen/2);
  if (seen>=4 && shared.length<minimum) {
    // Logs make relative lap-time ratios symmetric when a pair is reversed.
    const ratios = eligible.map(({series}) => new Map([...series].map(([gp,row])=>[gp,Math.log1p(row.value/100)])));
    const matched = matchedRivalScores(ratios,minimum,mode==='mean'?avg:median);
    if (!matched) return result;
    const best = Math.min(...matched.values);
    eligible.forEach(({index,series},i)=>{
      const used=[...series].filter(([gp])=>eligible.some(rival=>rival.index!==index&&rival.series.has(gp)));
      result[index]={...result[index],value:Math.expm1(matched.values[i]-best)*100,
        count:used.length,provisional:used.filter(([,row])=>row.provisional).length,rivalOverlap:matched.overlap};
    });
    return result;
  }
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
    result[index] = {...result[index], value: values[i], range: samples[i].length ? [percentile(samples[i], .05), percentile(samples[i], .95)] : null,
      count: shared.length, provisional: rows[i].filter(row => row.provisional).length};
  });
  return result;
}
