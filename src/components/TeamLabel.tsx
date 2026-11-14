import type {CSSProperties} from 'react';
import {color} from '../../performance-format.js';
import {teamLogoMarkup, grandPrixCountryCode} from '../../performance-identity.js';

export type TeamLike = {team?: string; name?: string; displayName?: string; logoTeam?: string; color?: string};

/** Team mark, resolved by the session's own team name (historical sessions keep their team's mark); drawn by team-marks.js. */
export function TeamLogo({team}: {team?: string}) {
  // The markup is built from a fixed table of codes and colours, never from the team name itself.
  return <span style={{display: 'contents'}} dangerouslySetInnerHTML={{__html: teamLogoMarkup(team)}} />;
}

type Faces = {srcByCode?: (code: string) => string | null};

/** Team logo, colour dot and name (`.performance-team`). A driver (named by code, 'VER' or 'VER · Red Bull Racing') shows
 *  their photo on the team colour in place of the dot, as the Season pages do. */
export function TeamLabel({team}: {team: TeamLike | string}) {
  const t: TeamLike = typeof team === 'object' && team !== null ? team : {team: String(team || '')};
  const name = t.displayName || t.team || t.name || '';
  const teamColor = t.color ? color(t.color) : 'var(--ui-label)';
  const code = String(t.displayName || t.name || '').split(' · ')[0];
  const faces = typeof window !== 'undefined' ? (window as unknown as {apexDriverFaces?: Faces}).apexDriverFaces : undefined;
  const photo = /^[A-Z]{3}$/.test(code) ? faces?.srcByCode?.(code) : null;
  return (
    <div className={`performance-team${photo ? ' has-face' : ''}`} style={{'--team-color': teamColor} as CSSProperties}>
      <TeamLogo team={t.logoTeam || t.team || name} />
      {photo ? <img className="driver-face" src={photo} alt="" aria-hidden="true" loading="lazy" decoding="async" style={{'--team': teamColor} as CSSProperties} />
        : <span className="team-dot" style={{backgroundColor: teamColor}} />}
      <span className="team-name">{name}</span>
    </div>
  );
}

/** Grand Prix flag and name (`.performance-event-cell`). */
export function EventLabel({event}: {event: string}) {
  const code = grandPrixCountryCode(event);
  return (
    <span className="performance-event-cell">
      {code ? <img className="gp-flag" src={`assets/flags/${code.toLowerCase()}.svg`} alt={code} width={22} height={16} /> : null}
      <span>{event}</span>
    </span>
  );
}
