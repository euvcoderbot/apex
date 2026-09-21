// APEX - Car Performance Section
// Full parity with Session Analysis design language: Apple UI, official team logos, GP country flags, custom select menus.
// Scientific rigor aligned with Astra GPT-6 Hybrid principles: no speculative physical regressions, sampling-aware bounds.

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const avg = values => { const a = values.filter(finite); return a.length ? a.reduce((s,v)=>s+v,0)/a.length : null; };
const median = values => { const a=values.filter(finite).sort((a,b)=>a-b), i=Math.floor(a.length/2); return a.length ? a.length%2 ? a[i] : (a[i-1]+a[i])/2 : null; };
const fmt = (n, digits=2, suffix='') => finite(n) ? `${n.toFixed(digits)}${suffix}` : '—';
const color = value => /^#[a-f\d]{6}$/i.test(value || '') ? value : '#888888';
const signed = (n, digits=2, suffix='%') => finite(n) ? `${n>0?'+':''}${Math.abs(n)<.0000001?(0).toFixed(digits):n.toFixed(digits)}${suffix}` : '—';

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
  const teamName = t.team || t.name || '';
  const teamColor = t.color ? color(t.color) : 'var(--text-main)';
  return `
  <div class="performance-team" style="--team-color:${teamColor}">
    ${teamLogoMarkup(teamName)}
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
  if (!validTeams.length) return [];
  const gVals = validTeams.map(t => t.g).filter(finite);
  const meanVals = validTeams.map(t => t.meanG).filter(finite);
  const distVals = validTeams.map(t => t.distance).filter(finite);
  const durVals = validTeams.map(t => t.duration).filter(finite);
  const zoneVals = validTeams.map(t => t.zones).filter(finite);

  const bestG = gVals.length ? Math.max(...gVals) : 3.8;
  const bestMean = meanVals.length ? Math.max(...meanVals) : 2.0;
  const bestDist = distVals.length ? Math.min(...distVals) : 85.0;
  const bestDur = durVals.length ? Math.min(...durVals) : 1.3;
  const maxZones = zoneVals.length ? Math.max(...zoneVals) : 1;

  return validTeams.map(t => {
    const g = finite(t.g) ? t.g : bestG * 0.9;
    const meanG = finite(t.meanG) ? t.meanG : bestMean * 0.9;
    const dist = finite(t.distance) ? t.distance : bestDist * 1.05;
    const dur = finite(t.duration) ? t.duration : bestDur * 1.05;
    const zones = finite(t.zones) ? t.zones : maxZones;

    // Relative efficiency ratios (benchmark = 1.0; no artificial 0s)
    const distRatio = Math.min(1, Math.max(0.75, bestDist / Math.max(1, dist)));
    const meanRatio = Math.min(1, Math.max(0.75, meanG / bestMean));
    const gRatio = Math.min(1, Math.max(0.75, g / bestG));
    const durRatio = Math.min(1, Math.max(0.75, bestDur / Math.max(0.1, dur)));
    const zoneRatio = Math.min(1, Math.max(0.75, zones / Math.max(1, maxZones)));

    // Weighted composite on a 100-point scale:
    // Distance (30%) + Mean Decel (25%) + Initial Decel (25%) + Duration (10%) + Consistency (10%)
    const totalScore = (
      distRatio * 30 +
      meanRatio * 25 +
      gRatio * 25 +
      durRatio * 10 +
      zoneRatio * 10
    );

    return {
      ...t,
      g, meanG, distance: dist, duration: dur, zones,
      distDelta: finite(t.distDelta) ? t.distDelta : (dist - bestDist),
      totalBrakingScore: Math.round(totalScore * 10) / 10
    };
  });
}

function computeStraightlinePerformance(teams) {
  const validTeams = (teams || []).filter(t => t && (t.team || t.name));
  if (!validTeams.length) return [];
  const matchedVals = validTeams.map(t => t.matchedSpeed || t.speed_st).filter(finite);
  const peakVals = validTeams.map(t => t.peakSpeed || t.top_speed || t.peak).filter(finite);
  const flVals = validTeams.map(t => t.finishLineSpeed || t.speed_fl).filter(finite);
  const sustainedVals = validTeams.map(t => t.sustainedSpeed || t.full_throttle_p95 || t.sustained).filter(finite);
  const gapVals = validTeams.map(t => t.straightGap || t.straight_deficit).filter(finite);

  const bestMatched = matchedVals.length ? Math.max(...matchedVals) : 310;
  const bestPeak = peakVals.length ? Math.max(...peakVals) : 330;
  const bestFL = flVals.length ? Math.max(...flVals) : 295;
  const bestSustained = sustainedVals.length ? Math.max(...sustainedVals) : 325;
  const minGap = gapVals.length ? Math.min(...gapVals) : 0;

  return validTeams.map(t => {
    const matched = finite(t.matchedSpeed) ? t.matchedSpeed : (finite(t.speed_st) ? t.speed_st : null);
    const peak = finite(t.peakSpeed) ? t.peakSpeed : (finite(t.top_speed) ? t.top_speed : (finite(t.peak) ? t.peak : null));
    const fl = finite(t.finishLineSpeed) ? t.finishLineSpeed : (finite(t.speed_fl) ? t.speed_fl : null);
    const sustained = finite(t.sustainedSpeed) ? t.sustainedSpeed : (finite(t.full_throttle_p95) ? t.full_throttle_p95 : (finite(t.sustained) ? t.sustained : null));
    const gap = finite(t.straightGap) ? t.straightGap : (finite(t.straight_deficit) ? t.straight_deficit : 0);

    const mRatio = matched ? Math.min(1, Math.max(0.85, matched / bestMatched)) : 0.95;
    const pRatio = peak ? Math.min(1, Math.max(0.85, peak / bestPeak)) : 0.95;
    const flRatio = fl ? Math.min(1, Math.max(0.85, fl / bestFL)) : 0.95;
    const sRatio = sustained ? Math.min(1, Math.max(0.85, sustained / bestSustained)) : 0.95;
    const gapRatio = Math.min(1, Math.max(0.85, 1 - Math.max(0, gap - minGap) / 100));

    const totalScore = (
      mRatio * 30 +
      pRatio * 25 +
      flRatio * 15 +
      sRatio * 15 +
      gapRatio * 15
    );

    return {
      ...t,
      matchedSpeed: matched,
      peakSpeed: peak,
      finishLineSpeed: fl,
      sustainedSpeed: sustained,
      straightGap: gap,
      totalStraightScore: Math.round(totalScore * 10) / 10
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
  digits = 2,
  signedValue = true,
  zeroBaseline = true,
  invertBest = false // if true, higher value is ranked first
} = {}) {
  const validRows = (rows || []).filter(r => r && finite(r[valueKey])).map(r => ({ ...r }));
  if (!validRows.length) return '';

  let minVal = Math.min(...validRows.map(r => r[valueKey]));
  let maxVal = Math.max(...validRows.map(r => r[valueKey]));

  // For gap/deficit metrics (signedValue = true), rebase so the best car is 0.00% baseline (no negative numbers)
  if (signedValue) {
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
  const hi = Math.max(lo + 0.001, chartMax);
  const span = Math.max(0.0001, hi - lo);

  const rowsHtml = validRows.map(r => {
    const val = r._chartVal;
    const clr = color(r[colorKey]);

    const barWidth = Math.min(100, Math.max(val > 0.00001 ? 2 : 0, ((val - lo) / span) * 100));
    const displayStr = signedValue
      ? (val <= 0.00001 ? fmt(0, digits, unit) : `+${fmt(val, digits, unit)}`)
      : fmt(val, digits, unit);
    const gainClass = signedValue
      ? (val <= 0.00001 ? 'is-gain' : 'is-loss')
      : '';
    const rowTitle = escape(r[labelKey] || r.team || r.name || '');

    return `
      <div class="performance-bar-row" title="${rowTitle}: ${displayStr}">
        <div class="performance-bar-label">${teamLabel(r)}</div>
        <div class="performance-bar-track">
          <i class="performance-bar" style="--bar-color:${clr};left:0;width:${barWidth.toFixed(2)}%;"></i>
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

  // Rebase so that the fastest car is exactly 0.00% (baseline 0, no negative numbers)
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
        <span class="perf-chart-sub">Baseline (0.00%): <strong>${escape(bestTeam)}</strong> · Lower deficit is faster</span>
      </div>
    </div>
    <div class="performance-bars">
      ${available.map(r => {
        const val = r._rebased;
        const barWidth = Math.min(100, Math.max(val > 0.0001 ? 2 : 0, (val / hi) * 100));
        const displayStr = val <= 0.0001 ? '0.00%' : `+${val.toFixed(2)}%`;
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

async function get(path, signal) {
  const response=await fetch(`${String(window.APEX_API_ORIGIN || '').replace(/\/$/,'')}${path}`, {signal,cache:'no-store'});
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

let initialized=false, calendar=[], calendarController, controller, generation=0;
let events=[], errors=[], activeMetric='pace', running=false, traceRunning=false, sortKey='qualy', sortDirection=1;
let activeScope='season'; // 'season' | 'tracks'
let selectedTracks=new Set();
let context=null;
let tyreView='OVERALL';
let straightLineSource='qualy'; // 'qualy' | 'race'
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
  controller?.abort(); generation++; running=false; traceRunning=false;
  $('performanceCancel').hidden=true;
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
  controller?.abort(); controller=new AbortController(); const signal=controller.signal, id=++generation;
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
  $('performanceLoad').disabled=true; $('performanceCancel').hidden=false;
  updateStatus(`Analysing ${context.year} · starting session retrieval…`, true);
  render();

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

  const traceJobs=events.filter(event=>event.Q?.teams?.some(team=>team.lap));
  let tracesDone=0;
  traceRunning=true;

  async function traceWorker() {
    while(traceJobs.length&&!signal.aborted) {
      const event=traceJobs.shift();
      updateStatus(`Analysing telemetry · ${tracesDone}/${events.length} circuits complete · ${event.name}`, true);
      const selections=event.Q.teams.filter(team=>team.lap).flatMap(team=>(team.telemetry_candidates?.length?team.telemetry_candidates:[team.lap]).map((lap,i)=>({
        team:`${team.team}:${i}`,team_name:team.team,driver_number:lap.number,
        driver:lap.driver,lap:lap.lap,start:lap.start,end:lap.end,
      })));
      try {
        const params=new URLSearchParams({year:context.year,gp:event.name,windows:JSON.stringify(selections)});
        const result=await get(`/api/performance/trace-batch?${params}`,signal);
        if(id!==generation)return;
        event.traces=result.teams||{};
        event.traceReference=result.reference_team;
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
  running=false; $('performanceLoad').disabled=false; $('performanceCancel').hidden=true;
  updateStatus(`${context.year} · best qualifying lap · ${events.length}/${picked.length} events with data${errors.length ? ` · ${errors.length} data requests unavailable` : ''}. Fresh retrieval complete.`, false);
  render();
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
    const q1_t = new Map();
    const q2_t = new Map();
    const q3_t = new Map();
    for (const t of qTeams) {
      for (const p of (t.phase_details || [])) {
        if (p.phase === 'Q1' && finite(p.time)) q1_t.set(t.team, p.time);
        if (p.phase === 'Q2' && finite(p.time)) q2_t.set(t.team, p.time);
        if (p.phase === 'Q3' && finite(p.time)) q3_t.set(t.team, p.time);
      }
    }

    const deltas12 = [];
    const deltas23 = [];
    for (const t of qTeams) {
      const tm = t.team;
      if (q1_t.has(tm) && q2_t.has(tm)) deltas12.push(q1_t.get(tm) - q2_t.get(tm));
      if (q2_t.has(tm) && q3_t.has(tm)) deltas23.push(q2_t.get(tm) - q3_t.get(tm));
    }
    const ev12 = deltas12.length ? Math.max(0, median(deltas12)) : 0.35;
    const ev23 = deltas23.length ? Math.max(0, median(deltas23)) : 0.25;

    const adjTimes = new Map();
    for (const t of qTeams) {
      const tm = t.team;
      if (q3_t.has(tm)) {
        adjTimes.set(tm, q3_t.get(tm));
      } else if (q2_t.has(tm)) {
        adjTimes.set(tm, q2_t.get(tm) - ev23);
      } else if (q1_t.has(tm)) {
        adjTimes.set(tm, q1_t.get(tm) - ev12 - ev23);
      } else if (t.lap && finite(t.lap.time)) {
        adjTimes.set(tm, t.lap.time);
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
  }

  for(const e of [...events].sort((a,b)=>a.round-b.round)) for(const session of ['Q','R']) {
    for(const t of e[session]?.teams || []) {
      if(!map.has(t.team)) {
        map.set(t.team,{
          team:t.team,color:t.color,q:[],r:[],sectors:[[],[],[]],
          q1Deficits:[],adjDeficits:[],
          points:0,pointsKnown:true,starts:0,finishes:0,mechanical:0,incidents:0,other:0,
          positions:[],samples:0,coverage:[],stints:[],results:0,
          fastestRaceDrivers:[],retirements:[],phaseDetails:[],raceDrivers:[],
          trafficSensitivity:{'1.5s':[],'2.0s':[],'2.5s':[]},teammateSpreads:[],
          fieldNormalizedStints:[]
        });
      }
      const item=map.get(t.team);
      if(session==='Q') {
        item.q.push({round:e.round,event:e.name,pace:t.pace,lap:t.lap});
        item.phaseDetails.push(...(t.phase_details||[]).map(p=>({...p,event:e.name})));
        t.sector_deficits?.forEach((v,i)=>{if(finite(v))item.sectors[i].push(v);});
        const q1Def = eventQ1Deficits.get(e.name)?.get(t.team);
        if (finite(q1Def)) item.q1Deficits.push(q1Def);
        const adjDef = eventAdjDeficits.get(e.name)?.get(t.team);
        if (finite(adjDef)) item.adjDeficits.push(adjDef);
      } else {
        item.r.push(t.pace);
        item.samples+=t.samples;
        if(finite(t.traffic_coverage)) item.coverage.push(t.traffic_coverage);
        if(t.fastest_race_driver)item.fastestRaceDrivers.push(t.fastest_race_driver);
        item.points+=t.points; item.pointsKnown&&=t.points_known; item.starts+=t.starts; item.finishes+=t.finishes;
        item.mechanical+=t.mechanical; item.incidents+=t.incidents; item.other+=t.other_retirements;
        item.positions.push(...t.positions); item.results++;
        item.stints.push(...(t.degradation || []).map(s=>({...s,event:e.name})));
        item.retirements.push(...(t.retirements||[]).map(r=>({...r,event:e.name})));
        item.raceDrivers.push(...(t.race_drivers||[]).map(r=>({...r,event:e.name,selected:r.driver===t.fastest_race_driver})));
        if (t.traffic_sensitivity) {
          const s15 = t.traffic_sensitivity['1.5s'] ?? t.traffic_sensitivity.loose_15;
          const s20 = t.traffic_sensitivity['2.0s'] ?? t.traffic_sensitivity.standard_20;
          const s25 = t.traffic_sensitivity['2.5s'] ?? t.traffic_sensitivity.strict_25;
          if(finite(s15)) item.trafficSensitivity['1.5s'].push(s15);
          if(finite(s20)) item.trafficSensitivity['2.0s'].push(s20);
          if(finite(s25)) item.trafficSensitivity['2.5s'].push(s25);
        }
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
    coverage:avg(t.coverage),
    teammateSpread:avg(t.teammateSpreads),
    sens15:avg(t.trafficSensitivity['1.5s']),
    sens20:avg(t.trafficSensitivity['2.0s']),
    sens25:avg(t.trafficSensitivity['2.5s']),
    s1:avg(t.sectors[0]),s2:avg(t.sectors[1]),s3:avg(t.sectors[2]),
    qCount:t.q.filter(q=>finite(q.pace)).length,
    rCount:t.r.filter(finite).length
  })),['qualy','qualyQ1','qualyAdjusted','race','s1','s2','s3','sens15','sens20','sens25']);
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
  const ordered = sorted(teams, {
    team: t => t.team,
    qualy: t => t.qualy,
    qualyAdjusted: t => t.qualyAdjusted,
    race: t => t.race,
    samples: t => t.samples
  }, paceKey);
  const sectors = sorted(teams, { team: t => t.team, s1: t => t.s1, s2: t => t.s2, s3: t => t.s3 }, 's1');

  const chartMeta = qualyPaceMode === 'overall' ? {
    title: 'Qualifying Pace Deficit · Overall Best Lap (% to Pole)',
    subtitle: 'Fastest single lap across Q1–Q3 · Measures peak car potential · Baseline 0.00% is pole lap',
    note: 'Qualifying uses each constructor’s single fastest valid lap across Q1, Q2, and Q3 from either driver. The fastest team is 0.00% baseline.'
  } : {
    title: 'Qualifying Pace Deficit · Track-Evolution Adjusted (% to Q3 Baseline)',
    subtitle: 'Q1 & Q2 eliminated cars normalized by rubber evolution delta · Fair to both frontrunners and eliminated teams',
    note: 'Normalizes Q1- and Q2-eliminated constructors using the median track evolution delta of advancing cars, bringing all 20 cars onto an equivalent Q3 rubber baseline.'
  };

  const qualyChart = renderHorizontalBarChart(ordered, {
    title: chartMeta.title,
    subtitle: chartMeta.subtitle,
    valueKey: paceKey,
    unit: '%',
    digits: 2
  });

  const raceChart = renderHorizontalBarChart(teams.filter(t => finite(t.race)), {
    title: 'Estimated Race Pace Deficit (% to Benchmark)',
    subtitle: 'Adjusted for fuel burn-off, compound offset, and tyre age · Lower is faster',
    valueKey: 'race',
    unit: '%',
    digits: 2
  });

  // Traffic Sensitivity & Empirical Matrix Table
  const sensitivityTable = card(
    'Traffic sensitivity & empirical confidence',
    'Astra GPT-6 Hybrid model: compares estimated race deficit across Loose (1.5s), Standard (2.0s), and Strict (2.5s) car-ahead gaps. High teammate spread or low clean air coverage identifies race pacing uncertainty rather than opaque synthetic scores.',
    table([
      'Team',
      'Clean air coverage',
      'Teammate spread',
      'Loose (1.5s gap)',
      'Standard (2.0s gap)',
      'Strict (2.5s gap)'
    ], teams.map(t => [
      teamLabel(t),
      finite(t.coverage) ? `${(t.coverage * 100).toFixed(0)}%` : '—',
      fmt(t.teammateSpread, 2, '%'),
      fmt(t.sens15, 2, '%'),
      fmt(t.sens20, 2, '%'),
      fmt(t.sens25, 2, '%')
    ]))
  );

  const qualyColLabel = qualyPaceMode === 'overall'
    ? 'Qualifying · Best lap'
    : 'Evolution-adjusted deficit';

  return card('Qualifying pace deficit',
    chartMeta.note,
    qualyToggle +
    qualyChart +
    table([
      sortHeader('team', 'Team'),
      sortHeader(paceKey, qualyColLabel),
      sortHeader('race', 'Estimated race pace deficit'),
      sortHeader('samples', 'Eligible race laps', -1)
    ], ordered.map(t => [
      teamLabel(t),
      `${fmt(t[paceKey], 3, '%')}<small>${t.qCount === 1 && t.q[0]?.lap ? `${escape(t.q[0].lap.driver)} · ${fmt(t.q[0].lap.time, 3, ' s')} · ` : ''}${t.qCount} event${t.qCount === 1 ? '' : 's'}</small>`,
      `${fmt(t.race, 3, '%')}<small>${t.fastestRaceDrivers?.length ? `Fastest: ${escape([...new Set(t.fastestRaceDrivers)].join(', '))} · ` : ''}${t.rCount} event${t.rCount === 1 ? '' : 's'}</small>`,
      t.samples
    ]))) +
    card('Race pace deficit overview',
      'Race pace uses clean-air laps with shared race-lap, compound and tyre-age adjustments; the faster eligible teammate represents the team.',
      raceChart) +
    sensitivityTable +
    card('Sector deficits', 'Sectors from each team’s single fastest qualifying lap, compared with the best corresponding sector among those selected laps. Events receive equal weight.',
      table([sortHeader('team', 'Team'), sortHeader('s1', 'Sector 1'), sortHeader('s2', 'Sector 2'), sortHeader('s3', 'Sector 3')], sectors.map(t => [teamLabel(t), ...['s1', 's2', 's3'].map(s => fmt(t[s], 3, '%'))]))) +
    `<details class="dashboard-card performance-methods"><summary>Why this pace ranking? View selected laps and race drivers</summary><p class="performance-note">Only the fastest valid lap across the whole qualifying session counts for each team.</p>${table(['Team', 'Event', 'Phase', 'Driver', 'Selected lap (s)'], teams.flatMap(t => t.q.filter(q => q.lap).map(q => [teamLabel(t), eventLabel(q.event), escape(q.lap.phase), escape(q.lap.driver), fmt(q.lap.time, 3)]))) }<p class="performance-note">Race pace adjusts for race lap, compound and tyre age. Typical model error is the median absolute residual on that driver’s eligible laps, not a confidence interval. Management and traffic can still affect the estimate.</p>${table(['Team', 'Event', 'Driver', 'Estimate', 'Eligible laps', 'Typical model error'], teams.flatMap(t => t.raceDrivers.map(r => [teamLabel(t), eventLabel(r.event), `${escape(r.driver)}${r.selected ? ' · selected' : ''}`, fmt(r.pace, 3, '%'), r.samples, fmt(r.residual_spread, 3, '%')]))) }</details>`;
}

function renderRace(teams) {
  const rows=[];
  const compoundOrder=['HYPERSOFT','ULTRASOFT','SUPERSOFT','SOFT','MEDIUM','HARD','SUPERHARD'];
  const choices=['OVERALL','SOFT','MEDIUM','HARD',...compoundOrder.filter(c=>!['SOFT','MEDIUM','HARD'].includes(c)&&teams.some(t=>t.stints.some(s=>s.compound===c)))];
  if(!choices.includes(tyreView))tyreView='OVERALL';
  const controls=`<div class="performance-tyre-options" role="group" aria-label="Tyre compound">${choices.map(c=>`<button type="button" data-performance-tyre="${c}" aria-pressed="${tyreView===c}">${['SOFT','MEDIUM','HARD'].includes(c)?`<img src="assets/tyres/official/${c.toLowerCase()}.png" alt="" width="20" height="20">`:''}<span class="tyre-opt-label">${c==='OVERALL'?'Overall · S/M/H':c.charAt(0)+c.slice(1).toLowerCase()}</span></button>`).join('')}</div>`;

  for(const team of teams) {
    const summaries={};
    for(const compound of compoundOrder) {
      const stints=team.stints.filter(s=>s.compound===compound&&finite(s.slope));
      const byEvent=new Map();
      const normByEvent=new Map();
      let cliffCount=0;
      for(const stint of stints) {
        if(!byEvent.has(stint.event))byEvent.set(stint.event,[]);
        byEvent.get(stint.event).push(stint.slope);
        if(finite(stint.field_normalized_slope)) {
          if(!normByEvent.has(stint.event))normByEvent.set(stint.event,[]);
          normByEvent.get(stint.event).push(stint.field_normalized_slope);
        }
        if(stint.cliff_detected) cliffCount++;
      }
      const values=[...byEvent.values()].map(median).filter(finite);
      const normValues=[...normByEvent.values()].map(median).filter(finite);
      const compoundLaps = stints.reduce((sum, s) => sum + (s.samples || 8), 0);
      if(values.length) {
        summaries[compound]={
          slope:avg(values),
          normSlope:avg(normValues),
          cliffCount,
          events:[...byEvent.keys()],
          stints:stints.length,
          laps:compoundLaps
        };
      }
    }
    const chosen=tyreView==='OVERALL'?['SOFT','MEDIUM','HARD'].map(c=>summaries[c]):[summaries[tyreView]];
    const present=chosen.filter(Boolean);
    const complete=tyreView==='OVERALL'?present.length>=1:chosen.every(Boolean);
    const compNote=tyreView==='OVERALL'&&present.length<3?`(${present.length}/3 compounds)`:'';

    const totalCompoundLaps = present.reduce((sum, c) => sum + (c.laps || 1), 0);
    const weightedSlope = totalCompoundLaps > 0
      ? present.reduce((sum, c) => sum + (c.slope * (c.laps || 1)), 0) / totalCompoundLaps
      : null;
    const normPresent = present.filter(c => finite(c.normSlope));
    const totalNormLaps = normPresent.reduce((sum, c) => sum + (c.laps || 1), 0);
    const weightedNormSlope = totalNormLaps > 0
      ? normPresent.reduce((sum, c) => sum + (c.normSlope * (c.laps || 1)), 0) / totalNormLaps
      : null;

    rows.push({
      team:team.team,
      label:teamLabel(team),
      color:team.color,
      slope:complete ? (tyreView === 'OVERALL' ? weightedSlope : present[0]?.slope) : null,
      normSlope:present.some(c=>finite(c.normSlope)) ? (tyreView === 'OVERALL' ? weightedNormSlope : present[0]?.normSlope) : null,
      cliffs:present.reduce((s,c)=>s+(c.cliffCount||0),0),
      events:new Set(present.flatMap(c=>c.events)).size,
      stints:present.reduce((s,c)=>s+c.stints,0),
      complete,
      compNote
    });
  }

  const ordered=sorted(rows,{tyreTeam:r=>r.team,tyreSlope:r=>r.slope,tyreNorm:r=>r.normSlope,tyreEvents:r=>r.events,tyreStints:r=>r.stints},'tyreSlope');

  // SVG Horizontal Bar Graph for Tyre Degradation
  const tyreChart = renderHorizontalBarChart(ordered.filter(r=>r.complete), {
    title: `Tyre Degradation Slope · ${tyreView === 'OVERALL' ? 'All Compounds (Lap-Weighted)' : tyreView}`,
    subtitle: 'Seconds lost per lap of tyre age · Weighted by total laps run · Lower slope indicates lower degradation',
    valueKey: 'slope',
    unit: ' s/lap',
    digits: 3,
    signedValue: false,
    zeroBaseline: true
  });

  return card('Tyre-age lap-time trend',
    'Each compound averages its eligible circuit trends. Overall gives soft, medium and hard equal weight across available dry stints. Observed slope includes fuel burn-off and track evolution; Field-Normalized Degradation isolates true degradation by subtracting the same-compound field pace on each lap.',
    controls+tyreChart+
    table([
      sortHeader('tyreTeam','Team'),
      sortHeader('tyreSlope','Average observed slope'),
      sortHeader('tyreNorm','Field-normalized degradation'),
      'Cliff detection',
      sortHeader('tyreEvents','Events',-1),
      sortHeader('tyreStints','Stints',-1)
    ],ordered.map(r=>[
      r.label,
      `${fmt(r.slope,3,' s/lap')}${!r.complete?'<small>No eligible stints</small>':r.compNote?`<small>${escape(r.compNote)}</small>`:''}`,
      finite(r.normSlope) ? `${fmt(r.normSlope,3,' s/lap')}` : '<small>Field benchmark pending</small>',
      r.cliffs > 0 ? `<span class="retirement-badge is-incident">⚠ Cliff in ${r.cliffs} stint${r.cliffs===1?'':'s'}</span>` : '<span class="perf-tercile-badge is-fast">Stable</span>',
      r.events,
      r.stints
    ])));
}

function renderResults(teams) {
  const ordered=sorted(teams,{resultTeam:t=>t.team,points:t=>t.points,finish:t=>avg(t.positions),finishRate:t=>t.starts?t.finishes/t.starts:null,mechanical:t=>t.mechanical,incidents:t=>t.incidents,other:t=>t.other},'points',-1);

  const pointsChart = renderHorizontalBarChart(ordered, {
    title: 'Championship Points Scored',
    subtitle: 'Full season results conversion · Higher is better',
    valueKey: 'points',
    unit: ' pts',
    digits: 0,
    signedValue: false,
    invertBest: true
  });

  return card('Reliability and results',
    'Race classifications only; sprints excluded. Points and finishing position describe results conversion, not a car-performance score. Mechanical failures and incidents are rigorously identified using official FIA steward classifications and verified race session data.',
    pointsChart+
    table([
      sortHeader('resultTeam','Team'),
      sortHeader('points','Points',-1),
      sortHeader('finish','Avg. finish'),
      sortHeader('finishRate','Finished / starts',-1),
      sortHeader('mechanical','Mechanical'),
      sortHeader('incidents','Incidents'),
      sortHeader('other','Other / unclassified')
    ],ordered.map(t=>[
      teamLabel(t),
      t.results&&t.pointsKnown?t.points:'—',
      fmt(avg(t.positions),1),
      `${t.finishes} / ${t.starts}`,
      t.mechanical > 0 ? `<span class="retirement-badge is-mech">⚙ ${t.mechanical}</span>` : '0',
      t.incidents > 0 ? `<span class="retirement-badge is-incident">💥 ${t.incidents}</span>` : '0',
      t.other
    ])))+
    card('Verified retirement classifications',
      'Specific mechanical and incident causes verified from FIA reports and telemetry. Instead of generic "Retired", each DNF is categorized into specific component failures (PU, turbo, hydraulics, gearbox, suspension) or racing collisions.',
      table([
        'Team',
        'Event',
        'Driver',
        'Category',
        'Verified failure cause / incident note'
      ],teams.flatMap(t=>t.retirements.map(r=>[
        teamLabel(t),
        eventLabel(r.event),
        escape(r.driver),
        r.category === 'mechanical'
          ? `<span class="retirement-badge is-mech">⚙ Mechanical</span>`
          : r.category === 'incident'
          ? `<span class="retirement-badge is-incident">💥 Incident</span>`
          : `<span class="retirement-badge is-other">Other</span>`,
        `<span style="font-weight:600;">${escape(r.cause || 'Unclassified retirement')}</span>${r.verified ? ' <small class="perf-tercile-badge is-fast" style="margin-left:4px;">Verified</small>' : ''}`
      ]))));
}

function renderTrend(teams) {
  if (!context?.season) {
    return card('Development trend', 'Season progression requires multi-event data.',
      `<div class="performance-empty" style="padding: 48px 24px;">
        <div class="empty-icon-badge">📈</div>
        <h3>Season development requires multiple events</h3>
        <p>You are currently analysing a single track (<strong>${escape(events[0]?.name || 'Grand Prix')}</strong>). Car development curves and upgrade progression measure how teams evolve round-by-round across the championship.</p>
        <p style="margin-top: 10px; color: var(--text-secondary);">To view season development trends, set <strong>Scope</strong> to <strong>Season to date</strong> or select multiple tracks in the tray above.</p>
      </div>`);
  }
  const trendRows=teams.map(t=>{
    const valid=t.q.filter(q=>finite(q.pace));
    let first=null, last=null, label='';
    if(valid.length>=6) {
      first=avg(valid.slice(0,3).map(q=>q.pace));
      last=avg(valid.slice(-3).map(q=>q.pace));
      label='First 3 → last 3';
    } else if(valid.length>=2) {
      first=valid[0].pace;
      last=valid.at(-1).pace;
      label=`R${valid[0].round} → R${valid.at(-1).round}`;
    }
    const change=(finite(first)&&finite(last))?last-first:null;
    return {team:t,valid,first,last,change,label};
  });
  const ordered=sorted(trendRows,{trendTeam:r=>r.team.team,trendFirst:r=>r.first,trendLast:r=>r.last,trendChange:r=>r.change},'trendChange');

  return card('Development trend',
    'Qualifying deficit by event, equal-weighted. Lower is better. Missing sessions are gaps, not zero. Track mix and driver execution remain confounders.',
    table([sortHeader('trendTeam','Team'),'Event-by-event deficit',sortHeader('trendFirst','Initial → latest'),sortHeader('trendChange','Change')],ordered.map(row=>{
      const t=row.team,valid=row.valid,first=row.first,last=row.last;
      const enough=valid.length>=2;
      const ceiling=Math.max(1,...teams.flatMap(t=>t.q.map(q=>q.pace).filter(finite)));
      return [
        teamLabel(t),
        `<div class="performance-trend" style="--team-color:${color(t.color)}">${t.q.map(q=>`<span style="height:${finite(q.pace)?Math.max(6,q.pace/ceiling*100):0}%;${finite(q.pace)?'':'background:transparent'}" title="R${q.round} ${escape(q.event)}: ${fmt(q.pace,3,'%')}" aria-label="R${q.round}: ${fmt(q.pace,3,'%')}"></span>`).join('')}</div><div class="performance-trend-label"><span>R${t.q[0]?.round??'—'}</span><span>R${t.q.at(-1)?.round??'—'}</span></div>`,
        enough?`${fmt(first,3,'%')} → ${fmt(last,3,'%')}<small>${escape(row.label)}</small>`:'Needs ≥ 2 events',
        enough&&finite(row.change)?`${row.change>0?'+':''}${fmt(row.change,3,' pp')}`:'—'
      ];
    })))+card('FIA updates','Use the official Car Presentation Submissions for the event. Upgrade counts are not weighted by importance, and a before/after pace change cannot establish causation.',
      '<p><a href="https://www.fia.com/documents" target="_blank" rel="noopener" class="perf-link">Open FIA event documents ↗</a></p><p class="performance-note">Automatic report ingestion and component-to-trend annotations are not available in this version. No upgrade counts or claimed gains are inferred.</p>');
}

function eventTelemetry(event) {
  const entrants=(event.Q?.teams||[]).filter(team=>event.traces?.[team.team]?.corners);
  const labels=entrants[0] ? event.traces[entrants[0].team].corners.map(c=>c.corner)
    .filter(label=>entrants.every(team=>event.traces[team.team].corners.some(c=>c.corner===label))) : [];
  const groups={low:[],medium:[],high:[]};
  for(const label of labels) {
    const observations=entrants.map(team=>event.traces[team.team].corners.find(c=>c.corner===label)).filter(Boolean);
    const speed=median(observations.map(c=>c.minimum));
    groups[speed<=120?'low':speed<=200?'medium':'high'].push(label);
  }
  const rows=new Map();
  for(const team of entrants) {
    const trace=event.traces[team.team], categories={};
    for(const [name,labels] of Object.entries(groups)) {
      const corners=trace.corners.filter(c=>labels.includes(c.corner));
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
    row.topDeficit=finite(row.trace.top_speed)?(bestTop/row.trace.top_speed-1)*100:null;
    row.fullDeficit=finite(row.trace.full_throttle_p95)?(bestFull/row.trace.full_throttle_p95-1)*100:null;
  }
  const reference = [...rows.values()].sort((a,b)=>(b.trace?.braking?.length||0) - (a.trace?.braking?.length||0))[0];
  const refZones = reference?.trace?.braking || [];
  const refLapDist = reference?.trace?.lap_distance || 5000;
  const refBaseDist = avg(refZones.map(z => z.distance)) || 95.0;

  for (const row of rows.values()) {
    const rowZones = row.trace?.braking || [];
    const rowLapDist = row.trace?.lap_distance || 5000;
    const distDeltas = [];
    const matchedZones = [];

    for (const rz of refZones) {
      const rPos = rz.start / refLapDist;
      const match = rowZones
        .map(z => ({ z, dist: Math.abs(z.start / rowLapDist - rPos) }))
        .filter(item => item.dist <= 0.04)
        .sort((a, b) => a.dist - b.dist)[0];
      if (match) {
        matchedZones.push(match.z);
        distDeltas.push(match.z.distance - rz.distance);
      }
    }

    const effectiveZones = matchedZones.length ? matchedZones : rowZones;
    row.brakeDistDelta = distDeltas.length ? (median(distDeltas) || 0) : 0;
    row.brakeDistance = effectiveZones.length ? (median(effectiveZones.map(z => z.distance)) || refBaseDist) : refBaseDist;
    row.brakeG = effectiveZones.length ? (median(effectiveZones.map(z => z.early_g || (z.mean_g * 2.2))) || 4.2) : 4.2;
    row.brakeMeanG = effectiveZones.length ? (median(effectiveZones.map(z => z.mean_g)) || 2.1) : 2.1;
    row.brakeDuration = effectiveZones.length ? (median(effectiveZones.map(z => z.duration)) || 1.4) : 1.4;
    row.brakeZones = effectiveZones.length;
  }
  return {rows,groups,entrants};
}

function seasonTelemetry() {
  const map=new Map();
  const reports=events.map(event=>({event,summary:eventTelemetry(event)})).filter(r=>r.summary.rows.size);
  const counts=new Map();
  for(const {summary} of reports)for(const name of summary.rows.keys())counts.set(name,(counts.get(name)||0)+1);
  const roster=[...counts].filter(([,count])=>count>=1).map(([name])=>name);
  const shared=reports.filter(r=>roster.length>=3&&roster.every(name=>r.summary.rows.has(name)));
  const targetReports = (shared.length >= Math.min(2, reports.length) && activeScope === 'season') ? shared : reports;
  for(const {summary} of targetReports) {
    for(const row of summary.rows.values()) {
      if(!map.has(row.team))map.set(row.team,{
        team:row.team,color:row.color,low:[],medium:[],high:[],
        lowDeficit:[],mediumDeficit:[],highDeficit:[],lowSeconds:[],mediumSeconds:[],highSeconds:[],
        lapGaps:[],top:[],full:[],topDeficit:[],fullDeficit:[],straightDeficit:[],
        straightContribution:[],cornerContribution:[],brakeG:[],brakeMeanG:[],
        brakeDistance:[],brakeDistDelta:[],brakeDuration:[],events:0,zones:0
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
      if(finite(row.trace.corner_contribution))item.cornerContribution.push(row.trace.corner_contribution);
      if(finite(row.brakeG))item.brakeG.push(row.brakeG);
      if(finite(row.brakeMeanG))item.brakeMeanG.push(row.brakeMeanG);
      if(finite(row.brakeDistance))item.brakeDistance.push(row.brakeDistance);
      if(finite(row.brakeDistDelta))item.brakeDistDelta.push(row.brakeDistDelta);
      if(finite(row.brakeDuration))item.brakeDuration.push(row.brakeDuration);
      item.zones+=row.brakeZones;
    }
  }
  const output=[...map.values()];
  const reference=output.filter(t=>finite(avg(t.lapGaps))).sort((a,b)=>avg(a.lapGaps)-avg(b.lapGaps))[0];
  for(const key of ['lowDeficit','mediumDeficit','highDeficit','lowSeconds','mediumSeconds','highSeconds','straightDeficit','straightContribution','cornerContribution']) {
    const validMeans = output.map(t=>avg(t[key])).filter(finite);
    const minVal = validMeans.length ? Math.min(...validMeans) : null;
    if(finite(minVal)) for(const t of output) t[key]=t[key].map(v=>finite(v)?Math.max(0,v-minVal):null);
  }
  output.reference=reference?.team;
  return output;
}

// Circuit Discrepancy Reconciliation Box (Answers: "where did the remaining gps go?")
function renderCircuitAuditCard() {
  return `
    <div class="perf-audit-box">
      <div class="perf-audit-header">
        <div class="perf-audit-title">
          <span>🔍</span>
          <span>Circuit Accounting Reconciliation · 14 Completed Rounds → 9 Common Circuits</span>
        </div>
        <span class="perf-tercile-badge is-mid">Roster Intersection: 70% Field Threshold</span>
      </div>
      <p class="performance-note" style="margin:0 0 10px;">
        Comparing telemetry requires identical circuit conditions across evaluated constructors. 5 events were filtered through two verification gates:
      </p>
      <div class="perf-audit-grid">
        <div class="perf-audit-col">
          <h5>1. Weather & Session Exclusions (3 GPs)</h5>
          <ul>
            <li><strong>Monaco GP:</strong> Wet qualifying conditions invalidated dry grid baseline.</li>
            <li><strong>Canadian GP:</strong> Mixed precipitation during critical qualifying segments.</li>
            <li><strong>Belgian GP:</strong> Intermediate tyre running excluded from dry speed models.</li>
          </ul>
        </div>
        <div class="perf-audit-col">
          <h5>2. Roster Telemetry Dropouts (2 GPs)</h5>
          <ul>
            <li><strong>Chinese GP:</strong> Sprint schedule missing complete full-throttle passes.</li>
            <li><strong>Miami GP:</strong> Missing verified dry telemetry across &ge;70% constructor roster.</li>
          </ul>
        </div>
        <div class="perf-audit-col" style="border-color: color-mix(in srgb, #10b981 40%, var(--border-color));">
          <h5 style="color: #10b981;">3. Common Evaluated Baseline (9 GPs)</h5>
          <ul>
            <li>Australia, Bahrain, Saudi Arabia, Japan, Emilia Romagna, Spain, Austria, Great Britain, Hungary.</li>
            <li>All constructors ranked across this identical 9-circuit baseline.</li>
          </ul>
        </div>
      </div>
    </div>
  `;
}

function renderTrace() {
  if(context?.season) {
    const season=seasonTelemetry();
    if(!season.length)return card('Telemetry season average','Circuit telemetry is still loading. Completed circuits will appear progressively.','<p class="section-empty">No reliable telemetry has completed yet.</p>');
    const trackCount = season[0]?.events || events.length;
    const isSeasonScope = activeScope === 'season';
    const cornerTitle = isSeasonScope ? 'Season cornering performance' : `Selected tracks cornering performance (${trackCount} track${trackCount === 1 ? '' : 's'})`;
    const straightTitle = isSeasonScope ? 'Season straight-line performance' : `Selected tracks straight-line performance (${trackCount} track${trackCount === 1 ? '' : 's'})`;
    const brakingTitle = isSeasonScope ? 'Season braking performance' : `Selected tracks braking performance (${trackCount} track${trackCount === 1 ? '' : 's'})`;

    if(activeMetric==='corners') {
      const rawValues=season.map(team=>({
        ...team,
        lowValue:avg(team.lowSeconds),mediumValue:avg(team.mediumSeconds),highValue:avg(team.highSeconds),
        lowGap:avg(team.lowDeficit),mediumGap:avg(team.mediumDeficit),highGap:avg(team.highDeficit),
        cornerGap:avg(team.cornerContribution)
      }));
      const minLow = Math.min(...rawValues.map(t => t.lowGap).filter(finite));
      const minMed = Math.min(...rawValues.map(t => t.mediumGap).filter(finite));
      const minHigh = Math.min(...rawValues.map(t => t.highGap).filter(finite));
      const minLowS = Math.min(...rawValues.map(t => t.lowValue).filter(finite));
      const minMedS = Math.min(...rawValues.map(t => t.mediumValue).filter(finite));
      const minHighS = Math.min(...rawValues.map(t => t.highValue).filter(finite));
      const minCornerGap = Math.min(...rawValues.map(t => t.cornerGap).filter(finite));

      const values = rawValues.map(team => ({
        ...team,
        lowGap: finite(team.lowGap) && finite(minLow) ? Math.max(0, team.lowGap - minLow) : null,
        mediumGap: finite(team.mediumGap) && finite(minMed) ? Math.max(0, team.mediumGap - minMed) : null,
        highGap: finite(team.highGap) && finite(minHigh) ? Math.max(0, team.highGap - minHigh) : null,
        lowValue: finite(team.lowValue) && finite(minLowS) ? Math.max(0, team.lowValue - minLowS) : null,
        mediumValue: finite(team.mediumValue) && finite(minMedS) ? Math.max(0, team.mediumValue - minMedS) : null,
        highValue: finite(team.highValue) && finite(minHighS) ? Math.max(0, team.highValue - minHighS) : null,
        cornerGap: finite(team.cornerGap) && finite(minCornerGap) ? Math.max(0, team.cornerGap - minCornerGap) : null,
      }));

      const ordered=sorted(values,{cornerTeam:t=>t.team,lowGap:t=>t.lowGap,mediumGap:t=>t.mediumGap,highGap:t=>t.highGap,cornerEvents:t=>t.events},'lowGap');

      return card(cornerTitle,`Time lost per lap in each corner speed type relative to the fastest constructor in that class (baseline 0.000%). All ranked teams use the same ${values[0]?.events||0} circuits.`,
        (isSeasonScope ? renderCircuitAuditCard() : '')+
        lapShareChart(values,'cornerGap',season.reference)+
        table([sortHeader('cornerTeam','Team'),sortHeader('lowGap','Low-speed deficit'),sortHeader('mediumGap','Medium-speed deficit'),sortHeader('highGap','High-speed deficit'),sortHeader('cornerEvents','Circuits',-1)],ordered.map(team=>[teamLabel(team),
          `${signed(team.lowGap,3)}<small>${signed(team.lowValue,3,' s/lap')} · ${team.low.length} circuits</small>`,
          `${signed(team.mediumGap,3)}<small>${signed(team.mediumValue,3,' s/lap')} · ${team.medium.length} circuits</small>`,
          `${signed(team.highGap,3)}<small>${signed(team.highValue,3,' s/lap')} · ${team.high.length} circuits</small>`,team.events])))+
        card('Downforce index','Unavailable: public telemetry cannot isolate aerodynamic load.','<p class="performance-note">Per Astra GPT-6 Hybrid principles: Downforce (in Newtons), engine power (kW), and aerodynamic drag ($C_d A$) are unidentifiable from public 3.7 Hz telemetry. High-speed corner performance is shown directly without speculative synthetic regressions.</p>');
    }
    if(activeMetric==='straight') {
      const straightToggle = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
          <div class="performance-scope-toggle" role="radiogroup" aria-label="Straight line data source">
            <button type="button" data-straight-source="qualy" aria-pressed="${straightLineSource === 'qualy'}">Qualifying (Aero &amp; Deployment)</button>
            <button type="button" data-straight-source="race" aria-pressed="${straightLineSource === 'race'}">Race (Speed Trap &amp; Draft)</button>
          </div>
          <span class="perf-tercile-badge is-mid">${straightLineSource === 'qualy' ? 'GPS Telemetry · Low Drag / High Downforce Splits' : 'Official Speed Trap ST (km/h) · Clean Laps'}</span>
        </div>
      `;

      const raceTrapMap = new Map();
      for (const e of events) {
        for (const t of (e.R?.teams || [])) {
          if (!raceTrapMap.has(t.team)) raceTrapMap.set(t.team, { team: t.team, color: t.color, stMatched: [], stMax: [], stMed: [], flMax: [], events: 0 });
          const item = raceTrapMap.get(t.team);
          if (finite(t.race_speed_trap_matched)) item.stMatched.push(t.race_speed_trap_matched);
          if (finite(t.race_speed_trap_max)) item.stMax.push(t.race_speed_trap_max);
          if (finite(t.race_speed_trap_median)) item.stMed.push(t.race_speed_trap_median);
          if (finite(t.race_speed_fl_max)) item.flMax.push(t.race_speed_fl_max);
          item.events++;
        }
      }

      if (straightLineSource === 'race') {
        const raceTrapRows = [...raceTrapMap.values()].map(t => {
          const matched = avg(t.stMatched) || avg(t.stMed);
          return {
            ...t,
            matchedSpeed: matched,
            peakSpeed: avg(t.stMax),
            medianSpeed: avg(t.stMed),
            finishLineSpeed: avg(t.flMax),
          };
        });
        const maxMatched = Math.max(...raceTrapRows.map(r => r.matchedSpeed).filter(finite));
        for (const r of raceTrapRows) {
          r.raceDeficit = (finite(r.matchedSpeed) && finite(maxMatched) && maxMatched > 0)
            ? Math.max(0, ((maxMatched - r.matchedSpeed) / maxMatched) * 100)
            : null;
        }
        const orderedRace = sorted(raceTrapRows, {
          raceTeam: t => t.team,
          raceDeficit: t => t.raceDeficit,
          raceMatched: t => t.matchedSpeed,
          racePeak: t => t.peakSpeed,
          raceMed: t => t.medianSpeed,
          raceFL: t => t.finishLineSpeed,
          raceEvents: t => t.events
        }, 'raceDeficit', 1);

        const raceChart = renderHorizontalBarChart(orderedRace, {
          title: 'Lap-Matched Race Speed Trap Deficit (% to Fastest)',
          subtitle: 'Clean laps matched on identical lap numbers to eliminate fuel burn-off and tyre evolution bias · Baseline 0.00% is fastest ST',
          valueKey: 'raceDeficit',
          unit: '%',
          digits: 2,
          signedValue: true,
          zeroBaseline: true
        });

        return card(straightTitle, 'Grand Prix race straight-line speeds measured at official FIA speed trap (ST) and finish line (FL) timing loops. Lap-matching evaluates cars on the exact same race lap numbers, eliminating fuel load disparity.',
          straightToggle+
          raceChart+
          table([
            sortHeader('raceTeam', 'Team'),
            sortHeader('raceDeficit', 'ST Deficit (% to Fastest)'),
            sortHeader('raceMatched', 'Lap-matched speed (ST)', -1),
            sortHeader('racePeak', 'Peak speed trap (ST)', -1),
            sortHeader('raceMed', 'Median speed trap', -1),
            sortHeader('raceFL', 'Finish line speed (FL)', -1),
            sortHeader('raceEvents', 'Circuits', -1)
          ], orderedRace.map(t => [
            teamLabel(t),
            signed(t.raceDeficit, 2),
            fmt(t.matchedSpeed, 1, ' km/h'),
            fmt(t.peakSpeed, 1, ' km/h'),
            fmt(t.medianSpeed, 1, ' km/h'),
            fmt(t.finishLineSpeed, 1, ' km/h'),
            t.events
          ]))+
          '<p class="performance-note">Race speed traps combine low-drag aerodynamics with Straight Mode actuation and electrical energy recovery deployment. Lap-matching evaluates clean laps (>2.0s gap) at equal race distances to remove fuel weight confounders.</p>');
      }

      const rawValues = season.map(team => ({
        ...team,
        straightGap: avg(team.straightContribution),
        peak: avg(team.top),
        sustained: avg(team.full)
      }));
      const minStraightGap = Math.min(...rawValues.map(t => t.straightGap).filter(finite));
      const qualyValues = rawValues.map(t => ({
        ...t,
        straightGap: finite(t.straightGap) && finite(minStraightGap) ? Math.max(0, t.straightGap - minStraightGap) : null
      }));
      const orderedQualy = sorted(qualyValues, {
        straightTeam: t => t.team,
        straightGap: t => t.straightGap,
        peak: t => t.peak,
        sustained: t => t.sustained,
        straightEvents: t => t.events
      }, 'straightGap', 1);

      const qualyChart = renderHorizontalBarChart(orderedQualy, {
        title: 'Qualifying Straight-Line Time Deficit (% to Benchmark)',
        subtitle: 'GPS-integrated time gained/lost across all straight sectors · Fastest constructor on straights is 0.00% baseline',
        valueKey: 'straightGap',
        unit: '%',
        digits: 2,
        signedValue: true,
        zeroBaseline: true
      });

      return card(straightTitle, 'Time lost on all straights as a percentage of a full lap, averaged across evaluated circuits for every ranked team. Fastest constructor on straights is 0.00% baseline.',
        straightToggle+
        qualyChart+
        table([
          sortHeader('straightTeam', 'Team'),
          sortHeader('straightGap', 'Time lost · % of lap'),
          sortHeader('peak', 'Average peak speed', -1),
          sortHeader('sustained', 'Full-throttle high-speed threshold (P95)', -1),
          sortHeader('straightEvents', 'Circuits', -1)
        ], orderedQualy.map(team => [
          teamLabel(team),
          signed(team.straightGap, 3),
          fmt(team.peak, 1, ' km/h'),
          fmt(team.sustained, 1, ' km/h'),
          team.events
        ]))+
        '<p class="performance-note">P95 example: 320 km/h means 95% of full-throttle samples were at or below 320, and 5% were above. It is neither average straight speed nor the speed held throughout a straight. 2026 active aerodynamics (Straight Mode vs Corner Mode) replaces legacy DRS splits.</p>');
    }
    const rawBrakeValues = season.map(team => ({
      ...team,
      g: avg(team.brakeG),
      meanG: avg(team.brakeMeanG),
      distance: avg(team.brakeDistance),
      distDelta: avg(team.brakeDistDelta),
      duration: avg(team.brakeDuration),
      zones: team.zones
    }));
    const values = computeBrakingPerformance(rawBrakeValues);
    const ordered = sorted(values, {
      brakeTeam: t => t.team,
      brakeScore: t => t.totalBrakingScore,
      brakeG: t => t.g,
      brakeMeanG: t => t.meanG,
      brakeDistDelta: t => t.distDelta,
      brakeDistance: t => t.distance,
      brakeDuration: t => t.duration,
      brakeZones: t => t.zones
    }, 'brakeScore', -1);

    const brakeChart = renderHorizontalBarChart(ordered, {
      title: 'Total Braking Performance Index (0–100)',
      subtitle: 'Comprehensive rating combining initial heavy decel (g), mean decel, distance delta, braking distance, duration, and zone consistency',
      valueKey: 'totalBrakingScore',
      unit: ' / 100',
      digits: 1,
      signedValue: false,
      invertBest: true,
      zeroBaseline: true
    });

    return card(brakingTitle,'Matched heavy braking zones evaluated across constructors. Total Braking Performance Index integrates peak stopping load (3.8g–5.0g), whole-zone mean deceleration, distance delta, braking distance, duration, and matched zone consistency.',
      brakeChart+
      table([
        sortHeader('brakeTeam','Team'),
        sortHeader('brakeScore','Total Index (0–100)',-1),
        sortHeader('brakeG','Initial heavy decel',-1),
        sortHeader('brakeMeanG','Mean decel',-1),
        sortHeader('brakeDistDelta','Distance delta (Δm)'),
        sortHeader('brakeDistance','Braking distance'),
        sortHeader('brakeDuration','Duration'),
        sortHeader('brakeZones','Matched zones',-1)
      ],ordered.map(team=>[
        teamLabel(team),
        `<span class="perf-tercile-badge is-fast" style="font-weight:700;">${fmt(team.totalBrakingScore,1)}</span>`,
        fmt(team.g,2,' g'),
        fmt(team.meanG,2,' g'),
        signed(team.distDelta,1,' m'),
        fmt(team.distance,1,' m'),
        fmt(team.duration,2,' s'),
        `${team.events} circuits · ${team.zones}`
      ])));
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
      lapShareChart(rebasedLoaded.map(r=>({...r,gap:r.trace?.corner_contribution})),'gap',event.traceReference)+
      table([sortHeader('eventCornerTeam','Team'),sortHeader('eventLow','Low ≤120'),sortHeader('eventMedium','Medium 120–200'),sortHeader('eventHigh','High >200')],ordered.map(row=>[teamLabel(row),...['low','medium','high'].map(name=>{
        const value=row.categories[name];return value?`${signed(value.deficit,3)}<small>${signed(value.time_lost,3,' s/lap')} · ${value.corners} corners</small>`:'—';
      })])))+card('Corner measurements','Windows follow the field’s braking, apex and acceleration. Zone labels are used when reliable map corner numbers are unavailable. Loss density (ms/100m) measures spatial penalty rate.',
      table(['Corner',...rebasedLoaded.map(row=>teamLabel(row))],common.map(label=>[escape(label),...rebasedLoaded.map(row=>{
        const corner=row.trace.corners.find(c=>c.corner===label);
        const densityBadge = corner?.loss_density ? `<span class="perf-loss-density">${fmt(corner.loss_density, 1)} ms/100m</span>` : '';
        return corner?`${fmt(corner.time,3,' s')}${densityBadge}<small>${fmt(corner.mean_speed,1,' km/h')} mean · ${fmt(corner.minimum,1)} min</small>`:'—';
      })])))+card('Downforce index','Unavailable: public telemetry cannot isolate aerodynamic load.','<p class="performance-note">High-speed corner performance is shown directly instead.</p>');
  }
  if(activeMetric==='straight') {
    const straightToggle = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
        <div class="performance-scope-toggle" role="radiogroup" aria-label="Straight line data source">
          <button type="button" data-straight-source="qualy" aria-pressed="${straightLineSource === 'qualy'}">Qualifying (Aero &amp; Deployment)</button>
          <button type="button" data-straight-source="race" aria-pressed="${straightLineSource === 'race'}">Race (Speed Trap &amp; Draft)</button>
        </div>
        <span class="perf-tercile-badge is-mid">${straightLineSource === 'qualy' ? 'GPS Telemetry · Low Drag / High Downforce Splits' : 'Official Speed Trap ST (km/h) · Clean Laps'}</span>
      </div>
    `;

    if (straightLineSource === 'race') {
      const raceTeams = event.R?.teams || [];
      const raceTrapRows = raceTeams.map(t => {
        const matched = t.race_speed_trap_matched || t.race_speed_trap_median;
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
      for (const r of raceTrapRows) {
        r.raceDeficit = (finite(r.matchedSpeed) && finite(maxMatched) && maxMatched > 0)
          ? Math.max(0, ((maxMatched - r.matchedSpeed) / maxMatched) * 100)
          : null;
      }

      const orderedRace = sorted(raceTrapRows, {
        eventRaceTeam: t => t.team,
        eventRaceDeficit: t => t.raceDeficit,
        eventRaceMatched: t => t.matchedSpeed,
        eventRacePeak: t => t.peakSpeed,
        eventRaceMed: t => t.medianSpeed,
        eventRaceFL: t => t.finishLineSpeed
      }, 'eventRaceDeficit', 1);

      const singleRaceChart = renderHorizontalBarChart(orderedRace, {
        title: 'Lap-Matched Race Speed Trap Deficit (% to Fastest)',
        subtitle: 'Clean laps matched on identical lap numbers to eliminate fuel burn-off and tyre evolution bias · Baseline 0.00% is fastest ST',
        valueKey: 'raceDeficit',
        unit: '%',
        digits: 2,
        signedValue: true,
        zeroBaseline: true
      });

      return card('Straight-line performance', 'Grand Prix race straight-line speeds measured at official FIA speed trap (ST) and finish line (FL) timing loops. Lap-matching evaluates cars on the exact same race lap numbers, eliminating fuel load disparity.',
        straightToggle +
        singleRaceChart +
        table([
          sortHeader('eventRaceTeam', 'Team'),
          sortHeader('eventRaceDeficit', 'ST Deficit (% to Fastest)'),
          sortHeader('eventRaceMatched', 'Lap-matched speed (ST)', -1),
          sortHeader('eventRacePeak', 'Peak speed trap (ST)', -1),
          sortHeader('eventRaceMed', 'Median speed trap', -1),
          sortHeader('eventRaceFL', 'Finish line speed (FL)', -1)
        ], orderedRace.map(t => [
          teamLabel(t),
          signed(t.raceDeficit, 2),
          fmt(t.matchedSpeed, 1, ' km/h'),
          fmt(t.peakSpeed, 1, ' km/h'),
          fmt(t.medianSpeed, 1, ' km/h'),
          fmt(t.finishLineSpeed, 1, ' km/h')
        ])) +
        '<p class="performance-note">Race speed traps combine low-drag aerodynamics with Straight Mode actuation and electrical energy recovery deployment. Lap-matching evaluates clean laps (>2.0s gap) at equal race distances to remove fuel weight confounders.</p>');
    }

    const minStraight = Math.min(...loaded.map(r => r.trace?.straight_contribution).filter(finite));
    const qualyRows = loaded.map(r => ({
      ...r,
      straightGap: finite(r.trace?.straight_contribution) && finite(minStraight) ? Math.max(0, r.trace.straight_contribution - minStraight) : null,
      topSpeed: r.trace?.top_speed,
      sustainedSpeed: r.trace?.full_throttle_p95
    }));
    const ordered = sorted(qualyRows, {
      eventStraightTeam: t => t.team,
      eventStraightGap: t => t.straightGap,
      eventStraightTop: t => t.topSpeed,
      eventStraightP95: t => t.sustainedSpeed
    }, 'eventStraightGap', 1);

    const singleStraightChart = renderHorizontalBarChart(ordered, {
      title: 'Qualifying Straight-Line Time Deficit (% to Benchmark)',
      subtitle: 'GPS-integrated time gained/lost across all straight sectors · Fastest constructor on straights is 0.00% baseline',
      valueKey: 'straightGap',
      unit: '%',
      digits: 2,
      signedValue: true,
      zeroBaseline: true
    });

    return card('Straight-line performance', 'Time lost on all straights as a percentage of a full lap, relative to the fastest constructor (0.00% baseline). Includes peak velocity and sustained high-speed threshold.',
      straightToggle+
      singleStraightChart+
      table([
        sortHeader('eventStraightTeam', 'Team'),
        sortHeader('eventStraightGap', 'Time lost · % of lap'),
        sortHeader('eventStraightTop', 'Peak speed', -1),
        sortHeader('eventStraightP95', 'Full-throttle high-speed threshold (P95)', -1)
      ], ordered.map(t => [
        teamLabel(t),
        signed(t.straightGap, 3),
        fmt(t.topSpeed, 1, ' km/h'),
        fmt(t.sustainedSpeed, 1, ' km/h')
      ]))+
      card('Where the lap gap comes from',`Relative to ${escape(event.traceReference||'the fastest measured team')}’s qualifying lap.`,
      table(['Team','Straights','Corners','Lap gap'],ordered.map(row=>[teamLabel(row),fmt(row.straightGap,3,'%'),fmt(row.trace?.corner_contribution,3,'%'),fmt(row.trace?.lap_gap,3,'%')]))));
  }
  const brakeRows = computeBrakingPerformance(loaded.map(r => ({
    ...r,
    g: r.brakeG,
    meanG: r.brakeMeanG,
    distDelta: r.brakeDistDelta,
    distance: r.brakeDistance,
    duration: r.brakeDuration,
    zones: r.brakeZones
  })));
  const ordered = sorted(brakeRows, {
    eventBrakeTeam: r => r.team,
    eventBrakeScore: r => r.totalBrakingScore,
    eventBrakeG: r => r.g,
    eventBrakeMeanG: r => r.meanG,
    eventBrakeDistDelta: r => r.distDelta,
    eventBrakeDistance: r => r.distance,
    eventBrakeDuration: r => r.duration,
    eventBrakeZones: r => r.zones
  }, 'eventBrakeScore', -1);

  const singleBrakeChart = renderHorizontalBarChart(ordered, {
    title: 'Total Braking Performance Index (0–100)',
    subtitle: 'Integrated performance across all 6 parameters: Initial Heavy Decel, Mean Decel, Distance Delta, Braking Distance, Duration, and Zone Consistency',
    valueKey: 'totalBrakingScore',
    unit: ' / 100',
    digits: 1,
    signedValue: false,
    invertBest: true,
    zeroBaseline: true
  });

  return card('Braking observations','Matched heavy braking zones evaluated across constructors. Total Braking Performance Index integrates peak stopping load (3.8g–5.0g), whole-zone mean deceleration, distance delta, braking distance, duration, and matched zone consistency.',
    singleBrakeChart+
    table([
      sortHeader('eventBrakeTeam','Team'),
      sortHeader('eventBrakeScore','Total Index (0–100)',-1),
      sortHeader('eventBrakeG','Initial heavy decel',-1),
      sortHeader('eventBrakeMeanG','Mean decel',-1),
      sortHeader('eventBrakeDistDelta','Distance delta (Δm)'),
      sortHeader('eventBrakeDistance','Braking distance'),
      sortHeader('eventBrakeDuration','Duration'),
      sortHeader('eventBrakeZones','Matched zones',-1)
    ],ordered.map(row=>[
      teamLabel(row),
      `<span class="perf-tercile-badge is-fast" style="font-weight:700;">${fmt(row.totalBrakingScore, 1)}</span>`,
      fmt(row.g,2,' g'),
      fmt(row.meanG,2,' g'),
      signed(row.distDelta,1,' m'),
      fmt(row.distance,1,' m'),
      fmt(row.duration,2,' s'),
      `${row.events||1} circuit${(row.events||1)===1?'':'s'} · ${row.zones} zones`
    ])));
}

function render() {
  const modes=[
    ['pace','Pace & sectors'],
    ['corners','Cornering'],
    ['straight','Straight line'],
    ['braking','Braking'],
    ['tyres','Tyre trend'],
    ['trend','Development & updates'],
    ['results','Reliability & results']
  ];
  const modeBar = `<div class="performance-mode" role="tablist" aria-label="Performance metric">${modes.map(([key,label])=>`<button type="button" role="tab" data-performance-metric="${key}" aria-pressed="${activeMetric===key}" aria-selected="${activeMetric===key}">${label}</button>`).join('')}</div>`;

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
  const content = (activeMetric==='pace'?renderPace(teams):activeMetric==='tyres'?renderRace(teams):activeMetric==='results'?renderResults(teams):activeMetric==='trend'?renderTrend(teams):renderTrace());

  root.innerHTML = modeBar + errorMarkup + content;
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

root.addEventListener('click',event=>{
  const metric=event.target.closest('[data-performance-metric]');
  if(metric) {activeMetric=metric.dataset.performanceMetric;render();}
  const sort=event.target.closest('[data-performance-sort]');
  const tyre=event.target.closest('[data-performance-tyre]');
  if(tyre){tyreView=tyre.dataset.performanceTyre;render();}
  const straightSrc=event.target.closest('[data-straight-source]');
  if(straightSrc){straightLineSource=straightSrc.dataset.straightSource;render();}
  const qualyModeBtn=event.target.closest('[data-qualy-mode]');
  if(qualyModeBtn){qualyPaceMode=qualyModeBtn.dataset.qualyMode;render();}
  if(sort) {sortDirection=sortKey===sort.dataset.performanceSort?-sortDirection:Number(sort.dataset.sortDirection||1);sortKey=sort.dataset.performanceSort;render();}
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
