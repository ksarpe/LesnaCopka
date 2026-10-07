import type { IconName } from '@/components/Icon';
import { colors, rarity, tiers } from '@/theme/tokens';

/** Gotowy avatar „motyw grzybowy”: ikona Material na kolorowym kole z palety aplikacji. */
export interface AvatarPreset {
  id: string;
  label: string;
  icon: IconName;
  bg: string;
  fg: string;
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'bor', label: 'Bór', icon: 'forest', bg: colors.forest, fg: colors.xpOnDark },
  { id: 'lisc', label: 'Liść', icon: 'eco', bg: colors.primary, fg: colors.primaryInk },
  { id: 'mech', label: 'Mech', icon: 'grass', bg: rarity.pospolity.color, fg: colors.onDark },
  { id: 'rosa', label: 'Rosa', icon: 'water_drop', bg: rarity.rzadki.color, fg: colors.white },
  { id: 'wrzos', label: 'Wrzos', icon: 'local_florist', bg: rarity.epicki.color, fg: colors.white },
  { id: 'slonce', label: 'Słońce', icon: 'wb_sunny', bg: rarity.legendarny.color, fg: rarity.legendarny.badgeInk },
  { id: 'dab', label: 'Dąb', icon: 'park', bg: tiers.braz.color, fg: tiers.braz.ink },
  { id: 'lis', label: 'Lis', icon: 'pets', bg: colors.questHikeIcon, fg: colors.questHikeBg },
  { id: 'biedronka', label: 'Biedronka', icon: 'pest_control', bg: colors.danger, fg: colors.white },
  { id: 'sowa', label: 'Sowa', icon: 'owl', bg: colors.night, fg: colors.tipIcon },
  { id: 'zajac', label: 'Zając', icon: 'cruelty_free', bg: tiers.platyna.color, fg: tiers.platyna.ink },
  { id: 'wedrowiec', label: 'Wędrowiec', icon: 'hiking', bg: colors.outlineText, fg: colors.badgeCard },
];

export function avatarPreset(id: string | undefined): AvatarPreset | undefined {
  return id ? AVATAR_PRESETS.find((p) => p.id === id) : undefined;
}
