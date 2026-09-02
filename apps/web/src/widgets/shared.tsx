export function weatherLabel(code: number): string {
  if (code === 0) return 'Ciel dégagé';
  if (code === 1) return 'Peu nuageux';
  if (code === 2) return 'Partiellement nuageux';
  if (code === 3) return 'Couvert';
  if (code <= 48) return 'Brouillard';
  if (code <= 57) return 'Bruine';
  if (code <= 67) return 'Pluie';
  if (code <= 77) return 'Neige';
  if (code <= 82) return 'Averses';
  if (code <= 86) return 'Averses de neige';
  return 'Orage';
}

function SunShape({ compact = false }: { compact?: boolean }) {
  const center = compact ? 7.5 : 12;
  const radius = compact ? 3 : 4;
  return (
    <g className="weather-icon__sun">
      <circle cx={center} cy={center} r={radius} />
      {compact ? (
        <path d="M7.5 1v2M7.5 12v2M1 7.5h2M12 7.5h2M2.9 2.9l1.4 1.4M10.7 10.7l1.4 1.4M12.1 2.9l-1.4 1.4M4.3 10.7l-1.4 1.4" />
      ) : (
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M19.07 4.93l-1.41 1.42M6.34 17.66l-1.41 1.41" />
      )}
    </g>
  );
}

function CloudShape({ raised = false }: { raised?: boolean }) {
  return (
    <path
      className="weather-icon__cloud"
      d="M7.2 18.5h10.2a4.1 4.1 0 0 0 .45-8.18 6.25 6.25 0 0 0-11.93 1.82A3.25 3.25 0 0 0 7.2 18.5Z"
      transform={raised ? 'translate(0 -2)' : undefined}
    />
  );
}

function RainShape({ drizzle = false }: { drizzle?: boolean }) {
  return drizzle ? (
    <path className="weather-icon__rain" d="M8 18.5l-.6 1.2M12 18.5l-.6 1.2M16 18.5l-.6 1.2" />
  ) : (
    <path className="weather-icon__rain" d="M8.5 18l-1.2 2.8M12.5 18l-1.2 2.8M16.5 18l-1.2 2.8" />
  );
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
  let content;

  if (code === 0 && isDay) {
    content = <SunShape />;
  } else if (code === 0) {
    content = (
      <path className="weather-icon__moon" d="M19.2 15.2A8 8 0 0 1 8.8 4.8 8 8 0 1 0 19.2 15.2Z" />
    );
  } else if (code <= 2) {
    content = (
      <>
        <SunShape compact />
        <CloudShape />
      </>
    );
  } else if (code === 3) {
    content = <CloudShape />;
  } else if (code <= 48) {
    content = (
      <>
        <CloudShape raised />
        <path className="weather-icon__fog" d="M5 18.5h14M7 21.5h10" />
      </>
    );
  } else if (code <= 57) {
    content = (
      <>
        <CloudShape raised />
        <RainShape drizzle />
      </>
    );
  } else if (code <= 67 || (code >= 80 && code <= 82)) {
    content = (
      <>
        <CloudShape raised />
        <RainShape />
      </>
    );
  } else if (code <= 77 || (code >= 85 && code <= 86)) {
    content = (
      <>
        <CloudShape raised />
        <path
          className="weather-icon__snow"
          d="M8 18v4M6.3 19l3.4 2M9.7 19l-3.4 2M16 18v4M14.3 19l3.4 2M17.7 19l-3.4 2"
        />
      </>
    );
  } else if (code >= 95) {
    content = (
      <>
        <CloudShape raised />
        <path className="weather-icon__lightning" d="M13 17.5h-3l-1 3h2l-.7 3 4.2-5h-2Z" />
        <path className="weather-icon__rain" d="M17 18l-1.2 2.8" />
      </>
    );
  } else {
    content = <CloudShape />;
  }

  return (
    <svg
      className="weather-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={weatherLabel(code)}
    >
      <title>{weatherLabel(code)}</title>
      {content}
    </svg>
  );
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
