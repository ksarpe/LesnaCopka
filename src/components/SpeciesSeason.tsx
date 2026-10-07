import { router } from 'expo-router';
import { Fragment, useMemo } from 'react';
import { View } from 'react-native';

import { useRegionStore } from '@/hooks/useRegion';
import { useSpeciesMap } from '@/hooks/useSpeciesChances';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useUserStore } from '@/store/useUserStore';
import { colors, heat as heatColors, shadows } from '@/theme/tokens';
import type { Species } from '@/types';
import {
  HABITAT_LABEL,
  habitatsOf,
  IN_SEASON,
  MONTH_INITIALS,
  MONTH_NAMES,
  peakLabel,
  SEASON_PHASE_LABEL,
  seasonPhase,
  seasonWeightsOf,
  type SeasonPhase,
} from '@/utils/chances';
import { localYmd } from '@/utils/forecast';
import { plural } from '@/utils/format';
import { Icon } from './Icon';
import { Pill } from './Pill';
import { Bone } from './Skeleton';
import { Txt } from './Txt';
import { VoivodeshipHeatmap } from './VoivodeshipHeatmap';

const CHART_H = 56;

/** Kolory pigułki fazy sezonu: szczyt i w sezonie – zielona, skraj / poza – neutralna. */
const PHASE_PILL: Record<SeasonPhase, { bg: string; color: string }> = {
  peak: { bg: colors.primaryTint, color: colors.primaryTintText },
  start: { bg: colors.primaryTint, color: colors.primaryTintText },
  in: { bg: colors.primaryTint, color: colors.primaryTintText },
  end: { bg: colors.streakBg, color: colors.streakText },
  edge: { bg: colors.canvas, color: colors.tagNeutralText },
  off: { bg: colors.canvas, color: colors.tagNeutralText },
};

/** Podpowiedź na mapie dla gmin spoza „Najczęściej w” (znamy tylko stopień). */
const LEVEL_TIP: Record<number, string> = { 4: 'dużo zbiorów', 3: 'sporo zbiorów', 2: 'trochę zbiorów', 1: 'pojedyncze zbiory' };

/**
 * Sekcja „Sezon i występowanie” karty gatunku: wykres 12 miesięcy z `seasonWeights` (bieżący miesiąc wyróżniony),
 * szczyt sezonu i faza teraz, siedliska (gdy nie pokazuje ich już karta „O gatunku”) oraz mapa województwa – gdzie
 * gatunek zbiera się w tym sezonie (agregaty gmin z ≥ 2 znalazcami, StatsService.getSpeciesMap).
 */
export function SpeciesSeasonSection({ species }: { species: Species }) {
  const weights = useMemo(() => seasonWeightsOf(species), [species]);
  const today = localYmd();
  const month = Number(today.slice(5, 7)) - 1;
  const phase = seasonPhase(weights, today);
  // Karta „O gatunku” (SpeciesSheet.SpeciesAbout) pokazuje siedliska, gdy gatunek ma opis albo listę siedlisk.
  const showHabitats = !species.description && !species.habitats?.length;
  return (
    <View style={{ gap: 10 }}>
      <Txt f="b7" size={18}>
        Sezon i występowanie
      </Txt>
      <View
        style={{ backgroundColor: colors.card, borderRadius: 22, padding: 16, gap: 12, boxShadow: shadows.card }}
        accessible
        accessibilityLabel={`Sezon: szczyt ${peakLabel(weights)}. Teraz (${MONTH_NAMES[month]}): ${SEASON_PHASE_LABEL[phase].toLowerCase()}.`}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt f="n8" size={14} style={{ flex: 1 }}>
            Szczyt: {peakLabel(weights)}
          </Txt>
          <Pill label={SEASON_PHASE_LABEL[phase]} padH={10} {...PHASE_PILL[phase]} />
        </View>
        <SeasonChart weights={weights} month={month} />
        {showHabitats ? (
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {habitatsOf(species).map((h) => (
              <Pill key={h} label={HABITAT_LABEL[h]} padH={10} bg={colors.canvas} color={colors.tagNeutralText} />
            ))}
          </View>
        ) : null}
      </View>
      <SpeciesMapBlock species={species} />
    </View>
  );
}

