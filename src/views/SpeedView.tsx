import {Fragment} from 'react';
import {finite, fmt} from '../../performance-format.js';
import {BarChart, type BarChartOptions} from '../components/BarChart';
import {Card} from '../components/Card';
import {DataTable} from '../components/DataTable';
import {TeamLabel, type TeamLike} from '../components/TeamLabel';

type Team = TeamLike & {team: string};
export type SpeedChart = {title: string; rows: (Team & Record<string, unknown>)[]; options: BarChartOptions; matchedRivals?: boolean} | {title: string; empty: string};
type EventTable = {
  subject: string; labels: string[]; showLapEvidence?: boolean; summary?: string;
  rows: {event: string; team: Team; values: string[]; lapEvidence?: {laps: number; drivers: string[]}}[];
};
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
    <div className="performance-chart-card is-empty"><h4 className="perf-chart-heading">{chart.title}</h4><p className="performance-quality-status">{chart.empty}</p></div>
  );
  return <BarChart rows={chart.rows} options={chart.options} />;
}

/** One row of bands (low, medium, high speed). A row with nothing measured is one quiet line, not three empty cards. */
function Bands({charts, subject}: {charts: SpeedChart[]; subject: string}) {
  const notes = charts.flatMap(c => ('empty' in c ? [c.empty] : []));
  if (notes.length === charts.length) {
    return <p className="subject-band-empty" role="status"><strong>{subject}</strong> · {[...new Set(notes)].join(' ')}</p>;
  }
  // Measured bands share the row between them; a band with nothing measured is a one-line note under the row, so an
  // empty band never takes a chart's space.
  const filled = charts.filter(c => !('empty' in c));
  const empty = charts.filter((c): c is Extract<SpeedChart, {empty: string}> => 'empty' in c);
  return <>
    <div className="subject-bands" data-count={filled.length}>{filled.map((c, i) => <Chart key={i} chart={c} />)}</div>
    {empty.map((c, i) => <p key={i} className="subject-band-empty" role="status"><strong>{c.title}</strong> · {c.empty}</p>)}
  </>;
}

/** Every team across the measured corner-speed bands in one table: its gap to the quickest team in each band (as in the
 *  band charts), shaded by its rank in that band, so one team's profile reads along a row instead of being looked up in
 *  three charts that each sort differently. Ordered by the average rank. */
