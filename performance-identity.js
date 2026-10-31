// Car performance: who and where. Team marks, Grand Prix flags and the
// verified Pirelli dry allocations. No page state.
import {escape, color} from './performance-format.js';

// Pirelli's weekend labels are relative: the same MEDIUM can be C2, C3, C4 or C5.
// Each entry is [Hard, Medium, Soft] in championship round order. Never infer
// an exact grade from the relative label without a year + verified race allocation.
// Sources: the race-by-race Pirelli nominations in the supplied 2021-2026
// workbook, cross-checked against the Pirelli releases linked below.
//          https://press.pirelli.com/2021-tyre-compound-choices/
//          https://press.pirelli.com/?h=1&t=2022+Tyre+Compound+Choices
//          https://press.pirelli.com/?h=1&t=2023+Tyre+Compound+Choices
//          https://press.pirelli.com/?h=1&t=2024+Tyre+Compound+Choices
//          https://press.pirelli.com/?h=1&t=2025+tyre+compound+choices
//          https://press.pirelli.com/?h=1&t=2026+tyre+compound+choices
export const VERIFIED_DRY_ALLOCATIONS = Object.freeze({
  2021: '234 234 123 123 345 345 234 234 345 123 234 234 123 234 345 234 234 234 234 123 234 345'.split(' '),
  2022: '123 234 235 234 234 123 345 345 345 123 345 234 234 234 123 234 345 123 234 234 234 345'.split(' '),
  2023: '123 234 234 345 234 345 123 345 345 123 345 234 123 345 345 123 123 234 345 234 345 345'.split(' '),
  2024: '123 234 345 123 234 234 345 345 345 123 345 123 345 234 123 345 345 345 234 345 345 345 123 345'.split(' '),
  2025: '345 234 123 123 345 345 456 456 123 456 345 234 134 345 234 345 456 345 134 245 234 345 123 345'.split(' '),
  // https://press.pirelli.com/the-compound-selection-for-austin-mexico-city-and-so-paulo/
  // Pirelli's 9 October announcement: Austin C2–C4; Mexico and São Paulo C3–C5.
  2026: '345 234 123 345 345 345 234 345 123 234 345 234 345 234 345 234 345 234 345 345'.split(' ')
});
export const TYRE_ALLOCATION_SOURCES = Object.freeze({
  2021: 'https://press.pirelli.com/2021-tyre-compound-choices/',
  2022: 'https://press.pirelli.com/?h=1&t=2022+Tyre+Compound+Choices',
  2023: 'https://press.pirelli.com/?h=1&t=2023+Tyre+Compound+Choices',
  2024: 'https://press.pirelli.com/?h=1&t=2024+Tyre+Compound+Choices',
  2025: 'https://press.pirelli.com/?h=1&t=2025+tyre+compound+choices',
  2026: 'https://press.pirelli.com/?h=1&t=2026+tyre+compound+choices'
});
export function verifiedDryGrade(year, raceRound, relativeCompound) {
  const allocation = VERIFIED_DRY_ALLOCATIONS[year]?.[Number(raceRound)-1];
  const position = {HARD:0, MEDIUM:1, SOFT:2}[String(relativeCompound || '').toUpperCase()];
  return allocation && position !== undefined ? `C${allocation[position]}` : null;
}

// Team marks - exact match with Session Analysis
export const officialTeamMarks = {
  'mercedes': 'mercedes.webp', 'ferrari': 'ferrari.webp', 'mclaren': 'mclaren.webp',
  'red bull racing': 'redbullracing.webp', 'red bull': 'redbullracing.webp',
  'racing bulls': 'racingbulls.webp', 'rb': 'racingbulls.webp',
  'alpine': 'alpine.webp', 'alpine f1 team': 'alpine.webp',
  'haas': 'haasf1team.webp', 'haas f1 team': 'haasf1team.webp',
  'audi': 'audi.webp', 'williams': 'williams.webp',
  'aston martin': 'astonmartin.webp', 'cadillac': 'cadillac.webp',
};

export const historicalTeamMarks = {
  'sauber': 'sauber.svg', 'kick sauber': 'kick-sauber', 'stake f1 team kick sauber': 'kick-sauber',
  'alfa romeo': 'alfa-romeo.svg', 'alfa romeo racing': 'alfa-romeo.svg', 'alfa romeo sauber': 'sauber.svg',
  'alphatauri': 'alphatauri.svg', 'alpha tauri': 'alphatauri.svg', 'scuderia alphatauri': 'alphatauri.svg',
  'toro rosso': 'toro-rosso.svg', 'scuderia toro rosso': 'toro-rosso.svg',
  'racing point': 'racing-point.svg', 'force india': 'force-india.png',
  'lotus': 'lotus.png', 'lotus f1 team': 'lotus.png', 'manor': 'manor.png', 'manor racing': 'manor.png',
  'marussia': 'marussia.png', 'manor marussia': 'marussia.png', 'caterham': 'caterham.png',
};

