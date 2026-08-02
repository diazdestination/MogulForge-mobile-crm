import React from 'react';
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import {
  useGetDashboardSummary,
  useGetMe,
} from '@workspace/api-client-react';
import { useAuth } from '@/lib/auth';
import { useColors } from '@/hooks/useColors';
import { Badge, Card, ErrorState, LoadingView } from '@/components/ui';
import { SecurityAlertsBanner } from '@/components/SecurityAlertsBanner';
import {
  LEAD_STATUS_COLORS,
  LEAD_STATUS_LABELS,
  timeAgo,
} from '@/constants/crm';

export default function DashboardScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { logout, user } = useAuth();
  const { data: me } = useGetMe();
  const summary = useGetDashboardSummary();

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 118 : insets.bottom + 96;

  if (summary.isLoading) return <LoadingView />;
  if (summary.isError) {
    return (
      <ErrorState
        message="Could not load the dashboard."
        onRetry={() => summary.refetch()}
      />
    );
  }

  const data = summary.data;
  const firstName = me?.firstName ?? user?.firstName ?? null;
  const activePipeline = (data?.leadsByStatus ?? []).filter(
    (row) => row.count > 0,
  );

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={{
        paddingTop: topInset + 16,
        paddingBottom: bottomInset,
        paddingHorizontal: 16,
        gap: 14,
      }}
      refreshControl={
        <RefreshControl
          refreshing={summary.isRefetching}
          onRefresh={() => summary.refetch()}
          tintColor={c.primary}
        />
      }
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={[styles.greeting, { color: c.mutedForeground }]}>
            {firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
          </Text>
          <Text style={[styles.title, { color: c.foreground }]}>Command Center</Text>
        </View>
        <Pressable
          testID="logout-button"
          onPress={logout}
          hitSlop={8}
          style={({ pressed }) => [
            styles.iconBtn,
            { backgroundColor: c.secondary },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Feather name="log-out" size={18} color={c.foreground} />
        </Pressable>
      </View>

      <SecurityAlertsBanner />

      <View style={styles.statRow}>
        <Card style={styles.statCard} onPress={() => router.push('/pipeline')}>
          <Feather name="layers" size={18} color={c.primary} />
          <Text style={[styles.statValue, { color: c.foreground }]}>
            {data?.totalLeads ?? 0}
          </Text>
          <Text style={[styles.statLabel, { color: c.mutedForeground }]}>Leads</Text>
        </Card>
        <Card style={styles.statCard} onPress={() => router.push('/tasks')}>
          <Feather name="check-circle" size={18} color={c.primary} />
          <Text style={[styles.statValue, { color: c.foreground }]}>
            {data?.openTasks ?? 0}
          </Text>
          <Text style={[styles.statLabel, { color: c.mutedForeground }]}>Open Tasks</Text>
        </Card>
        <Card style={styles.statCard} onPress={() => router.push('/appointments')}>
          <Feather name="calendar" size={18} color={c.primary} />
          <Text style={[styles.statValue, { color: c.foreground }]}>
            {data?.upcomingAppointments ?? 0}
          </Text>
          <Text style={[styles.statLabel, { color: c.mutedForeground }]}>Upcoming</Text>
        </Card>
      </View>

      <Card
        onPress={() => router.push('/concierge')}
        style={styles.conciergeCard}
      >
        <View style={[styles.conciergeIcon, { backgroundColor: c.primary + '22' }]}>
          <Feather name="mic" size={18} color={c.primary} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.conciergeTitle, { color: c.foreground }]}>
            Roof Concierge
          </Text>
          <Text style={[styles.conciergeSub, { color: c.mutedForeground }]}>
            Talk it through hands-free — voice in, spoken replies out.
          </Text>
        </View>
        <Feather name="chevron-right" size={18} color={c.mutedForeground} />
      </Card>

      <Text style={[styles.sectionTitle, { color: c.foreground }]}>Pipeline</Text>
      <Card style={{ gap: 10 }}>
        {activePipeline.length === 0 ? (
          <Text style={{ color: c.mutedForeground, fontFamily: 'Inter_400Regular' }}>
            No leads in the pipeline yet.
          </Text>
        ) : (
          activePipeline.map((row) => (
            <View key={row.status} style={styles.pipelineRow}>
              <Badge
                label={LEAD_STATUS_LABELS[row.status]}
                bg={LEAD_STATUS_COLORS[row.status].bg}
                fg={LEAD_STATUS_COLORS[row.status].fg}
              />
              <Text style={[styles.pipelineCount, { color: c.foreground }]}>
                {row.count}
              </Text>
            </View>
          ))
        )}
      </Card>

      <Text style={[styles.sectionTitle, { color: c.foreground }]}>Recent Activity</Text>
      {(data?.recentActivities ?? []).length === 0 ? (
        <Card>
          <Text style={{ color: c.mutedForeground, fontFamily: 'Inter_400Regular' }}>
            No recent activity.
          </Text>
        </Card>
      ) : (
        (data?.recentActivities ?? []).slice(0, 12).map((activity) => (
          <Card
            key={activity.id}
            onPress={
              activity.leadId
                ? () => router.push({ pathname: '/lead/[id]', params: { id: activity.leadId! } })
                : undefined
            }
            style={{ gap: 4 }}
          >
            <View style={styles.activityHeader}>
              <Text
                style={[styles.activityTitle, { color: c.foreground }]}
                numberOfLines={1}
              >
                {activity.title}
              </Text>
              <Text style={[styles.activityTime, { color: c.mutedForeground }]}>
                {timeAgo(activity.occurredAt)}
              </Text>
            </View>
            {activity.body ? (
              <Text
                style={[styles.activityBody, { color: c.mutedForeground }]}
                numberOfLines={2}
              >
                {activity.body}
              </Text>
            ) : null}
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  greeting: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  title: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    flex: 1,
    gap: 4,
    alignItems: 'flex-start',
  },
  statValue: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
  },
  statLabel: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  conciergeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  conciergeIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  conciergeTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  conciergeSub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    lineHeight: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    marginTop: 6,
  },
  pipelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pipelineCount: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  activityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  activityTitle: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  activityTime: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  activityBody: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
});
