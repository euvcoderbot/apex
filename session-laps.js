/* Session analysis: drivers, runs, lap chooser and loaded-lap list. */
// UI Rendering Functions
function mergeRaceClassification(classification) {
  for(const item of classification) {
    const driver=[...realDrivers.values()].find(d=>String(d.number)===String(item.driver_number));
    if(!driver)continue;
    const result={...driver.result};
    if(typeof item.points==='number' && Number.isFinite(item.points))result.points=item.points;
    if(item.gap_to_leader!=null && !Array.isArray(item.gap_to_leader))result.gap=item.gap_to_leader;
    if(item.dsq)result.status='DSQ';else if(item.dns)result.status='DNS';else if(item.dnf)result.status='DNF';
    else if(item.position>0 && !/^\+\d+ laps?$/i.test(result.status||''))result.status='Finished';
    driver.result=result;
    if(item.position>0){driver.position=item.position;const row=drivers.find(d=>d[0]===driver.code);if(row)row[5]=item.position;}
  }
}

async function refreshRaceResults(request,query) {
  if(window.APEX_SNAPSHOT_MODE && !window.APEX_LOCAL_MODE)return;
  if(request!==sessionRequest || !/^(Race|Sprint)$/i.test(loadedSessionName) || !openf1SessionKey)return;
  const key=openf1SessionKey;
  let classificationSeen=false;
  try {
    const response=await fetchSessionData(`https://api.openf1.org/v1/session_result?session_key=${key}`,{cache:'no-store',signal:request.signal});
    if(!response.ok)throw new Error('Classification not available yet');
    const rows=await response.json();
    if(request!==sessionRequest || query!==String(currentQuery()))return;
    if(Array.isArray(rows)){classificationSeen=rows.some(r=>r.position>0);mergeRaceClassification(rows);renderDrivers();}
  } catch(error) { if(error.name==='AbortError')return; }
  const pending=[...realDrivers.values()].some(d=>!Number.isFinite(d.result?.points)||d.result?.gap==null && !/DNF|DNS|DSQ/i.test(d.result?.status||''));
  if((pending||!classificationSeen&&sessionYear===new Date().getFullYear()) && raceResultRefreshAttempts++<10 && request===sessionRequest)
    raceResultRefreshTimer=setTimeout(()=>refreshRaceResults(request,query),60000);
}

function raceResultMarkup(driver) {
  const result = driver?.result || {};
  const status = String(result.status || '').trim();
  const retired = status && !/^(finished|\+\d+ laps?)$/i.test(status);
  const badge = /^(dns|did not start|withdrawn|did not qualify|did not prequalify)$/i.test(status) ? 'DNS'
    : /disqualified|dsq/i.test(status) ? 'DSQ' : retired ? 'DNF' : '';
  let value = '—';
  if (raceResultView === 'points') {
    if (Number.isFinite(result.points)) value = `${result.points} pts`;
  } else if (badge) value = badge;
  else if (/^\+\d+ laps?$/i.test(status)) value = status.toLowerCase();
  else if (typeof result.gap === 'string' && /^\+?\d+\s*laps?$/i.test(result.gap.trim())) value = result.gap.toLowerCase();
  else if (Number.isFinite(result.gap)) value = result.gap === 0 ? 'Winner' : `+${result.gap.toFixed(3)}s`;
  else if (typeof result.gap === 'string' && /^\+?\d+(?:\.\d+)?s?$/i.test(result.gap.trim())) {
    const gap = Number.parseFloat(result.gap);
    value = gap === 0 ? 'Winner' : `+${gap.toFixed(3)}s`;
  }
  return `<span class="driver-result" title="${escapeUI(status || 'Result unavailable')}"><b>${escapeUI(value)}</b>${badge && raceResultView === 'points' ? `<small>${badge}</small>` : ''}</span>`;
}

// Timing feeds write surnames in capitals ("Max VERSTAPPEN"); lists use natural
// case ("Max Verstappen"). Only a "First LAST" name is recased: a bare code
// fallback ("VER") stays as it is.
function naturalDriverName(value) {
  const words = String(value).split(' ');
  if (words.every(word => word === word.toUpperCase())) return String(value);
  return words.map(word => word.length > 1 && word === word.toUpperCase() && word !== word.toLowerCase()
    ? word.split('-').map(part => part.charAt(0) + part.slice(1).toLowerCase()).join('-')
    : word).join(' ');
}

