import React, { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import colors from '@/constants/colors';
import { Feather } from '@expo/vector-icons';

export function Card({
  children,
  style,
  onPress,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  testID?: string;
}) {
  const c = useColors();
  const base: ViewStyle = {
    backgroundColor: c.card,
    borderRadius: colors.radius,
    borderWidth: 1,
    borderColor: c.border,
    padding: 14,
  };
  if (onPress) {
    return (
      <Pressable
        testID={testID}
        onPress={onPress}
        style={({ pressed }) => [base, style, pressed && { opacity: 0.7 }]}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View testID={testID} style={[base, style]}>
      {children}
    </View>
  );
}

export function Badge({
  label,
  bg,
  fg,
}: {
  label: string;
  bg: string;
  fg: string;
}) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function LoadingView() {
  const c = useColors();
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={c.primary} />
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle?: string;
}) {
  const c = useColors();
  return (
    <View style={styles.center}>
      <View style={[styles.emptyIcon, { backgroundColor: c.secondary }]}>
        <Feather name={icon} size={26} color={c.mutedForeground} />
      </View>
      <Text style={[styles.emptyTitle, { color: c.foreground }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.emptySubtitle, { color: c.mutedForeground }]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const c = useColors();
  return (
    <View style={styles.center}>
      <View style={[styles.emptyIcon, { backgroundColor: '#FEE2E2' }]}>
        <Feather name="alert-triangle" size={26} color={c.destructive} />
      </View>
      <Text style={[styles.emptyTitle, { color: c.foreground }]}>Something went wrong</Text>
      <Text style={[styles.emptySubtitle, { color: c.mutedForeground }]}>{message}</Text>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [
            styles.retryBtn,
            { backgroundColor: c.primary },
            pressed && { opacity: 0.8 },
          ]}
        >
          <Text style={{ color: c.primaryForeground, fontFamily: 'Inter_600SemiBold' }}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? c.primary : c.card,
          borderColor: active ? c.primary : c.border,
        },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text
        style={{
          color: active ? c.primaryForeground : c.foreground,
          fontSize: 13,
          fontFamily: active ? 'Inter_600SemiBold' : 'Inter_500Medium',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  emptySubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: colors.radius,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
});
