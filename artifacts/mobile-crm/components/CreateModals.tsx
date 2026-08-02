import React, { useEffect, useMemo, useState } from 'react';

// @react-native-community/datetimepicker requires a custom dev build and is
// NOT available in Expo Go. Attempt to load it and fall back to a plain
// TextInput so the app runs correctly in both Expo Go and production builds.
type DateTimePickerEvent = { type: string };
type DateTimePickerComponent = React.ComponentType<{
  value: Date;
  mode: 'date' | 'time' | 'datetime';
  display?: string;
  minuteInterval?: number;
  minimumDate?: Date;
  onChange: (event: DateTimePickerEvent, date?: Date) => void;
}>;
let DateTimePicker: DateTimePickerComponent | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DateTimePicker = (require('@react-native-community/datetimepicker') as { default: DateTimePickerComponent }).default;
} catch {
  // Expo Go fallback: native module unavailable; ExactDateTimePicker will
  // degrade to a manual TextInput entry.
}
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import {
  useCreateAppointment,
  useCreateTask,
  useGetInspectionAvailability,
  useListAppointments,
  useListLeads,
  useUpdateAppointment,
  type Appointment,
  type AppointmentType,
  type Urgency,
} from '@workspace/api-client-react';
import { getInspectionAvailabilityWarning } from '@workspace/inspection-availability';
import { getAppointmentOverlapWarning } from '@/lib/appointment-overlap';
import { useColors } from '@/hooks/useColors';
import { Chip } from '@/components/ui';
import { APPOINTMENT_TYPE_LABELS, URGENCY_LABELS } from '@/constants/crm';

const URGENCIES: Urgency[] = ['low', 'normal', 'high', 'emergency'];
const APPOINTMENT_TYPES: AppointmentType[] = [
  'inspection',
  'estimate_review',
  'production',
  'final_walkthrough',
  'other',
];

type DueOption = { label: string; days: number | null };
const DUE_OPTIONS: DueOption[] = [
  { label: 'No due date', days: null },
  { label: 'Today', days: 0 },
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'Next week', days: 7 },
];

const START_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const DURATIONS: { label: string; hours: number }[] = [
  { label: '1 hr', hours: 1 },
  { label: '2 hrs', hours: 2 },
  { label: 'Half day', hours: 4 },
];

function hourLabel(h: number): string {
  const suffix = h < 12 ? 'AM' : 'PM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${suffix}`;
}

