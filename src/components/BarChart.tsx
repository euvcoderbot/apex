import {color, finite, fmt, signed} from '../../performance-format.js';
import {TeamLabel, type TeamLike} from './TeamLabel';
import {visibleBarValue} from '../../lib/chart-bar.mjs';

type Row = TeamLike & Record<string, unknown> & {missingReason?: string; traceProvisional?: boolean; coverageLabel?: string};
export type BarChartOptions = {
  title?: string; subtitle?: string; valueKey?: string; labelKey?: string; colorKey?: string;
  unit?: string; digits?: number; signedValue?: boolean; zeroBaseline?: boolean;
  preserveSignedValues?: boolean; invertBest?: boolean;
  /** Row key holding a [low, high] range for the value (same units, before rebasing): drawn as a whisker. */
  intervalKey?: string;
  /** Typical lap in seconds: a % gap is also shown as seconds per lap. */
  perLapSeconds?: number | null;
};

/**
 * Ranked horizontal bars (`.performance-chart-card`), the component form of
 * renderHorizontalBarChart in car-performance.js: same scaling, rebasing to
 * the best entrant, and unranked rows for missing values (never zero).
 */
export function BarChart({rows, options = {}}: {rows: Row[]; options?: BarChartOptions}) {
  const {title = '', subtitle = '', valueKey = 'value', labelKey = 'team', colorKey = 'color', unit = '%', digits = 3,
    signedValue = true, zeroBaseline = true, preserveSignedValues = false, invertBest = false, intervalKey, perLapSeconds = null} = options;
  const valid = (rows || []).filter(r => r && finite(r[valueKey] as number)).map((r): Row & {chart: number} => ({...r, chart: 0}));
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
  // Whiskers move with the bar: the same shift that puts the best entrant at zero.
  const range = (r: Row, shift: number): [number, number] | null => {
    const v = intervalKey ? r[intervalKey] as [number, number] | undefined : undefined;
    return v && finite(v[0]) && finite(v[1]) ? [Math.max(0, v[0] - shift), Math.max(0, v[1] - shift)] : null;
  };
  const ranges = new Map<Row, [number, number]>();
  if (signedValue && !preserveSignedValues) {
    const best = invertBest ? Math.max(...values) : Math.min(...values);
    for (const r of valid) { const w = !invertBest && range(r, best); if (w) ranges.set(r, w); }
    for (const r of valid) r.chart = Math.max(0, invertBest ? best - (r[valueKey] as number) : (r[valueKey] as number) - best);
    valid.sort((a, b) => a.chart - b.chart);
  } else {
    for (const r of valid) r.chart = r[valueKey] as number;
    valid.sort((a, b) => invertBest ? b.chart - a.chart : a.chart - b.chart);
  }
  const charted = valid.map(r => r.chart);
  const lo = zeroBaseline ? Math.min(0, ...charted) : Math.min(...charted);
  const hi = Math.max(lo + 0.001, ...charted, ...[...ranges.values()].map(w => w[1]), preserveSignedValues ? 0 : -Infinity);
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
      {new Set(rows.map(r => r.coverageLabel).filter(Boolean)).size > 1 ? <p className="performance-quality-status">GP coverage differs between entrants. These are averages over each entrant’s available GPs, not a comparison over identical races.</p> : null}
      <div className="performance-bars">
        {valid.map((r, i) => {
          const value = r.chart, plotted = visibleBarValue(value, digits), position = ((plotted - lo) / span) * 100;
          const left = preserveSignedValues ? Math.min(zero, position) : 0;
          const width = preserveSignedValues ? Math.abs(position - zero) : Math.min(100, Math.max(0, position));
          const display = preserveSignedValues ? signed(value, digits, unit) : signedValue
            ? (value <= 0.00001 ? fmt(0, digits, unit) : `+${fmt(value, digits, unit)}`) : fmt(value, digits, unit);
          const gain = signedValue ? (preserveSignedValues ? (value < 0 ? 'is-gain' : 'is-loss') : value <= 0.00001 ? 'is-gain' : 'is-loss') : '';
          const label = String(r[labelKey] || r.team || r.name || '');
          const whisker = ranges.get(r);
          // Not resolved: this entrant's range reaches the one ranked above it, so the order between them is within the noise.
          const above = i > 0 ? valid[i - 1] : null, aboveRange = above && ranges.get(above);
          const unresolved = !!(whisker && above && whisker[0] <= (aboveRange ? aboveRange[1] : above.chart));
          const seconds = perLapSeconds && unit === '%' && signedValue && !preserveSignedValues && value > 0.00001 ? value / 100 * perLapSeconds : null;
          return (
            <div key={label + i} className="performance-bar-row"
              title={`${label}: ${display}${seconds != null ? ` (about ${seconds.toFixed(2)} s per lap)` : ''}${whisker ? ` · likely range +${fmt(whisker[0], digits, unit)} to +${fmt(whisker[1], digits, unit)}` : ''}${unresolved ? ` · not resolved against ${String(above?.[labelKey] || above?.team || '')}` : ''}${plotted === 0 && value !== 0 ? ` · Exact change ${value}${unit}; below displayed precision` : ''}${r.traceProvisional ? ' · Provisional: source gaps over 0.6 s; inspect corner evidence' : ''}`}>
              <div className="performance-bar-label"><TeamLabel team={r} />{r.coverageLabel ? <small className="metric-coverage">{r.coverageLabel}</small> : null}</div>
              <div className="performance-bar-track">
                {preserveSignedValues ? <i className="performance-zero" style={{left: `${zero.toFixed(2)}%`}} /> : null}
                <i className="performance-bar" style={{'--bar-color': color(r[colorKey] as string), left: `${left.toFixed(2)}%`, width: `${width.toFixed(2)}%`} as React.CSSProperties} />
                {whisker ? <i className="performance-bar-range" aria-hidden="true" style={{left: `${((whisker[0] - lo) / span * 100).toFixed(2)}%`, width: `${((whisker[1] - whisker[0]) / span * 100).toFixed(2)}%`}} /> : null}
              </div>
              <span className={`performance-bar-val ${gain}${r.traceProvisional ? ' is-provisional' : ''}${unresolved ? ' is-unresolved' : ''}`.trim()}>
                {unresolved ? <abbr className="performance-level" title="Within the likely range of the team above: the order is not resolved">≈ </abbr> : null}{display}
                {seconds != null ? <small className="performance-bar-seconds">{seconds < 0.995 ? `${seconds.toFixed(2)} s` : `${seconds.toFixed(1)} s`}</small> : null}
              </span>
            </div>
          );
        })}
        {unranked}
      </div>
    </div>
  );
}
