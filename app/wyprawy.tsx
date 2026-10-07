import { router, type Href } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, SectionList, View } from 'react-native';

import { Card } from '@/components/Card';
import { ChoiceChips } from '@/components/ChoiceChips';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { LocalOnlyNote } from '@/components/LocalOnlyNote';
import { StateCard } from '@/components/OfflineCard';
import { Pill } from '@/components/Pill';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { Thumb } from '@/components/Thumb';
import { Txt } from '@/components/Txt';
import { useBottomPadding } from '@/hooks/useInsets';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useTripStore } from '@/store/useTripStore';
import { useUserStore } from '@/store/useUserStore';
import { colors, rarity as rarityTokens, shadows } from '@/theme/tokens';
import { fmtDurationShort, fmtInt, fmtKm, gminaTitle, plural } from '@/utils/format';
import {
  fmtTripDay,
  groupByMonth,
  historyTrips,
  missingCount,
  tripRange,
  tripRows,
  tripSeason,
  tripSeasons,
  tripTotals,
  type MonthSection,
  type TripRow,
} from '@/utils/history';

type Season = number | 'all';

const wyprawy = (n: number) => plural(n, 'wyprawa', 'wyprawy', 'wypraw');

/**
 * Historia wypraw (z Profilu: kafel „wyprawy”) – zakończone i opublikowane wyprawy z telefonu, od najnowszej,
 * w sekcjach miesięcy; na górze sumy wybranego sezonu. Tap → Podsumowanie wyprawy.
 */
export default function TripsHistoryScreen() {
  const trips = useTripStore((s) => s.trips);
  const finds = useTripStore((s) => s.finds);
  const hasActiveTrip = useTripStore((s) => !!s.activeTripId);
  const gminaById = useCatalogStore((s) => s.gminaById);
  const tripsCount = useUserStore((s) => s.user.tripsCount);
  const bottom = useBottomPadding();

  const rows = useMemo(() => tripRows(historyTrips(trips), finds), [trips, finds]);
  const seasons = useMemo(() => tripSeasons(rows.map((r) => r.trip)), [rows]);
  const [picked, setPicked] = useState<Season | null>(null);
  // Domyślnie najnowszy sezon; wybrany sezon, którego już nie ma (np. po resecie) → najnowszy.
  const season: Season = picked === 'all' || (picked != null && seasons.includes(picked)) ? picked : (seasons[0] ?? 'all');
  const visible = useMemo(() => (season === 'all' ? rows : rows.filter((r) => tripSeason(r.trip) === season)), [rows, season]);
  const sections = useMemo(() => groupByMonth(visible, (r) => r.trip.startedAt), [visible]);
  const totals = useMemo(() => tripTotals(visible), [visible]);
  const seasonOptions = useMemo(
    () => [...seasons.map((y) => ({ value: y as Season, label: String(y) })), { value: 'all' as Season, label: 'Wszystkie' }],
    [seasons],
  );
  const missing = missingCount(tripsCount, rows.length);

  const back = () => (router.canGoBack() ? router.back() : router.navigate('/profil'));
  const renderItem = useCallback(
    ({ item }: { item: TripRow }) => <TripHistoryRow row={item} place={gminaTitle(gminaById[item.trip.gminaId]) || 'Nieznana gmina'} />,
    [gminaById],
  );
  const renderSectionHeader = useCallback(
    ({ section }: { section: MonthSection<TripRow> }) => (
      <View style={{ backgroundColor: colors.bg, paddingTop: 14, paddingBottom: 8 }}>
        <SectionHeader title={section.title} count={`${section.data.length} ${wyprawy(section.data.length)}`} />
      </View>
    ),
    [],
  );

  const header = rows.length ? (
    <View style={{ gap: 12, paddingBottom: 2 }}>
      <Card radius={22} padding={16} gap={12}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Txt f="b7" size={34} lh={1}>
            {fmtInt(totals.trips)}
          </Txt>
          <Txt f="n7" size={14} color={colors.muted} style={{ flex: 1 }} numberOfLines={1}>
            {wyprawy(totals.trips)} · {season === 'all' ? 'wszystkie sezony' : `sezon ${season}`}
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Total icon="route" value={fmtKm(totals.km)} label="dystans" />
          <Total icon="eco" value={fmtInt(totals.mushrooms)} label={plural(totals.mushrooms, 'grzyb', 'grzyby', 'grzybów')} />
          <Total icon="bolt" value={`+${fmtInt(totals.xp)}`} label="XP" accent />
        </View>
      </Card>
      {seasons.length > 1 ? <ChoiceChips options={seasonOptions} value={season} onChange={setPicked} /> : null}
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
          Historia wypraw
        </Txt>
        <View style={{ width: 44 }} />
      </View>
      <SectionList
        style={{ flex: 1 }}
        sections={sections}
        keyExtractor={(r) => r.trip.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <StateCard
            icon="hiking"
            title={tripsCount > 0 ? 'Twoje nowe wyprawy pojawią się tutaj' : 'Twoja pierwsza wyprawa pojawi się tutaj'}
            text={
              hasActiveTrip
                ? 'Trwa wyprawa – po jej zakończeniu podsumowanie trafi do historii.'
                : 'Ruszaj do lasu – po zakończeniu wyprawy jej podsumowanie trafi do historii.'
            }
            action={hasActiveTrip ? 'Wróć do wyprawy' : 'Rozpocznij grzybobranie'}
            onAction={() => router.navigate('/')}
          />
        }
        ListFooterComponent={
          missing > 0 ? (
            <LocalOnlyNote
              title="Starsze wyprawy nie są dostępne na tym urządzeniu."
              text={`Profil liczy ${fmtInt(tripsCount)} ${wyprawy(tripsCount)}, tutaj ${rows.length === 0 ? 'nie ma żadnej' : `widać ${fmtInt(rows.length)}`}.`}
            />
          ) : null
        }
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottom }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={9}
      />
    </Screen>
  );
}

