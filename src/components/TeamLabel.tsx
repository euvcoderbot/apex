import type {CSSProperties} from 'react';
import {color} from '../../performance-format.js';
import {officialTeamMarks, historicalTeamMarks, grandPrixCountryCode} from '../../performance-identity.js';

export type TeamLike = {team?: string; name?: string; displayName?: string; logoTeam?: string; color?: string};

/**
 * Team mark, resolved by the session's own team name (historical sessions keep
 * historical branding). Same rules as teamLogoMarkup in session-state.js:
 * official 2026 marks ship a colour and a mono version; the stylesheet shows
 * mono only where the colour mark is too dark for the dark appearance.
 */
export function TeamLogo({team}: {team?: string}) {
  const key = String(team || '').trim().toLowerCase();
  const historical = key === 'renault' || key === 'renault sport f1 team' ? 'renault.png' : historicalTeamMarks[key];
  if (historical) return (
    <span className="team-logo team-logo-historical" aria-hidden="true">
      <img src={`assets/teams/historical/${historical}`} alt="" width={26} height={26} />
    </span>
  );
  const asset = officialTeamMarks[key];
  if (!asset) return <span className="team-logo" aria-hidden="true"><i className="team-logo-fallback" /></span>;
  const base = asset.replace(/\.webp$/, '');
  return (
    <span className="team-logo team-logo-official" data-team-mark={base} aria-hidden="true">
      <img className="team-logo-color" src={`assets/teams/official/${base}-color.webp`} alt="" width={26} height={26} />
      <img className="team-logo-mono" src={`assets/teams/official/${asset}`} alt="" width={26} height={26} />
    </span>
  );
}

/** Team logo, colour dot and name (`.performance-team`). */
export function TeamLabel({team}: {team: TeamLike | string}) {
  const t: TeamLike = typeof team === 'object' && team !== null ? team : {team: String(team || '')};
  const name = t.displayName || t.team || t.name || '';
  const teamColor = t.color ? color(t.color) : 'var(--text-main)';
  return (
    <div className="performance-team" style={{'--team-color': teamColor} as CSSProperties}>
      <TeamLogo team={t.logoTeam || t.team || name} />
      <span className="team-dot" style={{backgroundColor: teamColor}} />
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
