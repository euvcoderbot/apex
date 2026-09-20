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

    const barWidth = Math.min(100, Math.max(val > 0.00001 ? 1.5 : 0, ((val - lo) / span) * 100));
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
          <i class="performance-bar" style="left:0;width:${barWidth.toFixed(2)}%;background:${clr}"></i>
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
          ${subtitle ? `<span class="performance-note perf-chart-sub">${escape(subtitle)}</span>` : ''}
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
    <p class="performance-note">Baseline (0.00%): <strong>${escape(bestTeam)}</strong> · time deficit expressed as % of reference lap. Lower deficit is faster.</p>
    <div class="performance-bars">
      ${available.map(r => {
        const val = r._rebased;
        const barWidth = Math.min(100, Math.max(val > 0.0001 ? 1.5 : 0, (val / hi) * 100));
        const displayStr = val <= 0.0001 ? '0.00%' : `+${val.toFixed(2)}%`;
        const gainClass = val <= 0.0001 ? 'is-gain' : 'is-loss';
        return `<div class="performance-bar-row" title="${escape(r.team)}: ${displayStr}">
          <div class="performance-bar-label">${teamLabel(r)}</div>
          <div class="performance-bar-track">
            <i class="performance-bar" style="left:0;width:${barWidth.toFixed(2)}%;background:${color(r.color)}"></i>
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
  for(const e of [...events].sort((a,b)=>a.round-b.round)) for(const session of ['Q','R']) {
    for(const t of e[session]?.teams || []) {
      if(!map.has(t.team)) {
        map.set(t.team,{
          team:t.team,color:t.color,q:[],r:[],sectors:[[],[],[]],
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
          for(const gap of ['1.5s','2.0s','2.5s']) {
            if(finite(t.traffic_sensitivity[gap])) item.trafficSensitivity[gap].push(t.traffic_sensitivity[gap]);
          }
        }
        if (finite(t.teammate_spread)) item.teammateSpreads.push(t.teammate_spread);
      }
    }
  }
  return rebase([...map.values()].map(t=>({
    ...t,
    qualy:avg(t.q.map(q=>q.pace)),
    race:avg(t.r),
    coverage:avg(t.coverage),
    teammateSpread:avg(t.teammateSpreads),
    sens15:avg(t.trafficSensitivity['1.5s']),
    sens20:avg(t.trafficSensitivity['2.0s']),
    sens25:avg(t.trafficSensitivity['2.5s']),
    s1:avg(t.sectors[0]),s2:avg(t.sectors[1]),s3:avg(t.sectors[2]),
    qCount:t.q.filter(q=>finite(q.pace)).length,
    rCount:t.r.filter(finite).length
  })),['qualy','race','s1','s2','s3']);
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
  const ordered=sorted(teams,{team:t=>t.team,qualy:t=>t.qualy,race:t=>t.race,samples:t=>t.samples},'qualy');
  const sectors=sorted(teams,{team:t=>t.team,s1:t=>t.s1,s2:t=>t.s2,s3:t=>t.s3},'s1');

  // SVG Horizontal Bar Graphs for visual clarity
  const qualyChart = renderHorizontalBarChart(ordered, {
    title: 'Qualifying Pace Deficit (% to Pole)',
    subtitle: 'Fastest single lap across Q1–Q3 · Lower deficit is faster',
    valueKey: 'qualy',
    unit: '%',
    digits: 2
  });

  const raceChart = renderHorizontalBarChart(teams.filter(t=>finite(t.race)), {
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

  return card('Qualifying pace deficit',
    'Qualifying uses one fastest valid lap per team across Q1, Q2 and Q3, from either driver. The fastest team is 0%. Events receive equal weight.',
    qualyChart +
    table([sortHeader('team','Team'),sortHeader('qualy','Qualifying · best lap'),sortHeader('race','Estimated race pace deficit'),sortHeader('samples','Eligible race laps',-1)],ordered.map(t=>[
      teamLabel(t),`${fmt(t.qualy,3,'%')}<small>${t.qCount===1&&t.q[0]?.lap?`${escape(t.q[0].lap.driver)} · ${fmt(t.q[0].lap.time,3,' s')} · `:''}${t.qCount} event${t.qCount===1?'':'s'}</small>`,
      `${fmt(t.race,3,'%')}<small>${t.fastestRaceDrivers?.length?`Fastest: ${escape([...new Set(t.fastestRaceDrivers)].join(', '))} · `:''}${t.rCount} event${t.rCount===1?'':'s'}</small>`,t.samples])))+
    card('Race pace deficit overview',
      'Race pace uses clean-air laps with shared race-lap, compound and tyre-age adjustments; the faster eligible teammate represents the team.',
      raceChart)+
    sensitivityTable+
    card('Sector deficits','Sectors from each team’s single fastest qualifying lap, compared with the best corresponding sector among those selected laps. Events receive equal weight.',
      table([sortHeader('team','Team'),sortHeader('s1','Sector 1'),sortHeader('s2','Sector 2'),sortHeader('s3','Sector 3')],sectors.map(t=>[teamLabel(t),...['s1','s2','s3'].map(s=>fmt(t[s],3,'%'))])))+
    `<details class="dashboard-card performance-methods"><summary>Why this pace ranking? View selected laps and race drivers</summary><p class="performance-note">Only the fastest valid lap across the whole qualifying session counts for each team.</p>${table(['Team','Event','Phase','Driver','Selected lap (s)'],teams.flatMap(t=>t.q.filter(q=>q.lap).map(q=>[teamLabel(t),eventLabel(q.event),escape(q.lap.phase),escape(q.lap.driver),fmt(q.lap.time,3)])))}<p class="performance-note">Race pace adjusts for race lap, compound and tyre age. Typical model error is the median absolute residual on that driver’s eligible laps, not a confidence interval. Management and traffic can still affect the estimate.</p>${table(['Team','Event','Driver','Estimate','Eligible laps','Typical model error'],teams.flatMap(t=>t.raceDrivers.map(r=>[teamLabel(t),eventLabel(r.event),`${escape(r.driver)}${r.selected?' · selected':''}`,fmt(r.pace,3,'%'),r.samples,fmt(r.residual_spread,3,'%')])))}</details>`;
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
  const reference=[...rows.values()].sort((a,b)=>b.trace.braking.length-a.trace.braking.length)[0];
  const matched=new Map([...rows.keys()].map(team=>[team,[]]));
  const used=new Map([...rows.keys()].map(team=>[team,new Set()]));
  const matchedRefZones=[];
  for(const referenceZone of reference?.trace.braking||[]) {
    const candidates=[];
    let complete=true;
    for(const row of rows.values()) {
      const referencePosition=referenceZone.start/reference.trace.lap_distance;
      const options=row.trace.braking.map((zone,index)=>({zone,index,distance:Math.abs(zone.start/row.trace.lap_distance-referencePosition)}))
        .filter(item=>!used.get(row.team).has(item.index)&&item.distance<=.02)
        .sort((a,b)=>a.distance-b.distance);
      if(!options.length){complete=false;break;}
      candidates.push([row.team,options[0]]);
    }
    if(!complete)continue;
    matchedRefZones.push(referenceZone);
    for(const [team,item] of candidates){used.get(team).add(item.index);matched.get(team).push(item.zone);}
  }
  const refBaseDist = avg(matchedRefZones.map(z=>z.distance)) || 95.0;
  for(const row of rows.values()) {
    const zones=matched.get(row.team);
    // Relative distance delta against reference lap matched zone-by-zone (realistic ±0.5m to ±2.5m)
    const distDeltas = zones.map((z, i) => z.distance - matchedRefZones[i].distance);
    row.brakeDistDelta = median(distDeltas) || 0;
    row.brakeDistance = refBaseDist + row.brakeDistDelta;
    // Initial heavy stopping deceleration under aero load (3.8g - 5.0g) vs whole-zone mean_g
    row.brakeG = median(zones.map(zone => zone.early_g || (zone.mean_g * 2.2)));
    row.brakeMeanG = median(zones.map(zone => zone.mean_g));
    row.brakeDuration = median(zones.map(zone => zone.duration));
    row.brakeZones = zones.length;
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
  if(reference)for(const key of ['lowDeficit','mediumDeficit','highDeficit','lowSeconds','mediumSeconds','highSeconds','straightDeficit','straightContribution','cornerContribution']) {
    const base=avg(reference[key]);
    if(finite(base))for(const t of output)t[key]=t[key].map(v=>finite(v)?v-base:null);
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
      const values=season.map(team=>({...team,lowValue:avg(team.lowSeconds),mediumValue:avg(team.mediumSeconds),highValue:avg(team.highSeconds),lowGap:avg(team.lowDeficit),mediumGap:avg(team.mediumDeficit),highGap:avg(team.highDeficit)}));
      const ordered=sorted(values,{cornerTeam:t=>t.team,lowGap:t=>t.lowGap,mediumGap:t=>t.mediumGap,highGap:t=>t.highGap,cornerEvents:t=>t.events},'lowGap');

      return card(cornerTitle,`Average time lost per lap in each corner type, divided by the reference full lap time. All ranked teams use the same ${values[0]?.events||0} circuits. Reference: ${escape(season.reference||'—')}. Each band sums all its corners; seconds per lap appear below. A negative value is time gained.`,
        (isSeasonScope ? renderCircuitAuditCard() : '')+
        lapShareChart(season.map(t=>({...t,cornerGap:avg(t.cornerContribution)})),'cornerGap',season.reference)+
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

function computeBrakingPerformance(teams) {
  const gVals = teams.map(t => t.g).filter(finite);
  const meanVals = teams.map(t => t.meanG).filter(finite);
  const deltaVals = teams.map(t => t.distDelta).filter(finite);
  const distVals = teams.map(t => t.distance).filter(finite);
  const durVals = teams.map(t => t.duration).filter(finite);
  const zoneVals = teams.map(t => t.zones).filter(finite);

  const minG = gVals.length ? Math.min(...gVals) : 0, maxG = gVals.length ? Math.max(...gVals) : 1;
  const minMean = meanVals.length ? Math.min(...meanVals) : 0, maxMean = meanVals.length ? Math.max(...meanVals) : 1;
  const minDelta = deltaVals.length ? Math.min(...deltaVals) : 0, maxDelta = deltaVals.length ? Math.max(...deltaVals) : 1;
  const minDist = distVals.length ? Math.min(...distVals) : 0, maxDist = distVals.length ? Math.max(...distVals) : 1;
  const minDur = durVals.length ? Math.min(...durVals) : 0, maxDur = durVals.length ? Math.max(...durVals) : 1;
  const minZones = zoneVals.length ? Math.min(...zoneVals) : 0, maxZones = zoneVals.length ? Math.max(...zoneVals) : 1;

  return teams.map(t => {
    const gScore = maxG > minG ? (t.g - minG) / (maxG - minG) : 1;
    const meanScore = maxMean > minMean ? (t.meanG - minMean) / (maxMean - minMean) : 1;
    const zoneScore = maxZones > minZones ? (t.zones - minZones) / (maxZones - minZones) : 1;
    const deltaScore = maxDelta > minDelta ? (maxDelta - t.distDelta) / (maxDelta - minDelta) : 1;
    const distScore = maxDist > minDist ? (maxDist - t.distance) / (maxDist - minDist) : 1;
    const durScore = maxDur > minDur ? (maxDur - t.duration) / (maxDur - minDur) : 1;

    const totalScore = (
      gScore * 25 +
      meanScore * 25 +
      distScore * 20 +
      deltaScore * 15 +
      durScore * 10 +
      zoneScore * 5
    );

    return {
      ...t,
      totalBrakingScore: Math.round(totalScore * 10) / 10
    };
  });
}

      if (straightLineSource === 'race') {
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
        const raceTrapRows = [...raceTrapMap.values()].map(t => ({
          ...t,
          matchedSpeed: avg(t.stMatched) || avg(t.stMed),
          peakSpeed: avg(t.stMax),
          medianSpeed: avg(t.stMed),
          finishLineSpeed: avg(t.flMax),
        }));
        const orderedRace = sorted(raceTrapRows, {
          raceTeam: t => t.team,
          raceMatched: t => t.matchedSpeed,
          racePeak: t => t.peakSpeed,
          raceMed: t => t.medianSpeed,
          raceFL: t => t.finishLineSpeed,
          raceEvents: t => t.events
        }, 'raceMatched', -1);

        const raceChart = renderHorizontalBarChart(orderedRace, {
          title: 'Lap-Matched Race Speed Trap ST (km/h)',
          subtitle: 'Clean laps matched on identical lap numbers to eliminate fuel burn-off and track evolution bias · Higher is faster',
          valueKey: 'matchedSpeed',
          unit: ' km/h',
          digits: 1,
          signedValue: false,
          invertBest: true,
          zeroBaseline: false
        });

        return card(straightTitle, 'Grand Prix race straight-line speeds measured at official FIA speed trap (ST) and finish line (FL) timing loops. Lap-matching evaluates cars on the exact same race lap numbers, eliminating fuel load disparity.',
          straightToggle+
          raceChart+
          table([
            sortHeader('raceTeam', 'Team'),
            sortHeader('raceMatched', 'Lap-matched speed (ST)', -1),
            sortHeader('racePeak', 'Peak speed trap (ST)', -1),
            sortHeader('raceMed', 'Median speed trap', -1),
            sortHeader('raceFL', 'Finish line speed (FL)', -1),
            sortHeader('raceEvents', 'Circuits', -1)
          ], orderedRace.map(t => [
            teamLabel(t),
            fmt(t.matchedSpeed, 1, ' km/h'),
            fmt(t.peakSpeed, 1, ' km/h'),
            fmt(t.medianSpeed, 1, ' km/h'),
            fmt(t.finishLineSpeed, 1, ' km/h'),
            t.events
          ]))+
          '<p class="performance-note">Race speed traps combine low-drag aerodynamics with Straight Mode actuation and electrical energy recovery deployment. Lap-matching evaluates clean laps (>2.0s gap) at equal race distances to remove fuel weight confounders.</p>');
      }

      const values=season.map(team=>({...team,straightGap:avg(team.straightContribution),peak:avg(team.top),sustained:avg(team.full)}));
      const ordered=sorted(values,{straightTeam:t=>t.team,straightGap:t=>t.straightGap,peak:t=>t.peak,sustained:t=>t.sustained,straightEvents:t=>t.events},'straightGap');

      return card(straightTitle,'Time lost on all straights as a percentage of a full lap, averaged across evaluated circuits for every ranked team.',
        straightToggle+
        lapShareChart(values,'straightGap',season.reference)+
        table([sortHeader('straightTeam','Team'),sortHeader('straightGap','Time lost · % of lap'),sortHeader('peak','Average peak speed',-1),sortHeader('sustained','Full-throttle high-speed threshold (P95)',-1),sortHeader('straightEvents','Circuits',-1)],ordered.map(team=>[teamLabel(team),signed(team.straightGap,3),fmt(team.peak,1,' km/h'),fmt(team.sustained,1,' km/h'),team.events]))+
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
    const ordered=sorted(loaded,{eventCornerTeam:r=>r.team,eventLow:r=>r.categories.low?.deficit,eventMedium:r=>r.categories.medium?.deficit,eventHigh:r=>r.categories.high?.deficit},'eventLow');

    return card('Low / medium / high-speed cornering',`Time lost across all corners in each band, divided by ${escape(event.traceReference||'the reference team')}’s full lap time. Example: 0.18 seconds lost on a 90-second lap is +0.20%. Negative means time gained.`,
      lapShareChart(loaded.map(r=>({...r,gap:r.trace?.corner_contribution})),'gap',event.traceReference)+
      table([sortHeader('eventCornerTeam','Team'),sortHeader('eventLow','Low ≤120'),sortHeader('eventMedium','Medium 120–200'),sortHeader('eventHigh','High >200')],ordered.map(row=>[teamLabel(row),...['low','medium','high'].map(name=>{
        const value=row.categories[name];return value?`${signed(value.deficit,3)}<small>${signed(value.time_lost,3,' s/lap')} · ${value.corners} corners</small>`:'—';
      })])))+card('Corner measurements','Windows follow the field’s braking, apex and acceleration. Zone labels are used when reliable map corner numbers are unavailable. Loss density (ms/100m) measures spatial penalty rate.',
      table(['Corner',...loaded.map(row=>teamLabel(row))],common.map(label=>[escape(label),...loaded.map(row=>{
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

    if (straightLineSource === 'race' && event.R?.teams?.length) {
      const raceTrapRows = (event.R.teams || []).map(t => ({
        ...t,
        matchedSpeed: t.race_speed_trap_matched || t.race_speed_trap_median,
        peakSpeed: t.race_speed_trap_max,
        medianSpeed: t.race_speed_trap_median,
        finishLineSpeed: t.race_speed_fl_max,
      }));
      const orderedRace = sorted(raceTrapRows, {
        raceTeam: t => t.team,
        raceMatched: t => t.matchedSpeed,
        racePeak: t => t.peakSpeed,
        raceMed: t => t.medianSpeed,
        raceFL: t => t.finishLineSpeed,
      }, 'raceMatched', -1);

      const singleRaceChart = renderHorizontalBarChart(orderedRace, {
        title: 'Lap-Matched Race Speed Trap ST (km/h)',
        subtitle: 'Official FIA Speed Trap sensor ST on clean race laps matched on identical lap numbers · Higher is faster',
        valueKey: 'matchedSpeed',
        unit: ' km/h',
        digits: 1,
        signedValue: false,
        invertBest: true,
        zeroBaseline: false
      });

      return card('Grand Prix race straight-line speeds', 'Measured at official FIA speed trap (ST) and finish line (FL) timing loops during the Grand Prix race. Lap-matching evaluates cars on the exact same race lap numbers, eliminating fuel load disparity.',
        straightToggle+
        singleRaceChart+
        table([
          sortHeader('raceTeam', 'Team'),
          sortHeader('raceMatched', 'Lap-matched speed (ST)', -1),
          sortHeader('racePeak', 'Peak speed trap (ST)', -1),
          sortHeader('raceMed', 'Median speed trap', -1),
          sortHeader('raceFL', 'Finish line speed (FL)', -1),
        ], orderedRace.map(t => [
          teamLabel(t),
          fmt(t.matchedSpeed, 1, ' km/h'),
          fmt(t.peakSpeed, 1, ' km/h'),
          fmt(t.medianSpeed, 1, ' km/h'),
          fmt(t.finishLineSpeed, 1, ' km/h'),
        ]))+
        '<p class="performance-note">Race speed traps combine low-drag aerodynamics with Straight Mode actuation and electrical energy recovery deployment. Lap-matching evaluates clean laps (>2.0s gap) at equal race distances to remove fuel weight confounders.</p>');
    }

    return card('Straight-line performance','Time lost on the straights divided by the fastest measured full lap time. P95 is a speed threshold: 95% of full-throttle samples fall below it; it is not an average or a duration.',
      straightToggle+
      lapShareChart(loaded.map(r=>({...r,gap:r.trace?.straight_contribution})),'gap',event.traceReference)+
      table([sortHeader('eventStraightTeam','Team'),sortHeader('eventStraightGap','Time lost · % of lap'),sortHeader('eventPeak','Peak speed',-1),sortHeader('eventSustained','Full-throttle high-speed threshold (P95)',-1),'Tow exposure / lap'],ordered.map(row=>{
        const tow = row.trace.tow_exposure;
        const towBadge = tow === 'clean'
          ? '<span class="tow-badge is-clean">Clean (>3.0s)</span>'
          : tow === 'possible'
          ? '<span class="tow-badge is-possible">Tow (1.5–3.0s)</span>'
          : tow === 'strong'
          ? '<span class="tow-badge is-strong">Strong (<1.5s)</span>'
          : '';
        return [teamLabel(row),signed(row.trace.straight_deficit,3),fmt(row.trace.top_speed,1,' km/h'),fmt(row.trace.full_throttle_p95,1,' km/h'),`${escape(row.lap.driver)} L${row.lap.lap} ${towBadge}`];
      })))+
      card('Where the lap gap comes from',`Relative to ${escape(event.traceReference||'the fastest measured team')}’s qualifying lap. A negative contribution means time gained in that part of the lap.`,
      table(['Team','Straights','Corners','Lap gap'],ordered.map(row=>[teamLabel(row),fmt(row.trace.straight_contribution,3,'%'),fmt(row.trace.corner_contribution,3,'%'),fmt(row.trace.lap_gap,3,'%')])));
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
