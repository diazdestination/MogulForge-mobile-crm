import { describe, expect, it } from 'vitest';

import {
  describeAvailability,
  formatHour,
  getInspectionAvailabilityWarning,
} from '@workspace/inspection-availability';

import type { InspectionAvailabilitySettings } from '@workspace/api-client-react';

const availability: InspectionAvailabilitySettings = {
  timezone: 'America/Chicago',
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  windows: [
    { startHour: 8, endHour: 11 },
    { startHour: 13, endHour: 16 },
  ],
  maxBookingsPerWindow: 2,
  blackoutDates: ['2026-08-14'],
};

// Helper: build an instant from a Chicago local time (CDT = UTC-5 in August).
const chicago = (iso: string) => new Date(`${iso}-05:00`);

describe('formatHour', () => {
  it('formats whole and fractional hours', () => {
    expect(formatHour(8)).toBe('8:00 AM');
    expect(formatHour(13.5)).toBe('1:30 PM');
    expect(formatHour(0)).toBe('12:00 AM');
    expect(formatHour(12)).toBe('12:00 PM');
  });
});

describe('describeAvailability', () => {
  it('summarizes days, windows, and timezone', () => {
    expect(describeAvailability(availability)).toBe(
      'Mon, Tue, Wed, Thu, Fri · 8:00 AM–11:00 AM or 1:00 PM–4:00 PM (America/Chicago)',
    );
  });
});

describe('getInspectionAvailabilityWarning', () => {
  it('accepts a time inside a configured window on a bookable day', () => {
    // Mon 2026-08-03 9:00 AM Chicago
    expect(
      getInspectionAvailabilityWarning(chicago('2026-08-03T09:00:00'), availability),
    ).toBeNull();
  });

  it('accepts the exact window start and rejects the exact window end', () => {
    expect(
      getInspectionAvailabilityWarning(chicago('2026-08-03T13:00:00'), availability),
    ).toBeNull();
    expect(
      getInspectionAvailabilityWarning(chicago('2026-08-03T16:00:00'), availability),
    ).toMatch(/outside the configured inspection hours/);
  });

  it('warns for out-of-window times on a bookable day', () => {
    expect(
      getInspectionAvailabilityWarning(chicago('2026-08-03T12:00:00'), availability),
    ).toMatch(/outside the configured inspection hours/);
  });

  it('warns for non-bookable days', () => {
    // Sat 2026-08-08
    expect(
      getInspectionAvailabilityWarning(chicago('2026-08-08T09:00:00'), availability),
    ).toMatch(/Sat, which isn't a bookable inspection day/);
  });

  it('warns for blackout dates even inside a window', () => {
    // Fri 2026-08-14 is blacked out
    expect(
      getInspectionAvailabilityWarning(chicago('2026-08-14T09:00:00'), availability),
    ).toMatch(/2026-08-14 is a blackout date/);
  });

  it('evaluates against the org timezone, not the browser timezone', () => {
    // 2026-08-04T01:00Z is Mon 8:00 PM in Chicago (out of hours), even though
    // it is Tuesday morning in UTC.
    expect(
      getInspectionAvailabilityWarning(new Date('2026-08-04T01:00:00Z'), availability),
    ).toMatch(/outside the configured inspection hours/);
  });

  it('returns null for invalid dates or timezones instead of blocking the form', () => {
    expect(getInspectionAvailabilityWarning(new Date('nope'), availability)).toBeNull();
    expect(
      getInspectionAvailabilityWarning(chicago('2026-08-03T09:00:00'), {
        ...availability,
        timezone: 'Not/AZone',
      }),
    ).toBeNull();
  });
});
