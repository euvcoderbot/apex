import {Fragment} from 'react';
import {BarChart, type BarChartOptions} from '../components/BarChart';
import {Card} from '../components/Card';
import {DataTable} from '../components/DataTable';
import {TeamLabel, type TeamLike} from '../components/TeamLabel';

type Team = TeamLike & {team: string};
export type SpeedChart = {title: string; rows: (Team & Record<string, unknown>)[]; options: BarChartOptions} | {title: string; empty: string};
type EventTable = {subject: string; labels: string[]; rows: {event: string; team: Team; values: string[]}[]};
type Phases = {several: boolean; subject: string; sections: {label: string; rows: {team: Team; braking: string; mid: string; exit: string; total: string; gps: number}[]}[]};
type Corners = {single: string | null; subject: string; events: {name: string; rows: {corner: {name: string; detail: string} | null; team: Team;
  delta: string; braking: string; mid: string; exit: string; speeds: string; raw: string; sensitivity: string; gap: string}[]}[]};
type Straights = {single: string | null; subject: string; events: {name: string; rows: {straight: {name: string; detail: string} | null; team: Team;
  delta: string; speeds: string; gap: string}[]}[]};
type Basis = 'lap' | 'section' | null;
export type SpeedViewProps = {
  status: {running: boolean; loaded: number; total: number};
  failures: {name: string; error: string}[]; retry: number;
} & (
  | {metric: 'corners'; basis?: Basis; note: string; charts: SpeedChart[]; driverCharts?: SpeedChart[]; phases: Phases | null; corners: Corners | null; events: EventTable;
     traction: {lowConfidence: boolean; chart: SpeedChart; driverChart?: SpeedChart; events: EventTable}}
  | {metric: 'straight'; basis?: Basis; straights?: Straights | null; pill: string; pills: {key: string; label: string; hint: string}[]; note: string; chart: SpeedChart; driverChart?: SpeedChart; events: EventTable}
  | {metric: 'braking'; note: string; lowConfidence: boolean; chart: SpeedChart; driverChart?: SpeedChart; events: EventTable});

function Chart({chart}: {chart: SpeedChart}) {
  // While GPs are still loading an empty chart is pending, not a missing measurement.
  if ('empty' in chart) return (
    <div className="performance-chart-card"><h4 className="perf-chart-heading">{chart.title}</h4><p className="performance-quality-status">{chart.empty}</p></div>
  );
  return <BarChart rows={chart.rows} options={chart.options} />;
}

/** The same measurement for teams and for drivers, side by side. */
function ChartPair({chart, driverChart}: {chart: SpeedChart; driverChart?: SpeedChart}) {
  if (!driverChart) return <Chart chart={chart} />;
  return <div className="subject-pair"><Chart chart={chart} /><Chart chart={driverChart} /></div>;
}

function EventValues({table}: {table: EventTable}) {
  return (
    <details className="performance-evidence">
      <summary>Values by GP · relative to each GP's median {table.subject}</summary>
      <DataTable headers={['Grand Prix', table.subject === 'driver' ? 'Driver' : 'Team', ...table.labels]}
        rows={table.rows.map(r => [r.event, <TeamLabel team={r.team} />, ...r.values])} />
    </details>
  );
}

const LOW_CONFIDENCE = 'Low confidence: in validation this measurement carried little car-specific signal from the public ~4 Hz feed. Treat it as evidence, not a ranking.';

function PhaseSplit({phases: p}: {phases: Phases}) {
  return (
    <details className="performance-evidence">
      <summary>Where the time goes · braking, mid-corner, exit{p.several ? ' · seconds per GP, averaged' : ''}</summary>
      <p className="performance-quality-status">Common-distance estimates against the median {p.subject}. Braking runs to the field's brake-release line, mid-corner to the last apex, exit to the end line. Only speed inside these lines counts; there are no entry corrections or credits on the next straight. These phases include driver, setup, power and entry context, not isolated grip.</p>
      {p.sections.map(s => (
        <Fragment key={s.label}>
          <h4 className="perf-chart-heading">{s.label} corners</h4>
          <DataTable headers={[p.subject === 'driver' ? 'Driver' : 'Team', 'Braking', 'Mid-corner', 'Exit', 'Total', ...(p.several ? ['GPs'] : [])]}
            rows={s.rows.map(r => [<TeamLabel team={r.team} />, r.braking, r.mid, r.exit, r.total, ...(p.several ? [String(r.gps)] : [])])} />
        </Fragment>
      ))}
    </details>
  );
}

function CornerByCorner({corners: c}: {corners: Corners}) {
  const tables = c.events.map(e => {
    const t = <DataTable key={e.name} headers={['Corner', c.subject === 'driver' ? 'Driver' : 'Team', 'Trace Δ to median', 'Braking', 'Mid-corner', 'Exit', 'In / min / out km/h', 'Timestamp Δ', '±5 m sensitivity', 'Max source gap']}
      rows={e.rows.map(r => [r.corner ? <><strong>{r.corner.name}</strong><br /><small>{r.corner.detail}</small></> : '',
        <TeamLabel team={r.team} />, r.delta, r.braking, r.mid, r.exit, r.speeds, r.raw, r.sensitivity, r.gap])} />;
    return c.single ? t : <details key={e.name} className="performance-evidence"><summary>{e.name}</summary>{t}</details>;
  });
  return (
    <details className="performance-evidence">
      <summary>Corner by corner{c.single ? ' · ' + c.single : ''}</summary>
      <p className="performance-quality-status">Speed is integrated over the same path from 10 m before the earliest braking point to 10 m after the last full-throttle return; overlapping turns form one complex. Timestamp Δ is a separate diagnostic affected by GPS path registration. ±5 m sensitivity shifts each car's registration; it is a scenario, not a confidence interval. Gaps over 0.6 s are provisional; over 1.5 s are excluded. Missing corners are never extrapolated to a complete band. Flat high-load bends compare lifting losses only; staying flat is not evidence of superior grip.</p>
      {tables}
    </details>
  );
}

