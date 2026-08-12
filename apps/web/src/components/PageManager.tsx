import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { DashboardPage } from '@homedash/contracts';
import { Modal } from './Modal';

export function PageManager({
  pages,
  onCreate,
  onRename,
  onDelete,
  onClose,
}: {
  pages: DashboardPage[];
  onCreate: (name: string) => void;
  onRename: (page: DashboardPage, name: string) => void;
  onDelete: (page: DashboardPage) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    onCreate(name.trim());
    setName('');
  }

  return (
    <Modal
      title="Gérer les pages"
      description="Organisez HomeDash par usages sans mélanger les widgets."
      onClose={onClose}
    >
      <div className="page-manager">
        <form className="inline-form" onSubmit={submit}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nom de la nouvelle page"
            maxLength={60}
          />
          <button className="button button--primary" type="submit">
            <Plus size={18} />
            Ajouter
          </button>
        </form>
        <ul>
          {pages.map((page) => (
            <li key={page.id}>
              {editingId === page.id ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && editingName.trim()) {
                      onRename(page, editingName.trim());
                      setEditingId(null);
                    }
                    if (event.key === 'Escape') setEditingId(null);
                  }}
                />
              ) : (
                <strong>{page.name}</strong>
              )}
              <div>
                <button
                  className="icon-button"
                  onClick={() => {
                    setEditingId(page.id);
                    setEditingName(page.name);
                  }}
                  aria-label={`Renommer ${page.name}`}
                >
                  <Pencil size={18} />
                </button>
                <button
                  className="icon-button icon-button--danger"
                  disabled={pages.length <= 1}
                  onClick={() => onDelete(page)}
                  aria-label={`Supprimer ${page.name}`}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
