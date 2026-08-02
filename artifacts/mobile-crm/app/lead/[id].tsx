import React, { useCallback, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import {
  getGetContactQueryKey,
  getGetLeadQueryKey,
  getGetPropertyQueryKey,
  getListLeadActivitiesQueryKey,
  useAttachLeadPhotos,
  useCreateLeadActivity,
  useDeleteLeadPhoto,
  useGetContact,
  useGetLead,
  useGetProperty,
  useListLeadActivities,
  useRequestLeadPhotoUploadUrl,
  useUpdateLead,
  type LeadStatus,
  type UploadUrlRequestContentType,
} from '@workspace/api-client-react';
import { Image } from 'expo-image';
import { useColors } from '@/hooks/useColors';
import colors from '@/constants/colors';
import { Badge, Card, ErrorState, LoadingView } from '@/components/ui';
import { PhotoViewer, useImageAuthHeaders } from '@/components/PhotoViewer';
import {
  LEAD_STATUSES,
  LEAD_STATUS_COLORS,
  LEAD_STATUS_LABELS,
  URGENCY_COLORS,
  URGENCY_LABELS,
  formatDateTime,
  timeAgo,
} from '@/constants/crm';

import { extractPhotoPaths, flattenPhotoPaths, photoUrl } from '@/lib/photos';

// Emerald treatment matching the Command Center's "Chat resumed" highlight.
const CHAT_RESUMED_BORDER = 'rgba(16, 185, 129, 0.4)';
const CHAT_RESUMED_BG = 'rgba(16, 185, 129, 0.06)';
const CHAT_RESUMED_BADGE_BG = 'rgba(16, 185, 129, 0.15)';
const CHAT_RESUMED_FG = '#059669';

// Amber treatment matching the Command Center's "Homeowner message" highlight.
const PORTAL_MESSAGE_BORDER = 'rgba(245, 158, 11, 0.4)';
const PORTAL_MESSAGE_BG = 'rgba(245, 158, 11, 0.06)';
const PORTAL_MESSAGE_BADGE_BG = 'rgba(245, 158, 11, 0.15)';
const PORTAL_MESSAGE_FG = '#b45309';

// ─── Photo upload types ────────────────────────────────────────────────────

type UploadStatus = 'uploading' | 'done' | 'error';

interface UploadEntry {
  id: string;
  name: string;
  status: UploadStatus;
  error?: string;
}

const ALLOWED_MIME_TYPES: UploadUrlRequestContentType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

function resolveContentType(mimeType: string | null | undefined): UploadUrlRequestContentType {
  if (mimeType && ALLOWED_MIME_TYPES.includes(mimeType as UploadUrlRequestContentType)) {
    return mimeType as UploadUrlRequestContentType;
  }
  return 'image/jpeg';
}

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [note, setNote] = useState('');
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const { headers: imageHeaders, ready: imageHeadersReady } = useImageAuthHeaders();

  // Photo upload state
  const [uploadQueue, setUploadQueue] = useState<UploadEntry[]>([]);
  const [photoPickerSheetOpen, setPhotoPickerSheetOpen] = useState(false);
  // Stable ref so async upload closures always see the latest setter.
  const setUploadQueueRef = useRef(setUploadQueue);
  setUploadQueueRef.current = setUploadQueue;
  // Prevents a thumbnail long-press from also firing onPress on finger-lift.
  const photoLongPressActive = useRef(false);

  const requestPhotoUrl = useRequestLeadPhotoUploadUrl();
  const attachPhotos = useAttachLeadPhotos();
  const deletePhoto = useDeleteLeadPhoto();

  const leadId = id ?? '';
  const lead = useGetLead(leadId, {
    query: { enabled: !!id, queryKey: getGetLeadQueryKey(leadId) },
  });
  const contactId = lead.data?.contactId ?? '';
  const contact = useGetContact(contactId, {
    query: { enabled: !!contactId, queryKey: getGetContactQueryKey(contactId) },
  });
  const propertyId = lead.data?.propertyId ?? '';
  const property = useGetProperty(propertyId, {
    query: { enabled: !!propertyId, queryKey: getGetPropertyQueryKey(propertyId) },
  });
  const activities = useListLeadActivities(leadId, {
    query: { enabled: !!id, queryKey: getListLeadActivitiesQueryKey(leadId) },
  });

  const updateLead = useUpdateLead({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries();
        setStatusPickerOpen(false);
      },
    },
  });
  const createActivity = useCreateLeadActivity({
    mutation: {
      onSuccess: () => {
        setNote('');
        queryClient.invalidateQueries();
      },
    },
  });

  if (lead.isLoading) return <LoadingView />;
  if (lead.isError || !lead.data) {
    return <ErrorState message="Could not load this lead." onRetry={() => lead.refetch()} />;
  }

  const data = lead.data;
  const contactFullName = contact.data
    ? [contact.data.firstName, contact.data.lastName].filter(Boolean).join(' ')
    : '…';

  const setStatus = (status: LeadStatus) => {
    if (status === data.status) {
      setStatusPickerOpen(false);
      return;
    }
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    updateLead.mutate({ id: data.id, data: { status } });
  };

  const submitNote = () => {
    const trimmed = note.trim();
    if (!trimmed || createActivity.isPending) return;
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    createActivity.mutate({
      id: data.id,
      data: { type: 'note', title: 'Field note', body: trimmed },
    });
  };

  const bottomInset = Platform.OS === 'web' ? 60 : insets.bottom + 24;

  // All photos across all activities, in timeline order, so the viewer can
  // swipe through every photo on the lead (mirrors the web lightbox).
  const allPhotoPaths = flattenPhotoPaths(activities.data ?? []);
  const allPhotos = allPhotoPaths.map((path) => ({ uri: photoUrl(path), objectPath: path }));

  const openPhoto = (path: string) => {
    const idx = allPhotoPaths.indexOf(path);
    if (idx >= 0) setViewerIndex(idx);
  };

  const confirmDeletePhoto = (path: string) => {
    Alert.alert(
      'Delete photo?',
      'This photo will be permanently removed from the lead.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deletePhoto.mutate(
              { id: leadId, data: { objectPath: path } },
              {
                onSuccess: () => {
                  queryClient.invalidateQueries({
                    queryKey: getListLeadActivitiesQueryKey(leadId),
                  });
                  queryClient.invalidateQueries({
                    queryKey: getGetLeadQueryKey(leadId),
                  });
                },
                onError: () => {
                  Alert.alert('Could not delete photo', 'Please try again.');
                },
              },
            );
          },
        },
      ],
    );
  };

  // ─── Photo upload handlers ────────────────────────────────────────────────

  const pickAndUpload = useCallback(
    async (assets: ImagePicker.ImagePickerAsset[]) => {
      if (!assets.length) return;

      const entries: UploadEntry[] = assets.map((a) => ({
        id: a.assetId ?? String(Math.random()),
        name: a.fileName ?? 'photo.jpg',
        status: 'uploading',
      }));
      setUploadQueueRef.current((prev) => [...prev, ...entries]);

      const successPaths: string[] = [];

      await Promise.all(
        assets.map(async (asset, i) => {
          const entryId = entries[i].id;
          const contentType = resolveContentType(asset.mimeType);
          const fileName = asset.fileName ?? `photo-${Date.now()}.jpg`;
          const fileSize = asset.fileSize ?? 0;

          const markEntry = (patch: Partial<UploadEntry>) =>
            setUploadQueueRef.current((prev) =>
              prev.map((e) => (e.id === entryId ? { ...e, ...patch } : e)),
            );

          try {
            const { uploadURL, objectPath } = await requestPhotoUrl.mutateAsync({
              id: leadId,
              data: { name: fileName, size: fileSize, contentType },
            });

            // Fetch the local file as a blob and PUT directly to the presigned URL.
            const fileResp = await fetch(asset.uri);
            const blob = await fileResp.blob();
            const putResp = await fetch(uploadURL, {
              method: 'PUT',
              body: blob,
              headers: { 'Content-Type': contentType },
            });
            if (!putResp.ok) throw new Error(`Storage upload failed (HTTP ${putResp.status})`);

            successPaths.push(objectPath);
            markEntry({ status: 'done' });
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Upload failed';
            markEntry({ status: 'error', error: msg });
          }
        }),
      );

      if (successPaths.length > 0) {
        try {
          await attachPhotos.mutateAsync({ id: leadId, data: { photoPaths: successPaths } });
          queryClient.invalidateQueries({ queryKey: getListLeadActivitiesQueryKey(leadId) });
        } catch {
          // Mark any 'done' entries that didn't make it to attach as error.
          setUploadQueueRef.current((prev) =>
            prev.map((e) =>
              e.status === 'done' ? { ...e, status: 'error', error: 'Failed to attach photos' } : e,
            ),
          );
          Alert.alert('Upload error', 'Photos uploaded but could not be attached. Please try again.');
        }
      }
    },
    [leadId, requestPhotoUrl, attachPhotos, queryClient],
  );

  const launchCamera = useCallback(async () => {
    const { granted, canAskAgain } = await ImagePicker.requestCameraPermissionsAsync();
    if (!granted) {
      Alert.alert(
        'Camera access needed',
        'Allow camera access to take photos for this lead.',
        canAskAgain
          ? undefined
          : [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ],
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: 'images',
      quality: 0.85,
      allowsEditing: false,
    });
    if (!result.canceled) await pickAndUpload(result.assets);
  }, [pickAndUpload]);

  const launchLibrary = useCallback(async () => {
    const { granted, canAskAgain } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!granted) {
      Alert.alert(
        'Photo library access needed',
        'Allow photo library access to upload photos for this lead.',
        canAskAgain
          ? undefined
          : [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ],
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsMultipleSelection: true,
      selectionLimit: 20,
      quality: 0.85,
    });
    if (!result.canceled) {
      let assets = result.assets;
      if (assets.length > 20) {
        assets = assets.slice(0, 20);
        Alert.alert('Too many photos', 'Only the first 20 photos can be uploaded at once.');
      }
      await pickAndUpload(assets);
    }
  }, [pickAndUpload]);

  const handleAddPhotos = useCallback(() => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Take Photo', 'Choose from Library'],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) void launchCamera();
          if (buttonIndex === 2) void launchLibrary();
        },
      );
    } else {
      setPhotoPickerSheetOpen(true);
    }
  }, [launchCamera, launchLibrary]);

  const isUploading = uploadQueue.some((e) => e.status === 'uploading');

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardAwareScrollViewCompat
        bottomOffset={80}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: bottomInset, gap: 14 }}
        refreshControl={
          <RefreshControl
            refreshing={lead.isRefetching}
            onRefresh={() => {
              lead.refetch();
              activities.refetch();
            }}
            tintColor={c.primary}
          />
        }
      >
        {/* Header */}
        <View style={{ gap: 8 }}>
          <Text style={[styles.name, { color: c.foreground }]}>{contactFullName}</Text>
          <View style={styles.badgeRow}>
            <Badge
              label={LEAD_STATUS_LABELS[data.status]}
              bg={LEAD_STATUS_COLORS[data.status].bg}
              fg={LEAD_STATUS_COLORS[data.status].fg}
            />
            <Badge
              label={URGENCY_LABELS[data.urgency]}
              bg={URGENCY_COLORS[data.urgency].bg}
              fg={URGENCY_COLORS[data.urgency].fg}
            />
            <View style={[styles.scorePill, { backgroundColor: c.secondary }]}>
              <Feather name="zap" size={11} color={c.primary} />
              <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: c.foreground }}>
                {data.score}
              </Text>
            </View>
          </View>
        </View>

        {/* Update status */}
        <Pressable
          testID="update-status-button"
          onPress={() => setStatusPickerOpen(true)}
          style={({ pressed }) => [
            styles.statusButton,
            { backgroundColor: c.primary },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Feather name="refresh-ccw" size={16} color={c.primaryForeground} />
          <Text style={{ color: c.primaryForeground, fontSize: 15, fontFamily: 'Inter_600SemiBold' }}>
            Update Status
          </Text>
        </Pressable>

        {/* Details */}
        <Card style={{ gap: 10 }}>
          <DetailRow icon="phone" label="Phone" value={contact.data?.phone ?? '—'} />
          <DetailRow icon="mail" label="Email" value={contact.data?.email ?? '—'} />
          <DetailRow
            icon="map-pin"
            label="Property"
            value={
              property.data
                ? `${property.data.addressLine1}, ${property.data.city}, ${property.data.state} ${property.data.postalCode}`
                : '—'
            }
          />
          <DetailRow icon="tool" label="Service" value={data.serviceType ?? '—'} />
          <DetailRow icon="radio" label="Source" value={data.source ?? '—'} />
          <DetailRow icon="clock" label="Created" value={formatDateTime(data.createdAt)} />
        </Card>

        {data.summary ? (
          <Card style={{ gap: 4 }}>
            <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>SUMMARY</Text>
            <Text style={{ color: c.foreground, fontSize: 14, lineHeight: 20, fontFamily: 'Inter_400Regular' }}>
              {data.summary}
            </Text>
          </Card>
        ) : null}

        {/* Add note */}
        <Text style={[styles.sectionTitle, { color: c.foreground }]}>Log a Note</Text>
        <Card style={{ gap: 10 }}>
          <TextInput
            testID="note-input"
            value={note}
            onChangeText={setNote}
            placeholder="What happened on site?"
            placeholderTextColor={c.mutedForeground}
            multiline
            style={[
              styles.noteInput,
              { color: c.foreground, borderColor: c.input, backgroundColor: c.background },
            ]}
          />
          <Pressable
            testID="note-submit"
            onPress={submitNote}
            disabled={!note.trim() || createActivity.isPending}
            style={({ pressed }) => [
              styles.noteButton,
              { backgroundColor: note.trim() ? c.primary : c.muted },
              pressed && { opacity: 0.85 },
            ]}
          >
            {createActivity.isPending ? (
              <ActivityIndicator size="small" color={c.primaryForeground} />
            ) : (
              <>
                <Feather
                  name="edit-3"
                  size={15}
                  color={note.trim() ? c.primaryForeground : c.mutedForeground}
                />
                <Text
                  style={{
                    color: note.trim() ? c.primaryForeground : c.mutedForeground,
                    fontSize: 14,
                    fontFamily: 'Inter_600SemiBold',
                  }}
                >
                  Add Note
                </Text>
              </>
            )}
          </Pressable>
        </Card>

        {/* Timeline header + Add Photos */}
        <View style={styles.sectionRow}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>Activity Timeline</Text>
          <Pressable
            testID="add-photos-button"
            accessibilityRole="button"
            accessibilityLabel="Add photos to this lead"
            onPress={handleAddPhotos}
            disabled={isUploading}
            style={({ pressed }) => [
              styles.addPhotoButton,
              { backgroundColor: c.secondary },
              (pressed || isUploading) && { opacity: 0.6 },
            ]}
          >
            <Feather name="camera" size={14} color={c.primary} />
            <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: c.primary }}>
              Add Photos
            </Text>
          </Pressable>
        </View>

        {/* Upload progress rows */}
        {uploadQueue.length > 0 ? (
          <Card style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: c.mutedForeground, letterSpacing: 0.6 }}>
                {uploadQueue.every((e) => e.status !== 'uploading')
                  ? uploadQueue.some((e) => e.status === 'error')
                    ? 'UPLOAD ISSUES'
                    : 'UPLOAD COMPLETE'
                  : 'UPLOADING…'}
              </Text>
              {uploadQueue.every((e) => e.status !== 'uploading') ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss upload status"
                  onPress={() => setUploadQueue([])}
                  hitSlop={8}
                  style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                >
                  <Feather name="x" size={14} color={c.mutedForeground} />
                </Pressable>
              ) : null}
            </View>
            {uploadQueue.map((entry) => (
              <View key={entry.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {entry.status === 'uploading' ? (
                  <ActivityIndicator size="small" color={c.primary} style={{ width: 16, height: 16 }} />
                ) : entry.status === 'done' ? (
                  <Feather name="check-circle" size={16} color="#22c55e" />
                ) : (
                  <Feather name="alert-circle" size={16} color="#ef4444" />
                )}
                <Text
                  style={{ flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: c.foreground }}
                  numberOfLines={1}
                >
                  {entry.name}
                </Text>
                {entry.status === 'error' && entry.error ? (
                  <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: '#ef4444' }} numberOfLines={1}>
                    {entry.error}
                  </Text>
                ) : null}
              </View>
            ))}
          </Card>
        ) : null}

        {activities.isLoading ? (
          <ActivityIndicator color={c.primary} />
        ) : (activities.data ?? []).length === 0 ? (
          <Card>
            <Text style={{ color: c.mutedForeground, fontFamily: 'Inter_400Regular' }}>
              No activity yet.
            </Text>
          </Card>
        ) : (
          (activities.data ?? []).map((activity) => {
            const photoPaths = extractPhotoPaths(activity.metadata);
            const isChatResumed = activity.type === 'conversation_resumed';
            const isPortalMessage = activity.type === 'portal_message';
            return (
              <Card
                key={activity.id}
                testID={
                  isChatResumed
                    ? `chat-resumed-activity-${activity.id}`
                    : isPortalMessage
                      ? `portal-message-activity-${activity.id}`
                      : undefined
                }
                style={[
                  { gap: 4 },
                  isChatResumed && {
                    borderWidth: 1,
                    borderColor: CHAT_RESUMED_BORDER,
                    backgroundColor: CHAT_RESUMED_BG,
                  },
                  isPortalMessage && {
                    borderWidth: 1,
                    borderColor: PORTAL_MESSAGE_BORDER,
                    backgroundColor: PORTAL_MESSAGE_BG,
                  },
                ]}
              >
                <View style={styles.badgeRow}>
                  <Text style={{ flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold', color: c.foreground }}>
                    {activity.title}
                  </Text>
                  <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: c.mutedForeground }}>
                    {timeAgo(activity.occurredAt)}
                  </Text>
                </View>
                {isChatResumed ? (
                  <View style={{ flexDirection: 'row' }}>
                    <Badge label="Chat resumed" bg={CHAT_RESUMED_BADGE_BG} fg={CHAT_RESUMED_FG} />
                  </View>
                ) : null}
                {isPortalMessage ? (
                  <View style={{ flexDirection: 'row' }}>
                    <Badge label="Homeowner message" bg={PORTAL_MESSAGE_BADGE_BG} fg={PORTAL_MESSAGE_FG} />
                  </View>
                ) : null}
                {activity.body ? (
                  <Text style={{ color: c.mutedForeground, fontSize: 13, lineHeight: 19, fontFamily: 'Inter_400Regular' }}>
                    {activity.body}
                  </Text>
                ) : null}
                {photoPaths.length > 0 && imageHeadersReady ? (
                  <View style={styles.photoGrid}>
                    {photoPaths.map((path) => (
                      <Pressable
                        key={path}
                        testID={`activity-photo-${path}`}
                        accessibilityRole="imagebutton"
                        accessibilityLabel="Open photo in full-screen viewer"
                        onPress={() => {
                          if (photoLongPressActive.current) {
                            photoLongPressActive.current = false;
                            return;
                          }
                          openPhoto(path);
                        }}
                        onLongPress={() => {
                          photoLongPressActive.current = true;
                          confirmDeletePhoto(path);
                        }}
                        delayLongPress={400}
                        style={({ pressed }) => [
                          styles.photoThumb,
                          { backgroundColor: c.muted, borderColor: c.border },
                          pressed && { opacity: 0.8 },
                        ]}
                      >
                        <Image
                          source={{ uri: photoUrl(path), headers: imageHeaders }}
                          style={{ width: '100%', height: '100%' }}
                          contentFit="cover"
                          transition={100}
                          accessibilityLabel="Damage photo"
                        />
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </Card>
            );
          })
        )}
      </KeyboardAwareScrollViewCompat>

      {/* Full-screen photo viewer */}
      {viewerIndex !== null && allPhotos.length > 0 ? (
        <PhotoViewer
          photos={allPhotos}
          initialIndex={Math.min(viewerIndex, allPhotos.length - 1)}
          visible
          onClose={() => setViewerIndex(null)}
          onDeletePhoto={(objectPath) => {
            // PhotoViewer already showed the confirmation; just close and mutate.
            setViewerIndex(null);
            deletePhoto.mutate(
              { id: leadId, data: { objectPath } },
              {
                onSuccess: () => {
                  queryClient.invalidateQueries({
                    queryKey: getListLeadActivitiesQueryKey(leadId),
                  });
                  queryClient.invalidateQueries({
                    queryKey: getGetLeadQueryKey(leadId),
                  });
                },
                onError: () => {
                  Alert.alert('Could not delete photo', 'Please try again.');
                },
              },
            );
          }}
        />
      ) : null}

      {/* Photo picker action sheet (Android / web) */}
      <Modal
        visible={photoPickerSheetOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPhotoPickerSheetOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setPhotoPickerSheetOpen(false)} />
        <View style={[styles.modalSheet, { backgroundColor: c.card, paddingBottom: insets.bottom + 16 }]}>
          <Text style={[styles.modalTitle, { color: c.foreground }]}>Add Photos</Text>
          <Pressable
            testID="photo-picker-camera"
            onPress={() => {
              setPhotoPickerSheetOpen(false);
              void launchCamera();
            }}
            style={({ pressed }) => [
              styles.statusOption,
              { borderBottomColor: c.border },
              pressed && { opacity: 0.6 },
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Feather name="camera" size={18} color={c.foreground} />
              <Text style={{ fontSize: 15, fontFamily: 'Inter_500Medium', color: c.foreground }}>
                Take Photo
              </Text>
            </View>
          </Pressable>
          <Pressable
            testID="photo-picker-library"
            onPress={() => {
              setPhotoPickerSheetOpen(false);
              void launchLibrary();
            }}
            style={({ pressed }) => [
              styles.statusOption,
              { borderBottomColor: c.border },
              pressed && { opacity: 0.6 },
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Feather name="image" size={18} color={c.foreground} />
              <Text style={{ fontSize: 15, fontFamily: 'Inter_500Medium', color: c.foreground }}>
                Choose from Library
              </Text>
            </View>
          </Pressable>
        </View>
      </Modal>

      {/* Status picker */}
      <Modal
        visible={statusPickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setStatusPickerOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setStatusPickerOpen(false)} />
        <View style={[styles.modalSheet, { backgroundColor: c.card, paddingBottom: insets.bottom + 16 }]}>
          <Text style={[styles.modalTitle, { color: c.foreground }]}>Update Status</Text>
          <ScrollView style={{ maxHeight: 420 }}>
            {LEAD_STATUSES.map((status) => {
              const active = status === data.status;
              return (
                <Pressable
                  key={status}
                  testID={`status-option-${status}`}
                  onPress={() => setStatus(status)}
                  disabled={updateLead.isPending}
                  style={({ pressed }) => [
                    styles.statusOption,
                    { borderBottomColor: c.border },
                    (pressed || (updateLead.isPending && !active)) && { opacity: 0.6 },
                  ]}
                >
                  <Badge
                    label={LEAD_STATUS_LABELS[status]}
                    bg={LEAD_STATUS_COLORS[status].bg}
                    fg={LEAD_STATUS_COLORS[status].fg}
                  />
                  {active ? <Feather name="check" size={18} color={c.primary} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
}) {
  const c = useColors();
  return (
    <View style={styles.detailRow}>
      <Feather name={icon} size={15} color={c.mutedForeground} style={{ marginTop: 2 }} />
      <Text style={{ width: 68, fontSize: 13, fontFamily: 'Inter_500Medium', color: c.mutedForeground }}>
        {label}
      </Text>
      <Text style={{ flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: c.foreground }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  name: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  scorePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: colors.radius,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  addPhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  noteInput: {
    minHeight: 72,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlignVertical: 'top',
  },
  noteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 11,
    borderRadius: 8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(6, 15, 33, 0.45)',
  },
  modalSheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    gap: 8,
  },
  modalTitle: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    marginBottom: 4,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  photoThumb: {
    width: '31%',
    aspectRatio: 1,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  statusOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
