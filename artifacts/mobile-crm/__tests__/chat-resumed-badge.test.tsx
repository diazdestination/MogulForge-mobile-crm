/**
 * Guards the mobile lead timeline's "Chat resumed" treatment: activities of
 * type `conversation_resumed` render an emerald badge (matching the Command
 * Center highlight), while other activity types do not.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// ---- lightweight mocks for native/expo modules --------------------------

vi.mock('expo-router', () => ({
  router: { push: vi.fn() },
  useLocalSearchParams: () => ({ id: 'lead-1' }),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
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
  id: 'lead-1',
  contactId: 'contact-1',
  propertyId: null,
  status: 'new',
  urgency: 'normal',
  score: 0,
  scoreReasons: [],
  summary: 'Roof leak',
  serviceType: null,
  source: null,
  estimatedValueCents: null,
  createdAt: new Date().toISOString(),
};

const activity = (overrides: Record<string, unknown>) => ({
  id: 'act-1',
  type: 'note',
  title: 'A note',
  body: null,
  metadata: {},
  occurredAt: new Date().toISOString(),
  ...overrides,
});

beforeEach(() => {
  useGetLead.mockReturnValue(queryResult(LEAD));
  useGetContact.mockReturnValue(queryResult({ firstName: 'Pat', lastName: 'Doe' }));
  useGetProperty.mockReturnValue(queryResult(undefined));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('lead timeline chat-resumed treatment', () => {
  it('shows the Chat resumed badge for conversation_resumed activities', () => {
    useListLeadActivities.mockReturnValue(
      queryResult([
        activity({
          id: 'act-resumed',
          type: 'conversation_resumed',
          title: 'Homeowner resumed the concierge chat',
        }),
      ]),
    );
    render(<LeadDetailScreen />);
    expect(screen.getByText('Chat resumed')).toBeTruthy();
    expect(screen.getByTestId('chat-resumed-activity-act-resumed')).toBeTruthy();
  });

  it('does not show the badge for other activity types', () => {
    useListLeadActivities.mockReturnValue(
      queryResult([activity({ id: 'act-note', type: 'note', title: 'Called homeowner' })]),
    );
    render(<LeadDetailScreen />);
    expect(screen.queryByText('Chat resumed')).toBeNull();
  });
});
