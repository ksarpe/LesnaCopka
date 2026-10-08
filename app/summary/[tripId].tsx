import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Share, View } from 'react-native';

import { Button3D } from '@/components/Button3D';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Pill } from '@/components/Pill';
import { Placeholder } from '@/components/Placeholder';
import { RouteMap } from '@/components/RouteMap';
import { Screen } from '@/components/Screen';
import { StatTile } from '@/components/StatTile';
import { Thumb } from '@/components/Thumb';
import { Toggle } from '@/components/Toggle';
import { Txt } from '@/components/Txt';
import { approximateRoute, splitSegments } from '@/geo/track';
import { useServices } from '@/services';
import { ServiceError } from '@/services/types';
import { markPublished, setHideRoute } from '@/store/game';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useFeedSync } from '@/store/useFeedSync';
import { useTripTrack } from '@/store/useTrackStore';
import { useTripStore } from '@/store/useTripStore';
import { ui } from '@/store/useUiStore';
import { colors, heat as heatColors, rarity as rarityTokens, RARITY_ORDER, shadows } from '@/theme/tokens';
import type { Find, Rarity } from '@/types';
import { fmtDuration, fmtInt, fmtKm, fmtTripDate, fmtWeight, gminaTitle, plural } from '@/utils/format';
import { hashString } from '@/utils/random';

const RANK: Record<Rarity, number> = { pospolity: 0, rzadki: 1, epicki: 2, legendarny: 3 };

