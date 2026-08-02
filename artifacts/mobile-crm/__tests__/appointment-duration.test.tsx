/**
 * Guards the appointment duration controls in the mobile create modal:
 * preset chips remain shortcuts, a custom minute entry produces a matching
 * scheduledEnd, and an exact end time before the start blocks submission
 * with a validation message.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

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

vi.mock('@react-native-community/datetimepicker', () => ({
  default: () => null,
}));

vi.mock('@/components/ui', () => ({
  Chip: ({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) => (
    <button data-testid={`chip-${label}`} data-active={active ? 'true' : 'false'} onClick={onPress}>
      {label}
    </button>
  ),
}));

const mutate = vi.fn();

vi.mock('@workspace/api-client-react', () => ({
  useListAppointments: () => ({ data: [] }),
  useCreateAppointment: () => ({ mutate, isPending: false }),
  useCreateTask: () => ({ mutate: vi.fn(), isPending: false }),
  useListLeads: () => ({ data: [], isLoading: false, isFetching: false }),
  useGetInspectionAvailability: () => ({ data: undefined }),
}));

import { CreateAppointmentModal } from '@/components/CreateModals';

afterEach(() => {
  cleanup();
  mutate.mockClear();
});

function expectedStart(): Date {
  // Tomorrow at 9 AM: always in the future, so the past-start guard
  // (which blocks submits for past starts) never interferes here.
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

function toLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function setup() {
  render(<CreateAppointmentModal visible onClose={() => {}} />);
  fireEvent.change(screen.getByTestId('appt-start-picker'), {
    target: { value: toLocal(expectedStart()) },
  });
}

describe('appointment duration controls', () => {
  it('preset chip still produces an hour-based end time', () => {
    setup();
    fireEvent.click(screen.getByTestId('chip-2 hrs'));
    fireEvent.click(screen.getByTestId('appt-create-submit'));
    expect(mutate).toHaveBeenCalledTimes(1);
    const data = mutate.mock.calls[0][0].data;
    const start = expectedStart();
    expect(data.scheduledStart).toBe(start.toISOString());
    expect(data.scheduledEnd).toBe(new Date(start.getTime() + 2 * 3600_000).toISOString());
  });

  it('custom minutes entry produces a matching end time', () => {
    setup();
    fireEvent.change(screen.getByTestId('appt-custom-duration-input'), {
      target: { value: '90' },
    });
    fireEvent.click(screen.getByTestId('appt-create-submit'));
    expect(mutate).toHaveBeenCalledTimes(1);
    const data = mutate.mock.calls[0][0].data;
    const start = expectedStart();
    expect(data.scheduledEnd).toBe(new Date(start.getTime() + 90 * 60_000).toISOString());
  });

  it('rejects a non-numeric custom duration', () => {
    setup();
    fireEvent.change(screen.getByTestId('appt-custom-duration-input'), {
      target: { value: 'abc' },
    });
    expect(screen.getByTestId('appt-duration-error').textContent).toMatch(/whole number/i);
    fireEvent.click(screen.getByTestId('appt-create-submit'));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('uses an exact end time when picked', () => {
    setup();
    const start = expectedStart();
    const end = new Date(start.getTime() + 75 * 60_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const local = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`;
    fireEvent.change(screen.getByTestId('appt-end-picker'), { target: { value: local } });
    fireEvent.click(screen.getByTestId('appt-create-submit'));
    expect(mutate).toHaveBeenCalledTimes(1);
    const data = mutate.mock.calls[0][0].data;
    expect(data.scheduledEnd).toBe(end.toISOString());
  });

  it('blocks an end time at or before the start', () => {
    setup();
    const start = expectedStart();
    const before = new Date(start.getTime() - 60 * 60_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const local = `${before.getFullYear()}-${pad(before.getMonth() + 1)}-${pad(before.getDate())}T${pad(before.getHours())}:${pad(before.getMinutes())}`;
    fireEvent.change(screen.getByTestId('appt-end-picker'), { target: { value: local } });
    expect(screen.getByTestId('appt-duration-error').textContent).toMatch(/after the start/i);
    fireEvent.click(screen.getByTestId('appt-create-submit'));
    expect(mutate).not.toHaveBeenCalled();
  });
});
