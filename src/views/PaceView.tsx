import {fmt} from '../../performance-format.js';
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
          <div className="performance-scope-toggle performance-stat-toggle" role="group" aria-label="Race pace across GPs">
            <button type="button" data-pace-stat="mean" aria-pressed={p.stat.value === 'mean'}>Mean gap</button>
            <button type="button" data-pace-stat="median" aria-pressed={p.stat.value === 'median'}>Median gap</button>
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
        <DataTable headers={[p.sort.team, p.sort.pace, p.sort.race, p.sort.samples]}
          rows={p.rows.map(r => [<TeamLabel team={r.team} />, note(r.pace),
            <ValueNote value={r.race.value} badge={r.race.provisional ? 'Provisional estimate' : undefined} note={r.race.note} />, r.samples])} />
      </Card>
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
