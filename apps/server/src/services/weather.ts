import type { WeatherData } from '@homedash/contracts';
import { z } from 'zod';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { getCache, setCache } from '../repositories/dashboard.js';

const openMeteoSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string(),
  current: z.object({
    time: z.string(),
    temperature_2m: z.number(),
    relative_humidity_2m: z.number().optional(),
    apparent_temperature: z.number().optional(),
    is_day: z.number(),
    weather_code: z.number(),
    wind_speed_10m: z.number().optional(),
  }),
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: z.array(z.number()),
    relative_humidity_2m: z.array(z.number().nullable()),
    weather_code: z.array(z.number()),
    is_day: z.array(z.number()),
    precipitation_probability: z.array(z.number().nullable()),
  }),
  daily: z.object({
    time: z.array(z.string()),
    weather_code: z.array(z.number()),
    temperature_2m_max: z.array(z.number()),
    temperature_2m_min: z.array(z.number()),
    precipitation_probability_max: z.array(z.number().nullable()),
  }),
});

function mapResponse(location: string, data: z.infer<typeof openMeteoSchema>): WeatherData {
  const fetchedAt = new Date().toISOString();
  return {
    location,
    latitude: data.latitude,
    longitude: data.longitude,
    timezone: data.timezone,
    current: {
      temperature: data.current.temperature_2m,
      apparentTemperature: data.current.apparent_temperature ?? null,
      humidity: data.current.relative_humidity_2m ?? null,
      windSpeed: data.current.wind_speed_10m ?? null,
      weatherCode: data.current.weather_code,
      isDay: data.current.is_day === 1,
      time: data.current.time,
    },
    hourly: data.hourly.time.slice(0, 48).map((time, index) => ({
      time,
      temperature: data.hourly.temperature_2m[index] ?? 0,
      humidity: data.hourly.relative_humidity_2m[index] ?? null,
      weatherCode: data.hourly.weather_code[index] ?? 0,
      isDay: data.hourly.is_day[index] === 1,
      precipitationProbability: data.hourly.precipitation_probability[index] ?? null,
    })),
    daily: data.daily.time.map((date, index) => ({
      date,
      temperatureMin: data.daily.temperature_2m_min[index] ?? 0,
      temperatureMax: data.daily.temperature_2m_max[index] ?? 0,
      weatherCode: data.daily.weather_code[index] ?? 0,
      precipitationProbability: data.daily.precipitation_probability_max[index] ?? null,
    })),
    fetchedAt,
    stale: false,
  };
}

export async function getWeather(
  location: string,
  latitude: number,
  longitude: number,
): Promise<WeatherData> {
  const cacheKey = `weather:v2:${latitude.toFixed(4)}:${longitude.toFixed(4)}`;
  const cached = getCache<WeatherData>(cacheKey);
  if (cached && !cached.expired) return { ...cached.payload, stale: false };

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone: 'auto',
    forecast_days: '7',
    current:
      'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m',
    hourly: 'temperature_2m,relative_humidity_2m,weather_code,is_day,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
  });
  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': `HomeDash/${config.version} (self-hosted dashboard)` },
    });
    if (!response.ok) throw new Error(`Open-Meteo ${response.status}`);
    const data = openMeteoSchema.parse(await response.json());
    const weather = mapResponse(location, data);
    setCache(cacheKey, weather, 15 * 60_000);
    return weather;
  } catch (error) {
    if (cached) return { ...cached.payload, stale: true };
    throw new AppError(
      503,
      'WEATHER_UNAVAILABLE',
      'La météo est temporairement indisponible.',
      String(error),
    );
  }
}
