/**
 * Guards the intersection of the Pipeline screen's search and status filters:
 * both params must appear in the useListLeads call when both filters are
 * active, and clearing one must not disturb the other.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

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

type LeadStatus = 'new' | 'won' | 'lost';

const lead = (id: string, summary: string, status: LeadStatus) => ({
  id,
  contactId: `contact-${id}`,
  status,
  urgency: 'normal' as const,
  score: 0,
  summary,
  hasUnreadPortalMessage: false,
  assignedUserId: null,
  updatedAt: new Date().toISOString(),
});

// Four leads: two matching "hail" search, two with "won" status.
// Lead-a matches both search and status.
const ALL_LEADS = [
  lead('a', 'Hail damage assessment needed', 'won'),  // matches "hail" + status "won"
  lead('b', 'Hail damage photo upload done', 'new'),  // matches "hail", status "new"
  lead('c', 'Gutter replacement quote', 'won'),       // no match "hail", status "won"
  lead('d', 'Roof inspection scheduled', 'new'),      // no match, status "new"
];

const HAIL_LEADS = ALL_LEADS.filter((l) => l.summary.toLowerCase().includes('hail'));
const WON_LEADS = ALL_LEADS.filter((l) => l.status === 'won');
const HAIL_AND_WON = ALL_LEADS.filter(
  (l) => l.summary.toLowerCase().includes('hail') && l.status === 'won',
);

/** Return all rendered lead-card testIDs */
const visibleCardIds = () =>
  ALL_LEADS.map((l) => `lead-card-${l.id}`).filter(
    (tid) => screen.queryByTestId(tid) !== null,
  );

const ME_ADMIN = { id: 'admin-1', role: 'admin' };

beforeEach(() => {
  vi.useFakeTimers();
  // Respond to search and/or status params to simulate server-side filtering.
  useListLeads.mockImplementation((params: Record<string, unknown> = {}) => {
    let result = ALL_LEADS;
    if (params.search) {
      const term = String(params.search).toLowerCase();
      result = result.filter((l) => l.summary.toLowerCase().includes(term));
    }
    if (params.status) {
      result = result.filter((l) => l.status === params.status);
    }
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
  vi.useRealTimers();
});

/** Type into the search box and wait for the 300 ms debounce to fire. */
async function typeSearch(value: string) {
  fireEvent.change(screen.getByTestId('pipeline-search'), {
    target: { value },
  });
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
}

// ---- tests ----------------------------------------------------------------

describe('Pipeline search + status filter intersection', () => {
  it('shows all leads when neither filter is active', () => {
    render(<PipelineScreen />);
    expect(visibleCardIds()).toEqual([
      'lead-card-a',
      'lead-card-b',
      'lead-card-c',
      'lead-card-d',
    ]);
  });

  it('shows only server-matched leads when a search term is entered', async () => {
    render(<PipelineScreen />);
    await typeSearch('hail');
    expect(visibleCardIds()).toEqual(['lead-card-a', 'lead-card-b']);
    expect(screen.queryByTestId('lead-card-c')).toBeNull();
    expect(screen.queryByTestId('lead-card-d')).toBeNull();
  });

  it('shows only server-matched leads when a status chip is selected', async () => {
    render(<PipelineScreen />);
    await act(async () => { vi.advanceTimersByTime(300); });
    fireEvent.click(screen.getByText('Won'));
    expect(visibleCardIds()).toEqual(['lead-card-a', 'lead-card-c']);
    expect(screen.queryByTestId('lead-card-b')).toBeNull();
    expect(screen.queryByTestId('lead-card-d')).toBeNull();
  });

  it('shows only leads matching both search and status when both filters are active', async () => {
    render(<PipelineScreen />);
    await typeSearch('hail');
    fireEvent.click(screen.getByText('Won'));
    // Only lead-a passes both: "hail" text match AND status "won"
    expect(visibleCardIds()).toEqual(['lead-card-a']);
    expect(screen.queryByTestId('lead-card-b')).toBeNull();
    expect(screen.queryByTestId('lead-card-c')).toBeNull();
    expect(screen.queryByTestId('lead-card-d')).toBeNull();
  });

  it('sends both search and status params to useListLeads when both filters are active', async () => {
    render(<PipelineScreen />);
    await typeSearch('hail');
    fireEvent.click(screen.getByText('Won'));
    const lastCall = useListLeads.mock.calls[useListLeads.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(lastCall).toHaveProperty('search', 'hail');
    expect(lastCall).toHaveProperty('status', 'won');
  });

  it('clearing the status chip removes status but keeps search param', async () => {
    render(<PipelineScreen />);
    await typeSearch('hail');
    fireEvent.click(screen.getByText('Won'));
    // Both active → only lead-a
    expect(visibleCardIds()).toEqual(['lead-card-a']);
    // Deselect Won → server returns hail leads (a + b); status gone from params
    fireEvent.click(screen.getByText('Won'));
    expect(visibleCardIds()).toEqual(['lead-card-a', 'lead-card-b']);
    const lastCall = useListLeads.mock.calls[useListLeads.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(lastCall).toHaveProperty('search', 'hail');
    expect(lastCall).not.toHaveProperty('status');
  });

  it('clearing the search input removes search but keeps status param', async () => {
    render(<PipelineScreen />);
    await typeSearch('hail');
    fireEvent.click(screen.getByText('Won'));
    // Both active → only lead-a
    expect(visibleCardIds()).toEqual(['lead-card-a']);
    // Clear search → server returns all won leads (a + c); search gone from params
    await typeSearch('');
    expect(visibleCardIds()).toEqual(['lead-card-a', 'lead-card-c']);
    const lastCall = useListLeads.mock.calls[useListLeads.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(lastCall).toHaveProperty('status', 'won');
    expect(lastCall).not.toHaveProperty('search');
  });

  it('pressing All chip clears status without affecting search', async () => {
    render(<PipelineScreen />);
    await typeSearch('hail');
    fireEvent.click(screen.getByText('Won'));
    // Both active → only lead-a
    expect(visibleCardIds()).toEqual(['lead-card-a']);
    // Press "All" → clears status, search stays
    fireEvent.click(screen.getByText('All'));
    expect(visibleCardIds()).toEqual(['lead-card-a', 'lead-card-b']);
    const lastCall = useListLeads.mock.calls[useListLeads.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(lastCall).toHaveProperty('search', 'hail');
    expect(lastCall).not.toHaveProperty('status');
  });
});
