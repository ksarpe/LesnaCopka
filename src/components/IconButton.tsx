import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { colors, shadows } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';

interface IconButtonProps {
  icon: IconName;
  onPress?: () => void;
  /** light = biały na jasnym tle; photo = biały na zdjęciu; dark = półprzezroczysty na ciemnym. */
  variant?: 'light' | 'photo' | 'dark';
  size?: number;
  iconSize?: number;
  filled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /** Stan „włączony” (np. latarka) – zielone tło. */
  active?: boolean;
}

/** Okrągły przycisk 44 px (zamknij, wstecz, udostępnij, ustawienia…). */
export function IconButton({
  icon,
  onPress,
  variant = 'light',
  size = 44,
  iconSize = 24,
  filled,
  style,
  accessibilityLabel,
  active,
}: IconButtonProps) {
  const dark = variant === 'dark';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? icon}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: active ? colors.scanGreen : dark ? 'rgba(255,255,255,0.14)' : colors.card,
          boxShadow: dark ? undefined : variant === 'photo' ? shadows.photoButton : shadows.card,
          opacity: pressed ? 0.8 : 1,
          transform: [{ scale: pressed ? 0.96 : 1 }],
        },
        style,
      ]}
    >
      <Icon name={icon} size={iconSize} filled={filled} color={active ? colors.primaryInk : dark ? colors.onDark : colors.ink} />
    </Pressable>
  );
}
