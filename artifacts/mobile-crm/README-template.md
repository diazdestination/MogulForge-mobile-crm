# Painless CRM Mobile — Client Template

A React Native / Expo mobile companion to the Painless CRM: pipeline view, lead updates, activity logging, appointment scheduling, and photo uploads — all from the field.

---

## Rebranding for a new client

**Everything client-specific lives in two files. Edit them first.**

| File | What to change |
|---|---|
| `artifacts/mobile-crm/client.config.ts` | Business name, short name, app display name, primary color, AI assistant name, login screen subtitle, timezone, app slug, URL scheme, iOS bundle ID, Android package |
| `artifacts/api-server/src/lib/client.config.ts` | Default org name, org slug, fallback business name, AI assistant name, greeting |

After editing those files:

1. **App icon** — replace `artifacts/mobile-crm/assets/images/icon.png` with the new client's app icon (1024×1024 PNG, no transparency for iOS, simple solid background for Google Play).
2. **Primary color** — `primaryColor` in `client.config.ts` automatically flows through to `constants/colors.ts`. No separate CSS update needed.
3. **Run `eas build`** — `app.config.ts` reads `appSlug`, `appScheme`, `iosBundleId`, and `androidPackage` directly from `client.config.ts`, so no manual edits to `app.json` are needed.

---

## Local development (Expo Go)

### Prerequisites
- Node 22+
- pnpm 9+
- Expo Go app on your iOS or Android device

### Setup

```bash
# Install dependencies
pnpm install

# Start the API server (in one terminal)
pnpm --filter @workspace/api-server run dev

# Start Expo (in another terminal)
pnpm --filter @workspace/mobile-crm run dev
```

Scan the QR code in your terminal with Expo Go to open the app.

> **Note:** Some native modules (keyboard controller, date picker) require a custom dev build and are not available in Expo Go. The app gracefully falls back to React Native built-ins in Expo Go so you can still develop and test most features.

### Environment variables

The app reads `EXPO_PUBLIC_DOMAIN` to know where the API server is. Set it in a `.env.local` file in `artifacts/mobile-crm/`:

```
EXPO_PUBLIC_DOMAIN=your-api-server.example.com
```

For local dev, use your machine's LAN IP (e.g. `192.168.1.10:3001`) so the phone can reach it.

---

## Building for distribution (EAS Build)

```bash
# Install EAS CLI
npm install -g eas-cli

# Log in to your Expo account
eas login

# Configure the project (one-time)
eas build:configure

# Build for iOS (TestFlight / App Store)
eas build --platform ios

# Build for Android (Google Play)
eas build --platform android
```

Submit to the stores:
```bash
eas submit --platform ios
eas submit --platform android
```

---

## Architecture

```
artifacts/
  mobile-crm/       Expo React Native app
    app/            Expo Router screens + layouts
    components/     Shared UI components
    constants/      Colors, config
    client.config.ts ← rebrand here
  api-server/       Node.js API (shared with CRM desktop)
lib/
  api-client-react/ React Query hooks
  api-zod/          Shared API schema
  db/               Drizzle schema
```
