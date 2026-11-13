import {color, fmt} from '../../performance-format.js';
import {DataTable} from './DataTable';

export type StintPlotModel = {
  title: string; teamColor?: string; empty: boolean; noTrend: boolean; caption: string;
  exclusions: {pressed: boolean; label: string} | null;
  axis: {lo: number; hi: number; grid: {y: number; label: string}[]};
  curve: string | null;                 // SVG path, already in plot coordinates
  points: {cx: number; cy: number; title: string}[];
  excluded: {cx: number; cy: number; title: string}[];
  laps: {lap: number; age: number | null; time: number; status: string}[];
};

/** One run's lap times against tyre age (`.performance-tyre-stint-plot`). */
export function TyreStintPlot({model: m}: {model: StintPlotModel}) {
  const stroke = color(m.teamColor);
  const laps = (
    <details className="tyre-run-laps">
      <summary>{m.laps.length} recorded laps · view times</summary>
      <DataTable headers={['Lap', 'Tyre age', 'Lap time', 'Status']}
        rows={m.laps.map(p => [`L${p.lap}`, p.age ?? '—', fmt(p.time, 3, ' s'), p.status])} />
    </details>
  );
  if (m.empty) return (
    <div className="performance-chart-card performance-tyre-stint-plot">
      <h4>{m.title}</h4><p className="section-empty">No usable timed laps in this run.</p>{laps}
    </div>
  );
  return (
    <div className="performance-chart-card performance-tyre-stint-plot">
      <h4>{m.title}</h4>
      {m.noTrend ? <p className="section-empty">Laps shown for reference; not enough data for a trend.</p> : null}
      <span className="perf-chart-sub explanation-only">{m.caption}</span>
      {m.exclusions ? <button type="button" data-tyre-exclusions="" aria-pressed={m.exclusions.pressed}>{m.exclusions.label}</button> : null}
      <svg className="stint-plot" viewBox="0 0 680 230" role="group" aria-label={`${m.title.split(' · ')[0]} stint lap times against tyre age; use arrow keys to inspect values`}>
        {m.axis.grid.map((g, i) => (
          <g key={i}><line className="grid" x1="55" x2="645" y1={g.y} y2={g.y} /><text className="axis" x="48" y={g.y + 4} textAnchor="end">{g.label}</text></g>
        ))}
        {m.curve ? <path className="fit" d={m.curve} stroke={stroke} fill="none" /> : null}
        {m.points.map((p, i) => <circle key={'p' + i} cx={p.cx} cy={p.cy} className="pt" r="3.5" fill={stroke} tabIndex={i === 0 ? 0 : -1} role="img" data-chart-value={`${m.title}:${p.title}`} aria-label={p.title}><title>{p.title}</title></circle>)}
        {m.excluded.map((p, i) => <circle key={'x' + i} cx={p.cx} cy={p.cy} className="pt is-excluded" r="4" fill="none" stroke={stroke} tabIndex={!m.points.length && i === 0 ? 0 : -1} role="img" data-chart-value={`${m.title}:excluded:${p.title}`} aria-label={p.title}><title>{p.title}</title></circle>)}
        <text className="axis" x="55" y="201" textAnchor="middle">{m.axis.lo}</text>
        <text className="axis" x="645" y="201" textAnchor="middle">{m.axis.hi}</text>
        <text className="axis axis-title" x="350" y="223" textAnchor="middle">Tyre age (laps) · vertical scale: seconds above this run's best lap</text>
      </svg>
      {laps}
    </div>
  );
}
