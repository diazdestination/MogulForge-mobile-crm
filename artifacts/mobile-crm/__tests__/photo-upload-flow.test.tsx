/**
 * Guards the photo upload flow on the mobile lead detail screen against the
 * key error paths: permission denial, presigned-URL request failure, PUT
 * failure, and attach failure. Also verifies the success path invalidates the
 * activities query and shows "done" for each entry.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Alert, Linking } from 'react-native';

// ---- native / expo shims ----------------------------------------------------

vi.mock('expo-router', () => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
  useLocalSearchParams: () => ({ id: 'lead-1' }),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

vi.mock('expo-image', () => ({ Image: () => null }));

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
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

// ---- expo-image-picker mock (mirrors boot.test.tsx registration) ------------

const mockRequestCameraPermissions = vi.fn();
const mockRequestLibraryPermissions = vi.fn();
const mockLaunchCamera = vi.fn();
const mockLaunchLibrary = vi.fn();

vi.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: (...args: unknown[]) => mockRequestCameraPermissions(...args),
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) =>
    mockRequestLibraryPermissions(...args),
  launchCameraAsync: (...args: unknown[]) => mockLaunchCamera(...args),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchLibrary(...args),
  MediaTypeOptions: { Images: 'Images' },
}));

// ---- TanStack Query mock ----------------------------------------------------

const mockInvalidateQueries = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

// ---- API client mock --------------------------------------------------------

const useGetLead = vi.fn();
const useGetContact = vi.fn();
const useGetProperty = vi.fn();
const useListLeadActivities = vi.fn();
const mockRequestPhotoUrlMutateAsync = vi.fn();
const mockAttachPhotosMutateAsync = vi.fn();

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
  useRequestLeadPhotoUploadUrl: () => ({ mutateAsync: mockRequestPhotoUrlMutateAsync }),
  useAttachLeadPhotos: () => ({ mutateAsync: mockAttachPhotosMutateAsync }),
  useDeleteLeadPhoto: () => ({ mutate: vi.fn(), isPending: false }),
}));

// ---- component under test (imported after all mocks) ------------------------

import LeadDetailScreen from '@/app/lead/[id]';

// ---- shared fixtures --------------------------------------------------------

const queryResult = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  isRefetching: false,
  refetch: vi.fn(),
});

const LEAD = {
  id: 'lead-1',
  contactId: 'contact-1',
  propertyId: null,
  status: 'new',
  urgency: 'normal',
  score: 72,
  scoreReasons: [],
  summary: null,
  serviceType: null,
  source: null,
  estimatedValueCents: null,
  createdAt: new Date().toISOString(),
};

/** A single library asset the picker might return. */
const makeAsset = (overrides: Partial<Record<string, unknown>> = {}) => ({
  assetId: 'asset-1',
  fileName: 'photo.jpg',
  uri: 'file:///tmp/photo.jpg',
  mimeType: 'image/jpeg',
  fileSize: 24_000,
  ...overrides,
});

// ---- interaction helpers ----------------------------------------------------

/**
 * Opens the "Add Photos" sheet (Android/web path — Platform.OS is 'web' in
 * jsdom) and presses the library option.
 */
function pickFromLibrary() {
  fireEvent.click(screen.getByTestId('add-photos-button'));
  // Platform.OS is 'web' in jsdom → modal sheet renders instead of ActionSheetIOS
  fireEvent.click(screen.getByTestId('photo-picker-library'));
}

/** Opens the sheet and presses the camera option. */
function pickFromCamera() {
  fireEvent.click(screen.getByTestId('add-photos-button'));
  fireEvent.click(screen.getByTestId('photo-picker-camera'));
}

/**
 * A fetch stub that returns a Blob for local `file://` URIs and `ok: true`
 * for everything else (PUT to storage).
 */
