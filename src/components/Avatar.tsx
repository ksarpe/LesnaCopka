import { useMemo, useState } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { avatarPreset } from '@/data/avatars';
import { resolveAvatarUri } from '@/services/live/avatarPhoto';
import { colors, rarity as rarityTokens } from '@/theme/tokens';
import type { PostAuthor, UserAvatar } from '@/types';
import { Icon } from './Icon';
import { Placeholder } from './Placeholder';

interface AvatarProps {
  size: number;
  ringColor?: string;
  ringWidth?: number;
  stripe?: number;
  variant?: 'sand' | 'forestAvatar';
  /** Avatar gracza (zdjęcie / motyw). Brak = paskowany placeholder z makiety. */
  avatar?: UserAvatar;
  style?: StyleProp<ViewStyle>;
}

/** Okrągły avatar z kolorową obwódką (kolor rzadkości lub zielony): zdjęcie, motyw albo placeholder. */
export function Avatar({ size, ringColor = colors.primary, ringWidth = 3, stripe = 5, variant = 'sand', avatar, style }: AvatarProps) {
  // Uszkodzony plik zdjęcia (np. usunięty z dysku) → wracamy do placeholdera zamiast pustego koła.
  const [brokenUri, setBrokenUri] = useState<string | null>(null);
  const preset = avatar?.kind === 'preset' ? avatarPreset(avatar.id) : undefined;
  const photoUri = avatar?.kind === 'photo' ? avatar.uri : undefined;
  const resolved = useMemo(() => (photoUri ? resolveAvatarUri(photoUri) : undefined), [photoUri]);
  const photo = resolved && resolved !== brokenUri ? resolved : undefined;
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, borderWidth: ringWidth, borderColor: ringColor, overflow: 'hidden' },
        preset && { backgroundColor: preset.bg, alignItems: 'center', justifyContent: 'center' },
        style,
      ]}
    >
      {photo ? (
        <Image
          source={{ uri: photo }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setBrokenUri(photo)}
          accessibilityIgnoresInvertColors
        />
      ) : preset ? (
        <Icon name={preset.icon} filled size={Math.round((size - ringWidth * 2) * 0.52)} color={preset.fg} />
      ) : (
        <Placeholder variant={variant} stripe={stripe} style={{ flex: 1 }} />
      )}
    </View>
  );
}

export function authorRingColor(a: PostAuthor) {
  return a.ringRarity === 'primary' ? colors.primary : rarityTokens[a.ringRarity].color;
}
