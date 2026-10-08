import { useEffect, useId, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, ClipPath, Defs, G, Path, Rect } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { colors } from '@/theme/tokens';

import { Txt } from './Txt';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

/** Sylwetka grzyba w siatce 48 × 52: kapelusz i trzon. */
const VB_W = 48;
const VB_H = 52;
const CAP = 'M4 25C4 13 13 4 24 4s20 9 20 21c0 2.5-1.6 4-4 4H8c-2.4 0-4-1.5-4-4Z';
const STEM = 'M17.5 29h13l1.6 14.5c.3 3-1.8 5.5-4.8 5.5h-6.6c-3 0-5.1-2.5-4.8-5.5Z';
/** Wypełnienie od dołu trzonu (y = 49) po czubek kapelusza (y = 4). */
const FILL_BOTTOM = 49;
const FILL_SPAN = 45;

/**
 * Skan 3D: grzybek w rogu ekranu wypełniający się na zielono od dołu do góry – postęp obchodzenia (0..1,
 * src/scan/orbit.ts). Pełny = analiza rusza sama (wtedy delikatnie pulsuje).
 */
export function MushroomMeter({
  progress,
  done,
  width = 52,
  style,
}: {
  progress: SharedValue<number>;
  done?: boolean;
  width?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const clipId = `mm${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [pct, setPct] = useState(0);
  const pulse = useSharedValue(1);

  useAnimatedReaction(
    () => Math.round(Math.max(0, Math.min(1, progress.get())) * 100),
    (v, prev) => {
      if (v !== prev) scheduleOnRN(setPct, v);
    },
  );

  useEffect(() => {
    pulse.set(
      done
        ? withRepeat(withSequence(withTiming(1.12, { duration: 260 }), withTiming(1, { duration: 260 })), 2, false)
        : withTiming(1, { duration: 120 }),
    );
  }, [done, pulse]);

  const fillProps = useAnimatedProps(() => {
    const h = FILL_SPAN * Math.max(0, Math.min(1, progress.get()));
    return { y: FILL_BOTTOM - h, height: h };
  });
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.get() }] }));

  const height = (width * VB_H) / VB_W;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Postęp skanu 3D"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={[{ alignItems: 'center', gap: 4 }, style]}
    >
      <Animated.View style={pulseStyle}>
        <Svg width={width} height={height} viewBox={`0 0 ${VB_W} ${VB_H}`}>
          <Defs>
            <ClipPath id={clipId}>
              <Path d={CAP} />
              <Path d={STEM} />
            </ClipPath>
          </Defs>
          <G clipPath={`url(#${clipId})`}>
            <Rect x={0} y={0} width={VB_W} height={VB_H} fill="rgba(255,255,255,0.18)" />
            <AnimatedRect x={0} width={VB_W} fill={colors.scanGreen} animatedProps={fillProps} />
          </G>
          <Circle cx={15} cy={17} r={2.6} fill="rgba(255,255,255,0.55)" />
          <Circle cx={27} cy={11} r={2} fill="rgba(255,255,255,0.55)" />
          <Circle cx={33} cy={20} r={2.8} fill="rgba(255,255,255,0.55)" />
          <Path d={CAP} fill="none" stroke={colors.onDark} strokeWidth={2.2} strokeLinejoin="round" />
          <Path d={STEM} fill="none" stroke={colors.onDark} strokeWidth={2.2} strokeLinejoin="round" />
        </Svg>
      </Animated.View>
      <Txt f="mono" size={11} color={pct >= 100 ? colors.scanGreen : colors.onDark}>
        {pct}%
      </Txt>
    </View>
  );
}
