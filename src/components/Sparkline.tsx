import {color, fmt} from '../../performance-format.js';

export type SparkPoint = {round: number; event: string; pace: number};

/**
 * Qualifying gap by round on a scale shared by every row (`.trend-sparkline`).
 * Consecutive rounds are joined; a missing round breaks the line rather than
 * being filled in.
 */
export function Sparkline({label, points, teamColor, lo, hi, ceiling}: {
  label: string; points: SparkPoint[]; teamColor?: string; lo: number; hi: number; ceiling: number;
}) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return <>—</>;
  const x = (round: number) => 8 + (round - lo) / Math.max(1, hi - lo) * 164;
  const y = (pace: number) => 38 - pace / ceiling * 30;
  const stroke = color(teamColor);
  const path = points.map((q, i) => `${i && q.round - points[i - 1].round === 1 ? 'L' : 'M'}${x(q.round).toFixed(2)},${y(q.pace).toFixed(2)}`).join(' ');
  return (
    <div className="trend-sparkline">
      <svg viewBox="0 0 180 46" role="img" aria-label={`${label} qualifying gap by round; common scale across teams`}>
        <line x1="8" y1="39" x2="172" y2="39" stroke="var(--border-color)" />
        <path d={path} fill="none" stroke={stroke} strokeWidth="2" />
        {points.map(q => (
          <circle key={q.round} cx={x(q.round)} cy={y(q.pace)} r="3" fill={stroke}>
            <title>{`R${q.round} · ${q.event} · ${fmt(q.pace, 3, '%')}`}</title>
          </circle>
        ))}
      </svg>
      <div className="performance-trend-label"><span>R{lo}</span><span>R{hi}</span></div>
    </div>
  );
}