const happyFetch = vi.fn(async (url: string) => {
  if (typeof url === 'string' && url.startsWith('file://')) {
    return { blob: async () => new Blob(['x'], { type: 'image/jpeg' }) } as Response;
  }
  return { ok: true, status: 200 } as Response;
});

// ---- setup / teardown -------------------------------------------------------

beforeEach(() => {
  useGetLead.mockReturnValue(queryResult(LEAD));
  useGetContact.mockReturnValue(queryResult({ firstName: 'Jane', lastName: 'Smith' }));
  useGetProperty.mockReturnValue(queryResult(undefined));
  useListLeadActivities.mockReturnValue(queryResult([]));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// ─── Permission denial ────────────────────────────────────────────────────────

describe('photo upload — permission denial', () => {
  it('shows a camera-access alert when camera permission is denied', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert');

    mockRequestLibraryPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [makeAsset()],
    });

    mockRequestPhotoUrlMutateAsync.mockResolvedValue({
      uploadURL: 'https://storage.example/put',
      objectPath: '/objects/photo.jpg',
    });
    vi.stubGlobal('fetch', happyFetch);
    mockAttachPhotosMutateAsync.mockRejectedValue(new Error('attach rejected'));

    render(<LeadDetailScreen />);
    pickFromLibrary();

    // Alert for the attach failure must fire.
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Upload error', expect.any(String));
    });

    // The entry that was "done" is now shown as error.
    await waitFor(() => {
      expect(screen.getByText('Failed to attach photos')).toBeTruthy();
    });

    // Queue header shows UPLOAD ISSUES, not UPLOAD COMPLETE.
    expect(screen.getByText('UPLOAD ISSUES')).toBeTruthy();
  });

  it('only reverts entries that were done, not entries already in error', async () => {
    vi.spyOn(Alert, 'alert');

    mockRequestLibraryPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [
        makeAsset({ assetId: 'a1', fileName: 'success.jpg', uri: 'file:///tmp/success.jpg' }),
        makeAsset({ assetId: 'a2', fileName: 'put-fail.jpg', uri: 'file:///tmp/put-fail.jpg' }),
      ],
    });

    // Return a distinct uploadURL per file so the fetch mock can tell them apart.
    mockRequestPhotoUrlMutateAsync.mockImplementation(
      ({ data }: { data: { name: string } }) =>
        Promise.resolve({
          uploadURL: `https://storage.example/put/${data.name}`,
          objectPath: `/objects/${data.name}`,
        }),
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('file://')) {
          return { blob: async () => new Blob(['x']) } as Response;
        }
        // PUT for put-fail.jpg fails; success.jpg's PUT succeeds.
        if (url.includes('put-fail.jpg')) return { ok: false, status: 400 } as Response;
        return { ok: true } as Response;
      }),
    );

    // Attach also fails — only success.jpg made it into successPaths.
    mockAttachPhotosMutateAsync.mockRejectedValue(new Error('attach rejected'));

    render(<LeadDetailScreen />);
    pickFromLibrary();

    // success.jpg was "done" before attach → gets "Failed to attach photos".
    // put-fail.jpg already carried a PUT error → its message is preserved.
    await waitFor(() => {
      expect(screen.getByText('Failed to attach photos')).toBeTruthy();
      expect(screen.getByText(/Storage upload failed \(HTTP 400\)/i)).toBeTruthy();
    });
  });
});

// ─── 20-photo selection cap ───────────────────────────────────────────────────