function dayAt(daysFromNow: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function dayChipLabel(daysFromNow: number): string {
  if (daysFromNow === 0) return 'Today';
  if (daysFromNow === 1) return 'Tomorrow';
  const d = dayAt(daysFromNow, 12);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatExact(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Expo Go fallback for ExactDateTimePicker.
 * @react-native-community/datetimepicker is not bundled in Expo Go, so when
 * the require() fails we render a plain TextInput that accepts
 * "YYYY-MM-DDTHH:MM" so the form stays usable without crashing.
 */
function ExactDateTimePickerFallback({
  value,
  onChange,
  testID,
}: {
  value: Date | null;
  onChange: (d: Date) => void;
  testID: string;
}) {
  const c = useColors();
  const [rawText, setRawText] = useState(value ? toLocalInputValue(value) : '');

  // Keep the text in sync when the parent resets or changes value externally
  // (e.g. modal reopen clears value to null, chip selection changes it).
  useEffect(() => {
    setRawText(value ? toLocalInputValue(value) : '');
  }, [value]);

  const commit = (text: string) => {
    const d = new Date(text);
    if (!isNaN(d.getTime())) onChange(d);
  };

  return (
    <View style={{ gap: 4 }}>
      <TextInput
        testID={testID}
        value={rawText}
        onChangeText={(t) => {
          setRawText(t);
          commit(t);
        }}
        onBlur={() => commit(rawText)}
        placeholder="YYYY-MM-DDTHH:MM"
        placeholderTextColor={c.mutedForeground}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { color: c.foreground, borderColor: c.input, backgroundColor: c.background }]}
      />
      <Text style={{ color: c.mutedForeground, fontSize: 12, fontFamily: 'Inter_400Regular' }}>
        Native date picker unavailable in Expo Go — enter date manually.
      </Text>
    </View>
  );
}

/**
 * Cross-platform exact date/time picker.
 * - Web: native <input type="datetime-local">
 * - iOS: inline datetime picker shown when the field is opened
 * - Android: sequential date dialog then time dialog
 */
function ExactDateTimePicker({
  value,
  onChange,
  testID,
  minimumDate,
}: {
  value: Date | null;
  onChange: (d: Date) => void;
  testID: string;
  /** Earliest selectable date, where the platform picker supports it. */
  minimumDate?: Date;
}) {
  const c = useColors();
  const [show, setShow] = useState(false);
  const [androidStep, setAndroidStep] = useState<'date' | 'time'>('date');
  const [pendingDate, setPendingDate] = useState<Date | null>(null);
  const base = value ?? dayAt(1, 9);

  if (Platform.OS === 'web') {
    return React.createElement('input', {
      'data-testid': testID,
      type: 'datetime-local',
      ...(minimumDate ? { min: toLocalInputValue(minimumDate) } : {}),
      value: value ? toLocalInputValue(value) : '',
      onChange: (e: { target: { value: string } }) => {
        if (e.target.value) onChange(new Date(e.target.value));
      },
      style: {
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: c.input,
        backgroundColor: c.background,
        color: c.foreground,
        borderRadius: 10,
        padding: '10px 12px',
        fontSize: 15,
        fontFamily: 'Inter_400Regular, sans-serif',
      },
    });
  }

  const openPicker = () => {
    haptic();
    setAndroidStep('date');
    setPendingDate(null);
    setShow(true);
  };

  const onNativeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (event.type === 'dismissed' || !selected) {
      setShow(false);
      setPendingDate(null);
      return;
    }
    if (Platform.OS === 'android') {
      if (androidStep === 'date') {
        setPendingDate(selected);
        setAndroidStep('time');
      } else {
        const d = new Date(pendingDate ?? base);
        d.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
        setShow(false);
        setPendingDate(null);
        onChange(d);
      }
    } else {
      onChange(selected);
    }
  };

  // Expo Go: DateTimePicker failed to load — render the text-input fallback.
  if (DateTimePicker === null) {
    return (
      <ExactDateTimePickerFallback
        value={value}
        onChange={onChange}
        testID={testID}
      />
    );
  }

  return (
    <View style={{ gap: 6 }}>
      <Pressable
        testID={testID}
        onPress={openPicker}
        style={({ pressed }) => [
          styles.pickerField,
          { borderColor: c.input, backgroundColor: c.background },
          pressed && { opacity: 0.8 },
        ]}
      >
        <Feather name="calendar" size={16} color={c.mutedForeground} />
        <Text style={{ color: value ? c.foreground : c.mutedForeground, fontSize: 15, fontFamily: 'Inter_400Regular' }}>
          {value ? formatExact(value) : 'Pick exact date & time'}
        </Text>
      </Pressable>
      {show && Platform.OS === 'ios' ? (
        <View>
          <DateTimePicker
            value={base}
            mode="datetime"
            display="spinner"
            minuteInterval={5}
            minimumDate={minimumDate}
            onChange={onNativeChange}
          />
          <Pressable
            testID={`${testID}-done`}
            onPress={() => setShow(false)}
            style={[styles.pickerDone, { backgroundColor: c.muted }]}
          >
            <Text style={{ color: c.foreground, fontSize: 14, fontFamily: 'Inter_600SemiBold' }}>Done</Text>
          </Pressable>
        </View>
      ) : null}
      {show && Platform.OS === 'android' ? (
        <DateTimePicker
          value={androidStep === 'time' ? (pendingDate ?? base) : base}
          mode={androidStep}
          display="default"
          minimumDate={androidStep === 'date' ? minimumDate : undefined}
          onChange={onNativeChange}
        />
      ) : null}
    </View>
  );
}

