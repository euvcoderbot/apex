import type {CSSProperties, ReactNode} from 'react';

/** Sort state computed by car-performance.js (sortHeaderModel), rendered here. */
export type SortHeaderModel = {key: string; label: string; state: 'ascending' | 'descending' | 'none'; group: string; direction: number};
export type Header = string | SortHeaderModel;

const SORT_PATHS = {ascending: 'M3 8 6 5 9 8', descending: 'M3 5 6 8 9 5', none: 'M3 7 6 4 9 7 M3 11 6 14 9 11'};

/** Sortable column header: the page's delegated handler owns the click. */
export function SortHeader({model}: {model: SortHeaderModel}) {
  return (
    <button className={`perf-sort-btn ${model.state !== 'none' ? 'is-sorted' : ''}`.trim()} data-sort-state={model.state}
      data-performance-sort={model.key} data-sort-table={model.group} data-sort-direction={model.direction}
      title={`Sort by ${model.label}`} type="button">
      <span>{model.label}</span>
      <svg className="sort-icon" aria-hidden="true" width="12" height="16" viewBox="0 0 12 18" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={SORT_PATHS[model.state]} /></svg>
    </button>
  );
}

/** A shaded column: each row's raw value (null when not measured) and which way is better. Deeper shading is better,
 *  as in the Season tables; the worst value gets none. */
export type HeatColumn = {col: number; values: (number | null | undefined)[]; better: 'high' | 'low'};

function heatShare(column: HeatColumn, row: number): number | null {
  const v = column.values[row];
  const finite = column.values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (typeof v !== 'number' || !Number.isFinite(v) || finite.length < 2) return null;
  const lo = Math.min(...finite), hi = Math.max(...finite);
  if (hi === lo) return null;
  const share = (v - lo) / (hi - lo);
  return column.better === 'high' ? share : 1 - share;
}

/** Measurement table (`.performance-table` inside its own scrollable region). */
export function DataTable({headers, rows, heat = []}: {headers: Header[]; rows: ReactNode[][]; heat?: HeatColumn[]}) {
  const heatFor = (col: number) => heat.find(h => h.col === col);
  return (
    <div className={`performance-table-wrap${headers.length <= 6 ? ' is-compact-table' : ''}`} tabIndex={0} role="region" aria-label="Measurement table">
      <table className="performance-table">
        <thead><tr>{headers.map((h, i) => (
          <th key={i} scope="col" className={heatFor(i) ? 'perf-heat-head' : undefined} aria-sort={typeof h === 'object' && h.state !== 'none' ? h.state : undefined}>
            {typeof h === 'object' ? <SortHeader model={h} /> : h}
          </th>
        ))}</tr></thead>
        <tbody>
          {rows.length ? rows.map((row, i) => <tr key={i}>{row.map((cell, j) => {
            const column = heatFor(j);
            if (!column) return <td key={j}>{cell}</td>;
            const share = heatShare(column, i);
            return <td key={j} className="perf-heat-cell"><span className="perf-heat-value"
              style={share ? {'--heat': share.toFixed(3)} as CSSProperties : undefined}>{cell}</span></td>;
          })}</tr>)
            : <tr><td colSpan={headers.length} className="section-empty">No eligible data yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
