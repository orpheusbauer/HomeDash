// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, WidgetInstance } from '@homedash/contracts';
import { CalendarWidget } from './CalendarWidget';
import {
  calendarDate,
  calendarDayKey,
  calendarDescriptionText,
  calendarEventSchedule,
  calendarRelativeDay,
  groupCalendarEvents,
} from './calendar-display';

vi.mock('../api', () => ({ api: vi.fn() }));
const now = new Date(2026, 8, 3, 9);
const event = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'event',
  calendarId: 'primary',
  title: 'Réunion de rentrée',
  start: new Date(2026, 8, 3, 10).toISOString(),
  end: new Date(2026, 8, 3, 11, 30).toISOString(),
  allDay: false,
  location: 'Salle des associations',
  description: '<p>Préparer le <b>programme</b> &amp; les activités.</p><p>Apporter un carnet.</p>',
  status: 'confirmed',
  htmlLink: 'https://calendar.google.com/',
  ...overrides,
});
let root: Root;
let host: HTMLDivElement;
let client: QueryClient;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('dates de l’agenda', () => {
  it('affiche le début et la fin, y compris lors d’un passage à minuit', () => {
    expect(calendarEventSchedule(event())).toBe('10:00 – 11:30');
    expect(
      calendarEventSchedule(
        event({
          start: new Date(2026, 8, 3, 23).toISOString(),
          end: new Date(2026, 8, 4, 1).toISOString(),
        }),
      ),
    ).toBe('Du jeudi 3 septembre à 23:00 au vendredi 4 septembre à 01:00');
  });

  it('conserve les journées entières en date locale et respecte la fin exclusive', () => {
    expect(calendarDayKey(calendarDate('2026-09-03', true))).toBe('2026-09-03');
    expect(calendarDate('2026-09-03', true).getHours()).toBe(0);
    expect(
      calendarEventSchedule(event({ allDay: true, start: '2026-09-03', end: '2026-09-04' })),
    ).toBe('Toute la journée');
    expect(
      calendarEventSchedule(event({ allDay: true, start: '2026-09-03', end: '2026-09-06' })),
    ).toBe('Toute la journée · du jeudi 3 septembre au samedi 5 septembre');
    expect(
      calendarEventSchedule(event({ allDay: true, start: '2026-10-24', end: '2026-10-27' })),
    ).toBe('Toute la journée · du samedi 24 octobre au lundi 26 octobre');
  });

  it('repère demain au changement de mois et d’année', () => {
    expect(calendarRelativeDay(now, now)).toBe('Aujourd’hui');
    expect(calendarRelativeDay(new Date(2027, 0, 1), new Date(2026, 11, 31))).toBe('Demain');
    expect(calendarRelativeDay(new Date(2026, 8, 5), now)).toBeNull();
  });

  it('réunit les agendas dans l’ordre des instants, malgré des fuseaux différents', () => {
    const later = event({ id: 'later', start: '2026-09-03T08:30:00Z' });
    const earlier = event({
      id: 'earlier',
      calendarId: 'family',
      start: '2026-09-03T10:00:00+02:00',
    });
    const groups = groupCalendarEvents([later, earlier], new Date(2026, 8, 3));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.events.map((item) => item.id)).toEqual(['earlier', 'later']);
  });

  it('place un séjour en cours avec aujourd’hui et ignore les événements annulés', () => {
    const groups = groupCalendarEvents(
      [
        event({ id: 'cancelled', status: 'cancelled' }),
        event(),
        event({ id: 'stay', allDay: true, start: '2026-09-01', end: '2026-09-05' }),
        event({ id: 'past', allDay: true, start: '2026-09-01', end: '2026-09-02' }),
      ],
      now,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe('2026-09-03');
    expect(groups[0]!.events.map((item) => item.id)).toEqual(['stay', 'event']);
  });

  it('convertit le texte riche sans exécuter ni afficher du code HTML', () => {
    expect(
      calendarDescriptionText(
        '<p>Un &amp; deux<br>Trois</p><script>alert(1)</script><img src=x onerror=alert(1)><div>Quatre</div>',
      ),
    ).toBe('Un & deux\nTrois\nQuatre');
    expect(calendarDescriptionText('Ligne 1\nLigne 2')).toBe('Ligne 1\nLigne 2');
    expect(calendarDescriptionText('&lt;script&gt;texte&lt;/script&gt;')).toBe(
      '<script>texte</script>',
    );
  });
});

