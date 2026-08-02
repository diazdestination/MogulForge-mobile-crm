import { describe, expect, it } from 'vitest';

import { getAppointmentOverlapWarning } from '@/lib/appointment-overlap';

import type { Appointment } from '@workspace/api-client-react';

const typeLabel = (t: Appointment['type']) =>
  ({
    inspection: 'Inspection',
    estimate_review: 'Estimate Review',
    production: 'Production',
    final_walkthrough: 'Final Walkthrough',
    other: 'Other',
  })[t];

function appt(over: Partial<Appointment>): Appointment {
  return {
    id: 'a1',
    organizationId: 'org1',
    type: 'estimate_review',
    status: 'scheduled',
    scheduledStart: '2026-08-03T14:00:00.000Z',
    scheduledEnd: '2026-08-03T15:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

const d = (iso: string) => new Date(iso);

describe('getAppointmentOverlapWarning', () => {
  it('returns null when the schedule is empty or undefined', () => {
    expect(
      getAppointmentOverlapWarning(d('2026-08-03T14:00:00Z'), d('2026-08-03T15:00:00Z'), [], typeLabel),
    ).toBeNull();
    expect(
      getAppointmentOverlapWarning(d('2026-08-03T14:00:00Z'), null, undefined, typeLabel),
    ).toBeNull();
  });

  it('warns when the planned window overlaps an existing appointment', () => {
    const warning = getAppointmentOverlapWarning(
      d('2026-08-03T14:30:00Z'),
      d('2026-08-03T16:00:00Z'),
      [appt({})],
      typeLabel,
    );
    expect(warning).toMatch(/overlaps an existing appointment/);
    expect(warning).toMatch(/Estimate Review/);
  });

  it('returns null when the windows only touch (end == start)', () => {
    expect(
      getAppointmentOverlapWarning(
        d('2026-08-03T15:00:00Z'),
        d('2026-08-03T16:00:00Z'),
        [appt({})],
        typeLabel,
      ),
    ).toBeNull();
    expect(
      getAppointmentOverlapWarning(
        d('2026-08-03T13:00:00Z'),
        d('2026-08-03T14:00:00Z'),
        [appt({})],
        typeLabel,
      ),
    ).toBeNull();
  });

  it('ignores cancelled, completed, and no-show appointments', () => {
    for (const status of ['cancelled', 'completed', 'no_show'] as const) {
      expect(
        getAppointmentOverlapWarning(
          d('2026-08-03T14:00:00Z'),
          d('2026-08-03T15:00:00Z'),
          [appt({ status })],
          typeLabel,
        ),
      ).toBeNull();
    }
  });

  it('treats an existing appointment with no end as 2 hours long', () => {
    const existing = appt({ scheduledEnd: null });
    expect(
      getAppointmentOverlapWarning(
        d('2026-08-03T15:30:00Z'),
        d('2026-08-03T16:30:00Z'),
        [existing],
        typeLabel,
      ),
    ).toMatch(/overlaps/);
    expect(
      getAppointmentOverlapWarning(
        d('2026-08-03T16:30:00Z'),
        d('2026-08-03T17:00:00Z'),
        [existing],
        typeLabel,
      ),
    ).toBeNull();
  });

  it('assumes a 2h planned window when no end is resolvable yet', () => {
    expect(
      getAppointmentOverlapWarning(d('2026-08-03T12:30:00Z'), null, [appt({})], typeLabel),
    ).toMatch(/overlaps/);
    expect(
      getAppointmentOverlapWarning(d('2026-08-03T11:00:00Z'), null, [appt({})], typeLabel),
    ).toBeNull();
  });

  it('names the earliest conflict and counts the rest', () => {
    const warning = getAppointmentOverlapWarning(
      d('2026-08-03T13:30:00Z'),
      d('2026-08-03T18:00:00Z'),
      [
        appt({ id: 'later', type: 'production', scheduledStart: '2026-08-03T16:00:00.000Z', scheduledEnd: '2026-08-03T17:00:00.000Z' }),
        appt({ id: 'earlier' }),
      ],
      typeLabel,
    );
    expect(warning).toMatch(/Estimate Review/);
    expect(warning).toMatch(/plus 1 more/);
  });

  it('includes extra context from describe()', () => {
    const warning = getAppointmentOverlapWarning(
      d('2026-08-03T14:00:00Z'),
      d('2026-08-03T15:00:00Z'),
      [appt({ leadId: 'lead1' })],
      typeLabel,
      (a) => (a.leadId === 'lead1' ? 'Jane Homeowner' : undefined),
    );
    expect(warning).toMatch(/Jane Homeowner/);
  });

  it('ignores appointments with invalid start dates', () => {
    expect(
      getAppointmentOverlapWarning(
        d('2026-08-03T14:00:00Z'),
        d('2026-08-03T15:00:00Z'),
        [appt({ scheduledStart: 'not-a-date' })],
        typeLabel,
      ),
    ).toBeNull();
  });
});
