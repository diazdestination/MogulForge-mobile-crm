import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListTodayActions,
  getListTodayActionsQueryKey,
  useGetLeadNextAction,
  getGetLeadNextActionQueryKey,
  useRecordNextActionFeedback,
  useSendLeadEmail,
  getListLeadActivitiesQueryKey,
  type NextBestAction,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { Card } from '@/components/ui';

const ACTION_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  call_now: 'phone',
  reply_portal_message: 'message-circle',
  send_message: 'send',
  follow_up_estimate: 'send',
  schedule_follow_up: 'clock',
};

/** Action types whose recommendation carries a sendable message draft. */
const MESSAGE_TYPES = new Set(['send_message', 'follow_up_estimate', 'reply_portal_message']);

/**
 * "Today's actions" queue for reps in the field: the Closer Engine's
 * highest-impact leads first. Rows open the lead, and offer inline quick
 * actions — snooze/dismiss without leaving Home, plus an expandable draft
 * preview (send from here) for message-type recommendations.
 */
export function TodayActions() {
  const c = useColors();
  const { data: actions } = useListTodayActions(undefined, {
    query: { queryKey: getListTodayActionsQueryKey() },
  });

  if (!actions || actions.length === 0) return null;

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.titleRow}>
        <Feather name="zap" size={15} color={c.primary} />
        <Text style={[styles.sectionTitle, { color: c.foreground }]}>
          Today's Actions
        </Text>
        <View style={[styles.countPill, { backgroundColor: c.primary + '22' }]}>
          <Text style={[styles.countText, { color: c.primary }]}>
            {actions.length}
          </Text>
        </View>
      </View>
      {actions.slice(0, 6).map((a) => (
        <TodayActionRow key={a.leadId} action={a} />
      ))}
    </View>
  );
}

function TodayActionRow({ action: a }: { action: NextBestAction }) {
  const c = useColors();
  const [expanded, setExpanded] = useState(false);
  const feedback = useRecordNextActionFeedback();
  const queryClient = useQueryClient();
  const name = a.contactName || a.leadSummary || 'Lead';
  const expandable = MESSAGE_TYPES.has(a.actionType);

  const record = async (
    response: 'snoozed' | 'dismissed' | 'sent' | 'edited',
    snoozeHours?: number,
  ) => {
    try {
      await feedback.mutateAsync({
        id: a.leadId,
        data: { actionType: a.actionType, response, ...(snoozeHours ? { snoozeHours } : {}) },
      });
    } catch {
      // Feedback is best-effort; never block the rep's flow on it.
    }
    queryClient.invalidateQueries({ queryKey: getListTodayActionsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetLeadNextActionQueryKey(a.leadId) });
  };

  return (
    <Card style={styles.rowCard}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open lead ${name}`}
          onPress={() =>
            router.push({ pathname: '/lead/[id]', params: { id: a.leadId } })
          }
          style={({ pressed }) => [styles.rowMain, pressed && { opacity: 0.7 }]}
        >
          <View style={[styles.iconWrap, { backgroundColor: c.primary + '18' }]}>
            <Feather
              name={ACTION_ICONS[a.actionType] ?? 'zap'}
              size={16}
              color={c.primary}
            />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              style={[styles.leadName, { color: c.foreground }]}
              numberOfLines={1}
            >
              {name}
            </Text>
            <Text
              style={[styles.actionTitle, { color: c.mutedForeground }]}
              numberOfLines={2}
            >
              {a.title}
              {a.reasons[0] ? ` — ${a.reasons[0]}` : ''}
            </Text>
          </View>
        </Pressable>
        {expandable && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${expanded ? 'Hide' : 'Show'} draft for ${name}`}
            accessibilityState={{ expanded }}
            onPress={() => setExpanded((v) => !v)}
            hitSlop={6}
            style={[styles.quickBtn, { borderColor: c.border }]}
          >
            <Feather
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={15}
              color={c.mutedForeground}
            />
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Snooze suggestion for ${name} for 24 hours`}
          onPress={() => record('snoozed', 24)}
          disabled={feedback.isPending}
          hitSlop={6}
          style={[styles.quickBtn, { borderColor: c.border, opacity: feedback.isPending ? 0.5 : 1 }]}
        >
          <Feather name="clock" size={15} color={c.mutedForeground} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Dismiss suggestion for ${name}`}
          onPress={() => record('dismissed')}
          disabled={feedback.isPending}
          hitSlop={6}
          style={[styles.quickBtn, { borderColor: c.border, opacity: feedback.isPending ? 0.5 : 1 }]}
        >
          <Feather name="x" size={15} color={c.mutedForeground} />
        </Pressable>
      </View>
      {expandable && expanded && (
        <ExpandedDraft
          leadId={a.leadId}
          name={name}
          onRecorded={(response) => record(response)}
        />
      )}
    </Card>
  );
}

