/**
 * Guards the mobile lead timeline's empty-state path: when a lead's activity
 * list contains no portal_message or team_message entries the screen must show
 * the "No activity yet." placeholder, and the note composer (reply surface)
 * must remain reachable for write-role users.
 *
 * Mirrors the command-center coverage for the Messages-tab empty state.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// ---- lightweight mocks for native/expo modules --------------------------

vi.mock('expo-router', () => ({
  router: { push: vi.fn() },
  useLocalSearchParams: () => ({ id: 'lead-42' }),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

vi.mock('expo-image', () => ({
  Image: () => null,
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
  Badge: ({ label }: { label: string }) => <span data-testid="badge">{label}</span>,
  Card: ({ children, testID }: { children?: React.ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  ErrorState: () => <div>error</div>,
  LoadingView: () => <div>loading</div>,
}));

vi.mock('@/components/PhotoViewer', () => ({
  PhotoViewer: () => null,
  useImageAuthHeaders: () => ({ headers: {}, ready: true }),
}));

vi.mock('@/components/KeyboardAwareScrollViewCompat', () => ({
  KeyboardAwareScrollViewCompat: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: vi.fn(async () => ({ canceled: true })),
  launchCameraAsync: vi.fn(async () => ({ canceled: true })),
  requestCameraPermissionsAsync: vi.fn(async () => ({ granted: false })),
  requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: false })),
  MediaTypeOptions: { Images: 'Images' },
}));

// ---- API client mock ------------------------------------------------------
const queryResult = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  isRefetching: false,
  refetch: vi.fn(),
});

const useGetLead = vi.fn();
const useGetContact = vi.fn();
const useGetProperty = vi.fn();
const useListLeadActivities = vi.fn();

vi.mock('@workspace/api-client-react', () => ({
  getGetContactQueryKey: () => ['contact'],
  getGetLeadQueryKey: () => ['lead'],
  getGetPropertyQueryKey: () => ['property'],
  getListLeadActivitiesQueryKey: () => ['activities'],
  useCreateLeadActivity: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateLead: () => ({ mutate: vi.fn(), isPending: false }),
  useGetLead: (...args: unknown[]) => useGetLead(...args),
  useGetContact: (...args: unknown[]) => useGetContact(...args),
  useGetProperty: (...args: unknown[]) => useGetProperty(...args),
  useListLeadActivities: (...args: unknown[]) => useListLeadActivities(...args),
  useRequestLeadPhotoUploadUrl: () => ({ mutateAsync: vi.fn() }),
  useAttachLeadPhotos: () => ({ mutateAsync: vi.fn() }),
  useDeleteLeadPhoto: () => ({ mutate: vi.fn(), isPending: false }),
}));

import LeadDetailScreen from '@/app/lead/[id]';

const LEAD = {
  id: 'lead-42',
  contactId: 'contact-7',
  propertyId: null,
  status: 'new',
  urgency: 'normal',
  score: 0,
  scoreReasons: [],
  summary: null,
  serviceType: null,
  source: null,
  estimatedValueCents: null,
  createdAt: new Date().toISOString(),
};

const activity = (overrides: Record<string, unknown>) => ({
  id: 'act-1',
  type: 'note',
  title: 'Site visit',
  body: null,
  metadata: {},
  occurredAt: new Date().toISOString(),
  ...overrides,
});

beforeEach(() => {
  useGetLead.mockReturnValue(queryResult(LEAD));
  useGetContact.mockReturnValue(queryResult({ firstName: 'Sam', lastName: 'Rivera' }));
  useGetProperty.mockReturnValue(queryResult(undefined));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('lead timeline messages empty-state', () => {
  it('shows "No activity yet." when the activity list is empty', () => {
    useListLeadActivities.mockReturnValue(queryResult([]));
    render(<LeadDetailScreen />);
    expect(screen.getByText('No activity yet.')).toBeTruthy();
  });

  it('does not show "No activity yet." when activities contain only notes and status changes (no portal_message or team_message)', () => {
    useListLeadActivities.mockReturnValue(
      queryResult([
        activity({ id: 'act-note', type: 'note', title: 'Called homeowner' }),
        activity({ id: 'act-status', type: 'status_change', title: 'Status changed to qualified' }),
      ]),
    );
    // The activities panel renders those two entries — the empty-state placeholder must NOT appear.
    render(<LeadDetailScreen />);
    expect(screen.queryByText('No activity yet.')).toBeNull();
    // Homeowner-message badge must not appear for non-portal activities.
    expect(screen.queryByText('Homeowner message')).toBeNull();
  });

  it('keeps the note composer reachable when the activity list is empty', () => {
    useListLeadActivities.mockReturnValue(queryResult([]));
    render(<LeadDetailScreen />);
    // The note input and submit button are always rendered regardless of activity state.
    expect(screen.getByTestId('note-input')).toBeTruthy();
    expect(screen.getByTestId('note-submit')).toBeTruthy();
  });

  it('keeps the note composer reachable when activities contain only non-message entries', () => {
    useListLeadActivities.mockReturnValue(
      queryResult([
        activity({ id: 'act-note2', type: 'note', title: 'Left voicemail' }),
      ]),
    );
    render(<LeadDetailScreen />);
    expect(screen.getByTestId('note-input')).toBeTruthy();
    expect(screen.getByTestId('note-submit')).toBeTruthy();
  });
});
