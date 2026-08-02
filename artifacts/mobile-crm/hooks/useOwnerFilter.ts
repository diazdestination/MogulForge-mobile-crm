import { useEffect, useRef, useState } from 'react';
import type { UserRole } from '@workspace/api-client-react';

export type OwnerFilter = 'mine' | 'all';

const DEFAULT_MINE_ROLES: UserRole[] = ['sales_rep', 'inspector'];

/**
 * Mine/All ownership filter state. Defaults to "Mine" for field roles
 * (sales_rep, inspector) once the current member's role loads; "All" otherwise.
 * The role-based default is applied only once and never overrides a manual choice.
 */
export function useOwnerFilter(role: UserRole | undefined) {
  const [ownerFilter, setOwnerFilterState] = useState<OwnerFilter>('all');
  const userChose = useRef(false);
  const defaulted = useRef(false);

  useEffect(() => {
    if (!role || defaulted.current || userChose.current) return;
    defaulted.current = true;
    if (DEFAULT_MINE_ROLES.includes(role)) {
      setOwnerFilterState('mine');
    }
  }, [role]);

  const setOwnerFilter = (value: OwnerFilter) => {
    userChose.current = true;
    setOwnerFilterState(value);
  };

  return { ownerFilter, setOwnerFilter };
}
