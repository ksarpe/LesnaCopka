import { Pressable, View } from 'react-native';

import { colors, shadows } from '@/theme/tokens';
import type { Badge as BadgeModel } from '@/types';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

interface BadgeCircleProps {
  badge: BadgeModel;
  locked?: boolean;
  size?: number;
  iconSize?: number;
}

/** Okrągła odznaka z wewnętrznym cieniem `inset 0 -4px 0`; zablokowana = przerywana ramka + kłódka. */
export function BadgeCircle({ badge, locked, size = 56, iconSize }: BadgeCircleProps) {
  if (locked) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.chip,
          borderWidth: 2,
          borderStyle: 'dashed',
          borderColor: colors.lockedBorder,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="lock" size={iconSize ?? 24} color={colors.disabled} />
      </View>
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: badge.color,
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: shadows.badgeInset,
      }}
    >
      <Icon name={badge.icon as IconName} filled size={iconSize ?? Math.round(size / 2)} color={badge.iconColor} />
    </View>
  );
}

export function BadgeItem({ badge, locked, onPress }: { badge: BadgeModel; locked?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ alignItems: 'center', gap: 5, width: 62 }}>
      <BadgeCircle badge={badge} locked={locked} />
      <Txt f="n8" size={11} lh={1.1} align="center" color={locked ? colors.faint : colors.ink}>
        {badge.name}
      </Txt>
    </Pressable>
  );
}
