// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BootstrapData, LayoutItem } from '@homedash/contracts';
import type { DashboardGrid } from './components/DashboardGrid';
import { App } from './App';
import type * as ApiModule from './api';

const request = vi.hoisted(() =>
  vi.fn<(path: string, options?: RequestInit) => Promise<unknown>>(),
);
vi.mock('./api', async (original) => ({
  ...(await original<typeof ApiModule>()),
  api: request,
  hasAdminSession: () => true,
}));
let gridProps: ComponentProps<typeof DashboardGrid>;
vi.mock('./components/DashboardGrid', () => ({
  DashboardGrid: (props: ComponentProps<typeof DashboardGrid>) => {
    gridProps = props;
    return null;
  },
}));

const stamp = '2026-09-02T12:00:00Z';
const home = '00000000-0000-4000-8000-000000000001';
const clock = '00000000-0000-4000-8000-000000000002';
const notes = '00000000-0000-4000-8000-000000000003';
const seed: BootstrapData = {
  version: '0.4.3',
  pages: [
    { id: home, name: 'Accueil', slug: 'home', position: 0, createdAt: stamp, updatedAt: stamp },
  ],
  widgets: [],
  instances: [
    { id: clock, pageId: home, widgetId: 'clock', x: 0, y: 0, w: 24, h: 10 },
    { id: notes, pageId: home, widgetId: 'notes', x: 0, y: 10, w: 24, h: 10 },
  ].map((instance) => ({
    ...instance,
    config: {},
    title: null,
    revision: 0,
    createdAt: stamp,
    updatedAt: stamp,
  })),
  layoutRevision: { [home]: 3 },
  serverTime: stamp,
};
const edited: LayoutItem[] = [
  { id: clock, x: 0, y: 0, w: 8, h: 5 },
  { id: notes, x: 8, y: 0, w: 10, h: 5 },
];
let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
async function click(label: string) {
  const button = host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
  await act(async () => button.click());
}
function saves() {
  return request.mock.calls.filter(([path]) => path.endsWith('/layout'));
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'WebSocket',
    class extends EventTarget {
      close() {}
    },
  );
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => storage.clear(),
  });
  localStorage.clear();
  localStorage.setItem('homedash.bootstrap', JSON.stringify(seed));
  request.mockReset();
  request.mockImplementation(async (path) =>
    path === '/api/v1/bootstrap' ? seed : { revision: 4 },
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(createElement(QueryClientProvider, { client }, createElement(App))),
  );
  await click('Modifier le dashboard');
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.unstubAllGlobals();
});

describe('enregistrement par Terminer', () => {
  it('regroupe les gestes rapides et attend la réponse avant de quitter l’édition', async () => {
    await act(async () => {
      gridProps.onLayoutChange([edited[0]!]);
      gridProps.onLayoutChange(edited);
    });
    expect(saves()).toHaveLength(0);
    let finish!: (value: unknown) => void;
    request.mockImplementation((path) =>
      path.endsWith('/layout')
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(seed),
    );
    await click('Terminer la modification');
    expect(gridProps.editing).toBe(true);
    expect(host.textContent).toContain('Enregistrement…');
    expect(JSON.parse(saves()[0]?.[1]?.body as string)).toEqual({
      expectedRevision: 3,
      items: edited,
    });
    await act(async () => finish({ revision: 4 }));
    expect(gridProps.editing).toBe(false);
    expect(gridProps.instances.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }))).toEqual(edited);
    expect(client.getQueryData<BootstrapData>(['bootstrap'])?.layoutRevision[home]).toBe(4);
  });

  it('conserve le brouillon après une panne réseau et permet de réessayer', async () => {
    await act(async () => gridProps.onLayoutChange(edited));
    request.mockRejectedValueOnce(new Error('offline'));
    await click('Terminer la modification');
    expect(gridProps.editing).toBe(true);
    expect(host.textContent).toContain('Vos modifications sont conservées');
    await click('Terminer la modification');
    expect(saves()).toHaveLength(2);
    expect(saves()[0]?.[1]?.body).toBe(saves()[1]?.[1]?.body);
    expect(gridProps.editing).toBe(false);
  });

  it('sérialise un dernier geste arrivé pendant la sauvegarde', async () => {
    await act(async () => gridProps.onLayoutChange(edited));
    let finish!: (value: unknown) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await click('Terminer la modification');
    const latest = edited.map((item) => ({ ...item, h: 6 }));
    await act(async () => gridProps.onLayoutChange(latest));
    await act(async () => finish({ revision: 4 }));
    expect(saves()).toHaveLength(2);
    expect(JSON.parse(saves()[1]?.[1]?.body as string)).toEqual({
      expectedRevision: 4,
      items: latest,
    });
    expect(gridProps.editing).toBe(false);
  });
});
