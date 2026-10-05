import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

export interface WidgetNotification {
  id: string;
  title: string;
  message: string;
  level: 'warning' | 'offline';
}

const NotificationsContext = createContext<WidgetNotification[]>([]);
const PublishContext = createContext<
  ((id: string, notification: WidgetNotification | null) => void) | null
>(null);
const WidgetScopeContext = createContext<{ id: string; title: string } | null>(null);

export function NotificationsProvider({ children }: PropsWithChildren) {
  const [entries, setEntries] = useState<Record<string, WidgetNotification>>({});
  const publish = useCallback((id: string, notification: WidgetNotification | null) => {
    setEntries((current) => {
      if (!notification) {
        if (!(id in current)) return current;
        const next = { ...current };
        delete next[id];
        return next;
      }
      const previous = current[id];
      if (
        previous?.title === notification.title &&
        previous.message === notification.message &&
        previous.level === notification.level
      )
        return current;
      return { ...current, [id]: notification };
    });
  }, []);
  const notifications = useMemo(() => Object.values(entries), [entries]);
  return (
    <PublishContext.Provider value={publish}>
      <NotificationsContext.Provider value={notifications}>
        {children}
      </NotificationsContext.Provider>
    </PublishContext.Provider>
  );
}

export function WidgetNotificationScope({
  id,
  title,
  children,
}: PropsWithChildren<{ id: string; title: string }>) {
  const scope = useMemo(() => ({ id, title }), [id, title]);
  return <WidgetScopeContext.Provider value={scope}>{children}</WidgetScopeContext.Provider>;
}

export function useWidgetNotification(
  message: string | null,
  level: WidgetNotification['level'] = 'warning',
) {
  const scope = useContext(WidgetScopeContext);
  const slot = useId();
  const id = scope ? `${scope.id}:${slot}` : null;
  useDashboardNotification(id, scope?.title ?? null, message, level);
}

export function useDashboardNotification(
  id: string | null,
  title: string | null,
  message: string | null,
  level: WidgetNotification['level'] = 'warning',
) {
  const publish = useContext(PublishContext);
  useEffect(() => {
    if (!publish || !id || !title) return;
    publish(id, message ? { id, title, message, level } : null);
    return () => publish(id, null);
  }, [publish, id, title, message, level]);
}

export function useWidgetNotifications() {
  return useContext(NotificationsContext);
}
