import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const testDirectory = mkdtempSync(join(tmpdir(), 'homedash-test-'));
process.env.NODE_ENV = 'test';
process.env.HOMEDASH_DATABASE_PATH = join(testDirectory, 'homedash.db');

const repository = await import('./dashboard.js');
const database = await import('../db/index.js');
const backup = await import('../services/backup.js');

afterAll(() => {
  database.closeDatabase();
  rmSync(testDirectory, { recursive: true, force: true });
});

describe('persistance dashboard', () => {
  it('crée le dashboard initial et ses widgets', () => {
    const bootstrap = repository.getBootstrap();
    expect(bootstrap.pages).toHaveLength(1);
    expect(bootstrap.instances.length).toBeGreaterThanOrEqual(5);
  });

  it('détecte un conflit optimiste sur les notes', () => {
    const noteWidget = repository
      .getBootstrap()
      .instances.find((item) => item.widgetId === 'notes');
    const noteId = String(noteWidget?.config.noteId);
    const initial = repository.getNote(noteId);
    const saved = repository.updateNote(noteId, 'Texte persistant', initial.revision);
    expect(saved.revision).toBe(initial.revision + 1);
    expect(() => repository.updateNote(noteId, 'Écrasement', initial.revision)).toThrowError(
      /modifiée/i,
    );
  });

  it('persiste et annule une disposition avec révision optimiste', () => {
    const initial = repository.getBootstrap();
    const page = initial.pages[0]!;
    const original = initial.instances.filter((item) => item.pageId === page.id);
    const moved = original.map((item) => ({
      id: item.id,
      x: item.x,
      y: item.y + 1,
      w: item.w,
      h: item.h,
    }));
    const revision = repository.saveLayout(page.id, initial.layoutRevision[page.id] ?? 0, moved);
    expect(revision).toBe(1);
    expect(repository.getBootstrap().instances.find((item) => item.id === moved[0]!.id)?.y).toBe(
      moved[0]!.y,
    );
    expect(() => repository.saveLayout(page.id, 0, moved)).toThrowError(/changé/i);
    const restored = repository.undoLayout(page.id);
    expect(restored.items.find((item) => item.id === original[0]!.id)?.y).toBe(original[0]!.y);
  });

  it('produit une sauvegarde SQLite cohérente', () => {
    const created = backup.createBackup();
    expect(created.size).toBeGreaterThan(0);
    expect(backup.listBackups()[0]?.filename).toBe(created.filename);
  });
});
