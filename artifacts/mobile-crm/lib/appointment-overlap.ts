import type { Appointment } from '@workspace/api-client-react';

/**
 * Client-side helper to warn (not block) when a planned appointment window
 * overlaps an appointment already on the schedule. Mirrors the non-blocking
 * warning pattern in lib/inspection-availability.ts.
 */

/**
 * Existing appointments with no recorded end are treated as this long, the
 * same convention the API's inspection capacity guard uses server-side.
 */
const DEFAULT_END_MS = 2 * 60 * 60 * 1000;

/** Statuses that still occupy the schedule. */
const ACTIVE_STATUSES = new Set(['scheduled', 'confirmed']);

function formatRange(start: Date, end: Date): string {
  const startLabel = start.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const sameDay = start.toDateString() === end.toDateString();
  const endLabel = end.toLocaleString(
    undefined,
    sameDay
      ? { hour: 'numeric', minute: '2-digit' }
      : { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
  );
  return `${startLabel}–${endLabel}`;
}

/**
 * Returns a warning naming the first existing appointment that overlaps the
 * planned start–end window, or null when the slot is clear.
 *
 * @param typeLabel  maps an appointment type to its display label
 * @param describe   optional extra context (e.g. lead/contact name) for an appointment
 */
export function getAppointmentOverlapWarning(
  plannedStart: Date,
  plannedEnd: Date | null,
  appointments: Appointment[] | undefined,
  typeLabel: (type: Appointment['type']) => string,
  describe?: (appt: Appointment) => string | undefined,
): string | null {
  if (!appointments || appointments.length === 0) return null;
  if (Number.isNaN(plannedStart.getTime())) return null;
  const startMs = plannedStart.getTime();
  const endMs =
    plannedEnd && !Number.isNaN(plannedEnd.getTime()) && plannedEnd.getTime() > startMs
      ? plannedEnd.getTime()
      : startMs + DEFAULT_END_MS;

  const conflicts = appointments
    .filter((a) => ACTIVE_STATUSES.has(a.status))
    .map((a) => {
      const aStart = new Date(a.scheduledStart).getTime();
      if (Number.isNaN(aStart)) return null;
      const rawEnd = a.scheduledEnd ? new Date(a.scheduledEnd).getTime() : NaN;
      const aEnd = Number.isFinite(rawEnd) && rawEnd > aStart ? rawEnd : aStart + DEFAULT_END_MS;
      return { appt: a, start: aStart, end: aEnd };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .filter((x) => x.start < endMs && x.end > startMs)
    .sort((a, b) => a.start - b.start);

  if (conflicts.length === 0) return null;

  const first = conflicts[0];
  const extra = describe?.(first.appt);
  const name = `${typeLabel(first.appt.type)}${extra ? ` (${extra})` : ''}`;
  const range = formatRange(new Date(first.start), new Date(first.end));
  const others = conflicts.length - 1;
  return `This time overlaps an existing appointment: ${name}, ${range}${
    others > 0 ? `, plus ${others} more` : ''
  }.`;
}
