import {
  CALENDAR_REFRESH_MS,
  WEATHER_REFRESH_MS,
  type IntegrationHealth,
  type WidgetInstance,
} from '@homedash/contracts';
import type { FastifyBaseLogger } from 'fastify';
import { broadcast } from '../realtime.js';
import { getBootstrap, getCache } from '../repositories/dashboard.js';
import { calendarCacheKey, calendarStatus, listEvents, normalizeCalendarIds } from './calendar.js';
import { describeIntegration, integrationRetryPending } from './integration-status.js';
import { getWeather, weatherCacheKey } from './weather.js';

interface IntegrationTarget {
  id: string;
  kind: IntegrationHealth['kind'];
  label: string;
  refreshIntervalMs: number;
  configured: boolean;
  refresh: () => Promise<{ stale: boolean; fetchedAt: string }>;
}

export function configuredIntegrationTargets(instances: WidgetInstance[]): IntegrationTarget[] {
  const targets = new Map<string, IntegrationTarget>();
  for (const instance of instances) {
    const settings = instance.config;
    if (['weather.current', 'weather.forecast', 'weather.hourly'].includes(instance.widgetId)) {
      const latitude =
        typeof settings.latitude === 'number' && Math.abs(settings.latitude) <= 90
          ? settings.latitude
          : 48.8566;
      const longitude =
        typeof settings.longitude === 'number' && Math.abs(settings.longitude) <= 180
          ? settings.longitude
          : 2.3522;
      const location = typeof settings.location === 'string' ? settings.location : 'Paris';
      const id = weatherCacheKey(latitude, longitude);
      if (!targets.has(id))
        targets.set(id, {
          id,
          kind: 'weather',
          label: `Météo · ${location}`,
          configured: true,
          refreshIntervalMs: WEATHER_REFRESH_MS,
          refresh: () => getWeather(location, latitude, longitude, true),
        });
    }
    if (instance.widgetId === 'calendar') {
      const ids = normalizeCalendarIds(
        Array.isArray(settings.calendarIds)
          ? settings.calendarIds.filter((value): value is string => typeof value === 'string')
          : [],
      );
      const id = calendarCacheKey(ids, 14);
      if (!targets.has(id))
        targets.set(id, {
          id,
          kind: 'calendar',
          label: instance.title || 'Google Calendar',
          configured: calendarStatus().configured,
          refreshIntervalMs: CALENDAR_REFRESH_MS,
          refresh: () => listEvents(ids, 14, true),
        });
    }
  }
  return [...targets.values()];
}

function targetHealth(target: IntegrationTarget): IntegrationHealth {
  const cached = getCache<{ fetchedAt: string }>(target.id);
  return describeIntegration(target, cached?.payload.fetchedAt ?? null, target.configured);
}

export function readIntegrationHealth(): IntegrationHealth[] {
  return configuredIntegrationTargets(getBootstrap().instances).map(targetHealth);
}

/** Collect every configured page, even with no browser or tablet connected. */
export function startIntegrationRefresh(log: Pick<FastifyBaseLogger, 'warn'>): () => void {
  let stopped = false;
  let running = false;
  const collect = async () => {
    if (stopped || running) return;
    running = true;
    try {
      // Sequential requests keep the small Pi's memory/network load bounded.
      for (const target of configuredIntegrationTargets(getBootstrap().instances)) {
        if (stopped) break;
        const before = targetHealth(target);
        if (!target.configured || before.state === 'ready' || integrationRetryPending(target.id))
          continue;
        try {
          const result = await target.refresh();
          if (result.stale && before.lastError === null) {
            log.warn(
              { integration: target.kind, message: targetHealth(target).lastError },
              'Integration using cached data',
            );
          }
        } catch {
          const after = targetHealth(target);
          if (before.lastError !== after.lastError) {
            log.warn(
              { integration: target.kind, message: after.lastError },
              'Integration refresh failed',
            );
          }
        }
        if (!stopped) broadcast({ type: 'integration.updated', payload: { kind: target.kind } });
      }
    } catch (error) {
      log.warn({ err: error }, 'Integration collection failed; retrying automatically');
    } finally {
      running = false;
    }
  };
  void collect();
  const timer = setInterval(() => void collect(), 30_000);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
