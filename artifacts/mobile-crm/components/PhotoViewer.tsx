import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ViewToken,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import * as SecureStore from 'expo-secure-store';
import { Feather } from '@expo/vector-icons';

export type ViewerPhoto = {
  /** Full URL to fetch the image from. */
  uri: string;
  /** Object-storage path used to call the delete API (e.g. /objects/…). */
  objectPath?: string;
};

const MAX_SCALE = 5;

/**
 * Downloads a protected photo to the app cache using the auth headers and
 * returns the local file URI. Throws on non-2xx responses so callers can
 * surface a clear error instead of sharing/saving a broken file.
 */
async function downloadPhotoToCache(
  uri: string,
  headers: Record<string, string> | undefined,
): Promise<string> {
  const rawName = uri.split('/').pop()?.split('?')[0] || 'photo';
  const hasExt = /\.(jpe?g|png|gif|webp|heic)$/i.test(rawName);
  const fileName = `damage-photo-${Date.now()}-${rawName}${hasExt ? '' : '.jpg'}`;
  const target = `${FileSystem.cacheDirectory}${fileName}`;
  const result = await FileSystem.downloadAsync(uri, target, { headers });
  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
    throw new Error(`Download failed (HTTP ${result.status})`);
  }
  return result.uri;
}

/**
 * Auth headers for fetching protected storage images. Native builds use a
 * bearer token (no cookies); web relies on the session cookie, so headers
 * stay undefined there. `ready` flips true once the token lookup settles so
 * callers can avoid firing unauthenticated image requests.
 */