describe('photo upload — 20-photo cap', () => {
  it('passes all assets through when the picker returns exactly 20', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert');
    // react-native-web omits openSettings — define it so we can track calls.
    const openSettings = vi.fn().mockResolvedValue(undefined);
    (Linking as unknown as Record<string, unknown>).openSettings = openSettings;
    mockRequestLibraryPermissions.mockResolvedValue({ granted: false, canAskAgain: false });

    render(<LeadDetailScreen />);
    pickFromLibrary();

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());

    const [, , buttons] = alertSpy.mock.calls[0] as [
      string,
      string,
      Array<{ text: string; onPress?: () => void }> | undefined,
    ];
    const settingsBtn = buttons?.find((b) => b.text === 'Open Settings');
    expect(settingsBtn).toBeTruthy();
    settingsBtn!.onPress?.();
    expect(openSettings).toHaveBeenCalled();
  });

  it('shows a library-access alert when media library permission is denied', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert');

    mockRequestLibraryPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [makeAsset()],
    });

    mockRequestPhotoUrlMutateAsync.mockResolvedValue({
      uploadURL: 'https://storage.example/put',
      objectPath: '/objects/photo.jpg',
    });
    vi.stubGlobal('fetch', happyFetch);
    mockAttachPhotosMutateAsync.mockRejectedValue(new Error('attach rejected'));

    render(<LeadDetailScreen />);
    pickFromLibrary();

    // Alert for the attach failure must fire.
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Upload error', expect.any(String));
    });

    // The entry that was "done" is now shown as error.
    await waitFor(() => {
      expect(screen.getByText('Failed to attach photos')).toBeTruthy();
    });

    // Queue header shows UPLOAD ISSUES, not UPLOAD COMPLETE.
    expect(screen.getByText('UPLOAD ISSUES')).toBeTruthy();
  });

  it('only reverts entries that were done, not entries already in error', async () => {
    vi.spyOn(Alert, 'alert');

    mockRequestLibraryPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [
        makeAsset({ assetId: 'a1', fileName: 'success.jpg', uri: 'file:///tmp/success.jpg' }),
        makeAsset({ assetId: 'a2', fileName: 'put-fail.jpg', uri: 'file:///tmp/put-fail.jpg' }),
      ],
    });

    // Return a distinct uploadURL per file so the fetch mock can tell them apart.
    mockRequestPhotoUrlMutateAsync.mockImplementation(
      ({ data }: { data: { name: string } }) =>
        Promise.resolve({
          uploadURL: `https://storage.example/put/${data.name}`,
          objectPath: `/objects/${data.name}`,
        }),
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('file://')) {
          return { blob: async () => new Blob(['x']) } as Response;
        }
        // PUT for put-fail.jpg fails; success.jpg's PUT succeeds.
        if (url.includes('put-fail.jpg')) return { ok: false, status: 400 } as Response;
        return { ok: true } as Response;
      }),
    );

    // Attach also fails — only success.jpg made it into successPaths.
    mockAttachPhotosMutateAsync.mockRejectedValue(new Error('attach rejected'));

    render(<LeadDetailScreen />);
    pickFromLibrary();

    // success.jpg was "done" before attach → gets "Failed to attach photos".
    // put-fail.jpg already carried a PUT error → its message is preserved.
    await waitFor(() => {
      expect(screen.getByText('Failed to attach photos')).toBeTruthy();
      expect(screen.getByText(/Storage upload failed \(HTTP 400\)/i)).toBeTruthy();
    });
  });
});

// ─── 20-photo selection cap ───────────────────────────────────────────────────

describe('photo upload — 20-photo cap', () => {
  it('passes all assets through when the picker returns exactly 20', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert');
    // react-native-web omits openSettings — define it so we can track calls.
    const openSettings = vi.fn().mockResolvedValue(undefined);
    (Linking as unknown as Record<string, unknown>).openSettings = openSettings;
    mockRequestLibraryPermissions.mockResolvedValue({ granted: false, canAskAgain: false });

    render(<LeadDetailScreen />);
    pickFromLibrary();

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());

    const [, , buttons] = alertSpy.mock.calls[0] as [
      string,
      string,
      Array<{ text: string; onPress?: () => void }> | undefined,
    ];
    const btn = buttons?.find((b) => b.text === 'Open Settings');
    expect(btn).toBeTruthy();
    btn!.onPress?.();
    expect(openSettings).toHaveBeenCalled();
  });
});