function haptic() {
  if (Platform.OS !== 'web') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

function SheetShell({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.card, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, { color: c.foreground }]}>{title}</Text>
          <Pressable testID="create-sheet-close" onPress={onClose} hitSlop={8}>
            <Feather name="x" size={20} color={c.mutedForeground} />
          </Pressable>
        </View>
        <ScrollView
          style={{ maxHeight: 520 }}
          contentContainerStyle={{ gap: 14 }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

function FieldLabel({ children }: { children: string }) {
  const c = useColors();
  return <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>{children}</Text>;
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {children}
    </ScrollView>
  );
}

function SubmitButton({
  label,
  disabled,
  pending,
  onPress,
  testID,
}: {
  label: string;
  disabled: boolean;
  pending: boolean;
  onPress: () => void;
  testID: string;
}) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || pending}
      style={({ pressed }) => [
        styles.submitBtn,
        { backgroundColor: disabled ? c.muted : c.primary },
        pressed && { opacity: 0.85 },
      ]}
    >
      {pending ? (
        <ActivityIndicator size="small" color={c.primaryForeground} />
      ) : (
        <Text
          style={{
            color: disabled ? c.mutedForeground : c.primaryForeground,
            fontSize: 15,
            fontFamily: 'Inter_600SemiBold',
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function CreateTaskModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useColors();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Urgency>('normal');
  const [dueDays, setDueDays] = useState<number | null>(null);
  const [dueExact, setDueExact] = useState<Date | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createTask = useCreateTask({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries();
        setTitle('');
        setPriority('normal');
        setDueDays(null);
        setDueExact(null);
        setLeadId(null);
        setError(null);
        onClose();
      },
      onError: () => setError('Could not create the task. Please try again.'),
    },
  });

  const submit = () => {
    if (!title.trim()) return;
    haptic();
    setError(null);
    const dueAt = dueExact ?? (dueDays !== null ? dayAt(dueDays, 17) : null);
    createTask.mutate({
      data: {
        title: title.trim(),
        priority,
        ...(dueAt ? { dueAt: dueAt.toISOString() } : {}),
        ...(leadId ? { leadId } : {}),
      },
    });
  };

  return (
    <SheetShell visible={visible} title="New Task" onClose={onClose}>
      <View style={{ gap: 6 }}>
        <FieldLabel>TITLE</FieldLabel>
        <TextInput
          testID="task-title-input"
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Call homeowner about estimate"
          placeholderTextColor={c.mutedForeground}
          style={[styles.input, { color: c.foreground, borderColor: c.input, backgroundColor: c.background }]}
        />
      </View>
      <View style={{ gap: 6 }}>
        <FieldLabel>PRIORITY</FieldLabel>
        <ChipRow>
          {URGENCIES.map((u) => (
            <Chip key={u} label={URGENCY_LABELS[u]} active={priority === u} onPress={() => setPriority(u)} />
          ))}
        </ChipRow>
      </View>
      <View style={{ gap: 6 }}>
        <FieldLabel>DUE DATE</FieldLabel>
        <ChipRow>
          {DUE_OPTIONS.map((opt) => (
            <Chip
              key={opt.label}
              label={opt.label}
              active={dueExact === null && dueDays === opt.days}
              onPress={() => {
                setDueExact(null);
                setDueDays(opt.days);
              }}
            />
          ))}
        </ChipRow>
        <ExactDateTimePicker
          testID="task-due-picker"
          value={dueExact}
          onChange={(d) => {
            setDueExact(d);
            setDueDays(null);
          }}
        />
      </View>
      <LeadPicker leadId={leadId} onSelect={setLeadId} searchTestID="task-lead-search" />
      {error ? <Text style={[styles.errorText, { color: c.destructive }]}>{error}</Text> : null}
      <SubmitButton
        testID="task-create-submit"
        label="Create Task"
        disabled={!title.trim()}
        pending={createTask.isPending}
        onPress={submit}
      />
    </SheetShell>
  );
}

export function CreateAppointmentModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const c = useColors();
  const queryClient = useQueryClient();
  const [type, setType] = useState<AppointmentType>('inspection');
  const [day, setDay] = useState(0);
  const [startHour, setStartHour] = useState(9);
  const [startExact, setStartExact] = useState<Date | null>(null);
  const [duration, setDuration] = useState(1);
  const [customMinutes, setCustomMinutes] = useState('');
  const [endExact, setEndExact] = useState<Date | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createAppointment = useCreateAppointment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries();
        setType('inspection');
        setDay(0);
        setStartHour(9);
        setStartExact(null);
        setDuration(1);
        setCustomMinutes('');
        setEndExact(null);
        setLeadId(null);
        setError(null);
        onClose();
      },
      onError: () => setError('Could not create the appointment. Please try again.'),
    },
  });

  const dayOptions = useMemo(() => [0, 1, 2, 3, 4, 5, 6], []);

  // Same availability source admins configure for concierge chat bookings —
  // warn (without blocking) when a manual inspection falls outside it.
  const { data: availability } = useGetInspectionAvailability();
  const plannedStart = startExact ?? dayAt(day, startHour);
  // Re-evaluate "is this in the past?" every 30s so a form left open
  // doesn't keep a stale verdict.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [visible]);
  // Small grace so "starts right now" isn't rejected.
  const startIsInPast = plannedStart.getTime() < now - 60_000;
  const availabilityWarning =
    type === 'inspection' && availability
      ? getInspectionAvailabilityWarning(plannedStart, availability)
      : null;

  // Warn (without blocking) when the planned window collides with any
  // appointment already on the schedule, whatever its type.
  const existingAppointments = useListAppointments();

  // Duration resolution: exact end time wins, then a custom minutes entry,
  // then the selected preset chip.
  const parsedCustomMinutes = useMemo(() => {
    const trimmed = customMinutes.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return NaN;
    return n;
  }, [customMinutes]);

  const plannedEnd = useMemo(() => {
    if (endExact) return endExact;
    if (parsedCustomMinutes !== null) {
      if (Number.isNaN(parsedCustomMinutes)) return null;
      return new Date(plannedStart.getTime() + parsedCustomMinutes * 60 * 1000);
    }
    return new Date(plannedStart.getTime() + duration * 60 * 60 * 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endExact, parsedCustomMinutes, duration, plannedStart.getTime()]);

  const durationError =
    parsedCustomMinutes !== null && Number.isNaN(parsedCustomMinutes) && !endExact
      ? 'Enter the duration as a whole number of minutes.'
      : endExact && plannedEnd && plannedEnd.getTime() <= plannedStart.getTime()
        ? 'End time must be after the start time.'
        : null;

  const overlapWarning = useMemo(
    () =>
      getAppointmentOverlapWarning(
        plannedStart,
        durationError ? null : plannedEnd,
        existingAppointments.data,
        (t) => APPOINTMENT_TYPE_LABELS[t],
        (appt) => appt.leadLabel ?? undefined,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plannedStart.getTime(), plannedEnd?.getTime(), durationError, existingAppointments.data],
  );

  const submit = () => {
    haptic();
    setError(null);
    if (plannedStart.getTime() < Date.now() - 60_000) {
      setError('That start time has already passed. Pick a time in the future.');
      return;
    }
    if (!plannedEnd || durationError) return;
    createAppointment.mutate({
      data: {
        type,
        scheduledStart: plannedStart.toISOString(),
        scheduledEnd: plannedEnd.toISOString(),
        ...(leadId ? { leadId } : {}),
      },
    });
  };

  return (
    <SheetShell visible={visible} title="New Appointment" onClose={onClose}>
      <View style={{ gap: 6 }}>
        <FieldLabel>TYPE</FieldLabel>
        <ChipRow>
          {APPOINTMENT_TYPES.map((t) => (
            <Chip
              key={t}
              label={APPOINTMENT_TYPE_LABELS[t]}
              active={type === t}
              onPress={() => setType(t)}
            />
          ))}
        </ChipRow>
      </View>
      <View style={{ gap: 6 }}>
        <FieldLabel>DAY</FieldLabel>
        <ChipRow>
          {dayOptions.map((d) => (
            <Chip
              key={d}
              label={dayChipLabel(d)}
              active={startExact === null && day === d}
              onPress={() => {
                setStartExact(null);
                setDay(d);
              }}
            />
          ))}
        </ChipRow>
      </View>
      <View style={{ gap: 6 }}>
        <FieldLabel>START TIME</FieldLabel>
        <ChipRow>
          {START_HOURS.map((h) => (
            <Chip
              key={h}
              label={hourLabel(h)}
              active={startExact === null && startHour === h}
              onPress={() => {
                setStartExact(null);
                setStartHour(h);
              }}
            />
          ))}
        </ChipRow>
        <ExactDateTimePicker
          testID="appt-start-picker"
          value={startExact}
          onChange={setStartExact}
          minimumDate={new Date()}
        />
      </View>
      <View style={{ gap: 6 }}>
        <FieldLabel>DURATION</FieldLabel>
        <ChipRow>
          {DURATIONS.map((d) => (
            <Chip
              key={d.hours}
              label={d.label}
              active={!endExact && !customMinutes.trim() && duration === d.hours}
              onPress={() => {
                setDuration(d.hours);
                setCustomMinutes('');
                setEndExact(null);
              }}
            />
          ))}
        </ChipRow>
        <TextInput
          testID="appt-custom-duration-input"
          value={customMinutes}
          onChangeText={(v) => {
            setCustomMinutes(v);
            if (v.trim()) setEndExact(null);
          }}
          placeholder="Custom duration in minutes (e.g. 90)"
          placeholderTextColor={c.mutedForeground}
          keyboardType="number-pad"
          style={[styles.input, { color: c.foreground, borderColor: c.input, backgroundColor: c.background }]}
        />
        <ExactDateTimePicker
          testID="appt-end-picker"
          value={endExact}
          onChange={(d) => {
            setEndExact(d);
            setCustomMinutes('');
          }}
        />
        {durationError ? (
          <Text testID="appt-duration-error" style={[styles.errorText, { color: c.destructive }]}>
            {durationError}
          </Text>
        ) : null}
      </View>
      <LeadPicker leadId={leadId} onSelect={setLeadId} searchTestID="appt-lead-search" />
      {startIsInPast ? (
        <View
          testID="appt-past-warning"
          style={[
            styles.warningBox,
            { borderColor: 'rgba(220, 38, 38, 0.4)', backgroundColor: 'rgba(220, 38, 38, 0.08)' },
          ]}
        >
          <Feather name="alert-triangle" size={16} color={c.destructive} style={{ marginTop: 1 }} />
          <Text style={[styles.warningText, { color: c.destructive }]}>
            This start time is in the past. Pick a time in the future to create the appointment.
          </Text>
        </View>
      ) : null}
      {availabilityWarning ? (
        <View
          testID="appt-availability-warning"
          style={[
            styles.warningBox,
            { borderColor: 'rgba(217, 119, 6, 0.4)', backgroundColor: 'rgba(217, 119, 6, 0.1)' },
          ]}
        >
          <Feather name="alert-triangle" size={16} color="#B45309" style={{ marginTop: 1 }} />
          <Text style={[styles.warningText, { color: '#B45309' }]}>
            {availabilityWarning} You can still save it, but the crew may not be able to honor
            this slot.
          </Text>
        </View>
      ) : null}
      {overlapWarning ? (
        <View
          testID="appt-overlap-warning"
          style={[
            styles.warningBox,
            { borderColor: 'rgba(217, 119, 6, 0.4)', backgroundColor: 'rgba(217, 119, 6, 0.1)' },
          ]}
        >
          <Feather name="alert-triangle" size={16} color="#B45309" style={{ marginTop: 1 }} />
          <Text style={[styles.warningText, { color: '#B45309' }]}>
            {overlapWarning} You can still save it if the double-booking is intentional.
          </Text>
        </View>
      ) : null}
      {error ? <Text style={[styles.errorText, { color: c.destructive }]}>{error}</Text> : null}
      <SubmitButton
        testID="appt-create-submit"
        label="Create Appointment"
        disabled={startIsInPast || !plannedEnd || durationError !== null}
        pending={createAppointment.isPending}
        onPress={submit}
      />
    </SheetShell>
  );
}