function renderDrivers() {
  const root = $('#driverPills');
  const isRace = drivers.length > 0 && /^(Race|Sprint)$/i.test(loadedSessionName);
  const controls = $('#raceResultControls');
  if (controls) {
    controls.hidden = !isRace;
    controls.querySelectorAll('button').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.resultView === raceResultView));
      button.onclick = () => { raceResultView = button.dataset.resultView; renderDrivers(); };
    });
  }
  root.classList.toggle('has-race-results', isRace);
  if (!drivers.length) {
    root.innerHTML = '<span class="section-empty">Load a session to see its drivers.</span>';
    return;
  }
  
  replaceUI(root, drivers.map((d, index) => {
    const code = d[0];
    const number = d[1];
    const color = d[3];
    const isSelected = selected.includes(code);
    const position = Number.isFinite(+d[5]) && +d[5] > 0 ? +d[5] : index + 1;

    const name = naturalDriverName(d[2] || code);
    // A source-list row: position · logo · name · trailing code (a race shows
    // its result there instead); the car number is in the tooltip.
    return `<button class="driver-pill ${isSelected ? 'selected' : ''}" style="--team:${color}" data-motion-key="driver-${code}" data-code="${code}" aria-label="${escapeUI(`P${position}, ${name}, ${d[4] || ''}, number ${number}`)}" aria-pressed="${isSelected}"><span class="driver-pill-position">${position}</span>${teamLogoMarkup(d[4])}<span class="driver-pill-identity">${escapeUI(name)}</span>${isRace ? raceResultMarkup(realDrivers.get(code)) : `<span class="driver-pill-code">${escapeUI(code)}</span>`}</button>`;
  }).join(''));
  
  root.querySelectorAll('button').forEach(btn => {
    btn.onkeydown = event => {
      const rows = [...root.querySelectorAll('button')];
      const index = rows.indexOf(btn);
      const target = event.key === 'ArrowDown' ? Math.min(rows.length - 1, index + 1)
        : event.key === 'ArrowUp' ? Math.max(0, index - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : null;
      if (target == null) return;
      event.preventDefault();
      rows[target]?.focus();
    };
    btn.onclick = () => {
      const code = btn.dataset.code;
      if (selected.includes(code)) {
        selected = selected.filter(x => x !== code);
        loaded = loaded.filter(x => x.code !== code);
      } else {
        selected.push(code);
      }
      renderDrivers();
      renderStints();
      renderAll();
    };
  });
}


function fastestTimedLap(driver) {
  const timed = driver?.laps?.filter(lap => Number.isFinite(lap.time) && lap.time > 0 && !lap.in_lap && !lap.out_lap) || [];
  return timed.length ? timed.reduce((fastest, lap) => lap.time < fastest.time ? lap : fastest) : null;
}

