import type {ReactNode} from 'react';

/** A table value with its qualifying note underneath (`value<small>note</small>`). */
export function ValueNote({value, note, badge}: {value: ReactNode; note?: ReactNode; badge?: string}) {
  return (
    <>
      {value}
      {badge ? <> <span className="perf-tercile-badge is-mid">{badge}</span></> : null}
      {note ? <small>{note}</small> : null}
    </>
  );
}
