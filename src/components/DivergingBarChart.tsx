import type {CSSProperties} from 'react';
import {color, signed} from '../../performance-format.js';
import {TeamLabel, type TeamLike} from './TeamLabel';

/** Evidence counts ("19 GPs") show only on a row whose count differs from the most common one (usually fewer races),
 *  so a full field stays one line per entrant with no repeated count. */
function evidenceNote(rows: {evidenceLabel?: string}[]) {
  const counts = new Map<string, number>();
  for (const r of rows) if (r.evidenceLabel) counts.set(r.evidenceLabel, (counts.get(r.evidenceLabel) || 0) + 1);
  const common = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  return {common};
}

/**
 * Bars either side of zero (`.performance-tyre-age-chart`): left improves,
 * right worsens. Use the actual signed range, rather than reserving half the
 * entire chart for a tiny negative outlier. All rows share this same scale.
 */
export function DivergingBarChart({title, subtitle, rows, unit, extent, seriesKey}: {
  title: string; subtitle: string; rows: (TeamLike & {value: number; evidenceLabel?: string})[]; unit: string; extent: number; benchmark?: string; seriesKey?: (row: TeamLike & {value: number}) => string;
}) {
  // The scale comes from the field, not from one outlier: with eight or more rows, a value beyond three interquartile ranges
  // of the quartiles (one driver with a single odd stint) does not set it. Its bar runs to the edge with a break near the end
  // (is-capped); its number is shown as it is.
  const sorted = rows.map(row => row.value).sort((a, b) => a - b);
  const quantile = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
  const iqr = sorted.length >= 8 ? quantile(.75) - quantile(.25) : 0;
  const fenceLow = iqr > 0 ? quantile(.25) - 3 * iqr : -Infinity, fenceHigh = iqr > 0 ? quantile(.75) + 3 * iqr : Infinity;
  const inside = sorted.filter(v => v >= fenceLow && v <= fenceHigh);
  const minimum = Math.min(0, ...inside);
  const maximum = Math.max(0, ...inside);
  const span = maximum-minimum || extent || 1;
  const zero = -minimum/span*100;
  const evidence = evidenceNote(rows);
  return (
    <div className={`performance-chart-card${rows.length > 14 ? ' is-long' : ''}`}>
      <div className="perf-chart-header"><div className="perf-chart-title-group">
        <h4 className="perf-chart-heading">{title}</h4><span className="perf-chart-sub">{subtitle}</span>
      </div></div>
      <div className="performance-tyre-age-chart">
        {rows.map((r, i) => {
          const capped = r.value > maximum || r.value < minimum;
          const width = capped ? (r.value < 0 ? zero : 100 - zero) : Math.min(100, Math.abs(r.value) / span * 100);
          const left = r.value < 0 ? zero-width : zero;
          return (
            <div key={i} className="performance-tyre-age-row" data-trend-series={seriesKey?.(r)} role="img" data-chart-value={`${title}:${seriesKey?.(r) || r.displayName || r.team || r.name || i}`} tabIndex={i === 0 ? 0 : -1} aria-label={`${r.displayName || r.team || r.name || ''}: ${signed(r.value, 3, unit)}${r.evidenceLabel ? ` · ${r.evidenceLabel}` : ''}`}>
              {/* In a long list (two columns) a driver is named by code alone; the dot carries the team. */}
              <div className="performance-tyre-age-name rank-label"><TeamLabel team={rows.length > 14 && r.displayName ? {...r, displayName: String(r.displayName).split(' · ')[0]} : r} />{r.evidenceLabel && r.evidenceLabel !== evidence.common ? <small className="rank-evidence">{r.evidenceLabel}</small> : null}</div>
              <div className="performance-tyre-age-track">
                <i className="performance-tyre-age-zero" style={{left:`${zero.toFixed(2)}%`}} />
                <i className={`performance-tyre-age-bar${capped ? (r.value < 0 ? ' is-capped is-low' : ' is-capped') : ''}`} title={capped ? 'Beyond the scale: an outlier' : undefined} style={{'--bar-color': color(r.color), left: `${left.toFixed(2)}%`, width: `${width.toFixed(2)}%`} as CSSProperties} />
              </div>
              <span className="performance-tyre-age-value">{signed(r.value, 3, unit)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
