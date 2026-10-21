import {exactSeconds, finite, fmt, signed} from '../../performance-format.js';
import {BarChart, type BarChartOptions} from '../components/BarChart';
import {Card} from '../components/Card';
import {DataTable, type SortHeaderModel} from '../components/DataTable';
import {SegmentedControl} from '../components/SegmentedControl';
import {EventLabel, TeamLabel, type TeamLike} from '../components/TeamLabel';

type Sample = {mean: number | null; median: number | null; fastest: number | null; p25: number | null; p75: number | null; count: number; spread: number | null};
export type PitRow = TeamLike & {team: string; driver?: string; sample: Sample; eventCount: number};
export type PitsViewProps = {
  note: string; serviceNote: string; failures: {name: string; error: string}[]; noStationary: boolean;
  quality: {stationary: number; lane: number; visits: number; refresh: boolean};
  isLane: boolean; isDriver: boolean; relativeLane: boolean; chartMetric: string;
  chartRows: (TeamLike & Record<string, unknown>)[]; chart: BarChartOptions; emptyMessage: string;
  rows: PitRow[]; sort: Record<string, SortHeaderModel>;
  visits: {event: string; team: TeamLike; driver: string; lap: number; stop: number | null; lane: number | null; source: string; evidence: string}[];
};

/** Car performance · Pit stops & pit lane. */
export function PitsView(p: PitsViewProps) {
  const seconds = (n: number | null) => (p.relativeLane ? signed(n, 3, ' s') : fmt(n, 3, ' s'));
  const unit = p.relativeLane ? 'GPs' : 'visits';
  return (
    <>
      <Card title="Pit stops & pit lane" note={p.note}>
        <p className="performance-note">{p.serviceNote}</p>
        {p.failures.length ? (
          <p className="performance-note">{p.failures.map(f => `${f.name}: ${f.error}`).join(' · ')}{' '}
            <button type="button" className="performance-explain-toggle" data-pit-retry="">Retry unavailable</button></p>
        ) : null}
        {p.noStationary ? <p className="performance-note">The source has no stationary-at-the-box values for this selection. “—” means unavailable, not a zero-second stop.</p> : null}
        <p className="performance-quality-status">
          {p.quality.stationary} / {p.quality.visits} stationary timings · {p.quality.lane} / {p.quality.visits} lane timings.{' '}
          {p.quality.refresh ? <button type="button" data-pit-retry="">Refresh missing timing</button> : null}
          {' '}Consistency (IQR) needs 4 samples. No recorded visit is not a zero-second stop.
        </p>
        <div className="performance-pit-controls">
          <div className="performance-scope-toggle" role="group" aria-label="Pit timing measurement">
            <button type="button" data-pit-measure="stop" aria-pressed={!p.isLane} title={p.noStationary ? 'No published stationary times for these visits' : undefined}>Stationary stop</button>
            <button type="button" data-pit-measure="lane" aria-pressed={p.isLane}>Pit lane</button>
          </div>
          <SegmentedControl name="pit-subject" label="Pit timing subject" value={p.isDriver ? 'driver' : 'team'} options={[['team', 'Teams'], ['driver', 'Drivers']]} />
          {p.isLane ? <SegmentedControl name="pit-lane-basis" label="Pit-lane comparison basis" value={p.relativeLane ? 'event' : 'raw'} options={[['raw', 'Raw seconds'], ['event', 'Vs GP median']]} /> : null}
          <SegmentedControl name="pit-chart" label="Pit timing chart statistic" value={p.chartMetric}
            options={[['mean', 'Mean'], ['median', 'Median'], ['fastest', 'Quickest'], ['spread', 'Consistency · IQR']]} />
        </div>
        <p className="performance-note">Median describes a typical stop; mean includes slow stops; quickest shows the best visit; IQR describes consistency. Only confirmed service visits are ranked. Pit-lane time is not inferred pit loss.</p>
        {/* Unranked rows still draw (missing is not zero); only no rows at all is empty. */}
        {p.chartRows.length
          ? <BarChart rows={p.chartRows} options={p.chart} />
          : <p className="section-empty" role="status">{p.emptyMessage}</p>}
        <DataTable
          headers={[p.sort.pitName, ...(p.isDriver ? [p.sort.pitTeam] : []), p.sort.pitMean, p.sort.pitMedian, p.sort.pitFastest, p.sort.pitSpread, p.sort.pitCount, p.sort.pitEvents]}
          rows={p.rows.map(r => [
            p.isDriver ? r.driver : <TeamLabel team={r} />, ...(p.isDriver ? [<TeamLabel team={r} />] : []),
            seconds(r.sample.mean), seconds(r.sample.median), seconds(r.sample.fastest),
            finite(r.sample.spread)
              ? <>{fmt(r.sample.spread, 3, ' s')}<small>{fmt(r.sample.p25, 3)}–{fmt(r.sample.p75, 3)} s</small></>
              : <>—<small>{r.sample.count ? `Needs 4 ${unit} · ${r.sample.count} measured` : 'No timed samples'}</small></>,
            r.sample.count, r.eventCount,
          ])} />
      </Card>
      <details className="dashboard-card performance-methods">
        <summary>Exact times for individual pit visits and timing sources</summary>
        <DataTable headers={['Grand Prix', 'Team', 'Driver', 'In-lap', 'Stationary', 'Pit lane', 'Source', 'Visit evidence']}
          rows={p.visits.map(v => [<EventLabel event={v.event} />, <TeamLabel team={v.team} />, v.driver, `L${v.lap}`,
            exactSeconds(v.stop), exactSeconds(v.lane), v.source, v.evidence])} />
      </details>
    </>
  );
}
