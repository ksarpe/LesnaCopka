import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedProps, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface ProgressRingProps {
  size: number;
  /** Grubość pierścienia (w CSS: maska radial-gradient / różnica średnic). */
  thickness: number;
  /** 0..1 – statycznie. */
  value?: number;
  /** 0..1 – animowane z Reanimated. */
  progress?: SharedValue<number>;
  color: string;
  track: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * `conic-gradient(color 0 Xdeg, track Xdeg 360deg)` → SVG Circle ze strokeDasharray.
 * Start na godzinie 12, zgodnie z ruchem wskazówek zegara (jak conic w CSS).
 */
export function ProgressRing({ size, thickness, value = 0, progress, color, track, children, style }: ProgressRingProps) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const animatedProps = useAnimatedProps(() => {
    const p = progress ? progress.value : value;
    return { strokeDashoffset: c * (1 - Math.max(0, Math.min(1, p))) };
  });
  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Svg width={size} height={size} style={{ position: 'absolute', left: 0, top: 0 }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={thickness} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={thickness}
          fill="none"
          strokeDasharray={`${c} ${c}`}
          animatedProps={animatedProps}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}
