import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, rarity as rarityTokens, shadows } from '@/theme/tokens';
import type { Rarity } from '@/types';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

interface PillProps {
  label: ReactNode;
  bg?: string;
  color?: string;
  icon?: IconName;
  iconFilled?: boolean;
  iconSize?: number;
  iconColor?: string;
  size?: number;
  padV?: number;
  padH?: number;
  gap?: number;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed';
  shadow?: string;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  font?: 'n8' | 'b7';
}

/** Pigułka (radius 999) – tagi, prognozy, seria dni, chipy. */
export function Pill({
  label,
  bg = colors.primaryTint,
  color = colors.primaryTintText,
  icon,
  iconFilled,
  iconSize = 16,
  iconColor,
  size = 13,
  padV = 5,
  padH = 10,
  gap = 5,
  borderColor,
  borderWidth,
  borderStyle,
  shadow,
  style,
  onPress,
  font = 'n8',
}: PillProps) {
  const body = (
    <>
      {icon ? <Icon name={icon} filled={iconFilled} size={iconSize} color={iconColor ?? color} /> : null}
      {typeof label === 'string' ? (
        <Txt f={font} size={size} color={color}>
          {label}
        </Txt>
      ) : (
        label
      )}
    </>
  );
  const s: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap,
    backgroundColor: bg,
    borderRadius: 999,
    paddingVertical: padV,
    paddingHorizontal: padH,
    borderColor,
    borderWidth,
    borderStyle,
    boxShadow: shadow,
  };
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [s, style, pressed && { opacity: 0.85 }]}>
        {body}
      </Pressable>
    );
  }
  return <View style={[s, style]}>{body}</View>;
}

/** Pigułka rzadkości na zdjęciu: Baloo 2 700, wersaliki, letterSpacing 0.08em. */
export function RarityPill({ rarity, style, size = 14 }: { rarity: Rarity; style?: StyleProp<ViewStyle>; size?: number }) {
  const r = rarityTokens[rarity];
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: 6,
          backgroundColor: r.color,
          borderRadius: 999,
          paddingVertical: 7,
          paddingHorizontal: 13,
          boxShadow: shadows.pill,
        },
        style,
      ]}
    >
      <Icon name="diamond" filled size={16} color={colors.rarityInk} />
      <Txt f="b7" size={size} color={colors.rarityInk} upper ls={0.08}>
        {r.label}
      </Txt>
    </View>
  );
}
