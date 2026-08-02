import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import colors from '@/constants/colors';

const TOOL_LABELS: Record<string, string> = {
  get_pipeline_snapshot: 'Checking pipeline metrics…',
  get_conversion_insights: 'Analyzing conversion data…',
  get_appointments_stats: 'Looking up appointments…',
  get_team_workload: 'Reviewing team workload…',
  get_revenue_summary: 'Calculating revenue…',
  get_stale_leads: 'Finding stale leads…',
};

const SUGGESTIONS = [
  "What's our close rate this quarter?",
  "What's working in lead conversion?",
  'Any missed opportunities recently?',
  "Who's overloaded on the team?",
  'How are appointments looking this month?',
  'Give me a revenue pipeline summary',
];

type Message = {
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
  toolsRun?: string[];
};

// ─── Simple markdown renderer for React Native ───────────────────────────────
// Handles the most common AI output patterns: headers, bullets, bold, paragraphs.

function parseInline(text: string, c: ReturnType<typeof useColors>): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <Text key={i} style={{ fontWeight: '700', color: c.foreground }}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    return <Text key={i}>{part}</Text>;
  });
}

function MarkdownView({
  content,
  error,
  c,
}: {
  content: string;
  error?: boolean;
  c: ReturnType<typeof useColors>;
}) {
  const lines = content.split('\n');
  const nodes: React.ReactNode[] = [];
  let bulletBuffer: string[] = [];

  const flushBullets = (key: string) => {
    if (bulletBuffer.length === 0) return;
    nodes.push(
      <View key={key} style={{ marginBottom: 6 }}>
        {bulletBuffer.map((item, i) => (
          <View key={i} style={styles.bulletRow}>
            <Text style={[styles.bulletDot, { color: c.primary }]}>{'•'}</Text>
            <Text style={[styles.bulletText, { color: error ? c.destructive : c.foreground }]}>
              {parseInline(item, c)}
            </Text>
          </View>
        ))}
      </View>,
    );
    bulletBuffer = [];
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      bulletBuffer.push(trimmed.slice(2));
      return;
    }

    flushBullets(`bullets-${idx}`);

    if (trimmed.startsWith('## ')) {
      nodes.push(
        <Text key={idx} style={[styles.h2, { color: c.foreground }]}>
          {trimmed.slice(3)}
        </Text>,
      );
      return;
    }

    if (trimmed.startsWith('### ')) {
      nodes.push(
        <Text key={idx} style={[styles.h3, { color: c.mutedForeground }]}>
          {trimmed.slice(4).toUpperCase()}
        </Text>,
      );
      return;
    }

    if (trimmed === '') {
      nodes.push(<View key={idx} style={{ height: 6 }} />);
      return;
    }

    nodes.push(
      <Text key={idx} style={[styles.paragraph, { color: error ? c.destructive : c.foreground }]}>
        {parseInline(trimmed, c)}
      </Text>,
    );
  });

  flushBullets('bullets-end');

  return <View>{nodes}</View>;
}

// ─── TypingDots ───────────────────────────────────────────────────────────────

function TypingDots({ c }: { c: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.dotsRow}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.dot, { backgroundColor: c.primary, opacity: 0.4 }]} />
      ))}
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

function getApiBaseUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}`;
  return '';
}

async function getAuthToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  return SecureStore.getItemAsync('auth_session_token');
}

/** Safely update the last assistant message. Returns `prev` unchanged when the
 *  message list has been cleared mid-stream (e.g. by "New Chat"). */
function updateLastAssistant(
  prev: Message[],
  updater: (last: Message) => Message,
): Message[] {
  const last = prev[prev.length - 1];
  if (!last || last.role !== 'assistant') return prev;
  const next = [...prev];
  next[next.length - 1] = updater(last);
  return next;
}

export default function AssistantScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentTool, setCurrentTool] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  /** Holds the AbortController for the currently in-flight SSE request so that
   *  "New Chat" can cancel mid-stream without crashing. */
  const abortRef = useRef<AbortController | null>(null);

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 118 : insets.bottom + 96;

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentTool, scrollToBottom]);

  const submitMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isGenerating) return;

      // Cancel any previous in-flight request (defensive guard).
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      const newMsg: Message = { role: 'user', content: text };
      const contextMessages = [...messages, newMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      setMessages((prev) => [...prev, newMsg, { role: 'assistant', content: '', toolsRun: [] }]);
      setInputValue('');
      setIsGenerating(true);
      setCurrentTool(null);

      try {
        const token = await getAuthToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`${getApiBaseUrl()}/api/v1/assistant/chat`, {
          method: 'POST',
          headers,
          credentials: 'include',
          signal: abort.signal,
          body: JSON.stringify({ messages: contextMessages }),
        });

        if (res.status === 401) {
          setMessages((prev) =>
            updateLastAssistant(prev, (last) => ({
              ...last,
              content: 'Your session has expired. Please sign in again.',
              error: true,
            })),
          );
          setIsGenerating(false);
          return;
        }

        if (res.status === 503) {
          setMessages((prev) =>
            updateLastAssistant(prev, (last) => ({
              ...last,
              content: 'Assistant is not configured on this server.',
              error: true,
            })),
          );
          setIsGenerating(false);
          return;
        }

        if (!res.ok) throw new Error('API Error');

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error('No stream reader');

        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const dataStr = line.slice(6);
            if (!dataStr.trim()) continue;
            try {
              const data = JSON.parse(dataStr);
              if (data.tool) {
                setCurrentTool(data.tool);
                setMessages((prev) =>
                  updateLastAssistant(prev, (last) => ({
                    ...last,
                    toolsRun: [...(last.toolsRun ?? []), data.tool],
                  })),
                );
              } else if (data.content !== undefined) {
                setCurrentTool(null);
                setMessages((prev) =>
                  updateLastAssistant(prev, (last) => ({
                    ...last,
                    content: last.content + data.content,
                  })),
                );
              } else if (data.error) {
                setCurrentTool(null);
                setMessages((prev) =>
                  updateLastAssistant(prev, (last) => ({
                    ...last,
                    content: data.error,
                    error: true,
                  })),
                );
              } else if (data.done) {
                setCurrentTool(null);
              }
            } catch {
              // ignore malformed SSE lines
            }
          }
        }
      } catch (err) {
        // Ignore intentional aborts (user pressed "New Chat" mid-stream).
        if (err instanceof Error && err.name === 'AbortError') return;

        setMessages((prev) =>
          updateLastAssistant(prev, (last) => ({
            ...last,
            content: 'A network error occurred. Please try again.',
            error: true,
          })),
        );
      } finally {
        // Only reset generating state if this controller is still the active one
        // (prevents a stale response from overwriting a fresh request's state).
        if (abortRef.current === abort) {
          setIsGenerating(false);
          setCurrentTool(null);
          abortRef.current = null;
        }
      }
    },
    [messages, isGenerating],
  );

  const handleNewChat = useCallback(() => {
    // Abort any in-flight SSE stream before clearing state so that stale SSE
    // chunks don't try to update an empty message list and crash.
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setInputValue('');
    setCurrentTool(null);
    setIsGenerating(false);
  }, []);

  const isEmpty = messages.length === 0;

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: c.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={bottomInset - insets.bottom}
    >
      {/* ── Header ── */}
      <View
        style={[
          styles.header,
          { paddingTop: topInset, borderBottomColor: c.border, backgroundColor: c.background },
        ]}
      >
        <View style={styles.headerLeft}>
          <View style={[styles.headerIcon, { backgroundColor: c.accent, borderColor: c.border }]}>
            <Feather name="zap" size={16} color={c.primary} />
          </View>
          <View>
            <Text style={[styles.headerTitle, { color: c.foreground }]}>Business Analyst</Text>
            <Text style={[styles.headerSub, { color: c.mutedForeground }]}>
              ALWAYS-ON INTELLIGENCE
            </Text>
          </View>
        </View>
        {!isEmpty && (
          <Pressable
            onPress={handleNewChat}
            style={({ pressed }) => [
              styles.newChatBtn,
              { borderColor: c.border },
              pressed && { opacity: 0.6 },
            ]}
            accessibilityLabel="New chat"
            accessibilityRole="button"
          >
            <Feather name="plus" size={14} color={c.mutedForeground} />
            <Text style={[styles.newChatText, { color: c.mutedForeground }]}>New Chat</Text>
          </Pressable>
        )}
      </View>

      {/* ── Messages / Empty state ── */}
      <ScrollView
        ref={scrollRef}
        style={styles.scrollArea}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 16 }]}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={scrollToBottom}
      >
        {isEmpty ? (
          <View style={styles.emptyState}>
            <View
              style={[styles.emptyIcon, { backgroundColor: c.accent, borderColor: c.border }]}
            >
              <Feather name="zap" size={32} color={c.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: c.foreground }]}>
              Hello, how can I help?
            </Text>
            <Text style={[styles.emptyBody, { color: c.mutedForeground }]}>
              I can analyze your pipeline, review conversion rates, summarize appointments, or
              highlight team workload.
            </Text>
            <View style={styles.suggestions}>
              {SUGGESTIONS.map((s, i) => (
                <Pressable
                  key={i}
                  onPress={() => submitMessage(s)}
                  style={({ pressed }) => [
                    styles.suggestionChip,
                    { backgroundColor: c.card, borderColor: c.border },
                    pressed && { opacity: 0.65 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={s}
                >
                  <Feather
                    name="arrow-right"
                    size={14}
                    color={c.primary}
                    style={{ marginRight: 8, marginTop: 1 }}
                  />
                  <Text style={[styles.suggestionText, { color: c.foreground }]}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <View style={styles.messageList}>
            {messages.map((msg, i) => (
              <View
                key={i}
                style={[
                  styles.messageRow,
                  msg.role === 'user' ? styles.messageRowUser : styles.messageRowAssistant,
                ]}
              >
                {msg.role === 'assistant' && (
                  <View
                    style={[
                      styles.avatarIcon,
                      { backgroundColor: c.accent, borderColor: c.border },
                    ]}
                  >
                    <Feather name="zap" size={14} color={c.primary} />
                  </View>
                )}

                <View
                  style={[
                    styles.bubble,
                    msg.role === 'user'
                      ? [styles.bubbleUser, { backgroundColor: c.primary }]
                      : styles.bubbleAssistant,
                  ]}
                >
                  {msg.role === 'user' ? (
                    <Text style={[styles.userText, { color: c.primaryForeground }]}>
                      {msg.content}
                    </Text>
                  ) : (
                    <View>
                      {(msg.toolsRun?.length ?? 0) > 0 && (
                        <View
                          style={[
                            styles.toolBadge,
                            { backgroundColor: c.muted, borderColor: c.border },
                          ]}
                        >
                          <Feather name="activity" size={10} color={c.mutedForeground} />
                          <Text style={[styles.toolBadgeText, { color: c.mutedForeground }]}>
                            {`Analyzed ${msg.toolsRun!.length} data ${msg.toolsRun!.length === 1 ? 'source' : 'sources'}`}
                          </Text>
                        </View>
                      )}

                      {msg.error && (
                        <View style={styles.errorRow}>
                          <Feather name="alert-circle" size={14} color={c.destructive} />
                          <Text style={[styles.errorLabel, { color: c.destructive }]}>
                            Failed to generate response
                          </Text>
                        </View>
                      )}

                      {!msg.content && !msg.error && isGenerating && i === messages.length - 1 ? (
                        <TypingDots c={c} />
                      ) : (
                        <MarkdownView content={msg.content} error={msg.error} c={c} />
                      )}
                    </View>
                  )}
                </View>
              </View>
            ))}

            {currentTool && (
              <View style={styles.toolIndicatorRow}>
                <ActivityIndicator size="small" color={c.primary} style={{ marginRight: 6 }} />
                <Text style={[styles.toolIndicatorText, { color: c.primary }]}>
                  {TOOL_LABELS[currentTool] ?? 'Analyzing data…'}
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* ── Input area ── */}
      <View
        style={[
          styles.inputArea,
          {
            borderTopColor: c.border,
            backgroundColor: c.background,
            paddingBottom: insets.bottom + 8,
          },
        ]}
      >
        <View style={[styles.inputRow, { backgroundColor: c.card, borderColor: c.border }]}>
          <TextInput
            value={inputValue}
            onChangeText={setInputValue}
            placeholder="Ask about pipeline, workload, or metrics…"
            placeholderTextColor={c.mutedForeground}
            multiline
            editable={!isGenerating}
            returnKeyType="send"
            onSubmitEditing={() => submitMessage(inputValue)}
            style={[styles.textInput, { color: c.foreground }]}
            accessibilityLabel="Message input"
          />
          <Pressable
            onPress={() => submitMessage(inputValue)}
            disabled={!inputValue.trim() || isGenerating}
            accessibilityLabel="Send message"
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.sendBtn,
              !inputValue.trim() || isGenerating
                ? [styles.sendBtnDisabled, { backgroundColor: c.muted }]
                : [
                    styles.sendBtnActive,
                    { backgroundColor: c.primary },
                    pressed && { opacity: 0.75 },
                  ],
            ]}
          >
            {isGenerating ? (
              <ActivityIndicator size="small" color={c.mutedForeground} />
            ) : (
              <Feather
                name="send"
                size={18}
                color={!inputValue.trim() ? c.mutedForeground : c.primaryForeground}
              />
            )}
          </Pressable>
        </View>

        <View style={styles.statusRow}>
          <View style={styles.statusDot} />
          <Text style={[styles.statusText, { color: c.mutedForeground }]}>READY TO ASSIST</Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  headerTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', letterSpacing: -0.3 },
  headerSub: { fontSize: 9, fontFamily: 'Inter_500Medium', letterSpacing: 1.2 },
  newChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  newChatText: { fontSize: 12, fontFamily: 'Inter_500Medium' },

  scrollArea: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 16 },

  emptyState: { flex: 1, alignItems: 'center', paddingTop: 40 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 28,
    maxWidth: 300,
  },
  suggestions: { width: '100%', gap: 10 },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    borderRadius: colors.radius,
    borderWidth: 1,
  },
  suggestionText: { fontSize: 14, fontFamily: 'Inter_500Medium', flex: 1, lineHeight: 20 },

  messageList: { gap: 20 },
  messageRow: { flexDirection: 'row' },
  messageRowUser: { justifyContent: 'flex-end' },
  messageRowAssistant: { justifyContent: 'flex-start', alignItems: 'flex-start' },

  avatarIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginRight: 10,
    marginTop: 2,
    flexShrink: 0,
  },

  bubble: { maxWidth: '85%', borderRadius: 14 },
  bubbleUser: { paddingHorizontal: 16, paddingVertical: 12, borderTopRightRadius: 4 },
  bubbleAssistant: {},
  userText: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21 },

  toolBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  toolBadgeText: { fontSize: 11, fontFamily: 'Inter_500Medium' },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  errorLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  dotsRow: { flexDirection: 'row', alignItems: 'center', height: 24, gap: 4 },
  dot: { width: 7, height: 7, borderRadius: 4 },

  h2: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.3,
    marginTop: 12,
    marginBottom: 4,
  },
  h3: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.1,
    marginTop: 12,
    marginBottom: 4,
  },
  paragraph: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 22 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 3 },
  bulletDot: { fontSize: 14, lineHeight: 22, marginRight: 8, width: 10 },
  bulletText: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 22, flex: 1 },

  toolIndicatorRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 40 },
  toolIndicatorText: { fontSize: 12, fontFamily: 'Inter_500Medium' },

  inputArea: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 14,
    borderWidth: 1,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    minHeight: 52,
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 21,
    maxHeight: 120,
    paddingTop: 8,
    paddingBottom: 8,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
    flexShrink: 0,
  },
  sendBtnActive: {},
  sendBtnDisabled: {},

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    gap: 6,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22C55E' },
  statusText: { fontSize: 9, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.2 },
});
