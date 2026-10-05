import { View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, rarity as rarityTokens } from '@/theme/tokens';
import type { PostAuthor } from '@/types';
import { Placeholder } from './Placeholder';

interface AvatarProps {
  size: number;
  ringColor?: string;
  ringWidth?: number;
  stripe?: number;
  variant?: 'sand' | 'forestAvatar';
  style?: StyleProp<ViewStyle>;
}

/** Okrągły avatar-placeholder z kolorową obwódką (kolor rzadkości lub zielony). */
export function Avatar({ size, ringColor = colors.primary, ringWidth = 3, stripe = 5, variant = 'sand', style }: AvatarProps) {
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, borderWidth: ringWidth, borderColor: ringColor, overflow: 'hidden' },
        style,
      ]}
    >
      <Placeholder variant={variant} stripe={stripe} style={{ flex: 1 }} />
    </View>
  );
}

export function authorRingColor(a: PostAuthor) {
  return a.ringRarity === 'primary' ? colors.primary : rarityTokens[a.ringRarity].color;
}
