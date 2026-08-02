/**
 * Voice helpers for the mobile concierge, mirroring the website's
 * use-voice hooks:
 * - Speech output via expo-speech (native + web).
 * - Speech input via the Web Speech API on web, or expo-audio recording +
 *   the server transcription endpoint on iOS/Android.
 * Both degrade gracefully — `supported` flags let the UI hide controls,
 * so typing always remains the fallback.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { useTranscribeConciergeAudio } from '@workspace/api-client-react';

const LISTEN_TIMEOUT_MS = 20000; // Never leave the mic armed longer than 20s.

const GENERIC_ERROR = 'Voice input hit a snag — please type your answer.';
const BLOCKED_ERROR = 'Microphone access was blocked. You can keep typing instead.';

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
};

function getWebRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface SpeechInput {
  supported: boolean;
  listening: boolean;
  /** True while a recorded clip is being transcribed (native only). */
  processing: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

export function useSpeechInput(onTranscript: (text: string) => void): SpeechInput {
  const isWeb = Platform.OS === 'web';
  const webCtor = getWebRecognitionCtor();
  // Native always supports recording (permission is requested on first use);
  // web depends on the browser's Web Speech API.
  const supported = isWeb ? webCtor !== null : true;

  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const transcribe = useTranscribeConciergeAudio();
  const transcribeRef = useRef(transcribe);
  transcribeRef.current = transcribe;
  const listeningRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      recognitionRef.current?.abort();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    };
  }, []);

  const finishNativeRecording = useCallback(
    async (deliver: boolean) => {
      clearTimer();
      listeningRef.current = false;
      setListening(false);
      try {
        await recorder.stop();
      } catch {
        // Recorder was not active — nothing to transcribe.
        return;
      }
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(
        () => {},
      );
      if (!deliver) return;
      const uri = recorder.uri;
      if (!uri) return;
      setProcessing(true);
      try {
        const audioBase64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (!audioBase64) return;
        const lower = uri.toLowerCase();
        const mimeType = lower.endsWith('.wav')
          ? 'audio/wav'
          : lower.endsWith('.3gp')
            ? 'audio/3gpp'
            : 'audio/m4a';
        const result = await transcribeRef.current.mutateAsync({
          data: { audioBase64, mimeType },
        });
        const text = result.text.trim();
        if (text) onTranscriptRef.current(text);
      } catch {
        setError(GENERIC_ERROR);
      } finally {
        setProcessing(false);
      }
    },
    [clearTimer, recorder],
  );

  const stop = useCallback(() => {
    if (isWeb) {
      clearTimer();
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    if (listeningRef.current) void finishNativeRecording(true);
  }, [isWeb, clearTimer, finishNativeRecording]);

  const startWeb = useCallback(() => {
    const Ctor = getWebRecognitionCtor();
    if (!Ctor) return;
    clearTimer();
    const recognition = new Ctor();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results as ArrayLike<any>)
        .map((r) => r[0]?.transcript ?? '')
        .join(' ')
        .trim();
      if (transcript) onTranscriptRef.current(transcript);
    };
    recognition.onerror = (event: any) => {
      setListening(false);
      if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
        setError(BLOCKED_ERROR);
      } else if (event?.error !== 'aborted' && event?.error !== 'no-speech') {
        setError(GENERIC_ERROR);
      }
    };
    recognition.onend = () => {
      clearTimer();
      setListening(false);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
      timeoutRef.current = setTimeout(() => {
        recognition.abort();
        setListening(false);
      }, LISTEN_TIMEOUT_MS);
    } catch {
      setListening(false);
      setError(GENERIC_ERROR);
    }
  }, [clearTimer]);

  const startNative = useCallback(async () => {
    if (listeningRef.current || processing) return;
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError(BLOCKED_ERROR);
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      listeningRef.current = true;
      setListening(true);
      clearTimer();
      // Safety net: auto-finish (and transcribe) after 20 seconds.
      timeoutRef.current = setTimeout(() => {
        if (listeningRef.current) void finishNativeRecording(true);
      }, LISTEN_TIMEOUT_MS);
    } catch {
      listeningRef.current = false;
      setListening(false);
      setError(GENERIC_ERROR);
    }
  }, [processing, recorder, clearTimer, finishNativeRecording]);

  const start = useCallback(() => {
    setError(null);
    if (isWeb) startWeb();
    else void startNative();
  }, [isWeb, startWeb, startNative]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return { supported, listening, processing, error, start, stop, toggle };
}

export interface SpeechOutput {
  supported: boolean;
  enabled: boolean;
  setEnabled: (next: boolean) => void;
  speak: (texts: string[], onDone?: () => void) => void;
}

export function useSpeechOutput(): SpeechOutput {
  const [enabled, setEnabled] = useState(false);
  const enabledRef = useRef(false);

  useEffect(() => {
    return () => {
      Speech.stop();
    };
  }, []);

  const setEnabledSafe = useCallback((next: boolean) => {
    enabledRef.current = next;
    setEnabled(next);
    if (!next) Speech.stop();
  }, []);

  const speak = useCallback((texts: string[], onDone?: () => void) => {
    if (!enabledRef.current) return;
    Speech.stop();
    // Strip bullets/emoji-ish markers that read poorly aloud.
    const clean = texts.map((t) => t.replace(/[•⚠️]/g, '').trim()).filter(Boolean);
    if (clean.length === 0) {
      onDone?.();
      return;
    }
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      onDone?.();
    };
    clean.forEach((text, i) => {
      const isLast = i === clean.length - 1;
      Speech.speak(text, {
        rate: 1,
        ...(isLast && onDone ? { onDone: fire, onError: fire, onStopped: fire } : {}),
      });
    });
  }, []);

  // expo-speech is available on iOS/Android; on web it uses speechSynthesis.
  const supported =
    Platform.OS !== 'web' ||
    (typeof window !== 'undefined' && 'speechSynthesis' in window);

  return { supported, enabled, setEnabled: setEnabledSafe, speak };
}
