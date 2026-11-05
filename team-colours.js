/* Team colours as Formula 1 shows them on formula1.com (its --f1-team-colour, 2026 season, read 2026-11-05).
   Session data carries the live-timing feed's palette, which differs for several teams (Red Bull #4781D7 in the feed,
   #3671C6 on formula1.com). This maps each feed colour to the formula1.com one when a colour is drawn; the data is not changed.
   Haas's #DEE1E2 is almost white, so on light backgrounds it uses formula1.com's own accessible Haas colour instead.
   Colours a person picks for a lap (lap colour overrides) never pass through here. */
(() => {
  const OFFICIAL = {
    '#4781d7': '#3671c6', // Red Bull Racing
    '#ed1131': '#e8002d', // Ferrari
    '#00d7b6': '#27f4d2', // Mercedes
    '#f47600': '#ff8000', // McLaren
    '#6c98ff': '#6692ff', // Racing Bulls
    '#f50537': '#ff2d00', // Audi
    '#909090': '#aaaaad', // Cadillac
    '#9c9fa2': '#dee1e2', // Haas F1 Team
    // Alpine #00a1e8, Aston Martin #229971 and Williams #1868db already match.
  };
  const ON_LIGHT = {'#dee1e2': '#667175'};
  function apexTeamColour(value) {
    const hex = String(value || '').toLowerCase();
    const official = OFFICIAL[hex] || hex;
    return document.documentElement.dataset.theme === 'light' ? ON_LIGHT[official] || official : official;
  }
  window.apexTeamColour = apexTeamColour;
})();
