import { LinearGradient } from 'expo-linear-gradient';
import { memo, useMemo, useState, type ReactNode } from 'react';
import {
  Image,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { stripes, type StripeVariant } from '@/theme/tokens';
import { Txt } from './Txt';

interface StripesProps {
  variant: StripeVariant;
  /** Szerokość jednego paska w px (w CSS: `a 0 Npx, b Npx 2Npx`). */
  stripe: number;
  width: number;
  height: number;
}

/**
 * `repeating-linear-gradient(135deg, a 0 N, b N 2N)` odtworzony expo-linear-gradient:
 * kwadrat zakotwiczony w lewym górnym rogu → oś gradientu dokładnie 45°,
 * a odległość punktu (x,y) od początku wynosi (x+y)/√2 – identycznie jak w CSS.
 */
export const Stripes = memo(function Stripes({ variant, stripe, width, height }: StripesProps) {
  const { a, b } = stripes[variant];
  const side = Math.max(width, height);
  const grad = useMemo(() => {
    const length = side * Math.SQRT2;
    const period = stripe * 2;
    const n = Math.max(1, Math.ceil(length / period));
    const cols: string[] = [];
    const locs: number[] = [];
    for (let i = 0; i < n; i++) {
      const s = Math.min(1, (i * period) / length);
      const m = Math.min(1, (i * period + stripe) / length);
      const e = Math.min(1, ((i + 1) * period) / length);
      cols.push(a, a, b, b);
      locs.push(s, m, m, e);
    }
    return { cols: cols as unknown as readonly [string, string, ...string[]], locs: locs as unknown as readonly [number, number, ...number[]] };
  }, [a, b, side, stripe]);
  if (side <= 0) return null;
  return (
    <LinearGradient
      pointerEvents="none"
      colors={grad.cols}
      locations={grad.locs}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ position: 'absolute', left: 0, top: 0, width: side, height: side }}
    />
  );
});

export interface PlaceholderProps {
  label?: string;
  variant?: StripeVariant;
  stripe?: number;
  labelColor?: string;
  /** Gdy jest prawdziwy obraz – pokazujemy go zamiast pasków. */
  source?: ImageSourcePropType;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  /** Znane wymiary pozwalają narysować paski bez czekania na onLayout. */
  width?: number;
  height?: number;
}

/** Paskowany placeholder obrazu z podpisem monospace 11 px – dokładnie jak w makiecie. */
export function Placeholder({
  label,
  variant = 'sand',
  stripe = 6,
  labelColor,
  source,
  style,
  children,
  width,
  height,
}: PlaceholderProps) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(
    width != null && height != null ? { w: width, h: height } : null,
  );
  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (!size || Math.abs(size.w - w) > 0.5 || Math.abs(size.h - h) > 0.5) setSize({ w, h });
  };
  // Obraz, którego nie da się wczytać (usunięty plik, wygasły blob: na webie) → wracają paski.
  const [failed, setFailed] = useState<{ key: unknown } | null>(null);
  const key = sourceKey(source);
  const showImage = !!source && !(failed && failed.key === key);
  const pal = stripes[variant];
  return (
    <View onLayout={onLayout} style={[styles.base, { backgroundColor: pal.a }, style]}>
      {showImage ? (
        <Image source={source} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setFailed({ key })} />
      ) : (
        size && <Stripes variant={variant} stripe={stripe} width={size.w} height={size.h} />
      )}
      {label && !showImage ? (
        <Txt f="mono" size={11} color={labelColor ?? pal.label} align="center" lh={1.25}>
          {label}
        </Txt>
      ) : null}
      {children}
    </View>
  );
}

/** Tożsamość źródła obrazu (URI albo id zasobu) – do zapamiętania błędu wczytania. */
function sourceKey(source?: ImageSourcePropType): unknown {
  if (source == null || typeof source === 'number') return source;
  return Array.isArray(source) ? source[0]?.uri : source.uri;
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
