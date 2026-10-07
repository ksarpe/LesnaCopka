import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { OfflineCard, StateCard } from '@/components/OfflineCard';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { Bone, SkeletonRow } from '@/components/Skeleton';
import { Txt } from '@/components/Txt';
import { VoivodeshipHeatmap } from '@/components/VoivodeshipHeatmap';
import { VoivodeshipPicker } from '@/components/VoivodeshipPicker';
import { DESIGN_VOIVODESHIP } from '@/geo/voivodeships';
import { useAsync } from '@/hooks/useAsync';
import { useRegionStore } from '@/hooks/useRegion';
import { useVoivodeship } from '@/hooks/useVoivodeship';
import { useServices } from '@/services';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useSimStore } from '@/store/useSimStore';
import { useStatsSync } from '@/store/useStatsSync';
import { useUserStore } from '@/store/useUserStore';
import { useVoivodeshipStore } from '@/store/useVoivodeshipStore';
import { colors, medalDefault, medals, shadows } from '@/theme/tokens';
import type { Ranking, RankingPeriod, RankingRow } from '@/types';
import { fmtInt, plural } from '@/utils/format';

export default function GminyScreen() {
  const { stats } = useServices();
  // Tryb Supabase: ranking z bazy – puste stany, opóźnienie prywatności 24 h; podlaskie bez rankingu z makiety.
  const live = !!stats.live;
  const [period, setPeriod] = useState<RankingPeriod>('week');
  const network = useSimStore((s) => s.networkEnabled);
  const version = useStatsSync((s) => s.version);
  const { voivodeship, picked, detected } = useVoivodeship();
  const [pickerOpen, setPickerOpen] = useState(false);
  const ranking = useAsync(() => stats.getRanking(period, { voivodeship }), [period, network, voivodeship, version]);
  // Podczas zmiany województwa nie pokazujemy rankingu poprzedniego.
  const data = ranking.data && (ranking.data.voivodeship ?? voivodeship) === voivodeship ? ranking.data : undefined;
  const design = voivodeship === DESIGN_VOIVODESHIP && !live;
  const homeId = useSimStore((s) => s.forcedGminaId) ?? useUserStore.getState().user.homeGminaId;
  const regionGmina = useRegionStore((s) => s.region?.gmina);
  const homeVoivodeship = useCatalogStore((s) => s.gminaById[homeId]?.voivodeship);
  // Poza podlaskim „Twoja gmina” = wykryta z lokalizacji albo domowa, jeśli leży w tym województwie.
  const mineId = regionGmina?.voivodeship === voivodeship ? regionGmina.id : homeVoivodeship === voivodeship ? homeId : null;

  return (
    <Screen tabs>
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Txt f="b7" size={30}>
            Gminy
          </Txt>
          <Pressable
            onPress={() => setPickerOpen(true)}
            accessibilityLabel={`Województwo ${voivodeship} – zmień`}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              backgroundColor: colors.card,
              borderRadius: 999,
              paddingVertical: 7,
              paddingHorizontal: 12,
              boxShadow: shadows.card,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Txt f="n8" size={14}>
              {voivodeship}
            </Txt>
            <Icon name="expand_more" size={18} />
          </Pressable>
        </View>

        <SegmentedControl
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'week', label: 'Tydzień' },
            { value: 'season', label: 'Sezon' },
            { value: 'records', label: 'Rekordy' },
          ]}
        />

        {ranking.error ? (
          <OfflineCard onRetry={ranking.reload} />
        ) : (
          // Podlaskie (makieta): „Twoja gmina” = domowa / z symulacji jak w pliku; inne – wykryta albo domowa.
          <VoivodeshipView key={voivodeship} voivodeship={voivodeship} data={data} mineId={design ? homeId : mineId} live={live} />
        )}
      </View>
      <VoivodeshipPicker
        visible={pickerOpen}
        value={voivodeship}
        picked={picked}
        detected={detected}
        onPick={(v) => useVoivodeshipStore.getState().pick(v)}
        onClose={() => setPickerOpen(false)}
      />
    </Screen>
  );
}

const PAGE = 10;

