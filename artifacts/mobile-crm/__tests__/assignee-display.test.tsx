/**
 * Guards the assignee display on the Pipeline and Tasks screens: in the
 * "All" view each record shows its assignee's name (via the users hook and
 * memberName), unassigned records show "Unassigned", and the assignee row
 * is hidden entirely in the "Mine" view.
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
  Chip: ({ label, onPress }: { label: string; onPress?: () => void }) => (
    <button type="button" onClick={onPress}>
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

// Mirrors the real useLeadLabels (kept as a mock so tests control the
// contact-join behavior explicitly).
vi.mock('@/hooks/useLeadLabels', async () => {
  const api = await import('@workspace/api-client-react');
  return {
    useLeadLabels: () => {
      const leads = api.useListLeads();
      const contacts = api.useListContacts();
      const names = new Map<string, string>();
      for (const contact of (contacts.data ?? []) as unknown as Array<Record<string, string | null>>) {
        names.set(
          contact.id as string,
          [contact.firstName, contact.lastName].filter(Boolean).join(' '),
        );
      }
      const labels = new Map<string, string>();
      for (const lead of (leads.data ?? []) as unknown as Array<Record<string, string | null>>) {
        const name = names.get(lead.contactId as string);
        labels.set(lead.id as string, name || lead.serviceType || 'Unnamed lead');
      }
      return { leads, leadLabel: labels };
    },
  };
});

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

// Admin defaults to the "All" owner filter.
const ADMIN = { id: 'admin-1', role: 'admin' };

const USERS = [
  { id: 'user-1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' },
  { id: 'user-2', firstName: null, lastName: null, email: 'rep@example.com' },
];

const LEADS = [
  {
    id: 'lead-1',
    contactId: 'contact-1',
    contactName: 'Homer Owner',
    score: 80,
    summary: null,
    status: 'new',
    urgency: 'normal',
    updatedAt: '2026-07-31T00:00:00Z',
    assignedUserId: 'user-1',
  },
  {
    id: 'lead-2',
    contactId: 'contact-1',
    score: 55,
    summary: null,
    status: 'new',
    urgency: 'low',
    updatedAt: '2026-07-31T00:00:00Z',
    assignedUserId: null,
  },
];

const TASKS = [
  {
    id: 'task-1',
    title: 'Call homeowner',
    description: null,
    status: 'open',
    priority: 'normal',
    dueAt: null,
    leadId: null,
    assignedUserId: 'user-2',
  },
  {
    id: 'task-2',
    title: 'Order materials',
    description: null,
    status: 'open',
    priority: 'high',
    dueAt: null,
    leadId: null,
    assignedUserId: null,
  },
];

beforeEach(() => {
  useGetMe.mockReturnValue(queryResult(ADMIN));
  useListLeads.mockReturnValue(queryResult(LEADS));
  useListContacts.mockReturnValue(
    queryResult([{ id: 'contact-1', firstName: 'Homer', lastName: 'Owner' }]),
  );
  useListTasks.mockReturnValue(queryResult(TASKS));
  useListUsers.mockReturnValue(queryResult(USERS));
  useUpdateTask.mockReturnValue({ mutate: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Pipeline screen assignee display', () => {
  it('shows the assignee name for assigned leads in the All view', () => {
    render(<PipelineScreen />);
    expect(screen.getByText('Jane Doe')).toBeTruthy();
  });

  it('shows "Unassigned" for leads without an assignee in the All view', () => {
    render(<PipelineScreen />);
    expect(screen.getByText('Unassigned')).toBeTruthy();
  });

  it('falls back to "Unknown member" when the assignee is not in the users list', () => {
    useListLeads.mockReturnValue(
      queryResult([{ ...LEADS[0], assignedUserId: 'missing-user' }]),
    );
    render(<PipelineScreen />);
    expect(screen.getByText('Unknown member')).toBeTruthy();
  });

  it('hides the assignee row in the Mine view', () => {
    render(<PipelineScreen />);
    fireEvent.click(screen.getByText('Mine'));
    expect(screen.queryByText('Jane Doe')).toBeNull();
    expect(screen.queryByText('Unassigned')).toBeNull();
  });
});

describe('Tasks screen assignee display', () => {
  it('shows the assignee name (email fallback) for assigned tasks in the All view', () => {
    render(<TasksScreen />);
    // user-2 has no first/last name, so memberName falls back to email.
    expect(screen.getByText('rep@example.com')).toBeTruthy();
  });

  it('shows "Unassigned" for tasks without an assignee in the All view', () => {
    render(<TasksScreen />);
    expect(screen.getByText('Unassigned')).toBeTruthy();
  });

  it('hides the assignee row in the Mine view', () => {
    render(<TasksScreen />);
    fireEvent.click(screen.getByText('Mine'));
    expect(screen.queryByText('rep@example.com')).toBeNull();
    expect(screen.queryByText('Unassigned')).toBeNull();
  });
});

describe('Tasks screen linked lead display', () => {
  it('shows the server-resolved lead label on the task card', () => {
    useListTasks.mockReturnValue(
      queryResult([{ ...TASKS[0], leadId: 'lead-1', leadLabel: 'Homer Owner' }]),
    );
    render(<TasksScreen />);
    expect(screen.getByText('Homer Owner')).toBeTruthy();
  });

  it('shows a generic "View lead" label when the server sends no label', () => {
    useListTasks.mockReturnValue(
      queryResult([{ ...TASKS[0], leadId: 'lead-1', leadLabel: null }]),
    );
    render(<TasksScreen />);
    expect(screen.getByText('View lead')).toBeTruthy();
  });

  it('does not download the lead list just to label tasks', () => {
    useListTasks.mockReturnValue(
      queryResult([{ ...TASKS[0], leadId: 'lead-1', leadLabel: 'Homer Owner' }]),
    );
    render(<TasksScreen />);
    expect(useListLeads).not.toHaveBeenCalled();
  });

  it('shows no lead label for tasks without a linked lead', () => {
    render(<TasksScreen />);
    expect(screen.queryByTestId('task-lead-label-task-1')).toBeNull();
    expect(screen.queryByTestId('task-lead-label-task-2')).toBeNull();
  });
});
