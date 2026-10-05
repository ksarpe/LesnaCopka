import { Text, type StyleProp, type TextStyle } from 'react-native';

import { colors, fonts } from '@/theme/tokens';
import { ICON_CODEPOINTS, type IconName } from './iconCodepoints';

export type { IconName };

interface IconProps {
  name: IconName;
  /** FILL 1 (wersja wypełniona) – w pliku ikony akcentowe. */
  filled?: boolean;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}

/**
 * Material Symbols Rounded (wght 500, opsz 24). Statyczne TTF dla FILL 0 i FILL 1,
 * glyph wybierany przez codepoint PUA (bez zależności od ligatur).
 */
export function Icon({ name, filled, size = 24, color = colors.ink, style }: IconProps) {
  const cp = ICON_CODEPOINTS[name];
  return (
    <Text
      allowFontScaling={false}
      accessible={false}
      selectable={false}
      style={[
        {
          fontFamily: filled ? fonts.iconFilled : fonts.icon,
          fontSize: size,
          lineHeight: size,
          width: size,
          height: size,
          color,
          textAlign: 'center',
          includeFontPadding: false,
        },
        style,
      ]}
    >
      {String.fromCodePoint(cp)}
    </Text>
  );
}
