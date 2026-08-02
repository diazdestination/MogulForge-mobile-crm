import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { UserRole } from '@workspace/api-client-react';
import { useOwnerFilter } from '@/hooks/useOwnerFilter';

afterEach(() => cleanup());

describe('useOwnerFilter', () => {
  it('starts as "all" while the role is unknown', () => {
    const { result } = renderHook(() => useOwnerFilter(undefined));
    expect(result.current.ownerFilter).toBe('all');
  });

  for (const role of ['sales_rep', 'inspector'] as UserRole[]) {
    it(`defaults to "mine" once a ${role} role loads`, () => {
      const { result, rerender } = renderHook(
        ({ r }: { r: UserRole | undefined }) => useOwnerFilter(r),
        { initialProps: { r: undefined as UserRole | undefined } },
      );
      expect(result.current.ownerFilter).toBe('all');
      rerender({ r: role });
      expect(result.current.ownerFilter).toBe('mine');
    });
  }

  for (const role of ['admin', 'sales_manager', 'office', 'viewer'] as UserRole[]) {
    it(`stays "all" for ${role} role`, () => {
      const { result, rerender } = renderHook(
        ({ r }: { r: UserRole | undefined }) => useOwnerFilter(r),
        { initialProps: { r: undefined as UserRole | undefined } },
      );
      rerender({ r: role });
      expect(result.current.ownerFilter).toBe('all');
    });
  }

  it('applies the role default only once, even if the role changes later', () => {
    const { result, rerender } = renderHook(
      ({ r }: { r: UserRole | undefined }) => useOwnerFilter(r),
      { initialProps: { r: 'admin' as UserRole | undefined } },
    );
    expect(result.current.ownerFilter).toBe('all');
    // Role changing to a field role after the default was applied must not flip it.
    rerender({ r: 'sales_rep' });
    expect(result.current.ownerFilter).toBe('all');
  });

  it('never overrides a manual choice with a late-loading role', () => {
    const { result, rerender } = renderHook(
      ({ r }: { r: UserRole | undefined }) => useOwnerFilter(r),
      { initialProps: { r: undefined as UserRole | undefined } },
    );
    act(() => result.current.setOwnerFilter('all'));
    rerender({ r: 'sales_rep' });
    expect(result.current.ownerFilter).toBe('all');
  });

  it('keeps a manual "mine" choice after choosing, then allows toggling back', () => {
    const { result, rerender } = renderHook(
      ({ r }: { r: UserRole | undefined }) => useOwnerFilter(r),
      { initialProps: { r: undefined as UserRole | undefined } },
    );
    act(() => result.current.setOwnerFilter('mine'));
    expect(result.current.ownerFilter).toBe('mine');
    rerender({ r: 'admin' });
    expect(result.current.ownerFilter).toBe('mine');
    act(() => result.current.setOwnerFilter('all'));
    expect(result.current.ownerFilter).toBe('all');
  });
});