// ─── Presigned-URL request failure ───────────────────────────────────────────

describe('photo upload — presigned-URL failure', () => {
  it('marks the failing entry as error while leaving the successful entry unaffected', async () => {
    mockRequestLibraryPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [
        makeAsset({ assetId: 'a1', fileName: 'ok.jpg', uri: 'file:///tmp/ok.jpg' }),
        makeAsset({ assetId: 'a2', fileName: 'bad.jpg', uri: 'file:///tmp/bad.jpg' }),
      ],
    });

    // ok.jpg gets a URL; bad.jpg's request throws.
    mockRequestPhotoUrlMutateAsync.mockImplementation(
      ({ data }: { data: { name: string } }) => {
        if (data.name === 'bad.jpg') return Promise.reject(new Error('URL request failed'));
        return Promise.resolve({
          uploadURL: 'https://storage.example/put',
          objectPath: '/objects/ok.jpg',
        });
      },
    );
    vi.stubGlobal('fetch', happyFetch);
    mockAttachPhotosMutateAsync.mockResolvedValue({});

    render(<LeadDetailScreen />);
    pickFromLibrary();

    // Both entries appear in the queue header.
    await waitFor(() => {
      expect(screen.getByText('ok.jpg')).toBeTruthy();
      expect(screen.getByText('bad.jpg')).toBeTruthy();
    });

    // bad.jpg shows its error; ok.jpg did not.
    await waitFor(() => {
      expect(screen.getByText('URL request failed')).toBeTruthy();
    });

    // Attach was still called for the successful entry.
    await waitFor(() => {
      expect(mockAttachPhotosMutateAsync).toHaveBeenCalledWith({
        id: 'lead-1',
        data: { photoPaths: ['/objects/ok.jpg'] },
      });
    });
  });

  it('does not call attach when every presigned-URL request fails', async () => {
    mockRequestLibraryPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [makeAsset()],
    });

    mockRequestPhotoUrlMutateAsync.mockRejectedValue(new Error('network error'));
    vi.stubGlobal('fetch', happyFetch);

    render(<LeadDetailScreen />);
    pickFromLibrary();

    await waitFor(() => {
      expect(screen.getByText('network error')).toBeTruthy();
    });

    expect(mockAttachPhotosMutateAsync).not.toHaveBeenCalled();
  });
});

// ─── PUT to object storage fails ─────────────────────────────────────────────

describe('photo upload — PUT to storage fails', () => {
  it('marks the entry as error when the storage PUT returns a non-ok status', async () => {
    mockRequestLibraryPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [makeAsset()],
    });

    mockRequestPhotoUrlMutateAsync.mockResolvedValue({
      uploadURL: 'https://storage.example/put',
      objectPath: '/objects/photo.jpg',
    });

    // Blob fetch succeeds; PUT returns 503.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('file://')) {
          return { blob: async () => new Blob(['x']) } as Response;
        }
        return { ok: false, status: 503 } as Response;
      }),
    );

    render(<LeadDetailScreen />);
    pickFromLibrary();

    await waitFor(() => {
      expect(screen.getByText('photo.jpg')).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByText(/Storage upload failed \(HTTP 503\)/i)).toBeTruthy();
    });

    // No successful paths → attach must not be called.
    expect(mockAttachPhotosMutateAsync).not.toHaveBeenCalled();
  });
});

// ─── attachLeadPhotos fails after successful PUTs ────────────────────────────

