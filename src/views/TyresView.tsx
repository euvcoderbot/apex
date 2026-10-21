import {finite, fmt, signed} from '../../performance-format.js';
import {BarChart, type BarChartOptions} from '../components/BarChart';
import {Card} from '../components/Card';
import {DataTable, type SortHeaderModel} from '../components/DataTable';
import {DivergingBarChart} from '../components/DivergingBarChart';
import {SegmentedControl} from '../components/SegmentedControl';
import {EventLabel, TeamLabel, type TeamLike} from '../components/TeamLabel';
import {TyreStintPlot, type StintPlotModel} from '../components/TyreStintPlot';
import {ValueNote} from '../components/ValueNote';

type Team = TeamLike & {team: string};
type Compound = {choices: string[]; value: string; overallLabel: string};
type Picker = {teams: string[]; team: string; drivers: string[]; driver: string; events: string[]; event: string;
  runs: {key: string; label: string}[]; run: string; total: number; teamCount: number};
export type TyresViewProps = {metric: 'age' | 'relative'; subject: 'team' | 'driver'} & (
  | {metric: 'relative'; compound: Compound; chart: {rows: Team[]; options: BarChartOptions};
     sort: Record<'team' | 'norm' | 'stints', SortHeaderModel>;
     rows: {team: Team; norm: {value: number | null; provisional: string | null}; ageRange: string; sample: string; observed: number | null;
       fieldSupported: boolean; compound: string; notes: string[]}[]}
  | {metric: 'age'; noGrades: true}
  | {metric: 'age'; noGrades?: false; note: string; compound: Compound; correction: 'raw' | 'fuel'; correctionText: string;
     quality: string; commonCoverage: string | null;
     coverage: {mapped: number; loaded: number; unmapped: number; source: string}; legacy: boolean;
     chart: {title: string; rows: (Team & {value: number})[]; extent: number} | null; emptyMessage: string;
     sort: Record<'name' | 'value' | 'events' | 'stints' | 'laps', SortHeaderModel>;
     rows: {team: Team; value: number | null; shortfall: string | null; events: number; stints: number; laps: number; outliers: number; coverage: string}[];
     picker: Picker | null; plot: StintPlotModel | null;
     evidence: {team: Team; driver: string; event: string; grade: string; run: string; ages: string; laps: number; trend: string; earlyLate: string;
       error: string; sensitivity: string; status: string; inspect: string | null}[];
     auditOpen: boolean});

function CompoundControl({compound}: {compound: Compound}) {
  return (
    <div className="performance-compound-control">
      <span className="compound-control-label" id="performanceTyreCompoundLabel">Compound</span>
      <div className="performance-tyre-options" role="group" aria-labelledby="performanceTyreCompoundLabel">
        {compound.choices.map(c => <button key={c} type="button" data-tyre-compound={c} aria-pressed={compound.value === c}>{c === 'OVERALL' ? compound.overallLabel : c}</button>)}
      </div>
    </div>
  );
}

