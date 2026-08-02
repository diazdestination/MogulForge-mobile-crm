import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMe,
  useGetSettings,
  useUpdateSettings,
  useListAuditEvents,
  getGetSettingsQueryKey,
  getListAuditEventsQueryKey,
  type AuditEvent,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

/** How far back a brute-force block is still worth calling out as an active alert (matches web). */
const SECURITY_ALERT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const BRUTE_FORCE_ACTION = 'api_key.brute_force_blocked';

export function recentBruteForceEvents(
  events: AuditEvent[] | undefined,
  acknowledgedAt?: string | null,
): AuditEvent[] {
  if (!events) return [];
  const cutoff = Date.now() - SECURITY_ALERT_WINDOW_MS;
  // Defense in depth: the server already filters by action + since, but keep
  // the client-side check so a stale cache entry can't show the wrong events.
  const ackTime = acknowledgedAt ? new Date(acknowledgedAt).getTime() : null;
  return events.filter((e) => {
    if (e.action !== BRUTE_FORCE_ACTION) return false;
    const created = new Date(e.createdAt).getTime();
    if (created < cutoff) return false;
    // Alerts recorded at or before the acknowledgement are dismissed;
    // a newer block event surfaces a fresh banner.
    return ackTime === null || created > ackTime;
  });
}

/**
 * Mobile counterpart of the Command Center's brute-force security banner.
 * Shows recent un-acknowledged `api_key.brute_force_blocked` audit events to
 * admins and lets them dismiss via the shared org-wide
 * `securityAlertsAcknowledgedAt` setting.
 */
export function SecurityAlertsBanner() {
  const c = useColors();
  const queryClient = useQueryClient();
  const { data: me } = useGetMe();
  const isAdmin = me?.role === 'admin';
  // Compute the window start once per mount so the query key stays stable.
  const [since] = useState(() => new Date(Date.now() - SECURITY_ALERT_WINDOW_MS).toISOString());
  const { data: events } = useListAuditEvents(
    { action: BRUTE_FORCE_ACTION, since },
    {
      query: {
        enabled: isAdmin,
        queryKey: getListAuditEventsQueryKey({ action: BRUTE_FORCE_ACTION, since }),
      },
    },
  );
  const { data: settings } = useGetSettings({
    query: { enabled: isAdmin, queryKey: getGetSettingsQueryKey() },
  });
  const dismiss = useUpdateSettings({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      },
    },
  });

  if (!isAdmin) return null;
  const alerts = recentBruteForceEvents(events, settings?.securityAlertsAcknowledgedAt);
  if (alerts.length === 0) return null;

  // Acknowledge up to the newest shown alert (not "now") so a block that
  // lands while the admin is reading still surfaces afterwards.
  const newestAlertAt = alerts.reduce(
    (max, e) => Math.max(max, new Date(e.createdAt).getTime()),
    0,
  );

  return (
    <View
      testID="alert-brute-force"
      style={[styles.container, { backgroundColor: c.destructive + '14', borderColor: c.destructive }]}
    >
      <View style={styles.headerRow}>
        <Feather name="shield" size={16} color={c.destructive} />
        <Text style={[styles.title, { color: c.destructive }]}>
          Security alert: API key guessing attempts blocked
          {alerts.length > 1 ? ` (${alerts.length} in the last 7 days)` : ''}
        </Text>
      </View>
      <View style={{ gap: 4 }}>
        {alerts.slice(0, 5).map((e) => {
          const ip = typeof e.metadata.ip === 'string' ? e.metadata.ip : 'unknown IP';
          return (
            <Text
              key={e.id}
              testID={`alert-brute-force-${e.id}`}
              style={[styles.body, { color: c.foreground }]}
            >
              {new Date(e.createdAt).toLocaleString()} — blocked repeated invalid API key attempts
              from {ip}
            </Text>
          );
        })}
        {alerts.length > 5 && (
          <Text style={[styles.body, { color: c.foreground }]}>
            …and {alerts.length - 5} more in the audit log.
          </Text>
        )}
      </View>
      <Text style={[styles.body, { color: c.mutedForeground }]}>
        Your keys were not compromised by these blocked attempts, but consider rotating any key
        that may be exposed and reviewing the audit log.
      </Text>
      <Pressable
        testID="button-dismiss-brute-force-alert"
        accessibilityRole="button"
        accessibilityLabel="Dismiss security alert"
        disabled={dismiss.isPending}
        onPress={() =>
          dismiss.mutate({
            data: { securityAlertsAcknowledgedAt: new Date(newestAlertAt).toISOString() },
          })
        }
        style={({ pressed }) => [
          styles.dismissBtn,
          { borderColor: c.destructive },
          (pressed || dismiss.isPending) && { opacity: 0.7 },
        ]}
      >
        {dismiss.isPending ? (
          <ActivityIndicator size="small" color={c.destructive} />
        ) : (
          <Text style={[styles.dismissText, { color: c.destructive }]}>
            Dismiss — I've reviewed this
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  body: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
  dismissBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 2,
  },
  dismissText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
});
