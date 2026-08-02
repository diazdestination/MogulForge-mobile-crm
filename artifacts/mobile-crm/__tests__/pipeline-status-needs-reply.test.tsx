/**
 * Guards the intersection of the Pipeline screen's status (server-side) and
 * "Needs reply" (client-side) filters: only leads that pass both filters
 * should be shown when both are active, and clearing one must restore the
 * correct superset without disturbing the other.
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
  Card: ({
    children,
    testID,
  }: {
    children?: React.ReactNode;
    testID?: string;
  }) => <div data-testid={testID}>{children}</div>,
  Chip: ({
    label,
    active,
    onPress,
  }: {
    label: string;
    active?: boolean;
    onPress?: () => void;
  }) => (
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
  dataUpdatedAt: 0,
});

const useGetMe = vi.fn();
const useListLeads = vi.fn();
const useListContacts = vi.fn();
const useListUsers = vi.fn();

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: (...args: unknown[]) => useGetMe(...args),
  useListLeads: (...args: unknown[]) => useListLeads(...args),
  useListContacts: (...args: unknown[]) => useListContacts(...args),
  useListUsers: (...args: unknown[]) => useListUsers(...args),
  listLeads: vi.fn(async () => []),
  listContacts: vi.fn(async () => []),
}));

import PipelineScreen from '@/app/(tabs)/pipeline';

// ---- test data ------------------------------------------------------------

type LeadStatus = 'won' | 'new';

const lead = (
  id: string,
  status: LeadStatus,
  hasUnreadPortalMessage: boolean,
) => ({
  id,
  contactId: `contact-${id}`,
  status,
  urgency: 'normal' as const,
  score: 0,
  summary: `Lead ${id} summary`,
  hasUnreadPortalMessage,
  assignedUserId: null,
  updatedAt: new Date().toISOString(),
});

// Four leads covering all combinations of status × unread:
//   a: status=won,  unread=true  → matches both filters
//   b: status=won,  unread=false → matches status only
//   c: status=new,  unread=true  → matches Needs reply only
//   d: status=new,  unread=false → matches neither filter
const ALL_LEADS = [
  lead('a', 'won', true),
  lead('b', 'won', false),
  lead('c', 'new', true),
  lead('d', 'new', false),
];

const WON_LEADS = ALL_LEADS.filter((l) => l.status === 'won');

/** Return all rendered lead-card testIDs present in the document */
const visibleCardIds = () =>
  ALL_LEADS.map((l) => `lead-card-${l.id}`).filter(
    (tid) => screen.queryByTestId(tid) !== null,
  );

const ME_ADMIN = { id: 'admin-1', role: 'admin' };

