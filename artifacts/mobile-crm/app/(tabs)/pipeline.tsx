import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import {
  listContacts,
  listLeads,
  useGetMe,
  useListContacts,
  useListLeads,
  useListUsers,
  type LeadStatus,
  type ListLeadsParams,
} from '@workspace/api-client-react';
import { memberName } from '@/constants/crm';
import { useOwnerFilter } from '@/hooks/useOwnerFilter';
import { useColors } from '@/hooks/useColors';
import { Badge, Card, Chip, EmptyState, ErrorState, LoadingView } from '@/components/ui';
import {
  LEAD_STATUSES,
  LEAD_STATUS_COLORS,
  LEAD_STATUS_LABELS,
  URGENCY_COLORS,
  URGENCY_LABELS,
  timeAgo,
} from '@/constants/crm';

export default function PipelineScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [statusFilter, setStatusFilter] = useState<LeadStatus | null>(null);
  const [needsReplyFilter, setNeedsReplyFilter] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearchText, setDebouncedSearchText] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchText(searchText), 300);
    return () => clearTimeout(timer);
  }, [searchText]);
  const me = useGetMe();
  const { ownerFilter, setOwnerFilter } = useOwnerFilter(me.data?.role);

  const leadParams: ListLeadsParams = {
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(ownerFilter === 'mine' && me.data?.id ? { assignedUserId: me.data.id } : {}),
    ...(debouncedSearchText.trim() ? { search: debouncedSearchText.trim() } : {}),
  };
  const leads = useListLeads(leadParams);
  // Extra pages loaded as the rep scrolls past the first server page (200 rows).
  const PAGE_SIZE = 200;
  const [extraLeads, setExtraLeads] = useState<NonNullable<typeof leads.data>>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const paramsKey = JSON.stringify(leadParams);
  const loadTokenRef = useRef(0);
  useEffect(() => {
    // Filters changed or the first page refetched: drop stale extra pages.
    loadTokenRef.current += 1;
    setExtraLeads([]);
    setReachedEnd(false);
    setLoadingMore(false);
  }, [paramsKey, leads.dataUpdatedAt]);

  const firstPage = leads.data ?? [];
  const loadMore = useCallback(async () => {
    if (loadingMore || reachedEnd || firstPage.length < PAGE_SIZE) return;
    const token = loadTokenRef.current;
    setLoadingMore(true);
    try {
      const next = await listLeads({
        ...leadParams,
        offset: firstPage.length + extraLeads.length,
      });
      if (token !== loadTokenRef.current) return; // filters changed mid-flight
      setExtraLeads((prev) => {
        const seen = new Set([...firstPage, ...prev].map((l) => l.id));
        return [...prev, ...next.filter((l) => !seen.has(l.id))];
      });
      if (next.length < PAGE_SIZE) setReachedEnd(true);
    } catch {
      // Leave state untouched; the rep can scroll again to retry.
    } finally {
      if (token === loadTokenRef.current) setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMore, reachedEnd, firstPage, extraLeads.length, paramsKey]);

  // When "Needs reply" is active the FlatList may show zero rows (filtered
  // client-side) and scroll is disabled, so onEndReached never fires.
  // Eagerly exhaust remaining server pages in the background so leads on
  // later pages are not silently hidden.
  useEffect(() => {
    if (!needsReplyFilter || reachedEnd || loadingMore || firstPage.length < PAGE_SIZE) return;
    void loadMore();
  }, [needsReplyFilter, reachedEnd, loadingMore, firstPage.length, extraLeads.length, loadMore]);

  const contacts = useListContacts();
  // Contacts past the first server page (200 rows) so lead cards past 200
  // contacts still resolve their contact names.
  const [extraContacts, setExtraContacts] = useState<NonNullable<typeof contacts.data>>([]);
  useEffect(() => {
    const firstContacts = contacts.data ?? [];
    setExtraContacts([]);
    if (firstContacts.length < PAGE_SIZE) return;
    let cancelled = false;
    (async () => {
      let offset = firstContacts.length;
      // Page through the rest; each short page means we've reached the end.
      for (;;) {
        let next;
        try {
          next = await listContacts({ offset });
        } catch {
          return; // keep whatever we have; next refetch retries
        }
        if (cancelled) return;
        if (next.length > 0) setExtraContacts((prev) => [...prev, ...next]);
        if (next.length < PAGE_SIZE) return;
        offset += next.length;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contacts.dataUpdatedAt]);
  const users = useListUsers();

  const userName = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of users.data ?? []) {
      map.set(member.id, memberName(member));
    }
    return map;
  }, [users.data]);

  const contactName = useMemo(() => {
    const map = new Map<string, string>();
    for (const contact of [...(contacts.data ?? []), ...extraContacts]) {
      map.set(contact.id, [contact.firstName, contact.lastName].filter(Boolean).join(' '));
    }
    return map;
  }, [contacts.data, extraContacts]);

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 118 : insets.bottom + 96;

  if (leads.isLoading && !leads.data) return <LoadingView />;
  if (leads.isError) {
    return <ErrorState message="Could not load leads." onRetry={() => leads.refetch()} />;
  }

  const allData = [...firstPage, ...extraLeads];
  const data = needsReplyFilter ? allData.filter((l) => l.hasUnreadPortalMessage) : allData;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={{ paddingTop: topInset + 16, paddingHorizontal: 16, gap: 12 }}>
        <Text style={[styles.title, { color: c.foreground }]}>Pipeline</Text>
        <TextInput
          testID="pipeline-search"
          value={searchText}
          onChangeText={setSearchText}
          placeholder="Search leads…"
          placeholderTextColor={c.mutedForeground}
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={[styles.searchInput, { backgroundColor: c.secondary, color: c.foreground, borderColor: c.border }]}
        />
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
          <Chip
            label="Needs reply"
            active={needsReplyFilter}
            onPress={() => setNeedsReplyFilter((v) => !v)}
          />
          <Chip label="All" active={statusFilter === null} onPress={() => setStatusFilter(null)} />
          {LEAD_STATUSES.map((status) => (
            <Chip
              key={status}
              label={LEAD_STATUS_LABELS[status]}
              active={statusFilter === status}
              onPress={() => setStatusFilter(statusFilter === status ? null : status)}
            />
          ))}
        </ScrollView>
      </View>
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        scrollEnabled={data.length > 0}
        contentContainerStyle={{
          padding: 16,
          paddingBottom: bottomInset,
          gap: 10,
          flexGrow: 1,
        }}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator style={{ paddingVertical: 16 }} color={c.primary} />
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={leads.isRefetching}
            onRefresh={() => leads.refetch()}
            tintColor={c.primary}
          />
        }
        ListEmptyComponent={
          needsReplyFilter && loadingMore ? null : (
            <EmptyState
              icon="inbox"
              title="No leads here"
              subtitle={
                needsReplyFilter
                  ? 'No leads are waiting for a reply right now.'
                  : statusFilter
                    ? `No leads in "${LEAD_STATUS_LABELS[statusFilter]}".`
                    : 'New leads will appear here as they come in.'
              }
            />
          )
        }
        renderItem={({ item }) => (
          <Card
            testID={`lead-card-${item.id}`}
            onPress={() => router.push({ pathname: '/lead/[id]', params: { id: item.id } })}
            style={{ gap: 8 }}
          >
            <View style={styles.rowBetween}>
              <Text style={[styles.leadName, { color: c.foreground }]} numberOfLines={1}>
                {contactName.get(item.contactId) || 'Unknown contact'}
              </Text>
              <View style={[styles.scorePill, { backgroundColor: c.secondary }]}>
                <Feather name="zap" size={11} color={c.primary} />
                <Text style={[styles.scoreText, { color: c.foreground }]}>{item.score}</Text>
              </View>
            </View>
            {item.summary ? (
              <Text style={{ color: c.mutedForeground, fontSize: 13, fontFamily: 'Inter_400Regular' }} numberOfLines={2}>
                {item.summary}
              </Text>
            ) : null}
            <View style={styles.badgeRow}>
              <Badge
                label={LEAD_STATUS_LABELS[item.status]}
                bg={LEAD_STATUS_COLORS[item.status].bg}
                fg={LEAD_STATUS_COLORS[item.status].fg}
              />
              <Badge
                label={URGENCY_LABELS[item.urgency]}
                bg={URGENCY_COLORS[item.urgency].bg}
                fg={URGENCY_COLORS[item.urgency].fg}
              />
              <Text style={[styles.time, { color: c.mutedForeground }]}>
                {timeAgo(item.updatedAt)}
              </Text>
            </View>
            {ownerFilter === 'all' ? (
              <View style={styles.assigneeRow}>
                <Feather name="user" size={12} color={c.mutedForeground} />
                <Text style={[styles.assigneeText, { color: c.mutedForeground }]} numberOfLines={1}>
                  {item.assignedUserId
                    ? userName.get(item.assignedUserId) || 'Unknown member'
                    : 'Unassigned'}
                </Text>
              </View>
            ) : null}
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
  },
  searchInput: {
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  leadName: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  scorePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  scoreText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  assigneeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  assigneeText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  time: {
    marginLeft: 'auto',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
});
