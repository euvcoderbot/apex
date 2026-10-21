import type {ReactNode} from 'react';

/** A dashboard card: title, explanatory note, body (`.performance-card`). */
export function Card({title, note, children}: {title: string; note?: string; children?: ReactNode}) {
  return (
    <section className="dashboard-card performance-card">
      <div className="panel-heading"><h2>{title}</h2></div>
      {note ? <p className="performance-note">{note}</p> : null}
      <div className="performance-card-body">{children}</div>
    </section>
  );
}
