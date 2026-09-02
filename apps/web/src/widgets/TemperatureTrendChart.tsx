import { useId } from 'react';

export interface TemperatureTrendPoint {
  key: string;
  label: string;
  temperature: number;
}

const TEMPERATURE_STOPS = [
  { temperature: -15, color: '#bdefff' },
  { temperature: 0, color: '#438ddd' },
  { temperature: 12, color: '#38a673' },
  { temperature: 20, color: '#7aaa3c' },
  { temperature: 27, color: '#e1a52f' },
  { temperature: 34, color: '#df522f' },
  { temperature: 42, color: '#8f1d24' },
] as const;

function interpolateChannel(from: number, to: number, progress: number): number {
  return Math.round(from + (to - from) * progress);
}

function hexToRgb(color: string): [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

export function temperatureColor(temperature: number): string {
  const first = TEMPERATURE_STOPS[0];
  const last = TEMPERATURE_STOPS[TEMPERATURE_STOPS.length - 1]!;
  if (temperature <= first.temperature) return first.color;
  if (temperature >= last.temperature) return last.color;

  const upperIndex = TEMPERATURE_STOPS.findIndex((stop) => stop.temperature >= temperature);
  const lower = TEMPERATURE_STOPS[upperIndex - 1]!;
  const upper = TEMPERATURE_STOPS[upperIndex]!;
  const progress = (temperature - lower.temperature) / (upper.temperature - lower.temperature);
  const from = hexToRgb(lower.color);
  const to = hexToRgb(upper.color);
  return `rgb(${interpolateChannel(from[0], to[0], progress)}, ${interpolateChannel(from[1], to[1], progress)}, ${interpolateChannel(from[2], to[2], progress)})`;
}

function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index]!;
    const middle = (previous.x + point.x) / 2;
    return `${path} C ${middle} ${previous.y}, ${middle} ${point.y}, ${point.x} ${point.y}`;
  }, `M ${points[0]!.x} ${points[0]!.y}`);
}

export function TemperatureTrendChart({
  points,
  title,
}: {
  points: TemperatureTrendPoint[];
  title: string;
}) {
  const rawId = useId();
  const id = rawId.replaceAll(':', '');
  if (points.length === 0) return null;

  const width = Math.max(320, points.length * 82);
  const height = 150;
  const horizontalPadding = 30;
  const topPadding = 30;
  const bottomPadding = 18;
  const temperatures = points.map((point) => point.temperature);
  const rawMinimum = Math.min(...temperatures);
  const rawMaximum = Math.max(...temperatures);
  const spread = Math.max(rawMaximum - rawMinimum, 4);
  const minimum = rawMinimum - Math.max(2, spread * 0.18);
  const maximum = rawMaximum + Math.max(2, spread * 0.18);
  const chartHeight = height - topPadding - bottomPadding;
  const coordinates = points.map((point, index) => ({
    x:
      points.length === 1
        ? width / 2
        : horizontalPadding + (index / (points.length - 1)) * (width - horizontalPadding * 2),
    y: topPadding + ((maximum - point.temperature) / (maximum - minimum)) * chartHeight,
  }));
  const linePath = smoothPath(coordinates);
  const areaPath = `${linePath} L ${coordinates.at(-1)!.x} ${height - bottomPadding} L ${coordinates[0]!.x} ${height - bottomPadding} Z`;

  return (
    <figure className="temperature-trend">
      <figcaption>{title}</figcaption>
      <div
        className="temperature-trend__plot"
        role="img"
        aria-label={`${title} : ${points.map((point) => `${point.label} ${Math.round(point.temperature)} degrés`).join(', ')}`}
      >
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={`${id}-line`} x1="0" y1="0" x2="1" y2="0">
              {points.map((point, index) => (
                <stop
                  key={point.key}
                  offset={`${points.length === 1 ? 50 : (index / (points.length - 1)) * 100}%`}
                  stopColor={temperatureColor(point.temperature)}
                />
              ))}
            </linearGradient>
            <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={temperatureColor(rawMaximum)} stopOpacity="0.2" />
              <stop offset="100%" stopColor={temperatureColor(rawMinimum)} stopOpacity="0.015" />
            </linearGradient>
          </defs>
          <line
            className="temperature-trend__baseline"
            x1={horizontalPadding}
            x2={width - horizontalPadding}
            y1={height - bottomPadding}
            y2={height - bottomPadding}
          />
          <path className="temperature-trend__area" d={areaPath} fill={`url(#${id}-area)`} />
          <path className="temperature-trend__line" d={linePath} stroke={`url(#${id}-line)`} />
        </svg>
        {points.map((point, index) => {
          const coordinate = coordinates[index]!;
          const color = temperatureColor(point.temperature);
          return (
            <span
              className="temperature-trend__marker"
              key={point.key}
              style={{
                left: `${(coordinate.x / width) * 100}%`,
                top: `${(coordinate.y / height) * 100}%`,
                color,
              }}
              aria-hidden="true"
            >
              {Math.round(point.temperature)}°
            </span>
          );
        })}
      </div>
      <span className="temperature-trend__scale" aria-hidden="true">
        <span>Très froid</span>
        <span>Frais</span>
        <span>Très chaud</span>
      </span>
    </figure>
  );
}
