import React, { useEffect } from 'react';
import { CLIENT } from '../client.config';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// react-native-keyboard-controller requires a custom dev build and is NOT
// available in Expo Go. Wrap it with a try-catch so the app runs in Expo Go
// (keyboard-aware scroll still works via KeyboardAvoidingView fallback in
// KeyboardAwareScrollViewCompat). In a real dev/production build the full
// native implementation is used automatically.
let KeyboardProvider: React.ComponentType<{ children: React.ReactNode }>;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  KeyboardProvider = (require('react-native-keyboard-controller') as typeof import('react-native-keyboard-controller')).KeyboardProvider;
} catch {
  KeyboardProvider = ({ children }) => <>{children}</>;
}
import * as SecureStore from 'expo-secure-store';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AuthProvider, useAuth } from '@/lib/auth';
import { useColors } from '@/hooks/useColors';
import colors from '@/constants/colors';
import { Feather } from '@expo/vector-icons';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// The Expo bundle runs outside the web proxy, so the API client needs an
// absolute base URL, and (with no cookies) a bearer-token getter.
const domain = process.env.EXPO_PUBLIC_DOMAIN;
if (domain) setBaseUrl(`https://${domain}`);
setAuthTokenGetter(() => SecureStore.getItemAsync('auth_session_token'));

const queryClient = new QueryClient();

function LoginScreen() {
  const c = useColors();
  const { login, sessionExpired } = useAuth();
  return (
    <View style={[styles.loginContainer, { backgroundColor: c.background }]}>
      <View style={styles.loginContent}>
        {sessionExpired && (
          <View
            testID="session-expired-notice"
            style={[
              styles.sessionExpiredNotice,
              { backgroundColor: c.card, borderColor: c.border },
            ]}
          >
            <Feather name="clock" size={16} color={c.mutedForeground} />
            <Text style={[styles.sessionExpiredText, { color: c.foreground }]}>
              Your session expired. Please sign in again.
            </Text>
          </View>
        )}
        <View style={[styles.logoMark, { backgroundColor: c.primary }]}>
          <Image
            source={require('../assets/images/icon.png')}
            style={{ width: 84, height: 84, borderRadius: 20 }}
          />
        </View>
        <Text style={[styles.loginTitle, { color: c.foreground }]}>{CLIENT.appName}</Text>
        <Text style={[styles.loginSubtitle, { color: c.mutedForeground }]}>
          {CLIENT.loginSubtitle}
        </Text>
      </View>
      <Pressable
        testID="login-button"
        onPress={login}
        style={({ pressed }) => [
          styles.loginButton,
          { backgroundColor: c.primary },
          pressed && { opacity: 0.85 },
        ]}
      >
        <Feather name="log-in" size={18} color={c.primaryForeground} />
        <Text style={[styles.loginButtonText, { color: c.primaryForeground }]}>
          Sign in with Replit
        </Text>
      </Pressable>
    </View>
  );
}

function RootLayoutNav() {
  const c = useColors();
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return <View style={{ flex: 1, backgroundColor: c.background }} />;
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <Stack
      screenOptions={{
        headerBackTitle: 'Back',
        headerTintColor: c.primary,
        headerTitleStyle: { fontFamily: 'Inter_600SemiBold', color: c.foreground },
        headerStyle: { backgroundColor: c.background },
        contentStyle: { backgroundColor: c.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="lead/[id]" options={{ title: 'Lead' }} />
      <Stack.Screen name="concierge" options={{ title: 'Roof Concierge' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <GestureHandlerRootView>
              <KeyboardProvider>
                <RootLayoutNav />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loginContainer: {
    flex: 1,
    padding: 28,
    paddingTop: Platform.OS === 'web' ? 96 : 60,
    paddingBottom: Platform.OS === 'web' ? 64 : 48,
    justifyContent: 'space-between',
  },
  loginContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  logoMark: {
    width: 84,
    height: 84,
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 8,
  },
  loginTitle: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
  },
  loginSubtitle: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    maxWidth: 300,
  },
  loginButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: colors.radius,
  },
  loginButtonText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  sessionExpiredNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: colors.radius,
    borderWidth: 1,
    marginBottom: 12,
  },
  sessionExpiredText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
});
