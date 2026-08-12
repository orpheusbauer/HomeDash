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
import { api, hasAdminToken, realtimeUrl } from './api';
import { AdminDialog } from './components/AdminDialog';
import { DashboardGrid } from './components/DashboardGrid';
import { Modal } from './components/Modal';
import { PageManager } from './components/PageManager';
import { WidgetCatalog } from './components/WidgetCatalog';
import { WidgetSettings } from './components/WidgetSettings';
import { SettingsCenter } from './components/SettingsCenter';

function cachedBootstrap(): BootstrapData | undefined {
  try {
    const raw = localStorage.getItem('homedash.bootstrap');
    return raw ? (JSON.parse(raw) as BootstrapData) : undefined;
  } catch {
    return undefined;
  }
}

export function App() {
  const queryClient = useQueryClient();
  const bootstrap = useQuery({
    queryKey: ['bootstrap'],
    queryFn: async () => {
      const data = await api<BootstrapData>('/api/v1/bootstrap');
      localStorage.setItem('homedash.bootstrap', JSON.stringify(data));
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
  const [adminUnlocked, setAdminUnlocked] = useState(hasAdminToken());
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminPurpose, setAdminPurpose] = useState<'editing' | 'settings'>('editing');
  const [showCatalog, setShowCatalog] = useState(false);
  const [showPages, setShowPages] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [configuredWidget, setConfiguredWidget] = useState<WidgetInstance | null>(null);
  const [connection, setConnection] = useState<'online' | 'offline' | 'connecting'>('connecting');
  const [toast, setToast] = useState('');
  const revisionRef = useRef<Record<string, number>>({});
  const saveTimerRef = useRef<number | undefined>(undefined);

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

  const activePage = data?.pages.find((page) => page.id === activePageId) ?? data?.pages[0];
  const instances = useMemo(
    () => data?.instances.filter((instance) => instance.pageId === activePage?.id) ?? [],
    [activePage?.id, data?.instances],
  );

  function requestEditing() {
    if (adminUnlocked || hasAdminToken()) {
      setAdminUnlocked(true);
      setEditing(true);
    } else {
      setAdminPurpose('editing');
      setShowAdmin(true);
    }
  }

  async function saveLayout(items: LayoutItem[]) {
    if (!activePage) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(async () => {
      try {
        const result = await api<{ revision: number }>(
          `/api/v1/pages/${activePage.id}/layout`,
          {
            method: 'PUT',
            body: JSON.stringify({
              expectedRevision: revisionRef.current[activePage.id] ?? 0,
              items,
            }),
          },
          true,
        );
        revisionRef.current[activePage.id] = result.revision;
        setToast('Disposition sauvegardée');
      } catch {
        setToast('Impossible de sauvegarder la disposition');
        await bootstrap.refetch();
      }
    }, 350);
  }

  async function addWidget(widgetId: string) {
    if (!activePage) return;
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
    await api(`/api/v1/widgets/${instance.id}`, { method: 'DELETE' }, true);
    await bootstrap.refetch();
  }

  async function saveWidget(title: string | null, config: Record<string, unknown>) {
    if (!configuredWidget) return;
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
    await api(`/api/v1/pages/${page.id}`, { method: 'DELETE' }, true);
    await bootstrap.refetch();
  }

  async function undoLayout() {
    if (!activePage) return;
    try {
      const result = await api<{ revision: number }>(
        `/api/v1/pages/${activePage.id}/layout/undo`,
        { method: 'POST' },
        true,
      );
      revisionRef.current[activePage.id] = result.revision;
      await bootstrap.refetch();
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
              onClick={() => setActivePageId(page.id)}
            >
              {page.name}
            </button>
          ))}
        </nav>
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
            <>
              <button
                className="button button--ghost desktop-action"
                onClick={() => setShowCatalog(true)}
              >
                <Plus size={18} />
                Widget
              </button>
              <button
                className="button button--ghost desktop-action"
                onClick={() => setShowPages(true)}
              >
                <Menu size={18} />
                Pages
              </button>
              <button
                className="button button--ghost desktop-action"
                onClick={() => void undoLayout()}
              >
                <RotateCcw size={18} />
                Annuler
              </button>
              <button className="button button--primary" onClick={() => setEditing(false)}>
                <Lock size={18} />
                Terminer
              </button>
            </>
          ) : (
            <button className="button button--ghost" onClick={requestEditing}>
              <Pencil size={18} />
              Modifier
            </button>
          )}
          <button
            className="icon-button"
            onClick={() => setShowSettings(true)}
            aria-label="Paramètres"
          >
            <Settings size={20} />
          </button>
        </div>
      </header>

      {editing && (
        <div className="mobile-editbar">
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

      <main className="dashboard-main">
        <div className="page-heading">
          <div>
            <span>{editing ? 'Mode édition' : 'Votre espace'}</span>
            <h1>{activePage?.name}</h1>
          </div>
          {editing && (
            <p>Maintenez une poignée pour déplacer · tirez les coins pour redimensionner</p>
          )}
        </div>
        <DashboardGrid
          key={`${activePage?.id ?? 'none'}-${editing}`}
          instances={instances}
          manifests={data.widgets}
          editing={editing}
          adminUnlocked={adminUnlocked}
          onLayoutChange={(items) => void saveLayout(items)}
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
            if (adminPurpose === 'editing') setEditing(true);
            else setShowSettings(true);
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
