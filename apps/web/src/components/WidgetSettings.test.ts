// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetInstance } from '@homedash/contracts';
import { WidgetSettings } from './WidgetSettings';

vi.mock('../api', () => ({ api: async () => [] }));
let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
const onSave = vi.fn();
const onClose = vi.fn();

async function render(config: Record<string, unknown> = {}, widgetId = 'calendar') {
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(WidgetSettings, {
          instance: { widgetId, title: 'Agenda', config } as WidgetInstance,
          onSave,
          onClose,
        }),
      ),
    ),
  );
}

async function input(value: string) {
  const field = host.querySelectorAll('input')[1]!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return field.value;
}

async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === label,
  )!;
  await act(async () => button.click());
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  onSave.mockClear();
  onClose.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  client.clear();
  vi.unstubAllGlobals();
});

describe('identifiants des agendas', () => {
  it('conserve la virgule et les espaces pendant une saisie caractère par caractère', async () => {
    await render({ calendarIds: ['primary'], otherSetting: true });
    let draft = 'primary';
    for (const character of ', famille@group.calendar.google.com') {
      draft += character;
      expect(await input(draft)).toBe(draft);
    }
    await click('Enregistrer');
    expect(onSave).toHaveBeenCalledWith('Agenda', {
      calendarIds: ['primary', 'famille@group.calendar.google.com'],
      otherSetting: true,
    });
  });

  it('nettoie une liste collée uniquement à l’enregistrement et la rouvre correctement', async () => {
    await render();
    const draft = ' primary, , famille@group.calendar.google.com ,primary, travail@example.com, ';
    expect(await input(draft)).toBe(draft);
    await click('Enregistrer');
    const config = {
      calendarIds: ['primary', 'famille@group.calendar.google.com', 'travail@example.com'],
    };
    expect(onSave).toHaveBeenCalledWith('Agenda', config);
    await act(async () => root.render(null));
    await render(config);
    expect(host.querySelectorAll('input')[1]!.value).toBe(config.calendarIds.join(', '));
  });

  it('rétablit primary lorsque le champ ne contient aucun identifiant', async () => {
    await render();
    await input(' , , ');
    await click('Enregistrer');
    expect(onSave).toHaveBeenCalledWith('Agenda', { calendarIds: ['primary'] });
  });

  it('annule sans modifier la configuration existante', async () => {
    const config = { calendarIds: ['primary'] };
    await render(config);
    await input('autre@example.com');
    await click('Annuler');
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
    expect(config.calendarIds).toEqual(['primary']);
  });

  it('préserve les réglages des autres widgets', async () => {
    await render({ format: '24h' }, 'clock');
    await click('Enregistrer');
    expect(onSave).toHaveBeenCalledWith('Agenda', { format: '24h' });
  });
});
