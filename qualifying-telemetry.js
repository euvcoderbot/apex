// Braking is an exact-fastest-lap comparison, not a repeat-lap estimate.
// Keep this input identical for browser requests and verified cache capture.
export function fastestTeamTelemetrySelections(teams) {
  return (teams||[]).flatMap(team=>{
    const lap=team.lap;
    if(!lap||!Number.isFinite(lap.time)||!Number.isFinite(lap.start)||!Number.isFinite(lap.end))return [];
    return [{team:team.team,team_name:team.team,driver_number:lap.number,driver:lap.driver,lap:lap.lap,
      start:lap.start,end:lap.end,time:lap.time,sectors:lap.sectors,compound:lap.compound,phase:lap.phase,
      speed_st:lap.speed_st,speed_fl:lap.speed_fl,
      qualifying_best_time:lap.time,qualifying_best_driver:lap.driver,qualifying_best_lap:lap.lap}];
  });
}

// Keep physical laps distinct in the request and group them by the displayed
// entrant in the backend. The speed-batch estimator accepts up to two laps
// per entrant. Teams use one lap from each driver when both are available.
export function repeatQualifyingTelemetrySelections(teams, subject) {
  const windows = [];
  const expected = new Set();
  let repeats = 0;
  for (const team of teams || []) {
    if (subject === 'team' && Number.isFinite(team.lap?.time)) expected.add(team.team);
    if (subject === 'driver') {
      for (const lap of team.phase_details || []) if (lap.driver && Number.isFinite(lap.time)) expected.add(lap.driver);
    }
    const drivers = new Map(), seen = new Set();
    const candidates = [...(team.telemetry_candidates || []), ...(team.phase_details || [])]
      .filter(lap => lap.driver && /^\d+$/.test(String(lap.number)) && Number.isInteger(lap.lap)
        && [lap.time, lap.start, lap.end].every(Number.isFinite)
        && lap.rain === false && /^(SOFT|MEDIUM|HARD|C[0-6])$/i.test(lap.compound || '')
        && lap.accurate !== false && !lap.deleted && !lap.pit)
      .sort((a,b) => a.time-b.time || a.end-b.end || String(a.number).localeCompare(String(b.number)));
    for (const lap of candidates) {
      const key = lap.number+':'+lap.lap;
      if (seen.has(key)) continue;
      seen.add(key);
      const group = drivers.get(lap.driver) || [];
      if (!group.length || (lap.compound === group[0].compound && lap.time <= group[0].time*1.01)) group.push(lap);
      drivers.set(lap.driver, group);
    }
    const groups = subject === 'driver' ? [...drivers.values()].map(laps => [laps[0].driver, laps.slice(0,2)])
      : [[team.team, [...drivers.values()].map(laps => laps[0]).slice(0,2)]];
    for (const [entrant, laps] of groups) {
      if (laps.length > 1) repeats++;
      for (const lap of laps) windows.push({
        team: 'repeat:'+lap.number+':'+lap.lap, team_name: entrant, driver_number: lap.number,
        driver: lap.driver, lap: lap.lap, time: lap.time, start: lap.start, end: lap.end,
        phase: lap.phase, compound: lap.compound
      });
    }
  }
  const measured = new Set(windows.map(window => window.team_name));
  return repeats >= 3 && [...expected].every(name => measured.has(name)) ? windows : [];
}

export function speedBatchPath(year, gp, windows) {
  return '/api/performance/trace-batch?'+new URLSearchParams({year,gp,windows:JSON.stringify(windows),measures:'speed'});
}
