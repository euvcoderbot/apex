import type {ReactNode} from 'react';

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

/** Measurement table (`.performance-table` inside its own scrollable region). */
export function DataTable({headers, rows}: {headers: Header[]; rows: ReactNode[][]}) {
  return (
    <div className={`performance-table-wrap${headers.length <= 6 ? ' is-compact-table' : ''}`} tabIndex={0} role="region" aria-label="Measurement table">
      <table className="performance-table">
        <thead><tr>{headers.map((h, i) => (
          <th key={i} scope="col" aria-sort={typeof h === 'object' && h.state !== 'none' ? h.state : undefined}>
            {typeof h === 'object' ? <SortHeader model={h} /> : h}
          </th>
        ))}</tr></thead>
        <tbody>
          {rows.length ? rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)
            : <tr><td colSpan={headers.length} className="section-empty">No eligible data yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
