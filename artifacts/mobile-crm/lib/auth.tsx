import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { useQueryClient } from '@tanstack/react-query';
import { setUnauthorizedHandler } from '@workspace/api-client-react';

WebBrowser.maybeCompleteAuthSession();

const AUTH_TOKEN_KEY = 'auth_session_token';
const ISSUER_URL =
  process.env.EXPO_PUBLIC_ISSUER_URL ?? 'https://replit.com/oidc';

interface User {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  /** True after an automatic 401 sign-out; shown once on the login screen. */
  sessionExpired: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  login: async () => {},
  logout: async () => {},
  sessionExpired: false,
});

function getApiBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_DOMAIN) {
    return `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
  }
  return '';
}

function getClientId(): string {
  return process.env.EXPO_PUBLIC_REPL_ID || '';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const queryClient = useQueryClient();

  // When any API call returns 401 (expired or deleted server session),
  // clear the stored token, wipe cached CRM data, and drop back to the
  // login screen instead of silently rendering stale data.
  useEffect(() => {
    setUnauthorizedHandler(async () => {
      await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY).catch(() => {});
      queryClient.cancelQueries().catch(() => {});
      queryClient.clear();
      setSessionExpired(true);
      setUser(null);
      setIsLoading(false);
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  const discovery = AuthSession.useAutoDiscovery(ISSUER_URL);

  const redirectUri = AuthSession.makeRedirectUri();

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: getClientId(),
      scopes: ['openid', 'email', 'profile', 'offline_access'],
      redirectUri,
      prompt: AuthSession.Prompt.Login,
    },
    discovery,
  );

  const fetchUser = useCallback(async () => {
    try {
      const token = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
      if (!token) {
        setUser(null);
        setIsLoading(false);
        return;
      }

      const apiBase = getApiBaseUrl();
      const res = await fetch(`${apiBase}/api/auth/user`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (data.user) {
        setUser(data.user);
      } else {
        await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    if (response?.type !== 'success' || !request?.codeVerifier) return;

    const { code, state } = response.params;

    (async () => {
      try {
        const apiBase = getApiBaseUrl();
        if (!apiBase) {
          console.error('API base URL is not configured.');
          return;
        }

        const exchangeRes = await fetch(
          `${apiBase}/api/mobile-auth/token-exchange`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code,
              code_verifier: request.codeVerifier,
              redirect_uri: redirectUri,
              state,
              nonce: (request as unknown as { nonce?: string }).nonce,
            }),
          },
        );

        if (!exchangeRes.ok) {
          console.error('Token exchange failed:', exchangeRes.status);
          setIsLoading(false);
          return;
        }

        const data = await exchangeRes.json();
        if (data.token) {
          await SecureStore.setItemAsync(AUTH_TOKEN_KEY, data.token);
          setIsLoading(true);
          await fetchUser();
        }
      } catch (err) {
        console.error('Token exchange error:', err);
        setIsLoading(false);
      }
    })();
  }, [response, request, redirectUri, fetchUser]);

  const login = useCallback(async () => {
    try {
      setSessionExpired(false);
      await promptAsync();
    } catch (err) {
      console.error('Login error:', err);
    }
  }, [promptAsync]);

  const logout = useCallback(async () => {
    try {
      const token = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
      if (token) {
        const apiBase = getApiBaseUrl();
        await fetch(`${apiBase}/api/mobile-auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch {
    } finally {
      await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
      queryClient.clear();
      setSessionExpired(false);
      setUser(null);
    }
  }, [queryClient]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        sessionExpired,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