// What each lap actually was, for the label on its row. A run starts at a pit exit and ends with the lap into the pits, so it has one OUT and
// one IN. The source's pit-entry flag is not used to place them: its lap number can be off by one or two, while pit exits are reliable.
// Between them, qualifying laps are judged against the driver's own best in that phase. This only labels laps; timing and flags are untouched.
const PUSH_PACE = 1.04, PUSH_SECTOR = 1.02;
const LAP_ROLES = {
  out: ['OUT', 'Out-lap: from pit exit to the timing line. Comparison may be partial.'],
  in: ['IN', 'In-lap: the last lap of this run, into the pits.'],
  inOut: ['IN/OUT', 'Left the pits and came back in on the same lap; the trace may include a garage stop.'],
  push: ['PUSH', 'Flying lap: within 4% of this driver\'s best in this phase.'],
  abort: ['ABORT', 'Started at flying-lap pace, then lost the time: a mistake or an abandoned attempt.'],
  warm: ['WARM', 'Warm-up lap: slow throughout, before the flying attempt.'],
  prep: ['PREP', 'Slow lap between two flying attempts on the same tyres: cooling down and preparing. No pit stop.'],
  cool: ['COOL', 'Slow lap after the last flying attempt, before the in-lap.'],
  flag: ['FLAG', 'Slow lap under a yellow or red flag; its time says little about pace.'],
};
function lapRoles(laps, sessionName) {
  const roles = new Map();
  const ordered = [...(laps || [])].sort((a, b) => a.lap - b.lap);
  const qualifying = /qualifying|shootout/i.test(sessionName || ''), race = /^(race|sprint)$/i.test(sessionName || '');
  const set = (lap, kind) => roles.set(lap.lap, {kind, label: LAP_ROLES[kind][0], reason: LAP_ROLES[kind][1]});
  const flagged = lap => /[2-7]/.test(String(lap.track_status || ''));
  const finite = value => Number.isFinite(value) && value > 0;
  // Best time and first sector per phase, from laps that were not out-laps, under a flag or deleted.
  const bests = new Map();
  for (const lap of ordered) {
    if (lap.out_lap || lap.deleted || flagged(lap)) continue;
    const best = bests.get(lap.phase || '') || {time: Infinity, s1: Infinity};
    if (finite(lap.time)) best.time = Math.min(best.time, lap.time);
    if (finite(lap.s1)) best.s1 = Math.min(best.s1, lap.s1);
    bests.set(lap.phase || '', best);
  }
  const runs = [];
  for (const lap of ordered) {
    if (lap.out_lap || !runs.length) runs.push([]);
    runs.at(-1).push(lap);
  }
  runs.forEach((run, index) => {
    const followed = index < runs.length - 1;
    const pace = lap => {
      const best = bests.get(lap.phase || '');
      if (!best) return 'slow';
      if (finite(lap.time) && lap.time <= best.time * PUSH_PACE) return 'push';
      return finite(lap.s1) && lap.s1 <= best.s1 * PUSH_SECTOR ? 'abort' : 'slow';
    };
    const middle = run.filter(lap => !lap.out_lap);
    const attempts = qualifying ? middle.map((lap, at) => pace(lap) === 'slow' ? -1 : at).filter(at => at >= 0) : [];
    const first = attempts[0], last = attempts.at(-1);
    middle.forEach((lap, at) => {
      const final = lap === run.at(-1);
      const kind = qualifying ? pace(lap) : 'slow';
      if (kind !== 'slow') return set(lap, kind);
      // A race ends on the line, not in the pits, so its last lap is an in-lap only if the timing says so.
      if (final && (followed || (race ? lap.in_lap : true))) return set(lap, 'in');
      if (!qualifying) return;
      if (flagged(lap)) return set(lap, 'flag');
      set(lap, first === undefined || at < first ? 'warm' : at > last ? 'cool' : 'prep');
    });
    const out = run[0];
    if (out?.out_lap) set(out, run.length === 1 && followed ? 'inOut' : 'out');
  });
  return roles;
}

function toggleLoadedLap(code, lapNum) {
  const lapObj = realDrivers.get(code)?.laps?.find(item => item.lap === lapNum);
  if (!lapObj || (!Number.isFinite(lapObj.time) && !lapObj.in_lap && !lapObj.out_lap)) return;
  const index = loaded.findIndex(item => item.code === code && item.lap === lapNum);
  if (index === -1) {
    loaded.push({ code, lap: lapNum, time: lapObj.out_lap ? null : lapObj.time, real: lapObj });
    mapView = 'comparison';
  } else {
    loaded.splice(index, 1);
  }
  renderAll();
  renderStints();
}

