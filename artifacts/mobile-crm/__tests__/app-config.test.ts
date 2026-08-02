/**
 * Confirms that app.config.ts correctly reads appSlug, appScheme,
 * iosBundleId, and androidPackage from client.config.ts so a typo
 * in client.config.ts surfaces here rather than at EAS build time.
 */
import { describe, expect, it } from 'vitest';

// Load client config first so we have the expected values.
import { CLIENT } from '../client.config';

// app.config.ts exports a function that accepts an Expo ConfigContext.
// We pass a minimal base config so all spread operations succeed.
import appConfigFn from '../app.config';

const baseConfig = {
  name: '',
  slug: '',
  ios: {},
  android: {},
};

const resolved = appConfigFn({ config: baseConfig as any, projectRoot: '' } as any);

describe('app.config driven by client.config', () => {
  it('name matches CLIENT.appName', () => {
    expect(typeof resolved.name).toBe('string');
    expect(resolved.name.length).toBeGreaterThan(0);
    expect(resolved.name).toBe(CLIENT.appName);
  });

  it('slug matches CLIENT.appSlug', () => {
    expect(typeof resolved.slug).toBe('string');
    expect(resolved.slug.length).toBeGreaterThan(0);
    expect(resolved.slug).toBe(CLIENT.appSlug);
  });

  it('scheme matches CLIENT.appScheme', () => {
    expect(typeof resolved.scheme).toBe('string');
    expect((resolved.scheme as string).length).toBeGreaterThan(0);
    expect(resolved.scheme).toBe(CLIENT.appScheme);
  });

  it('ios.bundleIdentifier matches CLIENT.iosBundleId', () => {
    expect(typeof resolved.ios?.bundleIdentifier).toBe('string');
    expect((resolved.ios!.bundleIdentifier as string).length).toBeGreaterThan(0);
    expect(resolved.ios!.bundleIdentifier).toBe(CLIENT.iosBundleId);
  });

  it('android.package matches CLIENT.androidPackage', () => {
    expect(typeof resolved.android?.package).toBe('string');
    expect((resolved.android!.package as string).length).toBeGreaterThan(0);
    expect(resolved.android!.package).toBe(CLIENT.androidPackage);
  });
});
