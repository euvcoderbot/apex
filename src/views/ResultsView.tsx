import {avg, finite, fmt} from '../../performance-format.js';
import {BarChart, type BarChartOptions} from '../components/BarChart';
import {Card} from '../components/Card';
import {DataTable, type SortHeaderModel} from '../components/DataTable';
import {CountBadge, RetirementBadge} from '../components/RetirementBadge';
import {SegmentedControl} from '../components/SegmentedControl';
import {EventLabel, TeamLabel, type TeamLike} from '../components/TeamLabel';

export type ResultRow = TeamLike & {
  team: string; points: number | null; racePoints: number | null; sprintPoints: number | null; results?: unknown;
  pointsPerStart: number | null; finishRatePct: number | null; mechanicalRatePct: number | null; mechanicalPer1000Laps: number | null;
  positions: number[]; finishes: number; starts: number; completedLaps?: number; lapExposureEntries?: number;
  puRetirements: number; chassisRetirements: number; incidentRetirements: number; otherRetirements: number; unknownRetirements: number;
  retirements: {event: string; driver: string; category: string; cause?: string; source?: string}[];
};
export type ResultsViewProps = {
  rows: ResultRow[];           // already sorted by the page's table sort state
  chartMetric: 'points' | 'perStart' | 'finishRate' | 'mechanicalRate' | 'exposure';
  chart: BarChartOptions;      // title, unit, valueKey… chosen by the page
  sort: Record<string, SortHeaderModel>;
};

const MEASURES = [['points', 'Points'], ['perStart', 'Points / start'], ['finishRate', 'Finish rate'], ['mechanicalRate', 'Mechanical retirements']] as const;
const value = (n: number | null | undefined) => (finite(n) ? n : '—');

/** Car performance · Reliability and results. */
export function ResultsView({rows, chartMetric, chart, sort}: ResultsViewProps) {
  // The overview table follows the chart's measure and ordering. Detailed
  // results below retain their independent user-selected table sort.
  const key = (chart.valueKey || 'value') as keyof ResultRow;
  const overview = [...rows].sort((a, b) => {
    const av = a[key], bv = b[key];
    if (!finite(av)) return finite(bv) ? 1 : 0;
    if (!finite(bv)) return -1;
    return chart.invertBest ? Number(bv) - Number(av) : Number(av) - Number(bv);
  });
  return (
    <>
      <Card title="Reliability and results"
        note="Total points include official race and sprint classifications. Points per start, finishes and reliability use races only. Missing sprint classifications leave totals unknown, not zero. Results are not isolated car performance.">
        <div className="performance-results-measure">
          <SegmentedControl name="results-chart" label="Results measure" value={chartMetric} options={MEASURES} />
        </div>
        <div className="results-overview">
        <BarChart rows={overview} options={chart} />
        <DataTable headers={['Team', 'Total points', 'Race', 'Sprint', 'Race points / start', 'Finished / starts']}
          rows={overview.map(t => [<TeamLabel team={t} />, value(t.points), value(t.racePoints), value(t.sprintPoints),
            fmt(t.pointsPerStart, 2), `${t.finishes} / ${t.starts}`])} />
        </div>
        <details className="performance-evidence">
          <summary>Detailed results and reliability</summary>
          <DataTable
            headers={[sort.resultTeam, sort.points, 'Race points', 'Sprint points', sort.pointsPerStart, sort.finish, sort.finishRate,
              sort.mechanicalRate, sort.pu, sort.chassis, sort.incidents, sort.other, sort.mechanicalExposure, 'Official lap exposure']}
            rows={rows.map(t => [
              <TeamLabel team={t} />, t.results && finite(t.points) ? t.points : '—', value(t.racePoints), value(t.sprintPoints),
              fmt(t.pointsPerStart, 3), fmt(avg(t.positions), 3), `${t.finishes} / ${t.starts}`,
              <>{fmt(t.mechanicalRatePct, 3, '%')}<small>{t.unknownRetirements} unknown-cause retirements · not counted as mechanical</small></>,
              <CountBadge count={t.puRetirements} kind="pu" />, <CountBadge count={t.chassisRetirements} kind="chassis" />,
              <CountBadge count={t.incidentRetirements} kind="incident" />, <CountBadge count={t.otherRetirements + t.unknownRetirements} kind="other" />,
              fmt(t.mechanicalPer1000Laps, 3), `${t.completedLaps || 0} laps · ${t.lapExposureEntries || 0}/${t.starts} starts covered`,
            ])} />
        </details>
      </Card>
      <Card title="Retirement classifications"
        note="Causes come from the supplied classification status. A generic Retired status does not identify a mechanical failure or accident. DSQ and medical withdrawals do not count as mechanical failures.">
        <DataTable headers={['Team', 'Event', 'Driver', 'Category', 'Supplied classification status', 'Source attribution']}
          rows={rows.flatMap(t => t.retirements.map(r => [
            <TeamLabel team={t} />, <EventLabel event={r.event} />, r.driver, <RetirementBadge category={r.category} />,
            <span style={{fontWeight: 600}}>{r.cause || 'Unclassified retirement'}</span>,
            <small className="perf-tercile-badge is-mid">{r.source || 'Official Timing'}</small>,
          ]))} />
      </Card>
    </>
  );
}