function renderStints() {
  const root = $('#stintPanels');
  const actions = $('#lapWorkspaceActions');
  if (!selected.length) {
    setLapSelectionExpanded(true);
    actions.replaceChildren();
    root.innerHTML = '<span class="section-empty">Select a driver to inspect their runs and laps.</span>';
    return;
  }

  const isAllFastestLoaded = selected.every(code => {
    const fastest = fastestTimedLap(realDrivers.get(code));
    return fastest && loaded.some(item => item.code === code && item.lap === fastest.lap);
  });

  const toolbar = `
    <div class="run-toolbar">
      <span><b>${selected.length}</b> ${selected.length === 1 ? 'driver' : 'drivers'} selected</span>
      <button type="button" id="compareAllFastest" data-motion-key="compare-fastest" class="compare-all-btn ${isAllFastestLoaded ? 'selected' : ''}" aria-pressed="${isAllFastestLoaded}" title="Add the fastest timed lap for every selected driver"><span>Compare fastest</span></button>
    </div>
  `;

  const cards = selected.map(code => {
    const driver = realDrivers.get(code);
    const display = drivers.find(item => item[0] === code);
    if (!driver || !display) return '';
    const teamColor = display[3] || '#777777';
    if (!driver.laps?.length) {
      return `<article class="driver-run-card" data-motion-key="run-card-${code}" style="--team:${teamColor}"><header class="run-card-header"><div class="run-driver">${teamLogoMarkup(display[4])}<div class="run-driver-copy"><h3>${escapeUI(naturalDriverName(driver.name))}</h3><small>${code}</small></div></div></header><p class="section-empty">No laps in this session.</p></article>`;
    }

    const timedLaps = driver.laps.filter(lap => Number.isFinite(lap.time) && lap.time > 0 && !lap.in_lap && !lap.out_lap);
    const fastest = fastestTimedLap(driver);
    const fastestLoaded = fastest && loaded.some(item => item.code === code && item.lap === fastest.lap);
    const hasQualifyingPhases = /^(Qualifying|Q|Sprint Qualifying|Sprint Shootout|SQ)$/i.test(loadedSessionName)
      || driver.laps.some(lap => /^Q[1-3]$/.test(lap.phase || ''));
    const phaseFor = lap => /^Q[1-3]$/.test(lap.phase || '') ? lap.phase : 'Unassigned';
    const groupIds = hasQualifyingPhases
      ? ['Q1', 'Q2', 'Q3', 'Unassigned'].filter(phase => driver.laps.some(lap => phaseFor(lap) === phase))
      : [...new Set(driver.laps.map(lap => String(lap.stint)))];
    const active = groupIds.includes(String(openStint[code])) ? String(openStint[code]) : groupIds[0];
    const lapsForGroup = id => hasQualifyingPhases
      ? driver.laps.filter(lap => phaseFor(lap) === id)
      : driver.laps.filter(lap => String(lap.stint) === id);
    const activeLaps = lapsForGroup(active);
    const runButtons = groupIds.map(id => {
      const laps = lapsForGroup(id);
      const compounds = [...new Set(laps.map(lap => String(lap.compound || '').toUpperCase()).filter(Boolean))];
      const compoundBadges = compounds.map(compoundBadgeMarkup).join('');
      const runLabel = hasQualifyingPhases ? id : `Stint ${id}`;
      const count = hasQualifyingPhases ? new Set(laps.map(lap => lap.stint)).size : laps.length;
      const countLabel = hasQualifyingPhases ? (count === 1 ? 'run' : 'runs') : (count === 1 ? 'lap' : 'laps');
      return `<button type="button" class="stint run-segment ${id === active ? 'selected' : ''}" aria-pressed="${id === active}" aria-label="Show ${escapeUI(runLabel)} laps for ${code}" style="--team:${teamColor}" data-motion-key="run-${code}-${id}" data-code="${code}" data-stint="${id}"><strong>${runLabel}</strong><small><span class="run-compounds">${compoundBadges}</span>${count} ${countLabel}</small><span class="run-choice-indicator" aria-hidden="true">${id === active ? '✓' : '›'}</span></button>`;
    }).join('');
    const qualifyingRuns = [...new Set(activeLaps.map(lap => lap.stint))];
    const roles = lapRoles(driver.laps, loadedSessionName);
    const lapButtons = activeLaps.map(lap => {
      const isLoaded = loaded.some(item => item.code === code && item.lap === lap.lap);
      const flag = `L${lap.lap}`;
      const role = roles.get(lap.lap);
      const classes = ['lap', 'lap-chip', ['in', 'out', 'inOut'].includes(role?.kind) ? 'in-out' : '', ['warm', 'prep', 'cool', 'flag'].includes(role?.kind) ? 'is-preparation' : '', role?.kind === 'push' ? 'is-push' : '', role?.kind === 'abort' ? 'is-abort' : '', isLoaded ? 'selected' : ''].filter(Boolean).join(' ');
      const displayTime = Number.isFinite(lap.display_time) ? lap.display_time : lap.time;
      const estimated = lap.display_time_estimated === true;
      const duration = Number.isFinite(displayTime) ? `${estimated ? '~' : ''}${time(displayTime)}` : '&mdash;';
      const selectable = Number.isFinite(lap.time) || lap.in_lap || lap.out_lap;
      const context = role?.label || '';
      const neutralised = String(lap.track_status || '').includes('4') ? 'SC'
        : String(lap.track_status || '').includes('6') ? 'VSC' : '';
      const title = [role?.reason, neutralised ? `${neutralised} lap; time is not representative of racing pace` : '',
        !Number.isFinite(displayTime) ? 'No lap time published by the timing feeds: normal for a lap that starts or ends in the pits.' : ''].filter(Boolean).join(' ');
      const age = Number.isFinite(lap.tyre_life) && lap.tyre_life >= 1 ? Math.round(lap.tyre_life) : null;
      // Practice and race stints: the feed often has no tyre age, so count the laps run in this stint, this one included. A set can have been
      // used before the stint began, so a counted age is shown with "~" and says so on hover.
      const counted = activeLaps.findIndex(item => item.lap === lap.lap) + 1;
      const tyreDetail = hasQualifyingPhases ? `<small class="lap-tyre-age" title="Tyre age: ${age === null ? 'unknown' : `${age} ${age === 1 ? 'lap' : 'laps'}`}">Run ${qualifyingRuns.indexOf(lap.stint) + 1} Lap ${activeLaps.filter(item => item.stint === lap.stint).indexOf(lap) + 1}</small>`
        : age !== null ? `<small class="lap-tyre-age">Tyre age ${age} ${age === 1 ? 'lap' : 'laps'}</small>`
        : counted ? `<small class="lap-tyre-age" title="Laps run in this stint. The tyres may have been used before it began.">Tyre age ~${counted} ${counted === 1 ? 'lap' : 'laps'}</small>` : '';
      return `<button class="${classes}" aria-pressed="${isLoaded}" style="--team:${teamColor}" data-motion-key="lap-${code}-${lap.lap}" data-code="${code}" data-lap="${lap.lap}" ${selectable ? '' : 'disabled'} title="${escapeUI(title)}"><span class="lap-token">${flag}${context ? ` <b class="lap-state">${context}</b>` : ''}${neutralised ? ` <b class="lap-state">${neutralised}</b>` : ''}</span><span class="lap-clock">${duration}</span>${compoundBadgeMarkup(lap.compound)}${tyreDetail}</button>`;
    }).join('');
    const groupLabel = hasQualifyingPhases ? active : `Stint ${active}`;

    return `
      <article class="driver-run-card" data-motion-key="run-card-${code}" style="--team:${teamColor}">
        <header class="run-card-header">
          <div class="run-driver">${teamLogoMarkup(display[4])}<div class="run-driver-copy"><h3>${escapeUI(naturalDriverName(driver.name))}</h3><small>${code} · ${timedLaps.length} timed laps</small></div></div>
          ${fastest ? `<button class="fastest-lap-pick ${fastestLoaded ? 'selected' : ''}" data-motion-key="fastest-${code}" data-code="${code}" data-lap="${fastest.lap}" title="Add or remove this fastest lap"><span>Fastest</span><strong>${time(fastest.time)}</strong></button>` : ''}
        </header>
        <div class="run-section-label"><span>${hasQualifyingPhases ? 'Qualifying phases' : 'Runs'}</span></div>
        <div class="run-segments" ${hasQualifyingPhases ? 'data-qualifying-phases' : ''} style="--run-count:${Math.min(groupIds.length,3)}" role="group" aria-label="${code} runs">${runButtons}</div>
        <div class="lap-group-header"><span>${groupLabel} laps</span>${hasQualifyingPhases ? '' : `<small>${activeLaps.length} available</small>`}</div>
        <div class="lap-grid">${lapButtons}</div>
      </article>
    `;
  }).join('');

  replaceUI(actions, toolbar);
  replaceUI(root, cards);

  $('#compareAllFastest').onclick = () => {
    const fastestLaps = selected.map(code => ({ code, lap: fastestTimedLap(realDrivers.get(code)) })).filter(item => item.lap);
    if (isAllFastestLoaded) {
      loaded = loaded.filter(item => !fastestLaps.some(target => target.code === item.code && target.lap.lap === item.lap));
    } else {
      mapView = 'comparison';
      fastestLaps.forEach(target => {
        if (!loaded.some(item => item.code === target.code && item.lap === target.lap.lap)) {
          loaded.push({ code: target.code, lap: target.lap.lap, time: target.lap.time, real: target.lap });
        }
      });
    }
    renderAll();
    renderStints();
    // The chooser stays open after comparing; people often add or swap laps.
  };

  root.querySelectorAll('.stint').forEach(button => {
    button.onclick = () => {
      openStint[button.dataset.code] = button.dataset.stint;
      renderStints();
    };
  });
  root.querySelectorAll('.lap:not(:disabled), .fastest-lap-pick').forEach(button => {
    button.onclick = () => toggleLoadedLap(button.dataset.code, +button.dataset.lap);
  });
}

