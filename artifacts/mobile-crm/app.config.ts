import { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic Expo config — rebrandable values are driven from client.config.ts.
 * Static, non-rebrandable values (plugins, splash, orientation, experiments,
 * permission text, etc.) remain in app.json and are carried in via the base
 * `config` argument that Expo passes to this function.
 *
 * Expo's config evaluator runs app.config.ts via Node's CJS require(), which
 * does not resolve bare .ts extensions automatically. Using an explicit
 * '.ts' extension in the require path is the standard workaround.
 *
 * To rename the app for a new client, edit client.config.ts only.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { CLIENT } = require('./client.config.ts') as typeof import('./client.config');

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: CLIENT.appName,
  slug: CLIENT.appSlug,
  scheme: CLIENT.appScheme,
  ios: {
    ...config.ios,
    bundleIdentifier: CLIENT.iosBundleId,
  },
  android: {
    ...config.android,
    package: CLIENT.androidPackage,
  },
});
