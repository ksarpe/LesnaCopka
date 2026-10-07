import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, View } from 'react-native';

import { Button3D } from '@/components/Button3D';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import {
  GminaSeasonCard,
  isPoisonous,
  PoisonBanner,
  ProtectedBanner,
  SafetyBanner,
  Sheet,
  SpeciesHero,
  SpeciesTags,
  SpeciesTitle,
  StatGrid,
} from '@/components/SpeciesSheet';
import { Txt } from '@/components/Txt';
import { useAsync } from '@/hooks/useAsync';
import { useServices } from '@/services';
import { claimFind, discardPendingFind } from '@/store/game';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useTripStore } from '@/store/useTripStore';
import { colors, shadows } from '@/theme/tokens';
import type { Find } from '@/types';
import { fmtWeight } from '@/utils/format';
import { speciesLookalikes } from '@/utils/species';

const LOW_CONFIDENCE = 0.6;

export default function AnalysisScreen() {
  const { findId } = useLocalSearchParams<{ findId: string }>();
  const find = useTripStore((s) => s.finds[findId]);
  const claimingRef = useRef(false);

  // Wyjście bez odebrania nagrody (gest wstecz) – porzucamy oczekujące znalezisko.
  useEffect(
    () => () => {
      if (!claimingRef.current) discardPendingFind(findId);
    },
    [findId],
  );

  if (!find) {
    return (
      <Screen>
        <View style={{ padding: 20, gap: 12 }}>
          <Txt f="b7" size={24}>
            Nie znaleziono skanu
          </Txt>
          <Button3D title="Wróć" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }
  if (find.confidence < LOW_CONFIDENCE) return <LowConfidence find={find} />;
  return <AnalysisBody find={find} onClaimStart={() => (claimingRef.current = true)} />;
}

function rescan(findId: string) {
  discardPendingFind(findId);
  router.replace('/scan');
}

function AnalysisBody({ find, onClaimStart }: { find: Find; onClaimStart: () => void }) {
  const { stats } = useServices();
  const species = useCatalogStore((s) => s.speciesById[find.speciesId]);
  const gmina = useCatalogStore((s) => s.gminaById[find.gminaId]);
  const pct = useAsync(
    () => stats.getSpeciesPercentile(find.speciesId, find.gminaId, find.dimensions),
    [find.id],
  );
  const poison = isPoisonous(species.edibility);
  // Trujący albo chroniony – tylko zdjęcie (decyzja z createPendingFind: collected = false).
  const photoOnly = poison || !find.collected;
  const d = find.dimensions;

  const claim = () => {
    onClaimStart();
    const claimed = claimFind(find.id);
    if (claimed) router.replace(`/reward/${claimed.id}`);
  };

  return (
    <Screen hero>
      <SpeciesHero
        rarity={find.rarity}
        confidence={find.confidence}
        photoUri={find.photoUri}
        onBack={() => rescan(find.id)}
      />
      <Sheet>
        <SpeciesTitle species={species} />
        <SpeciesTags species={species} xxl={find.xxl && !photoOnly} />
        {poison ? <PoisonBanner deadly={species.edibility === 'smiertelny'} /> : null}
        {species.protection ? <ProtectedBanner protection={species.protection} /> : null}
        <SafetyBanner lookalikes={speciesLookalikes(species)} />
        <StatGrid
          items={[
            { label: 'Kapelusz Ø', value: `${d.capCm} cm` },
            { label: 'Wysokość', value: `${d.heightCm} cm` },
            d.pieces
              ? { label: 'Kępka', value: `${d.pieces} szt.` }
              : { label: 'Szac. waga', value: `~${fmtWeight(d.weightG)}` },
            { label: 'Wiek owocnika', value: `~${d.ageDays} dni` },
          ]}
        />
        <GminaSeasonCard gminaName={gmina?.name ?? '—'} data={pct.data} loading={pct.loading} error={!!pct.error} />
        {photoOnly ? (
          <Button3D title="Zapisz w atlasie" icon="photo_library" onPress={claim} style={{ marginBottom: 8 }} />
        ) : (
          <Button3D title="Odbierz nagrodę" icon="redeem" onPress={claim} style={{ marginBottom: 8 }} />
        )}
      </Sheet>
    </Screen>
  );
}

function LowConfidence({ find }: { find: Find }) {
  const byId = useCatalogStore((s) => s.speciesById);
  const candidates = find.candidates?.length ? find.candidates : [{ speciesId: find.speciesId, confidence: find.confidence }];
  return (
    <Screen hero>
      <SpeciesHero
        rarity={find.rarity}
        confidence={find.confidence}
        lowConfidence
        label="niewyraźne ujęcie"
        photoUri={find.photoUri}
        onBack={() => rescan(find.id)}
      />
      <Sheet>
        <View style={{ gap: 6 }}>
          <Txt f="b7" size={30} lh={1.1}>
            Nie jestem pewien
          </Txt>
          <Txt f="n6" size={15} color={colors.muted}>
            Zeskanuj ponownie – obejdź grzyba dookoła i odsłoń podstawę trzonu. Przy pewności poniżej 60% nie przyznajemy
            nagrody, żeby nie pomylić gatunków.
          </Txt>
        </View>
        <View
          style={{ backgroundColor: colors.card, borderRadius: 22, padding: 16, gap: 12, boxShadow: shadows.card }}
        >
          <Txt f="b7" size={18}>
            Możliwe gatunki
          </Txt>
          {candidates.map((c) => {
            const sp = byId[c.speciesId];
            const p = Math.round(c.confidence * 100);
            return (
              <View key={c.speciesId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Txt f="n7" size={13} style={{ width: 150 }} numberOfLines={1}>
                  {sp?.name}
                </Txt>
                <View style={{ flex: 1, height: 12, borderRadius: 999, backgroundColor: colors.track, overflow: 'hidden' }}>
                  <View style={{ width: `${p}%`, height: '100%', borderRadius: 999, backgroundColor: colors.warnBorder }} />
                </View>
                <Txt f="n8" size={13} color={colors.muted} style={{ width: 38, textAlign: 'right' }}>
                  {p}%
                </Txt>
              </View>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 4 }}>
          <Icon name="tips_and_updates" size={16} color={colors.muted} />
          <Txt f="n6" size={12} color={colors.muted} style={{ flex: 1 }}>
            Najlepiej skanować w rozproszonym świetle, bez ostrych cieni na kapeluszu.
          </Txt>
        </View>
        <Button3D title="Zeskanuj ponownie" icon="restart_alt" onPress={() => rescan(find.id)} />
        <Pressable
          onPress={() => {
            discardPendingFind(find.id);
            router.back();
          }}
          style={{ alignSelf: 'center', padding: 6, marginBottom: 8 }}
        >
          <Txt f="n8" size={14} color={colors.muted}>
            Wróć do wyprawy
          </Txt>
        </Pressable>
      </Sheet>
    </Screen>
  );
}
