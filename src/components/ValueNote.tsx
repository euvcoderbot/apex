import type {ReactNode} from 'react';

/** A table value with its qualifying note underneath (`value<small>note</small>`). */
export function ValueNote({value, note, badge}: {value: ReactNode; note?: ReactNode; badge?: string}) {
  return (
    <>
      {value}
      {badge ? <> <span className="perf-tercile-badge is-mid explanation-only">{badge}</span></> : null}
      {note ? <small className="explanation-only">{note}</small> : null}
    </>
  );
}
