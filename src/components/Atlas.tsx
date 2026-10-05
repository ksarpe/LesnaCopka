import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { ui } from '@/store/useUiStore';
import { colors, rarity as rarityTokens, shadows } from '@/theme/tokens';
import type { AtlasEntry, Species } from '@/types';
import { Icon } from './Icon';
import { Placeholder } from './Placeholder';
import { isPoisonous } from './SpeciesSheet';
import { Txt } from './Txt';

export type AtlasFilter = 'all' | 'edible' | 'poison' | 'missing';

export const ATLAS_FILTERS: { value: AtlasFilter; label: string }[] = [
  { value: 'all', label: 'Wszystkie' },
  { value: 'edible', label: 'Jadalne' },
  { value: 'poison', label: 'Trujące' },
  { value: 'missing', label: 'Brakujące' },
];

export function filterAtlas(species: Species[], atlas: Record<string, AtlasEntry>, filter: AtlasFilter) {
  return species.filter((s) => {
    const have = !!atlas[s.id];
    if (filter === 'all') return true;
    if (filter === 'missing') return !have;
    if (filter === 'edible') return have && s.edibility === 'jadalny';
    return have && isPoisonous(s.edibility);
  });
}

/** „Pieprznik jadalny (kurka)” → „Pieprznik jadalny” (jak w siatce atlasu). */
function shortName(name: string) {
  return name.replace(/ \(.*\)$/, '');
}

/** Siatka 3 kolumn; puste miejsca w ostatnim wierszu wypełnia odstęp. */
export function AtlasGrid({ items, atlas }: { items: Species[]; atlas: Record<string, AtlasEntry> }) {
  const rows: (Species | null)[][] = [];
  for (let i = 0; i < items.length; i += 3) {
    const row: (Species | null)[] = items.slice(i, i + 3);
    while (row.length < 3) row.push(null);
    rows.push(row);
  }
  return (
    <>
      {rows.map((row, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          {row.map((s, j) => (s ? <AtlasTile key={s.id} species={s} entry={atlas[s.id]} /> : <View key={`e${j}`} style={{ flex: 1 }} />))}
        </View>
      ))}
    </>
  );
}

export function AtlasTile({ species, entry }: { species: Species; entry?: AtlasEntry }) {
  const locked = !entry;
  const poison = isPoisonous(species.edibility);
  const border = locked ? colors.ringTrack : poison ? colors.danger : rarityTokens[species.rarity].color;
  let tag: { text: string; bg: string; color: string } | null = null;
  if (!locked) {
    if (species.edibility === 'smiertelny') tag = { text: 'śmiert.', bg: colors.ink, color: colors.white };
    else if (poison) tag = { text: 'trujący', bg: colors.danger, color: colors.white };
    else tag = { text: `×${entry.count}`, bg: colors.white, color: colors.ink };
  }
  return (
    <Pressable
      onPress={() =>
        locked ? ui.toast('Jeszcze nieodkryty gatunek – szukaj dalej!', 'lock') : router.push(`/species/${species.id}`)
      }
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
          <Placeholder variant="sand" stripe={6} style={{ flex: 1 }} />
        )}
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
}

/** Pigułki filtrów atlasu (jak w makiecie 08). */
export function AtlasFilters({ value, onChange }: { value: AtlasFilter; onChange: (f: AtlasFilter) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {ATLAS_FILTERS.map((f) => {
        const active = f.value === value;
        return (
          <Pressable
            key={f.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(f.value)}
            style={{
              backgroundColor: active ? colors.ink : colors.card,
              borderRadius: 999,
              paddingVertical: 6,
              paddingHorizontal: 12,
            }}
          >
            <Txt f="n8" size={13} color={active ? colors.bg : colors.ink}>
              {f.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
