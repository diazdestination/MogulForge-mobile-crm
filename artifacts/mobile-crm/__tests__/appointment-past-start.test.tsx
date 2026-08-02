/**
 * Guards the "no appointments in the past" behavior of the mobile creation
 * forms: picking a past exact start shows a blocking warning and disables
 * submit, the web datetime input carries a `min` attribute, and the task
 * due-date picker deliberately allows past dates (no min, no warning).
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

const useCreateAppointment = vi.fn();
const useCreateTask = vi.fn();
const useListLeads = vi.fn();
const useGetInspectionAvailability = vi.fn();

vi.mock('@workspace/api-client-react', () => ({
  useListAppointments: () => ({ data: [] }),
  useCreateAppointment: (...args: unknown[]) => useCreateAppointment(...args),
  useCreateTask: (...args: unknown[]) => useCreateTask(...args),
  useListLeads: (...args: unknown[]) => useListLeads(...args),
  useGetInspectionAvailability: (...args: unknown[]) => useGetInspectionAvailability(...args),
}));

import { CreateAppointmentModal, CreateTaskModal } from '@/components/CreateModals';

const createAppointmentMutate = vi.fn();
const createTaskMutate = vi.fn();

beforeEach(() => {
  useCreateAppointment.mockReturnValue({ mutate: createAppointmentMutate, isPending: false });
  useCreateTask.mockReturnValue({ mutate: createTaskMutate, isPending: false });
  useListLeads.mockReturnValue(queryResult([]));
  useGetInspectionAvailability.mockReturnValue(queryResult(undefined));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

describe('CreateAppointmentModal past-start guard', () => {
  it('renders the web start picker with a min attribute', () => {
    render(<CreateAppointmentModal visible onClose={() => {}} />);
    const input = screen.getByTestId('appt-start-picker') as HTMLInputElement;
    expect(input.getAttribute('type')).toBe('datetime-local');
    expect(input.getAttribute('min')).toBeTruthy();
  });

  it('warns, disables submit, and blocks creation for a past start', () => {
    render(<CreateAppointmentModal visible onClose={() => {}} />);
    const input = screen.getByTestId('appt-start-picker');
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    fireEvent.change(input, { target: { value: localInputValue(past) } });

    expect(screen.getByTestId('appt-past-warning')).toBeTruthy();
    fireEvent.click(screen.getByTestId('appt-create-submit'));
    expect(createAppointmentMutate).not.toHaveBeenCalled();
  });

  it('allows creating an appointment with a future start', () => {
    render(<CreateAppointmentModal visible onClose={() => {}} />);
    const input = screen.getByTestId('appt-start-picker');
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    fireEvent.change(input, { target: { value: localInputValue(future) } });

    expect(screen.queryByTestId('appt-past-warning')).toBeNull();
    fireEvent.click(screen.getByTestId('appt-create-submit'));
    expect(createAppointmentMutate).toHaveBeenCalledTimes(1);
  });
});

describe('CreateTaskModal due-date picker stays unrestricted', () => {
  it('has no min attribute and accepts a past due date', () => {
    render(<CreateTaskModal visible onClose={() => {}} />);
    const input = screen.getByTestId('task-due-picker') as HTMLInputElement;
    expect(input.getAttribute('min')).toBeNull();

    fireEvent.change(screen.getByTestId('task-title-input'), {
      target: { value: 'Backfill notes' },
    });
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    fireEvent.change(input, { target: { value: localInputValue(past) } });
    fireEvent.click(screen.getByTestId('task-create-submit'));
    expect(createTaskMutate).toHaveBeenCalledTimes(1);
  });
});
