import {color, fmt} from '../../performance-format.js';

export type SparkPoint = {round: number; event: string; pace: number};
export type SparkFit = {round: number; pace: number}[] | null;

/**
 * Qualifying gap by round on a scale shared by every row (`.trend-sparkline`).
 * Consecutive rounds are joined; a missing round breaks the line rather than
 * being filled in.
 */
export function Sparkline({label, points, teamColor, lo, hi, ceiling, fit}: {
  label: string; points: SparkPoint[]; teamColor?: string; lo: number; hi: number; ceiling: number; fit?: SparkFit;
}) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return <>—</>;
  const x = (round: number) => `${4 + (round - lo) / Math.max(1, hi - lo) * 92}%`;
  const y = (pace: number) => 24 - pace / ceiling * 20;
  const stroke = color(teamColor);
  return (
    <div className="trend-sparkline">
      <svg width="100%" height="28" role="img" aria-label={`${label} qualifying gap by round; common scale across teams`}>
        <line x1="4%" y1="25" x2="96%" y2="25" stroke="var(--ui-border)" />
        {fit?.length === 2 ? <line data-trend-fit="" x1={x(fit[0].round)} y1={y(fit[0].pace)} x2={x(fit[1].round)} y2={y(fit[1].pace)} stroke="var(--ui-secondary)" strokeWidth="1.5" strokeDasharray="4 3"><title>Robust fitted trend through these same observations</title></line> : null}
        {points.map((q, i) => i && q.round - points[i - 1].round === 1 ? <line key={`segment-${q.round}`} data-trend-segment="" x1={x(points[i - 1].round)} y1={y(points[i - 1].pace)} x2={x(q.round)} y2={y(q.pace)} stroke={stroke} strokeWidth="2" /> : null)}
        {points.map(q => (
          <circle key={q.round} cx={x(q.round)} cy={y(q.pace)} r="2.5" fill={stroke}>
            <title>{`R${q.round} · ${q.event} · ${fmt(q.pace, 3, '%')}`}</title>
          </circle>
        ))}
      </svg>
      <div className="performance-trend-label"><span>R{lo}</span><span>R{hi}</span></div>
    </div>
  );
}
