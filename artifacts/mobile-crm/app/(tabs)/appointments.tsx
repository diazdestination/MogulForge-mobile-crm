import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import {
  useListAppointments,
  useUpdateAppointment,
  type Appointment,
  type AppointmentStatus,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { Badge, Card, EmptyState, ErrorState, LoadingView } from '@/components/ui';
import {
  AddButton,
  CreateAppointmentModal,
  RescheduleAppointmentModal,
} from '@/components/CreateModals';
import {
  APPOINTMENT_STATUS_COLORS,
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  formatDateTime,
} from '@/constants/crm';

const NEXT_STATUS: Partial<Record<AppointmentStatus, { to: AppointmentStatus; label: string; icon: 'check' | 'flag' }>> = {
  scheduled: { to: 'confirmed', label: 'Confirm', icon: 'check' },
  confirmed: { to: 'completed', label: 'Complete', icon: 'flag' },
};

export default function AppointmentsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [rescheduling, setRescheduling] = useState<Appointment | null>(null);

  const appointments = useListAppointments();
  const updateAppointment = useUpdateAppointment({
    mutation: { onSuccess: () => queryClient.invalidateQueries() },
  });

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 118 : insets.bottom + 96;

  const sorted = useMemo(() => {
    const list = [...(appointments.data ?? [])];
    list.sort(
      (a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime(),
    );
    return list;
  }, [appointments.data]);

  if (appointments.isLoading && !appointments.data) return <LoadingView />;
  if (appointments.isError) {
    return (
      <ErrorState
        message="Could not load appointments."
        onRetry={() => appointments.refetch()}
      />
    );
  }

  const advance = (item: Appointment) => {
    const next = NEXT_STATUS[item.status];
    if (!next) return;
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    updateAppointment.mutate({ id: item.id, data: { status: next.to } });
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={[styles.headerRow, { paddingTop: topInset + 16, paddingHorizontal: 16 }]}>
        <Text style={[styles.title, { color: c.foreground }]}>Schedule</Text>
        <AddButton testID="appt-add-button" onPress={() => setCreateOpen(true)} />
      </View>
      <FlatList
        data={sorted}
        keyExtractor={(item) => item.id}
        scrollEnabled={sorted.length > 0}
        contentContainerStyle={{ padding: 16, paddingBottom: bottomInset, gap: 10, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={appointments.isRefetching}
            onRefresh={() => appointments.refetch()}
            tintColor={c.primary}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="calendar"
            title="No appointments"
            subtitle="Scheduled inspections and walkthroughs will show up here."
          />
        }
        renderItem={({ item }) => {
          const next = NEXT_STATUS[item.status];
          return (
            <Card
              onPress={
                item.leadId
                  ? () => router.push({ pathname: '/lead/[id]', params: { id: item.leadId! } })
                  : undefined
              }
              style={{ gap: 8 }}
            >
              <View style={styles.rowBetween}>
                <Text style={[styles.apptType, { color: c.foreground }]}>
                  {APPOINTMENT_TYPE_LABELS[item.type]}
                </Text>
                <Badge
                  label={APPOINTMENT_STATUS_LABELS[item.status]}
                  bg={APPOINTMENT_STATUS_COLORS[item.status].bg}
                  fg={APPOINTMENT_STATUS_COLORS[item.status].fg}
                />
              </View>
              {item.leadLabel ? (
                <View style={styles.metaRow}>
                  <Feather name="user" size={13} color={c.mutedForeground} />
                  <Text style={{ color: c.mutedForeground, fontSize: 13, fontFamily: 'Inter_500Medium' }}>
                    {item.leadLabel}
                  </Text>
                </View>
              ) : null}
              <View style={styles.metaRow}>
                <Feather name="clock" size={13} color={c.mutedForeground} />
                <Text style={{ color: c.mutedForeground, fontSize: 13, fontFamily: 'Inter_500Medium' }}>
                  {formatDateTime(item.scheduledStart)}
                  {item.scheduledEnd ? ` – ${formatDateTime(item.scheduledEnd)}` : ''}
                </Text>
              </View>
              {item.notes ? (
                <Text
                  style={{ color: c.mutedForeground, fontSize: 13, fontFamily: 'Inter_400Regular' }}
                  numberOfLines={2}
                >
                  {item.notes}
                </Text>
              ) : null}
              {item.status === 'scheduled' || item.status === 'confirmed' ? (
                <Pressable
                  testID={`appt-reschedule-${item.id}`}
                  onPress={() => setRescheduling(item)}
                  style={({ pressed }) => [
                    styles.advanceBtn,
                    { backgroundColor: c.secondary },
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Feather name="calendar" size={14} color={c.primary} />
                  <Text style={{ color: c.primary, fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>
                    Reschedule
                  </Text>
                </Pressable>
              ) : null}
              {next ? (
                <Pressable
                  testID={`appt-advance-${item.id}`}
                  onPress={() => advance(item)}
                  disabled={updateAppointment.isPending}
                  style={({ pressed }) => [
                    styles.advanceBtn,
                    { backgroundColor: c.secondary },
                    (pressed || updateAppointment.isPending) && { opacity: 0.6 },
                  ]}
                >
                  <Feather name={next.icon} size={14} color={c.primary} />
                  <Text style={{ color: c.primary, fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>
                    {next.label}
                  </Text>
                </Pressable>
              ) : null}
            </Card>
          );
        }}
      />
      <CreateAppointmentModal visible={createOpen} onClose={() => setCreateOpen(false)} />
      <RescheduleAppointmentModal
        appointment={rescheduling}
        onClose={() => setRescheduling(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  apptType: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  advanceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 8,
    marginTop: 2,
  },
});
