const KIND: Record<string, [string, string]> = {
  'PU-related': ['is-pu', 'Power unit'],
  'Chassis / team-related': ['is-chassis', 'Chassis'],
  'Incident / collision': ['is-incident', 'Incident'],
  'Other confirmed': ['is-other', 'Other'],
};

/** Retirement cause badge (`.retirement-badge`); unknown causes stay "Unknown". */
export function RetirementBadge({category}: {category: string}) {
  const [modifier, label] = KIND[category] || ['is-unknown', 'Unknown'];
  return <span className={`retirement-badge ${modifier}`}>{label}</span>;
}

/** A count in a coloured badge, or a plain 0. */
export function CountBadge({count, kind}: {count: number; kind: 'pu' | 'chassis' | 'incident' | 'other'}) {
  return count > 0 ? <span className={`retirement-badge is-${kind}`}>{count}</span> : <>0</>;
}
