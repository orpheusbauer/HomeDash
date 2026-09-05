import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Clock3, Link2Off, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import type { CalendarEvent } from '@homedash/contracts';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import type { WidgetComponentProps } from './types';
import {
  calendarDayLabel,
  calendarDescriptionText,
  calendarEventSchedule,
  calendarRelativeDay,
  groupCalendarEvents,
} from './calendar-display';
import { hourlyWidgetRefresh } from '../widget-refresh';

interface CalendarInfo {
  id: string;
  name: string;
  primary: boolean;
  color: string | null;
}

function localDateTime(value: string): string {
  const date = new Date(value);
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

export function CalendarWidget({ instance, editing, adminUnlocked }: WidgetComponentProps) {
  const client = useQueryClient();
  const [edited, setEdited] = useState<CalendarEvent | 'new' | null>(null);
  const calendarIds = Array.isArray(instance.config.calendarIds)
    ? instance.config.calendarIds.filter((id): id is string => typeof id === 'string')
    : ['primary'];
  const statusQuery = useQuery({
    queryKey: ['calendar-status'],
    queryFn: () => api<{ configured: boolean }>('/api/v1/calendar/status'),
    ...hourlyWidgetRefresh,
  });
  const calendarsQuery = useQuery({
    queryKey: ['calendar-list'],
    queryFn: () => api<CalendarInfo[]>('/api/v1/calendar/calendars'),
    enabled: statusQuery.data?.configured === true && calendarIds.length > 1,
    ...hourlyWidgetRefresh,
  });
  const eventsQuery = useQuery({
    queryKey: ['calendar-events', calendarIds],
    queryFn: () =>
      api<{ events: CalendarEvent[]; stale: boolean; fetchedAt: string }>(
        `/api/v1/calendar/events?calendarIds=${encodeURIComponent(calendarIds.join(','))}&days=14`,
      ),
    enabled: statusQuery.data?.configured === true,
    ...hourlyWidgetRefresh,
  });
  const saveEvent = useMutation({
    mutationFn: async (values: { title: string; start: string; end: string; location: string }) => {
      const calendarId =
        edited !== 'new' && edited ? edited.calendarId : (calendarIds[0] ?? 'primary');
      const event = {
        summary: values.title,
        location: values.location || undefined,
        start: { dateTime: new Date(values.start).toISOString() },
        end: { dateTime: new Date(values.end).toISOString() },
      };
      if (edited !== 'new' && edited) {
        return api(
          `/api/v1/calendar/events/${encodeURIComponent(edited.id)}`,
          { method: 'PATCH', body: JSON.stringify({ calendarId, event }) },
          true,
        );
      }
      return api(
        '/api/v1/calendar/events',
        { method: 'POST', body: JSON.stringify({ calendarId, event }) },
        true,
      );
    },
    onSuccess: () => {
      setEdited(null);
      void client.invalidateQueries({ queryKey: ['calendar-events'] });
    },
  });
  const removeEvent = useMutation({
    mutationFn: (event: CalendarEvent) =>
      api(
        `/api/v1/calendar/events/${encodeURIComponent(event.id)}?calendarId=${encodeURIComponent(event.calendarId)}`,
        { method: 'DELETE' },
        true,
      ),
    onSuccess: () => {
      setEdited(null);
      void client.invalidateQueries({ queryKey: ['calendar-events'] });
    },
  });
  if (statusQuery.data && !statusQuery.data.configured) {
    return (
      <div className="calendar-empty">
        <Link2Off size={30} />
        <strong>Google Calendar n’est pas connecté</strong>
        <span>Suivez le guide dans Paramètres → Intégrations.</span>
      </div>
    );
  }
  if (!eventsQuery.data)
    return (
      <div className="widget-centered">
        <StatusBadge status={statusQuery.isError || eventsQuery.isError ? 'error' : 'loading'} />
      </div>
    );
  const groups = groupCalendarEvents(eventsQuery.data.events);
  const eventCount = groups.reduce((count, group) => count + group.events.length, 0);
  return (
    <div className="calendar-widget">
      {editing && adminUnlocked && (
        <div className="calendar-toolbar">
          <button className="calendar-add" onClick={() => setEdited('new')}>
            <Plus size={16} />
            Événement
          </button>
        </div>
      )}
      {eventCount === 0 ? (
        <div className="calendar-empty">
          <CalendarClock size={30} />
          <strong>Aucun événement à venir</strong>
        </div>
      ) : (
        <div className="calendar-days">
          {groups.map((group) => {
            const relativeDay = calendarRelativeDay(group.date);
            return (
              <section className="calendar-day" key={group.key}>
                <h3 className="calendar-day__heading">
                  <time dateTime={group.key}>{calendarDayLabel(group.date)}</time>
                  {relativeDay && <span className="calendar-day__relative">{relativeDay}</span>}
                </h3>
                <ol className="event-list">
                  {group.events.map((event) => {
                    const calendar = calendarsQuery.data?.find(
                      (item) =>
                        item.id === event.calendarId ||
                        (event.calendarId === 'primary' && item.primary),
                    );
                    const description = event.description
                      ? calendarDescriptionText(event.description)
                      : '';
                    return (
                      <li
                        className="calendar-event"
                        key={`${event.calendarId}-${event.id}`}
                        style={{ borderLeftColor: calendar?.color ?? 'var(--accent)' }}
                      >
                        <div className="calendar-event__content">
                          <div className="calendar-event__schedule">
                            <Clock3 size={15} aria-hidden="true" />
                            <span>{calendarEventSchedule(event)}</span>
                          </div>
                          <strong className="calendar-event__title">{event.title}</strong>
                          {event.location && (
                            <div className="calendar-event__location">
                              <MapPin size={15} aria-hidden="true" />
                              <span>{event.location}</span>
                            </div>
                          )}
                          {description && (
                            <details className="calendar-event__description">
                              <summary aria-label={`Description de ${event.title}`}>
                                Description
                              </summary>
                              <p>{description}</p>
                            </details>
                          )}
                        </div>
                        {editing && adminUnlocked && (
                          <button
                            className="event-edit"
                            onClick={() => setEdited(event)}
                            aria-label={`Modifier ${event.title}`}
                          >
                            <Pencil size={17} />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>
      )}
      <StatusBadge status={eventsQuery.data.stale ? 'stale' : 'ready'} />
      {edited && (
        <CalendarEventDialog
          event={edited}
          saving={saveEvent.isPending}
          onSave={(values) => saveEvent.mutate(values)}
          {...(edited === 'new' ? {} : { onDelete: () => removeEvent.mutate(edited) })}
          onClose={() => setEdited(null)}
        />
      )}
    </div>
  );
}

function CalendarEventDialog({
  event,
  saving,
  onSave,
  onDelete,
  onClose,
}: {
  event: CalendarEvent | 'new';
  saving: boolean;
  onSave: (values: { title: string; start: string; end: string; location: string }) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const now = new Date();
  const startDefault = new Date(Math.ceil(now.getTime() / 1_800_000) * 1_800_000);
  const [title, setTitle] = useState(event === 'new' ? '' : event.title);
  const [location, setLocation] = useState(event === 'new' ? '' : (event.location ?? ''));
  const [start, setStart] = useState(
    localDateTime(event === 'new' ? startDefault.toISOString() : event.start),
  );
  const [end, setEnd] = useState(
    localDateTime(
      event === 'new' ? new Date(startDefault.getTime() + 3_600_000).toISOString() : event.end,
    ),
  );
  return (
    <Modal
      title={event === 'new' ? 'Nouvel événement' : 'Modifier l’événement'}
      onClose={onClose}
      footer={
        <>
          <button className="button button--ghost" onClick={onClose}>
            Annuler
          </button>
          {onDelete && (
            <button className="button button--danger" onClick={onDelete}>
              <Trash2 size={16} />
              Supprimer
            </button>
          )}
          <button
            className="button button--primary"
            disabled={saving || !title.trim() || end <= start}
            onClick={() => onSave({ title: title.trim(), start, end, location: location.trim() })}
          >
            Enregistrer
          </button>
        </>
      }
    >
      <div className="form-stack">
        <label className="field">
          <span>Titre</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>Lieu</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>Début</span>
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="field">
            <span>Fin</span>
            <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
      </div>
    </Modal>
  );
}
