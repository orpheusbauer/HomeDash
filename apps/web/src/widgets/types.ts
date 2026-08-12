import type { WidgetInstance } from '@homedash/contracts';

export interface WidgetComponentProps {
  instance: WidgetInstance;
  editing: boolean;
  adminUnlocked: boolean;
}