/** „w tym tygodniu” / „w tym sezonie” (rekordy liczą się w sezonie). */
const PERIOD_PHRASE: Record<RankingPeriod, string> = { week: 'w tym tygodniu', season: 'w tym sezonie', records: 'w tym sezonie' };

/** Pusty ranking z bazy (tryb Supabase): nikt w województwie nie ma jeszcze punktów w okresie. */
const EMPTY_TEXT: Record<RankingPeriod, string> = {
  week: 'W tym tygodniu nikt jeszcze nie zbierał w tym województwie – bądź pierwszy!',
  season: 'W tym sezonie nikt jeszcze nie zbierał w tym województwie – bądź pierwszy!',
  records: 'W tym sezonie nikt jeszcze nie ustanowił tu rekordu – bądź pierwszy!',
};

/**
 * Województwo: mapa cieplna z konturów PRG (przybliżana), ranking – w podlaskim 5 gmin z makiety,
 * w pozostałych wszystkie gminy (pierwsza dziesiątka + „Twoja gmina” + dociąganie kolejnych).
 * Tryb Supabase (`live`): tylko gminy z punktami w okresie, pusty stan i podpis o opóźnieniu 24 h.
 */
function VoivodeshipView({ voivodeship, data, mineId, live }: { voivodeship: string; data?: Ranking; mineId: string | null; live: boolean }) {
  const [limit, setLimit] = useState(PAGE);
  const rows = data?.rows;
  const mine = rows?.find((r) => r.gminaId === mineId);
  const period = data?.period ?? 'week';
  return (
    <>
      <VoivodeshipHeatmap
        voivodeship={voivodeship}
        heat={data?.heat}
        mushroomers={data?.mushroomers}
        mineId={mineId}
        defaultId={rows?.[0]?.gminaId}
        loading={!data}
      />
      <LeaderBanner rows={rows} homeId={mineId} contribution={data?.userContribution} live={live} period={period} />
      <View style={{ gap: 8, paddingBottom: 8 }}>
        {!rows ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
        ) : live && !rows.length ? (
          <StateCard icon="emoji_events" title="Ranking jest jeszcze pusty" text={EMPTY_TEXT[period]} />
        ) : (
          <>
            {rows.slice(0, limit).map((r) => (
              <RankRow key={r.gminaId} row={r} mine={r.gminaId === mineId} />
            ))}
            {mine && mine.rank > limit ? (
              <>
                <Txt f="b7" size={18} color={colors.faint} align="center" lh={1}>
                  ⋯
                </Txt>
                <RankRow row={mine} mine />
              </>
            ) : null}
            {rows.length > limit ? (
              <Pressable
                onPress={() => setLimit((l) => l + 2 * PAGE)}
                style={({ pressed }) => ({
                  borderRadius: 18,
                  borderWidth: 2.5,
                  borderColor: colors.outline,
                  paddingVertical: 11,
                  alignItems: 'center',
                  backgroundColor: pressed ? colors.outlineHover : 'transparent',
                })}
              >
                <Txt f="b7" size={16} color={colors.outlineText}>
                  Pokaż kolejne gminy ({rows.length - limit})
                </Txt>
              </Pressable>
            ) : null}
          </>
        )}
        {live && rows ? (
          // Prywatność: serwer liczy rankingi z XP starszych niż 24 h – świeża wyprawa dojdzie później.
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 4, paddingTop: 2 }}>
            <Icon name="schedule" size={16} color={colors.muted} />
            <Txt f="n6" size={12} color={colors.muted} style={{ flex: 1 }}>
              Ranking uwzględnia wyprawy sprzed 24 h – tak chronimy lokalizację grzybiarzy.
            </Txt>
          </View>
        ) : null}
      </View>
    </>
  );
}

