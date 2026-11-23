import {useEffect,useState} from 'react';
import {LaunchProfile} from '../components/LaunchProfile';
import {DataTable} from '../components/DataTable';
import {TeamLabel} from '../components/TeamLabel';
import {median} from '../../performance-format.js';

type Race = {year:number; event:string; standing:Launch[]; rolling:{driver:string;team:string;release:number;speeds:number[]}[]};
let request: Promise<Race[]> | undefined;
function loadStarts(){
  return request ??= fetch('assets/data/start-execution.json',{cache:'no-cache'}).then(async r=>{
    if(!r.ok)throw Error('unavailable');
    const data=await r.json();
    if(data.method!=='start-execution-v1'||!Array.isArray(data.races))throw Error('unsupported');
    return data.races as Race[];
  }).catch(error=>{request=undefined;throw error;});
}

type Mark = {seconds: number; kmh: number; packet_s: number};
type Launch = {driver: string; team: string; grid: number; marks: Record<string, Mark>};
export function StartsView({year, events}: {year: number; events: string[]}) {
  const [all,setAll]=useState<Race[]|null>(null);
  const [attempt,setAttempt]=useState(0);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    let active=true;
    setFailed(false);
    loadStarts().then(rows=>{if(active)setAll(rows);},()=>{if(active)setFailed(true);});
    return ()=>{active=false;};
  },[attempt]);
  const races = (all||[]).filter(r => r.year === Number(year) && events.includes(r.event));
  const covered = (all||[]).filter(r => r.year === Number(year) && r.standing.length);
  const [event, setEvent] = useState('');
  const race = races.find(r => r.event === event) || races[0];
  const [rolling, setRolling] = useState(false);
  const [teams, setTeams] = useState(false);
  const [speed, setSpeed] = useState(false);
  return <section className="start-performance">
    <header className="metric-heading">
      <div className="metric-heading-copy">
        <h2>Starts &amp; restarts</h2>
        {race && <p className="start-context">{race.event} · {race.year}</p>}
      </div>
      {races.length > 1 && <label>Circuit <select value={race.event} onChange={e => setEvent(e.target.value)}>{races.map(r => <option key={r.event}>{r.event}</option>)}</select></label>}
    </header>
    {failed ? <p className="performance-quality-status" role="status">Start measurements could not load. <button type="button" onClick={()=>setAttempt(attempt+1)}>Retry</button></p> :
    !all ? <p className="performance-quality-status" role="status">Loading start measurements…</p> : !race ? <p className="performance-quality-status">
      {covered.length
        ? `No verified launches for the selected weekends. Choose ${covered.map(r => r.event).join(', ')} in the weekend selector.`
        : `No verified launches for ${year} yet.`}
    </p> : <>
      <div className="start-type">
        <div className="performance-scope-toggle" role="group" aria-label="Start type">
          <button type="button" aria-pressed={!rolling} onClick={() => setRolling(false)}>Standing start</button>
          <button type="button" aria-pressed={rolling} onClick={() => setRolling(true)}>Safety-car releases</button>
        </div>
      </div>
      {rolling ? race.rolling.length === 0
        ? <p className="performance-quality-status">No verified safety-car release measurements for this race.</p>
        : <section className="start-table">
        <div className="start-section-heading">
          <h3 className="perf-chart-heading">Speed around green</h3>
          <span className="start-context">km/h</span>
        </div>
        <p className="start-context">Track position and the leader’s pace affect each reading.</p>
        <DataTable headers={['Driver','Release','At green','+2 s','+4 s']} rows={race.rolling.map(r => [
          <><TeamLabel team={{displayName:r.driver,logoTeam:r.team}}/><small className="start-release-team">{r.team}</small></>,
          r.release,...r.speeds
        ])}/>
      </section> : <>
        <div className="start-comparison">
          <LaunchProfile starts={race.standing}/>
          <section className="start-table start-table-standing">
            <div className="start-section-heading">
              <h3 className="perf-chart-heading">Launch comparison</h3>
              <span className="start-context">{race.standing.length} launches · {speed ? 'km/h' : 's'}</span>
            </div>
            <div className="start-table-controls">
              <div className="performance-scope-toggle" role="group" aria-label="Comparison subject">
                <button type="button" aria-pressed={!teams} onClick={() => setTeams(false)}>Drivers</button>
                <button type="button" aria-pressed={teams} onClick={() => setTeams(true)}>Teams</button>
              </div>
              <div className="performance-scope-toggle" role="group" aria-label="Launch measurement">
                <button type="button" aria-pressed={!speed} onClick={() => setSpeed(false)}>Time to distance</button>
                <button type="button" aria-pressed={speed} onClick={() => setSpeed(true)}>Speed at distance</button>
              </div>
            </div>
            <LaunchTable starts={race.standing} teams={teams} speed={speed}/>
          </section>
        </div>
        <details className="start-method">
          <summary>Measurement limits</summary>
          <p>Distances are measured from each driver’s grid slot. Checkpoints appear only where the trace reaches them before braking, stopping or a packet gap over 0.6 s.</p>
          <p>Timing starts halfway between the last stopped packet and the first moving one. The longest accepted packet gap here was {Math.max(0,...race.standing.flatMap(r=>Object.values(r.marks).map(m=>m.packet_s))).toFixed(1)} s.</p>
          <p>Team values are medians of the drivers measured at each distance. Lights-out reaction, clutch performance and wheelspin are unresolved.</p>
        </details>
      </>}
    </>}
  </section>;
}

function LaunchTable({starts,teams,speed}: {starts: Launch[]; teams: boolean; speed: boolean}) {
  const distances = [...new Set(starts.flatMap(r => Object.keys(r.marks).map(Number)))].filter(d=>d!==15).sort((a,b) => a-b);
  const groups = new Map<string,Launch[]>();
  for(const r of [...starts].sort((a,b) => a.grid-b.grid)){
    const key = teams ? r.team : r.driver;
    groups.set(key,[...(groups.get(key) || []),r]);
  }
  const rows = Array.from(groups, ([name,group]) => [
    <TeamLabel team={{displayName:name,logoTeam:group[0].team}}/>,teams ? group.length : 'P'+group[0].grid,
    ...distances.map(d => {
      const values = group.map(r => r.marks[d]).filter(Boolean);
      if (!values.length) return '—';
      const value = speed ? median(values.map(v => v.kmh)).toFixed(0) : median(values.map(v => v.seconds)).toFixed(1);
      return <>{value}{teams && values.length<group.length && <small className="start-partial" title={`${values.length} of ${group.length} drivers measured`}> {values.length}/{group.length}</small>}</>;
    })]);
  return <DataTable headers={[teams?'Team':'Driver',teams?'Starts':'Grid',...distances.map(d => d+' m')]} rows={rows}/>;
}
