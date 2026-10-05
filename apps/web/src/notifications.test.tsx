// @vitest-environment jsdom
import { act, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsProvider, WidgetNotificationScope } from './notifications';
import {
  NotificationButton,
  ConnectionBadge,
  ConnectionDetails,
} from './components/ConnectionStatus';
import { DataFreshness, dataTimestamp } from './components/DataFreshness';
import { StatusBadge } from './components/StatusBadge';

type Health = ComponentProps<typeof NotificationButton>['health'];
const now = new Date('2026-10-05T08:00:00Z');
const fetchedAt = '2026-10-05T07:40:00Z';
const refetch = vi.fn<Health['refetch']>();
function health(offline = false): Health {
  return {
    summary: offline
      ? {
          level: 'offline',
          label: 'Pi inaccessible',
          message:
            'La tablette ne reçoit plus de réponse du Raspberry Pi. Reconnexion automatique en cours.',
        }
      : { level: 'online', label: 'Pi connecté', message: '' },
    data: {
      serverTime: now.toISOString(),
      version: '0.4.12',
      integrations: [],
      nightlyReboot: { active: true, time: '03:00', timezone: 'Europe/Paris' },
    },
    dataUpdatedAt: now.getTime(),
    isError: offline,
    isFetching: false,
    refetch,
  };
}

function Dashboard({
  failed,
  mounted = true,
  stale = false,
}: {
  failed: boolean;
  mounted?: boolean;
  stale?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const status = health(failed);
  return (
    <NotificationsProvider>
      <header>
        <NotificationButton health={status} onClick={() => setOpen(true)} />
        <ConnectionBadge health={status} onClick={() => setOpen(true)} />
      </header>
      <main>
        {mounted && (
          <WidgetNotificationScope id="weather" title="Météo actuelle">
            <strong>18°</strong>
            <DataFreshness
              fetchedAt={failed || stale ? fetchedAt : now.toISOString()}
              stale={stale}
              error={failed ? new Error('network') : null}
              interval={600_000}
              source="Open-Meteo"
            />
          </WidgetNotificationScope>
        )}
        <WidgetNotificationScope id="system" title="Système">
          <StatusBadge status={failed ? 'error' : 'ready'} />
        </WidgetNotificationScope>
      </main>
      {open && (
        <ConnectionDetails
          health={status}
          realtime={failed ? 'offline' : 'online'}
          onClose={() => setOpen(false)}
        />
      )}
    </NotificationsProvider>
  );
}

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  refetch.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const bell = () => host.querySelector<HTMLButtonElement>('.notification-button')!;
const main = () => host.querySelector('main')!;

describe('notifications du dashboard', () => {
  it('regroupe la panne du Pi et les alertes des widgets sans recouvrir les dernières données', async () => {
    await act(async () => root.render(<Dashboard failed />));
    expect(main().textContent).toBe('18°');
    expect(host.textContent).not.toContain('Pi inaccessible');
    expect(host.querySelector('.connection-banner')).toBeNull();
    expect(host.querySelector('.connection-button')!.textContent).toBe('');
    expect(bell().getAttribute('aria-label')).toBe('Notifications : 3 alertes');
    expect(bell().nextElementSibling?.classList.contains('connection-button')).toBe(true);
    await act(async () => bell().click());
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Pi inaccessible');
    expect(dialog.textContent).toContain('Reconnexion automatique en cours');
    expect(dialog.textContent).toContain('Liaison tablette → Pi interrompue');
    expect(dialog.textContent).toContain(dataTimestamp(fetchedAt));
    expect(dialog.querySelectorAll('.notification-item')).toHaveLength(2);
    expect(main().textContent).toBe('18°');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Fermer"]')!.click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('retire les alertes au retour des données et conserve une vérification manuelle dans la cloche', async () => {
    await act(async () => root.render(<Dashboard failed />));
    await act(async () => root.render(<Dashboard failed={false} />));
    expect(bell().getAttribute('aria-label')).toBe('Notifications');
    expect(host.querySelector('.notification-button__count')).toBeNull();
    await act(async () => bell().click());
    expect(host.textContent).toContain('Aucune alerte en cours');
    const resume = vi.fn();
    window.addEventListener('homedash:resume', resume);
    try {
      const refresh = Array.from(host.querySelectorAll('button')).find((button) =>
        button.textContent.includes('Vérifier et actualiser maintenant'),
      )!;
      await act(async () => refresh.click());
      expect(resume).toHaveBeenCalledOnce();
      expect(refetch).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('homedash:resume', resume);
    }
  });

  it('signale un cache ancien puis supprime sa notification quand le widget quitte la page', async () => {
    await act(async () => root.render(<Dashboard failed={false} stale />));
    expect(main().textContent).toBe('18°');
    expect(bell().getAttribute('aria-label')).toBe('Notifications : 1 alerte');
    await act(async () => root.render(<Dashboard failed={false} mounted={false} />));
    expect(bell().getAttribute('aria-label')).toBe('Notifications');
  });
});
