import { useEffect } from 'react';
import { View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors, shadows } from '@/theme/tokens';

function usePulse() {
  const v = useSharedValue(0.55);
  useEffect(() => {
    v.value = withRepeat(withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [v]);
  return useAnimatedStyle(() => ({ opacity: v.value }));
}

/** Pulsująca pigułka (wysokość jak `Pill` 13 px) – np. prognoza grzybowa w trakcie pobierania. */
export function SkeletonPill({ width = 150 }: { width?: number }) {
  const pulse = usePulse();
  return <Animated.View style={[{ width, height: 28, borderRadius: 999, backgroundColor: colors.chip }, pulse]} />;
}

/** Pojedynczy „kość” w kolorze tła chipów. */
export function Bone({ w, h, r = 8, style }: { w: DimensionValue; h: number; r?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ width: w, height: h, borderRadius: r, backgroundColor: colors.chip }, style]} />;
}

/** Szkielet w stylu karty – pulsuje podczas ładowania danych z serwisów. */
export function SkeletonCard({
  lines = 3,
  height,
  radius = 22,
  style,
  media,
}: {
  lines?: number;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  media?: number;
}) {
  const pulse = usePulse();
  return (
    <Animated.View
      style={[
        { backgroundColor: colors.card, borderRadius: radius, boxShadow: shadows.card, overflow: 'hidden', minHeight: height },
        pulse,
        style,
      ]}
    >
      {media ? <View style={{ height: media, backgroundColor: colors.canvas }} /> : null}
      <View style={{ padding: 16, gap: 10 }}>
        <Bone w="45%" h={14} />
        {Array.from({ length: lines }).map((_, i) => (
          <Bone key={i} w={i === lines - 1 ? '60%' : '100%'} h={12} />
        ))}
      </View>
    </Animated.View>
  );
}

export function SkeletonRow({ style }: { style?: StyleProp<ViewStyle> }) {
  const pulse = usePulse();
  return (
    <Animated.View
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: 18,
          padding: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          boxShadow: shadows.card,
        },
        pulse,
        style,
      ]}
    >
      <Bone w={34} h={34} r={17} />
      <View style={{ flex: 1, gap: 6 }}>
        <Bone w="50%" h={13} />
        <Bone w="75%" h={10} />
      </View>
      <Bone w={44} h={16} />
    </Animated.View>
  );
}
