import { router } from 'expo-router';
import { memo, useCallback, useDeferredValue, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/Card';
import { ChoiceChips } from '@/components/ChoiceChips';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { LocalOnlyNote } from '@/components/LocalOnlyNote';
import { StateCard } from '@/components/OfflineCard';
import { Pill } from '@/components/Pill';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { TextField } from '@/components/TextField';
import { Thumb } from '@/components/Thumb';
import { Txt } from '@/components/Txt';
import { useBottomPadding } from '@/hooks/useInsets';
import { hasSpin } from '@/scan/views';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useTripStore } from '@/store/useTripStore';
import { useUserStore } from '@/store/useUserStore';
import { colors, rarity as rarityTokens, RARITY_ORDER, shadows } from '@/theme/tokens';
import type { Find, Rarity } from '@/types';
import { fmtDayMonth, fmtInt, fmtWeight, gminaTitle, plural } from '@/utils/format';
import {
  claimedFinds,
  FIND_FILTERS,
  FIND_SORTS,
  filterFinds,
  findsSummary,
  missingCount,
  sortFinds,
  type FindFilter,
  type FindSort,
} from '@/utils/history';

/** Krótkie etykiety rzadkości (jak podsumowanie Atlasu). */
const RARITY_SHORT: Record<Rarity, string> = { pospolity: 'Pospolite', rzadki: 'Rzadkie', epicki: 'Epickie', legendarny: 'Legendy' };

const EMPTY_FILTER_TEXT: Record<FindFilter, string> = {
  all: 'Zmień wyszukiwanie albo filtr.',
  edible: 'Jadalne grzyby z Twoich wypraw pojawią się tutaj.',
  rare: 'Rzadkie, epickie i legendarne okazy pojawią się tutaj.',
  poison: 'Zdjęcia trujących gatunków (bez zbierania) pojawią się tutaj.',
};

const grzyby = (n: number) => plural(n, 'grzyb', 'grzyby', 'grzybów');

/**
 * Dziennik znalezisk (z Profilu: kafel „grzybów”) – wszystkie odebrane znaleziska z telefonu z filtrami,
 * wyszukiwaniem po nazwie gatunku i sortowaniem. Tap → karta gatunku.
 */
export default function FindsJournalScreen() {
  const finds = useTripStore((s) => s.finds);
  const speciesById = useCatalogStore((s) => s.speciesById);
  const gminaById = useCatalogStore((s) => s.gminaById);
  const mushroomsCount = useUserStore((s) => s.user.mushroomsCount);
  const bottom = useBottomPadding();
  const [filter, setFilter] = useState<FindFilter>('all');
  const [sort, setSort] = useState<FindSort>('newest');
  const [query, setQuery] = useState('');
  // Setki wierszy: lista filtruje się w tle, pole tekstowe nie czeka na przeliczenie.
  const deferredQuery = useDeferredValue(query);

  const all = useMemo(() => claimedFinds(finds), [finds]);
  const summary = useMemo(() => findsSummary(all), [all]);
  const visible = useMemo(
    () => sortFinds(filterFinds(all, filter, deferredQuery, (id) => speciesById[id]), sort),
    [all, filter, deferredQuery, sort, speciesById],
  );
  const missing = missingCount(mushroomsCount, summary.mushrooms);
  const filtered = filter !== 'all' || query.trim() !== '';

  const back = () => (router.canGoBack() ? router.back() : router.navigate('/profil'));
  const clear = () => {
    setFilter('all');
    setQuery('');
  };
  const renderItem = useCallback(
    ({ item }: { item: Find }) => (
      <FindRow
        find={item}
        name={speciesById[item.speciesId]?.name ?? 'Nieznany gatunek'}
        place={gminaTitle(gminaById[item.gminaId])}
      />
    ),
    [speciesById, gminaById],
  );

  const header = all.length ? (
    <View style={{ gap: 12, paddingBottom: 12 }}>
      <Card radius={22} padding={16} gap={12}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Txt f="b7" size={34} lh={1}>
            {fmtInt(summary.mushrooms)}
          </Txt>
          <Txt f="n7" size={14} color={colors.muted} style={{ flex: 1 }} numberOfLines={1}>
            {grzyby(summary.mushrooms)} · {summary.species} {plural(summary.species, 'gatunek', 'gatunki', 'gatunków')}
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {RARITY_ORDER.map((r) => (
            <View key={r} style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: rarityTokens[r].color }} />
                <Txt f="n8" size={11} color={colors.muted} numberOfLines={1}>
                  {RARITY_SHORT[r]}
                </Txt>
              </View>
              <Txt f="b7" size={16}>
                {fmtInt(summary.byRarity[r])}
              </Txt>
            </View>
          ))}
        </View>
        {summary.photoOnly ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="photo_camera" size={16} color={colors.danger} />
            <Txt f="n7" size={12} color={colors.dangerText} style={{ flex: 1 }}>
              + {summary.photoOnly} {plural(summary.photoOnly, 'zdjęcie', 'zdjęcia', 'zdjęć')} gatunków trujących i chronionych (bez zbierania)
            </Txt>
          </View>
        ) : null}
      </Card>

      <SegmentedControl options={FIND_FILTERS} value={filter} onChange={setFilter} />
      <TextField
        icon="search"
        value={query}
        onChangeText={setQuery}
        placeholder="Szukaj gatunku…"
        accessibilityLabel="Szukaj gatunku"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        right={
          query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Wyczyść wyszukiwanie">
              <Icon name="cancel" filled size={20} color={colors.disabled} />
            </Pressable>
          ) : null
        }
      />
      <ChoiceChips options={FIND_SORTS} value={sort} onChange={setSort} />
      {filtered && visible.length ? (
        <Txt f="n7" size={12} color={colors.muted} style={{ paddingHorizontal: 4 }}>
          {fmtInt(visible.length)} {plural(visible.length, 'znalezisko', 'znaleziska', 'znalezisk')} z {fmtInt(all.length)}
        </Txt>
      ) : null}
    </View>
  ) : null;

  return (
    <Screen scroll={false}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 6,
          paddingHorizontal: 20,
          paddingBottom: 10,
        }}
      >
        <IconButton icon="arrow_back" onPress={back} accessibilityLabel="Wróć" />
        <Txt f="b7" size={18}>
          Dziennik znalezisk
        </Txt>
        <View style={{ width: 44 }} />
      </View>
      <FlatList
        style={{ flex: 1 }}
        data={visible}
        keyExtractor={(f) => f.id}
        renderItem={renderItem}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={header}
        ListEmptyComponent={
          all.length === 0 ? (
            <StateCard
              icon="photo_camera"
              title="Dziennik jest jeszcze pusty"
              text="Zeskanuj pierwszego grzyba – każde znalezisko trafi tutaj."
              action="Skanuj grzyba"
              onAction={() => router.push('/scan')}
            />
          ) : (
            <StateCard
              icon="search"
              title="Nic tu nie ma"
              text={query.trim() ? `Brak znalezisk pasujących do „${query.trim()}”.` : EMPTY_FILTER_TEXT[filter]}
              action="Pokaż wszystkie"
              onAction={clear}
            />
          )
        }
        ListFooterComponent={
          missing > 0 ? (
            <LocalOnlyNote
              title="Starsze znaleziska nie są dostępne na tym urządzeniu."
              text={`Profil liczy ${fmtInt(mushroomsCount)} ${grzyby(mushroomsCount)}, tutaj ${summary.mushrooms === 0 ? 'nie ma żadnego' : `widać ${fmtInt(summary.mushrooms)}`}.`}
            />
          ) : null
        }
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottom }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={9}
      />
    </Screen>
  );
}

