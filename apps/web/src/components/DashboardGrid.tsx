import { useEffect, useRef } from 'react';
import { GridStack, type GridStackNode } from 'gridstack';
import { Grip, Settings2, Trash2 } from 'lucide-react';
import type { LayoutItem, WidgetInstance, WidgetManifest } from '@homedash/contracts';
import { WidgetErrorBoundary } from './WidgetErrorBoundary';
import { WidgetRenderer } from '../widgets/WidgetRenderer';

const BASE_GRID_COLUMNS = 48;

export function normalizeResponsiveLayout(
  item: { x: number; w: number },
  currentColumns: number,
): { x: number; w: number } {
  const scale = BASE_GRID_COLUMNS / Math.max(1, currentColumns);
  const x = Math.max(0, Math.round(item.x * scale));
  const width = Math.max(1, Math.round(item.w * scale));
  return { x: Math.min(x, BASE_GRID_COLUMNS - 1), w: Math.min(width, BASE_GRID_COLUMNS - x) };
}

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
  const readyRef = useRef(false);
  const layoutHandler = useRef(onLayoutChange);
  layoutHandler.current = onLayoutChange;

  useEffect(() => {
    if (!containerRef.current) return;
    readyRef.current = false;
    const grid = GridStack.init(
      {
        column: BASE_GRID_COLUMNS,
        columnOpts: {
          breakpointForWindow: true,
          breakpoints: [
            { w: 900, c: 24, layout: 'moveScale' },
            { w: 560, c: 1, layout: 'list' },
          ],
          layout: 'moveScale',
        },
        cellHeight: 22,
        margin: 8,
        float: true,
        animate: true,
        staticGrid: !editing,
        draggable: { handle: '.widget-drag-handle', scroll: true },
        resizable: { handles: 'e,se,s,sw,w' },
        alwaysShowResizeHandle: 'mobile',
      },
      containerRef.current,
    );
    if (!grid) return;
    gridRef.current = grid;
    const onChange = (_event: Event, nodes: GridStackNode[]) => {
      if (!readyRef.current || !editing) return;
      const currentColumns = grid.getColumn();
      const items = nodes
        .map((node) => {
          const id = node.el?.getAttribute('gs-id');
          if (!id) return null;
          const normalized = normalizeResponsiveLayout(
            { x: node.x ?? 0, w: node.w ?? 1 },
            currentColumns,
          );
          return {
            id,
            x: normalized.x,
            y: node.y ?? 0,
            w: normalized.w,
            h: node.h ?? 1,
          } satisfies LayoutItem;
        })
        .filter((item): item is LayoutItem => item !== null);
      if (items.length > 0) layoutHandler.current(items);
    };
    grid.on('change', onChange);
    const readyTimer = window.setTimeout(() => {
      readyRef.current = true;
    }, 100);
    return () => {
      window.clearTimeout(readyTimer);
      readyRef.current = false;
      grid.off('change');
      grid.destroy(false);
      gridRef.current = null;
    };
  }, [editing, instances]);

  if (instances.length === 0) {
    return (
      <div className="empty-page">
        <span>Cette page est vide.</span>
        <strong>Passez en mode édition pour ajouter votre premier widget.</strong>
      </div>
    );
  }

  return (
    <div
      className={`grid-stack dashboard-grid ${editing ? 'dashboard-grid--editing' : ''}`}
      ref={containerRef}
    >
      {instances.map((instance) => {
        const manifest = manifests.find((candidate) => candidate.id === instance.widgetId);
        return (
          <div
            className="grid-stack-item"
            key={instance.id}
            gs-id={instance.id}
            gs-x={instance.x}
            gs-y={instance.y}
            gs-w={instance.w}
            gs-h={instance.h}
            gs-min-w={manifest?.size.min.w ?? 1}
            gs-min-h={manifest?.size.min.h ?? 1}
            gs-max-w={manifest?.size.max?.w}
            gs-max-h={manifest?.size.max?.h}
          >
            <article className="grid-stack-item-content widget-card">
              <header className={`widget-card__header ${editing ? 'widget-drag-handle' : ''}`}>
                <div className="widget-card__title">
                  {editing && <Grip size={18} />}
                  <span>{instance.title || manifest?.name || instance.widgetId}</span>
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
