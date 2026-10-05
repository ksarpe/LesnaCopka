import { useEffect } from 'react';
import { Pressable } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { colors } from '@/theme/tokens';
import { hapticLight } from './Button3D';

interface ToggleProps {
  value: boolean;
  onChange: (v: boolean) => void;
  accessibilityLabel?: string;
}

/** Przełącznik 46×28 z gałką 22 px (wiersz prywatności w Podsumowaniu). */
export function Toggle({ value, onChange, accessibilityLabel }: ToggleProps) {
  const t = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    t.value = withTiming(value ? 1 : 0, { duration: 160 });
  }, [value, t]);
  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(t.value, [0, 1], ['#CFC5B0', colors.primary]),
  }));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: t.value * 18 }] }));
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        hapticLight();
        onChange(!value);
      }}
      hitSlop={8}
    >
      <Animated.View style={[{ width: 46, height: 28, borderRadius: 999 }, track]}>
        <Animated.View
          style={[{ position: 'absolute', left: 3, top: 3, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.white }, knob]}
        />
      </Animated.View>
    </Pressable>
  );
}
