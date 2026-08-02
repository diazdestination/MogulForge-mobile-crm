import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Standalone vitest config for the Expo app. Tests run in jsdom with
// react-native aliased to react-native-web so screen components render
// without a native runtime.
export default defineConfig({
  plugins: [react()],
  // React Native / expo modules reference the Metro-injected __DEV__ global.
  define: { __DEV__: 'false' },
  resolve: {
    alias: {
      'react-native': 'react-native-web',
      '@': path.resolve(import.meta.dirname),
    },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['__tests__/**/*.test.{ts,tsx}'],
  },
});
