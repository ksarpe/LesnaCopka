import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';

/**
 * Promienie: repeating-conic-gradient(rgba(255,255,255,.07) 0 9°, transparent 9° 18°)
 * z maską radial-gradient(#000 20%, transparent 68%) – 640 px, 40 s/obrót.
 */
export function Rays({ size = 640 }: { size?: number }) {
  const rot = useSharedValue(0);
  useEffect(() => {
    rot.value = withRepeat(withTiming(360, { duration: 40000, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(rot);
  }, [rot]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  const c = size / 2;
  // Maska CSS liczona od „farthest-corner” kwadratu: r = c·√2.
  const maskR = c * Math.SQRT2;
  const wedges = useMemo(() => {
    const pt = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      return `${(c + c * Math.sin(a)).toFixed(2)} ${(c - c * Math.cos(a)).toFixed(2)}`;
    };
    return Array.from({ length: 20 }, (_, k) => `M ${c} ${c} L ${pt(k * 18)} A ${c} ${c} 0 0 1 ${pt(k * 18 + 9)} Z`);
  }, [c]);
  return (
    <Animated.View pointerEvents="none" style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="rayFade" cx={c} cy={c} r={maskR} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.07} />
            <Stop offset="0.2" stopColor="#FFFFFF" stopOpacity={0.07} />
            <Stop offset="0.68" stopColor="#FFFFFF" stopOpacity={0} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        {wedges.map((d, i) => (
          <Path key={i} d={d} fill="url(#rayFade)" />
        ))}
      </Svg>
    </Animated.View>
  );
}

/**
 * Pulsująca poświata: koło (rozmiar zdjęcia + 2×18 px) w kolorze rzadkości z blur(26px),
 * pulse 2.2 s (opacity .55 → 1, scale 1 → 1.08). Rozmycie odwzorowane gradientem radialnym.
 */
export function Glow({ color, photoSize }: { color: string; photoSize: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(t);
  }, [t]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.55 + t.value * 0.45,
    transform: [{ scale: 1 + t.value * 0.08 }],
  }));
  const disc = photoSize / 2 + 18;
  const sigma = 26;
  const R = disc + 2.3 * sigma;
  const size = R * 2;
  const off = (r: number) => Math.max(0, Math.min(1, r / R));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', width: size, height: size, left: photoSize / 2 - R, top: photoSize / 2 - R },
        style,
      ]}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={`glow${color.replace(/[^a-zA-Z0-9]/g, "")}`} cx={R} cy={R} r={R} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={color} stopOpacity={1} />
            <Stop offset={off(disc - 2 * sigma)} stopColor={color} stopOpacity={0.98} />
            <Stop offset={off(disc - sigma)} stopColor={color} stopOpacity={0.84} />
            <Stop offset={off(disc)} stopColor={color} stopOpacity={0.5} />
            <Stop offset={off(disc + sigma)} stopColor={color} stopOpacity={0.16} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={R} cy={R} r={R} fill={`url(#glow${color.replace(/[^a-zA-Z0-9]/g, "")})`} />
      </Svg>
    </Animated.View>
  );
}

/** Rozbłysk przy LEVEL UP: rozszerzający się pierścień. */
export function Burst({ trigger, color }: { trigger: number; color: string }) {
  const t = useSharedValue(1);
  useEffect(() => {
    if (!trigger) return;
    t.value = 0;
    t.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) });
  }, [trigger, t]);
  const style = useAnimatedStyle(() => ({
    opacity: 1 - t.value,
    transform: [{ scale: 0.8 + t.value * 1.4 }],
  }));
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ width: 170, height: 170, borderRadius: 85, borderWidth: 6, borderColor: color }, style]} />
    </View>
  );
}
