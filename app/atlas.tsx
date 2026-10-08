import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, View, type ListRenderItemInfo } from 'react-native';

import {
  ATLAS_COLUMNS,
  AtlasFilters,
  AtlasGap,
  AtlasTile,
  filterAtlas,
  padToRows,
  useSpeciesPhotos,
  type AtlasFilter,
} from '@/components/Atlas';
import { Card } from '@/components/Card';
import { IconButton } from '@/components/IconButton';
import { StateCard } from '@/components/OfflineCard';
import { ProgressBar } from '@/components/ProgressBar';
import { Screen, SCREEN_LIST_PROPS, useScreenPadding } from '@/components/Screen';
import { Txt } from '@/components/Txt';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useUserStore } from '@/store/useUserStore';
import { colors, rarity as rarityTokens, RARITY_ORDER } from '@/theme/tokens';
import type { Rarity, Species } from '@/types';

/** Krótkie etykiety kolumn (pełne „Legendarny” nie mieści się w ćwiartce karty). */
const RARITY_SHORT: Record<Rarity, string> = { pospolity: 'Pospolite', rzadki: 'Rzadkie', epicki: 'Epickie', legendarny: 'Legendy' };

const cellKey = (s: Species | null, i: number) => (s ? s.id : `e${i}`);

function RowGap() {
  return <View style={{ height: 16 }} />;
}

/**
 * Pełny atlas gatunków (z profilu: „Zobacz wszystko”) – podsumowanie, filtry i cała siatka.
 * Siatka to FlatList (3 kolumny) – ponad sto kafli rysuje się partiami, w miarę przewijania.
 */
export default function AtlasScreen() {
  const atlas = useUserStore((s) => s.atlas);
  const species = useCatalogStore((s) => s.species);
  const total = useCatalogStore((s) => s.totalSpecies);
  const photos = useSpeciesPhotos();
  const found = Object.keys(atlas).length;
  const [filter, setFilter] = useState<AtlasFilter>('all');
  const items = useMemo(() => filterAtlas(species, atlas, filter), [species, atlas, filter]);
  const cells = useMemo(() => padToRows(items), [items]);
  const byRarity = useMemo(
    () =>
      RARITY_ORDER.map((r) => {
        const all = species.filter((s) => s.rarity === r);
        return { rarity: r, found: all.filter((s) => atlas[s.id]).length, total: all.length };
      }),
    [species, atlas],
  );
  const { top, bottom } = useScreenPadding();
  const back = () => (router.canGoBack() ? router.back() : router.navigate('/profil'));

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Species | null>) =>
      item ? <AtlasTile species={item} entry={atlas[item.id]} photoUri={photos[item.id]} /> : <AtlasGap />,
    [atlas, photos],
  );

  const header = (
    <View style={{ gap: 16, paddingBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <IconButton icon="arrow_back" onPress={back} accessibilityLabel="Wróć" />
        <Txt f="b7" size={18}>
          Atlas gatunków
        </Txt>
        <View style={{ width: 44 }} />
      </View>

      <Card radius={22} padding={16} gap={12}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Txt f="b7" size={34} lh={1}>
            {found}
          </Txt>
          <Txt f="b7" size={18} color={colors.disabled}>
            / {total}
          </Txt>
          <Txt f="n7" size={14} color={colors.muted} style={{ marginLeft: 4 }}>
            gatunków odkrytych
          </Txt>
        </View>
        <ProgressBar value={total ? found / total : 0} />
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {byRarity.map((r) => (
            <View key={r.rarity} style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: rarityTokens[r.rarity].color }} />
                <Txt f="n8" size={11} color={colors.muted} numberOfLines={1}>
                  {RARITY_SHORT[r.rarity]}
                </Txt>
              </View>
              <Txt f="b7" size={16}>
                {r.found}
                <Txt f="b7" size={12} color={colors.disabled}>
                  {' '}
                  / {r.total}
                </Txt>
              </Txt>
            </View>
          ))}
        </View>
      </Card>

      <AtlasFilters value={filter} onChange={setFilter} />
    </View>
  );

  const empty =
    filter === 'season' ? (
      // Zima / przedwiośnie: żaden gatunek nie ma teraz wagi sezonu ≥ 0,5.
      <StateCard icon="eco" title="Teraz nic nie jest w pełni sezonu" text="Sezon grzybowy to głównie lipiec–październik – zajrzyj tu wiosną po smardze." />
    ) : (
      <StateCard
        icon={filter === 'missing' ? 'celebration' : 'menu_book'}
        title={found === 0 ? 'Twój atlas jest pusty' : filter === 'missing' ? 'Masz wszystkie gatunki!' : 'Brak gatunków w tej kategorii'}
        text={found === 0 ? 'Zeskanuj pierwszego grzyba – gatunek trafi tutaj.' : 'Zmień filtr albo ruszaj do lasu.'}
        action={found === 0 ? 'Skanuj grzyba' : undefined}
        onAction={() => router.push('/scan')}
      />
    );

  return (
    <Screen list>
      <FlatList
        {...SCREEN_LIST_PROPS}
        style={{ flex: 1 }}
        data={cells}
        numColumns={ATLAS_COLUMNS}
        keyExtractor={cellKey}
        renderItem={renderItem}
        columnWrapperStyle={{ gap: 8 }}
        ItemSeparatorComponent={RowGap}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={{ paddingTop: top + 6, paddingHorizontal: 20, paddingBottom: bottom + 12 }}
        // Liczone w wierszach (po 3 kafle).
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={7}
      />
    </Screen>
  );
}
