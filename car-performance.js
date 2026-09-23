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
const round = (val, digits = 2) => finite(val) ? Number(val.toFixed(digits)) : null;

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
  const scores=validTeams.map(t=>t.score).filter(finite);
  const baseline=scores.length?Math.min(...scores):null;
  return validTeams.map(t=>({
    ...t,
    score:finite(t.score)&&finite(baseline)?Math.max(0,t.score-baseline):null,
    timeLossSeconds:finite(t.score)&&finite(baseline)&&finite(t.referenceLap)
      ? Math.max(0,t.score-baseline)*t.referenceLap/100:null,
    g:finite(t.g)?t.g:null,
    meanG:finite(t.meanG)?t.meanG:null,
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
  invertBest = false // if true, higher value is ranked first
} = {}) {
  const validRows = (rows || []).filter(r => r && finite(r[valueKey])).map(r => ({ ...r }));
  if (!validRows.length) return '';

  let minVal = Math.min(...validRows.map(r => r[valueKey]));
  let maxVal = Math.max(...validRows.map(r => r[valueKey]));

  // For gap/deficit metrics (signedValue = true), rebase so the best car is 0.000% baseline (no negative numbers)
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
let showPerformanceDescriptions=false;
const STRAIGHT_BANDS=['50_100','100_150','150_200','200_250','250_300','300_350','350_400'];
let straightBand='250_300';
function straightBandControls(available) {
  if(!available.includes(straightBand)) straightBand=available.includes('250_300')?'250_300':available[0]||'250_300';
  return `<div class="performance-band-options" role="group" aria-label="Acceleration speed range">${STRAIGHT_BANDS.map(key=>`<button type="button" data-straight-band="${key}" aria-pressed="${key===straightBand}" ${available.includes(key)?'':'disabled title="Fewer than three teams reached this range in comparable full-throttle traces"'}>${key.replace('_','–')} <span>km/h</span></button>`).join('')}</div><p class="performance-band-hint">Dim ranges have fewer than three comparable teams.</p>`;
}
let qualyPaceMode='overall'; // 'overall' | 'q1' | 'adjusted'
let sectorPaceMode='completed'; // 'completed' | 'ideal'
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
        speed_st:lap.speed_st,speed_fl:lap.speed_fl
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
    // Only compute deltas when dry, >= 6 common drivers, deltas in [-0.2, 1.5] s, and MAD <= 0.35 s
    const q1_d = new Map();
    const q2_d = new Map();
    const q3_d = new Map();
    const q1_tm = new Map();
    const q2_tm = new Map();
    const q3_tm = new Map();
    const isDryComp = c => !c || !['INTERMEDIATE', 'WET'].includes(String(c).toUpperCase());

    for (const t of qTeams) {
      for (const p of (t.phase_details || [])) {
        if (!finite(p.time)) continue;
        const dry = isDryComp(p.compound);
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
          positions:[],samples:0,coverage:[],stints:[],results:0,
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
    sensitivityBracket:t.sensitivityBrackets.at(-1) || null,
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

  const sectorToggle = `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:14px;">
      <div class="performance-scope-toggle" role="radiogroup" aria-label="Sector comparison mode">
        <button type="button" data-sector-mode="completed" aria-pressed="${sectorPaceMode === 'completed'}">Completed Lap Sectors</button>
        <button type="button" data-sector-mode="ideal" aria-pressed="${sectorPaceMode === 'ideal'}">Ideal Sector Sum</button>
      </div>
      <span class="perf-tercile-badge is-mid">${
        sectorPaceMode === 'completed'
          ? 'Sectors from Official Classified Fast Lap'
          : 'Compound-Matched Best S1+S2+S3 Sum'
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

  const sectorField1 = sectorPaceMode === 'ideal' ? 'idealS1' : 's1';
  const sectorField2 = sectorPaceMode === 'ideal' ? 'idealS2' : 's2';
  const sectorField3 = sectorPaceMode === 'ideal' ? 'idealS3' : 's3';
  const sectors = sorted(teams, {
    team: t => t.team,
    s1: t => t[sectorField1],
    s2: t => t[sectorField2],
    s3: t => t[sectorField3]
  }, 's1');

  const chartMeta = qualyPaceMode === 'overall' ? {
    title: 'Qualifying Pace Deficit · Overall Best Lap (% to Pole)',
    subtitle: 'Fastest official lap across Q1–Q3 · Observed qualifying result · Baseline 0.000% is pole lap',
    note: 'Qualifying uses each constructor’s single fastest valid lap across Q1, Q2, and Q3 from either driver. The fastest team is 0.000% baseline.'
  } : {
    title: 'Qualifying Pace Deficit · Track-Evolution Adjusted (% to Q3 Baseline)',
    subtitle: 'Estimated Q1/Q2 track evolution from advancing drivers · Modelled comparison',
    note: 'Estimates the shared improvement between qualifying phases from advancing drivers. Tyres, driver execution and changing conditions can also contribute; this is a diagnostic rather than an official lap result.'
  };

  const qualyChart = renderHorizontalBarChart(ordered, {
    title: chartMeta.title,
    subtitle: chartMeta.subtitle,
    valueKey: paceKey,
    unit: '%',
    digits: 3
  });

  const raceChart = renderHorizontalBarChart(teams.filter(t => finite(t.race)), {
    title: 'Estimated Race Pace Deficit (% to Benchmark)',
    subtitle: 'Shared race-lap, compound and tyre-age model · Timing checkpoints screen for traffic · Lower is faster',
    valueKey: 'race',
    unit: '%',
    digits: 3
  });

  const qualyColLabel = qualyPaceMode === 'overall'
    ? 'Qualifying · Best lap'
    : 'Evolution-adjusted deficit';

  return regulatoryBadge +
    card('Qualifying pace deficit',
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
        `${fmt(t[paceKey], 3, '%')} <span style="font-size:0.8em;color:var(--text-secondary);">(+${fmt(t.paceDeltaS || 0, 3, ' s')})</span><small>${t.qCount === 1 && t.q[0]?.lap ? `${escape(t.q[0].lap.driver)} · ${fmt(t.q[0].lap.time, 3, ' s')}` : `${t.qCount} event${t.qCount === 1 ? '' : 's'}`}${finite(t.idealGapS) ? ` · Ideal Gap: +${fmt(t.idealGapS, 3, ' s')} (${escape(t.idealCompound || 'SOFT')})` : ''}</small>`,
        `${fmt(t.race, 3, '%')}${t.sampleTier === 'insufficient' || t.provisional ? ' <span class="perf-tercile-badge is-mid" style="font-size:0.65rem;">Limited sample</span>' : ''}<small>${t.fastestRaceDrivers?.length ? `Fastest: ${escape([...new Set(t.fastestRaceDrivers)].join(', '))} · ` : ''}${t.rCount} event${t.rCount === 1 ? '' : 's'}${t.sensitivityBracket ? ` · Bracket [${fmt(t.sensitivityBracket[0], 3, '%')}, ${fmt(t.sensitivityBracket[1], 3, '%')}]` : ''}</small>`,
        t.samples
      ]))) +
    card('Race pace deficit overview',
      'Estimated race pace uses one 2.0s timing-checkpoint traffic screen and a shared race-lap, compound and tyre-age model. Checkpoints cannot prove continuous clean air; other thresholds are sensitivity checks, not alternate headline baselines.',
      raceChart) +
    card(sectorPaceMode === 'ideal' ? 'Sector deficits · Ideal Sector Sum' : 'Sector deficits · Completed Fast Lap',
      sectorPaceMode === 'ideal'
        ? 'Compound-matched sum of best observed sectors for the selected driver within the same qualifying segment. This is a theoretical diagnostic, not a completed lap or a correction for driver execution.'
        : 'Sectors from each team’s single fastest qualifying lap, compared with the best corresponding sector among those selected laps. Events receive equal weight.',
      sectorToggle +
      table([sortHeader('team', 'Team'), sortHeader('s1', 'Sector 1'), sortHeader('s2', 'Sector 2'), sortHeader('s3', 'Sector 3')], sectors.map(t => [teamLabel(t), ...[sectorField1, sectorField2, sectorField3].map(s => fmt(t[s], 3, '%'))]))) +
    `<details class="dashboard-card performance-methods"><summary>Why this pace ranking? View selected laps and race drivers</summary><p class="performance-note">Only the fastest valid lap across the whole qualifying session counts for each team.</p>${table(['Team', 'Event', 'Phase', 'Driver', 'Selected lap (s)'], teams.flatMap(t => t.q.filter(q => q.lap).map(q => [teamLabel(t), eventLabel(q.event), escape(q.lap.phase), escape(q.lap.driver), fmt(q.lap.time, 3)]))) }<p class="performance-note">Race pace models race lap, compound and tyre age, with timing checkpoints as a traffic proxy. Typical model error is the median absolute residual on eligible laps, not a confidence interval. Driver choices and race management remain in the estimate.</p>${table(['Team', 'Event', 'Driver', 'Estimate', 'Eligible laps', 'Typical model error'], teams.flatMap(t => t.raceDrivers.map(r => [teamLabel(t), eventLabel(r.event), `${escape(r.driver)}${r.selected ? ' · selected' : ''}`, fmt(r.pace, 3, '%'), r.samples, fmt(r.residual_spread, 3, '%')]))) }</details>`;
}

function renderRace(teams) {
  const rows=[];
  const compoundOrder=['HYPERSOFT','ULTRASOFT','SUPERSOFT','SOFT','MEDIUM','HARD','SUPERHARD'];
  const choices=['OVERALL','SOFT','MEDIUM','HARD',...compoundOrder.filter(c=>!['SOFT','MEDIUM','HARD'].includes(c)&&teams.some(t=>t.stints.some(s=>s.compound===c)))];
  if(!choices.includes(tyreView)) tyreView='OVERALL';
  const controls=`<div class="performance-tyre-options" role="group" aria-label="Tyre compound">${choices.map(c=>`<button type="button" data-performance-tyre="${c}" aria-pressed="${tyreView===c}">${['SOFT','MEDIUM','HARD'].includes(c)?`<img src="assets/tyres/official/${c.toLowerCase()}.png" alt="" width="20" height="20">`:''}<span class="tyre-opt-label">${c==='OVERALL'?'Overall · S/M/H':c.charAt(0)+c.slice(1).toLowerCase()}</span></button>`).join('')}</div>`;

  for(const team of teams) {
    // Used-start tyres are retained only when their race-phase/age-matched
    // comparison passes the same support checks, and are flagged in the table.
    const validStints = (team.stints || []).filter(s => finite(s.relativeSlope) && !s.lowSample && !s.low_sample && s.matchedLaps >= 8 && s.fieldSupport >= 2);
    const usedStartCount = validStints.filter(s => s.usedStart || s.used_start).length;

    // Group valid stints by event and compound for hierarchical aggregation
    // Hierarchy: Driver-level aggregation with capped weight min(samples, 20)
    // -> team compound estimate within event
    // -> robust median of supported compounds for event score
    // -> equal event weighting (median of event scores) across season
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
          slope: rawEvValues.length ? median(rawEvValues) : null,
          normSlope: normEvValues.length ? median(normEvValues) : null,
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
      ? ['SOFT', 'MEDIUM', 'HARD'].map(c => summaries[c]).filter(Boolean)
      : [summaries[tyreView]].filter(Boolean);

    if(tyreView === 'OVERALL') {
       // Average the compound season estimates equally; event weighting is
       // already applied within each compound summary above.
       const compoundRaw = present.map(c => c.slope).filter(finite);
       const compoundNorm = present.map(c => c.normSlope).filter(finite);
       seasonSlope = compoundRaw.length >= 2 ? avg(compoundRaw) : null;
       seasonNormSlope = compoundNorm.length >= 2 ? avg(compoundNorm) : null;
       complete = present.length >= 2 && (!context?.season || new Set(present.flatMap(c=>c.events)).size >= 3);
    } else {
      seasonSlope = summaries[tyreView]?.slope ?? null;
      seasonNormSlope = summaries[tyreView]?.normSlope ?? null;
       complete = Boolean(summaries[tyreView]) && (!context?.season || summaries[tyreView].events.length >= 3);
    }

    const compNote = tyreView === 'OVERALL' && present.length < 3 ? `(${present.length}/3 compounds)` : '';
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
      fieldSupported: present.length > 0 && present.every(c => c.fieldSupported),
      complete,
      compNote,
      compoundBreakdown,
      totalDryLaps
    });
  }

  const ordered = sorted(rows, {
    tyreTeam: r => r.team,
    tyreNorm: r => r.normSlope,
    tyreSlope: r => r.slope,
    tyreEvents: r => r.events,
    tyreStints: r => r.stints,
    tyreLaps: r => r.laps
  }, 'tyreNorm');

  // SVG Horizontal Bar Graph for Field-Relative Tyre Degradation
  const tyreChart = renderHorizontalBarChart(ordered.filter(r => r.complete && finite(r.normSlope)), {
     title: `Relative tyre-age trend · ${tyreView === 'OVERALL' ? 'Available compounds' : tyreView}`,
     subtitle: 'Bar is rebased to the best supported team (s/lap of tyre age); table shows the raw rival comparison · Season rank needs ≥3 events',
    valueKey: 'normSlope',
    unit: ' s/lap',
    digits: 3,
    signedValue: true,
    zeroBaseline: true
  });

   return card('Tyre-age lap-time trend',
     'This compares how quickly each team’s lap times changed as tyres aged versus rival stints in the same race phase on the same compound. A larger number does not prove worse tyre wear: traffic, tyre history, driver management and track conditions remain. Teams need at least three supported race weekends for a season bar; unsupported cases stay unranked. Used-start tyres are included only when matched and flagged.',
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
      const sampleText = `${r.stints} stint${r.stints === 1 ? '' : 's'} (${r.laps} laps)`;
       const supportBadge = r.fieldSupported ? '<span class="perf-tercile-badge is-fast">≥2 overlapping rivals</span>' : '<span class="perf-tercile-badge is-mid">No matched cohort</span>';
      const normText = finite(r.normSlope)
        ? `${r.normSlope > 0 ? '+' : ''}${fmt(r.normSlope, 3, ' s/lap')}${!r.complete?'<small>Insufficient season coverage for ranking</small>':''}`
        : '<small>Field benchmark pending</small>';
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
  const ordered=sorted(teams,{
    resultTeam:t=>t.team,
    points:t=>t.points,
    finish:t=>avg(t.positions),
    finishRate:t=>t.starts?t.finishes/t.starts:null,
    pu:t=>t.puRetirements,
    chassis:t=>t.chassisRetirements,
    incidents:t=>t.incidentRetirements,
    other:t=>t.otherRetirements + t.unknownRetirements
  },'points',-1);

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
     'Official race classifications only; sprints excluded. Points and finishing position describe results conversion, not a car-performance score. Retirement categories are provisional when timing status is generic; unlinked event notes are not independently verified.',
    pointsChart+
    table([
      sortHeader('resultTeam','Team'),
      sortHeader('points','Points',-1),
      sortHeader('finish','Avg. finish'),
      sortHeader('finishRate','Finished / starts',-1),
      sortHeader('pu','PU-related'),
      sortHeader('chassis','Chassis / team'),
      sortHeader('incidents','Incidents'),
      sortHeader('other','Other / unverified')
    ],ordered.map(t=>[
      teamLabel(t),
      t.results&&t.pointsKnown?t.points:'—',
      fmt(avg(t.positions),1),
      `${t.finishes} / ${t.starts}`,
      t.puRetirements > 0 ? `<span class="retirement-badge is-pu">⚙ ${t.puRetirements}</span>` : '0',
      t.chassisRetirements > 0 ? `<span class="retirement-badge is-chassis">🔧 ${t.chassisRetirements}</span>` : '0',
      t.incidentRetirements > 0 ? `<span class="retirement-badge is-incident">💥 ${t.incidentRetirements}</span>` : '0',
      (t.otherRetirements + t.unknownRetirements) > 0 ? `<span class="retirement-badge is-other">${t.otherRetirements + t.unknownRetirements}</span>` : '0'
    ])))+
     card('Retirement classifications',
       'Timing status is the primary source. Additional 2026 event notes are marked unlinked and should not be treated as verified official causes. DSQ and medical withdrawals are excluded from mechanical failure rates.',
      table([
        'Team',
        'Event',
        'Driver',
        'Category',
         'Reported status / provisional incident note',
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
    const valid = t.q.filter(q => finite(q.pace));
    let first = null, last = null, label = '';
    let slopePerRound = null;
    let modelledShift = null;
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
    }

    const change = (finite(first) && finite(last)) ? last - first : null;
    const sampleTier = n >= 15 ? 'Robust (≥15 events)' : n >= 10 ? 'Provisional (10–14 events)' : 'Raw (<10 events)';
    const sampleTierClass = n >= 15 ? 'is-fast' : n >= 10 ? 'is-mid' : 'is-slow';
    return { team: t, valid, first, last, change, modelledShift, slopePerRound, sampleTier, sampleTierClass, label, count: n };
  });

  const ordered = sorted(trendRows, {
    trendTeam: r => r.team.team,
    trendFirst: r => r.first,
    trendLast: r => r.last,
    trendChange: r => r.change,
    trendModelled: r => r.modelledShift,
    trendSlope: r => r.slopePerRound,
    trendCount: r => r.count
  }, 'trendChange');

   return card('Relative qualifying progress',
     'Ranked by the observed change in qualifying gap from the first three to the latest three events. More negative means the team closed the gap to the quickest car. This measures relative one-lap progress, not a proven upgrade effect; the fitted rate is a separate check.',
    '<div class="performance-trend-table">'+table([
      sortHeader('trendTeam', 'Team'),
      'Qualifying gap by round',
      sortHeader('trendLast', 'Opening → latest gap'),
      sortHeader('trendChange', 'Change in gap'),
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
        `<span class="perf-tercile-badge ${row.sampleTierClass}">${row.count} event${row.count===1?'':'s'} · ${escape(row.sampleTier.split(' ')[0])}</span>`
      ];
    })))+'</div>' + card('FIA updates',
      'Upgrade components submitted to the FIA before each event. Upgrade counts are not weighted by importance, and a before/after pace change cannot establish causation.',
      '<p><a href="https://www.fia.com/documents" target="_blank" rel="noopener" class="perf-link">Open FIA event documents ↗</a></p><p class="performance-note">Component counts from Car Presentation Submissions are not weighted by competitive impact, and public lap times cannot isolate aerodynamic package gains from setup or driver variation. No synthetic upgrade gains are inferred.</p>');
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

  for (const row of rows.values()) {
    const rowZones = row.trace?.braking || [];
    const rowLapDist = row.trace?.lap_distance || 5000;
    const distDeltas = [];
    const matchedZones = [];

    for (const rz of refZones) {
      const rPos = rz.start / refLapDist;
      const match = rowZones.find(z=>z.corner&&z.corner===rz.corner) || rowZones
        .map(z => ({ z, dist: Math.abs(z.start / rowLapDist - rPos) }))
        .filter(item => item.dist <= 0.012)
        .sort((a, b) => a.dist - b.dist)[0]?.z;
      if (match) {
        matchedZones.push(match);
        distDeltas.push(match.distance - rz.distance);
      }
    }

    const effectiveZones = matchedZones;
    row.brakeDistDelta = median(distDeltas);
    row.brakeDistance = median(effectiveZones.map(z => z.distance));
    row.brakeG = median(effectiveZones.map(z => z.early_g));
    row.brakeMeanG = median(effectiveZones.map(z => z.mean_g));
    row.brakeDuration = median(effectiveZones.map(z => z.duration));
    row.normalizedDecel = median(effectiveZones.map(z => z.normalized_decel_g));
    row.brakeTimeDelta = median(effectiveZones.map(z => z.corridor_time-z.corridor_ref_time));
    row.samplingResolution = median(effectiveZones.map(z => z.sampling_resolution_m));
    row.onsetBracket = effectiveZones.find(z => z.onset_bracket)?.onset_bracket || null;
    row.brakeZones = effectiveZones.length;
  }
  // Headline: actual observed time through identical qualifying braking
  // corridors, as a share of the full reference lap. Deceleration and braking
  // distance remain diagnostics; blending them into time created a unitless
  // index that users could not interpret as lap time.
  const eligible=[...rows.values()].filter(row=>(row.trace?.braking||[]).length>=3);
  const common=refZones.filter(z=>z.corner&&eligible.every(row=>(row.trace.braking||[]).some(b=>b.corner===z.corner)));
  if(eligible.length>=3&&common.length>=3) {
    const scores=new Map(eligible.map(row=>[row.team,[]]));
    for(const zone of common) {
      const measured=eligible.map(row=>({row,z:row.trace.braking.find(b=>b.corner===zone.corner)}));
      const timeBest=Math.min(...measured.map(x=>x.z.corridor_time).filter(v=>finite(v)&&v>0));
      if(!finite(timeBest)||timeBest<=0)continue;
      const lapTime=median(measured.map(x=>x.row.trace.reference_lap_time).filter(v=>finite(v)&&v>0));
      if(!finite(lapTime)||lapTime<=0)continue;
      for(const {row,z} of measured) {
        if(!finite(z.corridor_time)||z.corridor_time<=0)continue;
        const timeLoss=Math.max(0,z.corridor_time-timeBest)/lapTime*100;
        scores.get(row.team).push(timeLoss);
      }
    }
    for(const row of eligible) {
      const values=scores.get(row.team);
      if(values.length===common.length) {
        row.brakingScore=values.reduce((sum,value)=>sum+value,0);
        row.brakingReferenceLap=median(eligible.map(item=>item.trace.reference_lap_time).filter(v=>finite(v)&&v>0));
        row.brakingScoreZones=values.length;
        row.brakingScoreCohort=eligible.length;
      }
    }
  }
  return {rows,groups,entrants};
}

function seasonTelemetry() {
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
        straightContribution:[],cornerContribution:[],brakeG:[],brakeMeanG:[],brakingScore:[],brakingScoreZones:[],brakingReferenceLap:[],
        brakeDistance:[],brakeDistDelta:[],brakeDuration:[],
        normalizedDecel:[],brakeTimeDelta:[],samplingResolution:[],
        terminalZoneMeanSpeed:[],terminalZoneLength:[],
        accel250:[],accel250Pct:[],accel200:[],accel320:[],accelBands:Object.fromEntries(STRAIGHT_BANDS.map(key=>[key,[]])),straightTraversalDelta:[],speedSt:[],speedFl:[],
        events:0,zones:0
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
        item.brakingScoreZones.push(row.brakingScoreZones);
        item.brakingReferenceLap.push(row.brakingReferenceLap);
      }
      if(finite(row.brakeG))item.brakeG.push(row.brakeG);
      if(finite(row.brakeMeanG))item.brakeMeanG.push(row.brakeMeanG);
      if(finite(row.brakeDistance))item.brakeDistance.push(row.brakeDistance);
      if(finite(row.brakeDistDelta))item.brakeDistDelta.push(row.brakeDistDelta);
      if(finite(row.brakeDuration))item.brakeDuration.push(row.brakeDuration);
      if(finite(row.normalizedDecel))item.normalizedDecel.push(row.normalizedDecel);
      if(finite(row.brakeTimeDelta))item.brakeTimeDelta.push(row.brakeTimeDelta);
      if(finite(row.samplingResolution))item.samplingResolution.push(row.samplingResolution);
      if(finite(row.trace?.terminal_zone_mean_speed))item.terminalZoneMeanSpeed.push(row.trace.terminal_zone_mean_speed);
      if(finite(row.trace?.terminal_zone_length_m))item.terminalZoneLength.push(row.trace.terminal_zone_length_m);
      item.zones+=row.brakeZones;
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
  return output;
}

// Circuit Discrepancy Reconciliation Box (Answers: "where did the remaining gps go?")
function renderCircuitAuditCard(season) {
  const used = season.commonEvents || [];
  const omitted = events.map(event => event.name).filter(name => !used.includes(name));
  return `<div class="perf-audit-box"><div class="perf-audit-header"><div class="perf-audit-title">Circuit coverage · ${used.length} of ${events.length} selected events</div></div>
    <p class="performance-note">Each event contributes when at least two constructors have validated qualifying traces. Braking needs three teams with common zones. Missing teams are not imputed; teams can have different circuit counts, so check each row's support before comparing season averages.</p>
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
    const season=seasonTelemetry();
    if(!season.length)return card('Telemetry season average','At least two constructors must have validated traces in an event.','<p class="section-empty">Not enough comparable telemetry is available for this selection. Other metrics remain available.</p>');
    const trackCount = season.commonEvents?.length || 0;
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
        (isSeasonScope ? renderCircuitAuditCard(season) : '')+
        lapShareChart(values,'cornerGap',season.reference)+
        table([sortHeader('cornerTeam','Team'),sortHeader('lowGap','Low-speed deficit'),sortHeader('mediumGap','Medium-speed deficit'),sortHeader('highGap','High-speed deficit'),sortHeader('cornerEvents','Circuits',-1)],ordered.map(team=>[teamLabel(team),
          `${signed(team.lowGap,3)}<small>${signed(team.lowValue,3,' s/lap')} · ${team.low.length} circuits</small>`,
          `${signed(team.mediumGap,3)}<small>${signed(team.mediumValue,3,' s/lap')} · ${team.medium.length} circuits</small>`,
          `${signed(team.highGap,3)}<small>${signed(team.highValue,3,' s/lap')} · ${team.high.length} circuits</small>`,team.events])))+
        renderSeasonLapGapCard(season, rawValues)+
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
          const matched = avg(t.stMatched);
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
          title: 'Race Speed Trap Deficit (% to Fastest)',
          subtitle: 'Lap-number-adjusted speed where at least three teams are observed · Tyre and deployment effects remain',
          valueKey: 'raceDeficit',
          unit: '%',
          digits: 3,
          signedValue: true,
          zeroBaseline: true
        });

        return card(straightTitle, 'Race speeds at the official ST and FL timing loops. The adjusted measure compares a team’s clean checkpoint-screened laps with the field median at the same race lap number. It does not equalize tyres, tow or energy deployment.',
          straightToggle+
          raceChart+
          table([
            sortHeader('raceTeam', 'Team'),
            sortHeader('raceDeficit', 'ST Deficit (% to Fastest)'),
            sortHeader('raceMatched', 'Lap-number-adjusted speed (ST)', -1),
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
          '<p class="performance-note">Speed traps reflect observed terminal velocity under each car’s unknown setup, energy deployment and traffic. Missing matched support stays unavailable; raw medians remain separate.</p>');
      }

      const rawValues = season.map(team => ({
        ...team,
        bandGap:avg(team.accelBands[straightBand]||[]),
        bandEvents:(team.accelBands[straightBand]||[]).length,
        accel250Pct: avg(team.accel250Pct),
        accel250: avg(team.accel250),
        accel200: avg(team.accel200),
        accel320: avg(team.accel320),
        traversalDelta: avg(team.straightTraversalDelta),
        terminal: avg(team.terminalZoneMeanSpeed),
        termLen: avg(team.terminalZoneLength),
        speedSt: avg(team.speedSt),
        speedFl: avg(team.speedFl),
        peak: avg(team.top),
        sustained: avg(team.full)
      }));
      const availableBands=STRAIGHT_BANDS.filter(key=>season.filter(team=>(team.accelBands[key]||[]).length).length>=3);
      const bandControls=straightBandControls(availableBands);
      for(const row of rawValues) {
        row.bandGap=avg(row.accelBands[straightBand]||[]);
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
        speedSt: t => t.speedSt,
        speedFl: t => t.speedFl,
        traversalDelta: t => t.traversalDelta,
        straightEvents: t => t.events
      }, 'straightBandGap', 1);

      const qualyChart = renderHorizontalBarChart(orderedQualy, {
        title: `Qualifying acceleration · ${straightBand.replace('_','–')} km/h`,
        subtitle: 'Seconds slower to gain this 50 km/h on comparable straights · Season value averages supported events; not a lap-time contribution',
        valueKey: 'bandGap',
        unit: ' s',
        digits: 3,
        signedValue: true,
        zeroBaseline: true
      });
      const traversalChart = renderHorizontalBarChart(orderedQualy.filter(t => finite(t.traversalDelta)), {
        title: 'Overall Straight Traversal Gap · Share of Lap',
        subtitle: 'Observed time on the measured straights, % of reference lap · Exit speed and 2026 energy deployment remain part of this time',
        valueKey: 'traversalDelta',
        unit: '%',
        digits: 3,
        signedValue: true,
        zeroBaseline: false
      });

      return card(straightTitle, 'This is where lap time is gained or lost on the measured straights, including the speed carried out of the preceding corner. In 2026 it also includes battery deployment. Those effects belong in a lap-time decomposition, but this is not a pure engine, drag or aero ranking. Acceleration and terminal velocity are separate diagnostics.',
        straightToggle+
        traversalChart+
        bandControls+
        qualyChart+
        table([
          sortHeader('straightTeam', 'Team'),
          sortHeader('straightBandGap', `${straightBand.replace('_','–')} km/h gap`),
          'Band coverage',
          sortHeader('terminal', 'Terminal speed (≥400m)', -1),
          sortHeader('speedSt', 'Official ST', -1),
          sortHeader('speedFl', 'Official FL', -1),
          sortHeader('traversalDelta', 'Straight Traversal Delta'),
          sortHeader('straightEvents', 'Circuits', -1)
        ], orderedQualy.map(team => [
          teamLabel(team),
          signed(team.bandGap, 3, ' s'),
          `${team.bandEvents} circuit${team.bandEvents===1?'':'s'}`,
          finite(team.terminal) ? `${fmt(team.terminal, 1, ' km/h')}<small>${fmt(team.termLen, 0, ' m')} measured</small>` : '—',
          finite(team.speedSt) ? fmt(team.speedSt, 1, ' km/h') : '—',
          finite(team.speedFl) ? fmt(team.speedFl, 1, ' km/h') : '—',
          finite(team.traversalDelta) ? signed(team.traversalDelta, 3, '%') : '—',
          team.events
        ]))+
        renderSeasonLapGapCard(season, rawValues)+
        '<p class="performance-note">Acceleration uses ≥90% throttle and no observed braking within fixed speed bands. Traffic is screened against selected qualifying laps only, so clean air is not guaranteed. Terminal speed is measured in a shared corridor on long straights; no corridor means no value.</p>');
    }
    const rawBrakeValues = season.map(team => ({
      ...team,
      score:avg(team.brakingScore),
      referenceLap:avg(team.brakingReferenceLap),
      g: avg(team.brakeG),
      meanG: avg(team.brakeMeanG),
      distance: avg(team.brakeDistance),
      distDelta: avg(team.brakeDistDelta),
      duration: avg(team.brakeDuration),
      normalizedDecel: avg(team.normalizedDecel),
      timeDelta: avg(team.brakeTimeDelta),
      samplingResolution: avg(team.samplingResolution),
      zones: team.zones
    }));
    const values = computeBrakingPerformance(rawBrakeValues);
    const ordered = sorted(values, {
      brakeTeam: t => t.team,
      brakeScore: t => t.score,
      brakeTimeDelta: t => t.timeDelta,
      brakeNormDecel: t => t.normalizedDecel,
      brakeMeanG: t => t.meanG,
      brakeG: t => t.g,
      brakeDistDelta: t => t.distDelta,
      brakeDistance: t => t.distance,
      brakeDuration: t => t.duration,
      brakeResolution: t => t.samplingResolution,
      brakeZones: t => t.zones
    }, 'brakeScore', 1);

    const brakeChart = renderHorizontalBarChart(ordered, {
      title: 'Qualifying time lost in braking zones',
      subtitle: 'Measured time difference through the same braking-to-apex corridors, as % of the full qualifying lap · Lower is better',
      valueKey: 'score',
      unit: '%',
      digits: 3,
      signedValue: true,
      zeroBaseline: true
    });

    return card(brakingTitle,'A +0.7% value means roughly 0.7% of a qualifying lap was lost through the measured braking-to-apex corridors versus the quickest measured team there. This includes entry speed and corner approach, so it is not a pure brake-hardware effect. Distance and deceleration are shown separately, not mixed into the percentage.',
      brakeChart+
      table([
        sortHeader('brakeTeam','Team'),
        sortHeader('brakeScore','Qualifying lap share lost'),
        sortHeader('brakeTimeDelta','Approx. time lost'),
        sortHeader('brakeNormDecel','Distance-norm decel (anorm)',-1),
        sortHeader('brakeMeanG','Mean decel',-1),
        sortHeader('brakeDistDelta','Distance delta (Δm)'),
        sortHeader('brakeDistance','Braking distance'),
        sortHeader('brakeResolution','Sampling interval (v/f)'),
        sortHeader('brakeZones','Matched zones',-1)
      ],ordered.map(team=>[
        teamLabel(team),
        signed(team.score,3,'%'),
        `${signed(team.timeLossSeconds,3,' s')}`,
        `${fmt(team.normalizedDecel,2,' g')}`,
        fmt(team.meanG,2,' g'),
        signed(team.distDelta,1,' m'),
        fmt(team.distance,1,' m'),
        `<span class="perf-onset-bracket">Δs ~${fmt(team.samplingResolution,1,' m')}</span>`,
        `${team.brakingScore.length} scored circuits · ${team.zones} observed zones`
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
        subtitle: 'Lap-number-adjusted ST speed where at least three teams share timing data · Baseline 0.000% is fastest',
        valueKey: 'raceDeficit',
        unit: '%',
        digits: 3,
        signedValue: true,
        zeroBaseline: true
      });

      return card('Straight-line performance', 'Grand Prix straight-line speeds at the speed trap (ST) and finish line (FL) timing loops. The matched estimate adjusts for common race lap numbers; tyre, traffic and deployment effects remain.',
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
      eventStraightSpeedST: t => t.speedSt,
      eventStraightSpeedFL: t => t.speedFl,
      eventStraightTraversal: t => t.traversalDelta
    }, 'eventStraightBand', 1);

    const straightTraversalChart = renderHorizontalBarChart(ordered.filter(r => finite(r.traversalDelta)), {
      title: 'Overall Straight Traversal Gap · Share of Lap',
      subtitle: 'Gap to the fastest straight traversal · Includes corner exit and deployment effects',
      valueKey: 'traversalDelta',
      unit: '%',
      digits: 3,
      signedValue: true,
      zeroBaseline: false
    });
    const singleStraightChart = renderHorizontalBarChart(ordered, {
      title: `Qualifying acceleration · ${straightBand.replace('_','–')} km/h`,
      subtitle: 'Seconds slower to gain this 50 km/h on comparable full-throttle straights · Not additive lap time',
      valueKey: 'bandGap',
      unit: ' s',
      digits: 3,
      signedValue: true,
      zeroBaseline: true
    });

    return card('Straight-line performance', 'Overall performance is the time spent on measured straights as a share of the reference lap; acceleration and terminal speed are diagnostics. This is not a pure power or aerodynamic ranking.',
      straightToggle+
      straightTraversalChart+
      bandControls+
      singleStraightChart+
      table([
        sortHeader('eventStraightTeam', 'Team'),
        sortHeader('eventStraightBand', `${straightBand.replace('_','–')} km/h gap`),
        'Measured straights',
        sortHeader('eventStraightTerminal', 'Terminal speed (≥400m)', -1),
        sortHeader('eventStraightSpeedST', 'Official ST', -1),
        sortHeader('eventStraightSpeedFL', 'Official FL', -1),
        sortHeader('eventStraightTraversal', 'Straight Traversal Delta')
      ], ordered.map(t => [
        teamLabel(t),
        signed(t.bandGap, 3, ' s'),
        t.bandStraights||'—',
        finite(t.terminalSpeed) ? `${fmt(t.terminalSpeed, 1, ' km/h')}${finite(t.termDeficit) ? `<small> -${fmt(t.termDeficit, 1, ' km/h')}</small>` : ''}` : '—',
        finite(t.speedSt) ? fmt(t.speedSt, 1, ' km/h') : '—',
        finite(t.speedFl) ? fmt(t.speedFl, 1, ' km/h') : '—',
        finite(t.traversalDelta) ? signed(t.traversalDelta, 3, '%') : '—'
      ]))+
      card('Where the lap gap comes from',`Relative to ${escape(event.traceReference||'the fastest measured team')}’s qualifying lap.`,
      table(['Team','Straights (Traversal Delta)','Corners','Lap gap'],ordered.map(row=>[teamLabel(row),finite(row.traversalDelta)?signed(row.traversalDelta,3,'%'):'—',fmt(row.trace?.corner_contribution,3,'%'),fmt(row.trace?.lap_gap,3,'%')])))+
      '<p class="performance-note">Acceleration uses ≥90% throttle without observed braking through fixed speed bands. Traffic is screened against selected qualifying laps only; clean air is not guaranteed. Terminal speed is measured in a shared long-straight corridor when one is available. Straight traversal reflects total measured straight time relative to the reference lap.</p>');
  }
  const brakeRows = computeBrakingPerformance(loaded.map(r => ({
    ...r,
    score:r.brakingScore,
    referenceLap:r.brakingReferenceLap,
    g: r.brakeG,
    meanG: r.brakeMeanG,
    distDelta: r.brakeDistDelta,
    distance: r.brakeDistance,
    duration: r.brakeDuration,
    normalizedDecel: r.normalizedDecel,
    timeDelta: r.brakeTimeDelta,
    samplingResolution: r.samplingResolution,
    onsetBracket: r.onsetBracket,
    zones: r.brakeZones
  })));
  const ordered = sorted(brakeRows, {
    eventBrakeTeam: r => r.team,
    eventBrakeScore: r => r.score,
    eventBrakeTimeDelta: r => r.timeDelta,
    eventBrakeNormDecel: r => r.normalizedDecel,
    eventBrakeMeanG: r => r.meanG,
    eventBrakeG: r => r.g,
    eventBrakeDistDelta: r => r.distDelta,
    eventBrakeDistance: r => r.distance,
    eventBrakeDuration: r => r.duration,
    eventBrakeResolution: r => r.samplingResolution,
    eventBrakeZones: r => r.zones
  }, 'eventBrakeScore', 1);

  const singleBrakeChart = renderHorizontalBarChart(ordered, {
    title: 'Qualifying time lost in braking zones',
    subtitle: 'Measured time difference through the same braking-to-apex corridors, as % of the full qualifying lap · Lower is better',
    valueKey: 'score',
    unit: '%',
    digits: 3,
    signedValue: true,
    zeroBaseline: true
  });

  return card('Braking observations','The percentage is observed time lost in matched qualifying braking-to-apex corridors, divided by the full qualifying lap time. It includes entry speed and approach, so it is not a pure brake-hardware effect. The onset bracket shows the sampling uncertainty; teams without three common supported zones have no score.',
    singleBrakeChart+
    table([
      sortHeader('eventBrakeTeam','Team'),
      sortHeader('eventBrakeScore','Qualifying lap share lost'),
      sortHeader('eventBrakeTimeDelta','Approx. time lost'),
      sortHeader('eventBrakeNormDecel','Distance-norm decel (anorm)',-1),
      sortHeader('eventBrakeMeanG','Mean decel',-1),
      sortHeader('eventBrakeDistDelta','Distance delta (Δm)'),
      sortHeader('eventBrakeDistance','Braking distance'),
      sortHeader('eventBrakeResolution','Onset bracket [d_off, d_on]'),
      sortHeader('eventBrakeZones','Matched zones',-1)
    ],ordered.map(row=>[
      teamLabel(row),
      signed(row.score,3,'%'),
      `${signed(row.timeLossSeconds, 3, ' s')}`,
      `${fmt(row.normalizedDecel, 2, ' g')}`,
      fmt(row.meanG,2,' g'),
      signed(row.distDelta,1,' m'),
      fmt(row.distance,1,' m'),
      row.onsetBracket ? `<span class="perf-onset-bracket">[${fmt(row.onsetBracket[0], 0)}, ${fmt(row.onsetBracket[1], 0)}] m</span>` : `<span class="perf-onset-bracket">Δs ~${fmt(row.samplingResolution, 1, ' m')}</span>`,
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
  if(event.target.closest('[data-performance-explain]')){showPerformanceDescriptions=!showPerformanceDescriptions;render();return;}
  const metric=event.target.closest('[data-performance-metric]');
  if(metric) {activeMetric=metric.dataset.performanceMetric;render();}
  const sort=event.target.closest('[data-performance-sort]');
  const tyre=event.target.closest('[data-performance-tyre]');
  if(tyre){tyreView=tyre.dataset.performanceTyre;render();}
  const straightSrc=event.target.closest('[data-straight-source]');
  if(straightSrc){straightLineSource=straightSrc.dataset.straightSource;render();}
  const band=event.target.closest('[data-straight-band]');
  if(band&&!band.disabled){straightBand=band.dataset.straightBand;render();}
  const qualyModeBtn=event.target.closest('[data-qualy-mode]');
  if(qualyModeBtn){qualyPaceMode=qualyModeBtn.dataset.qualyMode;render();}
  const sectorModeBtn=event.target.closest('[data-sector-mode]');
  if(sectorModeBtn){sectorPaceMode=sectorModeBtn.dataset.sectorMode;render();}
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
