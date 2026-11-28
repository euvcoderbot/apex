import {color, fmt} from '../../performance-format.js';

export type SparkPoint = {round: number; event: string; pace: number};
export type SparkFit = {round: number; pace: number}[] | null;
export type TrendSeries = {key: string; label: string; teamColor?: string; points: SparkPoint[]; fit?: SparkFit};

const HEIGHT = 340, TOP = 14, BOTTOM = 26;
const STEPS = [.05, .1, .2, .25, .5, 1, 1.5, 2, 5];

/**
 * Every team's qualifying gap by round on one shared scale, quickest at the top
 * (`.trend-chart`). Consecutive rounds are joined; a missing round breaks the
 * line rather than being filled in.
 */
export function TrendChart({series, lo, hi, ceiling, selectedRound}: {series: TrendSeries[]; lo: number; hi: number; ceiling: number; selectedRound?: number}) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !series.length) return <>—</>;
  const x = (round: number) => `${7 + (round - lo) / Math.max(1, hi - lo) * 89}%`;
  const maxObserved = Math.max(0.05, ...series.flatMap(s => s.points.map(p => p.pace)));
  const visualCeiling = Math.min(ceiling, maxObserved * 1.08);
  const step = STEPS.find(value => visualCeiling / value <= 5) || visualCeiling;
  const top = Math.max(step, Math.ceil(visualCeiling / step - 1e-9) * step);
  const y = (pace: number) => TOP + pace / top * (HEIGHT - TOP - BOTTOM);
  const ticks = Array.from({length: Math.round(top / step) + 1}, (_, index) => index * step);
  const rounds = [...new Set(series.flatMap(line => line.points.map(point => point.round)))].sort((a, b) => a - b);
  const every = Math.max(1, Math.ceil(rounds.length / 12));
  // Spread right-gutter team labels vertically so none collide while preserving x="96%" plot span.
  const endLabels = series.map(line => {
    const last = line.points.at(-1);
    return last ? {key: line.key, label: line.label, color: color(line.teamColor), x: x(last.round), rawY: y(last.pace), y: y(last.pace)} : null;
  }).filter((v): v is NonNullable<typeof v> => v !== null).sort((a, b) => a.rawY - b.rawY);
  const minGap = 18, plotBottom = HEIGHT - BOTTOM;
  endLabels.forEach((item, i) => { if (i) item.y = Math.max(item.rawY, endLabels[i - 1].y + minGap); });
  for (let i = endLabels.length - 1; i >= 0; i--) {
    const cap = i === endLabels.length - 1 ? plotBottom : endLabels[i + 1].y - minGap;
    if (endLabels[i].y > cap) endLabels[i].y = cap;
  }
  return (
    <div className="trend-chart">
      <svg width="100%" height={HEIGHT} overflow="visible" role="group" aria-label="Qualifying gap by round for each team; common scale across teams; use arrow keys to inspect values">
        {ticks.map(tick => <g key={tick}>
          <line x1="7%" x2="96%" y1={y(tick)} y2={y(tick)} stroke="var(--ui-separator)" />
          <text x="5.5%" y={y(tick) + 4} textAnchor="end" className="trend-axis">{fmt(tick, step < .1 ? 2 : 1, '%')}</text>
        </g>)}
        {selectedRound !== undefined ? <line x1={x(selectedRound)} x2={x(selectedRound)} y1={TOP} y2={HEIGHT - BOTTOM} stroke="var(--ui-secondary)" strokeDasharray="3 3" /> : null}
        {rounds.filter((_, index) => index % every === 0 || (index === rounds.length - 1 && index % every >= every / 2)).map(round => <text key={round} x={x(round)} y={HEIGHT - 6} textAnchor="middle" className="trend-axis">R{round}</text>)}
        {series.map((line, seriesIndex) => {
          const stroke = `var(--series-stroke, ${color(line.teamColor)})`;
          return (
            <g key={line.key} data-trend-series={line.key} className="trend-series">
              {line.fit?.length === 2 ? <line data-trend-fit="" x1={x(line.fit[0].round)} y1={y(line.fit[0].pace)} x2={x(line.fit[1].round)} y2={y(line.fit[1].pace)} stroke={stroke} strokeOpacity=".55" strokeWidth="1.5" strokeDasharray="4 3"><title>{`${line.label} · robust fitted trend`}</title></line> : null}
              {line.points.map((point, index) => index && point.round - line.points[index - 1].round === 1
                ? <line key={`segment-${point.round}`} data-trend-segment="" x1={x(line.points[index - 1].round)} y1={y(line.points[index - 1].pace)} x2={x(point.round)} y2={y(point.pace)} stroke={stroke} strokeWidth="2" strokeLinecap="round" />
                : null)}
              {line.points.map((point, pointIndex) => (
                <circle key={point.round} cx={x(point.round)} cy={y(point.pace)} r="3.5" fill={stroke} tabIndex={seriesIndex === 0 && pointIndex === 0 ? 0 : -1} role="img" data-chart-value={`${line.key}:${point.round}`} aria-label={`${line.label} · R${point.round} · ${point.event} · ${fmt(point.pace, 3, '%')}`}>
                  <title>{`${line.label} · R${point.round} · ${point.event} · ${fmt(point.pace, 3, '%')}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {endLabels.map(item => (
          <g key={`lbl-${item.key}`} data-trend-series={item.key} className="trend-series trend-end-label" aria-hidden="true" style={{'--series-stroke': item.color} as React.CSSProperties}>
            <text x="98%" y={item.y + 3.5} fill="var(--series-stroke)" className="trend-axis trend-end-text">{item.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
