import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { Button3D } from '@/components/Button3D';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { SpeciesSeasonSection } from '@/components/SpeciesSeason';
import {
  GminaSeasonCard,
  isPoisonous,
  LookalikeList,
  PoisonBanner,
  ProtectedBanner,
  Sheet,
  SpeciesAbout,
  SpeciesHero,
  SpeciesTags,
  SpeciesTitle,
  StatGrid,
} from '@/components/SpeciesSheet';
import { Txt } from '@/components/Txt';
import { useAsync } from '@/hooks/useAsync';
import { useServices } from '@/services';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useTripStore } from '@/store/useTripStore';
import { useUserStore } from '@/store/useUserStore';
import { colors } from '@/theme/tokens';
import { latestSpeciesPhoto } from '@/utils/findPhoto';
import { fmtDayMonth, fmtWeight } from '@/utils/format';
import { speciesLookalikes } from '@/utils/species';

/** Karta gatunku z atlasu – layout ekranu Analiza w trybie tylko do odczytu. */
export default function SpeciesScreen() {
  const { speciesId } = useLocalSearchParams<{ speciesId: string }>();
  const { stats } = useServices();
  const species = useCatalogStore((s) => s.speciesById[speciesId]);
  const entry = useUserStore((s) => s.atlas[speciesId]);
  // Najnowsze zdjęcie gracza tego gatunku (z aparatu) – zamiast paskowanego placeholdera.
  const photoUri = useTripStore((s) => latestSpeciesPhoto(s.finds, speciesId));
  const homeId = useUserStore((s) => s.user.homeGminaId);
  const gmina = useCatalogStore((s) => s.gminaById[homeId]);
  const typical = species?.typical;
  const pct = useAsync(
    () =>
      stats.getSpeciesPercentile(speciesId, homeId, {
        capCm: entry?.bestCapCm || typical?.capCm || 0,
        heightCm: typical?.heightCm ?? 0,
        weightG: entry?.bestWeightG || typical?.weightG || 0,
        ageDays: 0,
      }),
    [speciesId],
  );

  const back = () => (router.canGoBack() ? router.back() : router.navigate('/profil'));

  if (!species) {
    return (
      <Screen>
        <View style={{ padding: 20, gap: 12 }}>
          <Txt f="b7" size={24}>
            Nie znaleziono gatunku
          </Txt>
          <Button3D title="Wróć" onPress={back} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen hero>
      <SpeciesHero rarity={species.rarity} onBack={back} label={entry ? 'zdjęcie z Twojego atlasu' : 'zdjęcie gatunku'} photoUri={photoUri} />
      <Sheet>
        <SpeciesTitle species={species} />
        <SpeciesTags species={species} />
        {isPoisonous(species.edibility) ? <PoisonBanner deadly={species.edibility === 'smiertelny'} /> : null}
        {species.protection ? <ProtectedBanner protection={species.protection} /> : null}
        <SpeciesAbout species={species} />
        <LookalikeList lookalikes={speciesLookalikes(species)} />
        {/* ── Sezon i występowanie (wykres sezonu + mapa gatunku w województwie) – model szans (src/utils/chances.ts). ── */}
        <SpeciesSeasonSection species={species} />
        <StatGrid
          items={[
            { label: 'W atlasie', value: entry ? `×${entry.count}` : '—' },
            { label: 'Rekord: kapelusz', value: entry?.bestCapCm ? `${entry.bestCapCm} cm` : `~${species.typical.capCm} cm` },
            { label: 'Rekord: waga', value: entry?.bestWeightG ? fmtWeight(entry.bestWeightG) : `~${fmtWeight(species.typical.weightG)}` },
            { label: 'Typowa wysokość', value: `${species.typical.heightCm} cm` },
          ]}
        />
        <GminaSeasonCard
          gminaName={gmina?.name ?? '—'}
          data={pct.data}
          loading={pct.loading}
          error={!!pct.error}
          emptyText="Nikt jeszcze nie zebrał tu tego gatunku w tym sezonie."
        />
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 4, paddingBottom: 8 }}>
          <Icon name="menu_book" size={16} color={colors.muted} />
          <Txt f="n6" size={12} color={colors.muted} style={{ flex: 1 }}>
            {entry ? `W Twoim atlasie od ${fmtDayMonth(new Date(entry.firstFoundAt))}.` : 'Tego gatunku nie masz jeszcze w atlasie.'}
          </Txt>
        </View>
      </Sheet>
    </Screen>
  );
}
