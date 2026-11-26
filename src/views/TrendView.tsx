import {finite, fmt, signed} from '../../performance-format.js';
import {Card} from '../components/Card';
import {DataTable, type SortHeaderModel} from '../components/DataTable';
import {DivergingBarChart} from '../components/DivergingBarChart';
import {SegmentedControl} from '../components/SegmentedControl';
import {TrendChart, type SparkPoint, type SparkFit} from '../components/TrendChart';
import {TeamLabel, type TeamLike} from '../components/TeamLabel';

export type TrendRow = {
  team: TeamLike & {team: string}; first: number | null; last: number | null; label: string; count: number; sampleTier: string;
  change: number | null; midSeason?: number | null; fittedChange: number | null; slopePerRound: number | null; range: [number, number] | null; points: SparkPoint[]; fit?: SparkFit;
};
export type TrendViewProps =
  | {single: true; event: string}
  | {single?: false; view: 'observed' | 'fitted'; showSensitivity: boolean; rows: TrendRow[];
     rounds: {round: string; name: string}[]; round: string; qualifyingHref?: string; declarationsHref?: string;
     spark: {lo: number; hi: number; ceiling: number}; sort: {team: SortHeaderModel; last: SortHeaderModel; change: SortHeaderModel}};

/** Car performance · Development & updates (relative qualifying progress). */
export function TrendView(props: TrendViewProps) {
  if (props.single) return (
    <Card title="Performance trend" note="Season progression requires multi-event data.">
      <div className="performance-empty" style={{padding: '48px 24px'}}>
        <div className="empty-icon-badge" aria-hidden="true" />
        <h3>Season performance trend requires multiple events</h3>
        <p>You are currently analysing a single track (<strong>{props.event}</strong>). Car development curves and performance progression measure how teams evolve round-by-round across the championship.</p>
        <p style={{marginTop: 10, color: 'var(--ui-secondary)'}}>To view season performance trends, set <strong>Scope</strong> to <strong>Season to date</strong> or select multiple tracks in the tray above.</p>
      </div>
    </Card>
  );
  const {view, showSensitivity, rows, spark, sort} = props, fitted = view === 'fitted';
  const ranked = rows.map(r => ({...r.team, value: fitted ? r.fittedChange : r.change, count: r.count, evidenceLabel: `${r.count} GPs`}))
    .filter((r): r is typeof r & {value: number} => r.count >= 2 && finite(r.value)).sort((a, b) => a.value - b.value);
  return (
    <Card title="Relative qualifying progress"
      note={`Ranked by ${fitted ? 'a robust fitted rate across measured rounds' : 'the observed change between median opening and latest event groups'}. More negative means the team closed the gap to the quickest car. This measures relative one-lap progress, not a proven upgrade effect.`}>
      <SegmentedControl name="trend-view" label="Rank development by" value={view} options={[['observed', 'Opening → latest'], ['fitted', 'Fitted trend']]} />
      <p className="performance-note">The dots, opening/latest medians and fit use the same evolution-adjusted gaps (raw gaps where adjustment is unavailable). Observed change compares the endpoint groups; fitted change uses every measured round. {fitted ? 'The dashed line shows that fit. ' : ''}Missing rounds are not filled. Circuit suitability, setup and driver changes affect the trend.</p>
      <div className="trend-round-tools">
        <label>Highlight <select data-trend-entrant="">
          <option value="">All teams</option>
          {[...rows].sort((a, b) => a.team.team.localeCompare(b.team.team)).map(({team}) =>
            <option key={team.team} value={team.team}>{team.team}</option>)}
        </select></label>
        <label>Inspect round <select data-trend-round="" defaultValue={props.round}>
          <option value="">Season summary</option>
          {props.rounds.map(event => <option key={event.round} value={event.round}>R{event.round} · {event.name}</option>)}
        </select></label>
        {props.qualifyingHref ? <a className="perf-link" href={props.qualifyingHref}>Open qualifying laps</a> : null}
        {props.declarationsHref ? <a className="perf-link" href={props.declarationsHref}>Season upgrade declarations</a> : null}
      </div>
      <div className="trend-board">
        <div className="performance-chart-card">
          <div className="perf-chart-header"><div className="perf-chart-title-group">
            <h4 className="perf-chart-heading">Gap to the quickest car, by round</h4>
            <span className="perf-chart-sub">Gap in % of lap time. Higher is quicker.</span>
          </div></div>
          <TrendChart {...spark} selectedRound={props.round ? Number(props.round) : undefined} series={rows.map(r => ({key: r.team.team, label: r.team.team, teamColor: r.team.color, points: r.points, fit: fitted ? r.fit : null}))} />
        </div>
        {props.round ? <div className="performance-chart-card">
          <h4 className="perf-chart-heading">Round {props.round} qualifying gaps</h4>
          <DataTable headers={['Team', 'Gap to quickest car']} rows={rows.map(row => ({
            team: row.team, point: row.points.find(point => String(point.round) === props.round)
          })).sort((a, b) => (a.point?.pace ?? Infinity) - (b.point?.pace ?? Infinity))
            .map(row => [<TeamLabel team={row.team} />, row.point ? fmt(row.point.pace, 3, '%') : 'No reading'])} />
        </div> : <DivergingBarChart title={fitted ? 'Fitted change' : 'Change, opening to latest'} subtitle="Left of zero closed the gap, right of zero lost ground" unit="%"
          extent={Math.max(0, ...ranked.map(r => Math.abs(r.value)))} rows={ranked} seriesKey={r => r.team || ''} />}
      </div>
      {/* The chart and bars above already show these values: the table is there to read exact numbers, folded by default. */}
      <details className="performance-trend-table performance-table-fold" data-fit-sensitivity={showSensitivity ? 'true' : 'false'}>
        <summary>Values table</summary>
        <DataTable evidenceFrom={4} headers={[sort.team, sort.last,
          fitted ? 'Observed change' : {...sort.change,label:'Observed change'},
          fitted ? {...sort.change,label:'Fitted change'} : 'Fitted change',
          ...(showSensitivity ? ['Fit sensitivity'] : []), 'GPs']}
          rows={rows.map(r => {
            const enough = r.count >= 2;
            const rate = enough && finite(r.slopePerRound) ? `${signed(r.slopePerRound, 3, '')}%/round` : '—';
            return [
              <TeamLabel team={r.team} />,
              r.count >= 2 ? <>
                <span className="trend-endpoints" title={r.label}>{fmt(r.first, 3, '%')} → {fmt(r.last, 3, '%')}</span>
                {finite(r.midSeason) ? <small className="trend-uneven" title="The middle of the season differs from both ends, so neither the endpoint change nor the straight-line fit describes it: read the dots.">
                  Not a steady trend · mid-season {fmt(r.midSeason, 3, '%')}</small> : null}
              </> : 'Needs ≥ 2 events',
              r.count >= 2 && finite(r.change) ? <span className={`trend-change ${r.change! < 0 ? 'is-improvement' : 'is-decline'}`} title={`Observed opening-to-latest percentage-point change · ${r.label}`}>{signed(r.change, 3, '%')}</span> : '—',
              r.count >= 2 && finite(r.fittedChange) ? <span className={`trend-change trend-fitted ${r.fittedChange! < 0 ? 'is-improvement' : 'is-decline'}`} title={`Robust fitted rate: ${rate}`}>{signed(r.fittedChange, 3, '%')}</span> : '—',
              ...(showSensitivity ? [r.range ? `${signed(r.range[0], 3, "")} to ${signed(r.range[1], 3, "")}%/round` : '—'] : []),
              <span className="trend-coverage" title={r.sampleTier}>{r.count}</span>,
            ];
          })} />
      </details>
      <Card title="FIA event documents" note="Reference documents, not an ingested upgrade database. Relative pace changes do not establish an upgrade effect.">
        <p><a href="https://www.fia.com/documents" target="_blank" rel="noopener" className="perf-link">Open FIA event documents ↗</a></p>
        <p className="performance-note">Component counts from Car Presentation Submissions are not weighted by competitive impact, and public lap times cannot isolate aerodynamic package gains from setup or driver variation. No synthetic upgrade gains are inferred.</p>
      </Card>
    </Card>
  );
}