function Separator() {
  return <View style={{ height: 10 }} />;
}

/** Kolumna sum sezonu (jak podsumowanie rzadkości w Atlasie). */
function Total({ icon, value, label, accent }: { icon: IconName; value: string; label: string; accent?: boolean }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Icon name={icon} size={14} color={accent ? colors.primaryText : colors.muted} />
        <Txt f="n8" size={11} color={colors.muted} numberOfLines={1}>
          {label}
        </Txt>
      </View>
      <Txt f="b7" size={18} color={accent ? colors.primaryText : colors.ink} numberOfLines={1}>
        {value}
      </Txt>
    </View>
  );
}

/** Wiersz wyprawy: najlepsze znalezisko, gmina, data i godziny, dystans · czas · grzyby, XP, status publikacji. */
const TripHistoryRow = memo(function TripHistoryRow({ row, place }: { row: TripRow; place: string }) {
  const { trip, mushrooms, best } = row;
  const { start, end } = tripRange(trip);
  const published = trip.status === 'published';
  const day = fmtTripDay(start, end);
  return (
    <Pressable
      onPress={() => router.push(`/summary/${trip.id}?from=wyprawy` as Href)}
      accessibilityRole="button"
      accessibilityLabel={`${place}, ${day}, ${fmtKm(trip.distanceKm)}, ${mushrooms} ${plural(mushrooms, 'grzyb', 'grzyby', 'grzybów')}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: colors.card,
        borderRadius: 22,
        padding: 12,
        boxShadow: shadows.card,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      {best ? (
        <Thumb size={56} radius={16} borderColor={rarityTokens[best.rarity].color} uri={best.photoUri} />
      ) : (
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            borderWidth: 3,
            borderColor: colors.ringTrack,
            backgroundColor: colors.lockedBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="hiking" size={24} color={colors.disabled} />
        </View>
      )}
      <View style={{ flex: 1, gap: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt f="b7" size={17} lh={1.3} numberOfLines={1} style={{ flex: 1 }}>
            {place}
          </Txt>
          <Pill
            label={published ? 'Opublikowana' : 'Prywatna'}
            icon={published ? 'public' : 'lock'}
            bg={published ? colors.primaryTint : colors.chip}
            color={published ? colors.primaryTintText : colors.tagNeutralText}
            size={11}
            iconSize={12}
            padV={2}
            padH={7}
            gap={3}
          />
        </View>
        <Txt f="n7" size={12} color={colors.muted} numberOfLines={1}>
          {day}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 3 }}>
          <RowStat icon="route" text={fmtKm(trip.distanceKm)} />
          <RowStat icon="schedule" text={fmtDurationShort(Math.round(trip.elapsedMs / 60000))} />
          <RowStat icon="eco" text={fmtInt(mushrooms)} />
          <Txt f="n8" size={12} color={colors.primaryText} numberOfLines={1} align="right" style={{ flex: 1 }}>
            +{fmtInt(trip.xp)} XP
          </Txt>
        </View>
      </View>
    </Pressable>
  );
});

function RowStat({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <Icon name={icon} size={14} color={colors.muted} />
      <Txt f="n8" size={12} color={colors.bodyDark} numberOfLines={1}>
        {text}
      </Txt>
    </View>
  );
}
