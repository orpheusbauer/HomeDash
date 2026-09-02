// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { type GridHTMLElement } from 'gridstack';
import type { WidgetInstance } from '@homedash/contracts';
import { DashboardGrid, GRID_COLUMNS } from './DashboardGrid';

vi.mock('../widgets/WidgetRenderer', () => ({ WidgetRenderer: () => null }));

const widgets = [
  { id: 'clock', widgetId: 'clock', pageId: 'home', x: 0, y: 0, w: 12, h: 8 },
  { id: 'notes', widgetId: 'notes', pageId: 'home', x: 12, y: 0, w: 12, h: 8 },
] as WidgetInstance[];
let root: Root;
let host: HTMLDivElement;
const onLayoutChange = vi.fn();
async function render(editing: boolean, instances = widgets) {
  await act(async () =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(DashboardGrid, {
          instances,
          editing,
          manifests: [],
          adminUnlocked: true,
          onLayoutChange,
          onConfigure: vi.fn(),
          onRemove: vi.fn(),
        }),
      ),
    ),
  );
}
function grid() {
  return host.querySelector<GridHTMLElement>('.grid-stack')!.gridstack!;
}
function layout() {
  return grid().engine.nodes.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(HTMLElement.prototype, 'scrollBy', { configurable: true, value: vi.fn() });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // GridStack supplies a proxied Vitest window, which jsdom rejects as UIEvent.view.
  const NativeMouseEvent = window.MouseEvent;
  vi.stubGlobal(
    'MouseEvent',
    class extends NativeMouseEvent {
      constructor(type: string, init: MouseEventInit = {}) {
        super(type, { ...init, view: null });
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(960);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 960,
    bottom: 600,
    width: 960,
    height: 600,
    toJSON: () => ({}),
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  onLayoutChange.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollBy');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('éditeur de grille', () => {
  it('garde la même grille, les petites tailles et les cartes côte à côte après Terminer', async () => {
    await render(true);
    const engine = grid();
    const layoutClasses = Array.from(engine.el.classList).filter((name) => name.startsWith('gs-'));
    await act(async () => {
      engine.update('[gs-id="clock"]', { w: 8, h: 5 });
    });
    await act(async () => {
      engine.update('[gs-id="notes"]', { x: 8, y: 0, w: 10, h: 5 });
    });
    const edited = layout();
    const saved = widgets.map((widget) => ({
      ...widget,
      ...edited.find(({ id }) => widget.id === id),
    }));
    await render(false, saved);
    expect(grid()).toBe(engine);
    for (const name of layoutClasses) expect(engine.el.classList.contains(name)).toBe(true);
    expect(layout()).toEqual(edited);
    expect(grid().getColumn()).toBe(GRID_COLUMNS);
    expect(host.querySelector('.grid-stack-placeholder')).toBeNull();
    await render(true, saved);
    expect(grid()).toBe(engine);
    expect(layout()).toEqual(edited);
  });

  it('ignore une réponse serveur ancienne pendant un redimensionnement', async () => {
    await render(true);
    const engine = grid();
    await act(async () => {
      engine.update('[gs-id="clock"]', { w: 8, h: 4 });
    });
    const edited = layout();
    await render(
      true,
      widgets.map((widget) => ({ ...widget })),
    );
    expect(grid()).toBe(engine);
    expect(layout()).toEqual(edited);
    expect(onLayoutChange).toHaveBeenLastCalledWith(edited);
    expect(onLayoutChange.mock.lastCall?.[0]).toHaveLength(2);
  });

  it('ajoute et supprime les widgets sans détruire le moteur', async () => {
    await render(true, []);
    const engine = grid();
    await render(true);
    expect(grid()).toBe(engine);
    expect(grid().engine.nodes).toHaveLength(2);
    await render(true, widgets.slice(0, 1));
    expect(grid()).toBe(engine);
    expect(grid().engine.nodes).toHaveLength(1);
  });

  it.each(['.widget-drag-handle', '.ui-resizable-se'])(
    'termine un geste tactile annulé sur %s',
    async (selector) => {
      await render(true);
      const handle = host.querySelector(selector)!;
      const touch: Touch = {
        identifier: 1,
        target: handle,
        clientX: 10,
        clientY: 10,
        pageX: 10,
        pageY: 10,
        screenX: 10,
        screenY: 10,
        radiusX: 1,
        radiusY: 1,
        rotationAngle: 0,
        force: 1,
      };
      const touchEnd = vi.fn();
      handle.addEventListener('touchend', touchEnd);
      await act(async () => {
        handle.dispatchEvent(
          new TouchEvent('touchstart', {
            bubbles: true,
            changedTouches: [touch],
            touches: [touch],
          }),
        );
        const moved = { ...touch, clientX: 210, clientY: 110, pageX: 210, pageY: 110 };
        handle.dispatchEvent(
          new TouchEvent('touchmove', { bubbles: true, changedTouches: [moved], touches: [moved] }),
        );
        expect(host.querySelector('.grid-stack-placeholder')).not.toBeNull();
        handle.dispatchEvent(
          new TouchEvent('touchcancel', { bubbles: true, changedTouches: [touch] }),
        );
      });
      expect(touchEnd).toHaveBeenCalledTimes(1);
      expect(host.querySelector('.grid-stack-placeholder')).toBeNull();
      await act(async () => {
        grid().update('[gs-id="clock"]', { w: 7 });
      });
      expect(grid().engine.nodes.find(({ id }) => id === 'clock')?.w).toBe(7);
    },
  );

  it('ne transforme pas le portrait en tailles pleine largeur', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(480);
    await render(false);
    expect(grid().getColumn()).toBe(48);
    expect(layout().map(({ x, w }) => ({ x, w }))).toEqual([
      { x: 0, w: 12 },
      { x: 12, w: 12 },
    ]);
    expect(onLayoutChange).not.toHaveBeenCalled();
  });
});