/** 12 słupków (I–XII): wysokość = waga sezonu, w sezonie (≥ 0,5) – zielone, bieżący miesiąc – ciemny z pogrubioną literą. */
export function SeasonChart({ weights, month }: { weights: readonly number[]; month: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {weights.map((w, i) => {
        const now = i === month;
        const bg = now ? colors.primaryShadow : w >= IN_SEASON ? heatColors[3] : w > 0.05 ? heatColors[1] : colors.track;
        return (
          <View key={i} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            <View style={{ height: CHART_H, width: '100%', justifyContent: 'flex-end' }}>
              <View style={{ height: Math.max(3, Math.round(w * CHART_H)), borderRadius: 5, backgroundColor: bg }} />
            </View>
            <Txt f={now ? 'n8' : 'n7'} size={11} color={now ? colors.primaryText : colors.muted}>
              {MONTH_INITIALS[i]}
            </Txt>
          </View>
        );
      })}
    </View>
  );
}

/** Mapa gatunku w województwie (bieżące z ekranu Gminy) + „Najczęściej w: …”; brak danych / offline – stany. */
function SpeciesMapBlock({ species }: { species: Species }) {
  const map = useSpeciesMap(species.id, 'season');
  const v = map.voivodeship;
  const regionGmina = useRegionStore((s) => s.region?.gmina);
  const homeId = useUserStore((s) => s.user.homeGminaId);
  const homeVoivodeship = useCatalogStore((s) => s.gminaById[homeId]?.voivodeship);
  const mineId = regionGmina?.voivodeship === v ? regionGmina.id : homeVoivodeship === v ? homeId : null;
  const data = map.data;
  const tips = useMemo(() => {
    if (!data) return undefined;
    const out: Record<string, string> = {};
    for (const [id, level] of Object.entries(data.heat)) out[id] = LEVEL_TIP[level] ?? '';
    for (const t of data.top) out[t.gminaId] = `${t.finds} ${plural(t.finds, 'okaz', 'okazy', 'okazów')}`;
    return out;
  }, [data]);
  const empty = !!data && (data.total === 0 || !Object.keys(data.heat).length);

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}>
        <Icon name="map" size={16} color={colors.muted} />
        <Txt f="n8" size={13} color={colors.muted} style={{ flex: 1 }} numberOfLines={1}>
          Gdzie zbierany w tym sezonie · {v}
        </Txt>
      </View>
      {map.error && !data ? (
        <MapState icon="wifi_off" text="Mapa gatunku będzie dostępna, gdy wróci zasięg." />
      ) : empty ? (
        <MapState
          icon="map"
          text={`Brak zbiorów tego gatunku w tym sezonie (województwo ${v}). Gmina pojawia się na mapie 24 h po wyprawach, gdy znajdzie go w niej co najmniej 2 grzybiarzy.`}
        />
      ) : (
        <>
          <VoivodeshipHeatmap
            voivodeship={v}
            heat={data?.heat}
            tips={tips}
            mineId={mineId}
            defaultId={data?.top[0]?.gminaId}
            loading={!data}
          />
          {data ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 4 }}>
              <Icon name="location_on" size={16} color={colors.primaryText} />
              <Txt f="n7" size={13} color={colors.bodyDark} style={{ flex: 1 }}>
                <Txt f="n8" size={13}>
                  Najczęściej w:{' '}
                </Txt>
                {data.top.slice(0, 3).map((t, i) => (
                  <Fragment key={t.gminaId}>
                    {i ? ', ' : ''}
                    <Txt f="n8" size={13} color={colors.primaryText} onPress={() => router.push(`/gminy/${t.gminaId}`)}>
                      {t.name}
                    </Txt>
                  </Fragment>
                ))}
              </Txt>
            </View>
          ) : (
            <Bone w="70%" h={14} style={{ marginHorizontal: 4 }} />
          )}
        </>
      )}
    </View>
  );
}

function MapState({ icon, text }: { icon: 'map' | 'wifi_off'; text: string }) {
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 22,
        padding: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        boxShadow: shadows.card,
      }}
    >
      <Icon name={icon} size={26} color={colors.muted} />
      <Txt f="n7" size={13} color={colors.muted} style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}