function renderLoaded() {
  const root = $('#loadedLaps');
  const clear = $('#clearComparison');
  if (clear) clear.hidden = loaded.length < 2;
  const pitNotice = $('#pitLapNotice');
  if (pitNotice) pitNotice.hidden = !loaded.some(item => item.real?.in_lap || item.real?.out_lap);
  if (!loaded.length) {
    root.innerHTML = '<span class="section-empty">No laps loaded. Click laps in the panel to compare.</span>';
    return;
  }
  
  replaceUI(root, loaded.map((item, index) => `
    <div class="loaded-lap-pill ${index === 0 ? 'reference' : ''}" style="--team:${getLapColor(item)}" data-motion-key="comparison-${item.code}-${item.lap}" data-index="${index}">
      <button class="loaded-lap-main ${index === 0 ? 'reference' : ''}" data-motion-key="reference-${item.code}-${item.lap}" aria-pressed="${index === 0}" aria-label="Use ${item.code} lap ${item.lap} as reference"><b>${item.code}</b><span>L${item.lap}${item.real?.in_lap && item.real?.out_lap ? ' IN/OUT' : item.real?.out_lap ? ' OUT' : item.real?.in_lap ? ' IN' : ''}</span><strong>${item.real?.display_time_estimated ? '~' : ''}${time(Number.isFinite(item.real?.display_time) ? item.real.display_time : item.time)}</strong></button><button class="remove" data-motion-key="remove-${item.code}-${item.lap}" data-remove="${index}" aria-label="Remove ${item.code} lap ${item.lap}">×</button>
    </div>`).join(''));
  
  root.querySelectorAll('.loaded-lap-pill').forEach(p => {
    p.onclick = e => {
      const idx = +p.dataset.index;
      const remove = e.target.closest('[data-remove]');
      if (remove) {
        const removeIdx = +remove.dataset.remove;
        loaded.splice(removeIdx, 1);
      } else {
        loaded.unshift(loaded.splice(idx, 1)[0]);
      }
      renderAll();
      renderStints();
    };
  });
}

