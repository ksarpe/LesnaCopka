import { useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { frameOpacity } from '@/scan/spin';
import { sideViews } from '@/scan/views';
import { findPhotoSource } from '@/services/live/findPhotos';
import type { ScanView } from '@/types';

/** Obrót na piksel przeciągnięcia (°). */
const DEG_PER_PX = 0.45;
/** Tyle pikseli w pionie = pełne przechylenie na ujęcie z góry / przy ziemi. */
const TILT_PX = 110;
/** Po przeciągnięciu obrót samoczynny wraca po tej przerwie. */
const RESUME_MS = 1800;

export type Spin3DTilt = -1 | 0 | 1;

function Frame({ uri, index, azs, angle }: { uri: string; index: number; azs: readonly number[]; angle: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ opacity: frameOpacity(angle.get(), azs, index) }));
  return <Animated.Image source={findPhotoSource(uri)} resizeMode="cover" style={[StyleSheet.absoluteFill, style]} />;
}

/**
 * Podgląd 3D zebranego grzyba ze skanu 3D: klatki z obchodzenia (boki po azymucie) jak obrotowy stolik. Przeciąganie
 * w poziomie obraca grzyba (z bezwładnością), w pionie (`tilt`) – przechyla na ujęcie z góry / przy ziemi. Bez dotyku
 * obraca się sam (`spinMs` – czas pełnego obrotu, 0 = stoi).
 */
export function Spin3D({
  views,
  interactive = true,
  tilt = false,
  tiltTo,
  onTiltChange,
  spinMs = 14_000,
  style,
}: {
  views: readonly ScanView[];
  interactive?: boolean;
  /** Przeciąganie w pionie przechyla na ujęcie z góry / przy ziemi (pełny ekran; w przewijanym ekranie – nie). */
  tilt?: boolean;
  /** Przechylenie sterowane z zewnątrz (przyciski „z góry / z boku / od spodu”). */
  tiltTo?: Spin3DTilt;
  onTiltChange?: (t: Spin3DTilt) => void;
  spinMs?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const sides = useMemo(() => sideViews(views), [views]);
  const azs = useMemo(() => sides.map((v) => v.az), [sides]);
  const top = useMemo(() => views.find((v) => v.kind === 'top'), [views]);
  const low = useMemo(() => views.find((v) => v.kind === 'low'), [views]);
  const minTilt = low ? -1 : 0;
  const maxTilt = top ? 1 : 0;

  const angle = useSharedValue(azs[0] ?? 0);
  const tiltSv = useSharedValue(0);
  const startAngle = useSharedValue(0);
  const startTilt = useSharedValue(0);

  /** Obrót samoczynny od bieżącego kąta (pętla co 360° – ta sama klatka na początku i końcu). */
  const spin = useCallback(
    (delay: number) => {
      'worklet';
      if (!spinMs || azs.length < 2) return;
      const from = angle.get();
      angle.set(
        withDelay(delay, withRepeat(withTiming(from + 360, { duration: spinMs, easing: Easing.linear }), -1, false)),
      );
    },
    [angle, spinMs, azs.length],
  );

  useEffect(() => {
    spin(0);
    return () => cancelAnimation(angle);
  }, [spin, angle]);

  useEffect(() => {
    if (tiltTo != null) tiltSv.set(withSpring(Math.max(minTilt, Math.min(maxTilt, tiltTo)), { damping: 18 }));
  }, [tiltTo, minTilt, maxTilt, tiltSv]);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(interactive && (azs.length > 1 || minTilt !== maxTilt))
      .activeOffsetX([-8, 8])
      .onStart(() => {
        cancelAnimation(angle);
        cancelAnimation(tiltSv);
        startAngle.set(angle.get());
        startTilt.set(tiltSv.get());
      })
      .onUpdate((e) => {
        angle.set(startAngle.get() + e.translationX * DEG_PER_PX);
        if (tilt) tiltSv.set(Math.max(minTilt, Math.min(maxTilt, startTilt.get() - e.translationY / TILT_PX)));
      })
      .onEnd((e) => {
        angle.set(
          withDecay({ velocity: e.velocityX * DEG_PER_PX, deceleration: 0.996 }, (finished) => {
            if (finished) spin(RESUME_MS);
          }),
        );
        if (tilt) {
          const snap = Math.max(minTilt, Math.min(maxTilt, Math.round(tiltSv.get()))) as Spin3DTilt;
          tiltSv.set(withSpring(snap, { damping: 18 }));
          if (onTiltChange) scheduleOnRN(onTiltChange, snap);
        }
      });
    // Pełny ekran: także w pionie; w przewijanym ekranie pionowy ruch oddaje przewijaniu.
    return tilt ? pan.activeOffsetY([-8, 8]) : pan.failOffsetY([-14, 14]);
  }, [interactive, tilt, azs.length, minTilt, maxTilt, angle, tiltSv, startAngle, startTilt, spin, onTiltChange]);

  const topStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, tiltSv.get()) }));
  const lowStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, -tiltSv.get()) }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={[{ overflow: 'hidden' }, style]} accessibilityRole="image" accessibilityLabel="Podgląd 3D grzyba">
        {sides.map((v, i) => (
          <Frame key={v.uri} uri={v.uri} index={i} azs={azs} angle={angle} />
        ))}
        {low ? (
          <Animated.Image source={findPhotoSource(low.uri)} resizeMode="cover" style={[StyleSheet.absoluteFill, lowStyle]} />
        ) : null}
        {top ? (
          <Animated.Image source={findPhotoSource(top.uri)} resizeMode="cover" style={[StyleSheet.absoluteFill, topStyle]} />
        ) : null}
      </View>
    </GestureDetector>
  );
}
