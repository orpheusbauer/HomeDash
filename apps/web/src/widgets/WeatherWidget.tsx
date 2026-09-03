import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Droplets, Navigation, RefreshCw } from 'lucide-react';
import type { WeatherData } from '@homedash/contracts';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { WeatherIcon, weatherLabel } from './shared';
import { TemperatureTrendChart } from './TemperatureTrendChart';
import type { WidgetComponentProps } from './types';

const WEATHER_ITEM_GAP = 7;

export function responsiveItemCount(
  availableWidth: number,
  itemMinimumWidth: number,
  availableItems: number,
): number {
  if (availableItems <= 0) return 0;
  if (availableWidth <= 0) return Math.min(availableItems, 8);
  return Math.max(
    1,
    Math.min(
      availableItems,
      Math.floor((availableWidth + WEATHER_ITEM_GAP) / (itemMinimumWidth + WEATHER_ITEM_GAP)),
    ),
  );
}

function useResponsiveItemCount(availableItems: number, itemMinimumWidth: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(() => Math.min(availableItems, 8));

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () =>
      setCount(responsiveItemCount(element.clientWidth, itemMinimumWidth, availableItems));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [availableItems, itemMinimumWidth]);

  return [ref, count] as const;
}

function weatherParams(config: Record<string, unknown>) {
  return {
    location: typeof config.location === 'string' ? config.location : 'Paris',
    latitude: typeof config.latitude === 'number' ? config.latitude : 48.8566,
    longitude: typeof config.longitude === 'number' ? config.longitude : 2.3522,
  };
}

function useWeather(config: Record<string, unknown>) {
  const params = weatherParams(config);
  return useQuery({
    queryKey: ['weather', params],
    queryFn: () =>
      api<WeatherData>(
        `/api/v1/weather?${new URLSearchParams({ ...params, latitude: String(params.latitude), longitude: String(params.longitude) })}`,
      ),
    refetchInterval: 15 * 60_000,
  });
}

