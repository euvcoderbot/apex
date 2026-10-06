import {raceCornerGroups,measureRaceCornerGroup} from './race-cornering.js?v=20261006';
// APEX - Car Performance Section
// Full parity with Session Analysis design language: Apple UI, official team logos, GP country flags, custom select menus.
// Scientific rigor aligned with Astra GPT-6 Hybrid principles: no speculative physical regressions, sampling-aware bounds.

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const avg = values => { const a = values.filter(finite); return a.length ? a.reduce((s,v)=>s+v,0)/a.length : null; };
const median = values => { const a=values.filter(finite).sort((a,b)=>a-b), i=Math.floor(a.length/2); return a.length ? a.length%2 ? a[i] : (a[i-1]+a[i])/2 : null; };
const percentile = (values, fraction) => {
  const ordered=values.filter(finite).sort((a,b)=>a-b);
  if(!ordered.length)return null;
  const position=(ordered.length-1)*fraction, lower=Math.floor(position), upper=Math.ceil(position);
  return ordered[lower]+(ordered[upper]-ordered[lower])*(position-lower);
};
const summarize = (values, mode) => mode==='median' ? median(values) : mode==='p75' ? percentile(values,.75) : avg(values);
const middle50Label = (values, suffix='') => {
  const usable=values.filter(finite);
  return usable.length>=4 ? `${fmt(percentile(usable,.25),3)}–${fmt(percentile(usable,.75),3)}${suffix}` : null;
};
const fmt = (n, digits=2, suffix='') => finite(n) ? `${n.toFixed(digits)}${suffix}` : '—';
const exactSeconds = n => finite(n) ? `${n} s` : '—';
const color = value => /^#[a-f\d]{6}$/i.test(value || '') ? value : '#888888';
const signed = (n, digits=2, suffix='%') => finite(n) ? `${n>0?'+':''}${Math.abs(n)<.0000001?(0).toFixed(digits):n.toFixed(digits)}${suffix}` : '—';
const round = (val, digits = 2) => finite(val) ? Number(val.toFixed(digits)) : null;

// Pirelli's weekend labels are relative: the same MEDIUM can be C2, C3, C4 or C5.
// Each entry is [Hard, Medium, Soft] in championship round order. Never infer
// an exact grade from the relative label without a year + verified race allocation.
// Sources: the race-by-race Pirelli nominations in the supplied 2021-2026
// workbook, cross-checked against the Pirelli releases linked below.
//          https://press.pirelli.com/2021-tyre-compound-choices/
//          https://press.pirelli.com/?h=1&t=2022+Tyre+Compound+Choices
//          https://press.pirelli.com/?h=1&t=2023+Tyre+Compound+Choices
//          https://press.pirelli.com/?h=1&t=2024+Tyre+Compound+Choices
//          https://press.pirelli.com/?h=1&t=2025+tyre+compound+choices
//          https://press.pirelli.com/?h=1&t=2026+tyre+compound+choices
const VERIFIED_DRY_ALLOCATIONS = Object.freeze({
  2021: '234 234 123 123 345 345 234 234 345 123 234 234 123 234 345 234 234 234 234 123 234 345'.split(' '),
  2022: '123 234 235 234 234 123 345 345 345 123 345 234 234 234 123 234 345 123 234 234 234 345'.split(' '),
  2023: '123 234 234 345 234 345 123 345 345 123 345 234 123 345 345 123 123 234 345 234 345 345'.split(' '),
  2024: '123 234 345 123 234 234 345 345 345 123 345 123 345 234 123 345 345 345 234 345 345 345 123 345'.split(' '),
  2025: '345 234 123 123 345 345 456 456 123 456 345 234 134 345 234 345 456 345 134 245 234 345 123 345'.split(' '),
  2026: '345 234 123 345 345 345 234 345 123 234 345 234 345 234 345 234 345'.split(' ')
});
const TYRE_ALLOCATION_SOURCES = Object.freeze({
  2021: 'https://press.pirelli.com/2021-tyre-compound-choices/',
  2022: 'https://press.pirelli.com/?h=1&t=2022+Tyre+Compound+Choices',
  2023: 'https://press.pirelli.com/?h=1&t=2023+Tyre+Compound+Choices',
  2024: 'https://press.pirelli.com/?h=1&t=2024+Tyre+Compound+Choices',
  2025: 'https://press.pirelli.com/?h=1&t=2025+tyre+compound+choices',
  2026: 'https://press.pirelli.com/?h=1&t=2026+tyre+compound+choices'
});
function verifiedDryGrade(year, raceRound, relativeCompound) {
  const allocation = VERIFIED_DRY_ALLOCATIONS[year]?.[Number(raceRound)-1];
  const position = {HARD:0, MEDIUM:1, SOFT:2}[String(relativeCompound || '').toUpperCase()];
  return allocation && position !== undefined ? `C${allocation[position]}` : null;
}

// Team marks - exact match with Session Analysis
const officialTeamMarks = {
  'mercedes': 'mercedes.webp', 'ferrari': 'ferrari.webp', 'mclaren': 'mclaren.webp',
  'red bull racing': 'redbullracing.webp', 'red bull': 'redbullracing.webp',
  'racing bulls': 'racingbulls.webp', 'rb': 'racingbulls.webp',
  'alpine': 'alpine.webp', 'alpine f1 team': 'alpine.webp',
  'haas': 'haasf1team.webp', 'haas f1 team': 'haasf1team.webp',
  'audi': 'audi.webp', 'williams': 'williams.webp',
  'aston martin': 'astonmartin.webp', 'cadillac': 'cadillac.webp',
};

const historicalTeamMarks = {
  'sauber': 'sauber.svg', 'kick sauber': 'kick-sauber.png', 'stake f1 team kick sauber': 'kick-sauber.png',
  'alfa romeo': 'alfa-romeo.svg', 'alfa romeo racing': 'alfa-romeo.svg', 'alfa romeo sauber': 'sauber.svg',
  'alphatauri': 'alphatauri.svg', 'alpha tauri': 'alphatauri.svg', 'scuderia alphatauri': 'alphatauri.svg',
  'toro rosso': 'toro-rosso.svg', 'scuderia toro rosso': 'toro-rosso.svg',
  'racing point': 'racing-point.svg', 'force india': 'force-india.png',
  'lotus': 'lotus.png', 'lotus f1 team': 'lotus.png', 'manor': 'manor.png', 'manor racing': 'manor.png',
  'marussia': 'marussia.png', 'manor marussia': 'marussia.png', 'caterham': 'caterham.png',
};

function teamLogoMarkup(teamName) {
  if (typeof window.teamLogoMarkup === 'function') {
    return window.teamLogoMarkup(teamName);
  }
  const key = String(teamName || '').trim().toLowerCase();
  if (key === 'renault' || key === 'renault sport f1 team') {
    return '<span class="team-logo team-logo-historical" aria-hidden="true"><img src="assets/teams/historical/renault.png" alt="" width="24" height="24"></span>';
  }
  const historical = historicalTeamMarks[key];
  if (historical) {
    return `<span class="team-logo team-logo-historical" aria-hidden="true"><img src="assets/teams/historical/${historical}" alt="" width="24" height="24"></span>`;
  }
  const asset = officialTeamMarks[key];
  if (!asset) {
    return '<span class="team-logo" aria-hidden="true"><i class="team-logo-fallback"></i></span>';
  }
  return `<span class="team-logo" aria-hidden="true"><img src="assets/teams/official/${asset}" alt="" width="24" height="24"></span>`;
}

// Grand Prix Flag Resolution
const COUNTRY_FLAG_CODES = Object.freeze({
  australia: 'AU', austria: 'AT', azerbaijan: 'AZ', bahrain: 'BH', belgium: 'BE',
  brazil: 'BR', canada: 'CA', china: 'CN', france: 'FR', germany: 'DE',
  'great britain': 'GB', hungary: 'HU', india: 'IN', italy: 'IT', japan: 'JP',
  korea: 'KR', malaysia: 'MY', mexico: 'MX', monaco: 'MC', netherlands: 'NL',
  portugal: 'PT', qatar: 'QA', russia: 'RU', 'saudi arabia': 'SA', singapore: 'SG',
  'south korea': 'KR', spain: 'ES', turkey: 'TR', 'united arab emirates': 'AE',
  'united kingdom': 'GB', 'united states': 'US', usa: 'US',
});

const GRAND_PRIX_FLAG_RULES = Object.freeze([
  ['70th anniversary', 'GB'], ['abu dhabi', 'AE'], ['australian', 'AU'], ['austrian', 'AT'],
  ['azerbaijan', 'AZ'], ['bahrain', 'BH'], ['belgian', 'BE'], ['brazilian', 'BR'],
  ['british', 'GB'], ['canadian', 'CA'], ['chinese', 'CN'], ['dutch', 'NL'],
  ['eifel', 'DE'], ['emilia romagna', 'IT'], ['european', 'AZ'], ['french', 'FR'],
  ['german', 'DE'], ['hungarian', 'HU'], ['indian', 'IN'], ['italian', 'IT'],
  ['japanese', 'JP'], ['korean', 'KR'], ['las vegas', 'US'], ['malaysian', 'MY'],
  ['mexico', 'MX'], ['miami', 'US'], ['monaco', 'MC'], ['pacific', 'JP'],
  ['portuguese', 'PT'], ['qatar', 'QA'], ['russian', 'RU'], ['sakhir', 'BH'],
  ['san marino', 'IT'], ['saudi arabian', 'SA'], ['singapore', 'SG'], ['sao paulo', 'BR'],
  ['spanish', 'ES'], ['styrian', 'AT'], ['turkish', 'TR'], ['tuscan', 'IT'],
  ['united states', 'US'],
]);