export default function SummaryScreen() {
  // `from=wyprawy` – otwarte z Historii wypraw: strzałka wraca do listy zamiast zamykać na Start.
  const { tripId, from } = useLocalSearchParams<{ tripId: string; from?: string }>();
  const fromHistory = from === 'wyprawy';
  const { feed } = useServices();
  const trip = useTripStore((s) => s.trips[tripId]);
  const allFinds = useTripStore((s) => s.finds);
  const gmina = useCatalogStore((s) => (trip ? s.gminaById[trip.gminaId] : undefined));
  const speciesById = useCatalogStore((s) => s.speciesById);
  const [publishing, setPublishing] = useState(false);
  // Ślad tej wyprawy z pamięci (po restarcie aplikacji go nie ma → placeholder). Pokazujemy wyłącznie
  // wersję przybliżoną – dokładnie to, co poszłoby do publikacji: bez okolic startu i mety, uproszczoną.
  const track = useTripTrack(trip?.id);
  const route = useMemo(
    () => (track.length >= 2 ? approximateRoute(splitSegments(track), { seed: hashString(tripId ?? '') }) : null),
    [track, tripId],
  );

  if (!trip) {
    return (
      <Screen>
        <View style={{ padding: 20, gap: 12 }}>
          <Txt f="b7" size={24}>
            Nie znaleziono wyprawy
          </Txt>
          <Button3D title="Wróć" onPress={() => router.navigate('/')} />
        </View>
      </Screen>
    );
  }

  const finds = trip.findIds.map((id) => allFinds[id]).filter((f): f is Find => !!f && f.status === 'claimed');
  const collected = finds.filter((f) => f.collected);
  const speciesCount = new Set(collected.map((f) => f.speciesId)).size;
  const loot = RARITY_ORDER.map((r) => ({ r, n: collected.filter((f) => f.rarity === r).length }));
  const best = [...finds].sort((a, b) => RANK[b.rarity] - RANK[a.rarity] || (b.xp?.total ?? 0) - (a.xp?.total ?? 0))[0];
  const start = new Date(trip.startedAt);
  const end = new Date(trip.endedAt ?? start.getTime() + trip.elapsedMs);
  const published = trip.status === 'published';
  const showRoute = !trip.hideRoute;

  const gminaPill = (
    <Pill
      label={gmina ? gminaTitle(gmina) : 'Gmina'}
      icon="location_on"
      iconFilled
      iconColor={colors.primaryText}
      bg={colors.white}
      color={colors.ink}
      padH={11}
      gap={4}
      style={{ position: 'absolute', left: 12, top: 12 }}
    />
  );

  const close = () => {
    if (fromHistory && router.canGoBack()) {
      router.back();
      return;
    }
    if (router.canDismiss()) router.dismissAll();
    router.navigate('/');
  };

  const share = () =>
    Share.share({
      message: `Wyprawa${gmina ? ` w gminie ${gmina.name}` : ''}: ${fmtKm(trip.distanceKm)}, ${collected.length} grzybów, ${speciesCount} gatunków, +${fmtInt(trip.xp)} XP 🍄 #Grzybobranie`,
    }).catch(() => ui.toast('Nie udało się udostępnić', 'error'));

  const publish = async () => {
    if (published) {
      router.navigate('/feed');
      return;
    }
    setPublishing(true);
    try {
      const post = await feed.publishTrip(trip, { hideRoute: trip.hideRoute });
      markPublished(trip.id, post.id);
      // Feed (zakładka mogła być już otwarta) pobierze listę od nowa – nowy wpis na górze.
      useFeedSync.getState().markStale();
      if (router.canDismiss()) router.dismissAll();
      router.navigate('/feed');
      setTimeout(() => ui.toast('Opublikowano – znajomi zobaczą wpis za 24 h', 'schedule'), 350);
    } catch (e) {
      ui.toast(e instanceof ServiceError && e.code === 'NETWORK' ? 'Brak sieci – spróbuj ponownie później' : 'Nie udało się opublikować', 'wifi_off');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Screen>
      <View style={{ paddingTop: 6, paddingHorizontal: 20, paddingBottom: 4, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton icon={fromHistory ? 'arrow_back' : 'close'} onPress={close} accessibilityLabel={fromHistory ? 'Wróć' : 'Zamknij'} />
          <Txt f="b7" size={18}>
            Podsumowanie
          </Txt>
          <IconButton icon="ios_share" iconSize={22} onPress={share} accessibilityLabel="Udostępnij" />
        </View>

        <View style={{ gap: 2 }}>
          <Txt f="b7" size={30}>
            Wyprawa zakończona!
          </Txt>
          <Txt f="n7" size={14} color={colors.muted}>
            {fmtTripDate(start, end)}
          </Txt>
        </View>

        {showRoute && route?.length ? (
          <RouteMap segments={route} gminaTeryt={gmina?.teryt} height={170} caption="trasa przybliżona">
            {gminaPill}
          </RouteMap>
        ) : (
          <Placeholder
            tile={{
              tint: heatColors[3],
              glyph: showRoute ? 'route' : 'visibility_off',
              glyphSize: 40,
              caption: !showRoute
                ? 'Trasa ukryta – publikujemy tylko gminę'
                : route
                  ? 'Trasa za krótka, by ją pokazać'
                  : fromHistory
                    ? // Starsza wyprawa: ślad jest tylko w pamięci, do bieżącej wyprawy (po restarcie go nie ma).
                      'Ślad trasy nie jest przechowywany po wyprawie'
                    : // Brak punktów GPS albo restart aplikacji w trakcie wyprawy (ślad jest tylko w pamięci).
                      'Brak zapisanego śladu trasy',
            }}
            style={{ height: 170, borderRadius: 24 }}
          >
            {gminaPill}
          </Placeholder>
        )}

        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <StatTile value={fmtKm(trip.distanceKm)} label="dystans" valueSize={28} />
            <StatTile value={fmtDuration(trip.elapsedMs)} label="czas" valueSize={28} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <StatTile
              value={String(collected.length)}
              label={`${plural(collected.length, 'grzyb', 'grzyby', 'grzybów')} · ${speciesCount} ${plural(speciesCount, 'gatunek', 'gatunki', 'gatunków')}`}
              valueSize={28}
            />
            <StatTile value={`+${fmtInt(trip.xp)}`} label="XP zdobyte" valueSize={28} dark />
          </View>
        </View>

        <View style={{ gap: 10 }}>
          <Txt f="b7" size={18}>
            Łup z wyprawy
          </Txt>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {loot.map(({ r, n }) => (
              <LootTile key={r} rarity={r} n={n} />
            ))}
          </View>
        </View>

        {best ? (
          <BestFind find={best} speciesName={speciesById[best.speciesId]?.name ?? ''} />
        ) : (
          <View style={{ backgroundColor: colors.card, borderRadius: 22, padding: 14, boxShadow: shadows.card }}>
            <Txt f="n7" size={14} color={colors.muted}>
              Tym razem bez znalezisk – las nie ucieknie. Wróć po deszczu!
            </Txt>
          </View>
        )}

        <View
          style={{
            backgroundColor: colors.primaryTint,
            borderRadius: 20,
            padding: 14,
            flexDirection: 'row',
            gap: 10,
            alignItems: 'center',
          }}
        >
          <Icon name="shield" filled size={24} color={colors.primaryText} />
          <Txt f="n7" size={13} color={colors.primaryTintBody} style={{ flex: 1 }}>
            {showRoute
              ? route?.length
                ? 'Publikujemy gminę i przybliżoną trasę – bez okolic startu i mety. Twoje miejscówki zostają tajne.'
                : 'Publikujemy gminę i przybliżoną trasę. Twoje miejscówki zostają tajne.'
              : 'Trasa ukryta – publikujemy tylko gminę. Twoje miejscówki zostają tajne.'}
          </Txt>
          <Toggle
            value={showRoute}
            onChange={(v) => {
              if (published) {
                ui.toast('Wpis już opublikowany', 'lock');
                return;
              }
              setHideRoute(trip.id, !v);
            }}
            accessibilityLabel="Pokaż przybliżoną trasę"
          />
        </View>

        <Button3D
          title={published ? 'Zobacz w feedzie' : publishing ? 'Publikuję…' : 'Opublikuj w feedzie'}
          onPress={publish}
          disabled={publishing}
        />
      </View>
    </Screen>
  );
}

function LootTile({ rarity, n }: { rarity: Rarity; n: number }) {
  const r = rarityTokens[rarity];
  const empty = n === 0;
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: empty ? colors.dimTile : colors.card,
        borderRadius: 16,
        paddingTop: 10,
        paddingHorizontal: 6,
        paddingBottom: empty ? 14 : 10,
        alignItems: 'center',
        borderBottomWidth: empty ? 0 : 4,
        borderBottomColor: r.color,
        overflow: 'hidden',
      }}
    >
      <Txt f="b7" size={24} color={empty ? colors.disabled : colors.ink}>
        {n}
      </Txt>
      <Txt f="n8" size={11} color={empty ? colors.faint : colors.muted}>
        {r.plural}
      </Txt>
      {empty ? <DashedBottom /> : null}
    </View>
  );
}

