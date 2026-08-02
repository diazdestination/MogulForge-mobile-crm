/**
 * Guards the Mine/All ownership filter on the Pipeline and Tasks screens:
 * `assignedUserId` must be sent to /v1/leads and /v1/tasks only when the
 * filter is "Mine" AND the current member's id has loaded.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// ---- lightweight mocks for native/expo modules --------------------------

vi.mock('expo-router', () => ({
  router: { push: vi.fn() },
}));

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

vi.mock('@/components/ui', () => ({
  Badge: () => null,
  Card: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Chip: ({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) => (
    <button type="button" data-active={active ? 'true' : 'false'} onClick={onPress}>
      {label}
    </button>
  ),
  EmptyState: () => <div>empty</div>,
  ErrorState: () => <div>error</div>,
  LoadingView: () => <div>loading</div>,
}));

vi.mock('@/components/CreateModals', () => ({
  AddButton: () => null,
  CreateTaskModal: () => null,
}));

vi.mock('@/hooks/useLeadLabels', () => ({
  useLeadLabels: () => ({ leads: { data: [] }, leadLabel: new Map<string, string>() }),
}));

// ---- API client mock ------------------------------------------------------

const queryResult = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  isRefetching: false,
  refetch: vi.fn(),
});

const useGetMe = vi.fn();
const useListLeads = vi.fn();
const useListContacts = vi.fn();
const useListTasks = vi.fn();
const useListUsers = vi.fn();
const useUpdateTask = vi.fn();

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: (...args: unknown[]) => useGetMe(...args),
  useListLeads: (...args: unknown[]) => useListLeads(...args),
  useListContacts: (...args: unknown[]) => useListContacts(...args),
  useListTasks: (...args: unknown[]) => useListTasks(...args),
  useListUsers: (...args: unknown[]) => useListUsers(...args),
  useUpdateTask: (...args: unknown[]) => useUpdateTask(...args),
}));

import PipelineScreen from '@/app/(tabs)/pipeline';
import TasksScreen from '@/app/(tabs)/tasks';

const ME = { id: 'user-1', role: 'sales_rep' };

beforeEach(() => {
  useListLeads.mockReturnValue(queryResult([]));
  useListContacts.mockReturnValue(queryResult([]));
  useListTasks.mockReturnValue(queryResult([]));
  useListUsers.mockReturnValue(queryResult([]));
  useUpdateTask.mockReturnValue({ mutate: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const lastParams = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls[fn.mock.calls.length - 1][0] as Record<string, unknown>;

describe('Pipeline screen Mine filter', () => {
  it('sends assignedUserId when a field role loads (defaults to Mine)', () => {
    useGetMe.mockReturnValue(queryResult(ME));
    render(<PipelineScreen />);
    expect(lastParams(useListLeads)).toEqual({ assignedUserId: 'user-1' });
  });

  it('omits assignedUserId while me is still loading', () => {
    useGetMe.mockReturnValue({ ...queryResult(undefined), isLoading: true });
    render(<PipelineScreen />);
    expect(lastParams(useListLeads)).not.toHaveProperty('assignedUserId');
  });

  it('omits assignedUserId when the filter is toggled to All', () => {
    useGetMe.mockReturnValue(queryResult(ME));
    render(<PipelineScreen />);
    expect(lastParams(useListLeads)).toHaveProperty('assignedUserId', 'user-1');
    fireEvent.click(screen.getByText('Mine'));
    expect(lastParams(useListLeads)).not.toHaveProperty('assignedUserId');
  });

  it('omits assignedUserId for admins by default', () => {
    useGetMe.mockReturnValue(queryResult({ id: 'admin-1', role: 'admin' }));
    render(<PipelineScreen />);
    expect(lastParams(useListLeads)).not.toHaveProperty('assignedUserId');
  });

  it('never sends assignedUserId with a missing member id even if Mine is active', () => {
    useGetMe.mockReturnValue(queryResult({ id: undefined, role: 'sales_rep' }));
    render(<PipelineScreen />);
    expect(lastParams(useListLeads)).not.toHaveProperty('assignedUserId');
  });
});

describe('Tasks screen Mine filter', () => {
  it('sends assignedUserId when a field role loads (defaults to Mine)', () => {
    useGetMe.mockReturnValue(queryResult({ id: 'user-2', role: 'inspector' }));
    render(<TasksScreen />);
    expect(lastParams(useListTasks)).toEqual({ assignedUserId: 'user-2' });
  });

  it('omits assignedUserId while me is still loading', () => {
    useGetMe.mockReturnValue({ ...queryResult(undefined), isLoading: true });
    render(<TasksScreen />);
    expect(lastParams(useListTasks)).not.toHaveProperty('assignedUserId');
  });

  it('omits assignedUserId when the filter is toggled to All', () => {
    useGetMe.mockReturnValue(queryResult(ME));
    render(<TasksScreen />);
    expect(lastParams(useListTasks)).toHaveProperty('assignedUserId', 'user-1');
    fireEvent.click(screen.getByText('Mine'));
    expect(lastParams(useListTasks)).not.toHaveProperty('assignedUserId');
  });

  it('omits assignedUserId for sales managers by default', () => {
    useGetMe.mockReturnValue(queryResult({ id: 'mgr-1', role: 'sales_manager' }));
    render(<TasksScreen />);
    expect(lastParams(useListTasks)).not.toHaveProperty('assignedUserId');
  });

  it('combines status filter with assignedUserId without dropping either', () => {
    useGetMe.mockReturnValue(queryResult(ME));
    render(<TasksScreen />);
    fireEvent.click(screen.getByText('Open'));
    expect(lastParams(useListTasks)).toEqual({ status: 'open', assignedUserId: 'user-1' });
  });
});
