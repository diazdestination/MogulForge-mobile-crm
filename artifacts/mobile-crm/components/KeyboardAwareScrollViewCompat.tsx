import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, type ScrollViewProps } from 'react-native';

// react-native-keyboard-controller requires a custom dev build and is NOT
// available in Expo Go. Attempt to load it and fall back to React Native's
// built-in KeyboardAvoidingView + ScrollView combination so the app runs
// correctly in both Expo Go and production dev builds.
let KeyboardAwareScrollView: React.ComponentType<ScrollViewProps & {
  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled';
  /** Pixels of extra space to keep above the keyboard. Native builds only. */
  bottomOffset?: number;
}>;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  KeyboardAwareScrollView = (require('react-native-keyboard-controller') as typeof import('react-native-keyboard-controller')).KeyboardAwareScrollView as unknown as typeof KeyboardAwareScrollView;
} catch {
  // Expo Go fallback: KeyboardAvoidingView wraps a standard ScrollView.
  // This provides the same "scroll content up when keyboard appears"
  // behaviour without native keyboard-controller code.
  // bottomOffset is accepted in the type but ignored here — RN's built-in
  // ScrollView has no equivalent prop.
  KeyboardAwareScrollView = ({ children, keyboardShouldPersistTaps = 'handled', style, contentContainerStyle, bottomOffset: _bottomOffset, ...rest }) => (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[{ flex: 1 }, style]}
    >
      <ScrollView
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        contentContainerStyle={contentContainerStyle}
        {...rest}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

type Props = ScrollViewProps & {
  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled';
  /** react-native-keyboard-controller prop; ignored in the Expo Go fallback */
  bottomOffset?: number;
};

export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = 'handled',
  bottomOffset,
  ...props
}: Props) {
  if (Platform.OS === 'web') {
    return (
      <ScrollView keyboardShouldPersistTaps={keyboardShouldPersistTaps} {...props}>
        {children}
      </ScrollView>
    );
  }
  return (
    <KeyboardAwareScrollView
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      bottomOffset={bottomOffset}
      {...props}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