/** `border-bottom: 4px dashed #D2C8B4` – RN nie rysuje przerywanej krawędzi tylko z jednej strony. */
function DashedBottom() {
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, flexDirection: 'row', gap: 4, overflow: 'hidden' }}>
      {Array.from({ length: 12 }).map((_, i) => (
        <View key={i} style={{ width: 8, height: 4, backgroundColor: colors.dimDash }} />
      ))}
    </View>
  );
}

function BestFind({ find, speciesName }: { find: Find; speciesName: string }) {
  const r = rarityTokens[find.rarity];
  const d = find.dimensions;
  const detail = find.reward?.personalRecord
    ? `Kapelusz ${d.capCm} cm · rekord osobisty`
    : `Kapelusz ${d.capCm} cm · ${d.pieces ? `${d.pieces} szt.` : fmtWeight(d.weightG)}`;
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
      <Thumb size={62} radius={16} borderColor={r.color} uri={find.photoUri} />
      <View style={{ flex: 1 }}>
        <Txt f="n8" size={11} color={r.text} upper ls={0.08}>
          Najlepsze znalezisko · {r.label}
        </Txt>
        <Txt f="b7" size={18}>
          {speciesName}
        </Txt>
        <Txt f="n7" size={12} color={colors.muted}>
          {detail}
        </Txt>
      </View>
    </View>
  );
}
