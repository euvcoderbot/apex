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
