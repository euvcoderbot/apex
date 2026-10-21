import {Fragment} from 'react';
import {signed} from '../../performance-format.js';
import {BarChart, type BarChartOptions} from '../components/BarChart';
import {Card} from '../components/Card';
import {DataTable, type SortHeaderModel} from '../components/DataTable';
import {TeamLabel, type TeamLike} from '../components/TeamLabel';

type Team = TeamLike & {team: string};
export type RaceCornersViewProps = {
  band: 'all' | 'low' | 'medium' | 'high';
  action: 'stop' | 'load-remaining' | 'calculate' | null;
  support: string; coverage: string[]; ageModel: string | null;
  chart: {rows: (Team & {gap?: number | null})[]; options: BarChartOptions};
  sort: Record<'team' | 'gap' | 'gps' | 'samples', SortHeaderModel>;
  rows: {team: Team; gap: number | null; events: number; samples: number; comparisons: number}[];
  snapshots: {event: string; team: string; driver: string; lap: number; compound: string; age: number; corners: number; alignment: string}[];
  problems: string[];
};

const BANDS = [['all', 'All corners'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] as const;

/** Corner speed band control (`data-corner-band`), shared by the cornering views. */
export function CornerBandControl({band}: {band: string}) {
  return (
    <div className="performance-scope-toggle" role="group" aria-label="Corner speed type">
      {BANDS.map(([key, label]) => (
        <button key={key} type="button" data-corner-band={key} aria-pressed={band === key} title={key === 'all' ? 'All measured corners' : label + '-speed corners'}>{label}</button>
      ))}
    </div>
  );
}

/** Car performance · Cornering in the race (matched comparisons). */
export function RaceCornersView(p: RaceCornersViewProps) {
  return (
    <Card title="Race cornering · matched comparisons"
      note="Every eligible group across the available race is processed; there is no six-lap target or snapshot cap. Cached groups appear first. Each comparison uses the same race lap and compound, with tyre ages within four laps. Pit laps, wet laps, laps over 107% of stint median and close traffic at the timing line are excluded. Retained sources may contain only part of the race. Overlapping rivals connect snapshots; disconnected groups cannot share a baseline.">
      <CornerBandControl band={p.band} />
      {p.action ? (
        <div className="performance-actions">
          {p.action === 'stop' ? <button type="button" data-race-corners-stop="">Stop race cornering</button>
            : <button type="button" data-race-corners-load="">{p.action === 'load-remaining' ? 'Load remaining race observations' : 'Calculate matched race corners'}</button>}
        </div>
      ) : null}
      <p className="performance-quality-status">{p.support}</p>
      {p.coverage.map((c, i) => <p key={i} className="performance-quality-status">{c}</p>)}
      {p.ageModel ? <p className="performance-note">{p.ageModel}</p> : null}
      <p className="performance-note">Supported head-to-head time differences are averaged with equal GP weight. A connected comparison fits overlapping rivals; missing observations are not filled. These are estimated gaps per corner, not whole-lap loss or isolated downforce.</p>
      <BarChart rows={p.chart.rows} options={p.chart.options} />
      <DataTable headers={[p.sort.team, p.sort.gap, p.sort.gps, p.sort.samples, 'Corners timed']}
        rows={p.rows.map(r => [<TeamLabel team={r.team} />, signed(r.gap, 3, ' s'), r.events, r.samples, `${r.comparisons}${r.samples < 3 ? ' · sparse' : ''}`])} />
      <details className="performance-evidence">
        <summary>Measured race snapshots and missing data</summary>
        <DataTable headers={['GP', 'Team', 'Driver / lap', 'Compound / age', 'Corners', 'Alignment']}
          rows={p.snapshots.map(o => [o.event, o.team, `${o.driver} L${o.lap}`, `${o.compound} · ${o.age} laps`, o.corners, o.alignment])} />
        <p>{p.problems.map((x, i) => <Fragment key={i}>{i ? <br /> : null}{x}</Fragment>)}</p>
      </details>
    </Card>
  );
}