/**
 * Reschedule an existing appointment from the mobile Schedule screen.
 * Mirrors the Command Center edit flow: changing an inspection's start time
 * shows the same non-blocking out-of-hours availability warning as creating one.
 */
export function RescheduleAppointmentModal({
  appointment,
  onClose,
}: {
  appointment: Appointment | null;
  onClose: () => void;
}) {
  const c = useColors();
  const queryClient = useQueryClient();
  const visible = appointment !== null;
  const [day, setDay] = useState(0);
  const [startHour, setStartHour] = useState(9);
  const [startExact, setStartExact] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset the picker each time a (new) appointment is opened.
  const apptId = appointment?.id ?? null;
  useEffect(() => {
    if (!apptId) return;
    setDay(0);
    setStartHour(9);
    setStartExact(null);
    setError(null);
  }, [apptId]);

  const updateAppointment = useUpdateAppointment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries();
        setError(null);
        onClose();
      },
      onError: () => setError('Could not reschedule the appointment. Please try again.'),
    },
  });

  const dayOptions = useMemo(() => [0, 1, 2, 3, 4, 5, 6], []);
  const plannedStart = startExact ?? dayAt(day, startHour);

  // Re-evaluate "is this in the past?" every 30s so a form left open
  // doesn't keep a stale verdict.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [visible]);
  const startIsInPast = plannedStart.getTime() < now - 60_000;

  // Same availability source admins configure for concierge chat bookings —
  // warn (without blocking) when a rescheduled inspection lands outside it.
  const { data: availability } = useGetInspectionAvailability();
  const availabilityWarning =
    appointment?.type === 'inspection' && availability
      ? getInspectionAvailabilityWarning(plannedStart, availability)
      : null;

  // Preserve the appointment's current duration when shifting the start.
  const plannedEnd = useMemo(() => {
    if (!appointment?.scheduledEnd) return null;
    const oldStart = new Date(appointment.scheduledStart).getTime();
    const oldEnd = new Date(appointment.scheduledEnd).getTime();
    if (Number.isNaN(oldStart) || Number.isNaN(oldEnd) || oldEnd <= oldStart) return null;
    return new Date(plannedStart.getTime() + (oldEnd - oldStart));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointment?.scheduledStart, appointment?.scheduledEnd, plannedStart.getTime()]);

  const submit = () => {
    if (!appointment) return;
    haptic();
    setError(null);
    if (plannedStart.getTime() < Date.now() - 60_000) {
      setError('That start time has already passed. Pick a time in the future.');
      return;
    }
    updateAppointment.mutate({
      id: appointment.id,
      data: {
        scheduledStart: plannedStart.toISOString(),
        ...(plannedEnd ? { scheduledEnd: plannedEnd.toISOString() } : {}),
      },
    });
  };

  return (
    <SheetShell visible={visible} title="Reschedule" onClose={onClose}>
      {appointment ? (
        <Text
          testID="appt-reschedule-current"
          style={{ color: c.mutedForeground, fontSize: 13, fontFamily: 'Inter_500Medium' }}
        >
          {APPOINTMENT_TYPE_LABELS[appointment.type]} · currently{' '}
          {formatExact(new Date(appointment.scheduledStart))}
        </Text>
      ) : null}
      <View style={{ gap: 6 }}>
        <FieldLabel>NEW DAY</FieldLabel>
        <ChipRow>
          {dayOptions.map((d) => (
            <Chip
              key={d}
              label={dayChipLabel(d)}
              active={startExact === null && day === d}
              onPress={() => {
                setStartExact(null);
                setDay(d);
              }}
            />
          ))}
        </ChipRow>
      </View>
      <View style={{ gap: 6 }}>
        <FieldLabel>NEW START TIME</FieldLabel>
        <ChipRow>
          {START_HOURS.map((h) => (
            <Chip
              key={h}
              label={hourLabel(h)}
              active={startExact === null && startHour === h}
              onPress={() => {
                setStartExact(null);
                setStartHour(h);
              }}
            />
          ))}
        </ChipRow>
        <ExactDateTimePicker
          testID="appt-reschedule-start-picker"
          value={startExact}
          onChange={setStartExact}
          minimumDate={new Date()}
        />
      </View>
      {startIsInPast ? (
        <View
          testID="appt-reschedule-past-warning"
          style={[
            styles.warningBox,
            { borderColor: 'rgba(220, 38, 38, 0.4)', backgroundColor: 'rgba(220, 38, 38, 0.08)' },
          ]}
        >
          <Feather name="alert-triangle" size={16} color={c.destructive} style={{ marginTop: 1 }} />
          <Text style={[styles.warningText, { color: c.destructive }]}>
            This start time is in the past. Pick a time in the future to reschedule.
          </Text>
        </View>
      ) : null}
      {availabilityWarning ? (
        <View
          testID="appt-reschedule-availability-warning"
          style={[
            styles.warningBox,
            { borderColor: 'rgba(217, 119, 6, 0.4)', backgroundColor: 'rgba(217, 119, 6, 0.1)' },
          ]}
        >
          <Feather name="alert-triangle" size={16} color="#B45309" style={{ marginTop: 1 }} />
          <Text style={[styles.warningText, { color: '#B45309' }]}>
            {availabilityWarning} You can still save it, but the crew may not be able to honor
            this slot.
          </Text>
        </View>
      ) : null}
      {error ? <Text style={[styles.errorText, { color: c.destructive }]}>{error}</Text> : null}
      <SubmitButton
        testID="appt-reschedule-submit"
        label="Reschedule"
        disabled={startIsInPast}
        pending={updateAppointment.isPending}
        onPress={submit}
      />
    </SheetShell>
  );
}