function CornerProfile({charts}: {charts: SpeedChart[]}) {
  const bands = charts.filter((c): c is Extract<SpeedChart, {rows: unknown}> => !('empty' in c) && c.rows.length > 1);
  if (bands.length < 2) return null;
  const name = (r: Team) => String(r.team || '');
  const columns = bands.map(b => {
    const key = b.options.valueKey || 'value', digits = b.options.digits ?? 3, unit = (b.options.unit || '%').replace(/ of .*$/, '');
    const values = b.rows.filter(r => finite(r[key] as number)).map(r => ({team: r, v: r[key] as number}));
    const best = Math.min(...values.map(x => x.v));
    const ranked = [...values].sort((a, c) => a.v - c.v);
    const cells = new Map(ranked.map((x, i) => [name(x.team), {gap: x.v - best, rank: i + 1}]));
    return {label: (b.options.title || b.title).replace(/ · .*$/, '').replace(/ corners$/i, ''), digits, unit, count: ranked.length, cells};
  });
  const teams = new Map<string, Team>();
  for (const b of bands) for (const r of b.rows) if (!teams.has(name(r))) teams.set(name(r), r);
  const rows = [...teams.values()].map(team => {
    const ranks = columns.map(c => c.cells.get(name(team))?.rank).filter((x): x is number => x != null);
    return {team, mean: ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : 99};
  }).sort((a, b) => a.mean - b.mean);
  return (
    <section className="corner-profile">
      <h4 className="perf-chart-heading">Teams across corner speeds</h4>
      <p className="performance-quality-status">Gap to the quickest team in each band. Deeper shading is a better rank in that band; rows are ordered by the average rank.</p>
      <div className="performance-table-wrap" tabIndex={0} role="region" aria-label="Teams across corner speeds">
        <table className="performance-table team-profile-table corner-profile-table">
          <thead><tr><th scope="col">Team</th>{columns.map(c => <th key={c.label} scope="col">{c.label}</th>)}</tr></thead>
          <tbody>{rows.map(({team}) => (
            <tr key={name(team)}><th scope="row"><TeamLabel team={team} /></th>{columns.map(c => {
              const cell = c.cells.get(name(team));
              const heat = cell && c.count > 1 ? (c.count - cell.rank) / (c.count - 1) : 0;
              const text = cell ? (cell.gap <= 0.00001 ? fmt(0, c.digits, c.unit) : `+${fmt(cell.gap, c.digits, c.unit)}`) : '—';
              const reading = `${c.label}: ${cell ? `rank ${cell.rank} of ${c.count} · ${text}` : 'not measured'}`;
              return <td key={c.label} className="profile-rank perf-heat-cell" title={reading} aria-label={reading}>
                <span className="perf-heat-value" style={heat > 0 ? {'--heat': heat.toFixed(3)} as React.CSSProperties : undefined}>{text}</span></td>;
            })}</tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

/** The same measurement for teams and for drivers, side by side. */
function ChartPair({chart, driverChart}: {chart: SpeedChart; driverChart?: SpeedChart}) {
  if (!driverChart) return <Chart chart={chart} />;
  // Nothing measured for teams or drivers: one quiet line instead of two empty cards.
  if ('empty' in chart && 'empty' in driverChart) {
    return <p className="subject-band-empty" role="status"><strong>Teams and drivers</strong> · {[...new Set([chart.empty, driverChart.empty])].join(' ')}</p>;
  }
  // One side measured: its chart takes the full row and the other side is a one-line note under it, not an empty card.
  const lone = 'empty' in chart ? chart : 'empty' in driverChart ? driverChart : null;
  if (lone && 'empty' in lone) {
    const filled = lone === chart ? driverChart : chart;
    return <><div className="subject-pair is-single"><Chart chart={filled} /></div>
      <p className="subject-band-empty" role="status"><strong>{lone.title}</strong> · {lone.empty}</p></>;
  }
  return <div className="subject-pair"><Chart chart={chart} /><Chart chart={driverChart} /></div>;
}

function EvidenceSubject({subject}: {subject: string}) {
  return <div className="performance-scope-toggle" role="group" aria-label="Detailed table subject">
    {['team', 'driver'].map(value => <button key={value} type="button" data-telemetry-subject={value} aria-pressed={subject === value}>{value === 'team' ? 'Teams' : 'Drivers'}</button>)}
  </div>;
}

function EventValues({table}: {table: EventTable}) {
  return (
    <details className="performance-evidence">
      <summary>{table.summary || `Values by GP · relative to each GP's median ${table.subject}`}</summary>
      <EvidenceSubject subject={table.subject} />
      <DataTable headers={['Grand Prix', table.subject === 'driver' ? 'Driver' : 'Team', ...table.labels,
        ...(table.showLapEvidence ? ['Lap evidence'] : [])]}
        rows={table.rows.map(r => [r.event, <TeamLabel team={r.team} />, ...r.values,
          ...(table.showLapEvidence ? [r.lapEvidence ? <><span>{r.lapEvidence.laps} {r.lapEvidence.laps === 1 ? 'lap' : 'laps'}</span>
            {r.lapEvidence.drivers.length > 0 && <small className="performance-lap-drivers">{r.lapEvidence.drivers.join(', ')}</small>}</>
            : 'Single-lap snapshot'] : [])])} />
    </details>
  );
}

const LOW_CONFIDENCE = 'Low confidence: in validation this measurement carried little car-specific signal from the public ~4 Hz feed. Treat it as evidence, not a ranking.';

function PhaseSplit({phases: p}: {phases: Phases}) {
  return (
    <details className="performance-evidence">
      <summary>Where the time goes · braking, mid-corner, exit{p.several ? ' · seconds per GP, averaged' : ''}</summary>
      <EvidenceSubject subject={p.subject} />
      <p className="performance-quality-status">Phase summaries use each entrant’s available GPs. Common-distance estimates against the median {p.subject}. Braking runs to the field's brake-release line, mid-corner to the last apex, exit to the end line. Only speed inside these lines counts; there are no entry corrections or credits on the next straight. These phases include driver, setup, power and entry context, not isolated grip.</p>
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
      <EvidenceSubject subject={c.subject} />
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
      <EvidenceSubject subject={s.subject} />
      <p className="performance-quality-status">Each straight runs from the end of one timed corner to the start of the next, as in session analysis; the main straight crosses the timing line. Speed is integrated over the same distance for every car. Entry speed comes from the previous corner, so a better exit shows here too.</p>
      {tables}
    </details>
  );
}

/** Car performance · Cornering, Straight line and Braking (speed-domain measurements). */
export function SpeedView(p: SpeedViewProps) {
  const charts = p.metric==='corners'
    ? [...p.charts,...(p.driverCharts || []),p.traction.chart,p.traction.driverChart] : [p.chart,p.driverChart];
  const matched = charts.some(chart=>chart && 'matchedRivals' in chart && chart.matchedRivals);
  const head = (
    <>
      <p className={`performance-quality-status${p.status.running ? ' is-loading' : ' explanation-only'}`} role="status">
        {p.status.running
          ? <>Loading qualifying telemetry… <span className="explanation-only">{p.status.loaded} of {p.status.total} GPs measured.</span></>
          : `${p.status.loaded} of ${p.status.total} GPs measured. ${matched?'Matched rivals use weekends both entrants ran.':'Ranked entrants share the same weekends.'} A ranking needs overlap in at least half the supported GPs.`}
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
        <CornerProfile charts={p.charts} />
        {p.driverCharts
          ? <><Bands charts={p.charts} subject="Teams" />
              <Bands charts={p.driverCharts} subject="Drivers" /></>
          : p.charts.map((c, i) => <Chart key={i} chart={c} />)}
        {p.phases ? <PhaseSplit phases={p.phases} /> : null}
        {p.corners ? <CornerByCorner corners={p.corners} /> : null}
        <EventValues table={p.events} />
      </Card>
      <Card title="Corner exit acceleration" note="Acceleration out of slow corners with at least 20% throttle, excluding lifts, once a car has gained 30 km/h over its own apex, simulated from 70 to 170 km/h. Seconds per corner exit. Evidence only: in validation it carried little car-specific signal in 2025.">
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
