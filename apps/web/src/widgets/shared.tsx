import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun } from 'lucide-react';

export function weatherLabel(code: number): string {
  if (code === 0) return 'Ciel dégagé';
  if (code <= 3) return 'Partiellement nuageux';
  if (code <= 48) return 'Brouillard';
  if (code <= 57) return 'Bruine';
  if (code <= 67) return 'Pluie';
  if (code <= 77) return 'Neige';
  if (code <= 82) return 'Averses';
  if (code <= 86) return 'Averses de neige';
  return 'Orage';
}

export function WeatherIcon({
  code,
  size = 36,
  isDay = true,
}: {
  code: number;
  size?: number;
  isDay?: boolean;
}) {
  if (code === 0) return isDay ? <Sun size={size} /> : <CloudSun size={size} />;
  if (code <= 3) return <CloudSun size={size} />;
  if (code <= 48) return <CloudFog size={size} />;
  if (code <= 67) return <CloudRain size={size} />;
  if (code <= 77 || (code >= 85 && code <= 86)) return <CloudSnow size={size} />;
  if (code >= 95) return <CloudLightning size={size} />;
  if (code <= 82) return <CloudRain size={size} />;
  return <Cloud size={size} />;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ['Ko', 'Mo', 'Go', 'To'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

export function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days} j ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}
