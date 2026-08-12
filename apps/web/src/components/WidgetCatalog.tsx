import {
  Box,
  CalendarDays,
  Clock3,
  CloudRainWind,
  CloudSun,
  Cpu,
  StickyNote,
  Thermometer,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import type { WidgetManifest } from '@homedash/contracts';
import { Modal } from './Modal';

export function WidgetCatalog({
  manifests,
  onAdd,
  onClose,
}: {
  manifests: WidgetManifest[];
  onAdd: (widgetId: string) => void;
  onClose: () => void;
}) {
  const iconRegistry: Record<string, LucideIcon> = {
    CalendarDays,
    Clock3,
    CloudRainWind,
    CloudSun,
    Cpu,
    StickyNote,
    Thermometer,
    Wifi,
  };
  return (
    <Modal
      title="Ajouter un widget"
      description="Choisissez un module. Vous pourrez le déplacer et le configurer ensuite."
      onClose={onClose}
      wide
    >
      <div className="widget-catalog">
        {manifests.map((manifest) => {
          const Icon = iconRegistry[manifest.icon] ?? Box;
          return (
            <button
              type="button"
              className="catalog-card"
              key={manifest.id}
              onClick={() => onAdd(manifest.id)}
            >
              <span className="catalog-card__icon">
                <Icon size={26} />
              </span>
              <span>
                <strong>{manifest.name}</strong>
                <em className="catalog-card__category">{manifest.category}</em>
                <small>{manifest.description}</small>
              </span>
              <em>
                {manifest.size.default.w} × {manifest.size.default.h}
              </em>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
