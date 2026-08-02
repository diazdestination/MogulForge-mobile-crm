/**
 * Guards the pipeline search debounce round-trip:
 * typing → 300 ms debounce fires → useListLeads receives the search param →
 * matching lead cards render and non-matching cards disappear.
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

const lead = (id: string, summary: string) => ({
  id,
  contactId: `contact-${id}`,
  status: 'new' as const,
  urgency: 'normal' as const,
  score: 0,
  summary,
  hasUnreadPortalMessage: false,
  assignedUserId: null,
  updatedAt: new Date().toISOString(),
});

// Four leads; only two contain the word "hail" that the server would match.
const ALL_LEADS = [
  lead('a', 'Hail damage assessment needed'),
  lead('b', 'Hail damage photo upload done'),
  lead('c', 'Gutter replacement quote'),
  lead('d', 'Roof inspection scheduled'),
];

// Simulates what the server returns for search='hail'
const HAIL_LEADS = ALL_LEADS.filter((l) => l.summary.toLowerCase().includes('hail'));

// ---- helpers --------------------------------------------------------------

/** IDs of lead cards currently in the DOM */
const visibleCardIds = () =>
  ALL_LEADS.map((l) => `lead-card-${l.id}`).filter(
    (tid) => screen.queryByTestId(tid) !== null,
  );

const ME_ADMIN = { id: 'admin-1', role: 'admin' };

beforeEach(() => {
  vi.useFakeTimers();
  useListLeads.mockImplementation((params: Record<string, unknown> = {}) =>
    queryResult(params.search ? HAIL_LEADS : ALL_LEADS),
  );
  useListContacts.mockReturnValue(queryResult([]));
  useListUsers.mockReturnValue(queryResult([]));
  useGetMe.mockReturnValue(queryResult(ME_ADMIN));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

/** Type into the pipeline search box and wait for the 300 ms debounce. */
async function typeSearch(value: string) {
  fireEvent.change(screen.getByTestId('pipeline-search'), { target: { value } });
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
}

// ---- tests ----------------------------------------------------------------

describe('Pipeline search debounce round-trip', () => {
  it('renders all lead cards before any search term is entered', async () => {
    render(<PipelineScreen />);
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(visibleCardIds()).toEqual([
      'lead-card-a',
      'lead-card-b',
      'lead-card-c',
      'lead-card-d',
    ]);
  });

  it('after typing and waiting 300 ms, only search-matching cards are shown', async () => {
    render(<PipelineScreen />);
    await typeSearch('hail');
    // Server returned HAIL_LEADS (a, b); cards c and d must be gone
    expect(visibleCardIds()).toEqual(['lead-card-a', 'lead-card-b']);
  });

  it('non-matching lead cards disappear after the debounce fires', async () => {
    render(<PipelineScreen />);
    await typeSearch('hail');
    expect(screen.queryByTestId('lead-card-c')).toBeNull();
    expect(screen.queryByTestId('lead-card-d')).toBeNull();
  });

  it('the search param reaches useListLeads only after 300 ms, not before', async () => {
    render(<PipelineScreen />);

    const searchParamsSeen = () =>
      useListLeads.mock.calls
        .map((c) => (c[0] as Record<string, unknown>)?.search)
        .filter(Boolean) as string[];

    // Type rapidly within the debounce window
    fireEvent.change(screen.getByTestId('pipeline-search'), { target: { value: 'h' } });
    await act(async () => { vi.advanceTimersByTime(50); });
    fireEvent.change(screen.getByTestId('pipeline-search'), { target: { value: 'ha' } });
    await act(async () => { vi.advanceTimersByTime(50); });
    fireEvent.change(screen.getByTestId('pipeline-search'), { target: { value: 'hai' } });
    await act(async () => { vi.advanceTimersByTime(50); });
    fireEvent.change(screen.getByTestId('pipeline-search'), { target: { value: 'hail' } });

    // Debounce has not fired yet — no search value should have reached useListLeads
    expect(searchParamsSeen()).toHaveLength(0);

    // Let the debounce fire
    await act(async () => { vi.advanceTimersByTime(300); });

    // Intermediate partial values were never passed to useListLeads
    const seen = searchParamsSeen();
    expect(seen).not.toContain('h');
    expect(seen).not.toContain('ha');
    expect(seen).not.toContain('hai');
    // The final value is the only search param that ever reached the hook
    expect(seen.every((v) => v === 'hail')).toBe(true);
    expect(seen.length).toBeGreaterThanOrEqual(1);
  });

  it('clearing the search restores all lead cards after 300 ms', async () => {
    render(<PipelineScreen />);
    await typeSearch('hail');
    // Only hail leads visible
    expect(visibleCardIds()).toEqual(['lead-card-a', 'lead-card-b']);
    // Clear the search
    await typeSearch('');
    // All leads are back
    expect(visibleCardIds()).toEqual([
      'lead-card-a',
      'lead-card-b',
      'lead-card-c',
      'lead-card-d',
    ]);
  });

  it('omits the search param from useListLeads when the input is cleared', async () => {
    render(<PipelineScreen />);
    await typeSearch('hail');
    await typeSearch('');
    const lastCall = useListLeads.mock.calls[useListLeads.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(lastCall).not.toHaveProperty('search');
  });
});
