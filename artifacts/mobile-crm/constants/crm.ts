import type {
  AppointmentStatus,
  AppointmentType,
  LeadStatus,
  TaskStatus,
  Urgency,
} from '@workspace/api-client-react';

export const LEAD_STATUSES: LeadStatus[] = [
  'new',
  'ai_qualified',
  'contact_attempted',
  'inspection_scheduled',
  'inspection_completed',
  'estimate_preparing',
  'estimate_sent',
  'claim_pending',
  'follow_up',
  'won',
  'production_scheduled',
  'in_progress',
  'final_walkthrough',
  'completed',
  'review_requested',
  'nurture',
  'lost',
];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  ai_qualified: 'AI Qualified',
  contact_attempted: 'Contact Attempted',
  inspection_scheduled: 'Inspection Scheduled',
  inspection_completed: 'Inspection Completed',
  estimate_preparing: 'Estimate Preparing',
  estimate_sent: 'Estimate Sent',
  claim_pending: 'Claim Pending',
  follow_up: 'Follow Up',
  won: 'Won',
  production_scheduled: 'Production Scheduled',
  in_progress: 'In Progress',
  final_walkthrough: 'Final Walkthrough',
  completed: 'Completed',
  review_requested: 'Review Requested',
  nurture: 'Nurture',
  lost: 'Lost',
};

/** Muted badge tints per pipeline phase. */
export const LEAD_STATUS_COLORS: Record<LeadStatus, { bg: string; fg: string }> = {
  new: { bg: '#E3EAFB', fg: '#0033A0' },
  ai_qualified: { bg: '#E3EAFB', fg: '#0033A0' },
  contact_attempted: { bg: '#FEF3C7', fg: '#92400E' },
  inspection_scheduled: { bg: '#DBEAFE', fg: '#1D4ED8' },
  inspection_completed: { bg: '#DBEAFE', fg: '#1D4ED8' },
  estimate_preparing: { bg: '#EDE9FE', fg: '#6D28D9' },
  estimate_sent: { bg: '#EDE9FE', fg: '#6D28D9' },
  claim_pending: { bg: '#FEF3C7', fg: '#92400E' },
  follow_up: { bg: '#FEF3C7', fg: '#92400E' },
  won: { bg: '#DCFCE7', fg: '#15803D' },
  production_scheduled: { bg: '#DCFCE7', fg: '#15803D' },
  in_progress: { bg: '#DCFCE7', fg: '#15803D' },
  final_walkthrough: { bg: '#DCFCE7', fg: '#15803D' },
  completed: { bg: '#DCFCE7', fg: '#15803D' },
  review_requested: { bg: '#DCFCE7', fg: '#15803D' },
  nurture: { bg: '#EEF1F7', fg: '#5B6B84' },
  lost: { bg: '#FEE2E2', fg: '#B91C1C' },
};

export const URGENCY_LABELS: Record<Urgency, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  emergency: 'Emergency',
};

export const URGENCY_COLORS: Record<Urgency, { bg: string; fg: string }> = {
  low: { bg: '#EEF1F7', fg: '#5B6B84' },
  normal: { bg: '#E3EAFB', fg: '#0033A0' },
  high: { bg: '#FEF3C7', fg: '#92400E' },
  emergency: { bg: '#FEE2E2', fg: '#B91C1C' },
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  inspection: 'Inspection',
  estimate_review: 'Estimate Review',
  production: 'Production',
  final_walkthrough: 'Final Walkthrough',
  other: 'Other',
};

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No Show',
};

export const APPOINTMENT_STATUS_COLORS: Record<AppointmentStatus, { bg: string; fg: string }> = {
  scheduled: { bg: '#E3EAFB', fg: '#0033A0' },
  confirmed: { bg: '#DBEAFE', fg: '#1D4ED8' },
  completed: { bg: '#DCFCE7', fg: '#15803D' },
  cancelled: { bg: '#EEF1F7', fg: '#5B6B84' },
  no_show: { bg: '#FEE2E2', fg: '#B91C1C' },
};

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

export function memberName(member: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): string {
  const name = [member.firstName, member.lastName].filter(Boolean).join(' ');
  return name || member.email || 'Unknown member';
}
