/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║                CLIENT CONFIGURATION — REBRAND HERE           ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * This is the single file to edit when deploying this mobile CRM
 * for a new client. After updating these values:
 *   1. Replace assets/images/icon.png with the new client's app icon
 *      (1024×1024 PNG, no transparency for iOS).
 *   2. Run `eas build` to produce a new native build with the updated
 *      branding.
 */
export const CLIENT = {
  /** Full legal / display business name */
  businessName: 'Painless Roofing & Water Restoration',

  /** Short name used in compact UI contexts */
  businessShortName: 'Painless',

  /** App name shown on the login screen and throughout the UI */
  appName: 'Painless CRM',

  /**
   * Brand primary color hex.
   * Keep in sync with constants/colors.ts primary values.
   * Current: International Klein Blue.
   */
  primaryColor: '#0033A0' as string,

  /** Name of the AI chat assistant shown to customers */
  aiAssistantName: 'Roof Concierge',

  /** Subtitle text shown on the login screen below the app name */
  loginSubtitle:
    'The Command Center in your pocket. Check the pipeline, update leads after inspections, and log activity on site.',

  /** IANA timezone identifier for this business */
  timezone: 'America/New_York',

  /**
   * App Store / Google Play slug — lowercase letters, numbers, and hyphens only.
   * Used as expo.slug and expo.scheme in app.config.ts.
   */
  appSlug: 'painless-crm',

  /**
   * URL scheme for deep links (must match appSlug or be its own identifier).
   * Used as expo.scheme in app.config.ts.
   */
  appScheme: 'painless-crm',

  /**
   * iOS Bundle Identifier — reverse-DNS format, e.g. com.acme.crm.
   * Set to a value you own before submitting to the App Store.
   */
  iosBundleId: 'com.painless.crm',

  /**
   * Android application package name — reverse-DNS format, e.g. com.acme.crm.
   * Set to a value you own before submitting to Google Play.
   */
  androidPackage: 'com.painless.crm',
} as const;
