import { useEffect } from 'react';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { colors } from '@/theme/tokens';

/** Mrugająca kropka „live” (blink 1.4 s ease-in-out, opacity 1 → .25 → 1). */
export function LiveDot({ size = 10, color = colors.xpOnDark }: { size?: number; color?: string }) {
  const o = useSharedValue(1);
  useEffect(() => {
    o.value = withRepeat(withTiming(0.25, { duration: 700, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}
