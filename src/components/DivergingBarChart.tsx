import type {CSSProperties} from 'react';
import {color, signed} from '../../performance-format.js';
import {TeamLabel, type TeamLike} from './TeamLabel';

/**
 * Bars either side of zero (`.performance-tyre-age-chart`): left improves,
 * right worsens, scaled to the largest magnitude shown.
 */
export function DivergingBarChart({title, subtitle, rows, unit, extent}: {
  title: string; subtitle: string; rows: (TeamLike & {value: number})[]; unit: string; extent: number;
}) {
  return (
    <div className="performance-chart-card">
      <div className="perf-chart-header"><div className="perf-chart-title-group">
        <h4 className="perf-chart-heading">{title}</h4><span className="perf-chart-sub">{subtitle}</span>
      </div></div>
      <div className="performance-tyre-age-chart">
        {rows.map((r, i) => {
          const width = Math.min(50, Math.abs(r.value) / extent * 50);
          return (
            <div key={i} className="performance-tyre-age-row">
              <div className="performance-tyre-age-name"><TeamLabel team={r} /></div>
              <div className="performance-tyre-age-track">
                <i className="performance-tyre-age-zero" />
                <i className="performance-tyre-age-bar" style={{'--bar-color': color(r.color), left: `${r.value < 0 ? (50 - width).toFixed(2) : '50'}%`, width: `${width.toFixed(2)}%`} as CSSProperties} />
              </div>
              <span className="performance-tyre-age-value">{signed(r.value, 3, unit)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
