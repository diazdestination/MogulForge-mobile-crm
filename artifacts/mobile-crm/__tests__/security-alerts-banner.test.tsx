/**
 * Guards the mobile brute-force security banner: it mirrors the Command
 * Center's semantics — recent (7-day) un-acknowledged
 * `api_key.brute_force_blocked` audit events surface an alert for admins,
 * and dismissing acknowledges up to the newest shown alert via
 * PUT /v1/settings { securityAlertsAcknowledgedAt }.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@expo/vector-icons', () => ({
  Feather: () => null,
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const queryResult = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  isRefetching: false,
  refetch: vi.fn(),
});

const useGetMe = vi.fn();
const useGetSettings = vi.fn();
const useListAuditEvents = vi.fn();
const updateMutate = vi.fn();

vi.mock('@workspace/api-client-react', () => ({
  getGetSettingsQueryKey: () => ['settings'],
  getListAuditEventsQueryKey: (params?: unknown) => ['audit-events', params],
  useGetMe: (...args: unknown[]) => useGetMe(...args),
  useGetSettings: (...args: unknown[]) => useGetSettings(...args),
  useListAuditEvents: (...args: unknown[]) => useListAuditEvents(...args),
  useUpdateSettings: () => ({ mutate: updateMutate, isPending: false }),
}));

import { SecurityAlertsBanner, recentBruteForceEvents } from '@/components/SecurityAlertsBanner';

const DAY_MS = 24 * 60 * 60 * 1000;

const event = (overrides: Record<string, unknown> = {}) => ({
  id: 'evt-1',
  action: 'api_key.brute_force_blocked',
  metadata: { ip: '203.0.113.9' },
  createdAt: new Date(Date.now() - DAY_MS).toISOString(),
  ...overrides,
});

beforeEach(() => {
  useGetMe.mockReturnValue(queryResult({ id: 'u1', role: 'admin' }));
  useGetSettings.mockReturnValue(queryResult({ securityAlertsAcknowledgedAt: null }));
  useListAuditEvents.mockReturnValue(queryResult([event()]));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('recentBruteForceEvents', () => {
  it('keeps only brute-force events inside the 7-day window and newer than the ack', () => {
    const fresh = event({ id: 'fresh' });
    const stale = event({ id: 'stale', createdAt: new Date(Date.now() - 8 * DAY_MS).toISOString() });
    const other = event({ id: 'other', action: 'api_key.created' });
    const acked = event({ id: 'acked', createdAt: new Date(Date.now() - 3 * DAY_MS).toISOString() });
    const ack = new Date(Date.now() - 2 * DAY_MS).toISOString();
    const result = recentBruteForceEvents([fresh, stale, other, acked] as never, ack);
    expect(result.map((e) => e.id)).toEqual(['fresh']);
  });

  it('returns everything recent when no acknowledgement exists', () => {
    expect(recentBruteForceEvents([event()] as never, null)).toHaveLength(1);
  });
});

describe('SecurityAlertsBanner', () => {
  it('shows the alert with the blocked IP for admins', () => {
    render(<SecurityAlertsBanner />);
    expect(screen.getByTestId('alert-brute-force')).toBeTruthy();
    expect(screen.getByTestId('alert-brute-force-evt-1').textContent).toContain('203.0.113.9');
  });

  it('renders nothing for non-admin users', () => {
    useGetMe.mockReturnValue(queryResult({ id: 'u2', role: 'sales_rep' }));
    render(<SecurityAlertsBanner />);
    expect(screen.queryByTestId('alert-brute-force')).toBeNull();
  });

  it('renders nothing when all events are acknowledged', () => {
    useGetSettings.mockReturnValue(
      queryResult({ securityAlertsAcknowledgedAt: new Date().toISOString() }),
    );
    render(<SecurityAlertsBanner />);
    expect(screen.queryByTestId('alert-brute-force')).toBeNull();
  });

  it('dismisses by acknowledging up to the newest shown alert timestamp', () => {
    const older = event({ id: 'older', createdAt: new Date(Date.now() - 2 * DAY_MS).toISOString() });
    const newest = event({ id: 'newest', createdAt: new Date(Date.now() - DAY_MS).toISOString() });
    useListAuditEvents.mockReturnValue(queryResult([older, newest]));
    render(<SecurityAlertsBanner />);
    fireEvent.click(screen.getByTestId('button-dismiss-brute-force-alert'));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    const payload = updateMutate.mock.calls[0][0] as {
      data: { securityAlertsAcknowledgedAt: string };
    };
    expect(payload.data.securityAlertsAcknowledgedAt).toBe(
      new Date(new Date(newest.createdAt as string).getTime()).toISOString(),
    );
  });
});
