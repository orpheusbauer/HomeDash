import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, CloudOff, LoaderCircle } from 'lucide-react';
import type { Note } from '@homedash/contracts';
import { api } from '../api';
import type { WidgetComponentProps } from './types';

export function NotesWidget({ instance }: WidgetComponentProps) {
  const noteId = typeof instance.config.noteId === 'string' ? instance.config.noteId : '';
  const draftKey = `homedash.noteDraft.${noteId}`;
  const query = useQuery({
    queryKey: ['note', noteId],
    queryFn: () => api<Note>(`/api/v1/notes/${noteId}`),
    enabled: Boolean(noteId),
  });
  const [content, setContent] = useState(() => localStorage.getItem(draftKey) ?? '');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'offline' | 'conflict'>(
    'idle',
  );
  const revision = useRef(0);
  const hydrated = useRef(false);
  const skipNextSave = useRef(false);
  const lastSavedContent = useRef('');

  useEffect(() => {
    if (!query.data || hydrated.current) return;
    revision.current = query.data.revision;
    const draft = localStorage.getItem(draftKey);
    lastSavedContent.current = query.data.content;
    skipNextSave.current = true;
    setContent(draft ?? query.data.content);
    hydrated.current = true;
  }, [draftKey, query.data]);

  useEffect(() => {
    if (!hydrated.current) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (content === lastSavedContent.current) {
      setSaveState('saved');
      return;
    }
    localStorage.setItem(draftKey, content);
    setSaveState('saving');
    const timer = window.setTimeout(async () => {
      try {
        const saved = await api<Note>(`/api/v1/notes/${noteId}`, {
          method: 'PUT',
          body: JSON.stringify({ content, expectedRevision: revision.current }),
        });
        revision.current = saved.revision;
        lastSavedContent.current = saved.content;
        localStorage.removeItem(draftKey);
        setSaveState('saved');
      } catch (error) {
        setSaveState(error instanceof TypeError ? 'offline' : 'conflict');
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [content, draftKey, noteId]);

  if (!noteId) return <div className="widget-error">Configuration de note manquante.</div>;
  return (
    <div className="notes-widget">
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="Écrivez quelque chose…"
        aria-label="Contenu de la note"
      />
      <span className={`notes-save notes-save--${saveState}`}>
        {saveState === 'saving' && (
          <>
            <LoaderCircle className="spin" size={14} />
            Sauvegarde…
          </>
        )}
        {saveState === 'saved' && (
          <>
            <Check size={14} />
            Sauvegardé
          </>
        )}
        {saveState === 'offline' && (
          <>
            <CloudOff size={14} />
            Brouillon local
          </>
        )}
        {saveState === 'conflict' && 'Conflit : rechargez la page'}
      </span>
    </div>
  );
}