export function teamLogoMarkup(teamName) {
  if (typeof window !== 'undefined' && typeof window.teamLogoMarkup === 'function') {
    return window.teamLogoMarkup(teamName);
  }
  const key = String(teamName || '').trim().toLowerCase();
  if (key === 'renault' || key === 'renault sport f1 team') {
    return '<span class="team-logo team-logo-historical" aria-hidden="true"><img src="assets/teams/historical/renault.png" alt="" width="24" height="24"></span>';
  }
  const historical = historicalTeamMarks[key];
  // Kick Sauber: transparent black and white wordmarks, swapped by appearance like the official marks.
  if (historical === 'kick-sauber') return `<span class="team-logo team-logo-official" data-team-mark="kick-sauber" aria-hidden="true"><img class="team-logo-color" src="assets/teams/historical/kick-sauber-black.webp" alt="" width="24" height="24"><img class="team-logo-mono" src="assets/teams/historical/kick-sauber-white.webp" alt="" width="24" height="24"></span>`;
  if (historical) {
    return `<span class="team-logo team-logo-historical" aria-hidden="true"><img src="assets/teams/historical/${historical}" alt="" width="24" height="24"></span>`;
  }
  const asset = officialTeamMarks[key];
  if (!asset) {
    return '<span class="team-logo" aria-hidden="true"><i class="team-logo-fallback"></i></span>';
  }
  return `<span class="team-logo" aria-hidden="true"><img src="assets/teams/official/${asset}" alt="" width="24" height="24"></span>`;
}

// Grand Prix Flag Resolution
export const COUNTRY_FLAG_CODES = Object.freeze({
  australia: 'AU', austria: 'AT', azerbaijan: 'AZ', bahrain: 'BH', belgium: 'BE',
  brazil: 'BR', canada: 'CA', china: 'CN', france: 'FR', germany: 'DE',
  'great britain': 'GB', hungary: 'HU', india: 'IN', italy: 'IT', japan: 'JP',
  korea: 'KR', malaysia: 'MY', mexico: 'MX', monaco: 'MC', netherlands: 'NL',
  portugal: 'PT', qatar: 'QA', russia: 'RU', 'saudi arabia': 'SA', singapore: 'SG',
  'south korea': 'KR', spain: 'ES', turkey: 'TR', 'united arab emirates': 'AE',
  'united kingdom': 'GB', 'united states': 'US', usa: 'US',
});

export const GRAND_PRIX_FLAG_RULES = Object.freeze([
  ['70th anniversary', 'GB'], ['abu dhabi', 'AE'], ['australian', 'AU'], ['austrian', 'AT'],
  ['azerbaijan', 'AZ'], ['bahrain', 'BH'], ['belgian', 'BE'], ['brazilian', 'BR'],
  ['british', 'GB'], ['canadian', 'CA'], ['chinese', 'CN'], ['dutch', 'NL'],
  ['eifel', 'DE'], ['emilia romagna', 'IT'], ['european', 'AZ'], ['french', 'FR'],
  ['german', 'DE'], ['hungarian', 'HU'], ['indian', 'IN'], ['italian', 'IT'],
  ['japanese', 'JP'], ['korean', 'KR'], ['las vegas', 'US'], ['malaysian', 'MY'],
  ['mexico', 'MX'], ['miami', 'US'], ['monaco', 'MC'], ['pacific', 'JP'],
  ['portuguese', 'PT'], ['qatar', 'QA'], ['russian', 'RU'], ['sakhir', 'BH'],
  ['san marino', 'IT'], ['saudi arabian', 'SA'], ['singapore', 'SG'], ['sao paulo', 'BR'],
  ['spanish', 'ES'], ['styrian', 'AT'], ['turkish', 'TR'], ['tuscan', 'IT'],
  ['united states', 'US'],
]);

export function grandPrixCountryCode(event) {
  if (typeof window !== 'undefined' && typeof window.grandPrixCountryCode === 'function') {
    return window.grandPrixCountryCode(event);
  }
  const country = String(event?.country || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const eventName = String(event?.name || event || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return COUNTRY_FLAG_CODES[country]
    || GRAND_PRIX_FLAG_RULES.find(([name]) => eventName.includes(name))?.[1];
}

export function gpFlagMarkup(eventName) {
  const code = grandPrixCountryCode(eventName);
  if (!code) return '';
  return `<img class="gp-flag" src="assets/flags/${code.toLowerCase()}.svg" alt="${code}" width="22" height="16">`;
}

export function eventLabel(eventName) {
  const flag = gpFlagMarkup(eventName);
  return `<span class="performance-event-cell">${flag}<span>${escape(eventName)}</span></span>`;
}

export const teamLabel = team => {
  const t = typeof team === 'object' && team !== null ? team : { team: String(team || '') };
  const teamName = t.displayName || t.team || t.name || '';
  const teamColor = t.color ? color(t.color) : 'var(--text-main)';
  return `
  <div class="performance-team" style="--team-color:${teamColor}">
    ${teamLogoMarkup(t.logoTeam || t.team || teamName)}
    <span class="team-dot" style="background-color:${teamColor}"></span>
    <span class="team-name">${escape(teamName)}</span>
  </div>`;
};
