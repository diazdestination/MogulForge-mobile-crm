/**
 * Guards that portal_message and conversation_resumed badges coexist correctly
 * in a mixed activity timeline. Both badge types must appear exactly once on
 * their respective cards, and plain-note cards must show no badge.
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

const MIXED_ACTIVITIES = [
  activity({
    id: 'act-portal',
    type: 'portal_message',
    title: 'Message from homeowner',
    body: 'When can you come by?',
  }),
  activity({
    id: 'act-resumed',
    type: 'conversation_resumed',
    title: 'Homeowner resumed the concierge chat',
  }),
  activity({
    id: 'act-note',
    type: 'note',
    title: 'Called homeowner',
  }),
];

beforeEach(() => {
  useGetLead.mockReturnValue(queryResult(LEAD));
  useGetContact.mockReturnValue(queryResult({ firstName: 'Pat', lastName: 'Doe' }));
  useGetProperty.mockReturnValue(queryResult(undefined));
  useListLeadActivities.mockReturnValue(queryResult(MIXED_ACTIVITIES));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('lead timeline mixed activity badges', () => {
  it('renders the amber Homeowner message badge exactly once on the portal_message card', () => {
    render(<LeadDetailScreen />);

    const homeownerBadges = screen.getAllByText('Homeowner message');
    expect(homeownerBadges).toHaveLength(1);

    // Badge lives inside the portal_message card
    const portalCard = screen.getByTestId('portal-message-activity-act-portal');
    expect(portalCard.textContent).toContain('Homeowner message');
  });

  it('renders the emerald Chat resumed badge exactly once on the conversation_resumed card', () => {
    render(<LeadDetailScreen />);

    const resumedBadges = screen.getAllByText('Chat resumed');
    expect(resumedBadges).toHaveLength(1);

    // Badge lives inside the conversation_resumed card
    const resumedCard = screen.getByTestId('chat-resumed-activity-act-resumed');
    expect(resumedCard.textContent).toContain('Chat resumed');
  });

  it('renders no special badge on the plain-note card', () => {
    render(<LeadDetailScreen />);

    // The plain note card has no testID (neither chat-resumed nor portal-message)
    expect(screen.queryByTestId('chat-resumed-activity-act-note')).toBeNull();
    expect(screen.queryByTestId('portal-message-activity-act-note')).toBeNull();

    // Confirm the note card itself is present by its title text
    expect(screen.getByText('Called homeowner')).toBeTruthy();

    // The note card must not contain either badge label
    const allBadges = screen.queryAllByTestId('badge');
    // Filter to only the ones that are badge spans containing the special labels
    const specialBadgeLabels = allBadges
      .map((el) => el.textContent)
      .filter((t) => t === 'Homeowner message' || t === 'Chat resumed');
    // There should be exactly two special badges total (one each), not three
    expect(specialBadgeLabels).toHaveLength(2);
  });
});
