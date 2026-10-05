import { useEffect } from 'react';
import { View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { colors, shadows } from '@/theme/tokens';

interface ProgressBarProps {
  /** 0..1 */
  value: number;
  height?: number;
  track?: string;
  fill?: string;
  inset?: string | null;
  style?: StyleProp<ViewStyle>;
  /** Animuj zmiany wartości (np. po nagrodzie). */
  animated?: boolean;
}

/** Pasek postępu XP: tor #EDE7DA, wypełnienie z wewnętrznym cieniem `inset 0 -3px 0`. */
export function ProgressBar({
  value,
  height = 14,
  track = colors.track,
  fill = colors.primary,
  inset = shadows.barInset,
  style,
  animated,
}: ProgressBarProps) {
  const v = Math.max(0, Math.min(1, value));
  const sv = useSharedValue(v);
  useEffect(() => {
    sv.value = animated ? withTiming(v, { duration: 700, easing: Easing.bezier(0.2, 0.8, 0.2, 1) }) : v;
  }, [v, animated, sv]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${sv.value * 100}%` as DimensionValue }));
  return (
    <View style={[{ height, borderRadius: 999, backgroundColor: track, overflow: 'hidden' }, style]}>
      <Animated.View style={[{ height: '100%', borderRadius: 999, backgroundColor: fill, boxShadow: inset ?? undefined }, fillStyle]} />
    </View>
  );
}

interface XpBarAnimatedProps {
  from: number;
  to: number;
  /** Gdy true: from → 100%, potem 0 → to (LEVEL UP). */
  levelUp?: boolean;
  duration?: number;
  delay?: number;
  onCrossLevel?: () => void;
  height?: number;
}

/** Pasek poziomu na ekranie Nagroda (1.6 s, start po 0.5 s, krzywa (.2,.8,.2,1)). */
export function XpBarAnimated({ from, to, levelUp, duration = 1600, delay = 500, onCrossLevel, height = 16 }: XpBarAnimatedProps) {
  const sv = useSharedValue(from);
  useEffect(() => {
    const ease = Easing.bezier(0.2, 0.8, 0.2, 1);
    if (!levelUp) {
      sv.value = from;
      sv.value = withDelay(delay, withTiming(to, { duration, easing: ease }));
      return;
    }
    sv.value = from;
    const first = Math.round(duration * 0.45);
    sv.value = withDelay(
      delay,
      withTiming(1, { duration: first, easing: Easing.in(Easing.quad) }, (done) => {
        'worklet';
        if (!done) return;
        sv.value = 0;
        sv.value = withTiming(to, { duration: duration - first, easing: ease });
      }),
    );
    const t = setTimeout(() => onCrossLevel?.(), delay + first);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, levelUp]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${sv.value * 100}%` as DimensionValue }));
  return (
    <View style={{ height, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
      <Animated.View
        style={[{ height: '100%', borderRadius: 999, backgroundColor: colors.scanGreen, boxShadow: shadows.barInsetDark }, fillStyle]}
      />
    </View>
  );
}
