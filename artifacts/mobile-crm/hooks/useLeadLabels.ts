import { useMemo } from 'react';
import { useListLeads } from '@workspace/api-client-react';

/**
 * Lead display labels for list screens: a map of lead id → contact name
 * (falling back to service type). Uses the `contactName` convenience field
 * on list responses, so no separate contacts download is needed.
 */
export function useLeadLabels() {
  const leads = useListLeads();
  const leadLabel = useMemo(() => {
    const labels = new Map<string, string>();
    for (const lead of leads.data ?? []) {
      labels.set(lead.id, lead.contactName || lead.serviceType || 'Unnamed lead');
    }
    return labels;
  }, [leads.data]);
  return { leads, leadLabel };
}
