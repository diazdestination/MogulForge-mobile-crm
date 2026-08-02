// Photo extraction helpers for the lead timeline. Activities store damage
// photo paths in metadata.photoPaths; only object-storage paths are shown.

// The Expo bundle runs outside the web proxy, so photo URLs need the same
// absolute base the API client uses. On web (no domain set) relative works.
const API_BASE = process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '';

export function extractPhotoPaths(metadata: Record<string, unknown> | undefined | null): string[] {
  const raw = metadata?.['photoPaths'];
  return Array.isArray(raw)
    ? raw.filter((p): p is string => typeof p === 'string' && p.startsWith('/objects/'))
    : [];
}

export function photoUrl(path: string): string {
  return `${API_BASE}/api/v1/storage${path}`;
}

/**
 * Flatten photo paths across activities, preserving the activities' order
 * (timeline order) and each activity's own photo order.
 */
export function flattenPhotoPaths(
  activities: ReadonlyArray<{ metadata?: Record<string, unknown> | null }>,
): string[] {
  return activities.flatMap((a) => extractPhotoPaths(a.metadata));
}
