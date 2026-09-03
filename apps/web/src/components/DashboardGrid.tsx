import { useLayoutEffect, useRef } from 'react';
import { GridStack, type GridItemHTMLElement } from 'gridstack';
import { Grip, Settings2, Trash2 } from 'lucide-react';
import type { LayoutItem, WidgetInstance, WidgetManifest } from '@homedash/contracts';
import { WidgetErrorBoundary } from './WidgetErrorBoundary';
import { WidgetRenderer } from '../widgets/WidgetRenderer';
import { WeatherHeaderDetails } from '../widgets/WeatherWidget';

export const GRID_COLUMNS = 48;

interface DashboardGridProps {
  instances: WidgetInstance[];
  manifests: WidgetManifest[];
  editing: boolean;
  adminUnlocked: boolean;
  onLayoutChange: (items: LayoutItem[]) => void;
  onConfigure: (instance: WidgetInstance) => void;
  onRemove: (instance: WidgetInstance) => void;
}

export function DashboardGrid({
  instances,
  manifests,
  editing,
  adminUnlocked,
  onLayoutChange,
  onConfigure,
  onRemove,
}: DashboardGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<GridStack | null>(null);
  const syncingRef = useRef(false);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const layoutHandler = useRef(onLayoutChange);
  layoutHandler.current = onLayoutChange;

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const grid = GridStack.init(
      {
        // Keep the same coordinate system in portrait, landscape and edit mode.
        // Changing columns caches alternate layouts and can restore stale sizes.
        column: GRID_COLUMNS,
        auto: false,
        cellHeight: 22,
        margin: 8,
        float: true,
        animate: true,
        staticGrid: !editingRef.current,
        draggable: { handle: '.widget-drag-handle', scroll: true },
        resizable: { handles: 'e,se,s,sw,w' },
        alwaysShowResizeHandle: 'mobile',
      },
      containerRef.current,
    );
    if (!grid) return;
    gridRef.current = grid;
    const onChange = () => {
      if (syncingRef.current || !editingRef.current) return;
      // A full snapshot includes widgets displaced by collisions, not just the
      // last node touched. React never writes GridStack's positioning attributes.
      const items = grid.engine.nodes
        .map((node) => {
          const id = node.id;
          if (!id) return null;
          return {
            id,
            x: node.x ?? 0,
            y: node.y ?? 0,
            w: node.w ?? 1,
            h: node.h ?? 1,
          } satisfies LayoutItem;
        })
        .filter((item): item is LayoutItem => item !== null);
      if (items.length > 0) layoutHandler.current(items);
    };
    grid.on('change', onChange);
    // GridStack translates touchend to mouseup but does not handle touchcancel.
    // Finish the same gesture if Android interrupts it (scroll, sleep, app switch).
    let touchTarget: EventTarget | null = null;
    let lastTouches: Touch[] = [];
    const rememberTouch = (event: TouchEvent) => {
      if (event.type === 'touchstart') touchTarget = event.target;
      lastTouches = Array.from(event.changedTouches);
    };
    const clearTouch = () => {
      touchTarget = null;
      lastTouches = [];
    };
    const finishGesture = () => {
      if (touchTarget && lastTouches.length) {
        touchTarget.dispatchEvent(
          new TouchEvent('touchend', {
            bubbles: true,
            cancelable: true,
            changedTouches: lastTouches,
          }),
        );
      }
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      clearTouch();
    };
    const onVisibility = () => {
      if (document.hidden) finishGesture();
    };
    const container = containerRef.current;
    container.addEventListener('touchstart', rememberTouch, { passive: true, capture: true });
    container.addEventListener('touchmove', rememberTouch, { passive: true, capture: true });
    container.addEventListener('touchend', clearTouch);
    container.addEventListener('touchcancel', finishGesture);
    window.addEventListener('blur', finishGesture);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      syncingRef.current = true;
      finishGesture();
      container.removeEventListener('touchstart', rememberTouch, true);
      container.removeEventListener('touchmove', rememberTouch, true);
      container.removeEventListener('touchend', clearTouch);
      container.removeEventListener('touchcancel', finishGesture);
      window.removeEventListener('blur', finishGesture);
      document.removeEventListener('visibilitychange', onVisibility);
      grid.off('change');
      grid.destroy(false);
      gridRef.current = null;
      syncingRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || !containerRef.current) return;
    const ids = new Set(instances.map((instance) => instance.id));
    const membershipUnchanged =
      grid.engine.nodes.length === ids.size &&
      grid.engine.nodes.every((node) => node.id && ids.has(node.id));
    if (editing && membershipUnchanged) return;
    syncingRef.current = true;
    grid.batchUpdate();
    for (const node of [...grid.engine.nodes]) {
      if (node.id && !ids.has(node.id) && node.el) grid.removeWidget(node.el, false, false);
    }
    for (const element of containerRef.current.querySelectorAll<GridItemHTMLElement>(
      '.grid-stack-item',
    )) {
      if (element.gridstackNode) continue;
      const instance = instances.find((item) => item.id === element.getAttribute('gs-id'));
      if (!instance) continue;
      const manifest = manifests.find((item) => item.id === instance.widgetId);
      grid.makeWidget(element, {
        id: instance.id,
        x: instance.x,
        y: instance.y,
        w: instance.w,
        h: instance.h,
        minW: manifest?.size.min.w ?? 1,
        minH: manifest?.size.min.h ?? 1,
        ...(manifest?.size.max ? { maxW: manifest.size.max.w, maxH: manifest.size.max.h } : {}),
      });
    }
    // Background refreshes may contain the last saved layout: do not replace an
    // in-progress edit with it. Explicit undo remounts this component separately.
    if (!editing)
      grid.load(
        instances.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
        false,
      );
    grid.batchUpdate(false);
    syncingRef.current = false;
  }, [editing, instances, manifests]);

  useLayoutEffect(() => {
    gridRef.current?.el.classList.toggle('dashboard-grid--editing', editing);
    gridRef.current?.setStatic(!editing);
  }, [editing]);

  if (instances.length === 0) {
    return (
      <div className="grid-stack dashboard-grid" ref={containerRef}>
        <div className="empty-page">
          <span>Cette page est vide.</span>
          <strong>Passez en mode édition pour ajouter votre premier widget.</strong>
        </div>
      </div>
    );
  }

  return (
    <div className="grid-stack dashboard-grid" ref={containerRef}>
      {instances.map((instance) => {
        const manifest = manifests.find((candidate) => candidate.id === instance.widgetId);
        return (
          <div className="grid-stack-item" key={instance.id} gs-id={instance.id}>
            <article className="grid-stack-item-content widget-card">
              <header className="widget-card__header widget-drag-handle">
                <div className="widget-card__title">
                  {editing && <Grip size={18} />}
                  <span className="widget-card__name">
                    {instance.title || manifest?.name || instance.widgetId}
                  </span>
                  {(instance.widgetId === 'weather.forecast' ||
                    instance.widgetId === 'weather.hourly') && (
                    <WeatherHeaderDetails instance={instance} />
                  )}
                </div>
                {editing && (
                  <div className="widget-card__actions">
                    <button
                      className="icon-button icon-button--small"
                      onClick={() => onConfigure(instance)}
                      aria-label="Configurer le widget"
                    >
                      <Settings2 size={18} />
                    </button>
                    <button
                      className="icon-button icon-button--small icon-button--danger"
                      onClick={() => onRemove(instance)}
                      aria-label="Supprimer le widget"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                )}
              </header>
              <div className="widget-card__body">
                <WidgetErrorBoundary>
                  <WidgetRenderer
                    instance={instance}
                    editing={editing}
                    adminUnlocked={adminUnlocked}
                  />
                </WidgetErrorBoundary>
              </div>
            </article>
          </div>
        );
      })}
    </div>
  );
}