function Separator() {
  return <View style={{ height: 10 }} />;
}

/** Mała pigułka rzadkości do wiersza listy (RarityPill jest na zdjęcia – za duża). */
function SmallRarityPill({ rarity }: { rarity: Rarity }) {
  const r = rarityTokens[rarity];
  return (
    <Pill
      label={
        <Txt f="b7" size={11} lh={1.3} color={colors.rarityInk} upper ls={0.06}>
          {r.label}
        </Txt>
      }
      icon="diamond"
      iconFilled
      iconSize={12}
      iconColor={colors.rarityInk}
      bg={r.color}
      padV={1}
      padH={8}
      gap={3}
    />
  );
}

/** Wiersz znaleziska: zdjęcie, gatunek, rzadkość, waga / sztuki (albo „tylko zdjęcie”), data i gmina, XP. */
const FindRow = memo(function FindRow({ find, name, place }: { find: Find; name: string; place: string }) {
  const r = rarityTokens[find.rarity];
  const d = find.dimensions;
  const amount = d.pieces ? `${d.pieces} szt.` : fmtWeight(d.weightG);
  const date = fmtDayMonth(new Date(find.foundAt));
  const spin = hasSpin(find.views);
  const thumb = <Thumb size={56} radius={16} borderColor={r.color} uri={find.photoUri} />;
  return (
    <View style={styles.row}>
      {spin ? (
        // Skan 3D: miniatura otwiera podgląd 3D, reszta wiersza – kartę gatunku (dwa przyciski obok siebie, nie
        // zagnieżdżone – web nie pozwala na <button> w <button>).
        <Pressable
          onPress={() => router.push(`/podglad3d/${find.id}`)}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`Podgląd 3D: ${name}`}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
        >
          {thumb}
          <View style={styles.badge3d}>
            <Icon name="3d_rotation" size={14} color={colors.white} />
          </View>
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => router.push(`/species/${find.speciesId}`)}
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${r.labelLower}, ${find.collected ? amount : 'tylko zdjęcie'}, ${date}`}
        style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.9 : 1 })}
      >
        {spin ? null : thumb}
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Txt f="n8" size={15} numberOfLines={1} style={{ flex: 1 }}>
              {name}
            </Txt>
            <Txt f="n8" size={13} color={colors.primaryText}>
              +{fmtInt(find.xp?.total ?? 0)}
            </Txt>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <SmallRarityPill rarity={find.rarity} />
            <Txt f="n8" size={12} color={find.collected ? colors.bodyDark : colors.danger} numberOfLines={1} style={{ flex: 1 }}>
              {find.collected ? `${amount}${find.xxl ? ' · XXL' : ''}` : 'Tylko zdjęcie'}
            </Txt>
          </View>
          <Txt f="n7" size={12} color={colors.muted} numberOfLines={1}>
            {place ? `${date} · ${place}` : date}
          </Txt>
        </View>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 12,
    boxShadow: shadows.card,
  },
  badge3d: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primaryText,
    borderWidth: 2,
    borderColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
