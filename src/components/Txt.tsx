import { Platform, Text, type TextProps, type TextStyle } from 'react-native';

import { colors, fonts, lineHeightRatio, type FontKey } from '@/theme/tokens';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, monospace' });

export interface TxtProps extends TextProps {
  /** Krój: b7/b8 = Baloo 2, n6/n7/n8 = Nunito Sans, mono = placeholdery. */
  f?: 'b7' | 'b8' | 'n4' | 'n6' | 'n6i' | 'n7' | 'n8' | 'mono';
  size?: number;
  color?: string;
  /** Jawna wysokość linii w px albo mnożnik (< 4) jak w CSS. */
  lh?: number;
  /** letter-spacing w em. */
  ls?: number;
  upper?: boolean;
  align?: TextStyle['textAlign'];
}

const KEY: Record<NonNullable<TxtProps['f']>, FontKey> = {
  b7: 'baloo700',
  b8: 'baloo800',
  n4: 'nunito400',
  n6: 'nunito600',
  n6i: 'nunito600i',
  n7: 'nunito700',
  n8: 'nunito800',
  mono: 'mono',
};

/** Tekst z jawnym lineHeight (Baloo 2 ma wysokie metryki – patrz tokens.lineHeightRatio). */
export function Txt({ f = 'n7', size = 14, color = colors.ink, lh, ls, upper, align, style, ...rest }: TxtProps) {
  const key = KEY[f];
  const lineHeight = lh == null ? size * lineHeightRatio[key] : lh < 4 ? size * lh : lh;
  return (
    <Text
      allowFontScaling={false}
      {...rest}
      style={[
        {
          fontFamily: key === 'mono' ? MONO : fonts[key],
          fontSize: size,
          lineHeight,
          color,
          letterSpacing: ls ? ls * size : undefined,
          textTransform: upper ? 'uppercase' : undefined,
          textAlign: align,
          includeFontPadding: false,
        },
        style,
      ]}
    />
  );
}