/** Tytuł banera z bazy: miejsce gminy gracza albo brak punktów w okresie (ranking ma tylko gminy z punktami). */
function liveTitle(rows: RankingRow[], homeId: string | null, period: RankingPeriod): string {
  const what = period === 'records' ? 'rekordów' : 'punktów';
  const mine = rows.find((r) => r.gminaId === homeId);
  if (!homeId) {
    return rows.length
      ? `${fmtInt(rows.length)} ${plural(rows.length, 'gmina walczy', 'gminy walczą', 'gmin walczy')} o podium!`
      : `Żadna gmina nie ma jeszcze ${what} ${PERIOD_PHRASE[period]}`;
  }
  if (!mine) return `Twoja gmina nie ma jeszcze ${what} ${PERIOD_PHRASE[period]}`;
  return mine.rank === 1 ? 'Twoja gmina prowadzi w województwie!' : `Twoja gmina jest ${mine.rank}. w województwie`;
}

function LeaderBanner({
  rows,
  homeId,
  contribution,
  live,
  period,
}: {
  rows?: RankingRow[];
  homeId: string | null;
  contribution?: number;
  live: boolean;
  period: RankingPeriod;
}) {
  const gmina = useCatalogStore((s) => (homeId ? s.gminaById[homeId] : undefined));
  if (!rows) {
    return (
      <View style={{ backgroundColor: colors.forest, borderRadius: 20, padding: 14, gap: 8, boxShadow: shadows.forest }}>
        <Bone w="70%" h={14} style={{ backgroundColor: 'rgba(255,255,255,0.15)' }} />
        <Bone w="50%" h={12} style={{ backgroundColor: 'rgba(255,255,255,0.15)' }} />
      </View>
    );
  }
  const mine = rows.find((r) => r.gminaId === homeId);
  const title = live
    ? liveTitle(rows, homeId, period)
    : !homeId
      ? `${fmtInt(rows.length)} ${plural(rows.length, 'gmina walczy', 'gminy walczą', 'gmin walczy')} o podium!`
      : !mine
        ? `Gmina ${gmina?.name} walczy o podium!`
        : mine.rank === 1
          ? 'Twoja gmina prowadzi w województwie!'
          : `Twoja gmina jest na ${mine.rank}. miejscu!`;
  // Mocki: zawsze wkład tygodnia (makieta); z bazą – wkład w okresie rankingu (rekordy: w sezonie).
  const contributionLabel = live ? `Twój wkład ${PERIOD_PHRASE[period]}` : 'Twój wkład w tym tygodniu';
  return (
    <View
      style={{
        backgroundColor: colors.forest,
        borderRadius: 20,
        padding: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        boxShadow: shadows.forest,
      }}
    >
      <Icon name="emoji_events" filled size={30} color={medals[0]} />
      <View style={{ flex: 1 }}>
        <Txt f="n8" size={14} color={colors.onDark}>
          {title}
        </Txt>
        <Txt f="n7" size={12} color={colors.onDark} style={{ opacity: 0.85 }}>
          {contributionLabel}: {fmtInt(contribution ?? 0)} pkt
        </Txt>
      </View>
    </View>
  );
}

function RankRow({ row, mine }: { row: RankingRow; mine: boolean }) {
  const trend = row.trend == null || row.trend === 0 ? '–' : row.trend > 0 ? `▲ ${row.trend}` : `▼ ${-row.trend}`;
  const trendC = row.trend == null || row.trend === 0 ? colors.faint : row.trend > 0 ? colors.primaryText : colors.trendDown;
  return (
    <Pressable
      onPress={() => router.push(`/gminy/${row.gminaId}`)}
      style={({ pressed }) => ({
        backgroundColor: pressed ? '#FDFBF6' : colors.card,
        borderRadius: 18,
        paddingVertical: 12,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        boxShadow: shadows.card,
        borderWidth: 2.5,
        borderColor: mine ? colors.primary : 'transparent',
      })}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          backgroundColor: medals[row.rank - 1] ?? medalDefault,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Txt f="b7" size={16}>
          {row.rank}
        </Txt>
      </View>
      <View style={{ flex: 1 }}>
        <Txt f="n8" size={15}>
          {row.name}
        </Txt>
        <Txt f="n7" size={12} color={colors.muted}>
          {row.sub}
        </Txt>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Txt f="b7" size={17}>
          {row.points}
        </Txt>
        <Txt f="n8" size={12} color={trendC}>
          {trend}
        </Txt>
      </View>
    </Pressable>
  );
}
