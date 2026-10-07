import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { colors } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

export function hapticLight() {
  if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

interface Press3DProps {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** Wysokość twardego cienia w spoczynku (px). */
  depth: number;
  /** Przesunięcie po wciśnięciu (cień zostaje depth - pressDepth). */
  pressDepth: number;
  shadowColor: string;
  radius: number;
  /** Styl „twarzy” przycisku (tło, padding, layout zawartości). */
  faceStyle?: StyleProp<ViewStyle>;
  /** Styl zewnętrznego kontenera (marginesy, align-self, rozmiar). */
  style?: StyleProp<ViewStyle>;
  /** Pierścień `0 0 0 Npx kolor` – przesuwa się razem z twarzą. */
  ring?: { width: number; color: string };
  haptic?: boolean;
  children: ReactNode;
  accessibilityLabel?: string;
}

/**
 * Przycisk „3D”: twardy cień w kolorze primaryShadow. Po wciśnięciu twarz zjeżdża
 * o pressDepth (Reanimated, 80 ms), a widoczny cień maleje – jak `style-active` w makiecie.
 */
export function Press3D({
  onPress,
  onLongPress,
  disabled,
  depth,
  pressDepth,
  shadowColor,
  radius,
  faceStyle,
  style,
  ring,
  haptic = true,
  children,
  accessibilityLabel,
}: Press3DProps) {
  const pressed = useSharedValue(0);
  const faceAnim = useAnimatedStyle(() => ({ transform: [{ translateY: pressed.value * pressDepth }] }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => {
        pressed.value = withTiming(1, { duration: 80 });
        if (haptic) hapticLight();
      }}
      onPressOut={() => {
        pressed.value = withTiming(0, { duration: 80 });
      }}
      style={style}
    >
      <View>
        {ring ? (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                left: -ring.width,
                right: -ring.width,
                top: -ring.width,
                bottom: -ring.width,
                borderRadius: radius + ring.width,
                backgroundColor: ring.color,
              },
              faceAnim,
            ]}
          />
        ) : null}
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { top: depth, bottom: -depth, borderRadius: radius, backgroundColor: shadowColor }]}
        />
        <Animated.View style={[{ borderRadius: radius }, faceStyle, faceAnim]}>{children}</Animated.View>
      </View>
    </Pressable>
  );
}

interface Button3DProps {
  title: string;
  icon?: IconName;
  onPress?: () => void;
  disabled?: boolean;
  /** lg = 20 px / padding 18 / cień 5; md = 18 px / padding 14 / cień 4 (karta wyzwania). */
  size?: 'lg' | 'md';
  /** Na ciemnym tle cień jest ciemniejszy (#4A7522). */
  onDark?: boolean;
  /** danger = czerwony przycisk akcji nieodwracalnej (np. „Usuń konto”). */
  tone?: 'primary' | 'danger';
  style?: StyleProp<ViewStyle>;
}

/** Przycisk „Usuń…”: czerwień z palety (danger) i ciemniejszy cień. */
const DANGER = { bg: colors.danger, shadow: '#A43C27', ink: colors.white, disabledBg: '#EBB7AB', disabledShadow: '#D19A8C' };

export function Button3D({ title, icon, onPress, disabled, size = 'lg', onDark, tone = 'primary', style }: Button3DProps) {
  const lg = size === 'lg';
  const radius = lg ? 22 : 18;
  const danger = tone === 'danger';
  const bg = danger ? (disabled ? DANGER.disabledBg : DANGER.bg) : disabled ? '#C9D9B4' : colors.primary;
  const shadow = danger
    ? disabled
      ? DANGER.disabledShadow
      : DANGER.shadow
    : disabled
      ? '#AFC294'
      : onDark
        ? colors.primaryShadowOnDark
        : colors.primaryShadow;
  const ink = danger ? DANGER.ink : colors.primaryInk;
  return (
    <Press3D
      onPress={onPress}
      disabled={disabled}
      depth={lg ? 5 : 4}
      pressDepth={lg ? 4 : 3}
      shadowColor={shadow}
      radius={radius}
      style={style}
      accessibilityLabel={title}
      faceStyle={{
        backgroundColor: bg,
        padding: lg ? 18 : 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      {icon ? <Icon name={icon} filled size={24} color={ink} /> : null}
      <Txt f="b7" size={lg ? 20 : 18} color={ink} align="center">
        {title}
      </Txt>
    </Press3D>
  );
}
