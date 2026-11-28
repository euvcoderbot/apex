import {color, finite, fmt} from '../../performance-format.js';
import {BarChart, type BarChartOptions} from '../components/BarChart';
import {Card} from '../components/Card';
import {DataTable, type SortHeaderModel} from '../components/DataTable';
import {EventLabel, TeamLabel, type TeamLike} from '../components/TeamLabel';
import {ValueNote} from '../components/ValueNote';

type Row = TeamLike & Record<string, unknown>;
type Note = {value: string; note?: string} | null;
export type PaceViewProps = {
  regulatory: boolean; note: string;
  stat: {show: boolean; value: 'mean' | 'median'};
  qualyMode: 'overall' | 'adjusted' | 'condition'; qualyBadge: string;
  qualyChart: {rows: Row[]; options: BarChartOptions}; raceChart: {rows: Row[]; options: BarChartOptions};
  sort: {team: SortHeaderModel; pace: SortHeaderModel; race: SortHeaderModel; samples: SortHeaderModel};
  rows: {team: Row; pace: Note & {}; race: {value: string; provisional: boolean; note: string}; samples: number}[];
  coverage: {team: Row; event: string; driver: string; laps: string; stints: string | number; compounds: string; range: string; common: Note; leave: Note; noise: string}[];
  laps: {team: Row; event: string; phase: string; driver: string; time: number}[];
  drivers: {team: Row; event: string; driver: string; estimate: string; samples: number; basis: string; residual: string}[];
};

/** One row per team: its qualifying gap (ring) and race-pace gap (dot) on one shared scale, joined by a line, so a car
 *  that is quicker over one lap than over a race (or the reverse) reads at a glance. Each gap is rebased to its own
 *  quickest team, as in the two bar charts above. */