function RunPicker({picker: p}: {picker: Picker}) {
  const select = (label: string, filter: string, values: {value: string; label: string}[], value: string) => (
    <label>{label}<select data-tyre-plot-filter={filter} defaultValue={value}>
      {values.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
    </select></label>
  );
  const plain = (list: string[]) => [...new Set(list)].map(v => ({value: v, label: v}));
  return (
    <>
      <div className="performance-tyre-plot-controls">
        {select('Team', 'team', plain(p.teams), p.team)}
        {select('Driver', 'driver', plain(p.drivers), p.driver)}
        {select('Grand Prix', 'event', plain(p.events), p.event)}
        {select('Stint / run', 'run', p.runs.map(r => ({value: r.key, label: r.label})), p.run)}
      </div>
      <p className="performance-note">Inspecting one individual run · {p.total} runs from {p.teamCount} teams available. The ranking above summarizes the selected compound across all supported runs.</p>
    </>
  );
}

/** Car performance · Tyre trend (tyre-age change, or extra ageing vs matched rivals). */
export function TyresView(p: TyresViewProps) {
  const toolbar = (
    <div className="performance-toolbar performance-tyre-toolbar">
      <SegmentedControl name="tyre-metric" label="Tyre trend measurement" value={p.metric} options={[['age', 'Tyre-age trend'], ['relative', 'Matched rivals']]} />
      {p.metric === 'age' ? <SegmentedControl name="tyre-subject" label="Tyre trend subject" value={p.subject} options={[['team', 'Teams'], ['driver', 'Drivers']]} /> : null}
    </div>
  );
  if (p.metric === 'relative') return (
    <>
      {toolbar}
      <Card title="Tyre-age lap-time trend"
        note="Extra lap-time change per tyre-age lap against overlapping rivals on the same compound. Each compound uses the selected GP statistic; Overall then averages supported compounds equally. P75 is a worse-end GP trend, not the 75th percentile of individual laps. One-compound or short-season results are provisional. Missing values mean no matched three-team cohort, not zero tyre wear. Traffic and management remain limitations.">
        <CompoundControl compound={p.compound} />
        <BarChart rows={p.chart.rows} options={p.chart.options} />
        <DataTable headers={[p.sort.team, p.sort.norm, 'Observed age range', p.sort.stints, 'Field support', 'Compound mix']}
          rows={p.rows.map(r => [
            <TeamLabel team={r.team} />,
            finite(r.norm.value) ? <ValueNote value={`${r.norm.value! > 0 ? '+' : ''}${fmt(r.norm.value, 3, ' s/lap')}`} note={r.norm.provisional ?? undefined} />
              : <small>Not enough overlapping rival stints</small>,
            r.ageRange,
            <ValueNote value={r.sample} note={r.observed ? `${r.observed} observed stints total` : undefined} />,
            r.fieldSupported ? <span className="perf-tercile-badge is-fast">≥2 overlapping rivals</span> : <span className="perf-tercile-badge is-mid">No matched cohort</span>,
            <>{r.compound}{r.notes.map((n, i) => <small key={i}>{n}</small>)}</>,
          ])} />
      </Card>
    </>
  );
  if (p.noGrades) return (
    <>
      {toolbar}
      <Card title="Tyre-age performance change" note="Exact C-grade allocations have not been verified for this season. Soft, Medium and Hard change meaning by race, so showing them here as C grades would be misleading.">
        <p className="section-empty">No exact-compound tyre-age results for this season. Matched rivals remains available.</p>
      </Card>
    </>
  );
  return (
    <>
      {toolbar}
      <Card title="Tyre-age performance change" note={p.note}>
        <CompoundControl compound={p.compound} />
        <div className="performance-toolbar performance-tyre-toolbar">
          <SegmentedControl name="tyre-correction" label="Tyre trend fuel correction" value={p.correction} options={[['raw', 'Observed pace'], ['fuel', 'Fuel-adjusted estimate']]} />
          <p className="performance-quality-status">{p.correctionText}<span className="explanation-only"> Screened laps · balanced drivers · median GP trend.</span></p>
        </div>
        <p className="performance-quality-status explanation-only">{p.quality}</p>
        {p.commonCoverage ? <p className="performance-note">{p.commonCoverage}</p> : null}
        <p className="performance-note">
          Verified C grades for {p.coverage.mapped}/{p.coverage.loaded} loaded races. {p.coverage.unmapped ? `${p.coverage.unmapped} stint${p.coverage.unmapped === 1 ? '' : 's'} without a verified grade excluded. ` : ''}Fewer samples per grade can make rankings less stable.{' '}
          <a href={p.coverage.source} target="_blank" rel="noopener noreferrer">Pirelli allocation sources</a>
        </p>
        {p.legacy ? <p className="performance-note">Some loaded results lack the new curve. Refresh data to obtain the updated fits; missing nonlinear results use the previous linear diagnostic.</p> : null}
        {p.chart ? <DivergingBarChart title={p.chart.title} subtitle="Seconds per additional tyre-age lap · left of zero improves, right of zero worsens" rows={p.chart.rows} unit=" s/lap" extent={p.chart.extent} />
          : <p className="section-empty">{p.emptyMessage}</p>}
        <DataTable headers={[p.sort.name, p.sort.value, p.sort.events, p.sort.stints, p.sort.laps, 'Outlier laps removed', 'Coverage']}
          rows={p.rows.map(r => [<TeamLabel team={r.team} />,
            finite(r.value) ? signed(r.value, 3, ' s/lap') : r.shortfall ? <>—<small>P75 needs {r.shortfall}</small></> : '—',
            r.events, r.stints, r.laps, r.outliers, r.coverage])} />
        {p.picker ? <RunPicker picker={p.picker} /> : null}
        {p.plot ? <TyreStintPlot model={p.plot} /> : null}
        <details className="dashboard-card performance-methods" open={p.auditOpen || undefined}>
          <summary>View stint evidence and early/late trends</summary>
          <p className="performance-note">A run needs six usable laps across at least five tyre-age steps to enter the ranking. Early/late rates need at least six laps in each half. Block sensitivity refits the trend after removing successive groups of adjacent laps; a wide range means sections of the stint strongly influence the result. It needs at least twelve laps. Neither this range nor typical fit error is a confidence interval. Short runs and unmapped compounds are listed but do not enter the ranking. View laps draws the selected run above this table.</p>
          <DataTable headers={['Team', 'Driver', 'Grand Prix', 'Compound', 'Stint / run', 'Observed tyre ages', 'Fit laps', 'Trend', 'Early → late', 'Typical fit error', 'Block sensitivity', 'Evidence', 'Lap plot']}
            rows={p.evidence.map(e => [<TeamLabel team={e.team} />, e.driver, <EventLabel event={e.event} />, e.grade, e.run, e.ages, e.laps, e.trend, e.earlyLate, e.error, e.sensitivity, e.status,
              e.inspect ? <button type="button" className="performance-stint-inspect" data-tyre-run={e.inspect}>View laps</button> : '—'])} />
        </details>
      </Card>
    </>
  );
}