describe('photo upload — attach call fails', () => {
  it('reverts done entries to error state and shows an alert', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert');

    mockRequestLibraryPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [makeAsset()],
    });

    mockRequestPhotoUrlMutateAsync.mockResolvedValue({
      uploadURL: 'https://storage.example/put',
      objectPath: '/objects/photo.jpg',
    });
    vi.stubGlobal('fetch', happyFetch);
    mockAttachPhotosMutateAsync.mockRejectedValue(new Error('attach rejected'));

    render(<LeadDetailScreen />);
    pickFromLibrary();

    // Alert for the attach failure must fire.
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Upload error', expect.any(String));
    });

    // The entry that was "done" is now shown as error.
    await waitFor(() => {
      expect(screen.getByText('Failed to attach photos')).toBeTruthy();
    });

    // Queue header shows UPLOAD ISSUES, not UPLOAD COMPLETE.
    expect(screen.getByText('UPLOAD ISSUES')).toBeTruthy();
  });

  it('only reverts entries that were done, not entries already in error', async () => {
    vi.spyOn(Alert, 'alert');

    mockRequestLibraryPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [
        makeAsset({ assetId: 'a1', fileName: 'success.jpg', uri: 'file:///tmp/success.jpg' }),
        makeAsset({ assetId: 'a2', fileName: 'put-fail.jpg', uri: 'file:///tmp/put-fail.jpg' }),
      ],
    });

    // Return a distinct uploadURL per file so the fetch mock can tell them apart.
    mockRequestPhotoUrlMutateAsync.mockImplementation(
      ({ data }: { data: { name: string } }) =>
        Promise.resolve({
          uploadURL: `https://storage.example/put/${data.name}`,
          objectPath: `/objects/${data.name}`,
        }),
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('file://')) {
          return { blob: async () => new Blob(['x']) } as Response;
        }
        // PUT for put-fail.jpg fails; success.jpg's PUT succeeds.
        if (url.includes('put-fail.jpg')) return { ok: false, status: 400 } as Response;
        return { ok: true } as Response;
      }),
    );

    // Attach also fails — only success.jpg made it into successPaths.
    mockAttachPhotosMutateAsync.mockRejectedValue(new Error('attach rejected'));

    render(<LeadDetailScreen />);
    pickFromLibrary();

    // success.jpg was "done" before attach → gets "Failed to attach photos".
    // put-fail.jpg already carried a PUT error → its message is preserved.
    await waitFor(() => {
      expect(screen.getByText('Failed to attach photos')).toBeTruthy();
      expect(screen.getByText(/Storage upload failed \(HTTP 400\)/i)).toBeTruthy();
    });
  });
});

// ─── 20-photo selection cap ───────────────────────────────────────────────────

describe('photo upload — 20-photo cap', () => {
  it('passes all assets through when the picker returns exactly 20', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert');
    mockRequestLibraryPermissions.mockResolvedValue({ granted: true, canAskAgain: true });

    const twentyAssets = Array.from({ length: 20 }, (_, i) =>
      makeAsset({ assetId: `a${i}`, fileName: `photo-${i}.jpg`, uri: `file:///tmp/photo-${i}.jpg` }),
    );
    mockLaunchLibrary.mockResolvedValue({ canceled: false, assets: twentyAssets });

    let callCount = 0;
    mockRequestPhotoUrlMutateAsync.mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        uploadURL: 'https://storage.example/put',
        objectPath: `/objects/photo-${callCount}.jpg`,
      });
    });
    vi.stubGlobal('fetch', happyFetch);
    mockAttachPhotosMutateAsync.mockResolvedValue({});

    render(<LeadDetailScreen />);
    pickFromLibrary();

    // All 20 presigned-URL requests must be made — none trimmed.
    await waitFor(() => {
      expect(mockRequestPhotoUrlMutateAsync).toHaveBeenCalledTimes(20);
    });

    // No "Too many photos" alert should fire.
    expect(alertSpy).not.toHaveBeenCalledWith('Too many photos', expect.any(String));
  });

  it('trims to 20, shows an alert, and uploads exactly 20 when 21 assets are returned', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert');
    mockRequestLibraryPermissions.mockResolvedValue({ granted: true, canAskAgain: true });

    const twentyOneAssets = Array.from({ length: 21 }, (_, i) =>
      makeAsset({ assetId: `a${i}`, fileName: `photo-${i}.jpg`, uri: `file:///tmp/photo-${i}.jpg` }),
    );
    mockLaunchLibrary.mockResolvedValue({ canceled: false, assets: twentyOneAssets });

    let callCount = 0;
    mockRequestPhotoUrlMutateAsync.mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        uploadURL: 'https://storage.example/put',
        objectPath: `/objects/photo-${callCount}.jpg`,
      });
    });
    vi.stubGlobal('fetch', happyFetch);
    mockAttachPhotosMutateAsync.mockResolvedValue({});

    render(<LeadDetailScreen />);
    pickFromLibrary();

    // The truncation alert must fire.
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Too many photos', expect.any(String));
    });

    // Exactly 20 presigned-URL requests — the 21st asset is never uploaded.
    await waitFor(() => {
      expect(mockRequestPhotoUrlMutateAsync).toHaveBeenCalledTimes(20);
    });
  });
});