export function useImageAuthHeaders(): {
  headers: Record<string, string> | undefined;
  ready: boolean;
} {
  const [headers, setHeaders] = useState<Record<string, string> | undefined>(undefined);
  const [ready, setReady] = useState(Platform.OS === 'web');

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    SecureStore.getItemAsync('auth_session_token')
      .then((token) => {
        if (cancelled) return;
        if (token) setHeaders({ Authorization: `Bearer ${token}` });
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { headers, ready };
}

/**
 * Full-screen swipeable damage-photo viewer.
 *
 * - Horizontal paging (swipe left/right) across all photos on the lead.
 * - Pinch-to-zoom and pan-while-zoomed per photo (double-tap toggles zoom).
 * - Paging is disabled while zoomed in so pan gestures move the photo.
 */
export function PhotoViewer({
  photos,
  initialIndex,
  visible,
  onClose,
  onDeletePhoto,
}: {
  photos: ViewerPhoto[];
  initialIndex: number;
  visible: boolean;
  onClose: () => void;
  /** When provided a trash icon appears; called with the current photo's objectPath. */
  onDeletePhoto?: (objectPath: string) => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(initialIndex);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const listRef = useRef<FlatList<ViewerPhoto>>(null);
  const { headers: authHeaders, ready: headersReady } = useImageAuthHeaders();
  const [busy, setBusy] = useState<'share' | 'save' | null>(null);

  const currentUri = photos[index]?.uri;
  const currentObjectPath = photos[index]?.objectPath;

  const handleDelete = useCallback(() => {
    if (!currentObjectPath || !onDeletePhoto) return;
    Alert.alert(
      'Delete photo?',
      'This photo will be permanently removed from the lead.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onDeletePhoto(currentObjectPath),
        },
      ],
    );
  }, [currentObjectPath, onDeletePhoto]);

  const handleShare = useCallback(async () => {
    if (!currentUri || busy) return;
    setBusy('share');
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Sharing unavailable', 'Sharing is not available on this device.');
        return;
      }
      const localUri = await downloadPhotoToCache(currentUri, authHeaders);
      await Sharing.shareAsync(localUri, { dialogTitle: 'Share damage photo' });
    } catch (err) {
      Alert.alert(
        'Could not share photo',
        err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(null);
    }
  }, [currentUri, authHeaders, busy]);

  const handleSave = useCallback(async () => {
    if (!currentUri || busy) return;
    setBusy('save');
    try {
      const { status, canAskAgain } = await MediaLibrary.requestPermissionsAsync(true);
      if (status !== 'granted') {
        Alert.alert(
          'Permission needed',
          'Allow photo library access to save damage photos.',
          canAskAgain
            ? undefined
            : [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Open Settings', onPress: () => Linking.openSettings() },
              ],
        );
        return;
      }
      const localUri = await downloadPhotoToCache(currentUri, authHeaders);
      await MediaLibrary.saveToLibraryAsync(localUri);
      Alert.alert('Saved', 'Photo saved to your photo library.');
    } catch (err) {
      Alert.alert(
        'Could not save photo',
        err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(null);
    }
  }, [currentUri, authHeaders, busy]);

  useEffect(() => {
    if (visible) setIndex(initialIndex);
  }, [visible, initialIndex]);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems.find((v) => v.isViewable);
      if (first && typeof first.index === 'number') setIndex(first.index);
    },
  ).current;

  const handleZoomChange = useCallback((zoomed: boolean) => {
    setScrollEnabled(!zoomed);
  }, []);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.container}>
        {headersReady ? (
          <FlatList
            ref={listRef}
            data={photos}
            keyExtractor={(item, i) => `${i}-${item.uri}`}
            horizontal
            pagingEnabled
            scrollEnabled={scrollEnabled}
            initialScrollIndex={Math.min(initialIndex, Math.max(photos.length - 1, 0))}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            showsHorizontalScrollIndicator={false}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
            renderItem={({ item, index: itemIndex }) => (
              <ZoomablePhoto
                uri={item.uri}
                headers={authHeaders}
                width={width}
                height={height}
                isActive={itemIndex === index}
                onZoomChange={handleZoomChange}
              />
            )}
          />
        ) : null}

        {/* Top bar: close + counter */}
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
          <Pressable
            testID="photo-viewer-close"
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.7 }]}
          >
            <Feather name="x" size={22} color="#fff" />
          </Pressable>
          <View style={styles.counterPill}>
            <Text style={styles.counterText} testID="photo-viewer-counter">
              {photos.length ? `${index + 1} of ${photos.length}` : ''}
            </Text>
          </View>
          {Platform.OS !== 'web' ? (
            <View style={styles.actionsRow}>
              <Pressable
                testID="photo-viewer-save"
                accessibilityRole="button"
                accessibilityLabel="Save photo to library"
                onPress={handleSave}
                disabled={busy !== null || !currentUri}
                hitSlop={12}
                style={({ pressed }) => [
                  styles.closeButton,
                  (pressed || busy === 'save') && { opacity: 0.7 },
                ]}
              >
                {busy === 'save' ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Feather name="download" size={20} color="#fff" />
                )}
              </Pressable>
              <Pressable
                testID="photo-viewer-share"
                accessibilityRole="button"
                accessibilityLabel="Share photo"
                onPress={handleShare}
                disabled={busy !== null || !currentUri}
                hitSlop={12}
                style={({ pressed }) => [
                  styles.closeButton,
                  (pressed || busy === 'share') && { opacity: 0.7 },
                ]}
              >
                {busy === 'share' ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Feather name="share" size={20} color="#fff" />
                )}
              </Pressable>
              {onDeletePhoto && currentObjectPath ? (
                <Pressable
                  testID="photo-viewer-delete"
                  accessibilityRole="button"
                  accessibilityLabel="Delete photo"
                  onPress={handleDelete}
                  disabled={busy !== null}
                  hitSlop={12}
                  style={({ pressed }) => [
                    styles.closeButton,
                    styles.deleteButton,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Feather name="trash-2" size={20} color="#fff" />
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View style={styles.actionsRow}>
              {onDeletePhoto && currentObjectPath ? (
                <Pressable
                  testID="photo-viewer-delete"
                  accessibilityRole="button"
                  accessibilityLabel="Delete photo"
                  onPress={handleDelete}
                  hitSlop={12}
                  style={({ pressed }) => [
                    styles.closeButton,
                    styles.deleteButton,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Feather name="trash-2" size={20} color="#fff" />
                </Pressable>
              ) : null}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function ZoomablePhoto({
  uri,
  headers,
  width,
  height,
  isActive,
  onZoomChange,
}: {
  uri: string;
  headers?: Record<string, string>;
  width: number;
  height: number;
  isActive: boolean;
  onZoomChange: (zoomed: boolean) => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  // Reset zoom whenever this photo scrolls out of view.
  useEffect(() => {
    if (!isActive) {
      scale.value = withTiming(1);
      savedScale.value = 1;
      translateX.value = withTiming(0);
      translateY.value = withTiming(0);
      savedX.value = 0;
      savedY.value = 0;
      onZoomChange(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  const clampTranslation = (nextScale: number) => {
    'worklet';
    const maxX = (width * (nextScale - 1)) / 2;
    const maxY = (height * (nextScale - 1)) / 2;
    translateX.value = Math.min(maxX, Math.max(-maxX, translateX.value));
    translateY.value = Math.min(maxY, Math.max(-maxY, translateY.value));
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      const next = Math.min(MAX_SCALE, Math.max(1, savedScale.value * e.scale));
      scale.value = next;
      clampTranslation(next);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.02) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedX.value = 0;
        savedY.value = 0;
        runOnJS(onZoomChange)(false);
      } else {
        savedX.value = translateX.value;
        savedY.value = translateY.value;
        runOnJS(onZoomChange)(true);
      }
    });

  const pan = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .onUpdate((e) => {
      if (savedScale.value <= 1) return;
      translateX.value = savedX.value + e.translationX;
      translateY.value = savedY.value + e.translationY;
      clampTranslation(scale.value);
    })
    .onEnd(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    })
    .enabled(true);

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (savedScale.value > 1) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedX.value = 0;
        savedY.value = 0;
        runOnJS(onZoomChange)(false);
      } else {
        scale.value = withTiming(2.5);
        savedScale.value = 2.5;
        runOnJS(onZoomChange)(true);
      }
    });

  const composed = Gesture.Simultaneous(pinch, Gesture.Exclusive(doubleTap, pan));

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composed}>
      <View style={{ width, height, backgroundColor: '#000' }}>
        <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]}>
          <Image
            source={{ uri, headers }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            transition={120}
            accessibilityLabel="Damage photo"
          />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    backgroundColor: 'rgba(220,38,38,0.55)',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    minWidth: 38,
  },
  counterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  counterText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
});
