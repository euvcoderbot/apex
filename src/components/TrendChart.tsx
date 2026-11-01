import {color, fmt} from '../../performance-format.js';

export type SparkPoint = {round: number; event: string; pace: number};
export type SparkFit = {round: number; pace: number}[] | null;
export type TrendSeries = {key: string; label: string; teamColor?: string; points: SparkPoint[]; fit?: SparkFit};

const HEIGHT = 400, TOP = 14, BOTTOM = 26;
const STEPS = [.05, .1, .2, .25, .5, 1, 2, 5];

/**
 * Every team's qualifying gap by round on one shared scale, quickest at the top
 * (`.trend-chart`). Consecutive rounds are joined; a missing round breaks the
 * line rather than being filled in.
 */
export function TrendChart({series, lo, hi, ceiling}: {series: TrendSeries[]; lo: number; hi: number; ceiling: number}) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !series.length) return <>—</>;
  const x = (round: number) => `${7 + (round - lo) / Math.max(1, hi - lo) * 89}%`;
  const y = (pace: number) => TOP + pace / ceiling * (HEIGHT - TOP - BOTTOM);
  const step = STEPS.find(value => ceiling / value <= 5) || ceiling;
  const ticks = Array.from({length: Math.floor(ceiling / step) + 1}, (_, index) => index * step);
  const rounds = [...new Set(series.flatMap(line => line.points.map(point => point.round)))].sort((a, b) => a - b);
  const every = Math.max(1, Math.ceil(rounds.length / 12));
  return (
    <div className="trend-chart">
      <svg width="100%" height={HEIGHT} role="img" aria-label="Qualifying gap by round for each team; common scale across teams">
        {ticks.map(tick => <g key={tick}>
          <line x1="7%" x2="96%" y1={y(tick)} y2={y(tick)} stroke="var(--ui-separator)" />
          <text x="5.5%" y={y(tick) + 4} textAnchor="end" className="trend-axis">{fmt(tick, step < .1 ? 2 : 1, '%')}</text>
        </g>)}
        {rounds.filter((_, index) => index % every === 0).map(round => <text key={round} x={x(round)} y={HEIGHT - 6} textAnchor="middle" className="trend-axis">R{round}</text>)}
        {series.map(line => {
          const stroke = color(line.teamColor);
          return (
            <g key={line.key} data-trend-series={line.key} className="trend-series">
              {line.fit?.length === 2 ? <line data-trend-fit="" x1={x(line.fit[0].round)} y1={y(line.fit[0].pace)} x2={x(line.fit[1].round)} y2={y(line.fit[1].pace)} stroke={stroke} strokeOpacity=".55" strokeWidth="1.5" strokeDasharray="4 3"><title>{`${line.label} · robust fitted trend`}</title></line> : null}
              {line.points.map((point, index) => index && point.round - line.points[index - 1].round === 1
                ? <line key={`segment-${point.round}`} data-trend-segment="" x1={x(line.points[index - 1].round)} y1={y(line.points[index - 1].pace)} x2={x(point.round)} y2={y(point.pace)} stroke={stroke} strokeWidth="2" strokeLinecap="round" />
                : null)}
              {line.points.map(point => (
                <circle key={point.round} cx={x(point.round)} cy={y(point.pace)} r="3.5" fill={stroke}>
                  <title>{`${line.label} · R${point.round} · ${point.event} · ${fmt(point.pace, 3, '%')}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
