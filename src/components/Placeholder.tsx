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

import Svg, { Path } from 'react-native-svg';

import { colors, stripes, type StripeVariant } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';
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

/** Znak na środku kafla: rysowany grzyb (Material Symbols go nie mają) albo dowolna ikona. */
export type PlaceholderGlyph = 'mushroom' | IconName;

/** Spokojny kafel zamiast pasków z makiety (brak zdjęcia): delikatny odcień koloru przewodniego i znak na środku. */
export interface PlaceholderTile {
  /** Kolor przewodni `#RRGGBB` (np. kolor rzadkości) – tło i znak to jego jasne odcienie. */
  tint: string;
  glyph?: PlaceholderGlyph;
  /** Rozmiar znaku w px (domyślnie 32). */
  glyphSize?: number;
  /** Krótki podpis pod znakiem – zwykły tekst interfejsu, nie podpis z makiety. */
  caption?: string;
}

export interface PlaceholderProps {
  label?: string;
  variant?: StripeVariant;
  stripe?: number;
  labelColor?: string;
  /** Gdy jest prawdziwy obraz – pokazujemy go zamiast pasków. */
  source?: ImageSourcePropType;
  /** Bez obrazu: kafel z odcieniem i znakiem zamiast pasków (nie potrzebuje wymiarów – rysuje się od razu). */
  tile?: PlaceholderTile;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  /** Znane wymiary pozwalają narysować paski bez czekania na onLayout. */
  width?: number;
  height?: number;
}

/**
 * Placeholder obrazu: zdjęcie, a bez niego paski z podpisem monospace 11 px (jak w makiecie – ładowanie map itp.)
 * albo, z `tile`, neutralny kafel ze znakiem (miejsca na zdjęcie gracza widoczne w grze).
 */
export function Placeholder({
  label,
  variant = 'sand',
  stripe = 6,
  labelColor,
  source,
  tile,
  style,
  children,
  width,
  height,
}: PlaceholderProps) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(
    width != null && height != null ? { w: width, h: height } : null,
  );
  // Wymiary potrzebne tylko paskom – kafel nie mierzy się (bez drugiego renderu po onLayout).
  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (!size || Math.abs(size.w - w) > 0.5 || Math.abs(size.h - h) > 0.5) setSize({ w, h });
  };
  // Obraz, którego nie da się wczytać (usunięty plik, wygasły blob: na webie) → wracają paski / kafel.
  const [failed, setFailed] = useState<{ key: unknown } | null>(null);
  const key = sourceKey(source);
  const showImage = !!source && !(failed && failed.key === key);
  const pal = stripes[variant];
  return (
    <View onLayout={tile ? undefined : onLayout} style={[styles.base, { backgroundColor: tile ? colors.canvas : pal.a }, style]}>
      {showImage ? (
        <Image source={source} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setFailed({ key })} />
      ) : tile ? (
        <TileFill {...tile} />
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

/** `#RRGGBB` + przezroczystość → `#RRGGBBAA` (inne zapisy koloru bez zmian). */
function withAlpha(hex: string, a: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  return `${hex}${Math.round(Math.min(1, Math.max(0, a)) * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

/** Kafel bez zdjęcia: ukośny, ledwie widoczny gradient odcienia i znak w jego przygaszonym kolorze. */
const TileFill = memo(function TileFill({ tint, glyph = 'mushroom', glyphSize = 32, caption }: PlaceholderTile) {
  const ink = withAlpha(tint, 0.5);
  return (
    <>
      <LinearGradient
        pointerEvents="none"
        colors={[withAlpha(tint, 0.08), withAlpha(tint, 0.22)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={{ alignItems: 'center', gap: 6, paddingHorizontal: 12 }}>
        {glyph === 'mushroom' ? (
          <MushroomGlyph size={glyphSize} color={ink} />
        ) : (
          <Icon name={glyph} filled size={glyphSize} color={ink} />
        )}
        {caption ? (
          <Txt f="n7" size={12} color={colors.muted} align="center">
            {caption}
          </Txt>
        ) : null}
      </View>
    </>
  );
});

/** Sylwetka grzyba (kapelusz + trzon) w siatce 24 px – odpowiednik ikony Material Symbols. */
export function MushroomGlyph({ size = 24, color = colors.ink }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M2.6 11.6C2.6 6.6 6.8 3 12 3s9.4 3.6 9.4 8.6c0 .9-.7 1.6-1.6 1.6H4.2c-.9 0-1.6-.7-1.6-1.6z" fill={color} />
      <Path d="M9.3 14.5h5.4l.6 4.4a2.4 2.4 0 0 1-2.4 2.6h-1.8a2.4 2.4 0 0 1-2.4-2.6z" fill={color} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