beforeEach(() => {
  // Simulate server-side status filtering: return only matching leads when
  // a status param is present, all leads otherwise.
  useListLeads.mockImplementation((params: Record<string, unknown> = {}) => {
    const result = params.status
      ? ALL_LEADS.filter((l) => l.status === params.status)
      : ALL_LEADS;
    return queryResult(result);
  });
  useListContacts.mockReturnValue(queryResult([]));
  useListUsers.mockReturnValue(queryResult([]));
  // Admin so Mine filter is off by default (no assignedUserId noise).
  useGetMe.mockReturnValue(queryResult(ME_ADMIN));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---- tests ----------------------------------------------------------------

describe('Pipeline status + Needs reply filter intersection', () => {
  it('shows all leads when neither filter is active', () => {
    render(<PipelineScreen />);
    expect(visibleCardIds()).toEqual([
      'lead-card-a',
      'lead-card-b',
      'lead-card-c',
      'lead-card-d',
    ]);
  });

  it('shows only server-filtered leads when a status chip is selected', () => {
    render(<PipelineScreen />);
    fireEvent.click(screen.getByText('Won'));
    expect(visibleCardIds()).toEqual(['lead-card-a', 'lead-card-b']);
    expect(screen.queryByTestId('lead-card-c')).toBeNull();
    expect(screen.queryByTestId('lead-card-d')).toBeNull();
  });

  it('shows only unread leads when Needs reply chip is active', () => {
    render(<PipelineScreen />);
    fireEvent.click(screen.getByText('Needs reply'));
    expect(visibleCardIds()).toEqual(['lead-card-a', 'lead-card-c']);
    expect(screen.queryByTestId('lead-card-b')).toBeNull();
    expect(screen.queryByTestId('lead-card-d')).toBeNull();
  });

  it('shows only leads matching both status and Needs reply when both are active', () => {
    render(<PipelineScreen />);
    fireEvent.click(screen.getByText('Won'));
    fireEvent.click(screen.getByText('Needs reply'));
    // Only lead-a passes both: status "won" (server) AND hasUnreadPortalMessage (client)
    expect(visibleCardIds()).toEqual(['lead-card-a']);
    expect(screen.queryByTestId('lead-card-b')).toBeNull();
    expect(screen.queryByTestId('lead-card-c')).toBeNull();
    expect(screen.queryByTestId('lead-card-d')).toBeNull();
  });

  it('passes status param to useListLeads when the status chip is selected', () => {
    render(<PipelineScreen />);
    fireEvent.click(screen.getByText('Won'));
    const lastCall =
      useListLeads.mock.calls[useListLeads.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(lastCall).toHaveProperty('status', 'won');
  });

  it('passes status param to useListLeads even when Needs reply is also active', () => {
    render(<PipelineScreen />);
    fireEvent.click(screen.getByText('Won'));
    fireEvent.click(screen.getByText('Needs reply'));
    const lastCall =
      useListLeads.mock.calls[useListLeads.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(lastCall).toHaveProperty('status', 'won');
  });

  it('clearing status while Needs reply is on restores all unread leads', () => {
    render(<PipelineScreen />);
    fireEvent.click(screen.getByText('Won'));
    fireEvent.click(screen.getByText('Needs reply'));
    // Both active → only lead-a
    expect(visibleCardIds()).toEqual(['lead-card-a']);

    // Deselect Won → server returns all leads; Needs reply still filters client-side
    fireEvent.click(screen.getByText('Won'));
    expect(visibleCardIds()).toEqual(['lead-card-a', 'lead-card-c']);
    expect(screen.queryByTestId('lead-card-b')).toBeNull();
    expect(screen.queryByTestId('lead-card-d')).toBeNull();

    const lastCall =
      useListLeads.mock.calls[useListLeads.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(lastCall).not.toHaveProperty('status');
  });

  it('clearing Needs reply while status is active restores all status-matched leads', () => {
    render(<PipelineScreen />);
    fireEvent.click(screen.getByText('Won'));
    fireEvent.click(screen.getByText('Needs reply'));
    // Both active → only lead-a
    expect(visibleCardIds()).toEqual(['lead-card-a']);

    // Turn off Needs reply → client filter gone; server still returns won leads
    fireEvent.click(screen.getByText('Needs reply'));
    expect(visibleCardIds()).toEqual(['lead-card-a', 'lead-card-b']);
    expect(screen.queryByTestId('lead-card-c')).toBeNull();
    expect(screen.queryByTestId('lead-card-d')).toBeNull();

    const lastCall =
      useListLeads.mock.calls[useListLeads.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(lastCall).toHaveProperty('status', 'won');
  });

  it('pressing All chip clears status without disabling Needs reply', () => {
    render(<PipelineScreen />);
    fireEvent.click(screen.getByText('Won'));
    fireEvent.click(screen.getByText('Needs reply'));
    // Both active → only lead-a
    expect(visibleCardIds()).toEqual(['lead-card-a']);

    // Press "All" → clears status; Needs reply stays active
    fireEvent.click(screen.getByText('All'));
    expect(visibleCardIds()).toEqual(['lead-card-a', 'lead-card-c']);

    const lastCall =
      useListLeads.mock.calls[useListLeads.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(lastCall).not.toHaveProperty('status');
  });

  it('omits status param from useListLeads after the All chip is pressed', () => {
    render(<PipelineScreen />);
    fireEvent.click(screen.getByText('Won'));
    // Status active
    const callAfterWon =
      useListLeads.mock.calls[useListLeads.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(callAfterWon).toHaveProperty('status', 'won');

    fireEvent.click(screen.getByText('All'));
    const callAfterAll =
      useListLeads.mock.calls[useListLeads.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(callAfterAll).not.toHaveProperty('status');
  });
});