export function WeatherHeaderDetails({ instance }: Pick<WidgetComponentProps, 'instance'>) {
  const query = useWeather(instance.config);
  const location = query.data?.location ?? weatherParams(instance.config).location;
  const day = query.data?.current.time.slice(0, 10);
  const date =
    instance.widgetId === 'weather.hourly' && day
      ? new Date(`${day}T12:00:00`).toLocaleDateString('fr-FR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })
      : null;
  const details = [location, date].filter(Boolean).join(' · ');
  return (
    <span className="widget-card__metadata" title={details}>
      · {details}
    </span>
  );
}

export function CurrentWeatherWidget({ instance }: WidgetComponentProps) {
  const query = useWeather(instance.config);
  if (!query.data) {
    return (
      <div className="widget-centered">
        <StatusBadge status={query.isError ? 'error' : 'loading'} />
      </div>
    );
  }
  const weather = query.data;
  return (
    <div className="weather-current">
      <div className="weather-current__top">
        <div className="weather-current__icon">
          <WeatherIcon code={weather.current.weatherCode} isDay={weather.current.isDay} size={58} />
        </div>
        <div>
          <div className="weather-current__temperature">
            {Math.round(weather.current.temperature)}
            <sup>°</sup>
          </div>
          <p>{weatherLabel(weather.current.weatherCode)}</p>
        </div>
      </div>
      <div className="weather-current__meta">
        <span>
          <Droplets className="weather-water-icon" size={17} />
          {weather.current.humidity ?? '—'} %
        </span>
        <span>
          <Navigation size={17} />
          {weather.current.windSpeed ?? '—'} km/h
        </span>
        <span>
          Ressenti{' '}
          {weather.current.apparentTemperature == null
            ? '—'
            : `${Math.round(weather.current.apparentTemperature)}°`}
        </span>
      </div>
      <div className="widget-footnote">
        <span>{weather.location}</span>
        <span>
          <RefreshCw size={13} />
          {new Date(weather.fetchedAt).toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
      <StatusBadge status={weather.stale ? 'stale' : 'ready'} />
    </div>
  );
}

export function ForecastWeatherWidget({ instance }: WidgetComponentProps) {
  const query = useWeather(instance.config);
  const [daysRef, visibleDayCount] = useResponsiveItemCount(query.data?.daily.length ?? 0, 64);
  if (!query.data)
    return (
      <div className="widget-centered">
        <StatusBadge status={query.isError ? 'error' : 'loading'} />
      </div>
    );
  const weather = query.data;
  const days = weather.daily.slice(0, visibleDayCount);
  return (
    <div className="forecast-widget">
      <div
        className="forecast-days"
        ref={daysRef}
        style={{ gridTemplateColumns: `repeat(${Math.max(days.length, 1)}, minmax(0, 1fr))` }}
      >
        {days.map((day) => (
          <div className="forecast-day" key={day.date}>
            <span>
              {new Date(`${day.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short' })}
            </span>
            <WeatherIcon code={day.weatherCode} size={28} />
            <strong>{Math.round(day.temperatureMax)}°</strong>
            <small>{Math.round(day.temperatureMin)}°</small>
            {day.precipitationProbability != null && <em>{day.precipitationProbability}%</em>}
          </div>
        ))}
      </div>
      <TemperatureTrendChart
        title="Évolution des maximales"
        points={days.map((day) => ({
          key: day.date,
          label: new Date(`${day.date}T12:00:00`).toLocaleDateString('fr-FR', {
            weekday: 'short',
          }),
          temperature: day.temperatureMax,
        }))}
      />
      <StatusBadge status={weather.stale ? 'stale' : 'ready'} />
    </div>
  );
}

export function upcomingHours(hourly: WeatherData['hourly'], currentTime: string) {
  const currentHour = currentTime.slice(0, 13);
  return hourly.filter((hour) => hour.time.slice(0, 13) >= currentHour);
}

export function HourlyWeatherWidget({ instance }: WidgetComponentProps) {
  const query = useWeather(instance.config);
  const hours = query.data ? upcomingHours(query.data.hourly, query.data.current.time) : [];
  const [hoursRef, visibleHourCount] = useResponsiveItemCount(hours.length, 74);
  if (!query.data)
    return (
      <div className="widget-centered">
        <StatusBadge status={query.isError ? 'error' : 'loading'} />
      </div>
    );

  const weather = query.data;
  const visibleHours = hours.slice(0, visibleHourCount);

  return (
    <div className="hourly-weather-widget">
      <div
        className="hourly-weather-list"
        aria-label="Prévisions météo heure par heure"
        ref={hoursRef}
        style={{
          gridTemplateColumns: `repeat(${Math.max(visibleHours.length, 1)}, minmax(0, 1fr))`,
        }}
      >
        {visibleHours.map((hour, index) => (
          <div className={index === 0 ? 'is-current' : ''} key={hour.time}>
            <time dateTime={hour.time}>
              {index === 0
                ? 'Maintenant'
                : new Date(hour.time).toLocaleTimeString('fr-FR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
            </time>
            <WeatherIcon code={hour.weatherCode} size={28} />
            <strong>{Math.round(hour.temperature)}°</strong>
            <span className="hourly-weather-rain">
              <Droplets className="weather-water-icon" size={13} />
              {hour.humidity ?? '—'}%
            </span>
          </div>
        ))}
      </div>
      <TemperatureTrendChart
        title="Évolution de la température"
        points={visibleHours.map((hour, index) => ({
          key: hour.time,
          label:
            index === 0
              ? 'maintenant'
              : new Date(hour.time).toLocaleTimeString('fr-FR', {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
          temperature: hour.temperature,
        }))}
      />
      {hours.length === 0 && <p className="form-hint">La journée est terminée.</p>}
      <StatusBadge status={weather.stale ? 'stale' : 'ready'} />
    </div>
  );
}
