import {finite, fmt, signed} from '../../performance-format.js';
import {Card} from '../components/Card';
import {DataTable, type SortHeaderModel} from '../components/DataTable';
import {SegmentedControl} from '../components/SegmentedControl';
import {Sparkline, type SparkPoint, type SparkFit} from '../components/Sparkline';
import {TeamLabel, type TeamLike} from '../components/TeamLabel';

export type TrendRow = {
  team: TeamLike & {team: string}; first: number | null; last: number | null; label: string; count: number; sampleTier: string;
  change: number | null; fittedChange: number | null; slopePerRound: number | null; range: [number, number] | null; points: SparkPoint[]; fit?: SparkFit;
};
export type TrendViewProps =
  | {single: true; event: string}
  | {single?: false; view: 'observed' | 'fitted'; showSensitivity: boolean; rows: TrendRow[];
     spark: {lo: number; hi: number; ceiling: number}; sort: {team: SortHeaderModel; last: SortHeaderModel; change: SortHeaderModel}};

/** Car performance · Development & updates (relative qualifying progress). */
export function TrendView(props: TrendViewProps) {
  if (props.single) return (
    <Card title="Performance trend" note="Season progression requires multi-event data.">
      <div className="performance-empty" style={{padding: '48px 24px'}}>
        <div className="empty-icon-badge" aria-hidden="true" />
        <h3>Season performance trend requires multiple events</h3>
        <p>You are currently analysing a single track (<strong>{props.event}</strong>). Car development curves and performance progression measure how teams evolve round-by-round across the championship.</p>
        <p style={{marginTop: 10, color: 'var(--text-secondary)'}}>To view season performance trends, set <strong>Scope</strong> to <strong>Season to date</strong> or select multiple tracks in the tray above.</p>
      </div>
    </Card>
  );
  const {view, showSensitivity, rows, spark, sort} = props, fitted = view === 'fitted';
  return (
    <Card title="Relative qualifying progress"
      note={`Ranked by ${fitted ? 'a robust fitted rate across measured rounds' : 'the observed change between median opening and latest event groups'}. More negative means the team closed the gap to the quickest car. This measures relative one-lap progress, not a proven upgrade effect.`}>
      <SegmentedControl name="trend-view" label="Rank development by" value={view} options={[['observed', 'Opening → latest'], ['fitted', 'Fitted trend']]} />
      <p className="performance-note">The dots, opening/latest medians and fit use the same evolution-adjusted gaps (raw gaps where adjustment is unavailable). Observed change compares the endpoint groups; fitted change uses every measured round. {fitted ? 'The dashed line shows that fit. ' : ''}Missing rounds are not filled. Circuit suitability, setup and driver changes affect the trend.</p>
      <div className="performance-trend-table" data-fit-sensitivity={showSensitivity ? 'true' : 'false'}>
        <DataTable headers={[sort.team, 'Gap by round', sort.last,
          fitted ? 'Observed change' : {...sort.change,label:'Observed change'},
          fitted ? {...sort.change,label:'Fitted change'} : 'Fitted change',
          ...(showSensitivity ? ['Fit sensitivity'] : []), 'GPs']}
          rows={rows.map(r => {
            const enough = r.count >= 2;
            const rate = enough && finite(r.slopePerRound) ? `${signed(r.slopePerRound, 3, '')} pp/round` : '—';
            return [
              <TeamLabel team={r.team} />,
              <Sparkline label={r.team.team} points={r.points} teamColor={r.team.color} {...spark} fit={fitted ? r.fit : null} />,
              r.count >= 2 ? <span className="trend-endpoints" title={r.label}>{fmt(r.first, 3, '%')} → {fmt(r.last, 3, '%')}</span> : 'Needs ≥ 2 events',
              r.count >= 2 && finite(r.change) ? <span className={`trend-change ${r.change! < 0 ? 'is-improvement' : 'is-decline'}`} title={`Observed opening-to-latest percentage-point change · ${r.label}`}>{signed(r.change, 3, ' pp')}</span> : '—',
              r.count >= 2 && finite(r.fittedChange) ? <span className={`trend-change trend-fitted ${r.fittedChange! < 0 ? 'is-improvement' : 'is-decline'}`} title={`Robust fitted rate: ${rate}`}>{signed(r.fittedChange, 3, ' pp')}</span> : '—',
              ...(showSensitivity ? [r.range ? `${signed(r.range[0], 3, "")} to ${signed(r.range[1], 3, "")} pp/round` : '—'] : []),
              <span className="trend-coverage" title={r.sampleTier}>{r.count}</span>,
            ];
          })} />
      </div>
      <Card title="FIA event documents" note="Reference documents, not an ingested upgrade database. Relative pace changes do not establish an upgrade effect.">
        <p><a href="https://www.fia.com/documents" target="_blank" rel="noopener" className="perf-link">Open FIA event documents ↗</a></p>
        <p className="performance-note">Component counts from Car Presentation Submissions are not weighted by competitive impact, and public lap times cannot isolate aerodynamic package gains from setup or driver variation. No synthetic upgrade gains are inferred.</p>
      </Card>
    </Card>
  );
}
