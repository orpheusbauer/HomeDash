import { useQuery } from '@tanstack/react-query';
import { Droplets, Navigation, RefreshCw } from 'lucide-react';
import type { WeatherData } from '@homedash/contracts';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { WeatherIcon, weatherLabel } from './shared';
import type { WidgetComponentProps } from './types';

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
          <Droplets size={17} />
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
  if (!query.data)
    return (
      <div className="widget-centered">
        <StatusBadge status={query.isError ? 'error' : 'loading'} />
      </div>
    );
  const weather = query.data;
  return (
    <div className="forecast-widget">
      <div className="forecast-days">
        {weather.daily.slice(0, 7).map((day) => (
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
      <div className="forecast-hours">
        {weather.hourly
          .filter((hour) => Date.parse(hour.time) >= Date.now() - 3_600_000)
          .slice(0, 8)
          .map((hour) => (
            <span key={hour.time}>
              {new Date(hour.time).toLocaleTimeString('fr-FR', { hour: '2-digit' })}
              <strong>{Math.round(hour.temperature)}°</strong>
            </span>
          ))}
      </div>
      <StatusBadge status={weather.stale ? 'stale' : 'ready'} />
    </div>
  );
}

function localDay(value: string): string {
  return value.slice(0, 10);
}

export function HourlyWeatherWidget({ instance }: WidgetComponentProps) {
  const query = useWeather(instance.config);
  if (!query.data)
    return (
      <div className="widget-centered">
        <StatusBadge status={query.isError ? 'error' : 'loading'} />
      </div>
    );

  const weather = query.data;
  const today = localDay(weather.current.time);
  const currentHour = weather.current.time.slice(0, 13);
  const hours = weather.hourly.filter(
    (hour) => localDay(hour.time) === today && hour.time.slice(0, 13) >= currentHour,
  );

  return (
    <div className="hourly-weather-widget">
      <div className="hourly-weather-summary">
        <div>
          <strong>{weather.location}</strong>
          <span>
            {new Date(`${today}T12:00:00`).toLocaleDateString('fr-FR', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </span>
        </div>
        <small>Mise à jour toutes les 15 min</small>
      </div>
      <div className="hourly-weather-list" aria-label="Prévisions météo heure par heure">
        {hours.map((hour, index) => (
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
              <Droplets size={13} />
              {hour.precipitationProbability ?? 0}%
            </span>
          </div>
        ))}
      </div>
      {hours.length === 0 && <p className="form-hint">La journée est terminée.</p>}
      <StatusBadge status={weather.stale ? 'stale' : 'ready'} />
    </div>
  );
}
