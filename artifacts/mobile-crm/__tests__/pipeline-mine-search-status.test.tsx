/**
 * Guards the triple intersection of the Pipeline screen's Mine, search, and
 * status filters: all three params must appear in the useListLeads call when
 * all three are active, and clearing any one must remove only that param.
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

const ME_REP = { id: 'rep-1', role: 'admin' as const };

const lead = (
  id: string,
  summary: string,
  status: LeadStatus,
  assignedUserId: string | null,
) => ({
  id,
  contactId: `contact-${id}`,
  status,
  urgency: 'normal' as const,
  score: 0,
  summary,
  hasUnreadPortalMessage: false,
  assignedUserId,
  updatedAt: new Date().toISOString(),
});

// Eight leads covering all combinations of: assigned/unassigned × hail/other × won/new
// lead-a: assigned + "hail" + won  → matches all three filters
// lead-b: assigned + "hail" + new  → matches Mine + search
// lead-c: assigned + other  + won  → matches Mine + status
// lead-d: assigned + other  + new  → matches Mine only
// lead-e: null    + "hail" + won   → matches search + status
// lead-f: null    + "hail" + new   → matches search only
// lead-g: null    + other  + won   → matches status only
// lead-h: null    + other  + new   → matches none
const ALL_LEADS = [
  lead('a', 'Hail damage assessment needed', 'won', ME_REP.id),
  lead('b', 'Hail photo upload pending', 'new', ME_REP.id),
  lead('c', 'Gutter replacement quote', 'won', ME_REP.id),
  lead('d', 'Roof inspection note', 'new', ME_REP.id),
  lead('e', 'Hail damage large storm', 'won', null),
  lead('f', 'Hail small dent', 'new', null),
  lead('g', 'Fascia board repair', 'won', null),
  lead('h', 'Annual maintenance check', 'new', null),
];

/** Return all rendered lead-card testIDs */
const visibleCardIds = () =>
  ALL_LEADS.map((l) => `lead-card-${l.id}`).filter(
    (tid) => screen.queryByTestId(tid) !== null,
  );

beforeEach(() => {
  vi.useFakeTimers();
  // Simulate server-side filtering for all three params simultaneously.
  useListLeads.mockImplementation((params: Record<string, unknown> = {}) => {
    let result = ALL_LEADS;
    if (params.assignedUserId) {
      result = result.filter((l) => l.assignedUserId === params.assignedUserId);
    }
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
  // Admin role → useOwnerFilter defaults to 'all'; Mine must be toggled manually.
  useGetMe.mockReturnValue(queryResult(ME_REP));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ---- helpers --------------------------------------------------------------

/** Type into the pipeline search box and wait for the 300 ms debounce. */
async function typeSearch(value: string) {
  fireEvent.change(screen.getByTestId('pipeline-search'), { target: { value } });
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
}

/** Last params object passed to useListLeads */
const lastParams = () =>
  useListLeads.mock.calls[useListLeads.mock.calls.length - 1][0] as Record<
    string,
    unknown
  >;

// ---- tests ----------------------------------------------------------------

describe('Pipeline Mine + search + status triple-filter', () => {
  it('shows all leads when no filter is active', async () => {
    render(<PipelineScreen />);
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(visibleCardIds()).toEqual([
      'lead-card-a',
      'lead-card-b',
      'lead-card-c',
      'lead-card-d',
      'lead-card-e',
      'lead-card-f',
      'lead-card-g',
      'lead-card-h',
    ]);
  });

  it('sends all three params when Mine + search + status are all active', async () => {
    render(<PipelineScreen />);
    fireEvent.click(screen.getByText('Mine'));
    await typeSearch('hail');
    fireEvent.click(screen.getByText('Won'));

    const p = lastParams();
    expect(p).toHaveProperty('assignedUserId', ME_REP.id);
    expect(p).toHaveProperty('search', 'hail');
    expect(p).toHaveProperty('status', 'won');
  });

  it('shows only the lead matching all three filters when all are active', async () => {
    render(<PipelineScreen />);
    fireEvent.click(screen.getByText('Mine'));
    await typeSearch('hail');
    fireEvent.click(screen.getByText('Won'));

    // Only lead-a: assigned to rep-1, contains "hail", status "won"
    expect(visibleCardIds()).toEqual(['lead-card-a']);
  });

  it('clearing Mine removes assignedUserId but keeps search and status', async () => {
    render(<PipelineScreen />);
    fireEvent.click(screen.getByText('Mine'));
    await typeSearch('hail');
    fireEvent.click(screen.getByText('Won'));
    // All three active → only lead-a
    expect(visibleCardIds()).toEqual(['lead-card-a']);

    // Toggle Mine off → assignedUserId removed, search + status stay
    fireEvent.click(screen.getByText('Mine'));
    expect(visibleCardIds()).toEqual(['lead-card-a', 'lead-card-e']);
    const p = lastParams();
    expect(p).not.toHaveProperty('assignedUserId');
    expect(p).toHaveProperty('search', 'hail');
    expect(p).toHaveProperty('status', 'won');
  });

  it('clearing search removes search param but keeps Mine and status', async () => {
    render(<PipelineScreen />);
    fireEvent.click(screen.getByText('Mine'));
    await typeSearch('hail');
    fireEvent.click(screen.getByText('Won'));
    // All three active → only lead-a
    expect(visibleCardIds()).toEqual(['lead-card-a']);

    // Clear search → search removed, Mine + status stay
    await typeSearch('');
    expect(visibleCardIds()).toEqual(['lead-card-a', 'lead-card-c']);
    const p = lastParams();
    expect(p).toHaveProperty('assignedUserId', ME_REP.id);
    expect(p).not.toHaveProperty('search');
    expect(p).toHaveProperty('status', 'won');
  });

  it('clearing status removes status param but keeps Mine and search', async () => {
    render(<PipelineScreen />);
    fireEvent.click(screen.getByText('Mine'));
    await typeSearch('hail');
    fireEvent.click(screen.getByText('Won'));
    // All three active → only lead-a
    expect(visibleCardIds()).toEqual(['lead-card-a']);

    // Deselect Won → status removed, Mine + search stay
    fireEvent.click(screen.getByText('Won'));
    expect(visibleCardIds()).toEqual(['lead-card-a', 'lead-card-b']);
    const p = lastParams();
    expect(p).toHaveProperty('assignedUserId', ME_REP.id);
    expect(p).toHaveProperty('search', 'hail');
    expect(p).not.toHaveProperty('status');
  });

  it('pressing All chip removes status but keeps Mine and search', async () => {
    render(<PipelineScreen />);
    fireEvent.click(screen.getByText('Mine'));
    await typeSearch('hail');
    fireEvent.click(screen.getByText('Won'));
    // All three active → only lead-a
    expect(visibleCardIds()).toEqual(['lead-card-a']);

    // Press "All" → clears status, Mine + search remain
    fireEvent.click(screen.getByText('All'));
    expect(visibleCardIds()).toEqual(['lead-card-a', 'lead-card-b']);
    const p = lastParams();
    expect(p).toHaveProperty('assignedUserId', ME_REP.id);
    expect(p).toHaveProperty('search', 'hail');
    expect(p).not.toHaveProperty('status');
  });
});
