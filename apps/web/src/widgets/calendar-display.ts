import type { CalendarEvent } from '@homedash/contracts';

export function calendarDate(value: string, allDay: boolean): Date {
  // Google date-only values are calendar days, not UTC instants.
  return new Date(allDay ? `${value}T00:00:00` : value);
}

export function calendarDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function calendarDayLabel(date: Date, now = new Date()): string {
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function calendarRelativeDay(date: Date, now = new Date()): string | null {
  if (calendarDayKey(date) === calendarDayKey(now)) return 'Aujourd’hui';
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return calendarDayKey(date) === calendarDayKey(tomorrow) ? 'Demain' : null;
}

export function calendarEventSchedule(event: CalendarEvent): string {
  const start = calendarDate(event.start, event.allDay);
  const end = calendarDate(event.end, event.allDay);
  if (event.allDay) {
    // Google uses an exclusive end date, including for multi-day events.
    end.setDate(end.getDate() - 1);
    return calendarDayKey(start) === calendarDayKey(end)
      ? 'Toute la journée'
      : `Toute la journée · du ${calendarDayLabel(start)} au ${calendarDayLabel(end)}`;
  }
  const time = (date: Date) =>
    date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return calendarDayKey(start) === calendarDayKey(end)
    ? `${time(start)} – ${time(end)}`
    : `Du ${calendarDayLabel(start)} à ${time(start)} au ${calendarDayLabel(end)} à ${time(end)}`;
}

export function groupCalendarEvents(events: CalendarEvent[], now = new Date()) {
  const today = calendarDayKey(now);
  const groups = new Map<string, { date: Date; events: CalendarEvent[] }>();
  for (const event of events.filter((event) => event.status !== 'cancelled')) {
    const start = calendarDate(event.start, event.allDay);
    const end = calendarDate(event.end, event.allDay);
    // An ongoing stay or overnight event belongs with today's agenda.
    const date = start < now && end > now ? now : start;
    const key = calendarDayKey(date);
    if (key < today) continue;
    const group = groups.get(key) ?? { date, events: [] };
    group.events.push(event);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => ({
      key,
      date: group.date,
      events: group.events.sort(
        (a, b) =>
          Number(b.allDay) - Number(a.allDay) ||
          calendarDate(a.start, a.allDay).getTime() - calendarDate(b.start, b.allDay).getTime(),
      ),
    }));
}

export function calendarDescriptionText(description: string): string {
  // Read rich Google descriptions as text, never insert their HTML into the page.
  const template = document.createElement('template');
  template.innerHTML = description;
  template.content
    .querySelectorAll('script, style, iframe, object')
    .forEach((node) => node.remove());
  template.content.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
  template.content
    .querySelectorAll('p, div, li, h1, h2, h3, h4, blockquote')
    .forEach((node) => node.append('\n'));
  return (template.content.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}
