import {color, finite, fmt, signed} from '../../performance-format.js';
import {TeamLabel, type TeamLike} from './TeamLabel';

type Row = TeamLike & Record<string, unknown> & {missingReason?: string; traceProvisional?: boolean};
export type BarChartOptions = {
  title?: string; subtitle?: string; valueKey?: string; labelKey?: string; colorKey?: string;
  unit?: string; digits?: number; signedValue?: boolean; zeroBaseline?: boolean;
  preserveSignedValues?: boolean; invertBest?: boolean;
};

/**
 * Ranked horizontal bars (`.performance-chart-card`), the component form of
 * renderHorizontalBarChart in car-performance.js: same scaling, rebasing to
 * the best entrant, and unranked rows for missing values (never zero).
 */
export function BarChart({rows, options = {}}: {rows: Row[]; options?: BarChartOptions}) {
  const {title = '', subtitle = '', valueKey = 'value', labelKey = 'team', colorKey = 'color', unit = '%', digits = 3,
    signedValue = true, zeroBaseline = true, preserveSignedValues = false, invertBest = false} = options;
  const valid = (rows || []).filter(r => r && finite(r[valueKey] as number)).map(r => ({...r, chart: 0}));
  const missing = (rows || []).filter(r => r && !finite(r[valueKey] as number));
  const unranked = missing.map((r, i) => (
    <div key={'missing' + i} className="performance-bar-row is-unranked" title={r.missingReason || 'No comparable supported measurement; not zero'}>
      <div className="performance-bar-label"><TeamLabel team={r} /></div>
      <div className="performance-bar-track" />
      <span className="performance-bar-val">Unranked</span>
    </div>
  ));
  if (!valid.length) return missing.length ? (
    <div className="performance-chart-card"><h4 className="perf-chart-heading">{title}</h4><div className="performance-bars">{unranked}</div></div>
  ) : null;

  const values = valid.map(r => r[valueKey] as number);
  if (signedValue && !preserveSignedValues) {
    const best = invertBest ? Math.max(...values) : Math.min(...values);
    for (const r of valid) r.chart = Math.max(0, invertBest ? best - (r[valueKey] as number) : (r[valueKey] as number) - best);
    valid.sort((a, b) => a.chart - b.chart);
  } else {
    for (const r of valid) r.chart = r[valueKey] as number;
    valid.sort((a, b) => invertBest ? b.chart - a.chart : a.chart - b.chart);
  }
  const charted = valid.map(r => r.chart);
  const lo = zeroBaseline ? Math.min(0, ...charted) : Math.min(...charted);
  const hi = Math.max(lo + 0.001, ...charted, preserveSignedValues ? 0 : -Infinity);
  const span = Math.max(0.0001, hi - lo);
  const zero = (-lo / span) * 100;

  return (
    <div className="performance-chart-card">
      {title ? (
        <div className="perf-chart-header"><div className="perf-chart-title-group">
          <h4 className="perf-chart-heading">{title}</h4>
          {subtitle ? <span className="perf-chart-sub">{subtitle}</span> : null}
        </div></div>
      ) : null}
      <div className="performance-bars">
        {valid.map((r, i) => {
          const value = r.chart, position = ((value - lo) / span) * 100;
          const left = preserveSignedValues ? Math.min(zero, position) : 0;
          const width = preserveSignedValues ? Math.abs(position - zero) : Math.min(100, Math.max(value > 0.00001 ? 2 : 0, position));
          const display = preserveSignedValues ? signed(value, digits, unit) : signedValue
            ? (value <= 0.00001 ? fmt(0, digits, unit) : `+${fmt(value, digits, unit)}`) : fmt(value, digits, unit);
          const gain = signedValue ? (preserveSignedValues ? (value < 0 ? 'is-gain' : 'is-loss') : value <= 0.00001 ? 'is-gain' : 'is-loss') : '';
          const label = String(r[labelKey] || r.team || r.name || '');
          return (
            <div key={label + i} className="performance-bar-row"
              title={`${label}: ${display}${r.traceProvisional ? ' · Provisional: source gaps over 0.6 s; inspect corner evidence' : ''}`}>
              <div className="performance-bar-label"><TeamLabel team={r} /></div>
              <div className="performance-bar-track">
                {preserveSignedValues ? <i className="performance-zero" style={{left: `${zero.toFixed(2)}%`}} /> : null}
                <i className="performance-bar" style={{'--bar-color': color(r[colorKey] as string), left: `${left.toFixed(2)}%`, width: `${width.toFixed(2)}%`} as React.CSSProperties} />
              </div>
              <span className={`performance-bar-val ${gain}`.trim()}>{r.traceProvisional ? '≈ ' : ''}{display}</span>
            </div>
          );
        })}
        {unranked}
      </div>
    </div>
  );
}
