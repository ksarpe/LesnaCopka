import { useMemo, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedProps, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Przerwa między sektorami (°). */
const GAP_DEG = 3;

/**
 * Pierścień skanu 3D: sektory obejścia jak mapa z góry – gracz zaczyna na dole, sektor 0 to start; obchodząc grzyba
 * zgodnie z ruchem wskazówek zegara, zapala kolejne sektory w tę samą stronę. Kropka = bieżąca pozycja
 * (`heading` – azymut względem startu, NaN = przed startem).
 */
export function OrbitRing({
  size,
  thickness,
  sectors,
  heading,
  color = colors.scanGreen,
  track = 'rgba(255,255,255,0.16)',
  children,
  style,
}: {
  size: number;
  thickness: number;
  /** Zaliczone sektory (indeks 0 = start, kolejne zgodnie z ruchem wskazówek zegara). */
  sectors: readonly boolean[];
  heading: SharedValue<number>;
  color?: string;
  track?: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const c = size / 2;
  const r = (size - thickness) / 2;
  const n = sectors.length;
  const arcs = useMemo(() => {
    const step = 360 / n;
    /** Punkt na pierścieniu: φ stopni od dołu, zgodnie z ruchem wskazówek zegara (y w dół). */
    const pt = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      return `${(c - r * Math.sin(a)).toFixed(2)} ${(c + r * Math.cos(a)).toFixed(2)}`;
    };
    return Array.from({ length: n }, (_, i) => {
      const from = i * step - step / 2 + GAP_DEG / 2;
      const to = i * step + step / 2 - GAP_DEG / 2;
      return `M${pt(from)}A${r} ${r} 0 0 1 ${pt(to)}`;
    });
  }, [c, r, n]);

  const dotProps = useAnimatedProps(() => {
    const h = heading.get();
    if (!Number.isFinite(h)) return { cx: c, cy: c + r, opacity: 0 };
    const a = (h * Math.PI) / 180;
    return { cx: c - r * Math.sin(a), cy: c + r * Math.cos(a), opacity: 1 };
  });

  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Svg width={size} height={size} style={{ position: 'absolute', left: 0, top: 0 }}>
        {arcs.map((d, i) => (
          <Path key={i} d={d} stroke={sectors[i] ? color : track} strokeWidth={thickness} fill="none" />
        ))}
        <AnimatedCircle
          r={thickness * 0.62}
          fill={colors.onDark}
          stroke={colors.camera}
          strokeWidth={2}
          animatedProps={dotProps}
        />
      </Svg>
      {children}
    </View>
  );
}
