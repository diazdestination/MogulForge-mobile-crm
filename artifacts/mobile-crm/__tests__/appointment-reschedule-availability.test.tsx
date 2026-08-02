/**
 * Guards the mobile reschedule flow: moving an inspection's start time shows
 * the same non-blocking out-of-hours availability warning as creating one,
 * and non-inspection appointments never show it.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// ---- lightweight mocks for native/expo modules --------------------------

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: () => null,
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// The native picker source is Flow-typed and can't be imported in jsdom.
vi.mock('@react-native-community/datetimepicker', () => ({
  default: () => null,
}));

vi.mock('@/components/ui', () => ({
  Chip: ({ label, onPress }: { label: string; onPress?: () => void }) => (
    <button type="button" onClick={onPress}>
      {label}
    </button>
  ),
}));

// ---- API client mock ------------------------------------------------------

const queryResult = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
});

const useUpdateAppointment = vi.fn();
const useGetInspectionAvailability = vi.fn();

vi.mock('@workspace/api-client-react', () => ({
  useListAppointments: () => ({ data: [] }),
  useCreateAppointment: vi.fn(),
  useCreateTask: vi.fn(),
  useListLeads: () => queryResult([]),
  useUpdateAppointment: (...args: unknown[]) => useUpdateAppointment(...args),
  useGetInspectionAvailability: (...args: unknown[]) => useGetInspectionAvailability(...args),
}));

import { RescheduleAppointmentModal } from '@/components/CreateModals';

const updateMutate = vi.fn();

// Availability that no picked slot can satisfy — every reschedule warns.
const NO_DAYS_AVAILABILITY = {
  days: [],
  windows: [{ startHour: 8, endHour: 11 }],
  timezone: 'America/Chicago',
  blackoutDates: [],
};

const baseAppointment = (over: Record<string, unknown> = {}) => {
  // Capture once so both timestamps share the same base and duration is exactly 2h.
  const now = Date.now();
  return {
    id: 'appt-1',
    type: 'inspection',
    status: 'scheduled',
    scheduledStart: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
    scheduledEnd: new Date(now + 26 * 60 * 60 * 1000).toISOString(),
    leadId: null,
    notes: null,
    ...over,
  };
};

beforeEach(() => {
  useUpdateAppointment.mockReturnValue({ mutate: updateMutate, isPending: false });
  useGetInspectionAvailability.mockReturnValue(queryResult(NO_DAYS_AVAILABILITY));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RescheduleAppointmentModal availability warning', () => {
  it('warns when an inspection is rescheduled outside configured availability', () => {
    render(
      <RescheduleAppointmentModal
        appointment={baseAppointment() as never}
        onClose={vi.fn()}
      />,
    );
    // Pick a slot guaranteed to be in the future (9 AM today may have passed).
    fireEvent.click(screen.getByText('Tomorrow'));
    expect(screen.getByTestId('appt-reschedule-availability-warning')).toBeTruthy();
    // Non-blocking: submit stays enabled and still fires the update.
    const submit = screen.getByTestId('appt-reschedule-submit');
    fireEvent.click(submit);
    expect(updateMutate).toHaveBeenCalledTimes(1);
    const call = updateMutate.mock.calls[0][0];
    expect(call.id).toBe('appt-1');
    expect(typeof call.data.scheduledStart).toBe('string');
    // Duration is preserved: end shifts with start by the original 2 hours.
    const start = new Date(call.data.scheduledStart).getTime();
    const end = new Date(call.data.scheduledEnd).getTime();
    expect(end - start).toBe(2 * 60 * 60 * 1000);
  });

  it('does not warn for non-inspection appointments', () => {
    render(
      <RescheduleAppointmentModal
        appointment={baseAppointment({ type: 'production' }) as never}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('appt-reschedule-availability-warning')).toBeNull();
  });

  it('does not warn when the new time fits availability', () => {
    useGetInspectionAvailability.mockReturnValue(
      queryResult({
        days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        windows: [{ startHour: 0, endHour: 24 }],
        timezone: 'America/Chicago',
        blackoutDates: [],
      }),
    );
    render(
      <RescheduleAppointmentModal
        appointment={baseAppointment() as never}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('appt-reschedule-availability-warning')).toBeNull();
  });
});