// Several GPs: a gap as a share of the lap (the qualifying gap's scale) or of
// the section's own time (how much slower through those corners or straights).
function GapBasis({basis, section}: {basis: Basis | undefined; section: string}) {
  if (!basis) return null;
  return (
    <div className="performance-scope-toggle" role="group" aria-label="Gap basis">
      <button type="button" data-gap-basis="lap" aria-pressed={basis === 'lap'} title="Time lost as a share of the lap, the same scale as the qualifying gap">% of lap</button>
      <button type="button" data-gap-basis="section" aria-pressed={basis === 'section'} title={`Time lost as a share of the time spent in these ${section}`}>% of {section}</button>
    </div>
  );
}

function StraightByStraight({straights: s}: {straights: Straights}) {
  const tables = s.events.map(e => {
    const t = <DataTable key={e.name} headers={['Straight', s.subject === 'driver' ? 'Driver' : 'Team', 'Δ to median', 'In → out km/h', 'Max source gap']}
      rows={e.rows.map(r => [r.straight ? <><strong>{r.straight.name}</strong><br /><small>{r.straight.detail}</small></> : '',
        <TeamLabel team={r.team} />, r.delta, r.speeds, r.gap])} />;
    return s.single ? t : <details key={e.name} className="performance-evidence"><summary>{e.name}</summary>{t}</details>;
  });
  return (
    <details className="performance-evidence">
      <summary>Straight by straight{s.single ? ' · ' + s.single : ''}</summary>
      <p className="performance-quality-status">Each straight runs from the end of one timed corner to the start of the next, as in session analysis; the main straight crosses the timing line. Speed is integrated over the same distance for every car. Entry speed comes from the previous corner, so a better exit shows here too.</p>
      {tables}
    </details>
  );
}

/** Car performance · Cornering, Straight line and Braking (speed-domain measurements). */
export function SpeedView(p: SpeedViewProps) {
  const head = (
    <>
      <p className={`performance-quality-status${p.status.running ? ' is-loading' : ''}`} role="status">
        {p.status.running
          ? `Loading qualifying telemetry · ${p.status.loaded} of ${p.status.total} GPs measured. Lap times are loaded; fetching and processing the fastest laps. The first load can take a few minutes.`
          : `${p.status.loaded} of ${p.status.total} GPs measured. Season values weight each GP equally; entrants measured in fewer than half of them stay unranked.`}
      </p>
      {p.failures.map(f => <div key={f.name} className="performance-error">{f.name} · {f.error}</div>)}
      {p.retry ? <div className="performance-actions"><button type="button" data-speed-retry="">Retry {p.retry} missing GP{p.retry === 1 ? '' : 's'}</button></div> : null}
    </>
  );
  if (p.metric === 'corners') return (
    <>
      {head}
      <Card title="Cornering" note={p.note}>
        <GapBasis basis={p.basis} section="corners" />
        {p.driverCharts
          ? <><div className="subject-bands">{p.charts.map((c, i) => <Chart key={i} chart={c} />)}</div>
              <div className="subject-bands">{p.driverCharts.map((c, i) => <Chart key={i} chart={c} />)}</div></>
          : p.charts.map((c, i) => <Chart key={i} chart={c} />)}
        {p.phases ? <PhaseSplit phases={p.phases} /> : null}
        {p.corners ? <CornerByCorner corners={p.corners} /> : null}
        <EventValues table={p.events} />
      </Card>
      <Card title="Corner exit traction" note="Acceleration out of slow corners at any throttle position, once a car has gained 30 km/h over its own apex, simulated from 70 to 170 km/h. Seconds per corner exit. Evidence only: in validation it carried little car-specific signal in 2025.">
        {p.traction.lowConfidence ? <p className="performance-quality-status">{LOW_CONFIDENCE}</p> : null}
        <ChartPair chart={p.traction.chart} driverChart={p.traction.driverChart} />
        <EventValues table={p.traction.events} />
      </Card>
    </>
  );
  if (p.metric === 'straight') return (
    <>
      {head}
      <Card title="Straight line" note={p.note}>
        <div className="performance-scope-toggle" role="group" aria-label="Straight-line measure">
          {p.pills.map(x => <button key={x.key} type="button" data-straight-pill={x.key} aria-pressed={x.key === p.pill} title={x.hint}>{x.label}</button>)}
        </div>
        <GapBasis basis={p.basis} section="straights" />
        <ChartPair chart={p.chart} driverChart={p.driverChart} />
        {p.straights ? <StraightByStraight straights={p.straights} /> : null}
        <EventValues table={p.events} />
      </Card>
    </>
  );
  return (
    <>
      {head}
      <Card title="Braking" note={p.note}>
        {p.lowConfidence ? <p className="performance-quality-status">{LOW_CONFIDENCE}</p> : null}
        <ChartPair chart={p.chart} driverChart={p.driverChart} />
        <EventValues table={p.events} />
      </Card>
    </>
  );
}
