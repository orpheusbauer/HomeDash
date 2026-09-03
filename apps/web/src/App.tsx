import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CloudOff,
  LayoutDashboard,
  Lock,
  Menu,
  Pencil,
  Plus,
  RotateCcw,
  Settings,
  Wifi,
} from 'lucide-react';
import type {
  BootstrapData,
  DashboardPage,
  LayoutItem,
  RealtimeMessage,
  Sensor,
  SystemMetrics,
  WidgetInstance,
} from '@homedash/contracts';
import { api, ApiError, hasAdminSession, realtimeUrl } from './api';
import { AdminDialog } from './components/AdminDialog';
import { DashboardGrid } from './components/DashboardGrid';
import { Modal } from './components/Modal';
import { PageManager } from './components/PageManager';
import { WidgetCatalog } from './components/WidgetCatalog';
import { WidgetSettings } from './components/WidgetSettings';
import { SettingsCenter } from './components/SettingsCenter';
import { cachedBootstrap, saveBootstrapCache } from './bootstrap-cache';
import { HeaderClock } from './components/HeaderClock';

export function App() {
  const queryClient = useQueryClient();
  const bootstrap = useQuery({
    queryKey: ['bootstrap'],
    queryFn: async ({ signal }) => {
      const data = await api<BootstrapData>('/api/v1/bootstrap', { signal });
      saveBootstrapCache(data);
      return data;
    },
    initialData: cachedBootstrap,
    refetchInterval: 60_000,
  });
  const data = bootstrap.data;
  const [activePageId, setActivePageId] = useState(
    () => localStorage.getItem('homedash.activePage') ?? '',
  );
  const [editing, setEditing] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(hasAdminSession());
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminPurpose, setAdminPurpose] = useState<'editing' | 'settings'>('editing');
  const [showCatalog, setShowCatalog] = useState(false);
  const [showPages, setShowPages] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [configuredWidget, setConfiguredWidget] = useState<WidgetInstance | null>(null);
  const [connection, setConnection] = useState<'online' | 'offline' | 'connecting'>('connecting');
  const [toast, setToast] = useState('');
  const revisionRef = useRef<Record<string, number>>({});
  const editingRevisionRef = useRef(0);
  const layoutDraftRef = useRef<{
    pageId: string;
    expectedRevision: number;
    items: LayoutItem[];
  } | null>(null);
  const layoutSaveRef = useRef<Promise<boolean> | null>(null);
  const [savingLayout, setSavingLayout] = useState(false);
  const [layoutEpoch, setLayoutEpoch] = useState(0);

  useEffect(() => {
    if (!data) return;
    revisionRef.current = { ...data.layoutRevision };
    if (!data.pages.some((page) => page.id === activePageId)) {
      setActivePageId(data.pages[0]?.id ?? '');
    }
  }, [activePageId, data]);

  useEffect(() => {
    if (!activePageId) return;
    localStorage.setItem('homedash.activePage', activePageId);
  }, [activePageId]);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let retryTimer: number | undefined;
    let disposed = false;
    const connect = () => {
      setConnection('connecting');
      socket = new WebSocket(realtimeUrl());
      socket.addEventListener('open', () => setConnection('online'));
      socket.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(String(event.data)) as RealtimeMessage;
          if (message.type === 'sensor.updated') {
            queryClient.setQueryData<Sensor>(['sensor', message.payload.id], message.payload);
            void queryClient.invalidateQueries({ queryKey: ['sensors'] });
          }
          if (message.type === 'system.updated')
            queryClient.setQueryData<SystemMetrics>(['system'], message.payload);
          if (message.type === 'dashboard.changed')
            void queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
        } catch {
          // Ignore messages from an incompatible future server.
        }
      });
      socket.addEventListener('close', () => {
        setConnection('offline');
        if (!disposed) retryTimer = window.setTimeout(connect, 3000);
      });
      socket.addEventListener('error', () => socket?.close());
    };
    connect();
    return () => {
      disposed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [queryClient]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const lockAdmin = () => {
      setAdminUnlocked(false);
      if (layoutDraftRef.current) {
        setAdminPurpose('editing');
        setShowAdmin(true);
      } else setEditing(false);
      setToast('Session administrateur expirée');
    };
    window.addEventListener('homedash:admin-locked', lockAdmin);
    return () => window.removeEventListener('homedash:admin-locked', lockAdmin);
  }, []);

  useEffect(() => {
    const protectDraft = (event: BeforeUnloadEvent) => {
      if (!layoutDraftRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, []);

  const activePage = data?.pages.find((page) => page.id === activePageId) ?? data?.pages[0];
  const instances = useMemo(
    () => data?.instances.filter((instance) => instance.pageId === activePage?.id) ?? [],
    [activePage?.id, data?.instances],
  );

  function requestEditing() {
    if (adminUnlocked || hasAdminSession()) {
      setAdminUnlocked(true);
      editingRevisionRef.current = revisionRef.current[activePage?.id ?? ''] ?? 0;
      setEditing(true);
    } else {
      setAdminPurpose('editing');
      setShowAdmin(true);
    }
  }

  function requestSettings() {
    if (adminUnlocked || hasAdminSession()) {
      setAdminUnlocked(true);
      setShowSettings(true);
    } else {
      setAdminPurpose('settings');
      setShowAdmin(true);
    }
  }

  function saveLayout(items: LayoutItem[]) {
    if (!activePage) return;
    layoutDraftRef.current = {
      pageId: activePage.id,
      expectedRevision: layoutDraftRef.current?.expectedRevision ?? editingRevisionRef.current,
      items,
    };
  }

  function persistLayout(): Promise<boolean> {
    if (layoutSaveRef.current) return layoutSaveRef.current;
    const draft = layoutDraftRef.current;
    if (!draft) return Promise.resolve(true);
    setSavingLayout(true);
    const pending = (async () => {
      try {
        const result = await api<{ revision: number }>(
          `/api/v1/pages/${draft.pageId}/layout`,
          {
            method: 'PUT',
            body: JSON.stringify({
              expectedRevision: draft.expectedRevision,
              items: draft.items,
            }),
          },
          true,
        );
        revisionRef.current[draft.pageId] = result.revision;
        editingRevisionRef.current = result.revision;
        // Cancel older bootstrap requests before acknowledging this snapshot.
        await queryClient.cancelQueries({ queryKey: ['bootstrap'] });
        queryClient.setQueryData<BootstrapData>(['bootstrap'], (previous) => {
          if (!previous) return previous;
          const saved = {
            ...previous,
            layoutRevision: { ...previous.layoutRevision, [draft.pageId]: result.revision },
            instances: previous.instances.map((instance) => ({
              ...instance,
              ...draft.items.find((item) => item.id === instance.id),
            })),
          };
          saveBootstrapCache(saved);
          return saved;
        });
        if (layoutDraftRef.current === draft) layoutDraftRef.current = null;
        else if (layoutDraftRef.current) layoutDraftRef.current.expectedRevision = result.revision;
        setToast('Disposition sauvegardée');
        return true;
      } catch (error) {
        setToast(
          error instanceof ApiError && error.code === 'LAYOUT_CONFLICT'
            ? 'Disposition modifiée ailleurs. Vos changements restent visibles ; Annuler recharge la version du serveur.'
            : 'Sauvegarde impossible. Vos modifications sont conservées : réessayez Terminer.',
        );
        return false;
      } finally {
        layoutSaveRef.current = null;
        setSavingLayout(false);
      }
    })();
    layoutSaveRef.current = pending;
    return pending;
  }

  async function finishEditing(): Promise<boolean> {
    if (!(await persistLayout())) return false;
    // If a last gesture ended while the request was in flight, save that too.
    if (layoutDraftRef.current) return finishEditing();
    setEditing(false);
    return true;
  }

  async function changePage(pageId: string) {
    if (editing && !(await finishEditing())) return;
    setActivePageId(pageId);
  }

  async function addWidget(widgetId: string) {
    if (!activePage) return;
    if (!(await persistLayout())) return;
    await api(
      `/api/v1/pages/${activePage.id}/widgets`,
      { method: 'POST', body: JSON.stringify({ widgetId, config: {} }) },
      true,
    );
    setShowCatalog(false);
    await bootstrap.refetch();
    setToast('Widget ajouté');
  }

  async function removeWidget(instance: WidgetInstance) {
    if (
      !window.confirm(
        `Supprimer « ${instance.title || data?.widgets.find((item) => item.id === instance.widgetId)?.name || instance.widgetId} » ?`,
      )
    )
      return;
    if (!(await persistLayout())) return;
    await api(`/api/v1/widgets/${instance.id}`, { method: 'DELETE' }, true);
    await bootstrap.refetch();
  }

  async function saveWidget(title: string | null, config: Record<string, unknown>) {
    if (!configuredWidget) return;
    if (!(await persistLayout())) return;
    await api(
      `/api/v1/widgets/${configuredWidget.id}`,
      { method: 'PATCH', body: JSON.stringify({ title, config }) },
      true,
    );
    setConfiguredWidget(null);
    await bootstrap.refetch();
    setToast('Widget configuré');
  }

  async function createPage(name: string) {
    if (editing && !(await finishEditing())) return;
    const page = await api<DashboardPage>(
      '/api/v1/pages',
      { method: 'POST', body: JSON.stringify({ name }) },
      true,
    );
    await bootstrap.refetch();
    setActivePageId(page.id);
  }

  async function renamePage(page: DashboardPage, name: string) {
    await api(
      `/api/v1/pages/${page.id}`,
      { method: 'PATCH', body: JSON.stringify({ name }) },
      true,
    );
    await bootstrap.refetch();
  }

  async function deletePage(page: DashboardPage) {
    if (!window.confirm(`Supprimer définitivement la page « ${page.name} » et tous ses widgets ?`))
      return;
    if (editing && !(await finishEditing())) return;
    await api(`/api/v1/pages/${page.id}`, { method: 'DELETE' }, true);
    await bootstrap.refetch();
  }

  async function undoLayout() {
    if (!activePage) return;
    if (savingLayout) return;
    if (layoutDraftRef.current) {
      layoutDraftRef.current = null;
      const refreshed = await bootstrap.refetch();
      editingRevisionRef.current = refreshed.data?.layoutRevision[activePage.id] ?? 0;
      setLayoutEpoch((value) => value + 1);
      setToast('Modifications non enregistrées annulées');
      return;
    }
    try {
      const result = await api<{ revision: number }>(
        `/api/v1/pages/${activePage.id}/layout/undo`,
        { method: 'POST' },
        true,
      );
      revisionRef.current[activePage.id] = result.revision;
      editingRevisionRef.current = result.revision;
      await bootstrap.refetch();
      setLayoutEpoch((value) => value + 1);
      setToast('Disposition précédente restaurée');
    } catch {
      setToast('Aucune disposition précédente');
    }
  }

  if (!data) {
    return (
      <main className="boot-screen">
        <div className="brand-mark">
          <LayoutDashboard size={34} />
        </div>
        <h1>HomeDash</h1>
        <p>
          {bootstrap.isError
            ? 'Le Raspberry Pi est inaccessible. Nouvelle tentative en cours…'
            : 'Préparation de votre maison…'}
        </p>
      </main>
    );
  }

  return (
    <div className={`app-shell ${editing ? 'app-shell--editing' : ''}`}>
      <header className="topbar">
        <div className="topbar__navigation">
          <a className="brand" href="/" aria-label="Accueil HomeDash">
            <span className="brand-mark">
              <LayoutDashboard size={22} />
            </span>
            <strong>HomeDash</strong>
          </a>
          <nav className="page-tabs" aria-label="Pages du dashboard">
            {data.pages.map((page) => (
              <button
                className={page.id === activePage?.id ? 'is-active' : ''}
                key={page.id}
                onClick={() => void changePage(page.id)}
                disabled={savingLayout}
              >
                {page.name}
              </button>
            ))}
          </nav>
        </div>
        <HeaderClock />
        <div className="topbar__actions">
          <span
            className={`connection-pill connection-pill--${connection}`}
            title="État de la connexion au Raspberry Pi"
          >
            {connection === 'online' ? <Wifi size={16} /> : <CloudOff size={16} />}
            <span>
              {connection === 'online'
                ? 'Local'
                : connection === 'connecting'
                  ? 'Connexion'
                  : 'Hors ligne'}
            </span>
          </span>
          {editing ? (
            <button
              className="button button--primary"
              onClick={() => void finishEditing()}
              disabled={savingLayout}
              aria-label="Terminer la modification"
            >
              <Lock size={18} />
              <span>{savingLayout ? 'Enregistrement…' : 'Terminer'}</span>
            </button>
          ) : (
            <button
              className="icon-button"
              onClick={requestEditing}
              aria-label="Modifier le dashboard"
              title="Modifier le dashboard"
            >
              <Pencil size={18} />
            </button>
          )}
          <button className="icon-button" onClick={requestSettings} aria-label="Paramètres">
            <Settings size={20} />
          </button>
        </div>
      </header>

      {editing && (
        <div className="dashboard-editbar">
          <button onClick={() => setShowCatalog(true)}>
            <Plus size={19} />
            Widget
          </button>
          <button onClick={() => setShowPages(true)}>
            <Menu size={19} />
            Pages
          </button>
          <button onClick={() => void undoLayout()}>
            <RotateCcw size={19} />
            Annuler
          </button>
        </div>
      )}

      <main className="dashboard-main" aria-label={activePage?.name ?? 'Dashboard'}>
        <DashboardGrid
          key={`${activePage?.id ?? 'none'}-${layoutEpoch}`}
          instances={instances}
          manifests={data.widgets}
          editing={editing}
          adminUnlocked={adminUnlocked}
          onLayoutChange={saveLayout}
          onConfigure={setConfiguredWidget}
          onRemove={(instance) => void removeWidget(instance)}
        />
      </main>

      {showAdmin && (
        <AdminDialog
          onClose={() => setShowAdmin(false)}
          onSuccess={() => {
            setShowAdmin(false);
            setAdminUnlocked(true);
            if (adminPurpose === 'editing') {
              if (!layoutDraftRef.current)
                editingRevisionRef.current = revisionRef.current[activePage?.id ?? ''] ?? 0;
              setEditing(true);
            } else setShowSettings(true);
          }}
        />
      )}
      {showCatalog && (
        <WidgetCatalog
          manifests={data.widgets}
          onAdd={(id) => void addWidget(id)}
          onClose={() => setShowCatalog(false)}
        />
      )}
      {configuredWidget && (
        <WidgetSettings
          instance={configuredWidget}
          {...(() => {
            const manifest = data.widgets.find((item) => item.id === configuredWidget.widgetId);
            return manifest ? { manifest } : {};
          })()}
          onSave={(title, config) => void saveWidget(title, config)}
          onClose={() => setConfiguredWidget(null)}
        />
      )}
      {showPages && (
        <PageManager
          pages={data.pages}
          onCreate={(name) => void createPage(name)}
          onRename={(page, name) => void renamePage(page, name)}
          onDelete={(page) => void deletePage(page)}
          onClose={() => setShowPages(false)}
        />
      )}
      {showSettings && (
        <Modal
          title="Paramètres HomeDash"
          description="État et informations de cette installation locale."
          onClose={() => setShowSettings(false)}
        >
          <div className="settings-list settings-summary">
            <div>
              <span>Version installée</span>
              <strong>{data.version}</strong>
            </div>
            <div>
              <span>Serveur</span>
              <strong className={connection === 'online' ? 'text-success' : 'text-danger'}>
                {connection === 'online' ? 'Connecté' : 'Déconnecté'}
              </strong>
            </div>
          </div>
          <SettingsCenter
            authenticated={adminUnlocked}
            onRequestUnlock={() => {
              setAdminPurpose('settings');
              setShowSettings(false);
              setShowAdmin(true);
            }}
          />
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