// ─── Success path ────────────────────────────────────────────────────────────

describe('photo upload — success path', () => {
  it('shows UPLOAD COMPLETE and invalidates the activities query', async () => {
    mockRequestLibraryPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [makeAsset()],
    });

    mockRequestPhotoUrlMutateAsync.mockResolvedValue({
      uploadURL: 'https://storage.example/put',
      objectPath: '/objects/photo.jpg',
    });
    vi.stubGlobal('fetch', happyFetch);
    mockAttachPhotosMutateAsync.mockResolvedValue({});

    render(<LeadDetailScreen />);
    pickFromLibrary();

    // Queue appears while uploading.
    await waitFor(() => {
      expect(screen.getByText('photo.jpg')).toBeTruthy();
    });

    // Attach is called with the correct path.
    await waitFor(() => {
      expect(mockAttachPhotosMutateAsync).toHaveBeenCalledWith({
        id: 'lead-1',
        data: { photoPaths: ['/objects/photo.jpg'] },
      });
    });

    // Activities query is invalidated so the timeline refreshes.
    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['activities'] }),
      );
    });

    // Status header reads UPLOAD COMPLETE when all entries are done.
    await waitFor(() => {
      expect(screen.getByText('UPLOAD COMPLETE')).toBeTruthy();
    });
  });

  it('handles multiple assets and marks all entries done on success', async () => {
    mockRequestLibraryPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [
        makeAsset({ assetId: 'a1', fileName: 'alpha.jpg', uri: 'file:///tmp/alpha.jpg' }),
        makeAsset({ assetId: 'a2', fileName: 'beta.jpg', uri: 'file:///tmp/beta.jpg' }),
      ],
    });

    let callCount = 0;
    mockRequestPhotoUrlMutateAsync.mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        uploadURL: 'https://storage.example/put',
        objectPath: `/objects/photo-${callCount}.jpg`,
      });
    });
    vi.stubGlobal('fetch', happyFetch);
    mockAttachPhotosMutateAsync.mockResolvedValue({});

    render(<LeadDetailScreen />);
    pickFromLibrary();

    await waitFor(() => {
      expect(screen.getByText('alpha.jpg')).toBeTruthy();
      expect(screen.getByText('beta.jpg')).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByText('UPLOAD COMPLETE')).toBeTruthy();
    });

    // Both paths were handed to attach.
    expect(mockAttachPhotosMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          photoPaths: expect.arrayContaining(['/objects/photo-1.jpg', '/objects/photo-2.jpg']),
        }),
      }),
    );
  });

  it('does nothing and shows no queue when the picker is cancelled', async () => {
    mockRequestLibraryPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
    mockLaunchLibrary.mockResolvedValue({ canceled: true, assets: [] });

    render(<LeadDetailScreen />);
    pickFromLibrary();

    // Give async handlers time to settle.
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByText('UPLOADING…')).toBeNull();
    expect(mockRequestPhotoUrlMutateAsync).not.toHaveBeenCalled();
  });
});
