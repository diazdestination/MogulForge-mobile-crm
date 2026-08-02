/**
 * Guards the intersection of the Pipeline screen's search and "Needs reply"
 * filters: leads must pass BOTH the server-side search subset AND the
 * client-side hasUnreadPortalMessage check when both filters are active.
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

const lead = (
  id: string,
  summary: string,
  hasUnreadPortalMessage: boolean,
) => ({
  id,
  contactId: `contact-${id}`,
  status: 'new' as const,
  urgency: 'normal' as const,
  score: 0,
  summary,
  hasUnreadPortalMessage,
  assignedUserId: null,
  updatedAt: new Date().toISOString(),
});

// All leads: mixed summaries and mixed unread flags
const ALL_LEADS = [
  lead('a', 'Hail damage assessment needed', true),   // matches "hail", unread
  lead('b', 'Hail damage photo upload done', false),  // matches "hail", read
  lead('c', 'Gutter replacement quote', true),        // no match "hail", unread
  lead('d', 'Roof inspection scheduled', false),      // no match, read
];

// Server returns only hail leads when search='hail'
const HAIL_LEADS = ALL_LEADS.filter((l) => l.summary.toLowerCase().includes('hail'));

// ---- helpers --------------------------------------------------------------

/** Return all rendered lead-card testIDs */
const visibleCardIds = () =>
  ALL_LEADS.map((l) => `lead-card-${l.id}`).filter(
    (tid) => screen.queryByTestId(tid) !== null,
  );

const ME_ADMIN = { id: 'admin-1', role: 'admin' };

beforeEach(() => {
  vi.useFakeTimers();
  // Default: no search → all leads
  useListLeads.mockImplementation((params: Record<string, unknown> = {}) =>
    queryResult(params.search ? HAIL_LEADS : ALL_LEADS),
  );
  useListContacts.mockReturnValue(queryResult([]));
  useListUsers.mockReturnValue(queryResult([]));
  // Use admin so Mine filter is off by default (no assignedUserId noise)
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

describe('Pipeline search + Needs reply filter intersection', () => {
  it('shows all leads when neither filter is active', async () => {
    render(<PipelineScreen />);
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(visibleCardIds()).toEqual([
      'lead-card-a',
      'lead-card-b',
      'lead-card-c',
      'lead-card-d',
    ]);
  });

  it('shows only the server-returned subset when a search term is typed', async () => {
    render(<PipelineScreen />);
    await typeSearch('hail');
    // Server returned HAIL_LEADS (a, b); c and d are gone
    expect(visibleCardIds()).toEqual(['lead-card-a', 'lead-card-b']);
    expect(screen.queryByTestId('lead-card-c')).toBeNull();
    expect(screen.queryByTestId('lead-card-d')).toBeNull();
  });

  it('shows only leads matching both search and Needs reply when both are active', async () => {
    render(<PipelineScreen />);
    // Type search → server returns hail leads (a=unread, b=read)
    await typeSearch('hail');
    // Enable Needs reply → client filters to unread only
    fireEvent.click(screen.getByText('Needs reply'));
    // Only lead-a passes both: hail match AND unread
    expect(visibleCardIds()).toEqual(['lead-card-a']);
    expect(screen.queryByTestId('lead-card-b')).toBeNull();
    expect(screen.queryByTestId('lead-card-c')).toBeNull();
  });

  it('clearing search while Needs reply is on restores all unread leads', async () => {
    render(<PipelineScreen />);
    await typeSearch('hail');
    fireEvent.click(screen.getByText('Needs reply'));
    // Both active → only lead-a
    expect(visibleCardIds()).toEqual(['lead-card-a']);
    // Clear search → server returns ALL_LEADS; Needs reply still on
    await typeSearch('');
    // Unread leads are a and c
    expect(visibleCardIds()).toEqual(['lead-card-a', 'lead-card-c']);
    expect(screen.queryByTestId('lead-card-b')).toBeNull();
    expect(screen.queryByTestId('lead-card-d')).toBeNull();
  });

  it('clearing Needs reply while search is active restores all search matches', async () => {
    render(<PipelineScreen />);
    await typeSearch('hail');
    fireEvent.click(screen.getByText('Needs reply'));
    // Both active → only lead-a
    expect(visibleCardIds()).toEqual(['lead-card-a']);
    // Turn off Needs reply → all hail leads come back
    fireEvent.click(screen.getByText('Needs reply'));
    expect(visibleCardIds()).toEqual(['lead-card-a', 'lead-card-b']);
    expect(screen.queryByTestId('lead-card-c')).toBeNull();
  });

  it('passes the search param to useListLeads when text is entered', async () => {
    render(<PipelineScreen />);
    await typeSearch('hail');
    const lastCall = useListLeads.mock.calls[useListLeads.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(lastCall).toHaveProperty('search', 'hail');
  });

  it('omits the search param from useListLeads when the input is cleared', async () => {
    render(<PipelineScreen />);
    await typeSearch('hail');
    await typeSearch('');
    const lastCall = useListLeads.mock.calls[useListLeads.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(lastCall).not.toHaveProperty('search');
  });

  it('debounce: intermediate keystrokes never reach useListLeads, only the final value does', async () => {
    render(<PipelineScreen />);

    const searchValues = () =>
      useListLeads.mock.calls
        .map((c) => (c[0] as Record<string, unknown>)?.search)
        .filter(Boolean) as string[];

    // Simulate rapid typing — one character at a time, well within the 300 ms window
    fireEvent.change(screen.getByTestId('pipeline-search'), { target: { value: 'h' } });
    await act(async () => { vi.advanceTimersByTime(50); });
    fireEvent.change(screen.getByTestId('pipeline-search'), { target: { value: 'ha' } });
    await act(async () => { vi.advanceTimersByTime(50); });
    fireEvent.change(screen.getByTestId('pipeline-search'), { target: { value: 'hai' } });
    await act(async () => { vi.advanceTimersByTime(50); });
    fireEvent.change(screen.getByTestId('pipeline-search'), { target: { value: 'hail' } });

    // Debounce has not fired yet — no search value should have reached useListLeads
    expect(searchValues()).toHaveLength(0);

    // Let the debounce fire
    await act(async () => { vi.advanceTimersByTime(300); });

    // None of the intermediate partial words were ever passed as search params
    const values = searchValues();
    expect(values).not.toContain('h');
    expect(values).not.toContain('ha');
    expect(values).not.toContain('hai');
    // The final value is the only one that ever reached useListLeads
    expect(values.every((v) => v === 'hail')).toBe(true);
    expect(values.length).toBeGreaterThanOrEqual(1);
  });
});
