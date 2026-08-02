import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
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
  useGetMe,
  useListTasks,
  useListUsers,
  useUpdateTask,
  type TaskStatus,
} from '@workspace/api-client-react';
import { useOwnerFilter } from '@/hooks/useOwnerFilter';
import { useColors } from '@/hooks/useColors';
import { Badge, Card, Chip, EmptyState, ErrorState, LoadingView } from '@/components/ui';
import { AddButton, CreateTaskModal } from '@/components/CreateModals';
import {
  TASK_STATUS_LABELS,
  URGENCY_COLORS,
  URGENCY_LABELS,
  formatDateTime,
  memberName,
} from '@/constants/crm';

const FILTERS: (TaskStatus | null)[] = [null, 'open', 'in_progress', 'done', 'cancelled'];

export default function TasksScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<TaskStatus | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const me = useGetMe();
  const { ownerFilter, setOwnerFilter } = useOwnerFilter(me.data?.role);

  const tasks = useListTasks({
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(ownerFilter === 'mine' && me.data?.id ? { assignedUserId: me.data.id } : {}),
  });
  const users = useListUsers();

  const userName = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of users.data ?? []) {
      map.set(member.id, memberName(member));
    }
    return map;
  }, [users.data]);

  const updateTask = useUpdateTask({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries(),
    },
  });

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 118 : insets.bottom + 96;

  if (tasks.isLoading && !tasks.data) return <LoadingView />;
  if (tasks.isError) {
    return <ErrorState message="Could not load tasks." onRetry={() => tasks.refetch()} />;
  }

  const data = tasks.data ?? [];

  const toggleDone = (id: string, current: TaskStatus) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    updateTask.mutate({
      id,
      data: { status: current === 'done' ? 'open' : 'done' },
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={{ paddingTop: topInset + 16, paddingHorizontal: 16, gap: 12 }}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: c.foreground }]}>Tasks</Text>
          <AddButton testID="task-add-button" onPress={() => setCreateOpen(true)} />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
        >
          <Chip
            label="Mine"
            active={ownerFilter === 'mine'}
            onPress={() => setOwnerFilter(ownerFilter === 'mine' ? 'all' : 'mine')}
          />
          {FILTERS.map((f) => (
            <Chip
              key={f ?? 'all'}
              label={f ? TASK_STATUS_LABELS[f] : 'All'}
              active={statusFilter === f}
              onPress={() => setStatusFilter(f)}
            />
          ))}
        </ScrollView>
      </View>
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        scrollEnabled={data.length > 0}
        contentContainerStyle={{ padding: 16, paddingBottom: bottomInset, gap: 10, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={tasks.isRefetching}
            onRefresh={() => tasks.refetch()}
            tintColor={c.primary}
          />
        }
        ListEmptyComponent={
          <EmptyState icon="check-circle" title="No tasks" subtitle="You're all caught up." />
        }
        renderItem={({ item }) => {
          const done = item.status === 'done';
          return (
            <Card style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
              <Pressable
                testID={`task-toggle-${item.id}`}
                onPress={() => toggleDone(item.id, item.status)}
                hitSlop={8}
                style={({ pressed }) => [pressed && { opacity: 0.6 }]}
              >
                <Feather
                  name={done ? 'check-circle' : 'circle'}
                  size={22}
                  color={done ? c.success : c.mutedForeground}
                />
              </Pressable>
              <Pressable
                style={{ flex: 1, gap: 5 }}
                onPress={
                  item.leadId
                    ? () => router.push({ pathname: '/lead/[id]', params: { id: item.leadId! } })
                    : undefined
                }
              >
                <Text
                  style={[
                    styles.taskTitle,
                    { color: done ? c.mutedForeground : c.foreground },
                    done && { textDecorationLine: 'line-through' },
                  ]}
                >
                  {item.title}
                </Text>
                {item.description ? (
                  <Text
                    style={{ color: c.mutedForeground, fontSize: 13, fontFamily: 'Inter_400Regular' }}
                    numberOfLines={2}
                  >
                    {item.description}
                  </Text>
                ) : null}
                {item.leadId ? (
                  <View style={styles.leadRow}>
                    <Feather name="link" size={12} color={c.primary} />
                    <Text
                      testID={`task-lead-label-${item.id}`}
                      style={{ color: c.primary, fontSize: 12, fontFamily: 'Inter_600SemiBold' }}
                      numberOfLines={1}
                    >
                      {item.leadLabel || 'View lead'}
                    </Text>
                    <Feather name="chevron-right" size={12} color={c.primary} />
                  </View>
                ) : null}
                <View style={styles.metaRow}>
                  <Badge
                    label={URGENCY_LABELS[item.priority]}
                    bg={URGENCY_COLORS[item.priority].bg}
                    fg={URGENCY_COLORS[item.priority].fg}
                  />
                  {item.dueAt ? (
                    <Text style={{ color: c.mutedForeground, fontSize: 12, fontFamily: 'Inter_400Regular' }}>
                      Due {formatDateTime(item.dueAt)}
                    </Text>
                  ) : null}
                  {ownerFilter === 'all' ? (
                    <View style={styles.assignee}>
                      <Feather name="user" size={12} color={c.mutedForeground} />
                      <Text
                        style={{ color: c.mutedForeground, fontSize: 12, fontFamily: 'Inter_400Regular' }}
                        numberOfLines={1}
                      >
                        {item.assignedUserId
                          ? userName.get(item.assignedUserId) || 'Unknown member'
                          : 'Unassigned'}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            </Card>
          );
        }}
      />
      <CreateTaskModal visible={createOpen} onClose={() => setCreateOpen(false)} />
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
  taskTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  leadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  assignee: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
});
