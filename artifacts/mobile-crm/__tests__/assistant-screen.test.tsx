/**
 * Guards the mobile AI Business Analyst screen:
 * - Empty state renders all 6 starter suggestion chips
 * - "New Chat" button only appears once a conversation has started
 * - Tapping "New Chat" mid-stream aborts the in-flight request and returns to
 *   empty state without crashing (regression for mid-stream state clear)
 * - Network errors surface a friendly message rather than crashing
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#F7F8FB',
    foreground: '#0B1B33',
    primary: '#0033A0',
    primaryForeground: '#FFFFFF',
    card: '#FFFFFF',
    border: '#DFE4EE',
    muted: '#EEF1F7',
    mutedForeground: '#5B6B84',
    accent: '#E3EAFB',
    accentForeground: '#0033A0',
    destructive: '#DC2626',
    radius: 10,
  }),
}));

vi.mock('@/constants/colors', () => ({
  default: { light: {}, radius: 10 },
}));

import AssistantScreen from '@/app/(tabs)/assistant';

// ─── SSE helpers ──────────────────────────────────────────────────────────────

/** Build a Response whose body is a minimal SSE stream containing the given
 *  events (each is JSON-stringified) followed by a `done` event. */
function sseResponse(events: unknown[]): Response {
  const encoder = new TextEncoder();
  const chunks = [
    ...events.map((e) => encoder.encode(`data: ${JSON.stringify(e)}\n\n`)),
    encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`),
  ];
  let i = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]);
      } else {
        controller.close();
      }
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/** Build a Response whose body is a ReadableStream that never resolves (useful
 *  for simulating a request that is in-flight when the user taps "New Chat"). */
function neverResolvingResponse(): Response {
  const body = new ReadableStream({ start() {} }); // never enqueues or closes
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AssistantScreen', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows all 6 starter suggestion chips in the empty state', () => {
    render(<AssistantScreen />);
    expect(screen.getByText(/close rate this quarter/i)).toBeTruthy();
    expect(screen.getByText(/working in lead conversion/i)).toBeTruthy();
    expect(screen.getByText(/missed opportunities/i)).toBeTruthy();
    expect(screen.getByText(/overloaded on the team/i)).toBeTruthy();
    expect(screen.getByText(/appointments looking this month/i)).toBeTruthy();
    expect(screen.getByText(/revenue pipeline summary/i)).toBeTruthy();
  });

  it('does not show "New Chat" in the empty state', () => {
    render(<AssistantScreen />);
    expect(screen.queryByLabelText(/new chat/i)).toBeNull();
  });

  it('shows "New Chat" after a message is sent and response streams in', async () => {
    vi.mocked(fetch).mockResolvedValue(
      sseResponse([{ content: 'Here is the pipeline summary.' }]),
    );

    render(<AssistantScreen />);
    fireEvent.click(screen.getByLabelText(/close rate this quarter/i));

    await waitFor(() =>
      expect(screen.getByText(/here is the pipeline summary/i)).toBeTruthy(),
    );
    expect(screen.getByLabelText(/new chat/i)).toBeTruthy();
  });

  it('tapping "New Chat" mid-stream aborts the request and returns to empty state without crashing', async () => {
    // The fetch never delivers any SSE chunks — simulates a request in-flight.
    vi.mocked(fetch).mockResolvedValue(neverResolvingResponse());

    render(<AssistantScreen />);

    // Kick off a message; the screen enters "generating" mode.
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/close rate this quarter/i));
    });

    // "New Chat" button is now visible (a message was added to the list).
    const newChatBtn = await screen.findByLabelText(/new chat/i);

    // Click "New Chat" while the SSE stream is still in-flight.
    // This must not throw — previously the state updaters would crash trying
    // to read `.content` off `undefined` when the message list was cleared.
    await act(async () => {
      fireEvent.click(newChatBtn);
    });

    // The screen should return to the empty state.
    expect(screen.getByText(/close rate this quarter/i)).toBeTruthy();
    expect(screen.queryByLabelText(/new chat/i)).toBeNull();
  });

  it('surfaces a friendly error when the network fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    render(<AssistantScreen />);
    fireEvent.click(screen.getByLabelText(/close rate this quarter/i));

    await waitFor(() =>
      expect(screen.getByText(/a network error occurred/i)).toBeTruthy(),
    );
  });

  it('surfaces a session-expired message on 401', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    );

    render(<AssistantScreen />);
    fireEvent.click(screen.getByLabelText(/revenue pipeline summary/i));

    await waitFor(() =>
      expect(screen.getByText(/session has expired/i)).toBeTruthy(),
    );
  });

  it('surfaces a not-configured message on 503', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not configured' }), { status: 503 }),
    );

    render(<AssistantScreen />);
    fireEvent.click(screen.getByLabelText(/revenue pipeline summary/i));

    await waitFor(() =>
      expect(screen.getByText(/not configured on this server/i)).toBeTruthy(),
    );
  });

  it('tool-activity badge shows "1 data source" when one tool is used', async () => {
    vi.mocked(fetch).mockResolvedValue(
      sseResponse([
        { tool: 'get_pipeline_snapshot' },
        { content: 'Pipeline looks healthy.' },
      ]),
    );

    render(<AssistantScreen />);
    fireEvent.click(screen.getByLabelText(/close rate this quarter/i));

    await waitFor(() =>
      expect(screen.getByText(/pipeline looks healthy/i)).toBeTruthy(),
    );
    expect(screen.getByText(/analyzed 1 data source$/i)).toBeTruthy();
  });

  it('tool-activity badge shows plural "data sources" when multiple tools are used', async () => {
    vi.mocked(fetch).mockResolvedValue(
      sseResponse([
        { tool: 'get_pipeline_snapshot' },
        { tool: 'get_revenue_summary' },
        { content: 'Here is the combined summary.' },
      ]),
    );

    render(<AssistantScreen />);
    fireEvent.click(screen.getByLabelText(/revenue pipeline summary/i));

    await waitFor(() =>
      expect(screen.getByText(/here is the combined summary/i)).toBeTruthy(),
    );
    expect(screen.getByText(/analyzed 2 data sources$/i)).toBeTruthy();
  });
});
