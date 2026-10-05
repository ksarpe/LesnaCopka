import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, shadows } from '@/theme/tokens';

interface CardProps {
  children?: ReactNode;
  radius?: number;
  padding?: number | { v: number; h: number };
  gap?: number;
  /** Ciemna karta (forest) z twardym cieniem #1E3311. */
  dark?: boolean;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  onLongPress?: () => void;
}

/** Biała karta z twardym cieniem `0 2px 0 rgba(60,50,30,0.08)`. */
export function Card({ children, radius = 22, padding, gap, dark, style, onPress, onLongPress }: CardProps) {
  const pad =
    padding == null ? undefined : typeof padding === 'number' ? { padding } : { paddingVertical: padding.v, paddingHorizontal: padding.h };
  const base: ViewStyle = {
    backgroundColor: dark ? colors.forest : colors.card,
    borderRadius: radius,
    boxShadow: dark ? shadows.forest : shadows.card,
    gap,
    ...pad,
  };
  if (onPress || onLongPress) {
    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        style={({ pressed }) => [base, style, pressed && { opacity: 0.92 }]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}