export function AddButton({ onPress, testID }: { onPress: () => void; testID: string }) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.addBtn,
        { backgroundColor: c.primary },
        pressed && { opacity: 0.85 },
      ]}
    >
      <Feather name="plus" size={20} color={c.primaryForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sheetTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
  fieldLabel: {
    fontSize: 11,
    letterSpacing: 0.6,
    fontFamily: 'Inter_600SemiBold',
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 10,
    marginTop: 4,
  },
  errorText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  pickerField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pickerDone: {
    alignSelf: 'flex-end',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 4,
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const MAX_LEAD_OPTIONS = 30;

function LeadPicker({
  leadId,
  onSelect,
  searchTestID = 'lead-picker-search',
}: {
  leadId: string | null;
  onSelect: (id: string | null) => void;
  searchTestID?: string;
}) {
  const c = useColors();
  const [leadSearch, setLeadSearch] = useState('');
  // Remember the label of the selected lead so it stays visible
  // even when the current search results no longer include it.
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(leadSearch.trim(), 300);

  // Server-side search: ask for one more than we show so we know
  // whether there are more matches beyond the cap.
  const leads = useListLeads({
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    limit: MAX_LEAD_OPTIONS + 1,
  });

  const { visibleLeads, hasMore } = useMemo(() => {
    const rows = leads.data ?? [];
    const capped = rows.slice(0, MAX_LEAD_OPTIONS);
    return { visibleLeads: capped, hasMore: rows.length > MAX_LEAD_OPTIONS };
  }, [leads.data]);

  const labelFor = (lead: { contactName?: string | null; serviceType?: string | null }) =>
    lead.contactName || lead.serviceType || 'Unnamed lead';

  const selectedInResults = leadId !== null && visibleLeads.some((l) => l.id === leadId);

  return (
    <View style={{ gap: 6 }}>
      <FieldLabel>LINKED LEAD</FieldLabel>
      {leads.isLoading ? (
        <ActivityIndicator size="small" color={c.primary} />
      ) : (
        <View style={{ gap: 6 }}>
          <TextInput
            testID={searchTestID}
            value={leadSearch}
            onChangeText={setLeadSearch}
            placeholder="Search leads by name"
            placeholderTextColor={c.mutedForeground}
            autoCorrect={false}
            style={[styles.input, { color: c.foreground, borderColor: c.input, backgroundColor: c.background }]}
          />
          <Chip label="No lead" active={leadId === null} onPress={() => onSelect(null)} />
          {leadId && !selectedInResults ? (
            <Chip
              label={selectedLabel ?? 'Selected lead'}
              active
              onPress={() => {
                setSelectedLabel(null);
                onSelect(null);
              }}
            />
          ) : null}
          {visibleLeads.map((lead) => (
            <Chip
              key={lead.id}
              label={labelFor(lead)}
              active={leadId === lead.id}
              onPress={() => {
                setSelectedLabel(labelFor(lead));
                onSelect(lead.id);
              }}
            />
          ))}
          {leads.isFetching && !leads.isLoading ? (
            <ActivityIndicator size="small" color={c.mutedForeground} />
          ) : null}
          {hasMore ? (
            <Text style={{ color: c.mutedForeground, fontSize: 12, fontFamily: 'Inter_400Regular' }}>
              More matches — keep typing to narrow the list
            </Text>
          ) : null}
          {leadSearch.trim() && visibleLeads.length === 0 && !leads.isFetching ? (
            <Text style={{ color: c.mutedForeground, fontSize: 12, fontFamily: 'Inter_400Regular' }}>
              No leads match "{leadSearch.trim()}"
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}
