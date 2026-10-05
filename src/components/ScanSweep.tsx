import { useEffect, useMemo } from 'react';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

/**
 * Obracający się „sweep” pierścienia skanu:
 * conic-gradient(transparent 0°, rgba(220,255,180,.75) 30°, transparent 50°), 2.2 s liniowo w pętli.
 * Gradient stożkowy rysujemy jako 25 krótkich łuków z narastającą/opadającą przezroczystością.
 */
export function ScanSweep({ size, thickness, running = true }: { size: number; thickness: number; running?: boolean }) {
  const rot = useSharedValue(0);
  useEffect(() => {
    if (!running) {
      cancelAnimation(rot);
      return;
    }
    rot.value = 0;
    rot.value = withRepeat(withTiming(360, { duration: 2200, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(rot);
  }, [running, rot]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));

  const segments = useMemo(() => {
    const c = size / 2;
    const r = (size - thickness) / 2;
    const pt = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      return `${(c + r * Math.sin(a)).toFixed(2)} ${(c - r * Math.cos(a)).toFixed(2)}`;
    };
    const out: { d: string; o: number }[] = [];
    const step = 2;
    for (let a = 0; a < 50; a += step) {
      const mid = a + step / 2;
      const o = mid <= 30 ? (mid / 30) * 0.75 : ((50 - mid) / 20) * 0.75;
      out.push({ d: `M ${pt(a)} A ${r} ${r} 0 0 1 ${pt(a + step + 0.3)}`, o });
    }
    return out;
  }, [size, thickness]);

  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        {segments.map((s, i) => (
          <Path key={i} d={s.d} stroke="rgb(220,255,180)" strokeOpacity={s.o} strokeWidth={thickness} fill="none" />
        ))}
      </Svg>
    </Animated.View>
  );
}