/**
 * Inline draft preview: fetches the single-lead recommendation (which
 * carries the AI draft) only once the rep expands the row. Email drafts can
 * be sent right here; other drafts deep-link to the lead for the full flow.
 */
function ExpandedDraft({
  leadId,
  name,
  onRecorded,
}: {
  leadId: string;
  name: string;
  onRecorded: (response: 'sent' | 'edited') => void | Promise<void>;
}) {
  const c = useColors();
  const queryClient = useQueryClient();
  const sendEmail = useSendLeadEmail();
  const { data: action, isLoading } = useGetLeadNextAction(leadId, {
    query: { queryKey: getGetLeadNextActionQueryKey(leadId) },
  });

  if (isLoading) {
    return (
      <View style={styles.draftWrap}>
        <ActivityIndicator size="small" color={c.primary} />
      </View>
    );
  }

  const draft = action && action.actionType !== 'none' ? action.draft : undefined;
  if (!draft) {
    return (
      <View style={[styles.draftWrap, { borderTopColor: c.border }]}>
        <Text style={[styles.draftMeta, { color: c.mutedForeground }]}>
          No ready-to-send draft — open the lead for the full recommendation.
        </Text>
      </View>
    );
  }

  const isEmail = action!.channel === 'email';

  const handleSend = async () => {
    try {
      await sendEmail.mutateAsync({
        id: leadId,
        data: { subject: draft.subject?.trim() || 'Checking in', body: draft.body },
      });
      queryClient.invalidateQueries({ queryKey: getListLeadActivitiesQueryKey(leadId) });
      await onRecorded('sent');
      Alert.alert('Email sent', 'Logged on the lead timeline.');
    } catch {
      Alert.alert('Send failed', 'Sending the email failed. Try again in a moment.');
    }
  };

  return (
    <View style={[styles.draftWrap, { borderTopColor: c.border }]}>
      {draft.subject ? (
        <Text style={[styles.draftSubject, { color: c.foreground }]} numberOfLines={1}>
          {draft.subject}
        </Text>
      ) : null}
      <Text style={[styles.draftBody, { color: c.foreground }]}>{draft.body}</Text>
      <Text style={[styles.draftMeta, { color: c.mutedForeground }]}>
        AI draft ({draft.provider}) — you always confirm the send
      </Text>
      {isEmail ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Send draft email to ${name}`}
          onPress={handleSend}
          disabled={sendEmail.isPending}
          style={[styles.sendBtn, { backgroundColor: c.primary, opacity: sendEmail.isPending ? 0.6 : 1 }]}
        >
          {sendEmail.isPending ? (
            <ActivityIndicator size="small" color={c.primaryForeground} />
          ) : (
            <Feather name="send" size={14} color={c.primaryForeground} />
          )}
          <Text style={[styles.sendBtnText, { color: c.primaryForeground }]}>Send email</Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open lead ${name} to send this text`}
          onPress={() =>
            router.push({ pathname: '/lead/[id]', params: { id: leadId } })
          }
          style={[styles.sendBtn, { backgroundColor: c.primary }]}
        >
          <Feather name="arrow-right" size={14} color={c.primaryForeground} />
          <Text style={[styles.sendBtnText, { color: c.primaryForeground }]}>Open lead to send</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  countPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  rowCard: { gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leadName: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  actionTitle: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 16 },
  draftWrap: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, gap: 6 },
  draftSubject: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  draftBody: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  draftMeta: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    paddingVertical: 9,
    marginTop: 4,
  },
  sendBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
});