function grandPrixCountryCode(event) {
  if (typeof window.grandPrixCountryCode === 'function') {
    return window.grandPrixCountryCode(event);
  }
  const country = String(event?.country || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const eventName = String(event?.name || event || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return COUNTRY_FLAG_CODES[country]
    || GRAND_PRIX_FLAG_RULES.find(([name]) => eventName.includes(name))?.[1];
}

function gpFlagMarkup(eventName) {
  const code = grandPrixCountryCode(eventName);
  if (!code) return '';
  return `<img class="gp-flag" src="assets/flags/${code.toLowerCase()}.svg" alt="${code}" width="22" height="16">`;
}

function eventLabel(eventName) {
  const flag = gpFlagMarkup(eventName);
  return `<span class="performance-event-cell">${flag}<span>${escape(eventName)}</span></span>`;
}

const teamLabel = team => {
  const t = typeof team === 'object' && team !== null ? team : { team: String(team || '') };
  const teamName = t.displayName || t.team || t.name || '';
  const teamColor = t.color ? color(t.color) : 'var(--text-main)';
  return `
  <div class="performance-team" style="--team-color:${teamColor}">
    ${teamLogoMarkup(t.logoTeam || t.team || teamName)}
    <span class="team-dot" style="background-color:${teamColor}"></span>
    <span class="team-name">${escape(teamName)}</span>
  </div>`;
};

function rebase(rows, keys) {
  for(const key of keys) {
    const values=rows.map(row=>row[key]).filter(finite);
    if(!values.length)continue;
    const best=Math.min(...values);
    for(const row of rows)if(finite(row[key]))row[key]=Math.max(0,((100+row[key])/(100+best)-1)*100);
  }
  return rows;
}

function computeBrakingPerformance(teams) {
  const validTeams = (teams || []).filter(t => t && (t.team || t.name));
  const scores=validTeams.map(t=>t.score).filter(finite);
  const baseline=scores.length?Math.min(...scores):null;
  return validTeams.map(t=>({
    ...t,
    score:finite(t.score)&&finite(baseline)?100*Math.expm1(Math.max(0,t.score-baseline)/100):null,
    g:finite(t.g)?t.g:null,
    meanG:finite(t.meanG)?t.meanG:null,
    powerProxy:finite(t.powerProxy)?t.powerProxy:null,
    distance:finite(t.distance)?t.distance:null,
    duration:finite(t.duration)?t.duration:null,
    normalizedDecel:finite(t.normalizedDecel)?t.normalizedDecel:null,
    samplingResolution:finite(t.samplingResolution)?t.samplingResolution:null,
    timeDelta:finite(t.timeDelta)?t.timeDelta:null,
    distDelta:finite(t.distDelta)?t.distDelta:null,
    onsetBracket:t.onsetBracket||null
  }));
}

function computeStraightlinePerformance(teams) {
  const validTeams = (teams || []).filter(t => t && (t.team || t.name));
  if (!validTeams.length) return [];
  const matchedVals = validTeams.map(t => t.matchedSpeed || t.speed_st).filter(finite);
  const peakVals = validTeams.map(t => t.peakSpeed || t.top_speed || t.peak).filter(finite);
  const flVals = validTeams.map(t => t.finishLineSpeed || t.speed_fl).filter(finite);
  const sustainedVals = validTeams.map(t => t.sustainedSpeed || t.full_throttle_p95 || t.sustained).filter(finite);
  const terminalVals = validTeams.map(t => t.terminalZoneMeanSpeed || t.terminal_zone_mean_speed).filter(finite);
  const gapVals = validTeams.map(t => finite(t.accel250) ? t.accel250 : (finite(t.accel_250_300) ? t.accel_250_300 : (t.straightGap || t.straight_deficit))).filter(finite);

  const bestMatched = matchedVals.length ? Math.max(...matchedVals) : 310;
  const bestPeak = peakVals.length ? Math.max(...peakVals) : 330;
  const bestFL = flVals.length ? Math.max(...flVals) : 295;
  const bestSustained = sustainedVals.length ? Math.max(...sustainedVals) : 325;
  const bestTerminal = terminalVals.length ? Math.max(...terminalVals) : 315;
  const minGap = gapVals.length ? Math.min(...gapVals) : 0;

  return validTeams.map(t => {
    const matched = finite(t.matchedSpeed) ? t.matchedSpeed : (finite(t.speed_st) ? t.speed_st : null);
    const peak = finite(t.peakSpeed) ? t.peakSpeed : (finite(t.top_speed) ? t.top_speed : (finite(t.peak) ? t.peak : null));
    const fl = finite(t.finishLineSpeed) ? t.finishLineSpeed : (finite(t.speed_fl) ? t.speed_fl : null);
    const sustained = finite(t.sustainedSpeed) ? t.sustainedSpeed : (finite(t.full_throttle_p95) ? t.full_throttle_p95 : (finite(t.sustained) ? t.sustained : null));
    const terminal = finite(t.terminalZoneMeanSpeed) ? t.terminalZoneMeanSpeed : (finite(t.terminal_zone_mean_speed) ? t.terminal_zone_mean_speed : null);
    const termLen = finite(t.terminalZoneLength) ? t.terminalZoneLength : (finite(t.terminal_zone_length_m) ? t.terminal_zone_length_m : null);
    const accel250 = finite(t.accel250) ? t.accel250 : (finite(t.accel_250_300) ? t.accel_250_300 : null);
    const gap = finite(accel250) ? accel250 : (finite(t.straightGap) ? t.straightGap : (finite(t.straight_deficit) ? t.straight_deficit : 0));

    return {
      ...t,
      matchedSpeed: matched,
      peakSpeed: peak,
      finishLineSpeed: fl,
      sustainedSpeed: sustained,
      terminalZoneMeanSpeed: terminal,
      terminalZoneLength: termLen,
      accel250: accel250,
      straightGap: gap
    };
  });
}

// ---------------------------------------------------------------------------
// Visual Apple UI Horizontal Bar Graph Component
// ---------------------------------------------------------------------------
function renderHorizontalBarChart(rows, {
  title = '',
  subtitle = '',
  valueKey = 'value',
  labelKey = 'team',
  colorKey = 'color',
  unit = '%',
  digits = 3,
  signedValue = true,
  zeroBaseline = true,
  preserveSignedValues = false,
  invertBest = false // if true, higher value is ranked first
} = {}) {
  const validRows = (rows || []).filter(r => r && finite(r[valueKey])).map(r => ({ ...r }));
  if (!validRows.length) return '';

  let minVal = Math.min(...validRows.map(r => r[valueKey]));
  let maxVal = Math.max(...validRows.map(r => r[valueKey]));

  // For gap/deficit metrics (signedValue = true), rebase so the best car is 0.000% baseline (no negative numbers)
  if (signedValue && !preserveSignedValues) {
    const bestVal = invertBest ? maxVal : minVal;
    for (const r of validRows) {
      r._chartVal = Math.max(0, invertBest ? bestVal - r[valueKey] : r[valueKey] - bestVal);
    }
    validRows.sort((a, b) => a._chartVal - b._chartVal);
  } else {
    for (const r of validRows) {
      r._chartVal = r[valueKey];
    }
    validRows.sort((a, b) => invertBest ? b._chartVal - a._chartVal : a._chartVal - b._chartVal);
  }

  const chartVals = validRows.map(r => r._chartVal);
  const chartMin = Math.min(...chartVals);
  const chartMax = Math.max(...chartVals);

  // Scale starts from 0 baseline on the left
  const lo = zeroBaseline ? Math.min(0, chartMin) : chartMin;
  const hi = Math.max(lo + 0.001, chartMax, preserveSignedValues ? 0 : -Infinity);
  const span = Math.max(0.0001, hi - lo);
  const zeroPosition = (-lo / span) * 100;

  const rowsHtml = validRows.map(r => {
    const val = r._chartVal;
    const clr = color(r[colorKey]);

    const valuePosition = ((val - lo) / span) * 100;
    const barLeft = preserveSignedValues ? Math.min(zeroPosition, valuePosition) : 0;
    const barWidth = preserveSignedValues
      ? Math.abs(valuePosition - zeroPosition)
      : Math.min(100, Math.max(val > 0.00001 ? 2 : 0, valuePosition));
    const displayStr = preserveSignedValues ? signed(val, digits, unit) : signedValue
      ? (val <= 0.00001 ? fmt(0, digits, unit) : `+${fmt(val, digits, unit)}`)
      : fmt(val, digits, unit);
    const gainClass = signedValue
      ? (preserveSignedValues ? val < 0 ? 'is-gain' : 'is-loss' : val <= 0.00001 ? 'is-gain' : 'is-loss')
      : '';
    const rowTitle = escape(r[labelKey] || r.team || r.name || '');

    return `
      <div class="performance-bar-row" title="${rowTitle}: ${displayStr}">
        <div class="performance-bar-label">${teamLabel(r)}</div>
        <div class="performance-bar-track">
          ${preserveSignedValues ? `<i class="performance-zero" style="left:${zeroPosition.toFixed(2)}%"></i>` : ''}
          <i class="performance-bar" style="--bar-color:${clr};left:${barLeft.toFixed(2)}%;width:${barWidth.toFixed(2)}%;"></i>
        </div>
        <span class="performance-bar-val ${gainClass}">${displayStr}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="performance-chart-card">
      ${title ? `
      <div class="perf-chart-header">
        <div class="perf-chart-title-group">
          <h4 class="perf-chart-heading">${escape(title)}</h4>
          ${subtitle ? `<span class="perf-chart-sub">${escape(subtitle)}</span>` : ''}
        </div>
      </div>` : ''}
      <div class="performance-bars">
        ${rowsHtml}
      </div>
    </div>
  `;
}

function lapShareChart(rows, key, reference) {
  const available = (rows || []).filter(r => finite(r[key])).map(r => ({ ...r }));
  if (!available.length) return '';
  const minVal = Math.min(...available.map(r => r[key]));

  // Rebase so that the fastest car is exactly 0.000% (baseline 0, no negative numbers)
  for (const r of available) {
    r._rebased = Math.max(0, r[key] - minVal);
  }
  available.sort((a, b) => a._rebased - b._rebased);
  const bestTeam = available[0]?.team || reference || 'Fastest team';
  const hi = Math.max(0.01, ...available.map(r => r._rebased));

  return `<div class="performance-chart-card">
    <div class="perf-chart-header">
      <div class="perf-chart-title-group">
        <h4 class="perf-chart-heading">Cornering Time Deficit (% of Lap)</h4>
        <span class="perf-chart-sub">Baseline (0.000%): <strong>${escape(bestTeam)}</strong> · Lower deficit is faster</span>
      </div>
    </div>
    <div class="performance-bars">
      ${available.map(r => {
        const val = r._rebased;
        const barWidth = Math.min(100, Math.max(val > 0.0001 ? 2 : 0, (val / hi) * 100));
        const displayStr = val <= 0.0001 ? '0.000%' : `+${val.toFixed(3)}%`;
        const gainClass = val <= 0.0001 ? 'is-gain' : 'is-loss';
        return `<div class="performance-bar-row" title="${escape(r.team)}: ${displayStr}">
          <div class="performance-bar-label">${teamLabel(r)}</div>
          <div class="performance-bar-track">
            <i class="performance-bar" style="--bar-color:${color(r.color)};left:0;width:${barWidth.toFixed(2)}%;"></i>
          </div>
          <span class="performance-bar-val ${gainClass}">${displayStr}</span>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

async function get(path, signal, cache='no-store') {
  const response=await fetch(`${String(window.APEX_API_ORIGIN || '').replace(/\/$/,'')}${path}`, {signal,cache});
  const payload=await response.json();
  if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : `Request failed (${response.status})`);
  return payload;
}

function completed(event, session) {
  const start=Date.parse(event.session_dates?.[session] || '');
  return Number.isFinite(start) && start+4*3600000 < Date.now();
}

function syncSelect(select) {
  if (!select) return;
  const shell = select.closest('.select-shell');
  if (shell && shell.dataset.enhanced !== 'true' && typeof window.enhanceSelect === 'function') {
    window.enhanceSelect(select);
  }
  if (typeof window.syncSelectUI === 'function') {
    window.syncSelectUI(select);
  }
}

let initialized=false, calendar=[], calendarController, controller, pitController, generation=0;
let events=[], errors=[], activeMetric='pace', running=false, traceRunning=false, sortKey='qualy', sortDirection=1;
let pitRunning=false;
let activeScope='season'; // 'season' | 'tracks'
let selectedTracks=new Set();
let context=null;
let tyreView='OVERALL';
let tyreMetric='age'; // 'age' | 'relative'
let tyreSubject='team'; // 'team' | 'driver'
let pitSubject='team'; // 'team' | 'driver'
let pitMeasure='stop'; // 'stop' | 'lane'
let pitChartMetric='median'; // 'mean' | 'median' | 'spread'
let pitLaneBasis='raw'; // 'raw' | 'event'
let paceSeasonStat='mean'; // 'mean' | 'median'
let telemetrySeasonStat='mean'; // 'mean' | 'median'
let cornerGraphBand='all';
let raceCornerRunning=false,raceCornerController=null;
const raceCornerCache=new Map();
function cornerBandControls() {
  return `<div class="performance-scope-toggle" role="group" aria-label="Corner speed type">${[['all','All corners'],['low','Low-speed'],['medium','Medium-speed'],['high','High-speed']].map(([key,label])=>`<button type="button" data-corner-band="${key}" aria-pressed="${cornerGraphBand===key}">${label}</button>`).join('')}</div>`;
}

async function loadRaceCorners() {
  if(raceCornerRunning||!context)return;
  const id=generation,year=context.year;
  raceCornerController=new AbortController();const signal=raceCornerController.signal;
  raceCornerRunning=true;render();
  try {
    for(const event of events.filter(e=>e.R)){
      const key=year+':'+event.name;if(raceCornerCache.get(key)?.observations?.length)continue;
      updateStatus(`Race cornering · matching laps at ${event.name}…`,true);
      const observations=[];
      try {
        const q=new URLSearchParams({year,gp:event.name,round:event.round,session:'R',fresh:'true'});
        const session=await get('/api/session?'+q,signal);
        const preferred=Object.fromEntries((event.R.teams||[]).map(t=>[t.team,t.fastest_race_driver]));
        const groups=raceCornerGroups(session,preferred);
        for(const group of groups){
          const entries=[],jobs=[...group.rows];
          async function worker(){while(jobs.length&&!signal.aborted){const row=jobs.shift(),params=new URLSearchParams(q);
            params.set('driver',row.driver.code);params.set('driver_number',row.driver.number);params.set('lap',row.lap);
            params.set('lap_time',row.time);params.set('lap_start_seconds',row.lap_start_seconds);params.set('lap_end_seconds',row.lap_end_seconds);
            if(session.openf1_session_key)params.set('session_key',session.openf1_session_key);
            updateStatus(`Race cornering · ${event.name} · lap ${group.lap} · ${row.driver.code}`,true);
            try{entries.push({row,payload:await get('/api/telemetry?'+params,signal)});}catch(error){if(signal.aborted)throw error;}
          }}
          await Promise.all([worker(),worker()]);
          const qualifyingTrace=Object.values(event.traces||{}).find(t=>t.corners?.length&&finite(t.lap_distance));
          let fallbackMarkers=qualifyingTrace?.corners?.map(c=>({fraction:c.apex_distance/qualifyingTrace.lap_distance}))||[];
          if(!fallbackMarkers.length && /sepang|kuala lumpur/i.test(session.location||'') && entries.length && typeof window.projectSepangCorners==='function')
            fallbackMarkers=window.projectSepangCorners(entries[0].payload.samples);
          observations.push(...measureRaceCornerGroup(entries,fallbackMarkers));
        }
        if(id!==generation||signal.aborted)return;
        raceCornerCache.set(key,{observations,groups:groups.length});
      } catch(error){if(signal.aborted)break;raceCornerCache.set(key,{observations:[],error:error.message});}
      render();
    }
  } finally {
    raceCornerRunning=false;
    if(id!==generation)return;
    updateStatus(signal.aborted?'Race cornering stopped; completed observations retained.':'Race cornering finished. These are matched observations, not a pure car/downforce rating.');
    render();
  }
}

function renderRaceCorners() {
  const pending=events.filter(e=>e.R&&!raceCornerCache.get(context.year+':'+e.name)?.observations?.length);
  const reports=events.filter(e=>e.R).map(event=>{
    const observations=raceCornerCache.get(context.year+':'+event.name)?.observations||[],rows=new Map();
    const snapshots=[...new Set(observations.map(o=>o.lap+':'+o.compound))].map(key=>({event:{name:key},summary:{rows:new Map(observations.filter(o=>o.lap+':'+o.compound===key).map(o=>[o.team,o]))}}));
    const matched=Object.fromEntries(['all','low','medium','high'].map(band=>[band,eventAdjustedScores(snapshots,row=>row.values[band],telemetrySeasonStat,'common')]));
    for(const team of [...new Set(observations.map(o=>o.team))]){
      const own=observations.filter(o=>o.team===team),values={};
      for(const band of ['all','low','medium','high'])values[band]=matched[band].get(team);
      rows.set(team,{team,color:own[0].color,values,samples:own.length,drivers:[...new Set(own.map(o=>o.driver))].join(', ')});
    }
    return {event,summary:{rows}};
  });
  const adjusted=eventAdjustedScores(reports,row=>row.values[cornerGraphBand],telemetrySeasonStat,'common');
  const teams=new Map();
  for(const {event,summary} of reports)for(const row of summary.rows.values()){
    if(!teams.has(row.team))teams.set(row.team,{...row,events:0,samples:0});
    const t=teams.get(row.team);t.events++;t.samples+=row.samples;
  }
  const rows=[...teams.values()].map(t=>({...t,gap:adjusted.get(t.team)}));
  const actions=raceCornerRunning?'<button type="button" data-race-corners-stop>Stop race cornering</button>':`<button type="button" data-race-corners-load ${pending.length?'':'disabled'}>${rows.length?'Load remaining race observations':'Calculate matched race corners'}</button>`;
  const support=adjusted.coverage;
  const controls=`<div class="performance-scope-toggle" role="group" aria-label="Race cornering GP summary"><button type="button" data-telemetry-stat="mean" aria-pressed="${telemetrySeasonStat==='mean'}">Mean across GPs</button><button type="button" data-telemetry-stat="median" aria-pressed="${telemetrySeasonStat==='median'}">Median across GPs</button></div><p class="performance-note">${support?`Ranking: ${support.teams.map(escape).join(', ')} · ${support.events.length} shared GP${support.events.length===1?'':'s'} (${support.events.map(escape).join(', ')}).`:'No complete shared ranking cohort is available yet.'} Table counts show collected laps and GPs, not necessarily ranking support. Teams outside the shared cohort remain unranked.</p>`;
  return card('Race cornering · matched observations','Provisional. Up to four green-flag snapshots per GP; same race lap and compound, tyre ages within four laps. Pit laps, wet laps, laps over 107% of stint median and close traffic at the timing line are excluded. Traffic between timing lines, setup and tyre-condition differences remain unknown. No fuel or tyre-wear correction is invented.',
    cornerBandControls()+controls+`<div class="performance-actions">${actions}</div>`+
    '<p class="performance-note">The graph is extra seconds per corner, averaged within each GP and then across supported GPs. All corners is the default; low/medium/high use the same field-median corner classification. Windows include entry, apex and exit. Distance is registered with official sectors, so results are approximate. Only observed matched cohorts enter; missing teams are not assigned zero.</p>'+
    renderHorizontalBarChart(rows.filter(r=>finite(r.gap)),{title:`${cornerGraphBand==='all'?'All corners':cornerGraphBand+'-speed corners'} · average time gap per corner`,valueKey:'gap',unit:' s',digits:3,signedValue:true,zeroBaseline:true})+
    table([sortHeader('raceCornerTeam','Team'),sortHeader('raceCornerGap','Average gap / corner'),sortHeader('raceCornerGPs','GPs',-1),sortHeader('raceCornerSamples','Matched laps',-1)],sorted(rows,{raceCornerTeam:r=>r.team,raceCornerGap:r=>r.gap,raceCornerGPs:r=>r.events,raceCornerSamples:r=>r.samples},'raceCornerGap').map(r=>[teamLabel(r),signed(r.gap,3,' s'),r.events,r.samples]))+
    `<details class="performance-evidence"><summary>Measured race snapshots and missing data</summary>${table(['GP','Team','Driver / lap','Compound','Corners'],reports.flatMap(({event})=>(raceCornerCache.get(context.year+':'+event.name)?.observations||[]).map(o=>[escape(event.name),escape(o.team),`${escape(o.driver)} L${o.lap}`,escape(o.compound),o.corners])))}<p>${reports.filter(r=>raceCornerCache.has(context.year+':'+r.event.name)&&!r.summary.rows.size).map(r=>escape(r.event.name)+' · insufficient matched clean telemetry').join('<br>')||''}</p></details>`);
}
let telemetryCoverageMode='common';
let tyreSeasonStat='median'; // 'mean' | 'median' | 'p75'
let tyreLapMode='all'; // 'all' | 'clear'
let tyreConditionMode='screened';
let pitVisitMode='service';
let brakingQualityMode='supported';
let tyreCorrection='fuel'; // 'fuel' | 'raw'
let tyreFuelRate=.060; // User-selected sensitivity assumption, not measured fuel.
let tyreWeighting='balanced'; // 'balanced' | 'laps'
let tyreRunKey='';
let tyrePlotTeam='',tyrePlotDriver='',tyrePlotEvent='';
let resultsChartMetric='points'; // 'points' | 'perStart' | 'finishRate' | 'mechanicalRate'
let trendView='observed'; // 'observed' | 'fitted'
let straightLineSource='qualy'; // 'qualy' | 'race'
let brakingView='approach'; // 'approach' | 'deceleration'
let showPerformanceDescriptions=false;
function brakingViewControls(approachAvailable) {
  return `<p class="performance-note">Both views use each team’s fastest qualifying lap across Q1/Q2/Q3, the same zones and the same teams. No repeat averaging or slower-lap replacement. Time through approach includes arrival and end speed; same-speed slowing times only the shared speed drop. Check the boundary speeds before attributing an advantage to braking strength.</p><div class="performance-scope-toggle" role="group" aria-label="Braking measurement">
    <button type="button" data-braking-view="approach" aria-pressed="${brakingView==='approach'}" ${approachAvailable?'':'disabled'}>Time through approach</button>
    <button type="button" data-braking-view="deceleration" aria-pressed="${brakingView==='deceleration'}">Same-speed slowing</button>
  </div><div class="performance-scope-toggle" role="group" aria-label="Braking evidence quality"><button type="button" data-braking-quality="supported" aria-pressed="${brakingQualityMode==='supported'}">Supported samples</button><button type="button" data-braking-quality="all" aria-pressed="${brakingQualityMode==='all'}">Include provisional · diagnostic</button></div><p class="performance-quality-status">${brakingQualityMode==='supported'?'Only supported native observations enter the ranking.':'Diagnostic ranking includes weak-resolution observations.'} Braking always uses common paired observations, including in coverage-adjusted mode. Three decimals are estimated timings, not guaranteed millisecond accuracy.</p>`;
}
const STRAIGHT_BANDS=['50_100','100_150','150_200','200_250','250_300','300_320','300_350','350_400'];
let straightBand='250_300';
let straightGapUnit='percent';
function straightGapControls() {
  return `<div class="performance-band-options" role="group" aria-label="Straight-section gap units"><button type="button" data-straight-unit="percent" aria-pressed="${straightGapUnit==='percent'}">Percent of lap</button><button type="button" data-straight-unit="seconds" aria-pressed="${straightGapUnit==='seconds'}">Seconds</button></div><p class="performance-note">Across a season these are different averages over the same supported GPs: percent averages each gap divided by that GP’s reference lap time; seconds averages the actual gaps. Long laps influence seconds more, so spacing or ranking may change. For one GP it is a direct conversion.</p>`;
}
function straightBandControls(available) {
  if(!available.includes(straightBand)) straightBand=available.includes('250_300')?'250_300':available[0]||'250_300';
  return `<div class="performance-band-options" role="group" aria-label="Acceleration speed range">${STRAIGHT_BANDS.map(key=>`<button type="button" data-straight-band="${key}" aria-pressed="${key===straightBand}" ${available.includes(key)?'':'disabled title="Fewer than three teams have comparable clean acceleration through this full range"'}>${key.replace('_','–')} <span>km/h</span></button>`).join('')}</div><p class="performance-band-hint">A range needs three comparable teams that actually crossed both speeds. Below 150 km/h includes traction-limited exits.</p>`;
}
let qualyPaceMode='overall'; // 'overall' | 'q1' | 'adjusted'
const root=$('performanceResults');

function updateTrackCount() {
  const countEl = $('performanceTrackCount');
  if (countEl) {
    const n = selectedTracks.size;
    countEl.textContent = `${n} track${n === 1 ? '' : 's'} selected`;
  }
  const loadBtn = $('performanceLoad');
  if (loadBtn) {
    loadBtn.disabled = !calendar.length || (activeScope === 'tracks' && selectedTracks.size === 0);
  }
}

function renderTrackPills() {
  const container = $('performanceTrackPills');
  if (!container) return;
  if (!calendar.length) {
    container.innerHTML = '<span class="performance-note" style="margin:0;">No completed qualifying sessions available.</span>';
    updateTrackCount();
    return;
  }
  container.innerHTML = calendar.map(e => {
    const code = grandPrixCountryCode(e);
    const flagHtml = code ? `<img class="gp-flag" src="assets/flags/${code.toLowerCase()}.svg" alt="${code}" width="18" height="13">` : '';
    const isSelected = selectedTracks.has(e.name);
    return `<button type="button" class="track-pill" data-track-name="${escape(e.name)}" aria-pressed="${isSelected}">
      ${flagHtml}
      <span class="track-round">R${e.round}</span>
      <span class="track-name">${escape(e.name)}</span>
    </button>`;
  }).join('');
  updateTrackCount();
}

async function loadCalendar() {
  calendarController?.abort(); calendarController=new AbortController();
  const signal=calendarController.signal;
  $('performanceLoad').disabled=true;
  if ($('performanceEvent')) {
    $('performanceEvent').innerHTML='<option>Loading calendar…</option>';
    syncSelect($('performanceEvent'));
  }
  try {
    calendar=await get(`/api/events?year=${$('performanceYear').value}`,signal);
    calendar=calendar.filter(e=>completed(e,'Qualifying'));
    if ($('performanceEvent')) {
      $('performanceEvent').innerHTML=calendar.map(e=>{
        const country = grandPrixCountryCode(e) || '';
        return `<option value="${escape(e.name)}" data-country="${country}">R${e.round} · ${escape(e.name)}</option>`;
      }).join('');
      $('performanceEvent').value=calendar.at(-1)?.name || '';
      syncSelect($('performanceEvent'));
    }
    renderTrackPills();
    updateStatus(calendar.length ? 'Ready. Data loads only when you choose Analyse.' : 'No completed qualifying sessions available for this season.');
    updateTrackCount();
  } catch(e) {
    if(signal.aborted) return;
    updateStatus(`Calendar unavailable: ${e.message}. Change season to retry.`);
    if ($('performanceEvent')) {
      $('performanceEvent').innerHTML='<option>Calendar unavailable</option>';
      syncSelect($('performanceEvent'));
    }
  }
}

function updateStatus(msg, isRunning = false) {
  const el = $('performanceStatus');
  const card = $('performanceStatusCard');
  if (el) el.textContent = msg;
  if (card) card.classList.toggle('is-running', isRunning);
}

function stop() {
  raceCornerController?.abort();
  controller?.abort(); pitController?.abort(); generation++; running=false; traceRunning=false; pitRunning=false;
  $('performanceCancel').hidden=true;
  $('performanceLoad').hidden=false;
  $('performanceLoad').disabled=!calendar.length;
  updateStatus('Stopped. Completed results remain visible.', false);
  render();
}

function reset() {
  stop(); events=[]; errors=[]; context=null; root.replaceChildren();
  updateStatus('Selection changed. Choose Analyse to load fresh results.', false);
  render();
}

async function analyse() {
  raceCornerController?.abort();
  controller?.abort(); pitController?.abort(); pitRunning=false; controller=new AbortController(); const signal=controller.signal, id=++generation;
  events=[]; errors=[]; running=true;
  const isSeason = activeScope === 'season';
  const picked = isSeason
    ? [...calendar]
    : calendar.filter(e => selectedTracks.has(e.name));

  context = {
    year: $('performanceYear').value,
    scope: activeScope,
    season: isSeason || picked.length > 1,
    singleTrack: picked.length === 1,
    selectedTracks: [...selectedTracks]
  };

  const jobs=picked.flatMap(event=>['Q','R'].filter(s=>s==='Q'||completed(event,'Race')).map(session=>({event,session})));
  const total=jobs.length;
  let done=0;
  $('performanceLoad').disabled=true; $('performanceLoad').hidden=true; $('performanceCancel').hidden=false;
  updateStatus(`Analysing ${context.year} · starting session retrieval…`, true);
  render();
  // Pit timing is independent of qualifying/race laps and telemetry. Fetch it
  // immediately when that view is open, rather than waiting for every trace.
  if(activeMetric==='pits') loadPitData();

  async function worker() {
    while(jobs.length && !signal.aborted) {
      const job=jobs.shift();
      updateStatus(`Analysing ${context.year} · ${done}/${total} session results received · ${job.event.name}`, true);
      try {
        const params=new URLSearchParams({year:context.year,gp:job.event.name,session:job.session});
        const data=await get(`/api/performance?${params}`,signal);
        if(id!==generation) return;
        let item=events.find(e=>e.name===job.event.name);
        if(!item) { item={...job.event,traces:{}}; events.push(item); }
        item[job.session]=data;
      } catch(e) { if(signal.aborted) return; errors.push({...job,message:e.message}); }
      done++; render();
    }
  }

  await Promise.all([worker(),worker()]);
  if(id!==generation) return;

  const traceJobs=events.filter(event=>event.Q?.teams?.some(team=>team.telemetry_candidates?.length));
  let tracesDone=0;
  traceRunning=true;

  async function traceWorker() {
    while(traceJobs.length&&!signal.aborted) {
      const event=traceJobs.shift();
      updateStatus(`Analysing telemetry · ${tracesDone}/${events.length} circuits complete · ${event.name}`, true);
      const selections=event.Q.teams.flatMap(team=>(team.telemetry_candidates||[]).map((lap,i)=>({
        team:`${team.team}:${i}`,team_name:team.team,driver_number:lap.number,
        driver:lap.driver,lap:lap.lap,start:lap.start,end:lap.end,time:lap.time,sectors:lap.sectors,
        speed_st:lap.speed_st,speed_fl:lap.speed_fl,compound:lap.compound,phase:lap.phase
        ,qualifying_best_time:team.lap?.time,qualifying_best_driver:team.lap?.driver,qualifying_best_lap:team.lap?.lap
      })));
      try {
        const params=new URLSearchParams({year:context.year,gp:event.name,windows:JSON.stringify(selections)});
        const result=await get(`/api/performance/trace-batch?${params}`,signal);
        if(id!==generation)return;
        event.traces=result.teams||{};
        event.nativeSpeedObservations=result.native_speed_observations||{};
        event.traceExcluded=result.excluded||{};
        event.traceReference=result.reference_team;
        event.brakingTraces=result.teams||{};
        if(result.braking_selection_policy!=='fastest-qualifying-lap-only') {
          // Compatibility with an older separate API: one window per team
          // prevents repeat averaging AND fallback to a slower qualifying lap.
          const fastest=event.Q.teams.flatMap(team=>{
            const lap=team.lap;
            if(!lap||!team.telemetry_candidates?.some(c=>c.driver===lap.driver&&c.lap===lap.lap&&Math.abs(c.time-lap.time)<.0005))return [];
            return [{team:team.team,team_name:team.team,driver_number:lap.number,driver:lap.driver,lap:lap.lap,
              start:lap.start,end:lap.end,time:lap.time,sectors:lap.sectors,compound:lap.compound,phase:lap.phase}];
          });
          event.brakingTraces={};
          if(fastest.length>=3) {
            const paired=await get(`/api/performance/trace-batch?${new URLSearchParams({year:context.year,gp:event.name,windows:JSON.stringify(fastest)})}`,signal);
            if(id!==generation)return;
            event.brakingTraces=paired.teams||{};
          }
        }
        for(const [team,trace] of Object.entries(event.traces)) {
          const brakingTrace=event.brakingTraces[team];
          trace.braking=brakingTrace?.braking||[];
          trace.braking_selection=brakingTrace?.braking_selection||brakingTrace?.selection;
          trace.braking_selection_policy='fastest-qualifying-lap-only';
          trace.braking_exclusion=brakingTrace?.braking_exclusion||(!trace.braking.length?
            'Fastest qualifying lap has no usable straight-braking measurement; no slower lap was substituted.':null);
        }
        if(result.error)errors.push({event,session:'T',message:result.error});
      } catch(e) {
        if(signal.aborted)return;
        errors.push({event,session:'T',message:e.message});
      }
      tracesDone++; render();
    }
  }

  await Promise.all([traceWorker(),traceWorker()]);
  if(id!==generation) return;
  traceRunning=false;
  running=false; $('performanceLoad').disabled=false; $('performanceLoad').hidden=false; $('performanceCancel').hidden=true;
  const analysedEvents=events.filter(e=>e.Q||e.R).length;
  updateStatus(`${context.year} · best qualifying lap · ${analysedEvents}/${picked.length} events with data${errors.length ? ` · ${errors.length} data requests unavailable` : ''}. Fresh retrieval complete.`, false);
  render();
  if(activeMetric==='pits') loadPitData();
}

async function loadPitData(retry=false) {
  if(pitRunning || !context) return;
  const picked=context.scope==='season'
    ? calendar
    : calendar.filter(e=>context.selectedTracks.includes(e.name));
  for(const event of picked.filter(e=>completed(e,'Race'))) {
    if(!events.some(e=>e.name===event.name)) events.push({...event,traces:{}});
  }
  if(retry) for(const event of events) delete event.pitError;
  const jobs=events.filter(e=>completed(e,'Race') && !e.pits && !e.pitError);
  if(!jobs.length) return;
  pitController?.abort(); pitController=new AbortController();
  const signal=pitController.signal, id=generation;
  pitRunning=true; render();
  async function worker() {
    while(jobs.length && !signal.aborted && id===generation) {
      const event=jobs.shift();
      try {
        const params=new URLSearchParams({year:context.year,gp:event.name,source:'dhl-2026-v1'});
        event.pits=await get(`/api/performance/pits?${params}&schema=2`,signal,'default');
      } catch(error) {
        if(signal.aborted) return;
        event.pitError=error.message;
      }
      if(id===generation) render();
    }
  }
  await Promise.all([worker(),worker(),worker()]);
  if(id===generation) {pitRunning=false;render();}
}

function qualifyingEvolutionSample(teams) {
  const dry=new Set(['SOFT','MEDIUM','HARD','HYPERSOFT','ULTRASOFT','SUPERSOFT','SUPERHARD']);
  const details=teams.flatMap(t=>(t.phase_details||[]).map(p=>({...p,team:t.team})))
    .filter(p=>finite(p.time)&&dry.has(String(p.compound).toUpperCase())&&p.rain!==true);
  const support=[...new Set(details.map(p=>p.compound))].map(compound=>({compound,
    count:Math.min(...['Q1','Q2','Q3'].map(phase=>new Set(details.filter(p=>p.compound===compound&&p.phase===phase).map(p=>p.driver)).size))}));
  const selected=support.sort((a,b)=>b.count-a.count||a.compound.localeCompare(b.compound))[0];
  return selected?.count>0?details.filter(p=>p.compound===selected.compound):[];
}

function aggregate() {
  const map=new Map();
  const eventQ1Deficits = new Map();
  const eventAdjDeficits = new Map();

  for (const e of events) {
    if (!e.Q?.teams) continue;
    const qTeams = e.Q.teams;
    
    // Q1 deficit (all teams present on identical green track)
    const q1Times = new Map();
    for (const t of qTeams) {
      const p1 = t.phase_details?.find(p => p.phase === 'Q1');
      if (p1 && finite(p1.time)) q1Times.set(t.team, p1.time);
    }
    const minQ1 = Math.min(...q1Times.values());
    const q1Map = new Map();
    if (finite(minQ1) && minQ1 > 0) {
      for (const [tm, tmTime] of q1Times.entries()) {
        q1Map.set(tm, Math.max(0, (tmTime / minQ1 - 1) * 100));
      }
    }
    eventQ1Deficits.set(e.name, q1Map);

    // Track evolution adjusted deficit (Q3 baseline)
    // Only compute deltas when dry, >= 6 common drivers, deltas in [-0.2, 1.5] s, and MAD <= 0.35 s
    const q1_d = new Map();
    const q2_d = new Map();
    const q3_d = new Map();
    const q1_tm = new Map();
    const q2_tm = new Map();
    const q3_tm = new Map();
    const isDryComp = c => ['SOFT','MEDIUM','HARD','HYPERSOFT','ULTRASOFT','SUPERSOFT','SUPERHARD'].includes(String(c).toUpperCase());
    const dryDetails=qualifyingEvolutionSample(qTeams);
    const matchedCompound=dryDetails[0]?.compound;

    for (const t of qTeams) {
      for (const p of (t.phase_details || [])) {
        if (!finite(p.time)) continue;
        const dry = isDryComp(p.compound)&&p.compound===matchedCompound&&p.rain!==true;
        if(!dry)continue;
        if (p.phase === 'Q1') {
          if (dry && p.driver) q1_d.set(p.driver, p.time);
          if (!q1_tm.has(t.team) || p.time < q1_tm.get(t.team)) q1_tm.set(t.team, p.time);
        } else if (p.phase === 'Q2') {
          if (dry && p.driver) q2_d.set(p.driver, p.time);
          if (!q2_tm.has(t.team) || p.time < q2_tm.get(t.team)) q2_tm.set(t.team, p.time);
        } else if (p.phase === 'Q3') {
          if (dry && p.driver) q3_d.set(p.driver, p.time);
          if (!q3_tm.has(t.team) || p.time < q3_tm.get(t.team)) q3_tm.set(t.team, p.time);
        }
      }
    }

    const deltas12 = [];
    for (const [drv, t1] of q1_d.entries()) {
      if (q2_d.has(drv)) {
        const d = t1 - q2_d.get(drv);
        if (d >= -0.2 && d <= 1.5) deltas12.push(d);
      }
    }
    const deltas23 = [];
    for (const [drv, t2] of q2_d.entries()) {
      if (q3_d.has(drv)) {
        const d = t2 - q3_d.get(drv);
        if (d >= -0.2 && d <= 1.5) deltas23.push(d);
      }
    }

    const med12 = deltas12.length ? median(deltas12) : null;
    const mad12 = (deltas12.length && finite(med12))
      ? median(deltas12.map(d => Math.abs(d - med12)))
      : null;
    const gate12Valid = deltas12.length >= 6 && finite(mad12) && mad12 <= 0.35;

    const med23 = deltas23.length ? median(deltas23) : null;
    const mad23 = (deltas23.length && finite(med23))
      ? median(deltas23.map(d => Math.abs(d - med23)))
      : null;
    const gate23Valid = deltas23.length >= 6 && finite(mad23) && mad23 <= 0.35;

    const evolutionValid = gate12Valid && gate23Valid;

    if (evolutionValid) {
      const ev12 = Math.max(0, med12);
      const ev23 = Math.max(0, med23);
      const adjTimes = new Map();
      for (const t of qTeams) {
        const tm = t.team;
        if (q3_tm.has(tm)) {
          adjTimes.set(tm, q3_tm.get(tm));
        } else if (q2_tm.has(tm)) {
          adjTimes.set(tm, q2_tm.get(tm) - ev23);
        } else if (q1_tm.has(tm)) {
          adjTimes.set(tm, q1_tm.get(tm) - ev12 - ev23);
        }
      }
      const minAdj = Math.min(...adjTimes.values());
      const adjMap = new Map();
      if (finite(minAdj) && minAdj > 0) {
        for (const [tm, tmTime] of adjTimes.entries()) {
          adjMap.set(tm, Math.max(0, (tmTime / minAdj - 1) * 100));
        }
      }
      eventAdjDeficits.set(e.name, adjMap);
    } else {
      eventAdjDeficits.set(e.name, null);
    }
  }

  for(const e of [...events].sort((a,b)=>a.round-b.round)) for(const session of ['Q','R']) {
    for(const t of e[session]?.teams || []) {
      if(!map.has(t.team)) {
        map.set(t.team,{
          team:t.team,color:t.color,q:[],r:[],
          sectors:[[],[],[]],idealSectors:[[],[],[]],idealGaps:[],
          q1Deficits:[],adjDeficits:[],
          points:0,pointsKnown:true,starts:0,finishes:0,mechanical:0,incidents:0,other:0,
          puRetirements:0,chassisRetirements:0,incidentRetirements:0,otherRetirements:0,unknownRetirements:0,
          positions:[],samples:0,coverage:[],stints:[],tyreAgeStints:[],results:0,
          fastestRaceDrivers:[],retirements:[],phaseDetails:[],raceDrivers:[],
          sampleTiers:[],sensitivityBrackets:[],provisionalFlags:[],fallbackFlags:[],
          trafficSensitivity:{'1.5s':[],'2.0s':[],'2.5s':[]},teammateSpreads:[],
          fieldNormalizedStints:[]
        });
      }
      const item=map.get(t.team);
      if(session==='Q') {
        item.q.push({
          round:e.round,event:e.name,pace:t.pace,
          paceDeltaS:t.pace_delta_s,
          idealPace:t.ideal_pace,
          idealPaceDeltaS:t.ideal_pace_delta_s,
          idealLapTime:t.ideal_lap_time,
          idealGapS:t.ideal_vs_complete_gap_s,
          idealCompound:t.ideal_compound,
          idealSectors:t.ideal_sectors,
          completedSectors:t.completed_sectors,
          lap:t.lap
        });
        item.phaseDetails.push(...(t.phase_details||[]).map(p=>({...p,event:e.name})));
        t.sector_deficits?.forEach((v,i)=>{if(finite(v))item.sectors[i].push(v);});
        t.ideal_sector_deficits?.forEach((v,i)=>{if(finite(v))item.idealSectors[i].push(v);});
        if (finite(t.ideal_vs_complete_gap_s)) item.idealGaps.push(t.ideal_vs_complete_gap_s);
        const q1Def = eventQ1Deficits.get(e.name)?.get(t.team);
        if (finite(q1Def)) item.q1Deficits.push(q1Def);
        const adjDef = eventAdjDeficits.get(e.name)?.get(t.team);
        if (finite(adjDef)) item.adjDeficits.push(adjDef);
      } else {
        item.r.push(t.pace);
        item.samples+=t.samples;
        if(t.sample_tier) item.sampleTiers.push(t.sample_tier);
        if(t.traffic_sensitivity_bracket) item.sensitivityBrackets.push(t.traffic_sensitivity_bracket);
        if(t.provisional) item.provisionalFlags.push(t.provisional);
        if(t.fallback_used) item.fallbackFlags.push(t.fallback_used);
        if(finite(t.traffic_coverage)) item.coverage.push(t.traffic_coverage);
        if(t.fastest_race_driver)item.fastestRaceDrivers.push(t.fastest_race_driver);
        item.points+=t.points; item.pointsKnown&&=t.points_known; item.starts+=t.starts; item.finishes+=t.finishes;
        item.mechanical+=t.mechanical;
        item.puRetirements+=(t.pu_retirements||0);
        item.chassisRetirements+=(t.chassis_retirements||0);
        item.incidentRetirements+=(t.incident_retirements||(t.incidents||0));
        item.otherRetirements+=(t.other_retirements||0);
        item.unknownRetirements+=(t.unknown_retirements||0);
        item.incidents+=t.incidents; item.other+=t.other_retirements;
        item.positions.push(...t.positions); item.results++;
        item.stints.push(...(t.degradation || []).map(s=>({
          ...s,
          event:e.name,
          relativeSlope: s.relative_slope ?? s.field_normalized_slope ?? null,
          usedStart: s.used_start ?? (finite(s.min_age) && s.min_age > 3),
          minAge:s.min_age,
          maxAge:s.max_age,
          ageSpan:s.age_span,
          matchedLaps:s.matched_laps,
          fieldSupport:s.field_support,
          lowSample:s.low_sample,
          cliffDetected:s.cliff_detected,
          cliffAge:s.cliff_age
        })));
        item.tyreAgeStints.push(...(t.tyre_age_stints||[]).map(s=>({
          ...s,event:e.name,round:e.round,
          compound_grade:verifiedDryGrade(context?.year,e.round,s.compound)
        })));
        item.retirements.push(...(t.retirements||[]).map(r=>({...r,event:e.name})));
        item.raceDrivers.push(...(t.race_drivers||[]).map(r=>({...r,event:e.name,selected:r.driver===t.fastest_race_driver})));
        const s15 = t.traffic_sensitivity?.['1.5s'] ?? t.traffic_sensitivity?.loose_15;
        const s20 = t.traffic_sensitivity?.['2.0s'] ?? t.traffic_sensitivity?.standard_20;
        const s25 = t.traffic_sensitivity?.['2.5s'] ?? t.traffic_sensitivity?.strict_25;
        if (finite(s15)) item.trafficSensitivity['1.5s'].push(s15);
        if (finite(s20)) item.trafficSensitivity['2.0s'].push(s20);
        if (finite(s25)) item.trafficSensitivity['2.5s'].push(s25);
        if (finite(t.teammate_spread)) item.teammateSpreads.push(t.teammate_spread);
      }
    }
  }
  return rebase([...map.values()].map(t=>({
    ...t,
    qualy:avg(t.q.map(q=>q.pace)),
    qualyQ1:avg(t.q1Deficits),
    qualyAdjusted:avg(t.adjDeficits),
    race:avg(t.r),
    paceDeltaS:t.q.length ? t.q.at(-1)?.paceDeltaS : null,
    idealGapS:t.idealGaps.length ? avg(t.idealGaps) : null,
    idealCompound:t.q.length ? t.q.at(-1)?.idealCompound : null,
    idealLapTime:t.q.length ? t.q.at(-1)?.idealLapTime : null,
    s1:avg(t.sectors[0]),s2:avg(t.sectors[1]),s3:avg(t.sectors[2]),
    idealS1:avg(t.idealSectors[0]),idealS2:avg(t.idealSectors[1]),idealS3:avg(t.idealSectors[2]),
    sampleTier:t.sampleTiers.at(-1) || 'normal',
    sensitivityBracket:events.filter(e=>e.R).length===1?(t.sensitivityBrackets.at(-1)||null):null,
    provisional:t.provisionalFlags.some(Boolean),
    fallbackUsed:t.fallbackFlags.some(Boolean),
    qCount:t.q.filter(q=>finite(q.pace)).length,
    rCount:t.r.filter(finite).length
  })),['qualy','qualyQ1','qualyAdjusted','race','s1','s2','s3','idealS1','idealS2','idealS3']);
}

function table(headers,rows) {
  return `<div class="performance-table-wrap"><table class="performance-table"><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row=>`<tr>${row.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" class="section-empty">No eligible data yet.</td></tr>`}</tbody></table></div>`;
}

function card(title,note,body) {
  return `<section class="dashboard-card performance-card">
    <div class="panel-heading">
      <h2>${title}</h2>
    </div>
    <p class="performance-note">${note}</p>
    ${body}
  </section>`;
}

function sortHeader(key,label,defaultDirection=1) {
  const isCurrent = sortKey === key;
  const arrow = isCurrent ? (sortDirection === 1 ? '▲' : '▼') : '⇅';
  return `<button class="perf-sort-btn ${isCurrent ? 'is-sorted' : ''}" data-performance-sort="${key}" data-sort-direction="${defaultDirection}" type="button"><span>${label}</span><i class="sort-icon" aria-hidden="true">${arrow}</i></button>`;
}

function sorted(items,getters,defaultKey,defaultDirection=1) {
  const key=getters[sortKey]?sortKey:defaultKey, direction=sortKey===key?sortDirection:defaultDirection;
  const value=getters[key];
  return [...items].sort((a,b)=>{
    const av=value(a),bv=value(b);
    if(finite(av)&&finite(bv))return (av-bv)*direction;
    if(finite(av))return -1;
    if(finite(bv))return 1;
    return String(av??'').localeCompare(String(bv??''))*direction;
  });
}

function renderPace(teams) {
  if (qualyPaceMode === 'q1') qualyPaceMode = 'adjusted';

  const regEnv = events[0]?.Q?.regulatory_energy_envelope || events[0]?.R?.regulatory_energy_envelope || events[0]?.regulatory_energy_envelope;
  const is2026 = (context?.year >= 2026) || (events[0]?.year >= 2026) || (regEnv && regEnv.year >= 2026);
  const regulatoryBadge = is2026 ? `
    <div class="perf-regulatory-badge">
      <div class="reg-title">⚡ 2026 regulations · active aerodynamics and stronger electrical deployment</div>
      <div class="reg-body">Public traces do not show each car’s active-aero position or ERS state. Straight-line results include those unknown choices.</div>
      <div class="reg-note">Event-specific limits are shown only after the exact FIA event document and session version are verified. <a href="https://www.fia.com/regulation/fia-formula-1-technical-regulations" target="_blank" rel="noopener">FIA regulations ↗</a></div>
    </div>
  ` : '';

  const qualyToggle = `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
      <div class="performance-scope-toggle" role="radiogroup" aria-label="Qualifying pace comparison mode">
        <button type="button" data-qualy-mode="overall" aria-pressed="${qualyPaceMode === 'overall'}">Overall Best Lap</button>
        <button type="button" data-qualy-mode="adjusted" aria-pressed="${qualyPaceMode === 'adjusted'}">Track-Evolution Adjusted</button>
      </div>
      <span class="perf-tercile-badge is-mid">${
        qualyPaceMode === 'overall'
          ? 'Peak Potential · Q1–Q3 Best Laps'
          : 'Normalized Q3 Baseline · Evolution-Adjusted'
      }</span>
    </div>
  `;

  const paceKey = qualyPaceMode === 'adjusted' ? 'qualyAdjusted' : 'qualy';
  const paceTeams=rebase(teams.map(t=>({...t,
    qualy:summarize(t.q.map(q=>q.pace),paceSeasonStat),
    qualyAdjusted:summarize(t.adjDeficits,paceSeasonStat),
    race:summarize(t.r,paceSeasonStat)
  })),['qualy','qualyAdjusted','race']);
  const ordered = sorted(paceTeams, {
    team: t => t.team,
    qualy: t => t.qualy,
    qualyAdjusted: t => t.qualyAdjusted,
    race: t => t.race,
    samples: t => t.samples
  }, paceKey);

  const chartMeta = qualyPaceMode === 'overall' ? {
    title: 'Qualifying Pace Deficit · Overall Best Lap',
    subtitle: 'Fastest official lap across Q1–Q3 per GP · season summary rebased to fastest team',
    note: 'Each GP uses each constructor’s single fastest valid lap across Q1–Q3 from either driver, compared with that GP’s pole lap. The selected season statistic is then rebased so the fastest supported team is 0.000%.'
  } : {
    title: 'Qualifying Pace Deficit · Track-Evolution Adjusted (% to Q3 Baseline)',
    subtitle: 'Same dry compound and advancing drivers · estimated Q1/Q2 evolution, not a measured correction',
    note: 'Estimates the shared improvement between qualifying phases from advancing drivers. Tyres, driver execution and changing conditions can also contribute; this is a diagnostic rather than an official lap result.'
  };

  const qualyChart = renderHorizontalBarChart(ordered, {
    title: chartMeta.title,
    subtitle: `${chartMeta.subtitle} · ${paceSeasonStat==='mean'?'Mean':'Median'} across GPs`,
    valueKey: paceKey,
    unit: '%',
    digits: 3
  });

  const raceChart = renderHorizontalBarChart(paceTeams.filter(t => finite(t.race)), {
    title: 'Estimated Race Pace Deficit (% to Benchmark)',
    subtitle: `Shared race-lap, compound and tyre-age model · ${paceSeasonStat==='mean'?'Mean':'Median'} GP estimate · Lower is faster`,
    valueKey: 'race',
    unit: '%',
    digits: 3
  });

  const qualyColLabel = qualyPaceMode === 'overall'
    ? 'Qualifying · Best lap'
    : 'Evolution-adjusted deficit';
  const raceSupport=`<details class="dashboard-card performance-methods"><summary>Race-pace coverage and traffic sensitivity by GP</summary><p class="performance-note">The traffic range refits the selected driver using 1.5, 2.0 and 2.5-second checkpoint screens. The common-cohort column keeps the same reference driver across those screens instead of changing the zero each time. These are sensitivity tests, not confidence intervals or a season-wide range. Leave-stint-out removes each of the three largest sampled stints and compares with one fixed reference driver; it can reveal strategy-dependent estimates but is not exhaustive. Noise gain measures sensitivity to perturbing observed lap times, not a confidence interval. Race-lap effects absorb shared fuel burn and track evolution; no measured fuel load is supplied.</p>${table(['Team','Grand Prix','Driver','Race laps covered','Stints','Compounds','Traffic-screen range','Common-cohort contrasts · 1.5 / 2.0 / 2.5 s','Leave-stint-out','Contrast noise gain'],teams.flatMap(t=>t.raceDrivers.filter(r=>r.selected).map(r=>{
    const result=events.find(e=>e.name===r.event)?.R?.teams?.find(row=>row.team===t.team);
    const range=result?.traffic_sensitivity_bracket;
    const model=r.model_diagnostics||result?.race_model_diagnostics||{};
    const common=result?.traffic_common_cohort;
    return [teamLabel(t),eventLabel(r.event),escape(r.driver),r.race_lap_range?.join('–')||'—',r.stints??'—',escape(r.compounds?.join(', ')||'—'),range?`${fmt(range[0],3,'%')}–${fmt(range[1],3,'%')}`:'—',common&&Object.keys(common.values||{}).length===3?`${[1.5,2,2.5].map(th=>signed(common.values[String(th)],3,'%')).join(' / ')}<small>vs ${escape(common.reference_driver)} · ${common.drivers.length} common drivers</small>`:'—',model.leave_stint_out_range?`${fmt(model.leave_stint_out_range[0],3,'%')}–${fmt(model.leave_stint_out_range[1],3,'%')}<small>${model.leave_stint_out_fits} deletion fits</small>`:'—',fmt(model.contrast_noise_gain,3)];
  })))}</details>`;

  return regulatoryBadge +
    card('Qualifying pace deficit',
      chartMeta.note,
      `<div class="performance-scope-toggle performance-stat-toggle" role="group" aria-label="Season pace summary"><button type="button" data-pace-stat="mean" aria-pressed="${paceSeasonStat==='mean'}">Mean GP gap</button><button type="button" data-pace-stat="median" aria-pressed="${paceSeasonStat==='median'}">Median GP gap</button></div>`+
      qualyToggle +
      qualyChart +
      table([
        sortHeader('team', 'Team'),
        sortHeader(paceKey, qualyColLabel),
        sortHeader('race', 'Estimated race pace deficit'),
        sortHeader('samples', 'Eligible race laps', -1)
      ], ordered.map(t => [
        teamLabel(t),
        `${fmt(t[paceKey], 3, '%')}<small>${t.qCount} of ${events.filter(e=>e.Q?.teams?.length).length} loaded qualifying events${middle50Label(qualyPaceMode==='adjusted'?t.adjDeficits:t.q.map(q=>q.pace),'%')?` · GP P25–P75 ${middle50Label(qualyPaceMode==='adjusted'?t.adjDeficits:t.q.map(q=>q.pace),'%')}`:''}${t.qCount === 1 && t.q[0]?.lap ? ` · ${escape(t.q[0].lap.driver)} ${fmt(t.q[0].lap.time, 3, ' s')}` : ''}</small>`,
        `${fmt(t.race, 3, '%')}${t.sampleTier === 'insufficient' || t.provisional ? ' <span class="perf-tercile-badge is-mid" style="font-size:0.65rem;">Limited sample</span>' : ''}<small>${t.fastestRaceDrivers?.length ? `Fastest: ${escape([...new Set(t.fastestRaceDrivers)].join(', '))} · ` : ''}${t.rCount} event${t.rCount === 1 ? '' : 's'}${middle50Label(t.r,'%')?` · GP P25–P75 ${middle50Label(t.r,'%')}`:''}${t.sensitivityBracket ? ` · Bracket [${fmt(t.sensitivityBracket[0], 3, '%')}, ${fmt(t.sensitivityBracket[1], 3, '%')}]` : ''}</small>`,
        t.samples
      ]))) +
    card('Race pace deficit overview',
      'Estimated race pace uses one 2.0s timing-checkpoint traffic screen and a shared race-lap, compound and tyre-age model. Checkpoints cannot prove continuous clean air; other thresholds are sensitivity checks, not alternate headline baselines.',
      raceChart) + raceSupport +
    `<details class="dashboard-card performance-methods"><summary>Why this pace ranking? View selected laps and race drivers</summary><p class="performance-note">Only the fastest valid lap across the whole qualifying session counts for each team. P25–P75 describes variation in the GP deficits, not uncertainty in the season rank.</p>${table(['Team', 'Event', 'Phase', 'Driver', 'Selected lap (s)'], teams.flatMap(t => t.q.filter(q => q.lap).map(q => [teamLabel(t), eventLabel(q.event), escape(q.lap.phase), escape(q.lap.driver), fmt(q.lap.time, 3)]))) }<p class="performance-note">Race pace models race lap, compound and tyre age, with timing checkpoints as a traffic proxy. Typical model error is the median absolute residual on eligible laps, not a confidence interval. Driver choices and race management remain in the estimate.</p>${table(['Team', 'Event', 'Driver', 'Estimate', 'Eligible laps', 'Typical model error'], teams.flatMap(t => t.raceDrivers.map(r => [teamLabel(t), eventLabel(r.event), `${escape(r.driver)}${r.selected ? ' · selected' : ''}`, fmt(r.pace, 3, '%'), r.samples, fmt(r.residual_spread, 3, '%')]))) }</details>`;
}

function tyreViewControls() {
  const hasP75=events.filter(e=>e.R).length>=4;
  if(!hasP75&&tyreSeasonStat==='p75')tyreSeasonStat='mean';
  return `<div class="performance-toolbar performance-tyre-toolbar"><div class="performance-scope-toggle" role="group" aria-label="Tyre trend measurement"><button type="button" data-tyre-metric="age" aria-pressed="${tyreMetric==='age'}">Tyre-age change</button><button type="button" data-tyre-metric="relative" aria-pressed="${tyreMetric==='relative'}">Matched rivals</button></div>${tyreMetric==='age'?`<div class="performance-scope-toggle" role="group" aria-label="Tyre trend subject"><button type="button" data-tyre-subject="team" aria-pressed="${tyreSubject==='team'}">Teams</button><button type="button" data-tyre-subject="driver" aria-pressed="${tyreSubject==='driver'}">Drivers</button></div>`:''}<div class="performance-scope-toggle" role="group" aria-label="Tyre trend summary across Grands Prix"><button type="button" data-tyre-stat="mean" aria-pressed="${tyreSeasonStat==='mean'}">Mean GP</button><button type="button" data-tyre-stat="median" aria-pressed="${tyreSeasonStat==='median'}">Median GP</button><button type="button" data-tyre-stat="p75" aria-pressed="${tyreSeasonStat==='p75'}" ${hasP75?'':'disabled title="Needs at least four loaded races"'}>P75 worse GP</button></div></div>`;
}

function tyreStintKey(entity,stint){
  return encodeURIComponent(JSON.stringify([entity.team,stint.event,stint.driver,stint.stint,stint.segment||0]));
}

function renderTyreStintPlot(entity,stint){
  const points=(stint.points||[]).filter(p=>finite(p.age)&&finite(p.time)&&finite(p.lap));
  if(points.length<3)return '';
  const fuel=tyreCorrection==='fuel'?tyreFuelRate:0;
  const origin=points[0].lap;
  const values=points.map(p=>p.time+fuel*(p.lap-origin));
  const baseline=Math.min(...values),lo=Math.min(...points.map(p=>p.age)),hi=Math.max(...points.map(p=>p.age));
  const rate=stint.trendValue;
  const intercept=summarize(points.map((p,i)=>values[i]-rate*p.age),'median');
  const fit=[intercept+rate*lo,intercept+rate*hi];
  const min=Math.min(baseline,...fit),max=Math.max(...values,...fit),span=Math.max(.1,max-min);
  const x=a=>55+(a-lo)/Math.max(1,hi-lo)*590,y=v=>180-(v-min)/span*145;
  return `<div class="performance-chart-card performance-tyre-stint-plot"><h4>${escape(stint.driver)} · ${escape(stint.event)} · ${escape(stint.compound_grade)} · stint ${stint.stint}</h4><span class="perf-chart-sub">${tyreCorrection==='fuel'?'Assumed fuel-corrected':'Observed'} pace · dots are usable laps, dashed line is the fitted trend</span><svg viewBox="0 0 680 230" role="img" aria-label="${escape(stint.driver)} stint lap times against tyre age">
    ${[0,.5,1].map(f=>{const v=min+span*f;return `<line x1="55" x2="645" y1="${y(v)}" y2="${y(v)}" stroke="var(--border-color)"/><text x="48" y="${y(v)+4}" text-anchor="end">${(v-baseline).toFixed(3)}</text>`;}).join('')}
    <path d="M ${x(lo)} ${y(fit[0])} L ${x(hi)} ${y(fit[1])}" stroke="${color(entity.color)}" stroke-width="2" stroke-dasharray="6 4" fill="none"/>
    ${points.map((p,i)=>`<circle cx="${x(p.age)}" cy="${y(values[i])}" r="3.5" fill="${color(entity.color)}"><title>Lap ${p.lap} · age ${p.age} · ${p.time.toFixed(3)} s observed · ${(values[i]-baseline).toFixed(3)} s above best ${tyreCorrection==='fuel'?'corrected ':''}lap in this run</title></circle>`).join('')}
    <text x="55" y="201" text-anchor="middle">${lo}</text><text x="645" y="201" text-anchor="middle">${hi}</text><text x="350" y="223" text-anchor="middle">Tyre age (laps) · vertical scale: seconds above this run's best lap</text>
    </svg></div>`;
}

function renderTyreAge(teams) {
  const allocations=VERIFIED_DRY_ALLOCATIONS[context?.year] || [];
  const compounds=[...new Set(allocations.join('').split('').filter(Boolean).map(n=>`C${n}`))].sort((a,b)=>Number(a.slice(1))-Number(b.slice(1)));
  if(!compounds.length) return card('Tyre-age performance change',
    'Exact C-grade allocations have not been verified for this season. Soft, Medium and Hard change meaning by race, so showing them here as C grades would be misleading.',
    '<p class="section-empty">No exact-compound tyre-age results for this season. Matched rivals remains available.</p>');
  const choices=['OVERALL',...compounds];
  if(!choices.includes(tyreView))tyreView='OVERALL';
  const controls=`<div class="performance-tyre-options" role="group" aria-label="Exact tyre compound">${choices.map(c=>`<button type="button" data-performance-tyre="${c}" aria-pressed="${tyreView===c}"><span class="tyre-opt-label">${c==='OVERALL'?'Overall · C grades':c}</span></button>`).join('')}</div>
    <div class="performance-toolbar performance-tyre-toolbar">
      <div class="performance-scope-toggle" role="group" aria-label="Tyre condition suitability"><button type="button" data-tyre-condition="screened" aria-pressed="${tyreConditionMode==='screened'}">Condition-screened</button><button type="button" data-tyre-condition="all" aria-pressed="${tyreConditionMode==='all'}">All pace trends · diagnostic</button></div>
      <div class="performance-scope-toggle" role="group" aria-label="Tyre trend laps"><button type="button" data-tyre-laps="all" aria-pressed="${tyreLapMode==='all'}">All usable laps</button><button type="button" data-tyre-laps="clear" aria-pressed="${tyreLapMode==='clear'}">Clean air</button></div>
      <div class="performance-scope-toggle" role="group" aria-label="Tyre trend fuel correction"><button type="button" data-tyre-correction="fuel" aria-pressed="${tyreCorrection==='fuel'}">Assumed fuel correction</button><button type="button" data-tyre-correction="raw" aria-pressed="${tyreCorrection==='raw'}">Observed lap times</button></div>
      ${tyreCorrection==='fuel'?`<div class="performance-scope-toggle" role="group" aria-label="Assumed fuel gain per race lap">${[.040,.060,.080].map(rate=>`<button type="button" data-tyre-fuel="${rate}" aria-pressed="${tyreFuelRate===rate}">${rate.toFixed(3)} s/lap</button>`).join('')}</div>`:''}
      <div class="performance-scope-toggle" role="group" aria-label="Tyre trend stint weighting"><button type="button" data-tyre-weighting="balanced" aria-pressed="${tyreWeighting==='balanced'}">Equal drivers</button><button type="button" data-tyre-weighting="laps" aria-pressed="${tyreWeighting==='laps'}">Lap weighted</button></div>
    </div>`;
  const loadedRaces=events.filter(e=>e.R);
  const mappedRaces=loadedRaces.filter(e=>Boolean(allocations[Number(e.round)-1])).length;
  const unmappedStints=teams.flatMap(t=>t.tyreAgeStints||[]).filter(s=>!s.compound_grade).length;
  const source=TYRE_ALLOCATION_SOURCES[context?.year];
  const coverage=`<p class="performance-note">Verified C grades for ${mappedRaces}/${loadedRaces.length} loaded races. ${unmappedStints?`${unmappedStints} stint${unmappedStints===1?'':'s'} without a verified grade excluded. `:''}Fewer samples per grade can make rankings less stable. <a href="${source}" target="_blank" rel="noopener noreferrer">Pirelli allocation sources</a></p>`;
  const entities=[];
  for(const team of teams) {
    const stints=(team.tyreAgeStints||[]).map(s=>{
      const fit=tyreLapMode==='clear'?s.clean_air:s;
      if(!fit)return {...s,trendValue:null,trendSupported:false,trendSamples:0};
      const fuel=tyreCorrection==='fuel'?tyreFuelRate:0;
      const raw=finite(fit.raw_slope)?fit.raw_slope:finite(fit.fuel_adjusted_slope)?fit.fuel_adjusted_slope-(fit.fuel_assumption_s_per_lap??.060):null;
      const value=finite(raw)?raw+fuel:null;
      const sensitivity=fit.block_sensitivity_raw?.map(rate=>rate+fuel);
      const supported=fit.supported??(fit.samples>=6&&(!finite(fit.min_age)||!finite(fit.max_age)||fit.max_age-fit.min_age>=5));
      return {...s,...fit,trendValue:value,trendSensitivity:sensitivity,trendSupported:supported&&(tyreConditionMode==='all'||fit.stable_condition_screen===true),trendSamples:fit.samples,original:s};
    });
    if(tyreSubject==='team')entities.push({team:team.team,color:team.color,displayName:team.team,stints});
    else for(const driver of [...new Set(stints.map(s=>s.driver).filter(Boolean))])
      entities.push({team:team.team,color:team.color,displayName:`${driver} · ${team.team}`,driver,stints:stints.filter(s=>s.driver===driver)});
  }
  const rows=entities.map(entity=>{
    const summaries={};
    for(const compound of compounds) {
      const grouped=new Map();
      for(const stint of entity.stints)if(stint.compound_grade===compound && stint.trendSupported && finite(stint.trendValue)) {
        if(!grouped.has(stint.event))grouped.set(stint.event,[]);
        grouped.get(stint.event).push(stint);
      }
      const eventValues=new Map([...grouped].map(([event,stints])=>[event,(()=>{
        if(tyreWeighting==='laps'){
          const weight=stints.reduce((sum,s)=>sum+s.samples,0);
          return stints.reduce((sum,s)=>sum+s.trendValue*s.samples,0)/weight;
        }
        const drivers=new Map();
        for(const s of stints){
          if(!drivers.has(s.driver))drivers.set(s.driver,new Map());
          const driverStints=drivers.get(s.driver),key=s.stint??s;
          if(!driverStints.has(key))driverStints.set(key,[]);
          driverStints.get(key).push(s.trendValue);
        }
        return avg([...drivers.values()].map(driverStints=>summarize([...driverStints.values()].map(values=>summarize(values,'median')),'median')));
      })()]));
      if(eventValues.size) {
        const used=[...grouped.values()].flat();
        summaries[compound]={value:summarize([...eventValues.values()],tyreSeasonStat),eventValues,events:eventValues.size,used,stints:used.length,laps:used.reduce((sum,s)=>sum+s.samples,0),outliers:used.reduce((sum,s)=>sum+(s.outlier_laps||0),0),lowSample:used.some(s=>s.low_sample),usedStart:used.filter(s=>s.used_start).length};
      }
    }
    const selectedGrades=tyreView==='OVERALL'?compounds:[tyreView];
    const available=selectedGrades.map(c=>summaries[c]).filter(Boolean);
    const p75Shortfall=tyreSeasonStat==='p75'
      ? selectedGrades.filter(c=>summaries[c] && summaries[c].events<4)
          .map(c=>`${c}: ${summaries[c].events}/4 GPs`)
      : [];
    const eventGrades=new Map();
    for(const summary of available) for(const [event,value] of summary.eventValues) {
      if(!eventGrades.has(event))eventGrades.set(event,[]);
      eventGrades.get(event).push(value);
    }
    const gpSlopes=[...eventGrades.values()].map(avg);
    const short=entity.stints.filter(s=>selectedGrades.includes(s.compound_grade)&&!s.trendSupported).length;
    return {...entity,value:tyreSeasonStat==='p75'&&(gpSlopes.length<4||p75Shortfall.length)?null:summarize(gpSlopes,tyreSeasonStat),p75Shortfall,compounds:available.length,events:eventGrades.size,stints:available.reduce((sum,s)=>sum+s.stints,0),laps:available.reduce((sum,s)=>sum+s.laps,0),outliers:available.reduce((sum,s)=>sum+s.outliers,0),usedStart:available.reduce((sum,s)=>sum+s.usedStart,0),lowSample:available.some(s=>s.lowSample),short};
  });
  const ordered=sorted(rows,{tyreAgeName:r=>r.displayName,tyreAgeValue:r=>r.value,tyreAgeEvents:r=>r.events,tyreAgeStints:r=>r.stints,tyreAgeLaps:r=>r.laps},'tyreAgeValue');
  const scored=ordered.filter(r=>finite(r.value));
  const extent=Math.max(.01,...scored.map(r=>Math.abs(r.value)));
  const chart=scored.length?`<div class="performance-chart-card"><div class="perf-chart-header"><div class="perf-chart-title-group"><h4 class="perf-chart-heading">Tyre-age lap-time change · ${tyreView==='OVERALL'?'verified C grades':tyreView}</h4><span class="perf-chart-sub">Seconds per additional tyre-age lap · left of zero improves, right of zero worsens</span></div></div><div class="performance-tyre-age-chart">${scored.map(r=>{
    const width=Math.min(50,Math.abs(r.value)/extent*50);
    return `<div class="performance-tyre-age-row"><div class="performance-tyre-age-name">${teamLabel(r)}</div><div class="performance-tyre-age-track"><i class="performance-tyre-age-zero"></i><i class="performance-tyre-age-bar" style="--bar-color:${color(r.color)};left:${r.value<0?(50-width).toFixed(2):'50'}%;width:${width.toFixed(2)}%"></i></div><span class="performance-tyre-age-value">${signed(r.value,3,' s/lap')}</span></div>`;
  }).join('')}</div></div>`:`<p class="section-empty">${tyreSeasonStat==='p75'?'P75 needs at least four supported Grands Prix for every included C grade. The table shows each missing grade and its GP count.':tyreLapMode==='clear'?'No supported clean-air fits. Try All usable laps to inspect traffic-affected trends.':'No runs with at least six usable laps spanning five tyre-age steps. Short runs remain in the evidence table.'}</p>`;
  const plotRuns=entities.flatMap(entity=>entity.stints.filter(s=>(tyreView==='OVERALL'||s.compound_grade===tyreView)&&finite(s.trendValue)&&s.points?.length>=3).map(s=>({entity,stint:s,key:tyreStintKey(entity,s)})));
  let selectedRun=plotRuns.find(r=>r.key===tyreRunKey);
  const choose=(list,value,key)=>list.some(r=>key(r)===value)?list.filter(r=>key(r)===value):list;
  let filteredRuns=choose(plotRuns,tyrePlotTeam,r=>r.entity.team);
  filteredRuns=choose(filteredRuns,tyrePlotDriver,r=>r.stint.driver);
  filteredRuns=choose(filteredRuns,tyrePlotEvent,r=>r.stint.event);
  selectedRun=selectedRun||filteredRuns.sort((a,b)=>String(a.entity.team).localeCompare(String(b.entity.team))||String(a.stint.driver).localeCompare(String(b.stint.driver))||Number(a.stint.round)-Number(b.stint.round)||a.stint.stint-b.stint.stint)[0];
  const options=(values,selected)=>[...new Set(values)].map(value=>`<option value="${escape(value)}" ${value===selected?'selected':''}>${escape(value)}</option>`).join('');
  const picker=selectedRun?`<div class="performance-tyre-plot-controls"><label>Team<select data-tyre-plot-filter="team">${options(plotRuns.map(r=>r.entity.team).sort(),selectedRun.entity.team)}</select></label><label>Driver<select data-tyre-plot-filter="driver">${options(plotRuns.filter(r=>r.entity.team===selectedRun.entity.team).map(r=>r.stint.driver),selectedRun.stint.driver)}</select></label><label>Grand Prix<select data-tyre-plot-filter="event">${options(plotRuns.filter(r=>r.entity.team===selectedRun.entity.team&&r.stint.driver===selectedRun.stint.driver).map(r=>r.stint.event),selectedRun.stint.event)}</select></label><label>Stint / run<select data-tyre-plot-filter="run">${plotRuns.filter(r=>r.entity.team===selectedRun.entity.team&&r.stint.driver===selectedRun.stint.driver&&r.stint.event===selectedRun.stint.event).map(r=>`<option value="${r.key}" ${r.key===selectedRun.key?'selected':''}>Stint ${r.stint.stint} · ${escape(r.stint.compound_grade)} · age ${r.stint.min_age}–${r.stint.max_age}${r.stint.segment?` · run ${r.stint.segment+1}`:''}</option>`).join('')}</select></label></div><p class="performance-note">Inspecting one individual run · ${plotRuns.length} runs from ${new Set(plotRuns.map(r=>r.entity.team)).size} teams available. The ranking above summarizes the selected compound across all supported runs.</p>`:'';
  const stintPlot=selectedRun?picker+renderTyreStintPlot(selectedRun.entity,selectedRun.stint):'';
  const evidence=entities.flatMap(entity=>entity.stints.filter(s=>tyreView==='OVERALL'||s.compound_grade===tyreView).map(s=>[
    teamLabel(entity),escape(s.driver||'—'),eventLabel(s.event),escape(s.compound_grade||'Unmapped'),`${s.stint}${s.segment?` · green run ${s.segment+1}`:''}`,
    finite(s.min_age)&&finite(s.max_age)?`${s.min_age}–${s.max_age}`:'—',s.trendSamples||0,
    finite(s.trendValue)?signed(s.trendValue,3,' s/lap'):'—',
    finite(s.early_slope)&&finite(s.late_slope)?`${signed(s.early_slope-(s.fuel_assumption_s_per_lap??.060)+(tyreCorrection==='fuel'?tyreFuelRate:0),3)} → ${signed(s.late_slope-(s.fuel_assumption_s_per_lap??.060)+(tyreCorrection==='fuel'?tyreFuelRate:0),3)} s/lap`:'—',
    finite(s.residual_spread_s)?fmt(s.residual_spread_s,3,' s'):'—',
    s.trendSensitivity?`${signed(s.trendSensitivity[0],3)} to ${signed(s.trendSensitivity[1],3)} s/lap`:'—',
    `${s.trendSupported&&s.compound_grade?'Included':'Diagnostic only'}${!s.supported?' · insufficient span or laps':''}${s.condition_flags?.length?` · ${escape(s.condition_flags.join(', '))}`:''}${s.stable_condition_screen==null?' · condition screening unavailable':''}${finite(s.field_trend_s_per_lap)?` · field trend ${signed(s.field_trend_s_per_lap,3)} s/lap (${s.field_trend_drivers} drivers)`:''}${!s.compound_grade?' · unverified compound':''}${s.used_start?' · used tyres':''}`,
    s.points?.length>=3?`<button type="button" class="performance-stint-inspect" data-tyre-run="${tyreStintKey(entity,s)}">View laps</button>`:'—'
  ]));
  const legacy=teams.some(t=>(t.tyreAgeStints||[]).some(s=>!s.fit_method));
  const audit=`<details class="dashboard-card performance-methods" ${tyreRunKey?'open':''}><summary>View stint evidence and early/late trends</summary><p class="performance-note">A run needs six usable laps across at least five tyre-age steps to enter the ranking. Early/late rates need at least six laps in each half. Block sensitivity refits the trend after removing successive groups of adjacent laps; a wide range means sections of the stint strongly influence the result. It needs at least twelve laps. Neither this range nor typical fit error is a confidence interval. Short runs and unmapped compounds are listed but do not enter the ranking. View laps draws the selected run above this table.</p>${table(['Team','Driver','Grand Prix','Compound','Stint / run','Observed tyre ages','Fit laps','Trend','Early → late','Typical fit error','Block sensitivity','Evidence','Lap plot'],evidence)}</details>`;
  return card('Tyre-age performance change',
    `The number is the change in lap time for each additional lap on the tyre: +0.050 s/lap means a 0.500-second loss over ten tyre-age steps if the trend continues. Each driver's stint is fitted separately over its observed ages; pit, wet and neutralised laps are excluded. Runs are split at SC/VSC/red flags and unusual laps are screened around the fitted trend. ${tyreLapMode==='clear'?'Clean air requires more than 2 seconds to the car ahead at timing checkpoints.':'All usable laps includes traffic and race management.'} ${tyreCorrection==='fuel'?`The rate adds your assumed ${tyreFuelRate.toFixed(3)} s per race lap for fuel burn. The choices test sensitivity; they are not measured fuel loads or a calibrated range for any season.`:'Observed rates include the benefit of burning fuel.'} ${tyreWeighting==='balanced'?'Median stints describe each driver, then both drivers receive equal weight within each GP and C grade.':'Stints receive weight proportional to their usable laps within each GP and C grade.'} Each GP receives equal weight in the season summary. Overall averages only the C grades observed in each GP, so differing compound and circuit coverage can affect comparisons. Track evolution, temperature, driving targets and energy management can still influence these estimates.`,
    controls+`<p class="performance-quality-status">${tyreConditionMode==='screened'?'Wet/transition context and rapid field-wide improvement are excluded from the ranking; all fitted runs remain inspectable.':'Diagnostic: all statistically supported pace trends are included, even in changing conditions.'} This measures observed pace change, not physical tyre wear.</p>`+coverage+(legacy?'<p class="performance-note">Some loaded results use the previous fit. Reanalyse after the telemetry API update to obtain robust fits, clean-air checks and early/late evidence.</p>':'')+chart+table([
      sortHeader('tyreAgeName',tyreSubject==='team'?'Team':'Driver · team'),
      sortHeader('tyreAgeValue','Change per tyre-age lap'),
      sortHeader('tyreAgeEvents','Events',-1),
      sortHeader('tyreAgeStints','Usable green runs',-1),
      sortHeader('tyreAgeLaps','Usable laps',-1),
      'Outlier laps removed','Coverage'
    ],ordered.map(r=>[teamLabel(r),finite(r.value)?signed(r.value,3,' s/lap'):r.p75Shortfall.length?`—<small>P75 needs ${escape(r.p75Shortfall.join(', '))}</small>`:'—',r.events,r.stints,r.laps,r.outliers,`${r.compounds} C grade${r.compounds===1?'':'s'}${r.lowSample||r.events<3?' · limited evidence':''}${r.short?` · ${r.short} unsupported run${r.short===1?'':'s'}`:''}${r.usedStart?` · ${r.usedStart} used start${r.usedStart===1?'':'s'}`:''}`]))+stintPlot+audit);
}

function renderRace(teams) {
  if(tyreMetric==='age')return tyreViewControls()+renderTyreAge(teams);
  const rows=[];
  const usableStint = s => finite(s.relativeSlope) && s.matchedLaps >= 6 && s.fieldSupport >= 2;
  const cohortTeams = new Map();
  for(const team of teams) for(const stint of team.stints || []) if(usableStint(stint)) {
    const key=`${stint.event}\u0000${stint.compound}`;
    if(!cohortTeams.has(key))cohortTeams.set(key,new Set());
    cohortTeams.get(key).add(team.team);
  }
  const minimumSeasonEvents=context?.season ? Math.max(3,Math.ceil(events.filter(e=>e.R).length*.4)) : 1;
  const minimumCompoundEvents=1;
  const compoundOrder=['HYPERSOFT','ULTRASOFT','SUPERSOFT','SOFT','MEDIUM','HARD','SUPERHARD'];
  const choices=['OVERALL','SOFT','MEDIUM','HARD',...compoundOrder.filter(c=>!['SOFT','MEDIUM','HARD'].includes(c)&&teams.some(t=>t.stints.some(s=>s.compound===c)))];
  if(!choices.includes(tyreView)) tyreView='OVERALL';
  const controls=`<div class="performance-tyre-options" role="group" aria-label="Tyre compound">${choices.map(c=>`<button type="button" data-performance-tyre="${c}" aria-pressed="${tyreView===c}">${['SOFT','MEDIUM','HARD'].includes(c)?`<img src="assets/tyres/official/${c.toLowerCase()}.png" alt="" width="20" height="20">`:''}<span class="tyre-opt-label">${c==='OVERALL'?'Overall · S/M/H':c.charAt(0)+c.slice(1).toLowerCase()}</span></button>`).join('')}</div>`;

  for(const team of teams) {
    const observedStints=(team.stints||[]).filter(s=>finite(s.slope) && (tyreView==='OVERALL'?['SOFT','MEDIUM','HARD'].includes(s.compound):s.compound===tyreView));
    // Used-start tyres are retained only when their race-phase/age-matched
    // comparison passes the same support checks, and are flagged in the table.
    const validStints = (team.stints || []).filter(s => usableStint(s)
      && (cohortTeams.get(`${s.event}\u0000${s.compound}`)?.size||0)>=3);
    const usedStartCount = validStints.filter(s => s.usedStart || s.used_start).length;

    // Group valid stints by event and compound for hierarchical aggregation
    // Hierarchy: Driver-level aggregation with capped weight min(samples, 20)
    // -> team compound estimate within event
      // -> equal event weighting using the selected season statistic
    const eventCompStints = new Map(); // event -> compound -> array of stints
    const summaries = {};

    for(const compound of compoundOrder) {
      const compStints = validStints.filter(s => s.compound === compound);
      const byEventRaw = new Map();
      const byEventNorm = new Map();
      let cliffCount = 0;
      let minAgeObs = Infinity;
      let maxAgeObs = -Infinity;
      const cliffAges = [];

      for(const stint of compStints) {
        if(!eventCompStints.has(stint.event)) eventCompStints.set(stint.event, new Map());
        if(!eventCompStints.get(stint.event).has(compound)) eventCompStints.get(stint.event).set(compound, []);
        eventCompStints.get(stint.event).get(compound).push(stint);

        if(finite(stint.minAge)) minAgeObs = Math.min(minAgeObs, stint.minAge);
        if(finite(stint.maxAge)) maxAgeObs = Math.max(maxAgeObs, stint.maxAge);
        if(stint.cliffDetected || stint.cliff_detected) {
          cliffCount++;
          if(finite(stint.cliffAge)) cliffAges.push(stint.cliffAge);
        }
      }

      // Compute driver-weighted estimate for each event for this compound
      for(const [ev, stints] of (eventCompStints.entries())) {
        const cStints = stints.get(compound);
        if(!cStints || !cStints.length) continue;
        let wRawSum = 0, wRawVal = 0;
        let wNormSum = 0, wNormVal = 0;
        for(const s of cStints) {
          const w = Math.min(s.matchedLaps || 0, 20);
          wRawSum += w;
          wRawVal += w * s.slope;
          const rel = finite(s.relativeSlope) ? s.relativeSlope : s.field_normalized_slope;
          if(finite(rel)) {
            wNormSum += w;
            wNormVal += w * rel;
          }
        }
        if(wRawSum > 0) byEventRaw.set(ev, wRawVal / wRawSum);
        if(wNormSum > 0) byEventNorm.set(ev, wNormVal / wNormSum);
      }

      const rawEvValues = [...byEventRaw.values()].filter(finite);
      const normEvValues = [...byEventNorm.values()].filter(finite);
      const compoundLaps = compStints.reduce((sum, s) => sum + (s.matchedLaps || 0), 0);

      if(rawEvValues.length || normEvValues.length) {
        summaries[compound] = {
          slope: rawEvValues.length && (tyreSeasonStat!=='p75'||rawEvValues.length>=4) ? summarize(rawEvValues,tyreSeasonStat) : null,
          normSlope: normEvValues.length && (tyreSeasonStat!=='p75'||normEvValues.length>=4) ? summarize(normEvValues,tyreSeasonStat) : null,
          cliffCount,
          cliffAges,
          events: [...byEventRaw.keys()],
          stints: compStints.length,
          laps: compoundLaps,
          minAge: minAgeObs < Infinity ? minAgeObs : null,
          maxAge: maxAgeObs > -Infinity ? maxAgeObs : null,
          fieldSupported: compStints.length > 0 && compStints.every(s => s.fieldSupport >= 2)
        };
      }
    }

    // Now compute OVERALL or single compound score
    let seasonSlope = null;
    let seasonNormSlope = null;
    let complete = false;
    const present = tyreView === 'OVERALL'
      ? ['SOFT', 'MEDIUM', 'HARD'].map(c => summaries[c])
          .filter(c => c && c.events.length >= minimumCompoundEvents)
      : [summaries[tyreView]].filter(Boolean);

    if(tyreView === 'OVERALL') {
       // Average the compound season estimates equally; event weighting is
       // already applied within each compound summary above.
       const compoundRaw = present.map(c => c.slope).filter(finite);
       const compoundNorm = present.map(c => c.normSlope).filter(finite);
       seasonSlope = compoundRaw.length ? avg(compoundRaw) : null;
       seasonNormSlope = compoundNorm.length ? avg(compoundNorm) : null;
       complete = present.length >= 2 && new Set(present.flatMap(c=>c.events)).size >= minimumSeasonEvents && finite(seasonNormSlope);
    } else {
      seasonSlope = summaries[tyreView]?.slope ?? null;
      seasonNormSlope = summaries[tyreView]?.normSlope ?? null;
       complete = Boolean(summaries[tyreView]) && summaries[tyreView].events.length >= minimumSeasonEvents && finite(seasonNormSlope);
    }

    const compNote = tyreView === 'OVERALL' && present.length < 3
      ? `(${present.length}/3 compounds have ≥${minimumCompoundEvents} supported events)` : '';
    const softLaps = summaries['SOFT']?.laps || 0;
    const medLaps = summaries['MEDIUM']?.laps || 0;
    const hardLaps = summaries['HARD']?.laps || 0;
    const totalDryLaps = softLaps + medLaps + hardLaps;
    const compoundBreakdown = totalDryLaps > 0
      ? [
          softLaps > 0 ? `S: ${Math.round((softLaps / totalDryLaps) * 100)}%` : null,
          medLaps > 0 ? `M: ${Math.round((medLaps / totalDryLaps) * 100)}%` : null,
          hardLaps > 0 ? `H: ${Math.round((hardLaps / totalDryLaps) * 100)}%` : null
        ].filter(Boolean).join(' · ')
      : '';

    const minAgeOverall = Math.min(...present.map(c => c.minAge).filter(finite));
    const maxAgeOverall = Math.max(...present.map(c => c.maxAge).filter(finite));
    const cliffAgesAll = present.flatMap(c => c.cliffAges || []);
    const totalCompoundLaps = present.reduce((sum, c) => sum + (c.laps || 0), 0);

    rows.push({
      team: team.team,
      label: teamLabel(team),
      color: team.color,
      slope: seasonSlope,
      normSlope: seasonNormSlope,
      cliffs: present.reduce((s, c) => s + (c.cliffCount || 0), 0),
      cliffAges: cliffAgesAll,
      events: new Set(present.flatMap(c => c.events)).size,
      stints: present.reduce((s, c) => s + c.stints, 0),
      laps: totalCompoundLaps,
      minAge: finite(minAgeOverall) ? minAgeOverall : null,
      maxAge: finite(maxAgeOverall) ? maxAgeOverall : null,
      usedStartCount,
      observedStints:observedStints.length,
      fieldSupported: present.length > 0 && present.every(c => c.fieldSupported),
      complete,
      compNote,
      compoundBreakdown,
      totalDryLaps
    });
  }

  const ordered = sorted(rows, {
    tyreTeam: r => r.team,
    tyreNorm: r => r.complete ? r.normSlope : null,
    tyreSlope: r => r.slope,
    tyreEvents: r => r.events,
    tyreStints: r => r.stints,
    tyreLaps: r => r.laps
  }, 'tyreNorm');

  // SVG Horizontal Bar Graph for Field-Relative Tyre Degradation
  const tyreChart = renderHorizontalBarChart(ordered.filter(r => finite(r.normSlope)), {
     title: `Relative tyre-age trend · ${tyreView === 'OVERALL' ? 'Available compounds' : tyreView}`,
     subtitle: `Same-event, same-compound cohorts of ≥3 teams · ${tyreSeasonStat==='p75'?'P75 worse GP':tyreSeasonStat==='median'?'Median GP':'Mean GP'} · Limited samples are provisional`,
    valueKey: 'normSlope',
    unit: ' s/lap',
    digits: 3,
    signedValue: true,
    zeroBaseline: true
  });

   return tyreViewControls()+card('Tyre-age lap-time trend',
     `Extra lap-time change per tyre-age lap against overlapping rivals on the same compound. Each compound uses the selected GP statistic; Overall then averages supported compounds equally. P75 is a worse-end GP trend, not the 75th percentile of individual laps. One-compound or short-season results are provisional. Missing values mean no matched three-team cohort, not zero tyre wear. Traffic and management remain limitations.`,
    controls + tyreChart +
    table([
      sortHeader('tyreTeam', 'Team'),
      sortHeader('tyreNorm', 'Extra ageing vs rivals'),
      'Observed age range',
      sortHeader('tyreStints', 'Matched sample (stints / laps)', -1),
      'Field support',
      'Compound mix'
    ], ordered.map(r => {
      const ageRange = (finite(r.minAge) && finite(r.maxAge)) ? `L${r.minAge}–L${r.maxAge} (${r.maxAge - r.minAge + 1} laps)` : '—';
      const sampleText = `${r.stints} matched stint${r.stints === 1 ? '' : 's'} (${r.laps} laps)${r.observedStints > r.stints ? `<small>${r.observedStints} observed stints total</small>` : ''}`;
       const supportBadge = r.fieldSupported ? '<span class="perf-tercile-badge is-fast">≥2 overlapping rivals</span>' : '<span class="perf-tercile-badge is-mid">No matched cohort</span>';
      const normText = finite(r.normSlope)
        ? `${r.normSlope > 0 ? '+' : ''}${fmt(r.normSlope, 3, ' s/lap')}${!r.complete?`<small>Provisional · ${r.events}/${minimumSeasonEvents} supported events</small>`:''}`
        : '<small>Not enough overlapping rival stints</small>';
      const compoundText = `${tyreView === 'OVERALL' && r.compoundBreakdown ? escape(r.compoundBreakdown) : tyreView}${r.usedStartCount > 0 ? `<small>${r.usedStartCount} matched stint${r.usedStartCount===1?'':'s'} on used tyres</small>` : ''}${r.compNote ? `<small>${escape(r.compNote)}</small>` : ''}`;
      return [
        r.label,
        normText,
        ageRange,
        sampleText,
        supportBadge,
        compoundText
      ];
    })));
}

function renderResults(teams) {
  const resultRows=teams.map(t=>({...t,points:t.pointsKnown?t.points:null,pointsPerStart:t.starts&&t.pointsKnown?t.points/t.starts:null,
    finishRatePct:t.starts?100*t.finishes/t.starts:null,
    mechanicalRatePct:t.starts?100*(t.puRetirements+t.chassisRetirements)/t.starts:null}));
  const ordered=sorted(resultRows,{
    resultTeam:t=>t.team,
    points:t=>t.points,
    pointsPerStart:t=>t.pointsPerStart,
    mechanicalRate:t=>t.mechanicalRatePct,
    finish:t=>avg(t.positions),
    finishRate:t=>t.starts?t.finishes/t.starts:null,
    pu:t=>t.puRetirements,
    chassis:t=>t.chassisRetirements,
    incidents:t=>t.incidentRetirements,
    other:t=>t.otherRetirements + t.unknownRetirements
  },'points',-1);

  const selectedResult=resultsChartMetric==='perStart'?'pointsPerStart':resultsChartMetric==='finishRate'?'finishRatePct':resultsChartMetric==='mechanicalRate'?'mechanicalRatePct':'points';
  const pointsChart = renderHorizontalBarChart(ordered, {
    title: resultsChartMetric==='perStart'?'Points per race start':resultsChartMetric==='finishRate'?'Finish rate':resultsChartMetric==='mechanicalRate'?'Provisional PU/chassis retirements per start':'Championship points scored',
    subtitle: resultsChartMetric==='mechanicalRate'?'Cause-labelled retirements only · lower is better · unclassified cases can undercount':'Official race classifications · higher is better · keep start counts in view',
    valueKey: selectedResult,
    unit: ['finishRate','mechanicalRate'].includes(resultsChartMetric)?'%':resultsChartMetric==='perStart'?' pts/start':' pts',
    digits: resultsChartMetric==='points'?0:3,
    signedValue: false,
    invertBest: resultsChartMetric!=='mechanicalRate'
  });

  return card('Reliability and results',
     'Official race classifications only; sprints excluded. Points and finishing position describe results, not isolated car performance. Generic retirement statuses remain unknown rather than guessing a cause.',
    `<div class="performance-scope-toggle performance-stat-toggle" role="group" aria-label="Results chart measure"><button type="button" data-results-chart="points" aria-pressed="${resultsChartMetric==='points'}">Total points</button><button type="button" data-results-chart="perStart" aria-pressed="${resultsChartMetric==='perStart'}">Points / start</button><button type="button" data-results-chart="finishRate" aria-pressed="${resultsChartMetric==='finishRate'}">Finish rate</button><button type="button" data-results-chart="mechanicalRate" aria-pressed="${resultsChartMetric==='mechanicalRate'}">PU/chassis rate</button></div>`+pointsChart+
    table([
      sortHeader('resultTeam','Team'),
      sortHeader('points','Points',-1),
      sortHeader('pointsPerStart','Points / start',-1),
      sortHeader('finish','Avg. finish'),
      sortHeader('finishRate','Finished / starts',-1),
      sortHeader('mechanicalRate','PU/chassis / starts'),
      sortHeader('pu','PU-related'),
      sortHeader('chassis','Chassis / team'),
      sortHeader('incidents','Incidents'),
      sortHeader('other','Other / unverified')
    ],ordered.map(t=>[
      teamLabel(t),
      t.results&&t.pointsKnown?t.points:'—',
      fmt(t.pointsPerStart,3),
      fmt(avg(t.positions),1),
      `${t.finishes} / ${t.starts}`,
      `${fmt(t.mechanicalRatePct,3,'%')}<small>${t.unknownRetirements} unknown-cause retirements · not counted as mechanical</small>`,
      t.puRetirements > 0 ? `<span class="retirement-badge is-pu">⚙ ${t.puRetirements}</span>` : '0',
      t.chassisRetirements > 0 ? `<span class="retirement-badge is-chassis">🔧 ${t.chassisRetirements}</span>` : '0',
      t.incidentRetirements > 0 ? `<span class="retirement-badge is-incident">💥 ${t.incidentRetirements}</span>` : '0',
      (t.otherRetirements + t.unknownRetirements) > 0 ? `<span class="retirement-badge is-other">${t.otherRetirements + t.unknownRetirements}</span>` : '0'
    ])))+
     card('Retirement classifications',
       'Causes come from the supplied classification status. A generic Retired status does not identify a mechanical failure or accident. DSQ and medical withdrawals do not count as mechanical failures.',
      table([
        'Team',
        'Event',
        'Driver',
        'Category',
         'Supplied classification status',
        'Source attribution'
      ],teams.flatMap(t=>t.retirements.map(r=>[
        teamLabel(t),
        eventLabel(r.event),
        escape(r.driver),
        r.category === 'PU-related'
          ? `<span class="retirement-badge is-pu">⚙ PU</span>`
          : r.category === 'Chassis / team-related'
          ? `<span class="retirement-badge is-chassis">🔧 Chassis</span>`
          : r.category === 'Incident / collision'
          ? `<span class="retirement-badge is-incident">💥 Incident</span>`
          : r.category === 'Other confirmed'
          ? `<span class="retirement-badge is-other">📋 Other</span>`
          : `<span class="retirement-badge is-unknown">❓ Unknown</span>`,
        `<span style="font-weight:600;">${escape(r.cause || 'Unclassified retirement')}</span>`,
        `<small class="perf-tercile-badge is-mid">${escape(r.source || 'Official Timing')}</small>`
      ]))));
}

function pitSummary(events, teams) {
  const teamColors=new Map(teams.map(t=>[t.team,t.color]));
  const visits=[];
  const loadedRaces=events.filter(e=>e.pits);
  const groups=new Map(), drivers=new Map();
  for(const event of loadedRaces) for(const team of event.R?.teams||[]) {
    if(!groups.has(team.team)) groups.set(team.team,{team:team.team,color:teamColors.get(team.team)||team.color,visits:[],events:new Set()});
    for(const driver of team.drivers||[]) {
      const key=`${team.team}:${driver}`;
      if(!drivers.has(key)) drivers.set(key,{team:team.team,color:teamColors.get(team.team)||team.color,driver,visits:[],events:new Set()});
    }
  }
  for(const event of loadedRaces) for(const visit of event.pits.visits||[]) {
    const driver=String(visit.driver||'').trim() || `#${visit.driver_number}`;
    const team=event.R?.teams?.find(t=>t.drivers?.includes(driver))?.team || visit.team || 'Unknown team';
    visits.push({...visit,driver,team,event:event.name,source:event.pits.source});
  }
  for(const visit of visits) {
    if(pitVisitMode==='service'&&visit.visit_type!=='service'&&!finite(visit.stop_duration))continue;
    const teamKey=visit.team, driverKey=`${teamKey}:${visit.driver}`;
    if(!groups.has(teamKey)) groups.set(teamKey,{team:teamKey,color:teamColors.get(teamKey),visits:[],events:new Set()});
    if(!drivers.has(driverKey)) drivers.set(driverKey,{team:teamKey,color:teamColors.get(teamKey),driver:visit.driver,visits:[],events:new Set()});
    for(const group of [groups.get(teamKey),drivers.get(driverKey)]) {
      group.visits.push(visit); group.events.add(visit.event);
    }
  }
  const summarizeTimes=values=>{
    const timed=values.filter(finite);
    return {mean:avg(timed),median:median(timed),fastest:timed.length?Math.min(...timed):null,
      p10:timed.length>=10?percentile(timed,.1):null,p25:percentile(timed,.25),p75:percentile(timed,.75),p90:timed.length>=10?percentile(timed,.9):null,count:timed.length};
  };
  const laneByEvent=new Map();
  for(const visit of visits)if(finite(visit.lane_duration)&&(pitVisitMode==='all'||visit.visit_type==='service'||finite(visit.stop_duration))){
    if(!laneByEvent.has(visit.event))laneByEvent.set(visit.event,new Map());
    const teamVisits=laneByEvent.get(visit.event);
    if(!teamVisits.has(visit.team))teamVisits.set(visit.team,[]);
    teamVisits.get(visit.team).push(visit.lane_duration);
  }
  // A team making several stops must not move the whole GP's field baseline.
  const laneBaselines=new Map([...laneByEvent].map(([event,teamVisits])=>
    [event,median([...teamVisits.values()].map(median))]));
  const summarize=group=>{
    const stop=summarizeTimes(group.visits.map(v=>v.stop_duration));
    const lane=summarizeTimes(group.visits.map(v=>v.lane_duration));
    const groupEvents=new Map();
    for(const visit of group.visits)if(finite(visit.lane_duration)&&finite(laneBaselines.get(visit.event))){
      if(!groupEvents.has(visit.event))groupEvents.set(visit.event,[]);
      groupEvents.get(visit.event).push(visit.lane_duration);
    }
    const laneRelative=summarizeTimes([...groupEvents].map(([event,times])=>median(times)-laneBaselines.get(event)));
    return {...group,stop,lane,laneRelative,avgStop:stop.mean,avgLane:lane.mean,
      stopCount:stop.count,laneCount:lane.count,eventCount:group.events.size};
  };
  return {teams:[...groups.values()].map(summarize),drivers:[...drivers.values()].map(summarize),visits,
    loaded:loadedRaces.length,total:events.filter(e=>completed(e,'Race')).length};
}

function pitMiddleSpread(sample) {
  // A single visit has zero numerical spread but provides no evidence of consistency.
  return sample?.count>=4 && finite(sample.p25) && finite(sample.p75)
    ? sample.p75-sample.p25 : null;
}

function renderPits(teams) {
  const data=pitSummary(events,teams);
  const noStationary=data.visits.length>0 && !data.visits.some(v=>finite(v.stop_duration));
  if(noStationary && pitMeasure==='stop')pitMeasure='lane';
  const isLane=pitMeasure==='lane', relativeLane=isLane&&pitLaneBasis==='event';
  const measure=relativeLane?'laneRelative':isLane?'lane':'stop';
  const isDriver=pitSubject==='driver', rows=isDriver?data.drivers:data.teams;
  const ordered=sorted(rows,{
    pitName:r=>isDriver?r.driver:r.team,
    pitTeam:r=>r.team,
    pitMean:r=>r[measure].mean,
    pitMedian:r=>r[measure].median,
    pitFastest:r=>r[measure].fastest,
    pitP10:r=>r[measure].p10,
    pitP90:r=>r[measure].p90,
    pitSpread:r=>pitMiddleSpread(r[measure]),
    pitCount:r=>r[measure].count,
    pitEvents:r=>r.eventCount
  },'pitMedian');
  const failures=events.filter(e=>completed(e,'Race')&&e.pitError);
  const pending=data.total-data.loaded-failures.length;
  const note=`${data.loaded}/${data.total} race${data.total===1?'':'s'} loaded${pending>0?' · loading pit timing…':''}${failures.length?` · ${failures.length} race${failures.length===1?'':'s'} unavailable`:''}. Stationary is the broadcast-style time stopped at the box; pit-lane time includes the stop. Raw summaries weight every timed visit; GP-relative lane summaries compare each team or driver's GP median with the median of team GP medians, then give each GP equal weight. Mean includes long stops; median shows a typical visit; the middle-50% spread shows consistency (≥4 samples); P10 and P90 show the quick and slow tails (≥10 samples). Missing stationary times are never inferred.`;
  const controls=`<div class="performance-pit-controls">
    <div class="performance-scope-toggle" role="group" aria-label="Pit visit eligibility"><button type="button" data-pit-visits="service" aria-pressed="${pitVisitMode==='service'}">Confirmed service</button><button type="button" data-pit-visits="all" aria-pressed="${pitVisitMode==='all'}">All lane visits · diagnostic</button></div>
    <div class="performance-scope-toggle" role="group" aria-label="Pit timing measurement">
      <button type="button" data-pit-measure="stop" aria-pressed="${!isLane}" ${noStationary?'disabled title="No published stationary times for these visits"':''}>Stationary stop</button>
      <button type="button" data-pit-measure="lane" aria-pressed="${isLane}">Pit lane</button>
    </div>
    <div class="performance-scope-toggle" role="group" aria-label="Pit timing subject">
      <button type="button" data-pit-subject="team" aria-pressed="${!isDriver}">Teams</button>
      <button type="button" data-pit-subject="driver" aria-pressed="${isDriver}">Drivers</button>
    </div>
    ${isLane?`<div class="performance-scope-toggle" role="group" aria-label="Pit-lane comparison basis"><button type="button" data-pit-lane-basis="raw" aria-pressed="${!relativeLane}">Raw seconds</button><button type="button" data-pit-lane-basis="event" aria-pressed="${relativeLane}">Vs GP median</button></div>`:''}
    <div class="performance-scope-toggle" role="group" aria-label="Pit timing chart statistic">
      <button type="button" data-pit-chart="mean" aria-pressed="${pitChartMetric==='mean'}">Mean</button>
      <button type="button" data-pit-chart="median" aria-pressed="${pitChartMetric==='median'}">Median</button>
      <button type="button" data-pit-chart="fastest" aria-pressed="${pitChartMetric==='fastest'}">Quickest</button>
      <button type="button" data-pit-chart="spread" aria-pressed="${pitChartMetric==='spread'}">Middle 50%</button>
      <button type="button" data-pit-chart="p10" aria-pressed="${pitChartMetric==='p10'}">P10 quick end</button>
      <button type="button" data-pit-chart="p90" aria-pressed="${pitChartMetric==='p90'}">P90 slow tail</button>
    </div>
  </div>`;
  const chartRows=ordered.map(r=>({...r,displayName:isDriver?r.driver:r.team,
    logoTeam:r.team,chartValue:pitChartMetric==='spread'?pitMiddleSpread(r[measure]):r[measure][pitChartMetric]}));
  const chartTitle=pitChartMetric==='spread'?'Middle-50% spread':pitChartMetric==='p10'?'P10 quick-end time':pitChartMetric==='p90'?'P90 slow-tail time':pitChartMetric==='mean'?'Mean time':pitChartMetric==='fastest'?(relativeLane?'Best GP gap':'Quickest visit'):'Median time';
  const chart=renderHorizontalBarChart(chartRows,{
    title:`${chartTitle} · ${relativeLane?'vs GP median':isLane?'pit lane':'stationary stop'} · ${isDriver?'drivers':'teams'}`,
    subtitle:pitChartMetric==='spread'
      ? `75th minus 25th percentile · at least four ${relativeLane?'GPs':'visits'} · lower is more consistent`
      : pitChartMetric==='p10'||pitChartMetric==='p90'?`${pitChartMetric==='p10'?'10th':'90th'} percentile · at least ten ${relativeLane?'GPs':'visits'} · lower is better`
      : relativeLane?'Equal-weighted GP median gaps; zero is the GP field median':'Visit-weighted seconds · lower is faster',
    valueKey:'chartValue',labelKey:isDriver?'driver':'team',unit:' s',digits:3,signedValue:relativeLane&&pitChartMetric!=='spread',preserveSignedValues:relativeLane&&pitChartMetric!=='spread',zeroBaseline:true
  });
  const metricLabel=relativeLane?'vs GP median':isLane?'pit lane':'stationary stop';
  const summary=card('Pit stops & pit lane',note,
    `<p class="performance-note">${pitVisitMode==='service'?'Ranking confirmed service visits only.':'Diagnostic: includes all service, pass-through and unclassified visits.'} ${data.visits.filter(v=>v.visit_type!=='service'&&!finite(v.stop_duration)).length} visits lack confirmed service evidence. Missing stationary timing alone does not identify a pass-through; all visits remain in the evidence table.</p>`+
    (failures.length?`<p class="performance-note">${failures.map(e=>`${escape(e.name)}: ${escape(e.pitError)}`).join(' · ')} <button type="button" class="performance-explain-toggle" data-pit-retry>Retry unavailable</button></p>`:'')+
    (noStationary?'<p class="performance-note">The source has no stationary-at-the-box values for this selection. “—” means unavailable, not a zero-second stop.</p>':'')+
    controls+
    (chart||`<p class="section-empty">${pitChartMetric==='spread'?'At least four samples per team or driver are needed for the middle-50% chart.':['p10','p90'].includes(pitChartMetric)?'At least ten samples per team or driver are needed for this percentile chart.':'No timed pit visits for the selected races yet.'}</p>`)+
    table([sortHeader('pitName',isDriver?'Driver':'Team'),...(isDriver?[sortHeader('pitTeam','Team')]:[]),
      sortHeader('pitMean',`Mean ${metricLabel}`),sortHeader('pitMedian','Median'),sortHeader('pitFastest',relativeLane?'Best GP gap':'Quickest'),
      sortHeader('pitSpread','Middle 50% spread'),sortHeader('pitP10','P10 quick end'),sortHeader('pitP90','P90 slow tail'),sortHeader('pitCount',relativeLane?'GP samples':'Timed visits',-1),sortHeader('pitEvents','Races',-1)],
      ordered.map(r=>[isDriver?escape(r.driver):teamLabel(r),...(isDriver?[teamLabel(r)]:[]),
        relativeLane?signed(r[measure].mean,3,' s'):fmt(r[measure].mean,3,' s'),
        relativeLane?signed(r[measure].median,3,' s'):fmt(r[measure].median,3,' s'),
        relativeLane?signed(r[measure].fastest,3,' s'):fmt(r[measure].fastest,3,' s'),
        finite(pitMiddleSpread(r[measure]))
          ? `${fmt(pitMiddleSpread(r[measure]),3,' s')}<small>${fmt(r[measure].p25,3)}–${fmt(r[measure].p75,3)} s</small>`
          : '—',
        relativeLane?signed(r[measure].p10,3,' s'):fmt(r[measure].p10,3,' s'),
        relativeLane?signed(r[measure].p90,3,' s'):fmt(r[measure].p90,3,' s'),r[measure].count,r.eventCount])));
  const individual=`<details class="dashboard-card performance-methods" ${context?.scope==='tracks'&&context.selectedTracks?.length===1?'open':''}><summary>Exact times for individual pit visits and timing sources</summary>${table(
    ['Grand Prix','Team','Driver','In-lap','Stationary','Pit lane','Source','Visit evidence'],
    data.visits.sort((a,b)=>a.event.localeCompare(b.event)||a.lap-b.lap).map(v=>[
      eventLabel(v.event),teamLabel(v),escape(v.driver),`L${v.lap}`,exactSeconds(v.stop_duration),exactSeconds(v.lane_duration),escape(v.source),escape(`${v.visit_type||'unknown'} · ${v.visit_evidence||'classification unavailable'}`)
    ]))}</details>`;
  return summary+individual;
}

function huberRegression(rounds, paces) {
  const n = rounds.length;
  if (n < 2) return { slope: null, intercept: null };
  const meanR = avg(rounds);
  const meanP = avg(paces);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (rounds[i] - meanR) * (paces[i] - meanP);
    den += (rounds[i] - meanR) * (rounds[i] - meanR);
  }
  let b = den > 0 ? num / den : 0;
  let a = meanP - b * meanR;

  let res = paces.map((p, i) => p - (a + b * rounds[i]));
  let medRes = median(res);
  let mad = median(res.map(r => Math.abs(r - medRes)));
  let s = 1.4826 * mad;
  if (!finite(s) || s < 1e-6) return { slope: b, intercept: a };

  const c = 1.345;
  for (let iter = 0; iter < 50; iter++) {
    let wSum = 0, wXSum = 0, wYSum = 0;
    const weights = [];
    for (let i = 0; i < n; i++) {
      const u = Math.abs(res[i]) / s;
      const w = u <= c ? 1.0 : c / u;
      weights.push(w);
      wSum += w;
      wXSum += w * rounds[i];
      wYSum += w * paces[i];
    }
    if (wSum <= 0) break;
    const wXMean = wXSum / wSum;
    const wYMean = wYSum / wSum;
    let wNum = 0, wDen = 0;
    for (let i = 0; i < n; i++) {
      wNum += weights[i] * (rounds[i] - wXMean) * (paces[i] - wYMean);
      wDen += weights[i] * (rounds[i] - wXMean) * (rounds[i] - wXMean);
    }
    const bNew = wDen > 0 ? wNum / wDen : b;
    const aNew = wYMean - bNew * wXMean;
    if (Math.abs(bNew - b) < 1e-6) {
      b = bNew; a = aNew;
      break;
    }
    b = bNew; a = aNew;
    res = paces.map((p, i) => p - (a + b * rounds[i]));
    const newMad = median(res.map(r => Math.abs(r)));
    s = Math.max(1e-6, 1.4826 * newMad);
  }
  return { slope: b, intercept: a };
}

function renderTrend(teams) {
  if (!context?.season) {
    return card('Performance trend', 'Season progression requires multi-event data.',
      `<div class="performance-empty" style="padding: 48px 24px;">
        <div class="empty-icon-badge">📈</div>
        <h3>Season performance trend requires multiple events</h3>
        <p>You are currently analysing a single track (<strong>${escape(events[0]?.name || 'Grand Prix')}</strong>). Car development curves and performance progression measure how teams evolve round-by-round across the championship.</p>
        <p style="margin-top: 10px; color: var(--text-secondary);">To view season performance trends, set <strong>Scope</strong> to <strong>Season to date</strong> or select multiple tracks in the tray above.</p>
      </div>`);
  }
  const trendRows = teams.map(t => {
    const valid = t.q.filter(q => finite(q.pace)).sort((a,b)=>a.round-b.round);
    let first = null, last = null, label = '';
    let slopePerRound = null;
    let modelledShift = null;
    let leaveEventRange = null;
    const n = valid.length;

    if (n >= 2) {
      const k = n >= 4 ? Math.max(2, Math.min(6, Math.floor(n / 4))) : 1;
      first = median(valid.slice(0, k).map(q => q.pace));
      last = median(valid.slice(-k).map(q => q.pace));
      label = n >= 4 ? `Median first ${k} → last ${k}` : `R${valid[0].round} → R${valid.at(-1).round}`;

      const h = huberRegression(valid.map(q => q.round), valid.map(q => q.pace));
      slopePerRound = h.slope;
      const roundSpan = valid.at(-1).round - valid[0].round;
      modelledShift = finite(slopePerRound) ? slopePerRound * roundSpan : null;
      if(n>=5){
        const rates=valid.map((_,i)=>{const subset=valid.filter((_,j)=>j!==i);return huberRegression(subset.map(q=>q.round),subset.map(q=>q.pace)).slope;}).filter(finite);
        if(rates.length)leaveEventRange=[Math.min(...rates),Math.max(...rates)];
      }
    }

    const change = (finite(first) && finite(last)) ? last - first : null;
    const sampleTier = n >= 15 ? 'Robust (≥15 events)' : n >= 10 ? 'Provisional (10–14 events)' : 'Raw (<10 events)';
    const sampleTierClass = n >= 15 ? 'is-fast' : n >= 10 ? 'is-mid' : 'is-slow';
    return { team: t, valid, first, last, change, modelledShift, slopePerRound, leaveEventRange, sampleTier, sampleTierClass, label, count: n };
  });

  const ordered = sorted(trendRows, {
    trendTeam: r => r.team.team,
    trendFirst: r => r.first,
    trendLast: r => r.last,
    trendChange: r => r.change,
    trendModelled: r => r.modelledShift,
    trendSlope: r => r.slopePerRound,
    trendCount: r => r.count
  }, trendView==='fitted'?'trendModelled':'trendChange');

   return card('Relative qualifying progress',
     `Ranked by ${trendView==='fitted'?'a robust fitted rate across measured rounds':'the observed change between median opening and latest event groups'}. More negative means the team closed the gap to the quickest car. This measures relative one-lap progress, not a proven upgrade effect.`,
    `<div class="performance-scope-toggle performance-stat-toggle" role="group" aria-label="Development trend ranking"><button type="button" data-trend-view="observed" aria-pressed="${trendView==='observed'}">Opening → latest median</button><button type="button" data-trend-view="fitted" aria-pressed="${trendView==='fitted'}">Robust fitted trend</button></div>`+'<div class="performance-trend-table">'+table([
      sortHeader('trendTeam', 'Team'),
      'Qualifying gap by round',
      sortHeader('trendLast', 'Opening → latest gap'),
      sortHeader('trendChange', 'Change in gap'),
      'Leave-one-GP-out fitted rate',
      'Coverage'
    ], ordered.map(row => {
      const t = row.team, valid = row.valid, first = row.first, last = row.last;
      const enough = valid.length >= 2;
      const ceiling = Math.max(1, ...teams.flatMap(t => t.q.map(q => q.pace).filter(finite)));
      const rateText = enough && finite(row.slopePerRound)
        ? `${row.slopePerRound > 0 ? '+' : ''}${fmt(row.slopePerRound, 3, '% / round')}`
        : '—';
      return [
        teamLabel(t),
        `<div class="performance-trend" style="--team-color:${color(t.color)}">${t.q.map(q => `<span style="height:${finite(q.pace) ? Math.max(6, q.pace / ceiling * 100) : 0}%;${finite(q.pace) ? '' : 'background:transparent'}" title="R${q.round} ${escape(q.event)}: ${fmt(q.pace, 3, '%')}" aria-label="R${q.round}: ${fmt(q.pace, 3, '%')}"></span>`).join('')}</div><div class="performance-trend-label"><span>R${t.q[0]?.round ?? '—'}</span><span>R${t.q.at(-1)?.round ?? '—'}</span></div>`,
        enough ? `${fmt(first, 3, '%')} → ${fmt(last, 3, '%')}<small>${escape(row.label)}</small>` : 'Needs ≥ 2 events',
        enough && finite(row.change) ? `${signed(row.change, 3, ' pp')}<small>Fitted: ${rateText}</small>` : '—',
        row.leaveEventRange?`${signed(row.leaveEventRange[0],3)} to ${signed(row.leaveEventRange[1],3)} pp/round<small>Sensitivity, not an uncertainty interval</small>`:'—',
        `<span class="perf-tercile-badge ${row.sampleTierClass}">${row.count} event${row.count===1?'':'s'} · ${escape(row.sampleTier.split(' ')[0])}</span>`
      ];
    })))+'</div>' + card('FIA updates',
      'Upgrade components submitted to the FIA before each event. Upgrade counts are not weighted by importance, and a before/after pace change cannot establish causation.',
      '<p><a href="https://www.fia.com/documents" target="_blank" rel="noopener" class="perf-link">Open FIA event documents ↗</a></p><p class="performance-note">Component counts from Car Presentation Submissions are not weighted by competitive impact, and public lap times cannot isolate aerodynamic package gains from setup or driver variation. No synthetic upgrade gains are inferred.</p>');
}

function eventTelemetry(event) {
  // Straight-line and braking telemetry do not depend on corner detection.
  // A valid GPS trace without corner markers must still appear in those views.
  const entrants=(event.Q?.teams||[]).filter(team=>event.traces?.[team.team] && !event.traces[team.team].error);
  const cornerEntrants=entrants.filter(team=>event.traces[team.team].corners?.length);
  const labels=cornerEntrants[0] ? event.traces[cornerEntrants[0].team].corners.map(c=>c.corner)
    .filter(label=>cornerEntrants.every(team=>event.traces[team.team].corners.some(c=>c.corner===label))) : [];
  const groups={low:[],medium:[],high:[]};
  for(const label of labels) {
    const observations=cornerEntrants.map(team=>event.traces[team.team].corners.find(c=>c.corner===label)).filter(Boolean);
    const speed=median(observations.map(c=>c.minimum));
    groups[speed<=120?'low':speed<=200?'medium':'high'].push(label);
  }
  const rows=new Map();
  for(const team of entrants) {
    const trace=event.traces[team.team], categories={};
    for(const [name,labels] of Object.entries(groups)) {
      const corners=(trace.corners||[]).filter(c=>labels.includes(c.corner));
      categories[name]=corners.length ? {
        speed:corners.reduce((sum,c)=>sum+c.length,0)/corners.reduce((sum,c)=>sum+c.time,0)*3.6,
        corners:corners.length,
      }:null;
    }
    rows.set(team.team,{team:team.team,color:team.color,lap:trace.selection||team.lap,trace,categories:trace.categories||categories});
  }
  for(const name of ['low','medium','high']) {
    const best=Math.max(...[...rows.values()].map(row=>row.categories[name]?.speed).filter(finite));
    for(const row of rows.values())if(!row.trace.categories&&finite(row.categories[name]?.speed))row.categories[name].deficit=(best/row.categories[name].speed-1)*100;
  }
  const bestTop=Math.max(...[...rows.values()].map(row=>row.trace.top_speed).filter(finite));
  const bestFull=Math.max(...[...rows.values()].map(row=>row.trace.full_throttle_p95).filter(finite));
  for(const row of rows.values()) {
    row.topDeficit=finite(row.trace.top_speed)&&bestTop>0?(1-row.trace.top_speed/bestTop)*100:null;
    row.fullDeficit=finite(row.trace.full_throttle_p95)?(bestFull/row.trace.full_throttle_p95-1)*100:null;
  }
  // Compare identical speed drops within each physical straight-braking zone.
  // A team missing one zone retains its other supported measurements.
  const reports=[];
  const labelsBrake=[...new Set([...rows.values()].flatMap(row=>(row.trace.braking||[])
    .filter(z=>z.method==='matched-speed-v1'&&z.mode==='straight').map(z=>z.corner)))];
  for(const label of labelsBrake) {
    const measured=[...rows.values()].map(row=>({row,z:row.trace.braking?.find(z=>z.corner===label&&z.method==='matched-speed-v1'&&z.mode==='straight')}))
      .filter(({z})=>finite(z?.duration)&&z.duration>0&&z.entry_speed-z.exit_speed>=50&&(brakingQualityMode==='all'||z.quality==='supported'));
    if(measured.length<3)continue;
    const first=measured[0].z;
    const same=measured.filter(({z})=>z.entry_speed===first.entry_speed&&z.exit_speed===first.exit_speed);
    if(same.length<3)continue;
    reports.push({event:{name:label},summary:{rows:new Map(same.map(({row,z})=>[row.team,{team:row.team,z}]))}});
  }
  const approachReports=reports.map(report=>({...report,summary:{rows:new Map([...report.summary.rows]
    .filter(([,row])=>row.z.approach_comparable!==false&&finite(row.z.approach_time)))}}))
    .filter(report=>report.summary.rows.size>=3);
  // Choose one observed rectangle once. Both views use exactly that evidence;
  // a sparse model must not independently bridge their missing measurements.
  const pairedReports=approachReports.map(report=>({...report,summary:{rows:new Map([...report.summary.rows]
    .filter(([team,{z}])=>{
      const row=rows.get(team),source=z.source_selection||row.trace.braking_selection||row.trace.selection;
      const best=entrants.find(t=>t.team===team)?.lap;
      return z.source_laps===1&&row.trace.braking_selection_policy==='fastest-qualifying-lap-only'
        &&source&&(!best||(source.driver===best.driver&&source.lap===best.lap&&Math.abs(source.time-best.time)<.0005))
        &&(z.approach_source_lap==null||z.approach_source_lap===source.lap);
    }))}})).filter(r=>r.summary.rows.size>=3);
  const paired=pairedBrakingScores(pairedReports,row=>row.z.duration,row=>row.z.approach_time*1000);
  const approachScores=paired.approach,pairedSlowing=paired.slowing,pairedLog=pairedBrakingScores(
    pairedReports,row=>100*Math.log(row.z.duration),row=>row.z.approach_time*1000).slowing;
  for(const row of rows.values()) {
    row.brakingApproachMs=null;row.brakingSlowingS=null;
    row.brakingCoverage=paired.coverage;
    row.brakeEvidence=row.trace.braking||[];
    const zones=pairedReports.filter(r=>paired.coverage?.events.includes(r.event.name)).map(r=>r.summary.rows.get(row.team)?.z).filter(Boolean);
    if(!zones.length||!pairedSlowing.has(row.team))continue;
    row.brakingScore=pairedLog.get(row.team);
    row.brakingSlowingS=pairedSlowing.get(row.team)??null;
    row.brakingApproachMs=approachScores.get(row.team)??null;
    row.brakingScoreZones=zones.length;
    row.brakingScoreCohort=paired.coverage.teams.length;
    row.brakingApproachZones=zones.length;
    row.brakingStability=paired.stability.get(row.team);
    row.brakingApproachResolution=median(zones.map(z=>z.approach_resolution_s).filter(finite));
    row.brakingResolution=median(zones.map(z=>z.timing_resolution_s).filter(finite));
    row.brakingRepeatSpread=median(zones.map(z=>z.repeat_spread_s).filter(finite));
    row.brakeZones=zones.length;
    row.brakeDistance=median(zones.map(z=>z.distance));
    row.brakeMeanG=median(zones.map(z=>z.mean_g));
    row.brakeG=null;
    row.brakePowerProxy=median(zones.map(z=>z.power_proxy_kw_per_tonne));
    row.brakeDuration=median(zones.map(z=>z.duration));
    row.brakeEntrySpeed=median(zones.map(z=>z.entry_speed));
    row.brakeTurnInSpeed=median(zones.map(z=>z.exit_speed));
    row.normalizedDecel=median(zones.map(z=>z.normalized_decel_g));
    row.samplingResolution=median(zones.map(z=>z.sampling_resolution_m));
    row.mixedBrakeZones=0;
    row.brakeMeasurements=zones;
    row.limitedBrakeZones=zones.filter(z=>z.quality!=='supported').length;
  }
  return {rows,groups,entrants,brakingCoverage:paired.coverage,brakingReports:pairedReports};
}

function pairedBrakingScores(reports, slowingOf, approachOf, mode='mean') {
  const paired=reports.map(r=>({...r,summary:{rows:new Map([...r.summary.rows]
    .filter(([,row])=>finite(slowingOf(row))&&finite(approachOf(row))))}}));
  const membership=eventAdjustedScores(paired,()=>0,mode,'common');
  const coverage=membership.coverage||{teams:[],events:[]},centre=mode==='median'?median:avg;
  const supported=paired.filter(r=>coverage.events.includes(r.event.name));
  const calculate=(valueOf,subset=supported)=>{
    const values=new Map(coverage.teams.map(t=>[t,centre(subset.map(r=>valueOf(r.summary.rows.get(t))))]));
    if(!subset.length)return new Map();
    const best=Math.min(...values.values()),scores=new Map([...values].map(([t,v])=>[t,Math.max(0,v-best)]));
    scores.coverage=coverage;return scores;
  };
  const slowing=calculate(slowingOf),approach=calculate(approachOf),stability=new Map();
  const rank=(scores,t)=>1+[...scores.values()].filter(v=>v<scores.get(t)-1e-9).length;
  for(const team of coverage.teams) {
    const a=[rank(approach,team)],s=[rank(slowing,team)];
    if(supported.length>1)for(let i=0;i<supported.length;i++) {
      const subset=supported.filter((_,j)=>i!==j);
      a.push(rank(calculate(approachOf,subset),team));s.push(rank(calculate(slowingOf,subset),team));
    }
    stability.set(team,{approach:[Math.min(...a),Math.max(...a)],slowing:[Math.min(...s),Math.max(...s)],samples:supported.length});
  }
  return {slowing,approach,coverage,stability};
}

function brakingSupportMarkup(coverage, values, season=false) {
  const c=coverage||{teams:[],events:[]},unit=season?'GP':'zone';
  const stability=values.filter(t=>t.brakingStability).map(t=>{
    const s=t.brakingStability,format=a=>a[0]===a[1]?`P${a[0]}`:`P${a[0]}–P${a[1]}`;
    return `${escape(t.team)}: approach ${format(s.approach)}, slowing ${format(s.slowing)}`;
  }).join(' · ');
  return `<details class="performance-evidence" open><summary>Shared ranking support · ${c.events.length} ${unit}${c.events.length===1?'':'s'} · ${c.teams.length} teams</summary><p class="performance-note">${c.events.length?`Both charts use: ${c.events.map(escape).join(' · ')}. Teams: ${c.teams.map(escape).join(', ')}.`:'No common paired measurements on the fastest qualifying laps. Missing telemetry is not replaced by a slower lap.'}</p><p class="performance-note">${c.events.length>1?`Leave-one-${unit}-out rank range (same teams; sensitivity, not a confidence interval): ${stability||'unavailable'}.`:`Only ${c.events.length} shared ${unit}: insufficient coverage for a leave-one-out stability check.`}</p></details>`;
}

function brakingEvidenceMarkup(sourceEvents) {
  return `<details class="performance-evidence"><summary>Fastest qualifying laps · boundary speeds and zone evidence</summary>${table(
    ['Grand Prix / team','Source lap · both timings','Zone / track window','Approach boundary speeds','Approach time','Same-speed slowing','Evidence'],
    sourceEvents.flatMap(event=>{
      const summary=eventTelemetry(event);
      return (event.Q?.teams||[]).flatMap(team=>{
        const row=summary.rows.get(team.team),best=team.lap;
        if(!row?.brakeEvidence?.length)return [[`${escape(event.name)}<small>${teamLabel(team)}</small>`,
          `${escape(best?.driver||'—')} · L${best?.lap??'—'}<small>${fmt(best?.time,3,' s')} · fastest only</small>`,
          '—','—','—','—',escape(row?.trace?.braking_exclusion||'Fastest qualifying lap has no usable paired telemetry; no slower replacement.')]];
        return row.brakeEvidence.map(z=>{
        const source=z.source_selection||row.trace.braking_selection||{};
        const ranked=row.brakeMeasurements?.some(m=>m.corner===z.corner);
        return [ `${escape(event.name)}<small>${teamLabel(row)}</small>`,
          `${escape(source.driver||'—')} · L${source.lap??'—'} · ${escape(source.phase||'—')}<small>${fmt(source.time,3,' s')} · ${escape(source.compound||'—')} · fastest only</small>`,
          `${escape(z.corner)}<small>${finite(z.zone_start_m)&&finite(z.zone_end_m)?`${fmt(z.zone_start_m,1)}–${fmt(z.zone_end_m,1)} m`:`${fmt(z.approach_distance,1,' m')} approach · position bounds unavailable`}</small>`,
          `${fmt(z.approach_entry_speed,3)} → ${fmt(z.approach_exit_speed,3)} km/h`,
          `${fmt(z.approach_time,3,' s')}<small>${fmt(z.approach_resolution_s,3,' s')} endpoint brackets</small>`,
          `${fmt(z.duration,3,' s')}<small>${fmt(z.entry_speed,0)} → ${fmt(z.exit_speed,0)} km/h${finite(z.speed_high_m)&&finite(z.speed_low_m)?` · ${fmt(z.speed_high_m,1)}–${fmt(z.speed_low_m,1)} m`:''}</small>`,
          `${ranked?'GP ranking':'Evidence only'} · ${escape(z.quality||'unavailable')}<small>1 lap · ${z.native_interior_samples??'—'} native interior points · ${fmt(z.timing_resolution_s,3,' s')} slowing endpoint brackets</small>` ];
      });});
    }))}</details>`;
}

function eventAdjustedScores(reports, valueOf, mode='mean',coverageMode=typeof telemetryCoverageMode==='undefined'?'inferred':telemetryCoverageMode) {
  let observations=[];
  for(const {event,summary} of reports) {
    const measured=[...summary.rows.values()].map(row=>({team:row.team,value:valueOf(row)}))
      .filter(item=>finite(item.value));
    if(measured.length<3)continue;
    for(const item of measured)observations.push({...item,event:event.name});
  }
  if(!observations.length)return new Map();
  if(coverageMode==='common') {
    const teams=[...new Set(observations.map(o=>o.team))].sort();
    const byEvent=new Map();
    for(const o of observations){if(!byEvent.has(o.event))byEvent.set(o.event,new Map());byEvent.get(o.event).set(o.team,o.value);}
    let best=null;
    // Largest complete observed rectangle: no missing team/GP is imputed.
    for(let mask=1;mask<2**teams.length;mask++) {
      const cohort=teams.filter((_,i)=>mask&(2**i));if(cohort.length<3)continue;
      const eventIds=[...byEvent].filter(([,r])=>cohort.every(t=>r.has(t))).map(([id])=>id);
      const support=cohort.length*eventIds.length;
      if(eventIds.length&&(!best||support>best.support||support===best.support&&cohort.length>best.cohort.length))best={cohort,eventIds,support};
    }
    if(!best)return new Map();
    const centre=mode==='median'?median:avg;
    const values=new Map(best.cohort.map(t=>[t,centre(best.eventIds.map(id=>byEvent.get(id).get(t)))]));
    const baseline=Math.min(...values.values());
    const result=new Map([...values].map(([t,v])=>[t,Math.max(0,v-baseline)]));
    result.coverage={teams:best.cohort,events:best.eventIds};
    return result;
  }
  const graph=new Map();
  const byEvent=new Map();
  for(const observation of observations){
    if(!byEvent.has(observation.event))byEvent.set(observation.event,[]);
    byEvent.get(observation.event).push(observation.team);
  }
  for(const cohort of byEvent.values())for(const team of cohort){
    if(!graph.has(team))graph.set(team,new Set());
    for(const peer of cohort)graph.get(team).add(peer);
  }
  const unseen=new Set(graph.keys()),components=[];
  while(unseen.size){
    const group=new Set(),pending=[unseen.values().next().value];
    while(pending.length){const team=pending.pop();if(group.has(team))continue;group.add(team);unseen.delete(team);for(const peer of graph.get(team))if(!group.has(peer))pending.push(peer);}
    components.push(group);
  }
  components.sort((a,b)=>b.size-a.size||observations.filter(o=>b.has(o.team)).length-observations.filter(o=>a.has(o.team)).length||[...a].sort().join().localeCompare([...b].sort().join()));
  const supported=components[0];
  observations=observations.filter(o=>supported.has(o.team));
  const teams=[...new Set(observations.map(o=>o.team))];
  const eventIds=[...new Set(observations.map(o=>o.event))];
  const eventRows=new Map(eventIds.map(event=>[event,observations.filter(o=>o.event===event)]));
  const teamRows=new Map(teams.map(team=>[team,observations.filter(o=>o.team===team)]));
  const teamEffect=new Map(teams.map(team=>[team,0]));
  const eventEffect=new Map(eventIds.map(event=>[event,0]));
  // Two-way event/constructor effects use the overlapping teams as bridges.
  // This avoids declaring two different sets of circuits directly comparable.
  const centreOf=mode==='median'?median:avg;
  for(let iteration=0;iteration<40;iteration++) {
    const previous=new Map(teamEffect);
    for(const event of eventIds)eventEffect.set(event,centreOf(eventRows.get(event)
      .map(o=>o.value-teamEffect.get(o.team))));
    for(const team of teams)teamEffect.set(team,centreOf(teamRows.get(team)
      .map(o=>o.value-eventEffect.get(o.event))));
    const centre=centreOf([...teamEffect.values()]);
    for(const team of teams)teamEffect.set(team,teamEffect.get(team)-centre);
    if(Math.max(...teams.map(team=>Math.abs(teamEffect.get(team)-previous.get(team))))<1e-9)break;
  }
  const best=Math.min(...teamEffect.values());
  return new Map(teams.map(team=>[team,Math.max(0,teamEffect.get(team)-best)]));
}

function seasonRaceTrapRows(sourceEvents, mode='mean') {
  const reports=[], coverage=new Map();
  for(const event of sourceEvents) {
    const race=(event.R?.teams||[]).filter(t=>finite(t.race_speed_trap_matched));
    if(race.length<3)continue;
    const fastestRace=Math.max(...race.map(t=>t.race_speed_trap_matched));
    const qualifying=(event.Q?.teams||[]).filter(t=>finite(t.speed_trap));
    const fastestQualifying=qualifying.length>=3?Math.max(...qualifying.map(t=>t.speed_trap)):null;
    const qByTeam=new Map(qualifying.map(t=>[t.team,t]));
    const rows=new Map();
    for(const team of race) {
      const q=qByTeam.get(team.team);
      rows.set(team.team,{
        team:team.team,
        raceGap:(fastestRace-team.race_speed_trap_matched)/fastestRace*100,
        qualyGap:q&&finite(fastestQualifying)?(fastestQualifying-q.speed_trap)/fastestQualifying*100:null
      });
      if(!coverage.has(team.team))coverage.set(team.team,{
        team:team.team,color:team.color,matched:[],peak:[],median:[],finish:[],laps:0,events:0,paired:0
      });
      const item=coverage.get(team.team);
      item.matched.push(team.race_speed_trap_matched);
      if(finite(team.race_speed_trap_max))item.peak.push(team.race_speed_trap_max);
      if(finite(team.race_speed_trap_median))item.median.push(team.race_speed_trap_median);
      if(finite(team.race_speed_fl_max))item.finish.push(team.race_speed_fl_max);
      item.laps+=team.race_speed_trap_matched_laps||0;
      item.events++;
      if(finite(rows.get(team.team).qualyGap))item.paired++;
    }
    reports.push({event,summary:{rows}});
  }
  const raceScores=eventAdjustedScores(reports,row=>row.raceGap,mode);
  const qualyScores=eventAdjustedScores(reports,row=>row.qualyGap,mode);
  return [...coverage.values()].map(row=>({
    ...row,
    raceDeficit:raceScores.get(row.team)??null,
    qualyDeficit:qualyScores.get(row.team)??null,
    matchedSpeed:avg(row.matched),peakSpeed:avg(row.peak),
    medianSpeed:avg(row.median),finishLineSpeed:avg(row.finish)
  }));
}

function seasonTelemetry(mode='mean') {
  const map=new Map();
  const reports=events.map(event=>({event,summary:eventTelemetry(event)})).filter(r=>r.summary.rows.size);
  // A valid race need not contain all season entrants. Keep each measured
  // team's observation and disclose its own sample count rather than dropping
  // the race for everyone when one GPS trace fails.
  const targetReports=reports.filter(r=>r.summary.rows.size>=2);
  for(const {summary} of targetReports) {
    const brakingComparable=[...summary.rows.values()].filter(row=>finite(row.brakingScore)).length>=3;
    for(const row of summary.rows.values()) {
      if(!map.has(row.team))map.set(row.team,{
        team:row.team,color:row.color,low:[],medium:[],high:[],
        lowDeficit:[],mediumDeficit:[],highDeficit:[],lowSeconds:[],mediumSeconds:[],highSeconds:[],
        lapGaps:[],top:[],full:[],topDeficit:[],fullDeficit:[],straightDeficit:[],
        straightContribution:[],cornerContribution:[],brakeG:[],brakeMeanG:[],brakePowerProxy:[],brakingScore:[],brakingSlowingS:[],brakingApproachMs:[],brakingScoreZones:[],brakingReferenceLap:[],
        brakeDistance:[],brakeDistDelta:[],brakeDuration:[],brakeEntrySpeed:[],brakeTurnInSpeed:[],
        normalizedDecel:[],brakeTimeDelta:[],samplingResolution:[],brakingResolution:[],brakingRepeatSpread:[],coreGaps:[],coreDistance:[],coreWindows:[],
        terminalZoneMeanSpeed:[],terminalZoneLength:[],
        accel250:[],accel250Pct:[],accel200:[],accel320:[],accelBands:Object.fromEntries(STRAIGHT_BANDS.map(key=>[key,[]])),straightTraversalDelta:[],speedSt:[],speedFl:[],
        events:0,zones:0,mixedBrakeZones:0,limitedBrakeZones:0
      });
      const item=map.get(row.team); item.events++;
      for(const name of ['low','medium','high'])if(finite(row.categories[name]?.speed)) {
        item[name].push(row.categories[name].speed);
        item[`${name}Deficit`].push(row.categories[name].deficit);
        item[`${name}Seconds`].push(row.categories[name].time_lost);
      }
      item.lapGaps.push(row.trace.lap_gap);
      if(finite(row.trace.top_speed))item.top.push(row.trace.top_speed);
      if(finite(row.trace.full_throttle_p95))item.full.push(row.trace.full_throttle_p95);
      if(finite(row.topDeficit))item.topDeficit.push(row.topDeficit);
      if(finite(row.fullDeficit))item.fullDeficit.push(row.fullDeficit);
      if(finite(row.trace.straight_deficit))item.straightDeficit.push(row.trace.straight_deficit);
      if(finite(row.trace.straight_contribution))item.straightContribution.push(row.trace.straight_contribution);
      if(finite(row.trace.straight_traversal_delta))item.straightTraversalDelta.push(row.trace.straight_traversal_delta);
      if(finite(row.trace.straight_core_delta)) {
        item.coreGaps.push(row.trace.straight_core_delta);
        item.coreDistance.push(row.trace.straight_core_distance_m);
        item.coreWindows.push(row.trace.straight_core_windows?.length||0);
      }
      if(finite(row.trace.accel_250_300))item.accel250.push(row.trace.accel_250_300);
      if(finite(row.trace.accel_250_300_pct))item.accel250Pct.push(row.trace.accel_250_300_pct);
      if(finite(row.trace.accel_200_250))item.accel200.push(row.trace.accel_200_250);
      if(finite(row.trace.accel_300_320))item.accel320.push(row.trace.accel_300_320);
      for(const [key,band] of Object.entries(row.trace.accel_bands||{}))
        if(item.accelBands[key]&&finite(band.gap_s))item.accelBands[key].push(band.gap_s);
      if(finite(row.trace.speed_st))item.speedSt.push(row.trace.speed_st);
      if(finite(row.trace.speed_fl))item.speedFl.push(row.trace.speed_fl);
      if(finite(row.trace.corner_contribution))item.cornerContribution.push(row.trace.corner_contribution);
      if(brakingComparable&&finite(row.brakingScore)) {
        item.brakingScore.push(row.brakingScore);
        if(finite(row.brakingSlowingS))item.brakingSlowingS.push(row.brakingSlowingS);
        if(finite(row.brakingApproachMs))item.brakingApproachMs.push(row.brakingApproachMs);
        item.brakingScoreZones.push(row.brakingScoreZones);
        item.brakingReferenceLap.push(row.brakingReferenceLap);
        if(finite(row.brakeG))item.brakeG.push(row.brakeG);
        if(finite(row.brakeMeanG))item.brakeMeanG.push(row.brakeMeanG);
        if(finite(row.brakePowerProxy))item.brakePowerProxy.push(row.brakePowerProxy);
        if(finite(row.brakeDistance))item.brakeDistance.push(row.brakeDistance);
        if(finite(row.brakeDistDelta))item.brakeDistDelta.push(row.brakeDistDelta);
        if(finite(row.brakeDuration))item.brakeDuration.push(row.brakeDuration);
        if(finite(row.brakeEntrySpeed))item.brakeEntrySpeed.push(row.brakeEntrySpeed);
        if(finite(row.brakeTurnInSpeed))item.brakeTurnInSpeed.push(row.brakeTurnInSpeed);
        if(finite(row.normalizedDecel))item.normalizedDecel.push(row.normalizedDecel);
        if(finite(row.brakeTimeDelta))item.brakeTimeDelta.push(row.brakeTimeDelta);
        if(finite(row.samplingResolution))item.samplingResolution.push(row.samplingResolution);
        if(finite(row.brakingResolution))item.brakingResolution.push(row.brakingResolution);
        if(finite(row.brakingRepeatSpread))item.brakingRepeatSpread.push(row.brakingRepeatSpread);
        item.zones+=row.brakeZones;
        item.limitedBrakeZones+=row.limitedBrakeZones||0;
        item.mixedBrakeZones+=row.mixedBrakeZones||0;
      }
      if(finite(row.trace?.terminal_zone_mean_speed))item.terminalZoneMeanSpeed.push(row.trace.terminal_zone_mean_speed);
      if(finite(row.trace?.terminal_zone_length_m))item.terminalZoneLength.push(row.trace.terminal_zone_length_m);
    }
  }
  const output=[...map.values()];
  for (const t of output) {
    t.rawCornerContribution = [...t.cornerContribution];
    t.rawStraightContribution = [...t.straightContribution];
    t.rawStraightTraversalDelta = [...t.straightTraversalDelta];
    t.rawLapGaps = [...t.lapGaps];
  }
  output.reference='each event’s fastest measured lap';
  output.commonEvents=targetReports.map(r=>r.event.name);
  output.excludedTeams=[];
  const pairedSeason=pairedBrakingScores(targetReports,row=>row.brakingSlowingS,row=>row.brakingApproachMs,mode);
  const pairedSeasonLog=pairedBrakingScores(targetReports,row=>row.brakingScore,row=>row.brakingApproachMs,mode);
  output.brakingCoverage=pairedSeason.coverage;
  for(const team of output) {
    team.brakingStability=pairedSeason.stability.get(team.team);
    // Summary cells must describe the same GPs as the chart, not every
    // collected observation outside the ranked rectangle.
    const ranked=targetReports.filter(r=>pairedSeason.coverage.events.includes(r.event.name))
      .map(r=>r.summary.rows.get(team.team)).filter(r=>r&&pairedSeason.coverage.teams.includes(team.team));
    for(const [array,key]of Object.entries({brakingScore:'brakingScore',brakingSlowingS:'brakingSlowingS',brakingApproachMs:'brakingApproachMs',
      brakeMeanG:'brakeMeanG',brakePowerProxy:'brakePowerProxy',brakeDistance:'brakeDistance',brakeDuration:'brakeDuration',
      brakeEntrySpeed:'brakeEntrySpeed',brakeTurnInSpeed:'brakeTurnInSpeed',normalizedDecel:'normalizedDecel',
      samplingResolution:'samplingResolution',brakingResolution:'brakingResolution',brakingApproachResolution:'brakingApproachResolution'}))
      team[array]=ranked.map(r=>r[key]).filter(finite);
    team.zones=ranked.reduce((n,r)=>n+(r.brakeZones||0),0);
  }
  const adjusted={
    topSpeed:eventAdjustedScores(targetReports,row=>row.topDeficit,mode),
    low:eventAdjustedScores(targetReports,row=>row.categories.low?.deficit,mode),
    medium:eventAdjustedScores(targetReports,row=>row.categories.medium?.deficit,mode),
    high:eventAdjustedScores(targetReports,row=>row.categories.high?.deficit,mode),
    lowSeconds:eventAdjustedScores(targetReports,row=>row.categories.low?.time_lost,mode),
    mediumSeconds:eventAdjustedScores(targetReports,row=>row.categories.medium?.time_lost,mode),
    highSeconds:eventAdjustedScores(targetReports,row=>row.categories.high?.time_lost,mode),
    corners:eventAdjustedScores(targetReports,row=>row.trace.corner_contribution,mode),
    straights:eventAdjustedScores(targetReports,row=>row.trace.straight_traversal_delta,mode),
    straightCore:eventAdjustedScores(targetReports,row=>row.trace.straight_core_delta,mode),
    straightCoreSeconds:eventAdjustedScores(targetReports,row=>row.trace.straight_core_gap_s,mode),
    braking:pairedSeasonLog.slowing,
    brakingSlowingS:pairedSeason.slowing,
    brakingApproachMs:pairedSeason.approach
  };
  const adjustedBands=Object.fromEntries(STRAIGHT_BANDS.map(key=>[
    key,eventAdjustedScores(targetReports,row=>row.trace.accel_bands?.[key]?.gap_s,mode)
  ]));
  for(const team of output)team.adjusted=Object.fromEntries(Object.entries(adjusted)
    .map(([metric,scores])=>[metric,scores.get(team.team)??null]));
  for(const team of output)team.adjustedBands=Object.fromEntries(Object.entries(adjustedBands)
    .map(([band,scores])=>[band,scores.get(team.team)??null]));
  output.rankCoverage=Object.fromEntries([...Object.entries(adjusted),...Object.entries(adjustedBands)]
    .filter(([,scores])=>scores.coverage).map(([metric,scores])=>[metric,scores.coverage]));
  return output;
}

// Circuit Discrepancy Reconciliation Box (Answers: "where did the remaining gps go?")
function renderCircuitAuditCard(season) {
  const used = season.commonEvents || [];
  const omitted = events.map(event => event.name).filter(name => !used.includes(name));
  return `<div class="perf-audit-box"><div class="perf-audit-header"><div class="perf-audit-title">Circuit coverage · ${used.length} of ${events.length} selected events</div></div>
    <p class="performance-note">Braking requires the same speed drop on a straight approach, with at least three teams per zone. Curved approaches and sample gaps are excluded. One-zone results are provisional; check each team’s measured coverage.</p>
    <p class="performance-note">Included: ${used.length ? used.map(escape).join(', ') : 'none'}. ${omitted.length ? `Excluded: ${omitted.map(escape).join(', ')}.` : ''}</p></div>`;
}

function renderSeasonLapGapCard(season, values) {
  const refTeam = season?.reference || 'the fastest constructor';
  const trackCount = season?.commonEvents?.length || 0;
  const rows = values.map(t => {
    const sDelta = avg(t.rawStraightTraversalDelta || t.straightTraversalDelta);
    const cDelta = avg(t.rawCornerContribution || t.cornerContribution);
    const lapGap = avg(t.rawLapGaps || t.lapGaps);
    return {
      team: t,
      sDelta,
      cDelta,
      lapGap
    };
  }).sort((a, b) => (finite(a.lapGap) ? a.lapGap : 999) - (finite(b.lapGap) ? b.lapGap : 999));

  return card(
    'Where the lap gap comes from (Season Attribution)',
    `Decomposition of telemetry lap deficit relative to ${escape(refTeam)} across up to ${trackCount} supported circuits. Each team uses its own validated-event set; its straight and corner contributions sum to its lap gap on that set. Compare circuit counts before ranking teams.`,
    table(
      ['Team', 'Straights (Traversal Delta)', 'Corners', 'Telemetry Lap Gap'],
      rows.map(r => [
        teamLabel(r.team),
        finite(r.sDelta) ? signed(r.sDelta, 3, '%') : '—',
        finite(r.cDelta) ? signed(r.cDelta, 3, '%') : '—',
        finite(r.lapGap) ? signed(r.lapGap, 3, '%') : '—'
      ])
    ) +
    '<p class="performance-note">Straight and corner contributions are signed shares of each event’s fastest measured lap and sum to the telemetry lap gap for each team’s validated circuits. Unequal event coverage limits cross-team comparability. The 250→300 km/h acceleration value is a separate diagnostic, not an additive share. Qualifying pace uses each team’s fastest available official flying lap, including wet qualifying; telemetry attribution requires a separate validated dry trace.</p>'
  );
}

function renderTrace() {
  if(context?.season) {
    const season=seasonTelemetry(telemetrySeasonStat);
    if(!season.length)return card('Telemetry season average','At least two constructors must have validated traces in an event.','<p class="section-empty">Not enough comparable telemetry is available for this selection. Other metrics remain available.</p>');
    const trackCount = season.commonEvents?.length || 0;
    const isSeasonScope = activeScope === 'season';
    const cornerTitle = isSeasonScope ? 'Season cornering performance' : `Selected tracks cornering performance (${trackCount} track${trackCount === 1 ? '' : 's'})`;
    const straightTitle = isSeasonScope ? 'Season straight-line performance' : `Selected tracks straight-line performance (${trackCount} track${trackCount === 1 ? '' : 's'})`;
    const brakingTitle = isSeasonScope ? 'Season braking performance' : `Selected tracks braking performance (${trackCount} track${trackCount === 1 ? '' : 's'})`;
    const statisticControls=`<div class="performance-scope-toggle performance-stat-toggle" role="group" aria-label="Telemetry summary across circuits"><button type="button" data-telemetry-stat="mean" aria-pressed="${telemetrySeasonStat==='mean'}">Mean across circuits</button><button type="button" data-telemetry-stat="median" aria-pressed="${telemetrySeasonStat==='median'}">Median across circuits</button></div><div class="performance-scope-toggle" role="group" aria-label="Comparison coverage"><button type="button" data-telemetry-coverage="common" aria-pressed="${telemetryCoverageMode==='common'}">Common observed coverage</button><button type="button" data-telemetry-coverage="inferred" aria-pressed="${telemetryCoverageMode==='inferred'}">Coverage-adjusted model · diagnostic</button></div><p class="performance-note">${telemetryCoverageMode==='common'?'Each ranking uses one complete shared set of measured teams and events/zones, chosen to retain the most observations. No missing values are estimated.':'Diagnostic model bridges missing events/zones through overlapping teams; car-by-circuit differences can bias it.'} Table sample counts describe collected evidence; ranking support is listed below.</p><details class="performance-evidence"><summary>Exact ranking support</summary>${table(['Metric','Teams in ranking','Shared events'],Object.entries(season.rankCoverage||{}).map(([metric,c])=>[escape(metric),c.teams.map(escape).join(', '),c.events.map(escape).join(', ')]))}</details>`;

    if(activeMetric==='corners') {
      const rawValues=season.map(team=>({
        ...team,
        lowValue:summarize(team.lowSeconds,telemetrySeasonStat),mediumValue:summarize(team.mediumSeconds,telemetrySeasonStat),highValue:summarize(team.highSeconds,telemetrySeasonStat),
        lowGap:summarize(team.lowDeficit,telemetrySeasonStat),mediumGap:summarize(team.mediumDeficit,telemetrySeasonStat),highGap:summarize(team.highDeficit,telemetrySeasonStat),
        cornerGap:summarize(team.cornerContribution,telemetrySeasonStat)
      }));
      const values = rawValues.map(team => ({
        ...team,
        lowGap:team.adjusted.low,mediumGap:team.adjusted.medium,highGap:team.adjusted.high,
        lowValue:team.adjusted.lowSeconds,mediumValue:team.adjusted.mediumSeconds,
        highValue:team.adjusted.highSeconds,cornerGap:team.adjusted.corners,
      }));

      const ordered=sorted(values,{cornerTeam:t=>t.team,lowGap:t=>t.lowGap,mediumGap:t=>t.mediumGap,highGap:t=>t.highGap,cornerEvents:t=>t.events},'lowGap');

      return statisticControls+card(cornerTitle,`Estimated ${telemetrySeasonStat} time lost per lap in each corner speed type, adjusted for which circuits have usable telemetry. Zero is the best supported constructor; circuit counts remain visible because missing data adds uncertainty. Median category values need not add up to the mean lap-gap attribution below.`,
        (isSeasonScope ? renderCircuitAuditCard(season) : '')+
        cornerBandControls()+lapShareChart(values,cornerGraphBand==='all'?'cornerGap':cornerGraphBand+'Gap',season.reference)+
        table([sortHeader('cornerTeam','Team'),sortHeader('lowGap','Low-speed deficit'),sortHeader('mediumGap','Medium-speed deficit'),sortHeader('highGap','High-speed deficit'),sortHeader('cornerEvents','Circuits',-1)],ordered.map(team=>[teamLabel(team),
          `${signed(team.lowGap,3)}<small>${signed(team.lowValue,3,' s/lap')} · ${team.low.length} circuits</small>`,
          `${signed(team.mediumGap,3)}<small>${signed(team.mediumValue,3,' s/lap')} · ${team.medium.length} circuits</small>`,
          `${signed(team.highGap,3)}<small>${signed(team.highValue,3,' s/lap')} · ${team.high.length} circuits</small>`,team.events])))+
        renderSeasonLapGapCard(season, rawValues)+
        `<details class="dashboard-card performance-methods"><summary>Actual straight times and selected laps by GP</summary><p class="performance-note">Each GP uses one shared straight/corner partition. Straight seconds are not comparable across different circuits; the season ranking combines within-GP gaps. Distance registration uses official timing-sector anchors, or validated GPS when sectors are missing. The timing partition is still an estimate, not a measurement of engine power.</p>${table(['Team','Grand Prix','Driver / lap','Straight time','Straight gap · lap share','End-speed windows','Alignment'],events.flatMap(e=>Object.entries(e.traces||{}).map(([team,t])=>[escape(team),eventLabel(e.name),`${escape(t.selection?.driver||'—')} · L${t.selection?.lap??'—'}`,fmt(t.straight_time,3,' s'),signed(t.straight_traversal_delta,3,'%'),t.terminal_zone_count??'—',escape(t.quality?.alignment_method||'Previous calculation · reanalyse')])) )}</details>`+
        '<p class="performance-note">End speed uses the speed channel in approximately 80 m windows near the ends of straights at least 400 m long. Every team uses the same supported windows in each GP; absent common windows stay blank. Its GP count can differ from traversal coverage. Acceleration and traversal use the same selected qualifying lap.</p>'+
        card('Downforce index','Unavailable: public telemetry cannot isolate aerodynamic load.','<p class="performance-note">Downforce, engine power and drag cannot be identified independently from these public channels. High-speed corner performance is shown directly without a synthetic index.</p>');
    }
    if(activeMetric==='straight') {
      const straightToggle = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
          <div class="performance-scope-toggle" role="radiogroup" aria-label="Straight line data source">
            <button type="button" data-straight-source="qualy" aria-pressed="${straightLineSource === 'qualy'}">Qualifying telemetry</button>
            <button type="button" data-straight-source="race" aria-pressed="${straightLineSource === 'race'}">Race speed traps</button>
          </div>
          <span class="perf-tercile-badge is-mid">${straightLineSource === 'qualy' ? 'Observed speed and time · Aero/ERS state unknown in 2026' : 'Official ST speed · checkpoint-screened laps'}</span>
        </div>
      `;

      if (straightLineSource === 'race') {
        const raceTrapRows = seasonRaceTrapRows(events,telemetrySeasonStat);
        const orderedRace = sorted(raceTrapRows, {
          raceTeam: t => t.team,
          raceDeficit: t => t.raceDeficit,
          raceQualyDeficit: t => t.qualyDeficit,
          raceMatched: t => t.matchedSpeed,
          racePeak: t => t.peakSpeed,
          raceMed: t => t.medianSpeed,
          raceFL: t => t.finishLineSpeed,
          raceEvents: t => t.events,
          raceLaps: t => t.laps
        }, 'raceDeficit', 1);

        const raceChart = renderHorizontalBarChart(orderedRace, {
          title: 'Race ST speed deficit · event-matched',
          subtitle: 'Each Grand Prix is compared with its own fastest ST speed; event coverage is adjusted · Lower is better',
          valueKey: 'raceDeficit',
          unit: '%',
          digits: 3,
          signedValue: true,
          zeroBaseline: true
        });

        return statisticControls+card(straightTitle, 'Race speed-trap ranking compares each Grand Prix with its own field before combining races. Qualifying ST uses the same timing line on those weekends; 250–300 km/h acceleration is a separate measure. Neither comparison isolates engine, drag or deployment.',
          straightToggle+
          raceChart+
          table([
            sortHeader('raceTeam', 'Team'),
            sortHeader('raceDeficit', 'Race ST deficit'),
            sortHeader('raceQualyDeficit', 'Qualifying ST deficit'),
            sortHeader('raceMatched', 'Race ST · raw average', -1),
            sortHeader('racePeak', 'Peak speed trap (ST)', -1),
            sortHeader('raceFL', 'Finish line speed (FL)', -1),
            sortHeader('raceEvents', 'Race coverage', -1)
          ], orderedRace.map(t => [
            teamLabel(t),
            signed(t.raceDeficit, 3, '%'),
            `${signed(t.qualyDeficit,3,'%')}<small>${t.paired} paired events</small>`,
            fmt(t.matchedSpeed, 1, ' km/h'),
            fmt(t.peakSpeed, 1, ' km/h'),
            fmt(t.finishLineSpeed, 1, ' km/h'),
            `${t.events} events<small>${t.laps} eligible laps</small>`
          ]))+
          '<p class="performance-note">Deficits are adjusted for which races have usable data; raw km/h is context, not the season ranking. Race ST is screened at timing checkpoints and adjusted for common race lap numbers, but tyre, tow, setup and energy deployment remain different from qualifying.</p>');
      }

      const rawValues = season.map(team => ({
        ...team,
        bandGap:team.adjustedBands[straightBand],
        bandEvents:(team.accelBands[straightBand]||[]).length,
        accel250Pct: summarize(team.accel250Pct,telemetrySeasonStat),
        accel250: summarize(team.accel250,telemetrySeasonStat),
        accel200: summarize(team.accel200,telemetrySeasonStat),
        accel320: summarize(team.accel320,telemetrySeasonStat),
        traversalDelta: team.adjusted.straights,
        coreDelta:straightGapUnit==='seconds'?team.adjusted.straightCoreSeconds:team.adjusted.straightCore,
        coreEvents:team.coreGaps.length,
        coreDistance:summarize(team.coreDistance,telemetrySeasonStat),
        terminal: summarize(team.terminalZoneMeanSpeed,telemetrySeasonStat),
        terminalEvents:team.terminalZoneMeanSpeed.length,
        termLen: summarize(team.terminalZoneLength,telemetrySeasonStat),
        speedSt: summarize(team.speedSt,telemetrySeasonStat),
        speedFl: summarize(team.speedFl,telemetrySeasonStat),
        peak: summarize(team.top,telemetrySeasonStat),
        peakGap:team.adjusted.topSpeed,
        peakEvents:team.top.length,
        sustained: summarize(team.full,telemetrySeasonStat)
      }));
      const availableBands=STRAIGHT_BANDS.filter(key=>season.filter(team=>(team.accelBands[key]||[]).length).length>=3);
      const bandControls=straightBandControls(availableBands);
      for(const row of rawValues) {
        row.bandGap=row.adjustedBands[straightBand];
        row.bandEvents=(row.accelBands[straightBand]||[]).length;
      }
      const valid250Pct = rawValues.map(t => t.accel250Pct).filter(finite);
      const minAccel250Pct = valid250Pct.length ? Math.min(...valid250Pct) : 0;
      const valid250 = rawValues.map(t => t.accel250).filter(finite);
      const minAccel250 = valid250.length ? Math.min(...valid250) : 0;
      const valid200 = rawValues.map(t => t.accel200).filter(finite);
      const minAccel200 = valid200.length ? Math.min(...valid200) : 0;
      const valid320 = rawValues.map(t => t.accel320).filter(finite);
      const minAccel320 = valid320.length ? Math.min(...valid320) : 0;

      const qualyValues = rawValues.map(t => ({
        ...t,
        straightAccel250Pct: finite(t.accel250Pct) ? Math.max(0, t.accel250Pct - minAccel250Pct) : null,
        straightAccel250: finite(t.accel250) ? Math.max(0, t.accel250 - minAccel250) : null,
        straightAccel200: finite(t.accel200) ? Math.max(0, t.accel200 - minAccel200) : null,
        straightAccel320: finite(t.accel320) ? Math.max(0, t.accel320 - minAccel320) : null
      }));
      const orderedQualy = sorted(qualyValues, {
        straightTeam: t => t.team,
        straightBandGap: t => t.bandGap,
        straightAccel250Pct: t => t.straightAccel250Pct,
        straightAccel250: t => t.straightAccel250,
        straightAccel200: t => t.straightAccel200,
        straightAccel320: t => t.straightAccel320,
        terminal: t => t.terminal,
        peak:t=>t.peak,
        peakGap:t=>t.peakGap,
        speedSt: t => t.speedSt,
        speedFl: t => t.speedFl,
        traversalDelta: t => t.traversalDelta,
        coreDelta:t=>t.coreDelta,
        straightEvents: t => t.events
      }, 'coreDelta', 1);

      const qualyChart = renderHorizontalBarChart(orderedQualy, {
        title: `Qualifying acceleration · ${straightBand.replace('_','–')} km/h`,
        subtitle: 'Time to cross the selected speed range in matched zones · Adjusted for event coverage; not a lap-time contribution',
        valueKey: 'bandGap',
        unit: ' s',
        digits: 3,
        signedValue: true,
        zeroBaseline: true
      });
      const traversalChart = renderHorizontalBarChart(orderedQualy.filter(t => finite(t.traversalDelta)), {
        title: 'Exit-inclusive traversal · lap attribution',
        subtitle: 'Includes corner-exit advantage · Not a pure straight-line capability ranking',
        valueKey: 'traversalDelta',
        unit: '%',
        digits: 3,
        signedValue: true,
        zeroBaseline: false
      });
      const peakChart=renderHorizontalBarChart(orderedQualy,{
        title:'Qualifying top speed · season speed shortfall',
        subtitle:'Selected clean lap peak · GP-relative speed deficit, adjusted for event coverage · Not lap time or isolated engine/drag',
        valueKey:'peakGap',unit:'%',digits:3,signedValue:true,zeroBaseline:true
      });
      const coreChart=renderHorizontalBarChart(orderedQualy,{
        title:straightGapUnit==='seconds'?'Settled straight-section performance · time gap':'Settled straight-section performance · share of lap',
        subtitle:'Shared qualifying windows · Exit, cornering and braking regions excluded · Coverage-adjusted; not isolated engine/drag',
        valueKey:'coreDelta',unit:straightGapUnit==='seconds'?' s':'%',digits:3,signedValue:true,zeroBaseline:true
      });

      return statisticControls+card(straightTitle, 'The main comparison times shared, settled straight sections on clean qualifying laps. Full throttle alone is not enough: turning, early exit acceleration, lift and braking regions are excluded. These observations still combine car, driver, setup, tow and deployment—not measured aerodynamic drag or engine power. Top speed and speed-range acceleration are separate diagnostics.',
        straightToggle+
        straightGapControls()+coreChart+
        (!rawValues.some(row=>finite(row.coreDelta))?'<p class="section-empty">No supported settled-straight measurements. Rerun Analyse if these results were loaded before the update.</p>':'')+
        peakChart+
        bandControls+
        qualyChart+
        table([
          sortHeader('straightTeam', 'Team'),
          sortHeader('coreDelta','Settled-straight gap'),
          'Core coverage',
          sortHeader('straightBandGap', `${straightBand.replace('_','–')} km/h gap`),
          'Band coverage',
          sortHeader('terminal', 'End-of-straight speed', -1),
          sortHeader('peak','Qualifying top speed',-1),
          sortHeader('peakGap','Top-speed shortfall'),
          sortHeader('speedSt', 'Official ST', -1),
          sortHeader('speedFl', 'Official FL', -1),
          sortHeader('traversalDelta', 'Exit-inclusive attribution'),
          sortHeader('straightEvents', 'Circuits', -1)
        ], orderedQualy.map(team => [
          teamLabel(team),
          signed(team.coreDelta,3,straightGapUnit==='seconds'?' s':'%'),
          `${team.coreEvents} GPs<small>${fmt(team.coreDistance,0,' m')} shared / GP</small>`,
          signed(team.bandGap, 3, ' s'),
          `${team.bandEvents} circuit${team.bandEvents===1?'':'s'}`,
          finite(team.terminal) ? `${fmt(team.terminal, 3, ' km/h')}<small>${team.terminalEvents} GPs · ${fmt(team.termLen, 0, ' m')} common windows / GP</small>` : '—',
          `${fmt(team.peak,3,' km/h')}<small>${team.peakEvents} GPs · selected lap peak</small>`,
          signed(team.peakGap,3,'%'),
          finite(team.speedSt) ? fmt(team.speedSt, 1, ' km/h') : '—',
          finite(team.speedFl) ? fmt(team.speedFl, 1, ' km/h') : '—',
          finite(team.traversalDelta) ? signed(team.traversalDelta, 3, '%') : '—',
          team.events
        ]))+
        `<details class="performance-evidence"><summary>Exit-inclusive lap attribution (previous chart)</summary>${traversalChart}${renderSeasonLapGapCard(season, rawValues)}</details>`+
        '<p class="performance-note">Settled windows require every measured team at ≥98% throttle without braking, low reference-path heading change (less than 5° over about 50 m) and a GPS-derived lateral-acceleration proxy ≤0.5 g, matching observed DRS states, and source gaps ≤0.6 s. Exclude the first 200 m after the detected exit and last 100 m before the next corner region. Retain continuous windows ≥100 m and at least 200 m per GP. These are disclosed conservative screening rules; coverage can be small or absent. Gap is extra seconds on the same windows divided by reference qualifying lap time. This subset does not add to the corner metric to reconstruct a full lap. Full-throttle speed losses from 2026 energy deployment remain in the measurement; lift-off regions do not.</p>'+
        `<details class="performance-evidence"><summary>Shared straight-section windows by GP</summary>${table(['Grand Prix','Team','Measured time','Gap · lap share','Shared windows'],events.flatMap(event=>Object.entries(event.traces||{}).filter(([,trace])=>finite(trace.straight_core_time)).map(([team,trace])=>[escape(event.name),escape(team),fmt(trace.straight_core_time,3,' s'),signed(trace.straight_core_delta,3,'%'),(trace.straight_core_windows||[]).map(w=>`${fmt(w.start_m,0)}–${fmt(w.end_m,0)} m`).join(' · ')])))}</details>`+
        `<details class="performance-evidence"><summary>Qualifying top speeds by Grand Prix</summary>${table(['Grand Prix','Team','Driver / lap','Measured peak','GP speed shortfall'],events.flatMap(event=>{const summary=eventTelemetry(event);return summary?[...summary.rows.values()].filter(row=>finite(row.trace?.top_speed)).map(row=>[escape(event.name),teamLabel(row),`${escape(row.trace.selection?.driver||'—')} · L${row.trace.selection?.lap??'—'}`,fmt(row.trace.top_speed,3,' km/h'),signed(row.topDeficit,3,'%')]):[];}))}</details>`+
        '<p class="performance-note">Top speed is the highest speed-channel value on the distance-aligned selected clean qualifying lap, not the maximum over every qualifying attempt. GP shortfall = (fastest measured peak − team peak) / fastest measured peak × 100. Season ranking combines GP-relative values with equal event weight and coverage adjustment; raw km/h is context. Tow, wing setup, corner exit and energy deployment affect it, so engine power and aerodynamic drag cannot be separated.</p>'+
        '<p class="performance-note">Acceleration uses the selected qualifying lap, ≥70% throttle below 150 km/h and ≥98% above it, no braking through the crossing brackets, source gaps ≤0.6 s and no sample-to-sample speed fall exceeding 3 km/h. Low bands include traction and turning; high bands can include flat-out bends, gradients and deployment. Scores fit overlapping zone/DRS comparisons and GP coverage; they are not measured engine or drag performance. Seconds averages event time gaps; percent averages each event’s lap-time-normalized gaps, so their season ordering can differ. Selected-lap traffic screening cannot guarantee clean air.</p>');
    }
    const rawBrakeValues = season.map(team => ({
      ...team,
      score:team.adjusted.braking,
      slowingS:team.adjusted.brakingSlowingS,
      approachMs:team.adjusted.brakingApproachMs,
      approachS:finite(team.adjusted.brakingApproachMs)?team.adjusted.brakingApproachMs/1000:null,
      referenceLap:summarize(team.brakingReferenceLap,telemetrySeasonStat),
      g: summarize(team.brakeG,telemetrySeasonStat),
      meanG: summarize(team.brakeMeanG,telemetrySeasonStat),
      powerProxy: summarize(team.brakePowerProxy,telemetrySeasonStat),
      distance: summarize(team.brakeDistance,telemetrySeasonStat),
      entrySpeed: summarize(team.brakeEntrySpeed,telemetrySeasonStat),
      turnInSpeed: summarize(team.brakeTurnInSpeed,telemetrySeasonStat),
      distDelta: summarize(team.brakeDistDelta,telemetrySeasonStat),
      duration: summarize(team.brakeDuration,telemetrySeasonStat),
      normalizedDecel: summarize(team.normalizedDecel,telemetrySeasonStat),
      timeDelta: summarize(team.brakeTimeDelta,telemetrySeasonStat),
      samplingResolution: summarize(team.samplingResolution,telemetrySeasonStat),
      timingResolution:summarize(team.brakingResolution,telemetrySeasonStat),
      approachResolution:summarize(team.brakingApproachResolution,telemetrySeasonStat),
      repeatSpread:summarize(team.brakingRepeatSpread,telemetrySeasonStat),
      zones: team.zones
    }));
    const values = computeBrakingPerformance(rawBrakeValues);
    const hasApproach=values.some(row=>finite(row.approachS));
    const selectedBrakeView=brakingView==='approach'&&hasApproach?'approach':'deceleration';
    const ordered = sorted(values, {
      brakeTeam: t => t.team,
      brakeScore: t => t.slowingS,
      brakeApproach: t => t.approachMs,
      brakeTimeDelta: t => t.timeDelta,
      brakeNormDecel: t => t.normalizedDecel,
      brakeMeanG: t => t.meanG,
      brakePower: t => t.powerProxy,
      brakeG: t => t.g,
      brakeDistDelta: t => t.distDelta,
      brakeDistance: t => t.distance,
      brakeEntrySpeed: t => t.entrySpeed,
      brakeTurnInSpeed: t => t.turnInSpeed,
      brakeDuration: t => t.duration,
      brakeResolution: t => t.samplingResolution,
      brakeZones: t => t.zones
    }, selectedBrakeView==='approach'?'brakeApproach':'brakeScore', 1);
    const brakeChart = renderHorizontalBarChart(ordered, {
      title: selectedBrakeView==='approach'?'Qualifying braking approach · time gap':'Qualifying braking · matched speed drop',
      subtitle: selectedBrakeView==='approach'?'Extra seconds per measured approach · Same track distance · Lower is better':'Extra seconds per measured zone to shed the same speed · Lower is better',
      valueKey: selectedBrakeView==='approach'?'approachS':'slowingS',
      unit: ' s',
      digits: 3,
      signedValue: true,
      zeroBaseline: true
    });

    return statisticControls+card(brakingTitle,`Fastest qualifying lap only: the quicker driver’s fastest eligible lap across Q1/Q2/Q3. Both charts use the same paired teams, zones within each GP, and shared GPs. ${telemetrySeasonStat==='median'?'Median':'Mean'} gaps are seconds per measured zone, not whole-lap loss. Arrival and end speeds still affect approach timing; GPS registration and sparse samples make close ranks provisional.`,
      brakingViewControls(hasApproach)+brakeChart+brakingSupportMarkup(season.brakingCoverage,values,true)+
      table([
        sortHeader('brakeTeam','Team'),
        sortHeader('brakeApproach','Approach time gap'),
        sortHeader('brakeScore','Extra slowing time'),
        sortHeader('brakeDuration','Measured duration'),
        sortHeader('brakeNormDecel','Distance-based deceleration',-1),
        sortHeader('brakeMeanG','Mean decel',-1),
        sortHeader('brakePower','Energy-loss rate',-1),
        sortHeader('brakeDistance','Braking distance'),
        sortHeader('brakeEntrySpeed','Measured entry speed'),
        sortHeader('brakeTurnInSpeed','Measured exit speed'),
        sortHeader('brakeResolution','Largest sample spacing'),
        'Timing evidence',
        sortHeader('brakeZones','Matched zones',-1)
      ],ordered.map(team=>[
        teamLabel(team),
        signed(team.approachS,3,' s'),
        signed(team.slowingS,3,' s'),
        fmt(team.duration,3,' s'),
        `${fmt(team.normalizedDecel,3,' g')}`,
        fmt(team.meanG,3,' g'),
        `${fmt(team.powerProxy,0,' kW/t')}<small>speed-derived · not brake power</small>`,
        fmt(team.distance,1,' m'),
        fmt(team.entrySpeed,1,' km/h'),
        fmt(team.turnInSpeed,1,' km/h'),
        `<span class="perf-onset-bracket">Δs ~${fmt(team.samplingResolution,1,' m')}</span>`,
        `${fmt(team.timingResolution,3,' s')} slowing brackets<small>${fmt(team.approachResolution,3,' s')} approach brackets · not confidence intervals</small>`,
        `${team.brakingScore.length} paired GPs · ${team.zones} paired zones${team.zones<team.brakingScore.length*2?' · limited coverage':''}`
      ]))+brakingEvidenceMarkup(events));
  }

  const event=events[0], summary=eventTelemetry(event||{}), loaded=[...summary.rows.values()];
  if(!loaded.length)return card('Telemetry comparison','Qualifying telemetry for every team is loaded automatically.','<p class="section-empty">No reliable telemetry is available for this event.</p>');
  if(activeMetric==='corners') {
    const common=[...new Set(Object.values(summary.groups).flat())];
    const minLow = Math.min(...loaded.map(r => r.categories.low?.deficit).filter(finite));
    const minMed = Math.min(...loaded.map(r => r.categories.medium?.deficit).filter(finite));
    const minHigh = Math.min(...loaded.map(r => r.categories.high?.deficit).filter(finite));
    const minLowT = Math.min(...loaded.map(r => r.categories.low?.time_lost).filter(finite));
    const minMedT = Math.min(...loaded.map(r => r.categories.medium?.time_lost).filter(finite));
    const minHighT = Math.min(...loaded.map(r => r.categories.high?.time_lost).filter(finite));
    const minCornerContrib = Math.min(...loaded.map(r => r.trace?.corner_contribution).filter(finite));

    const rebasedLoaded = loaded.map(r => {
      const clone = { ...r, categories: { ...r.categories } };
      if (clone.categories.low && finite(minLow)) {
        clone.categories.low = { ...clone.categories.low, deficit: Math.max(0, clone.categories.low.deficit - minLow), time_lost: Math.max(0, (clone.categories.low.time_lost || 0) - minLowT) };
      }
      if (clone.categories.medium && finite(minMed)) {
        clone.categories.medium = { ...clone.categories.medium, deficit: Math.max(0, clone.categories.medium.deficit - minMed), time_lost: Math.max(0, (clone.categories.medium.time_lost || 0) - minMedT) };
      }
      if (clone.categories.high && finite(minHigh)) {
        clone.categories.high = { ...clone.categories.high, deficit: Math.max(0, clone.categories.high.deficit - minHigh), time_lost: Math.max(0, (clone.categories.high.time_lost || 0) - minHighT) };
      }
      if (clone.trace && finite(minCornerContrib)) {
        clone.trace = { ...clone.trace, corner_contribution: Math.max(0, clone.trace.corner_contribution - minCornerContrib) };
      }
      return clone;
    });

    const ordered=sorted(rebasedLoaded,{eventCornerTeam:r=>r.team,eventLow:r=>r.categories.low?.deficit,eventMedium:r=>r.categories.medium?.deficit,eventHigh:r=>r.categories.high?.deficit},'eventLow');

    return card('Low / medium / high-speed cornering',`Time lost across all corners in each band relative to the fastest constructor (0.000% baseline). Example: 0.18 seconds lost on a 90-second lap is +0.20%.`,
      cornerBandControls()+lapShareChart(rebasedLoaded.map(r=>({...r,gap:cornerGraphBand==='all'?r.trace?.corner_contribution:r.categories[cornerGraphBand]?.deficit})),'gap',event.traceReference)+
      table([sortHeader('eventCornerTeam','Team'),sortHeader('eventLow','Low ≤120'),sortHeader('eventMedium','Medium 120–200'),sortHeader('eventHigh','High >200')],ordered.map(row=>[teamLabel(row),...['low','medium','high'].map(name=>{
        const value=row.categories[name];return value?`${signed(value.deficit,3)}<small>${signed(value.time_lost,3,' s/lap')} · ${value.corners} corners</small>`:'—';
      })])))+card('Corner measurements','Windows follow the field’s braking, apex and acceleration. Zone labels are used when reliable map corner numbers are unavailable. Loss density (ms/100m) measures spatial penalty rate.',
      table(['Corner',...rebasedLoaded.map(row=>teamLabel(row))],common.map(label=>[escape(label),...rebasedLoaded.map(row=>{
        const corner=row.trace.corners.find(c=>c.corner===label);
        const densityBadge = corner?.loss_density ? `<span class="perf-loss-density">${fmt(corner.loss_density, 1)} ms/100m</span>` : '';
        const tercileBadge = corner?.tercile ? `<span class="perf-tercile-badge is-${corner.tercile}" style="font-size:0.65rem;margin-left:4px;">${corner.tercile}</span>` : '';
        const deltaContext = (corner && (finite(corner.delta_entry) || finite(corner.delta_apex) || finite(corner.delta_exit)))
          ? `<small style="font-size:0.75em;color:var(--text-secondary);">Entry ${signed(corner.delta_entry, 1)} · Apex ${signed(corner.delta_apex, 1)} · Exit ${signed(corner.delta_exit, 1)} km/h</small>`
          : '';
        return corner?`${fmt(corner.time,3,' s')}${densityBadge}${tercileBadge}<small>${fmt(corner.mean_speed,1,' km/h')} mean · ${fmt(corner.minimum,1)} apex</small>${deltaContext}`:'—';
      })])))+card('Downforce index','Unavailable: public telemetry cannot isolate aerodynamic load.','<p class="performance-note">High-speed corner performance is shown directly instead.</p>');
  }
  if(activeMetric==='straight') {
    const straightToggle = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
        <div class="performance-scope-toggle" role="radiogroup" aria-label="Straight line data source">
          <button type="button" data-straight-source="qualy" aria-pressed="${straightLineSource === 'qualy'}">Qualifying telemetry</button>
          <button type="button" data-straight-source="race" aria-pressed="${straightLineSource === 'race'}">Race speed traps</button>
        </div>
        <span class="perf-tercile-badge is-mid">${straightLineSource === 'qualy' ? 'Observed GPS speed and traversal time' : 'ST timing loop · filtered laps'}</span>
      </div>
    `;

    if (straightLineSource === 'race') {
      const raceTeams = event.R?.teams || [];
      const raceTrapRows = raceTeams.map(t => {
        const matched = t.race_speed_trap_matched;
        return {
          ...t,
          matchedSpeed: matched,
          peakSpeed: t.race_speed_trap_max,
          medianSpeed: t.race_speed_trap_median,
          finishLineSpeed: t.race_speed_fl_max,
        };
      }).filter(r => finite(r.matchedSpeed) || finite(r.peakSpeed));

      if (!raceTrapRows.length) {
        return card('Straight-line performance', 'Race speed trap data is recorded during the Grand Prix session.',
          straightToggle + '<p class="section-empty">No race speed trap telemetry is available for this event yet.</p>');
      }

      const maxMatched = Math.max(...raceTrapRows.map(r => r.matchedSpeed).filter(finite));
      const qualifyingST=(event.Q?.teams||[]).filter(t=>finite(t.speed_trap));
      const bestQualifyingST=qualifyingST.length>=3?Math.max(...qualifyingST.map(t=>t.speed_trap)):null;
      const qualifyingByTeam=new Map(qualifyingST.map(t=>[t.team,t.speed_trap]));
      for (const r of raceTrapRows) {
        r.raceDeficit = (finite(r.matchedSpeed) && finite(maxMatched) && maxMatched > 0)
          ? Math.max(0, ((maxMatched - r.matchedSpeed) / maxMatched) * 100)
          : null;
        const qSpeed=qualifyingByTeam.get(r.team);
        r.qualyDeficit=finite(qSpeed)&&finite(bestQualifyingST)
          ?(bestQualifyingST-qSpeed)/bestQualifyingST*100:null;
      }

      const orderedRace = sorted(raceTrapRows, {
        eventRaceTeam: t => t.team,
        eventRaceDeficit: t => t.raceDeficit,
        eventRaceQualyDeficit: t => t.qualyDeficit,
        eventRaceMatched: t => t.matchedSpeed,
        eventRacePeak: t => t.peakSpeed,
        eventRaceMed: t => t.medianSpeed,
        eventRaceFL: t => t.finishLineSpeed
      }, 'eventRaceDeficit', 1);

      const singleRaceChart = renderHorizontalBarChart(orderedRace, {
        title: 'Lap-Matched Race Speed Trap Deficit (% to Fastest)',
        subtitle: 'Lap-number-adjusted ST speed where at least three teams share timing data · Baseline 0.000% is fastest',
        valueKey: 'raceDeficit',
        unit: '%',
        digits: 3,
        signedValue: true,
        zeroBaseline: true
      });

      return card('Straight-line performance', 'Race and qualifying ST use the same timing line, but different laps and conditions. The race estimate adjusts for common lap numbers; tyre, tow and energy deployment still differ.',
        straightToggle +
        singleRaceChart +
        table([
          sortHeader('eventRaceTeam', 'Team'),
          sortHeader('eventRaceDeficit', 'ST Deficit (% to Fastest)'),
          sortHeader('eventRaceQualyDeficit', 'Qualifying ST deficit'),
          sortHeader('eventRaceMatched', 'Lap-matched speed (ST)', -1),
          sortHeader('eventRacePeak', 'Peak speed trap (ST)', -1),
          sortHeader('eventRaceMed', 'Median speed trap', -1),
          sortHeader('eventRaceFL', 'Finish line speed (FL)', -1)
        ], orderedRace.map(t => [
          teamLabel(t),
          signed(t.raceDeficit, 2),
          signed(t.qualyDeficit, 3, '%'),
          fmt(t.matchedSpeed, 1, ' km/h'),
          fmt(t.peakSpeed, 1, ' km/h'),
          fmt(t.medianSpeed, 1, ' km/h'),
          fmt(t.finishLineSpeed, 1, ' km/h')
        ])) +
        '<p class="performance-note">Race speed traps reflect observed velocity, not engine power or drag in isolation. Eligible laps use a &gt;2.0s timing-checkpoint traffic screen; this does not guarantee uninterrupted clean air. Active aero and energy deployment state are unavailable.</p>');
    }

    const qualyRows = loaded.map(r => ({
      ...r,
      bandGap:r.trace?.accel_bands?.[straightBand]?.gap_s ?? null,
      bandStraights:r.trace?.accel_bands?.[straightBand]?.straights ?? 0,
      accel250: r.trace?.accel_250_300,
      accel200: r.trace?.accel_200_250,
      accel320: r.trace?.accel_300_320,
      straightCoverage: r.trace?.straight_coverage || '—',
      straightProvisional: r.trace?.straight_provisional || false,
      traversalDelta: r.trace?.straight_traversal_delta,
      coreDelta:straightGapUnit==='seconds'?r.trace?.straight_core_gap_s:r.trace?.straight_core_delta,
      coreDistance:r.trace?.straight_core_distance_m,
      terminalSpeed: r.trace?.terminal_zone_mean_speed,
      termDeficit: r.trace?.terminal_speed_deficit,
      termLen: r.trace?.terminal_zone_length_m,
      speedSt: r.trace?.speed_st,
      speedFl: r.trace?.speed_fl,
      topSpeed: r.trace?.top_speed,
      sustainedSpeed: r.trace?.full_throttle_p95
    }));
    const availableBands=STRAIGHT_BANDS.filter(key=>loaded.filter(row=>finite(row.trace?.accel_bands?.[key]?.gap_s)).length>=3);
    const bandControls=straightBandControls(availableBands);
    for(const row of qualyRows) {
      row.bandGap=row.trace?.accel_bands?.[straightBand]?.gap_s ?? null;
      row.bandStraights=row.trace?.accel_bands?.[straightBand]?.straights ?? 0;
    }
    const ordered = sorted(qualyRows, {
      eventStraightTeam: t => t.team,
      eventStraightBand: t => t.bandGap,
      eventStraightAccel250: t => t.accel250,
      eventStraightAccel200: t => t.accel200,
      eventStraightAccel320: t => t.accel320,
      eventStraightTerminal: t => t.terminalSpeed,
      eventStraightPeak:t=>t.topSpeed,
      eventStraightPeakGap:t=>t.topDeficit,
      eventStraightSpeedST: t => t.speedSt,
      eventStraightSpeedFL: t => t.speedFl,
      eventStraightTraversal: t => t.traversalDelta,
      eventStraightCore:t=>t.coreDelta
    }, 'eventStraightCore', 1);

    const straightTraversalChart = renderHorizontalBarChart(ordered.filter(r => finite(r.traversalDelta)), {
      title: 'Exit-inclusive traversal · lap attribution',
      subtitle: 'Includes corner-exit advantage · Not a pure straight-line capability ranking',
      valueKey: 'traversalDelta',
      unit: '%',
      digits: 3,
      signedValue: true,
      zeroBaseline: false
    });
    const singleStraightChart = renderHorizontalBarChart(ordered, {
      title: `Qualifying acceleration · ${straightBand.replace('_','–')} km/h`,
      subtitle: 'Time to cross the selected speed range in matched zones · Not additive lap time',
      valueKey: 'bandGap',
      unit: ' s',
      digits: 3,
      signedValue: true,
      zeroBaseline: true
    });
    const peakChart=renderHorizontalBarChart(ordered,{
      title:'Qualifying top speed · speed shortfall',
      subtitle:'Selected clean qualifying lap · Percentage below the fastest measured peak; not lap-time loss',
      valueKey:'topDeficit',unit:'%',digits:3,signedValue:true,zeroBaseline:true
    });
    const coreChart=renderHorizontalBarChart(ordered,{
      title:straightGapUnit==='seconds'?'Settled straight-section performance · time gap':'Settled straight-section performance · share of lap',
      subtitle:'Same full-throttle straight windows · Exit and braking buffers excluded · Not isolated engine/drag',
      valueKey:'coreDelta',unit:straightGapUnit==='seconds'?' s':'%',digits:3,signedValue:true,zeroBaseline:true
    });

    return card('Straight-line performance', 'The main comparison times shared, settled straight sections on clean qualifying laps, with near-full throttle and little turning. Early exit acceleration, lift and braking regions are excluded. It still combines car, setup, driver, tow and deployment; it is not isolated engine power or aerodynamic drag.',
      straightToggle+
      straightGapControls()+coreChart+
      (!ordered.some(row=>finite(row.coreDelta))?'<p class="section-empty">No supported settled-straight measurements. Rerun Analyse if these results predate the update.</p>':'')+
      peakChart+
      bandControls+
      singleStraightChart+
      table([
        sortHeader('eventStraightTeam', 'Team'),
        sortHeader('eventStraightCore','Settled-straight gap'),
        'Core coverage',
        sortHeader('eventStraightBand', `${straightBand.replace('_','–')} km/h gap`),
        'Measured zones',
        sortHeader('eventStraightTerminal', 'End-of-straight speed', -1),
        sortHeader('eventStraightPeak','Qualifying top speed',-1),
        sortHeader('eventStraightPeakGap','Top-speed shortfall'),
        sortHeader('eventStraightSpeedST', 'Official ST', -1),
        sortHeader('eventStraightSpeedFL', 'Official FL', -1),
        sortHeader('eventStraightTraversal', 'Exit-inclusive attribution')
      ], ordered.map(t => [
        teamLabel(t),
        signed(t.coreDelta,3,straightGapUnit==='seconds'?' s':'%'),
        `${t.trace?.straight_core_windows?.length||0} windows<small>${fmt(t.coreDistance,0,' m')} shared</small>`,
        signed(t.bandGap, 3, ' s'),
        t.bandStraights||'—',
        finite(t.terminalSpeed) ? `${fmt(t.terminalSpeed, 3, ' km/h')}<small>${t.trace?.terminal_zone_count??'—'} common windows · ${fmt(t.termLen,0,' m')}</small>` : '—',
        fmt(t.topSpeed,3,' km/h'),
        signed(t.topDeficit,3,'%'),
        finite(t.speedSt) ? fmt(t.speedSt, 1, ' km/h') : '—',
        finite(t.speedFl) ? fmt(t.speedFl, 1, ' km/h') : '—',
        finite(t.traversalDelta) ? signed(t.traversalDelta, 3, '%') : '—'
      ]))+
      '<p class="performance-note">Top speed uses the highest speed-channel value on each distance-aligned selected clean qualifying lap, not all qualifying attempts. It reflects engine, drag, tow, setup and deployment together; it is not a measured aero-drag or engine-power rating.</p>'+
      '<p class="performance-note">Same windows for every team: ≥98% throttle, no braking, low reference heading change (&lt;5° over about 50 m) and GPS-derived lateral proxy ≤0.5 g, matching observed DRS states and source gaps ≤0.6 s. Remove the first 200 m after detected exit and last 100 m before the next corner region; retain continuous windows ≥100 m and at least 200 m total. Gap = extra seconds on those windows / reference qualifying lap time × 100. This is a partial-lap observation, not full-lap attribution; 2026 full-throttle deployment losses remain included.</p>'+
      `<details class="performance-evidence"><summary>Exit-inclusive lap attribution (previous chart)</summary>${straightTraversalChart}${card('Where the lap gap comes from',`Relative to ${escape(event.traceReference||'the fastest measured team')}’s qualifying lap.`,
      table(['Team','Exit-inclusive straights','Corners','Lap gap'],ordered.map(row=>[teamLabel(row),finite(row.traversalDelta)?signed(row.traversalDelta,3,'%'):'—',fmt(row.trace?.corner_contribution,3,'%'),fmt(row.trace?.lap_gap,3,'%')])))}</details>`+
      '<p class="performance-note">Acceleration uses the same selected qualifying lap as top speed: ≥70% throttle below 150 km/h and ≥98% above it, no braking including the crossing brackets, source gaps ≤0.6 s and no speed drop exceeding 3 km/h between samples. Short exits count, so low-speed bands reflect traction and turning as well as acceleration. High bands can include flat-out bends, gradients and deployment differences. Rankings are fitted from overlapping physical zones and observed DRS states, not identical distance windows or a measured engine/drag rating. Missing crossings stay unavailable. Traffic is screened against selected laps only.</p>');
  }
  const brakeRows = computeBrakingPerformance(loaded.map(r => ({
    ...r,
    score:r.brakingScore,
    slowingS:r.brakingSlowingS,
    approachMs:r.brakingApproachMs,
    approachS:finite(r.brakingApproachMs)?r.brakingApproachMs/1000:null,
    referenceLap:r.brakingReferenceLap,
    g: r.brakeG,
    meanG: r.brakeMeanG,
    powerProxy: r.brakePowerProxy,
    distDelta: r.brakeDistDelta,
    distance: r.brakeDistance,
    entrySpeed: r.brakeEntrySpeed,
    turnInSpeed: r.brakeTurnInSpeed,
    duration: r.brakeDuration,
    normalizedDecel: r.normalizedDecel,
    timeDelta: r.brakeTimeDelta,
    samplingResolution: r.samplingResolution,
    timingResolution:r.brakingResolution,
    approachResolution:r.brakingApproachResolution,
    repeatSpread:r.brakingRepeatSpread,
    approachZones:r.brakingApproachZones,
    onsetBracket: r.onsetBracket,
    zones: r.brakeZones,
    mixedBrakeZones: r.mixedBrakeZones||0
  })));
  const hasApproach=brakeRows.some(row=>finite(row.approachS));
  const selectedBrakeView=brakingView==='approach'&&hasApproach?'approach':'deceleration';
  const ordered = sorted(brakeRows, {
    eventBrakeTeam: r => r.team,
    eventBrakeScore: r => r.slowingS,
    eventBrakeApproach: r => r.approachMs,
    eventBrakeTimeDelta: r => r.timeDelta,
    eventBrakeNormDecel: r => r.normalizedDecel,
    eventBrakeMeanG: r => r.meanG,
    eventBrakePower: r => r.powerProxy,
    eventBrakeG: r => r.g,
    eventBrakeDistDelta: r => r.distDelta,
    eventBrakeDistance: r => r.distance,
    eventBrakeEntrySpeed: r => r.entrySpeed,
    eventBrakeTurnInSpeed: r => r.turnInSpeed,
    eventBrakeDuration: r => r.duration,
    eventBrakeResolution: r => r.samplingResolution,
    eventBrakeZones: r => r.zones
  }, selectedBrakeView==='approach'?'eventBrakeApproach':'eventBrakeScore', 1);
  const singleBrakeChart = renderHorizontalBarChart(ordered, {
    title: selectedBrakeView==='approach'?'Qualifying braking approach · time gap':'Qualifying braking · matched speed drop',
    subtitle: selectedBrakeView==='approach'?'Extra seconds per measured approach · Same track distance · Lower is better':'Extra seconds per measured zone to shed the same speed · Lower is better',
    valueKey: selectedBrakeView==='approach'?'approachS':'slowingS',
    unit: ' s',
    digits: 3,
    signedValue: true,
    zeroBaseline: true
  });

  return card('Braking performance','Each team’s fastest qualifying lap across Q1/Q2/Q3, with no repeat averaging or slower replacement. Both charts rank the same paired teams and zones. Time through approach includes incoming and end speed; same-speed slowing measures the shared speed drop. Gaps are seconds per measured zone, not whole-lap loss.',
    brakingViewControls(hasApproach)+singleBrakeChart+brakingSupportMarkup(summary.brakingCoverage,brakeRows)+
    table([
      sortHeader('eventBrakeTeam','Team'),
      sortHeader('eventBrakeApproach','Approach time gap'),
      sortHeader('eventBrakeScore','Extra slowing time'),
      sortHeader('eventBrakeDuration','Measured duration'),
      sortHeader('eventBrakeNormDecel','Distance-based deceleration',-1),
      sortHeader('eventBrakeMeanG','Mean decel',-1),
      sortHeader('eventBrakePower','Energy-loss rate',-1),
      sortHeader('eventBrakeDistance','Braking distance'),
      sortHeader('eventBrakeEntrySpeed','Measured entry speed'),
      sortHeader('eventBrakeTurnInSpeed','Measured exit speed'),
      sortHeader('eventBrakeResolution','Largest sample spacing'),
      'Timing evidence',
      sortHeader('eventBrakeZones','Matched zones',-1)
    ],ordered.map(row=>[
      teamLabel(row),
      signed(row.approachS,3,' s'),
      signed(row.slowingS,3,' s'),
      fmt(row.duration,3,' s'),
      `${fmt(row.normalizedDecel,3, ' g')}`,
      fmt(row.meanG,3,' g'),
      `${fmt(row.powerProxy,0,' kW/t')}<small>speed-derived · not brake power</small>`,
      fmt(row.distance,1,' m'),
      fmt(row.entrySpeed,1,' km/h'),
      fmt(row.turnInSpeed,1,' km/h'),
      row.onsetBracket ? `<span class="perf-onset-bracket">[${fmt(row.onsetBracket[0], 0)}, ${fmt(row.onsetBracket[1], 0)}] m</span>` : `<span class="perf-onset-bracket">Δs ~${fmt(row.samplingResolution, 1, ' m')}</span>`,
      `${fmt(row.timingResolution,3,' s')} slowing brackets<small>${fmt(row.approachResolution,3,' s')} approach brackets · not confidence intervals</small>`,
      `${row.zones||0} paired zones${row.limitedBrakeZones?` · ${row.limitedBrakeZones} provisional`:''}${row.zones===1?' · limited coverage':''}`
    ])))+brakingEvidenceMarkup([event]);
}

function render() {
  const modes=[
    ['pace','Pace'],
    ['corners','Cornering'],
    ['raceCorners','Race cornering'],
    ['straight','Straight line'],
    ['braking','Braking'],
    ['pits','Pit stops'],
    ['tyres','Tyre trend'],
    ['trend','Development & updates'],
    ['results','Reliability & results']
  ];
  $('carPerformance').classList.toggle('is-descriptions-hidden',!showPerformanceDescriptions);
  const modeBar = `<div class="performance-toolbar"><div class="performance-mode" role="tablist" aria-label="Performance metric">${modes.map(([key,label])=>`<button type="button" role="tab" data-performance-metric="${key}" aria-pressed="${activeMetric===key}" aria-selected="${activeMetric===key}">${label}</button>`).join('')}</div><button type="button" class="performance-explain-toggle" data-performance-explain aria-pressed="${showPerformanceDescriptions}">${showPerformanceDescriptions?'Hide explanations':'Show explanations'}</button></div>`;

  if(!context || (!events.length && !running)) {
    root.innerHTML = modeBar + `
      <div class="dashboard-card performance-empty">
        <div class="empty-icon-badge">🏎️</div>
        <h3>Ready for analysis</h3>
        <p>Select a season and scope above, then click <strong>Analyse</strong> to calculate car pace, cornering performance, straight-line speeds, and tyre trends.</p>
      </div>`;
    return;
  }

  const teams=aggregate();
  const errorMarkup = errors.map(e=>`<div class="performance-error"><span class="error-dot"></span><span>${escape(e.event.name)} · ${e.session==='Q'?'Qualifying':e.session==='R'?'Race':'Telemetry'}: ${escape(e.message)}</span></div>`).join('');
  const content = (activeMetric==='pace'?renderPace(teams):activeMetric==='raceCorners'?renderRaceCorners():activeMetric==='tyres'?renderRace(teams):activeMetric==='results'?renderResults(teams):activeMetric==='pits'?renderPits(teams):activeMetric==='trend'?renderTrend(teams):renderTrace());

  const nativeEvidence=activeMetric==='straight'?`<details class="dashboard-card performance-methods"><summary>Native top-speed evidence · independent of full-lap GPS eligibility</summary><p class="performance-note">Real native samples from the quickest channel-valid candidate per team. GPS alignment is not required here. These are diagnostic peaks, not isolated drag/power ratings or repaired traces; full-lap quality failures remain disclosed.</p>${table(['Grand Prix','Team','Driver / lap','Native peak','Full-lap eligibility'],events.flatMap(e=>Object.entries(e.nativeSpeedObservations||{}).map(([team,row])=>[escape(e.name),escape(team),`${escape(row.selection.driver)} · L${row.selection.lap}`,fmt(row.top_speed,3,' km/h'),escape(e.traceExcluded?.[team]||'Aligned qualifying measurement available')])) )}</details>`:'';
  const accelerationEvidence=activeMetric==='straight'?`<details class="dashboard-card performance-methods"><summary>Measured ${escape(straightBand.replace('_','–'))} km/h acceleration crossings</summary><p class="performance-note">Each row is a real speed crossing, timed from native samples. Locations are approximate GPS registration. Unscored observations remain visible; they do not supply missing values in the common-zone ranking. Sample intervals disclose the original timing resolution.</p>${table(['Grand Prix','Team','Lap','Zone / aero state','Measured crossing time','Crossing locations','Native interval','Common-zone ranking'],events.flatMap(e=>Object.entries(e.traces||{}).flatMap(([team,trace])=>(trace.accel_observations||[]).filter(row=>row.band===straightBand).map(row=>[escape(e.name),escape(team),`L${row.lap}`,`${row.zone+1} · ${escape(row.state)}`,fmt(row.duration_s,3,' s'),`${fmt(row.start_m,1)}–${fmt(row.end_m,1)} m`,fmt(row.sample_interval_s,3,' s'),row.in_common_ranking?'Included':'Evidence only']))))}</details>`:'';
  root.innerHTML = modeBar + errorMarkup + content + nativeEvidence + accelerationEvidence;
}

// ---------------------------------------------------------------------------
// Event Listeners & Interactive Wiring
// ---------------------------------------------------------------------------
document.querySelectorAll('[data-analysis-view]').forEach(button=>button.addEventListener('click',()=>{
  const performance=button.dataset.analysisView==='performance';
  document.body.classList.toggle('performance-view',performance);
  $('carPerformance').hidden=!performance;
  document.querySelectorAll('[data-analysis-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  if(!performance) { if(running||traceRunning) stop(); window.dispatchEvent(new Event('resize')); }
  if(performance&&!initialized) {
    initialized=true;
    const year=new Date().getFullYear();
    $('performanceYear').innerHTML=Array.from({length:year-2017},(_,i)=>`<option value="${year-i}">${year-i}</option>`).join('');
    syncSelect($('performanceYear'));
    if ($('performanceScope')) syncSelect($('performanceScope'));
    loadCalendar();
  }
}));

$('performanceYear').addEventListener('change',()=>{reset();loadCalendar();});

// Scope Toggle (Pill Toggle: [ Season to date ] [ Tracks ])
document.querySelectorAll('[data-performance-scope]').forEach(btn => {
  btn.addEventListener('click', () => {
    const scope = btn.dataset.performanceScope;
    if (activeScope === scope) return;
    activeScope = scope;
    document.querySelectorAll('[data-performance-scope]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.performanceScope === activeScope));
    });
    const isSeason = activeScope === 'season';
    const tray = $('performanceTrackTray');
    if (tray) tray.hidden = isSeason;
    // Satisfy compatibility check: performanceEventField hidden when performanceScope is season
    if ($('performanceEventField')) $('performanceEventField').hidden=($('performanceScope')?.value === 'season' || activeScope === 'season');
    renderTrackPills();
    updateTrackCount();
    reset();
  });
});

// Track Tray Batch Actions
$('performanceSelectAllTracks')?.addEventListener('click', () => {
  calendar.forEach(e => selectedTracks.add(e.name));
  renderTrackPills();
  reset();
});

$('performanceSelectLatestTracks')?.addEventListener('click', () => {
  selectedTracks.clear();
  calendar.slice(-3).forEach(e => selectedTracks.add(e.name));
  renderTrackPills();
  reset();
});

$('performanceClearTracks')?.addEventListener('click', () => {
  selectedTracks.clear();
  renderTrackPills();
  reset();
});

// Track Pill Click Delegation
$('performanceTrackPills')?.addEventListener('click', (ev) => {
  const pill = ev.target.closest('.track-pill');
  if (!pill) return;
  const name = pill.dataset.trackName;
  if (!name) return;
  if (selectedTracks.has(name)) {
    selectedTracks.delete(name);
  } else {
    selectedTracks.add(name);
  }
  pill.setAttribute('aria-pressed', String(selectedTracks.has(name)));
  updateTrackCount();
  reset();
});

// Fallback legacy event listeners if present in DOM
if ($('performanceEvent')) {
  $('performanceEvent').addEventListener('change', () => {
    reset();
    syncSelect($('performanceEvent'));
  });
}
if ($('performanceScope')) {
  $('performanceScope').addEventListener('change', () => {
    reset();
    const isSeason = $('performanceScope').value === 'season';
    if ($('performanceEventField')) $('performanceEventField').hidden = isSeason;
    syncSelect($('performanceScope'));
  });
}

$('performanceLoad').addEventListener('click',analyse);
$('performanceCancel').addEventListener('click',stop);

root.addEventListener('change',event=>{
  const select=event.target.closest('[data-tyre-plot-filter]');
  if(!select)return;
  const kind=select.dataset.tyrePlotFilter;
  const controls=select.closest('.performance-tyre-plot-controls');
  tyrePlotTeam=controls.querySelector('[data-tyre-plot-filter="team"]').value;
  tyrePlotDriver=controls.querySelector('[data-tyre-plot-filter="driver"]').value;
  tyrePlotEvent=controls.querySelector('[data-tyre-plot-filter="event"]').value;
  tyreRunKey=kind==='run'?select.value:'';
  if(kind==='team'){tyrePlotDriver='';tyrePlotEvent='';}
  if(kind==='driver')tyrePlotEvent='';
  const scrollY=window.scrollY;
  render();
  root.querySelector(`[data-tyre-plot-filter="${kind}"]`)?.focus({preventScroll:true});
  window.scrollTo({top:scrollY,behavior:'instant'});
});

root.addEventListener('click',event=>{
  if(event.target.closest('[data-race-corners-load]')){void loadRaceCorners();return;}
  if(event.target.closest('[data-race-corners-stop]')){raceCornerController?.abort();return;}
  const cornerBandButton=event.target.closest('[data-corner-band]');
  if(cornerBandButton){cornerGraphBand=cornerBandButton.dataset.cornerBand;render();return;}
  if(event.target.closest('[data-performance-explain]')){showPerformanceDescriptions=!showPerformanceDescriptions;render();return;}
  const paceStatButton=event.target.closest('[data-pace-stat]');
  if(paceStatButton){paceSeasonStat=paceStatButton.dataset.paceStat;sortKey=qualyPaceMode==='adjusted'?'qualyAdjusted':'qualy';render();return;}
  const telemetryStatButton=event.target.closest('[data-telemetry-stat]');
  if(telemetryStatButton){telemetrySeasonStat=telemetryStatButton.dataset.telemetryStat;render();return;}
  const tyreStatButton=event.target.closest('[data-tyre-stat]');
  if(tyreStatButton&&!tyreStatButton.disabled){tyreSeasonStat=tyreStatButton.dataset.tyreStat;render();return;}
  const tyreLapsButton=event.target.closest('[data-tyre-laps]');
  if(tyreLapsButton){tyreLapMode=tyreLapsButton.dataset.tyreLaps;render();return;}
  const tyreCorrectionButton=event.target.closest('[data-tyre-correction]');
  const tyreFuelButton=event.target.closest('[data-tyre-fuel]');
  if(tyreFuelButton){tyreFuelRate=Number(tyreFuelButton.dataset.tyreFuel);render();return;}
  if(tyreCorrectionButton){tyreCorrection=tyreCorrectionButton.dataset.tyreCorrection;render();return;}
  const tyreWeightingButton=event.target.closest('[data-tyre-weighting]');
  if(tyreWeightingButton){tyreWeighting=tyreWeightingButton.dataset.tyreWeighting;render();return;}
  const tyreRunButton=event.target.closest('[data-tyre-run]');
  if(tyreRunButton){tyreRunKey=tyreRunButton.dataset.tyreRun;render();return;}
  const resultsChartButton=event.target.closest('[data-results-chart]');
  if(resultsChartButton){resultsChartMetric=resultsChartButton.dataset.resultsChart;render();return;}
  const trendViewButton=event.target.closest('[data-trend-view]');
  if(trendViewButton){trendView=trendViewButton.dataset.trendView;sortKey=trendView==='fitted'?'trendModelled':'trendChange';sortDirection=1;render();return;}
  const metric=event.target.closest('[data-performance-metric]');
  if(metric) {activeMetric=metric.dataset.performanceMetric;render();if(activeMetric==='pits')loadPitData();return;}
  if(event.target.closest('[data-pit-retry]')){loadPitData(true);return;}
  const pitMeasureButton=event.target.closest('[data-pit-measure]');
  if(pitMeasureButton&&!pitMeasureButton.disabled){pitMeasure=pitMeasureButton.dataset.pitMeasure;render();return;}
  const pitSubjectButton=event.target.closest('[data-pit-subject]');
  if(pitSubjectButton){pitSubject=pitSubjectButton.dataset.pitSubject;render();return;}
  const pitChartButton=event.target.closest('[data-pit-chart]');
  if(pitChartButton){pitChartMetric=pitChartButton.dataset.pitChart;render();return;}
  const pitLaneBasisButton=event.target.closest('[data-pit-lane-basis]');
  if(pitLaneBasisButton){pitLaneBasis=pitLaneBasisButton.dataset.pitLaneBasis;render();return;}
  const sort=event.target.closest('[data-performance-sort]');
  const tyreMetricButton=event.target.closest('[data-tyre-metric]');
  if(tyreMetricButton){tyreMetric=tyreMetricButton.dataset.tyreMetric;sortKey=tyreMetric==='age'?'tyreAgeValue':'tyreNorm';sortDirection=1;render();return;}
  const tyreSubjectButton=event.target.closest('[data-tyre-subject]');
  if(tyreSubjectButton){tyreSubject=tyreSubjectButton.dataset.tyreSubject;render();return;}
  const tyre=event.target.closest('[data-performance-tyre]');
  if(tyre){tyreView=tyre.dataset.performanceTyre;render();}
  const straightSrc=event.target.closest('[data-straight-source]');
  if(straightSrc){straightLineSource=straightSrc.dataset.straightSource;render();}
  const brakeViewButton=event.target.closest('[data-braking-view]');
  const coverageButton=event.target.closest('[data-telemetry-coverage]');
  if(coverageButton){telemetryCoverageMode=coverageButton.dataset.telemetryCoverage;render();return;}
  const brakeQualityButton=event.target.closest('[data-braking-quality]');
  if(brakeQualityButton){brakingQualityMode=brakeQualityButton.dataset.brakingQuality;render();return;}
  const tyreConditionButton=event.target.closest('[data-tyre-condition]');
  if(tyreConditionButton){tyreConditionMode=tyreConditionButton.dataset.tyreCondition;render();return;}
  const pitVisitButton=event.target.closest('[data-pit-visits]');
  if(pitVisitButton){pitVisitMode=pitVisitButton.dataset.pitVisits;render();return;}
  if(brakeViewButton&&!brakeViewButton.disabled){brakingView=brakeViewButton.dataset.brakingView;render();return;}
  const band=event.target.closest('[data-straight-band]');
  const straightUnit=event.target.closest('[data-straight-unit]');
  if(straightUnit){straightGapUnit=straightUnit.dataset.straightUnit;render();}
  if(band&&!band.disabled){straightBand=band.dataset.straightBand;render();}
  const qualyModeBtn=event.target.closest('[data-qualy-mode]');
  if(qualyModeBtn){qualyPaceMode=qualyModeBtn.dataset.qualyMode;render();}
  if(sort) {
    const scrollY=window.scrollY;
    const table=sort.closest('.performance-table-wrap');
    const tableIndex=[...root.querySelectorAll('.performance-table-wrap')].indexOf(table);
    const scrollLeft=table?.scrollLeft||0;
    sortDirection=sortKey===sort.dataset.performanceSort?-sortDirection:Number(sort.dataset.sortDirection||1);
    sortKey=sort.dataset.performanceSort;
    render();
    const replacement=root.querySelectorAll('.performance-table-wrap')[tableIndex];
    if(replacement) replacement.scrollLeft=scrollLeft;
    window.scrollTo({top:scrollY,behavior:'instant'});
  }
});

// Auto-enhance selects on DOM load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('#carPerformance .select-shell select').forEach(sel => {
      if (typeof window.enhanceSelect === 'function') window.enhanceSelect(sel);
    });
  });
} else {
  document.querySelectorAll('#carPerformance .select-shell select').forEach(sel => {
    if (typeof window.enhanceSelect === 'function') window.enhanceSelect(sel);
  });
}
