import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, shadows } from '@/theme/tokens';
import { Txt } from './Txt';

interface StatTileProps {
  value: ReactNode;
  label: string;
  /** Analiza: etykieta nad wartością. Podsumowanie: wartość nad etykietą. */
  labelFirst?: boolean;
  valueSize?: number;
  labelSize?: number;
  dark?: boolean;
  radius?: number;
  padding?: { v: number; h: number };
  style?: StyleProp<ViewStyle>;
  valueColor?: string;
}

/** Kafel statystyki: biały, radius 16–18, liczba Baloo 2 + etykieta Nunito 800. */
export function StatTile({
  value,
  label,
  labelFirst,
  valueSize = 24,
  labelSize = 12,
  dark,
  radius = 18,
  padding = { v: 12, h: 14 },
  style,
  valueColor,
}: StatTileProps) {
  const v = (
    <Txt f="b7" size={valueSize} color={valueColor ?? (dark ? colors.xpOnDark : colors.ink)}>
      {value}
    </Txt>
  );
  const l = (
    <Txt f="n8" size={labelSize} color={dark ? colors.onDark : colors.muted} style={dark ? { opacity: 0.85 } : undefined}>
      {label}
    </Txt>
  );
  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: dark ? colors.forest : colors.card,
          borderRadius: radius,
          paddingVertical: padding.v,
          paddingHorizontal: padding.h,
          boxShadow: dark ? shadows.forestSm : shadows.card,
        },
        style,
      ]}
    >
      {labelFirst ? (
        <>
          {l}
          {v}
        </>
      ) : (
        <>
          {v}
          {l}
        </>
      )}
    </View>
  );
}