function renderSectors() {
  if (!loaded.length) {
    $('#sectorRows').innerHTML = '';
    return;
  }
  
  const ref = loaded[0];
  const sectorFields = ['s1', 's2', 's3'];
  const finiteMinimum = values => {
    const finite = values.filter(value => Number.isFinite(value) && value > 0);
    return finite.length ? Math.min(...finite) : null;
  };
  const personalBests = new Map([...realDrivers.entries()].map(([code, driver]) => [
    code,
    sectorFields.map(field => finiteMinimum((driver.laps || []).map(lap => lap[field]))),
  ]));
  const sessionBests = sectorFields.map((field, sectorIndex) => finiteMinimum(
    [...personalBests.values()].map(best => best[sectorIndex])
  ));
  const sectorState = (code, sectorIndex, value) => {
    if (!Number.isFinite(value)) return { className: 'is-unset', label: 'No sector time' };
    const tolerance = .0005;
    if (Number.isFinite(sessionBests[sectorIndex]) && Math.abs(value - sessionBests[sectorIndex]) <= tolerance) {
      return { className: 'is-session-best', label: 'Session best' };
    }
    const personal = personalBests.get(code)?.[sectorIndex];
    if (Number.isFinite(personal) && Math.abs(value - personal) <= tolerance) {
      return { className: 'is-personal-best', label: 'Personal best' };
    }
    return { className: 'is-complete', label: 'Completed sector' };
  };
  
  const deltaBadge = (value, reference) => {
    if (!Number.isFinite(value) || !Number.isFinite(reference)) return '';
    const delta = value - reference;
    const className = delta >= 0 ? 'is-slower' : 'is-faster';
    return `<em class="summary-delta ${className}">${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(3)}s</em>`;
  };

  const windCardinal = degrees => {
    if (!Number.isFinite(degrees)) return '';
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return directions[Math.round(((degrees % 360) + 360) % 360 / 45) % directions.length];
  };
  const conditionCell = (icon, label, value) => `
    <span class="summary-condition"><i aria-hidden="true">${icon}</i><span><small>${label}</small><strong>${value}</strong></span></span>`;
  
  const root = $('#sectorRows');
  replaceUI(root, loaded.map((item, i) => {
    const lap = item.real || {};
    const refLap = ref.real || {};
    const color = getLapColor(item);
    const sectors = sectorFields.map((field, sectorIndex) => ({
      label: `S${sectorIndex + 1}`,
      value: lap[field],
      reference: refLap[field],
      state: sectorState(item.code, sectorIndex, lap[field]),
    }));
    const conditions = lap.conditions || {};
    const direction = windCardinal(conditions.wind_direction);
    const conditionValues = [
      conditionCell('🌤️', 'Air', Number.isFinite(conditions.air_temperature) ? `${conditions.air_temperature.toFixed(1)}°C` : '—'),
      conditionCell('🌡️', 'Track', Number.isFinite(conditions.track_temperature) ? `${conditions.track_temperature.toFixed(1)}°C` : '—'),
      conditionCell('🚩', 'Wind', Number.isFinite(conditions.wind_speed) ? `${conditions.wind_speed.toFixed(1)} m/s${direction ? ` ${direction}` : ''}` : '—'),
      conditionCell('🌧️', 'Rain', conditions.rainfall === null || conditions.rainfall === undefined ? '—' : (conditions.rainfall ? 'Yes' : 'No')),
    ];
    const conditionsHtml = `<div class="summary-conditions">${conditionValues.join('')}</div>`;
    const compound = getCompoundCode(lap.compound || 'UNKNOWN', nominatedCompounds);
    const compoundClass = getCompoundToneClass(lap.compound || 'UNKNOWN');
    const tyreAge = Number.isFinite(lap.tyre_life) ? Math.max(1, Math.round(lap.tyre_life)) : null;
    const tyreLife = tyreAge === null ? '' : `${tyreAge} lap${tyreAge === 1 ? '' : 's'}`;
    return `
      <article class="lap-summary-card has-conditions" data-motion-key="summary-${item.code}-${item.lap}" style="--team:${color}">
        <header>
          <span class="summary-driver" title="${item.code} · lap ${item.lap}">${teamLogoMarkup(realDrivers.get(item.code)?.team || drivers.find(driver=>driver[0]===item.code)?.[4])}<b>${item.code}</b><span class="summary-lap-label">Lap ${item.lap}</span>${i === 0 ? '<em>REF</em>' : ''}</span>
          <span class="summary-header-actions">
            <span class="summary-tyre ${compoundClass}">${compoundBadgeMarkup(lap.compound)}<span class="summary-tyre-copy"><b>${compound}</b>${tyreLife ? `<small>${tyreLife}</small>` : ''}</span></span>
            <span class="summary-lap-time"><small>${lap.in_lap && lap.out_lap ? 'PIT IN/OUT' : lap.out_lap ? 'PIT EXIT → LINE' : lap.in_lap ? 'PIT-IN LAP' : 'LAP'}</small>${i === 0 || lap.out_lap || ref.real?.out_lap ? '' : deltaBadge(item.time, ref.time)}<strong>${lap.display_time_estimated ? '~' : ''}${time(Number.isFinite(lap.display_time) ? lap.display_time : item.time)}</strong></span>
          </span>
        </header>
        <div class="summary-sectors">${sectors.map(({ label, value, reference, state }) => `
          <span class="sector-cell ${state.className}" title="${label} · ${state.label}">
            <span class="sector-cell-value"><small>${label}</small><span class="sector-measurements"><span class="sector-delta-slot">${i === 0 ? '' : deltaBadge(value, reference)}</span><strong>${Number.isFinite(value) ? `${value.toFixed(3)}s` : '—'}</strong></span></span>
          </span>`).join('')}
        </div>
        ${conditionsHtml}
      </article>
    `;
  }).join(''));

}
