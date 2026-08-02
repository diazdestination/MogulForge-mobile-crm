/**
 * Startup boot check: a bundle can export cleanly and still crash the moment
 * the app launches (e.g. a module that throws at import time). This test
 * imports every route module and renders the app root in jsdom via
 * react-native-web, failing if module evaluation or first render throws.
 *
 * Only native-runtime shims are mocked (secure store, splash screen, auth
 * session, gesture handler, etc.) — app code, screens, components, hooks,
 * and the API client all load for real so import-time crashes surface here.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

// ---- native-runtime shims (no jsdom equivalents) --------------------------

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));

vi.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: vi.fn(async () => {}),
  hideAsync: vi.fn(async () => {}),
}));

vi.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: vi.fn(),
  openBrowserAsync: vi.fn(async () => ({})),
}));

vi.mock('expo-auth-session', () => ({
  useAutoDiscovery: () => null,
  makeRedirectUri: () => 'https://example.test/redirect',
  useAuthRequest: () => [null, null, vi.fn()],
  Prompt: { Login: 'login' },
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(async () => {}),
  notificationAsync: vi.fn(async () => {}),
  selectionAsync: vi.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

vi.mock('@expo-google-fonts/inter', () => ({
  useFonts: () => [true, null],
  Inter_400Regular: {},
  Inter_500Medium: {},
  Inter_600SemiBold: {},
  Inter_700Bold: {},
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: () => null,
  Ionicons: () => null,
  MaterialIcons: () => null,
}));

vi.mock('react-native-gesture-handler', () => {
  const chain = (): unknown =>
    new Proxy(() => chain(), { get: () => chain(), apply: () => chain() });
  return {
    GestureHandlerRootView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    GestureDetector: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Gesture: new Proxy({}, { get: () => chain() }),
  };
});

vi.mock('react-native-keyboard-controller', () => ({
  KeyboardProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  KeyboardAwareScrollView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SafeAreaView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('expo-router', () => {
  const StackComponent = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  (StackComponent as any).Screen = () => null;
  const TabsComponent = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  (TabsComponent as any).Screen = () => null;
  return {
    Stack: StackComponent,
    Tabs: TabsComponent,
    Link: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Redirect: () => null,
    router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
    useLocalSearchParams: () => ({}),
    useFocusEffect: vi.fn(),
    usePathname: () => '/',
  };
});

vi.mock('react-native-reanimated', async () => {
  const { View } = await import('react-native');
  const Animated = { View, createAnimatedComponent: (c: unknown) => c };
  return {
    default: Animated,
    ...Animated,
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
    useAnimatedStyle: () => ({}),
    useSharedValue: (v: unknown) => ({ value: v }),
    withTiming: (v: unknown) => v,
    withSpring: (v: unknown) => v,
  };
});

vi.mock('expo', () => ({
  reloadAppAsync: vi.fn(async () => {}),
}));

// Native-only expo modules some screens import.
vi.mock('expo-image', () => ({
  Image: () => null,
}));
vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: vi.fn(async () => ({ canceled: true })),
  launchCameraAsync: vi.fn(async () => ({ canceled: true })),
  requestCameraPermissionsAsync: vi.fn(async () => ({ granted: false })),
  requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: false })),
  MediaTypeOptions: { Images: 'Images' },
}));
vi.mock('expo-file-system', () => ({}));
vi.mock('expo-file-system/legacy', () => ({}));
vi.mock('expo-sharing', () => ({
  isAvailableAsync: async () => false,
  shareAsync: async () => {},
}));
vi.mock('expo-media-library', () => ({
  requestPermissionsAsync: async () => ({ granted: false }),
  saveToLibraryAsync: async () => {},
}));
vi.mock('expo-audio', () => ({
  useAudioRecorder: () => ({}),
  useAudioRecorderState: () => ({ isRecording: false }),
  AudioModule: { requestRecordingPermissionsAsync: vi.fn(async () => ({ granted: false })) },
  RecordingPresets: { HIGH_QUALITY: {} },
  setAudioModeAsync: vi.fn(async () => {}),
}));
vi.mock('expo-speech', () => ({
  speak: vi.fn(),
  stop: vi.fn(),
  isSpeakingAsync: vi.fn(async () => false),
}));
vi.mock('expo-router/unstable-native-tabs', () => {
  const NativeTabsComponent = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  (NativeTabsComponent as any).Trigger = () => null;
  return { NativeTabs: NativeTabsComponent, Icon: () => null, Label: () => null };
});
vi.mock('@react-native-community/datetimepicker', () => ({
  default: () => null,
}));
vi.mock('expo-symbols', () => ({
  SymbolView: () => null,
}));
vi.mock('expo-glass-effect', () => ({
  GlassView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  isLiquidGlassAvailable: () => false,
}));
vi.mock('expo-blur', () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// Vite injects import.meta.glob at build time; the Expo tsconfig has no
// vite/client types, so declare it here for the type checker.
declare global {
  interface ImportMeta {
    glob<T>(pattern: string): Record<string, () => Promise<T>>;
  }
}

// ---- the boot check --------------------------------------------------------

describe('mobile app boot', () => {
  beforeEach(() => {
    // The unauthenticated boot path fetches /api/auth/user; fail it like an
    // offline device would — boot must survive that.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network unavailable in boot test');
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('every route module evaluates without throwing', async () => {
    // Import-time crashes in any screen are exactly the "bundle builds but
    // app dies at launch" class of bug. Routes are auto-discovered from app/
    // so a newly added screen can never silently escape this check.
    const routes = import.meta.glob<{ default?: unknown }>('../app/**/*.{ts,tsx}');
    const paths = Object.keys(routes).sort();
    expect(paths.length, 'route auto-discovery found no files under app/').toBeGreaterThan(0);
    for (const path of paths) {
      let mod: { default?: unknown };
      try {
        mod = await routes[path]();
      } catch (err) {
        throw new Error(`route module ${path} failed to evaluate: ${err}`, { cause: err });
      }
      expect(mod.default, `route module ${path} must have a default export`).toBeTruthy();
    }
  });

  it('renders the app root without crashing (reaches the login screen)', async () => {
    const { default: RootLayout } = await import('@/app/_layout');
    render(<RootLayout />);
    // With no stored token the app must settle on the login screen, not crash.
    await waitFor(() => {
      expect(screen.getByTestId('login-button')).toBeTruthy();
    });
  });
});