function PaceComparison({qualy, race}: {qualy: PaceViewProps['qualyChart']; race: PaceViewProps['raceChart']}) {
  const qKey = qualy.options.valueKey || 'value', rKey = race.options.valueKey || 'race';
  const digits = Math.min(qualy.options.digits ?? 2, race.options.digits ?? 2);
  const name = (r: Row) => String(r.team || r.name || '');
  const raceBy = new Map(race.rows.map(r => [name(r), r]));
  const pairs = qualy.rows.map(r => ({team: r, q: r[qKey] as number, r: raceBy.get(name(r))?.[rKey] as number}))
    .filter(x => finite(x.q) && finite(x.r));
  if (pairs.length < 2) return null;
  const qBest = Math.min(...pairs.map(x => x.q)), rBest = Math.min(...pairs.map(x => x.r));
  const rows = pairs.map(x => ({...x, q: x.q - qBest, r: x.r - rBest}));
  const qRank = new Map([...rows].sort((a, b) => a.q - b.q).map((x, i) => [x, i + 1]));
  rows.sort((a, b) => a.r - b.r || a.q - b.q);
  const span = Math.max(0.0001, ...rows.flatMap(x => [x.q, x.r]));
  // The scale is inset by a dot's radius at each end, so a gap of zero or the largest gap is drawn whole.
  const at = (v: number) => `calc(6px + (100% - 12px) * ${(v / span).toFixed(4)})`;
  const length = (v: number) => `calc((100% - 12px) * ${(v / span).toFixed(4)})`;
  const show = (v: number) => (v <= 0.00001 ? fmt(0, digits, '%') : `+${fmt(v, digits, '%')}`);
  return (
    <div className="performance-chart-card pace-compare-card">
      <div className="perf-chart-header"><div className="perf-chart-title-group">
        <h4 className="perf-chart-heading">Qualifying against race pace</h4>
        <span className="perf-chart-sub">Gap to the quickest team on one scale · ordered by race pace</span>
      </div>
      <div className="pace-compare-key" aria-hidden="true"><span><i className="is-qualy" />Qualifying</span><span><i className="is-race" />Race</span></div></div>
      <div className="performance-bars pace-compare-rows">
        {rows.map((x, i) => {
          const label = name(x.team), shift = (qRank.get(x) || 0) - (i + 1);
          const summary = `${label}: qualifying ${show(x.q)}, race ${show(x.r)}${shift ? `; ${Math.abs(shift)} place${Math.abs(shift) === 1 ? '' : 's'} ${shift > 0 ? 'higher' : 'lower'} on race pace than in qualifying` : ''}`;
          return (
            <div key={label} className="performance-bar-row pace-compare-row" role="img" aria-label={summary} title={summary}
              data-chart-value={`Qualifying against race pace:${label}`} data-entrant={label} tabIndex={i === 0 ? 0 : -1}
              style={{'--bar-color': color(x.team.color as string)} as React.CSSProperties}>
              <div className="performance-bar-label rank-label"><TeamLabel team={x.team} />
                {Math.abs(shift) >= 2 ? <small className="rank-evidence">{shift > 0 ? `${shift} up in race` : `${-shift} down in race`}</small> : null}</div>
              <div className="performance-bar-track pace-compare-track">
                <i className="pace-compare-span" style={{left: at(Math.min(x.q, x.r)), width: length(Math.abs(x.q - x.r))}} />
                <i className="pace-compare-dot is-qualy" style={{left: at(x.q)}} />
                <i className="pace-compare-dot is-race" style={{left: at(x.r)}} />
              </div>
              <span className="performance-bar-val pace-compare-val"><span>{show(x.q)}</span><span>{show(x.r)}</span></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Car performance · Qualifying & race pace. */
export function PaceView(p: PaceViewProps) {
  const note = (n: Note) => (n ? <ValueNote value={n.value} note={n.note} /> : '—');
  return (
    <>
      {p.regulatory ? (
        <details className="perf-regulatory-badge"><summary>2026 telemetry limits</summary>
          <div className="reg-title">2026 regulations · active aerodynamics and stronger electrical deployment</div>
          <div className="reg-body">Public traces do not show each car’s active-aero position or ERS state. Straight-line results include those unknown choices.</div>
          <div className="reg-note">Event-specific limits are shown only after the exact FIA event document and session version are verified. <a href="https://www.fia.com/regulation/fia-formula-1-technical-regulations" target="_blank" rel="noopener">FIA regulations ↗</a></div>
        </details>
      ) : null}
      <Card title="Qualifying & race pace" note={p.note}>
        {p.stat.show ? (
          <div className="performance-scope-toggle performance-stat-toggle" role="group" aria-label="Pace across GPs">
            <button type="button" data-pace-stat="median" aria-pressed={p.stat.value === 'median'}>Median gap</button>
            <button type="button" data-pace-stat="mean" aria-pressed={p.stat.value === 'mean'}>Mean gap</button>
          </div>
        ) : null}
        <div className="performance-metric-toolbar">
          <div className="performance-scope-toggle" role="radiogroup" aria-label="Qualifying pace comparison mode">
            <button type="button" data-qualy-mode="overall" aria-pressed={p.qualyMode === 'overall'}>Fastest lap</button>
            <button type="button" data-qualy-mode="adjusted" title="Estimate allowing for track evolution" aria-pressed={p.qualyMode === 'adjusted'}>Adjusted</button>
          </div>
          <span className="perf-tercile-badge is-mid explanation-only">{p.qualyBadge}</span>
        </div>
        <div className="performance-visual-grid pace-visual-grid">
          <BarChart rows={p.qualyChart.rows} options={p.qualyChart.options} />
          <BarChart rows={p.raceChart.rows} options={p.raceChart.options} />
        </div>
        <PaceComparison qualy={p.qualyChart} race={p.raceChart} />
      </Card>
      <details className="performance-evidence">
        <summary>Pace table by team</summary>
        <DataTable headers={[p.sort.team, p.sort.pace, p.sort.race, p.sort.samples]}
          rows={p.rows.map(r => [<TeamLabel team={r.team} />, note(r.pace),
            <ValueNote value={r.race.value} badge={r.race.provisional ? 'Provisional estimate' : undefined} note={r.race.note} />, r.samples])} />
      </details>
      <details className="dashboard-card performance-methods">
        <summary>Race-pace coverage and traffic sensitivity by GP</summary>
        <p className="performance-note">The traffic range refits the selected driver using 1.5, 2.0 and 2.5-second checkpoint screens. The common-cohort column keeps the same reference driver across those screens instead of changing the zero each time. These are sensitivity tests, not confidence intervals or a season-wide range. Leave-stint-out removes each of the three largest sampled stints and compares with one fixed reference driver; it can reveal strategy-dependent estimates but is not exhaustive. Noise gain measures sensitivity to perturbing observed lap times, not a confidence interval. Race-lap effects absorb shared fuel burn and track evolution; no measured fuel load is supplied.</p>
        <DataTable headers={['Team', 'Grand Prix', 'Driver', 'Race laps covered', 'Stints', 'Compounds', 'Traffic-screen range', 'Common-cohort contrasts · 1.5 / 2.0 / 2.5 s', 'Leave-stint-out', 'Contrast noise gain']}
          rows={p.coverage.map(r => [<TeamLabel team={r.team} />, <EventLabel event={r.event} />, r.driver, r.laps, r.stints, r.compounds, r.range, note(r.common), note(r.leave), r.noise])} />
      </details>
      <details className="dashboard-card performance-methods">
        <summary>Why this pace ranking? View selected laps and race drivers</summary>
        <p className="performance-note">Only the fastest valid lap across the whole qualifying session counts for each team. P25–P75 describes variation in the GP deficits, not uncertainty in the season rank.</p>
        <DataTable headers={['Team', 'Event', 'Phase', 'Driver', 'Selected lap (s)']}
          rows={p.laps.map(r => [<TeamLabel team={r.team} />, <EventLabel event={r.event} />, r.phase, r.driver, fmt(r.time, 3)])} />
        <p className="performance-note">Standard race pace needs ten clear-air laps. Five to nine can support a provisional fit. Otherwise, known-traffic laps may support a provisional fit with a shared linear proximity effect below two seconds, anchored to at least three standard drivers. This assumes a common traffic response; clear-air extrapolation is flagged. Unknown gaps, wet/pit laps and disconnected fits stay excluded. Residual error is not a confidence interval.</p>
        <DataTable headers={['Team', 'Event', 'Driver', 'Estimate', 'Modelled laps', 'Basis / residual']}
          rows={p.drivers.map(r => [<TeamLabel team={r.team} />, <EventLabel event={r.event} />, r.driver, r.estimate, r.samples, <ValueNote value={r.basis} note={r.residual} />])} />
      </details>
    </>
  );
}
