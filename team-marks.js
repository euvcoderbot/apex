/* Team marks drawn by the app itself: a rounded tile tinted in the team colour with a short code (MER, FER, RBR...).
   They replace the teams' logos, which are third-party trademarks the site has no licence to publish. The colour is set
   on the element (--team-mark) and mixed toward the text colour in CSS, so a dark team colour stays readable in Dark and
   a pale one in Light. Shared by every view: session-state.js (teamLogoMarkup), performance-identity.js and the React tables. */
(() => {
  // Current teams and the ones raced since 2014; colours are the teams' racing colours (formula1.com for current teams, as in team-colours.js).
  const TEAMS = {
    'mercedes': ['MER', '#27f4d2'], 'ferrari': ['FER', '#e8002d'], 'red bull racing': ['RBR', '#3671c6'], 'mclaren': ['MCL', '#ff8000'],
    'racing bulls': ['RB', '#6692ff'], 'alpine': ['ALP', '#00a1e8'], 'haas': ['HAA', '#b6babd'], 'audi': ['AUD', '#ff2d00'],
    'williams': ['WIL', '#1868db'], 'aston martin': ['AMR', '#229971'], 'cadillac': ['CAD', '#aaaaad'],
    'kick sauber': ['SAU', '#52e252'], 'sauber': ['SAU', '#9b0000'], 'alfa romeo': ['ALF', '#900000'],
    'alphatauri': ['AT', '#4e7c9b'], 'toro rosso': ['STR', '#469bff'], 'racing point': ['RP', '#f596c8'], 'force india': ['FI', '#ff80c7'],
    'renault': ['REN', '#fff500'], 'lotus': ['LOT', '#ffb800'], 'manor': ['MAN', '#c4102e'], 'marussia': ['MAR', '#6e0000'], 'caterham': ['CAT', '#048646'],
  };
  // Team names arrive in many spellings across 2014-2026 (sponsor names, "F1 Team" suffixes, constructor vs entrant): the first
  // pattern that fits picks the team, so "Oracle Red Bull Racing" or "Visa Cash App RB F1 Team" still get their mark.
  const PATTERNS = [
    [/kick sauber|stake/, 'kick sauber'], [/alfa romeo/, 'alfa romeo'], [/sauber/, 'sauber'],
    [/red bull racing|^red bull|oracle red bull/, 'red bull racing'], [/racing bulls|visa cash app|^rb$|^rb |rb f1/, 'racing bulls'],
    [/alphatauri|alpha tauri/, 'alphatauri'], [/toro rosso/, 'toro rosso'], [/force india/, 'force india'], [/racing point/, 'racing point'],
    [/renault/, 'renault'], [/alpine/, 'alpine'], [/aston martin/, 'aston martin'], [/williams/, 'williams'], [/haas/, 'haas'],
    [/mclaren/, 'mclaren'], [/mercedes/, 'mercedes'], [/ferrari/, 'ferrari'], [/lotus/, 'lotus'], [/manor/, 'manor'], [/marussia/, 'marussia'],
    [/caterham/, 'caterham'], [/audi/, 'audi'], [/cadillac/, 'cadillac'],
  ];
  function teamMark(teamName) {
    const name = String(teamName || '').trim().toLowerCase();
    if (!name) return null;
    const key = TEAMS[name] ? name : PATTERNS.find(([pattern]) => pattern.test(name))?.[1];
    if (!key) return null;
    const [code, colour] = TEAMS[key];
    return {key: key.replace(/ /g, '-'), code, colour};
  }
  function teamMarkMarkup(teamName) {
    const mark = teamMark(teamName);
    if (!mark) return '<span class="team-logo" aria-hidden="true"><i class="team-logo-fallback"></i></span>';
    // The code is drawn by CSS (::after from data-code), so it is not part of the page's text: a team cell still reads and copies
    // as "Red Bull Racing", not "RBRRed Bull Racing".
    return `<span class="team-logo team-mark" data-team-mark="${mark.key}" data-code="${mark.code}" style="--team-mark:${mark.colour}" aria-hidden="true"></span>`;
  }
  window.ApexTeamMarks = {teamMark, teamMarkMarkup};
})();
