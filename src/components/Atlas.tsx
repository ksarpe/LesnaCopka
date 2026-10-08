import { router } from 'expo-router';
import { memo, useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { useFindPhotoSource } from '@/hooks/useFindPhotoSource';
import { useTripStore } from '@/store/useTripStore';
import { ui } from '@/store/useUiStore';
import { colors, rarity as rarityTokens, shadows } from '@/theme/tokens';
import type { AtlasEntry, Species } from '@/types';
import { inSeason } from '@/utils/chances';
import { latestSpeciesPhotos } from '@/utils/findPhoto';
import { Icon } from './Icon';
import { Placeholder } from './Placeholder';
import { isPoisonous } from './SpeciesSheet';
import { Txt } from './Txt';

export type AtlasFilter = 'all' | 'edible' | 'poison' | 'missing' | 'season';

export const ATLAS_FILTERS: { value: AtlasFilter; label: string }[] = [
  { value: 'all', label: 'Wszystkie' },
  { value: 'season', label: 'Teraz w sezonie' },
  { value: 'edible', label: 'Jadalne' },
  { value: 'poison', label: 'Trujące' },
  { value: 'missing', label: 'Brakujące' },
];

/** Bieżący miesiąc 1–12 (filtr i kropka „w sezonie”). */
const currentMonth = () => new Date().getMonth() + 1;

/** `season` – gatunki z wagą bieżącego miesiąca ≥ 0,5 (także nieodkryte – podpowiedź, czego szukać). */
export function filterAtlas(species: Species[], atlas: Record<string, AtlasEntry>, filter: AtlasFilter, month = currentMonth()) {
  return species.filter((s) => {
    const have = !!atlas[s.id];
    if (filter === 'all') return true;
    if (filter === 'season') return inSeason(s, month);
    if (filter === 'missing') return !have;
    if (filter === 'edible') return have && s.edibility === 'jadalny';
    return have && isPoisonous(s.edibility);
  });
}

/** „Pieprznik jadalny (kurka)” → „Pieprznik jadalny” (jak w siatce atlasu). */
function shortName(name: string) {
  return name.replace(/ \(.*\)$/, '');
}

/** Liczba kolumn siatki atlasu. */
export const ATLAS_COLUMNS = 3;

/** Lista kafli dopełniona pustymi miejscami (`null`) do pełnych wierszy – ostatni wiersz nie rozciąga kafli. */
export function padToRows<T>(items: readonly T[], cols = ATLAS_COLUMNS): (T | null)[] {
  const out: (T | null)[] = [...items];
  while (out.length % cols) out.push(null);
  return out;
}

/** Najnowsze zdjęcie gracza każdego gatunku (gatunek → `Find.photoUri`) – liczone raz dla całej siatki. */
export function useSpeciesPhotos(): Record<string, string> {
  const finds = useTripStore((s) => s.finds);
  return useMemo(() => latestSpeciesPhotos(finds), [finds]);
}

/** Siatka 3 kolumn; puste miejsca w ostatnim wierszu wypełnia odstęp (podgląd w profilu – pełny atlas to FlatList). */
export function AtlasGrid({ items, atlas }: { items: Species[]; atlas: Record<string, AtlasEntry> }) {
  const photos = useSpeciesPhotos();
  const cells = padToRows(items);
  const rows: (Species | null)[][] = [];
  for (let i = 0; i < cells.length; i += ATLAS_COLUMNS) rows.push(cells.slice(i, i + ATLAS_COLUMNS));
  return (
    <>
      {rows.map((row, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          {row.map((s, j) =>
            s ? <AtlasTile key={s.id} species={s} entry={atlas[s.id]} photoUri={photos[s.id]} /> : <AtlasGap key={`e${j}`} />,
          )}
        </View>
      ))}
    </>
  );
}

/** Puste miejsce w ostatnim wierszu siatki. */
export function AtlasGap() {
  return <View style={{ flex: 1 }} />;
}

/** Kafel gatunku: zdjęcie gracza (najnowsze znalezisko), bez niego kafel w kolorze rzadkości; nieodkryty – kłódka. */
export const AtlasTile = memo(function AtlasTile({
  species,
  entry,
  photoUri,
}: {
  species: Species;
  entry?: AtlasEntry;
  /** Najnowsze zdjęcie gracza tego gatunku (`useSpeciesPhotos`). */
  photoUri?: string;
}) {
  const locked = !entry;
  const poison = isPoisonous(species.edibility);
  const season = inSeason(species, currentMonth());
  const border = locked ? colors.ringTrack : poison ? colors.danger : rarityTokens[species.rarity].color;
  const source = useFindPhotoSource(locked ? undefined : photoUri);
  let tag: { text: string; bg: string; color: string } | null = null;
  if (!locked) {
    if (species.edibility === 'smiertelny') tag = { text: 'śmiert.', bg: colors.ink, color: colors.white };
    else if (poison) tag = { text: 'trujący', bg: colors.danger, color: colors.white };
    else tag = { text: `×${entry.count}`, bg: colors.white, color: colors.ink };
  }
  return (
    <Pressable
      onPress={() =>
        locked
          ? ui.toast(season ? 'Nieodkryty gatunek – teraz jest w sezonie, szukaj!' : 'Jeszcze nieodkryty gatunek – szukaj dalej!', 'lock')
          : router.push(`/species/${species.id}`)
      }
      accessibilityLabel={`${locked ? 'Nieodkryty gatunek' : shortName(species.name)}${season ? ', teraz w sezonie' : ''}`}
      style={({ pressed }) => ({
        flex: 1,
        backgroundColor: colors.card,
        borderRadius: 18,
        paddingTop: 6,
        paddingHorizontal: 6,
        paddingBottom: 10,
        gap: 6,
        boxShadow: shadows.card,
        borderBottomWidth: 4,
        borderBottomColor: border,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ aspectRatio: 1, borderRadius: 13, overflow: 'hidden' }}>
        {locked ? (
          <View style={{ flex: 1, backgroundColor: colors.lockedBg, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="lock" size={26} color={colors.disabled} />
          </View>
        ) : (
          <Placeholder source={source} tile={{ tint: border, glyph: 'mushroom', glyphSize: 34 }} style={{ flex: 1 }} />
        )}
        {season ? (
          // Kropka „teraz w sezonie” (waga bieżącego miesiąca ≥ 0,5) – jak w pigułce filtra.
          <View style={{ position: 'absolute', left: 6, top: 6, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.white }} />
        ) : null}
        {tag ? (
          <View
            style={{
              position: 'absolute',
              right: 5,
              top: 5,
              backgroundColor: tag.bg,
              borderRadius: 999,
              paddingVertical: 1,
              paddingHorizontal: 6,
            }}
          >
            <Txt f="n8" size={10} color={tag.color}>
              {tag.text}
            </Txt>
          </View>
        ) : null}
      </View>
      <Txt f="n8" size={12} lh={1.15} color={locked ? colors.disabled : colors.ink} style={{ paddingHorizontal: 2 }}>
        {locked ? '???' : shortName(species.name)}
      </Txt>
    </Pressable>
  );
});

/** Pigułki filtrów atlasu (jak w makiecie 08) – przewijane w poziomie (5 filtrów nie mieści się w wąskim ekranie). */
export function AtlasFilters({ value, onChange }: { value: AtlasFilter; onChange: (f: AtlasFilter) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -20, flexGrow: 0 }}
      contentContainerStyle={{ gap: 6, paddingHorizontal: 20 }}
    >
      {ATLAS_FILTERS.map((f) => {
        const active = f.value === value;
        return (
          <Pressable
            key={f.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(f.value)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              backgroundColor: active ? colors.ink : colors.card,
              borderRadius: 999,
              paddingVertical: 6,
              paddingHorizontal: 12,
            }}
          >
            {f.value === 'season' ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }} /> : null}
            <Txt f="n8" size={13} color={active ? colors.bg : colors.ink}>
              {f.label}
            </Txt>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
