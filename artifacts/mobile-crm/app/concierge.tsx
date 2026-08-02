/**
 * AI Roof Concierge chat with voice — mirrors the public website's
 * concierge UX: optional read-aloud, mic input, and an opt-in hands-free
 * mode that re-arms the mic after each spoken reply (with a clear stop
 * control and a 20s listening safety timeout inside useSpeechInput).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import {
  useSendConciergeMessage,
  useStartConciergeConversation,
  type ConciergeReply,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useSpeechInput, useSpeechOutput } from '@/hooks/useVoice';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const OFFICE_PHONE = 'tel:+14044444476';

let nextId = 0;
function makeId(): string {
  nextId += 1;
  return `m-${Date.now()}-${nextId}`;
}

export default function ConciergeScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [emergency, setEmergency] = useState(false);
  const [done, setDone] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [handsFree, setHandsFree] = useState(false);
  const handsFreeRef = useRef(false);

  const startConversation = useStartConciergeConversation();
  const sendMessage = useSendConciergeMessage();
  const startedRef = useRef(false);

  const speech = useSpeechOutput();
  const conversationIdRef = useRef<string | null>(null);
  conversationIdRef.current = conversationId;

  const sendRef = useRef<(text: string) => void>(() => {});
  const voiceInput = useSpeechInput((transcript) => {
    sendRef.current(transcript);
  });
  const voiceInputRef = useRef(voiceInput);
  voiceInputRef.current = voiceInput;

  const setHandsFreeMode = useCallback(
    (on: boolean) => {
      handsFreeRef.current = on;
      setHandsFree(on);
      if (on) {
        // Hands-free implies replies are read aloud.
        speech.setEnabled(true);
      } else {
        voiceInputRef.current.stop();
      }
    },
    [speech],
  );

  const applyReply = useCallback(
    (reply: ConciergeReply) => {
      setConversationId(reply.conversationId);
      setMessages((prev) => [
        ...prev,
        ...reply.messages.map((content) => ({
          id: makeId(),
          role: 'assistant' as const,
          content,
        })),
      ]);
      setQuickReplies(reply.quickReplies);
      setEmergency(reply.emergency);
      setDone(reply.done);
      if (reply.done) {
        handsFreeRef.current = false;
        setHandsFree(false);
      }
      speech.speak(reply.messages, () => {
        // Hands-free: re-arm the mic after the reply finishes reading aloud.
        // Only ever runs after explicit opt-in via the hands-free toggle.
        if (handsFreeRef.current && !reply.done) {
          voiceInputRef.current.start();
        }
      });
    },
    [speech],
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    startConversation.mutate(
      { data: { source: 'mobile-app', path: '/concierge' } },
      {
        onSuccess: applyReply,
        onError: () =>
          setError('The concierge is unavailable right now. Please call us instead.'),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback(
    (content: string) => {
      const text = content.trim();
      const id = conversationIdRef.current;
      if (!text || !id || sendMessage.isPending || done) return;
      setMessages((prev) => [...prev, { id: makeId(), role: 'user', content: text }]);
      setQuickReplies([]);
      setInput('');
      sendMessage.mutate(
        { id, data: { content: text } },
        {
          onSuccess: applyReply,
          onError: () => setError('Message failed to send. Please try again or call us.'),
        },
      );
    },
    [sendMessage, done, applyReply],
  );
  sendRef.current = send;

  const busy = startConversation.isPending || sendMessage.isPending;
  const topInset = Platform.OS === 'web' ? 67 : 0;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;
  const reversed = [...messages].reverse();

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior="padding"
      keyboardVerticalOffset={topInset ? 0 : 64}
    >
      <View style={{ flex: 1, paddingTop: topInset }}>
        {speech.supported && (
          <View style={styles.toggleRow}>
            <Pressable
              testID="voice-output-toggle"
              onPress={() => {
                const next = !speech.enabled;
                speech.setEnabled(next);
                if (!next && handsFree) setHandsFreeMode(false);
              }}
              style={[
                styles.togglePill,
                {
                  backgroundColor: speech.enabled ? c.primary + '22' : c.secondary,
                  borderColor: speech.enabled ? c.primary : 'transparent',
                },
              ]}
            >
              <Feather
                name={speech.enabled ? 'volume-2' : 'volume-x'}
                size={14}
                color={speech.enabled ? c.primary : c.mutedForeground}
              />
              <Text
                style={[
                  styles.toggleText,
                  { color: speech.enabled ? c.primary : c.mutedForeground },
                ]}
              >
                Read aloud
              </Text>
            </Pressable>
            {voiceInput.supported && (
              <Pressable
                testID="hands-free-toggle"
                disabled={done}
                onPress={() => setHandsFreeMode(!handsFree)}
                style={[
                  styles.togglePill,
                  {
                    backgroundColor: handsFree ? c.primary + '22' : c.secondary,
                    borderColor: handsFree ? c.primary : 'transparent',
                    opacity: done ? 0.4 : 1,
                  },
                ]}
              >
                <Feather
                  name={handsFree ? 'mic' : 'mic-off'}
                  size={14}
                  color={handsFree ? c.primary : c.mutedForeground}
                />
                <Text
                  style={[
                    styles.toggleText,
                    { color: handsFree ? c.primary : c.mutedForeground },
                  ]}
                >
                  Hands-free
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {emergency && (
          <View style={[styles.banner, { backgroundColor: '#7f1d1d22', borderColor: '#ef444455' }]}>
            <Feather name="alert-triangle" size={16} color="#f87171" />
            <Text style={[styles.bannerText, { color: c.foreground }]}>
              Treated as an emergency — same-day priority.
            </Text>
            <Pressable
              onPress={() => Linking.openURL(OFFICE_PHONE)}
              style={[styles.bannerBtn, { backgroundColor: '#dc2626' }]}
            >
              <Feather name="phone" size={13} color="#fff" />
              <Text style={styles.bannerBtnText}>Call</Text>
            </Pressable>
          </View>
        )}

        {handsFree && (
          <View
            style={[
              styles.banner,
              { backgroundColor: c.primary + '18', borderColor: c.primary + '55' },
            ]}
          >
            <Feather name="mic" size={16} color={c.primary} />
            <Text style={[styles.bannerText, { color: c.foreground }]}>
              {voiceInput.listening
                ? 'Listening — just speak your answer.'
                : voiceInput.processing
                  ? 'Heard you — transcribing…'
                  : 'Mic turns on after each spoken reply.'}
            </Text>
            <Pressable
              testID="stop-hands-free"
              onPress={() => setHandsFreeMode(false)}
              style={[styles.bannerBtn, { backgroundColor: c.primary }]}
            >
              <Text style={styles.bannerBtnText}>Stop</Text>
            </Pressable>
          </View>
        )}

        <FlatList
          inverted
          data={reversed}
          keyExtractor={(m) => m.id}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          scrollEnabled={messages.length > 0}
          ListHeaderComponent={
            <View style={{ gap: 8 }}>
              {busy && (
                <View style={styles.typingRow}>
                  <ActivityIndicator size="small" color={c.primary} />
                  <Text style={[styles.typingText, { color: c.mutedForeground }]}>
                    Concierge is typing…
                  </Text>
                </View>
              )}
              {voiceInput.error ? (
                <Text style={[styles.noticeText, { color: c.mutedForeground }]}>
                  {voiceInput.error}
                </Text>
              ) : null}
              {error ? (
                <Pressable onPress={() => Linking.openURL(OFFICE_PHONE)}>
                  <Text style={[styles.noticeText, { color: '#f87171' }]}>
                    {error} Tap to call (404) 444-4476.
                  </Text>
                </Pressable>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <View
              style={[
                styles.bubbleRow,
                { justifyContent: item.role === 'user' ? 'flex-end' : 'flex-start' },
              ]}
            >
              <View
                style={[
                  styles.bubble,
                  item.role === 'user'
                    ? { backgroundColor: c.primary, borderBottomRightRadius: 4 }
                    : {
                        backgroundColor: c.secondary,
                        borderBottomLeftRadius: 4,
                      },
                ]}
              >
                <Text
                  style={[
                    styles.bubbleText,
                    { color: item.role === 'user' ? c.primaryForeground : c.foreground },
                  ]}
                >
                  {item.content}
                </Text>
              </View>
            </View>
          )}
        />

        {quickReplies.length > 0 && !done && (
          <View style={styles.quickRow}>
            {quickReplies.map((qr) => (
              <Pressable
                key={qr}
                onPress={() => send(qr)}
                style={[styles.quickChip, { borderColor: c.primary + '66', backgroundColor: c.primary + '11' }]}
              >
                <Text style={[styles.quickChipText, { color: c.primary }]}>{qr}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View
          style={[
            styles.inputRow,
            { borderTopColor: c.border, paddingBottom: bottomInset + 10 },
          ]}
        >
          {voiceInput.supported && (
            <Pressable
              testID="mic-button"
              onPress={voiceInput.toggle}
              disabled={!conversationId || done || sendMessage.isPending || voiceInput.processing}
              style={[
                styles.iconBtn,
                {
                  backgroundColor: voiceInput.listening ? '#dc262622' : c.secondary,
                  opacity:
                    !conversationId || done || sendMessage.isPending || voiceInput.processing
                      ? 0.4
                      : 1,
                },
              ]}
            >
              {voiceInput.processing ? (
                <ActivityIndicator size="small" color={c.primary} />
              ) : (
                <Feather
                  name={voiceInput.listening ? 'mic-off' : 'mic'}
                  size={20}
                  color={voiceInput.listening ? '#ef4444' : c.foreground}
                />
              )}
            </Pressable>
          )}
          <TextInput
            testID="concierge-input"
            editable={!!conversationId && !done}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => send(input)}
            returnKeyType="send"
            placeholder={
              done
                ? 'Conversation complete'
                : voiceInput.listening
                  ? 'Listening… speak now'
                  : 'Type your answer…'
            }
            placeholderTextColor={c.mutedForeground}
            style={[
              styles.input,
              { backgroundColor: c.secondary, color: c.foreground },
            ]}
          />
          <Pressable
            testID="send-button"
            onPress={() => send(input)}
            disabled={!input.trim() || !conversationId || done || sendMessage.isPending}
            style={[
              styles.iconBtn,
              {
                backgroundColor: c.primary,
                opacity:
                  !input.trim() || !conversationId || done || sendMessage.isPending ? 0.4 : 1,
              },
            ]}
          >
            <Feather name="send" size={18} color={c.primaryForeground} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  togglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  toggleText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: 'Inter_500Medium',
  },
  bannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  bannerBtnText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  bubbleRow: {
    flexDirection: 'row',
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'Inter_400Regular',
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typingText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  noticeText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  quickChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  quickChipText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 16,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
});
