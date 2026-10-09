import { useEffect } from 'react';
import { View } from 'react-native';

import { useFindPhotoSource } from '@/hooks/useFindPhotoSource';
import { requestRemotePhoto, useRemotePhotoUrls } from '@/services/supabase/remotePhotos';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useTripStore } from '@/store/useTripStore';
import { colors, rarity as rarityTokens, shadows } from '@/theme/tokens';
import type { DuelSide } from '@/types';
import { fmtCm, fmtPct } from '@/utils/duels';
import { Placeholder } from './Placeholder';
import { Txt } from './Txt';

/**
 * Najlepszy okaz strony pojedynku „Największy okaz”: zdjęcie, gatunek, kapelusz i % typowego. Zdjęcie: własny okaz –
 * z telefonu (Find.photoUri); tryb Supabase – podpisany adres z prywatnego koszyka (polityka Storage pozwala
 * uczestnikom pojedynku czytać zdjęcia najlepszych okazów); mocki / bez zdjęcia – kafel w kolorze rzadkości.
 */
export function DuelBestFind({ best, mine, label }: { best: NonNullable<DuelSide['best']>; mine: boolean; label: string }) {
  const species = useCatalogStore((s) => s.speciesById[best.speciesId]);
  const localUri = useTripStore((s) => (mine ? s.finds[best.findId]?.photoUri : undefined));
  const local = useFindPhotoSource(localUri);
  const path = !localUri ? best.photoPath : null;
  const url = useRemotePhotoUrls((s) => (path ? s.urls[path]?.url : undefined));
  useEffect(() => {
    if (path) requestRemotePhoto(path);
  }, [path]);
  const source = local ?? (url ? { uri: url } : undefined);
  const tint = species ? rarityTokens[species.rarity].color : colors.primary;
  return (
    <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: 18, overflow: 'hidden', boxShadow: shadows.card }}>
      <Placeholder source={source} tile={{ tint, glyph: 'mushroom', glyphSize: 40 }} style={{ height: 110 }} />
      <View style={{ padding: 10, gap: 2 }}>
        <Txt f="n7" size={11} color={colors.muted} upper ls={0.04}>
          {label}
        </Txt>
        <Txt f="n8" size={14} numberOfLines={2}>
          {species?.name ?? best.speciesId}
        </Txt>
        <Txt f="b7" size={18} color={colors.primaryText} lh={1.2}>
          {fmtPct(best.relativePct)}
        </Txt>
        <Txt f="n6" size={12} color={colors.muted}>
          kapelusz {fmtCm(best.capCm)}
          {species ? ` (typowy ${fmtCm(species.typical.capCm)})` : ''}
        </Txt>
      </View>
    </View>
  );
}