async function render(
  events: CalendarEvent[],
  { editing = false, configured = true, metadata = true, stale = false } = {},
) {
  const calendarIds = ['primary', 'family'];
  client.setQueryData(['calendar-status'], { configured });
  client.setQueryData(
    ['calendar-list'],
    metadata
      ? [
          { id: 'owner@example.com', name: 'Personnel', primary: true, color: '#39735b' },
          { id: 'family', name: 'Famille', primary: false, color: '#a66b28' },
        ]
      : [],
  );
  client.setQueryData(['calendar-events', calendarIds], {
    events,
    stale,
    fetchedAt: now.toISOString(),
  });
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(CalendarWidget, {
          instance: {
            id: 'calendar',
            widgetId: 'calendar',
            pageId: 'home',
            title: null,
            config: { calendarIds },
            x: 0,
            y: 0,
            w: 32,
            h: 20,
            revision: 0,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          } satisfies WidgetInstance,
          editing,
          adminUnlocked: editing,
        }),
      ),
    ),
  );
}

describe('présentation de l’agenda', () => {
  it('affiche les jours, horaires, couleurs et descriptions sans compteur ni liens externes', async () => {
    await render([event(), event({ id: 'family', calendarId: 'family' })]);
    expect(host.querySelector('h3')!.textContent).toContain('jeudi 3 septembre');
    expect(host.textContent).toContain('Aujourd’hui');
    expect(host.textContent).toContain('10:00 – 11:30');
    expect(host.textContent).toContain('Salle des associations');
    expect(host.querySelector('.calendar-toolbar')).toBeNull();
    expect(host.querySelector('.calendar-event__source')).toBeNull();
    expect(host.textContent).not.toContain('Personnel');
    expect(host.textContent).not.toContain('Famille');
    expect(
      host.querySelectorAll<HTMLElement>('.calendar-event')[0]!.style.borderLeftColor,
    ).not.toBe(host.querySelectorAll<HTMLElement>('.calendar-event')[1]!.style.borderLeftColor);
    const description = host.querySelector('details')!;
    expect(description.open).toBe(false);
    await act(async () => description.querySelector('summary')!.click());
    expect(description.open).toBe(true);
    expect(description.querySelector('p')!.textContent).toBe(
      'Préparer le programme & les activités.\nApporter un carnet.',
    );
    expect(description.querySelector('b')).toBeNull();
    expect(host.querySelectorAll('.event-open')).toHaveLength(0);
    expect(host.querySelector('.event-edit')).toBeNull();
  });

  it('ne masque plus les événements après les huit premiers et conserve les actions de modification', async () => {
    await render(
      Array.from({ length: 10 }, (_, index) =>
        event({ id: String(index), title: `Événement ${index + 1}` }),
      ),
      { editing: true },
    );
    expect(host.querySelectorAll('.calendar-event')).toHaveLength(10);
    expect(host.textContent).toContain('Événement 10');
    expect(host.querySelectorAll('.event-edit')).toHaveLength(10);
    expect(host.querySelector('.calendar-add')).not.toBeNull();
  });

  it('garde les événements lisibles en cache ou sans nom d’agenda', async () => {
    await render([event({ calendarId: 'family', description: null, location: null })], {
      metadata: false,
      stale: true,
    });
    expect(host.querySelector('.calendar-event__source')).toBeNull();
    expect(host.textContent).toContain('Données en cache');
    expect(host.querySelector('details')).toBeNull();
    expect(host.querySelector('.calendar-event__location')).toBeNull();
  });

  it('conserve les états vide et déconnecté', async () => {
    await render([]);
    expect(host.textContent).toContain('Aucun événement à venir');
    await render([], { configured: false });
    expect(host.textContent).toContain('Google Calendar n’est pas connecté');
  });
});
