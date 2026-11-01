import type {CSSProperties} from 'react';
import {color, signed} from '../../performance-format.js';
import {TeamLabel, type TeamLike} from './TeamLabel';

/**
 * Bars either side of zero (`.performance-tyre-age-chart`): left improves,
 * right worsens. Use the actual signed range, rather than reserving half the
 * entire chart for a tiny negative outlier. All rows share this same scale.
 */
export function DivergingBarChart({title, subtitle, rows, unit, extent, seriesKey}: {
  title: string; subtitle: string; rows: (TeamLike & {value: number})[]; unit: string; extent: number; seriesKey?: (row: TeamLike & {value: number}) => string;
}) {
  const minimum = Math.min(0,...rows.map(row=>row.value));
  const maximum = Math.max(0,...rows.map(row=>row.value));
  const span = maximum-minimum || extent || 1;
  const zero = -minimum/span*100;
  return (
    <div className="performance-chart-card">
      <div className="perf-chart-header"><div className="perf-chart-title-group">
        <h4 className="perf-chart-heading">{title}</h4><span className="perf-chart-sub">{subtitle}</span>
      </div></div>
      <div className="performance-tyre-age-chart">
        {rows.map((r, i) => {
          const width = Math.min(100, Math.abs(r.value) / span * 100);
          const left = r.value < 0 ? zero-width : zero;
          return (
            <div key={i} className="performance-tyre-age-row" data-trend-series={seriesKey?.(r)}>
              <div className="performance-tyre-age-name"><TeamLabel team={r} /></div>
              <div className="performance-tyre-age-track">
                <i className="performance-tyre-age-zero" style={{left:`${zero.toFixed(2)}%`}} />
                <i className="performance-tyre-age-bar" style={{'--bar-color': color(r.color), left: `${left.toFixed(2)}%`, width: `${width.toFixed(2)}%`} as CSSProperties} />
              </div>
              <span className="performance-tyre-age-value">{signed(r.value, 3, unit)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
