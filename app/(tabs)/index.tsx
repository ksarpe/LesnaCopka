import { router } from 'expo-router';
import { Linking, Platform, Pressable, View } from 'react-native';

import { AreaMapView } from '@/components/AreaMap';
import { Avatar } from '@/components/Avatar';
import { Button3D, Press3D } from '@/components/Button3D';
import { Card } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { LiveDot } from '@/components/LiveDot';
import { Pill } from '@/components/Pill';
import { ProgressBar } from '@/components/ProgressBar';
import { Screen } from '@/components/Screen';
import { SkeletonCard } from '@/components/Skeleton';
import { Thumb } from '@/components/Thumb';
import { Txt } from '@/components/Txt';
import { useAreaMap } from '@/hooks/useAreaMap';
import { useNow } from '@/hooks/useNow';
import { useRegion, useRegionStore } from '@/hooks/useRegion';
import { useServices } from '@/services';
import { allQuests, finishTrip, startTrip } from '@/store/game';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useSimStore } from '@/store/useSimStore';
import { tripElapsedMs, useActiveTrip, useTripStore } from '@/store/useTripStore';
import { ui } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';
import { colors, rarity as rarityTokens, shadows } from '@/theme/tokens';
import type { ServiceErrorCode } from '@/services/types';
import type { AreaMap, Find, Quest } from '@/types';
import { fmtDistanceM, fmtInt, fmtKm, fmtTimer, fmtWeight, gminaSubtitle, gminaTitle } from '@/utils/format';
import { levelProgress, levelThreshold, levelTitle } from '@/utils/xp';

export default function StartScreen() {
  const trip = useActiveTrip();
  return (
    <Screen tabs>
      <View style={{ paddingTop: 10, paddingHorizontal: 20, gap: 16 }}>
        <Header />
        <XpCard />
        {trip ? <ActiveTrip /> : <Idle />}
      </View>
    </Screen>
  );
}

function Header() {
  const user = useUserStore((s) => s.user);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Pressable
        onPress={() => router.navigate('/profil')}
        onLongPress={() => router.push('/dev')}
        delayLongPress={450}
        accessibilityLabel="Profil (przytrzymaj: panel symulacji)"
        style={{ width: 54, height: 54 }}
      >
        <Avatar size={54} stripe={6} />
        <View
          style={{
            position: 'absolute',
            right: -3,
            bottom: -1,
            backgroundColor: colors.ink,
            borderRadius: 999,
            paddingVertical: 1,
            paddingHorizontal: 6,
          }}
        >
          <Txt f="b7" size={11} color={colors.bg}>
            {user.level}
          </Txt>
        </View>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Txt f="b7" size={22}>
          Cześć, {user.firstName}!
        </Txt>
        <Txt f="n7" size={13} color={colors.muted}>
          {levelTitle(user.level)}
        </Txt>
      </View>
      <Pill
        label={`${user.streakDays} ${user.streakDays === 1 ? 'dzień' : 'dni'}`}
        icon="local_fire_department"
        iconFilled
        iconSize={18}
        bg={colors.streakBg}
        color={colors.streakText}
        size={14}
        padV={6}
        padH={10}
        gap={4}
        style={{ alignSelf: 'center' }}
        onPress={() => ui.toast(`Seria ${user.streakDays} dni – wróć jutro, by ją przedłużyć`, 'local_fire_department')}
      />
    </View>
  );
}

function XpCard() {
  const user = useUserStore((s) => s.user);
  const max = levelThreshold(user.level);
  return (
    <Card radius={22} padding={{ v: 14, h: 16 }} gap={8}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Txt f="n8" size={13}>
          Poziom {user.level}
        </Txt>
        <Txt f="n8" size={13} color={colors.muted}>
          {fmtInt(user.xp)} / {fmtInt(max)} XP
        </Txt>
      </View>
      <ProgressBar value={levelProgress(user)} animated />
    </Card>
  );
}

/* ───────────────────────── Stan „idle” ───────────────────────── */

function Idle() {
  const services = useServices();
  const { status, region, error, retry } = useRegion();
  const locPerm = useSimStore((s) => s.permissions.location);

  const onStart = async () => {
    if (!region) {
      if (locPerm === 'denied') {
        openLocationSettings();
        return;
      }
      const r = await retry();
      if (!r) return;
      startTrip(r.gmina.id);
      return;
    }
    if (services.permissions.get('location') !== 'granted') {
      const st = await services.permissions.request('location');
      if (st !== 'granted') return;
    }
    startTrip(region.gmina.id);
  };

  return (
    <View style={{ gap: 16 }}>
      {region ? (
        <RegionCard />
      ) : status === 'error' ? (
        <LocationError code={error?.code} onRetry={retry} denied={locPerm === 'denied'} />
      ) : (
        <SkeletonCard media={150} lines={3} radius={26} />
      )}
      <QuestsCard />
      <Button3D
        title="Rozpocznij grzybobranie"
        icon="forest"
        onPress={onStart}
        disabled={status === 'error'}
      />
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 6, paddingBottom: 8 }}>
        <Icon name="shield" size={16} color={colors.muted} />
        <Txt f="n6" size={12} color={colors.muted} style={{ flex: 1 }}>
          Lokalizacja nie jest udostępniana na żywo. Wyprawa pojawi się publicznie dopiero po zakończeniu.
        </Txt>
      </View>
    </View>
  );
}

function RegionCard() {
  const region = useRegionStore((s) => s.region)!;
  const area = useAreaMap(region);
  const g = region.gmina;
  const accuracy = region.position.accuracyM;
  return (
    <Card radius={26} style={{ overflow: 'hidden' }}>
      <AreaMapView map={area.data} failed={!!area.error} accuracyM={accuracy} height={150} />
      <View style={{ paddingVertical: 14, paddingHorizontal: 16, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="my_location" filled size={16} color={colors.primaryText} />
          <Txt f="n8" size={12} color={colors.primaryText} upper ls={0.06}>
            {region.source === 'sim' ? 'Wykryto region · symulacja' : 'Wykryto region'}
          </Txt>
        </View>
        <View>
          <Txt f="b7" size={24}>
            {gminaTitle(g)}
          </Txt>
          <Txt f="n6" size={14} color={colors.muted}>
            {gminaSubtitle(g)}
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <ForestPill map={area.data} loading={area.loading} />
          {g.forestPct != null ? (
            <Pill label={`Lesistość ${Math.round(g.forestPct)}%`} bg={colors.infoBg} color={colors.infoText} />
          ) : null}
          {accuracy > 500 ? (
            <Pill
              label={`Dokładność ±${fmtDistanceM(accuracy)}`}
              icon="warning"
              bg={colors.warnBg}
              color={colors.warnText}
              iconColor={colors.warnIcon}
            />
          ) : region.nearBorder ? (
            <Pill label="Przy granicy gminy" bg={colors.chip} color={colors.tagNeutralText} />
          ) : null}
        </View>
      </View>
    </Card>
  );
}

/** „Jesteś w lesie” / „Las 400 m stąd” – odległość liczona z mapy okolicy (lasy z OSM). */
function ForestPill({ map, loading }: { map?: AreaMap; loading: boolean }) {
  if (!map) {
    return loading ? <Pill label="Szukam lasu…" icon="forest" bg={colors.chip} color={colors.muted} /> : null;
  }
  const d = map.forestDistanceM;
  if (d === 0) return <Pill label="Jesteś w lesie" icon="forest" iconFilled />;
  if (d != null) return <Pill label={`Las ${fmtDistanceM(d)} stąd`} icon="forest" />;
  return (
    <Pill
      label={`Brak lasu w promieniu ${fmtDistanceM(map.radiusM)}`}
      icon="forest"
      bg={colors.chip}
      color={colors.muted}
    />
  );
}

function openLocationSettings() {
  if (Platform.OS === 'web') {
    ui.toast('Zezwól na lokalizację w ustawieniach witryny przeglądarki', 'settings');
    return;
  }
  Linking.openSettings().catch(() => ui.toast('Ustawienia › Prywatność › Lokalizacja', 'settings'));
}

const LOCATION_ERROR_COPY: Partial<
  Record<ServiceErrorCode, { title: string; body: string; icon: 'location_off' | 'public' }>
> = {
  GPS_OFF: {
    title: 'Włącz lokalizację, aby rozpocząć',
    body: 'GPS jest wyłączony. Potrzebujemy go, by wskazać gminę i policzyć dystans wyprawy.',
    icon: 'location_off',
  },
  OUT_OF_AREA: {
    title: 'Jesteś poza Polską',
    body: 'Gminy rozpoznajemy tylko w Polsce. Do testów możesz wybrać gminę w panelu symulacji.',
    icon: 'public',
  },
  TIMEOUT: {
    title: 'Nie udało się ustalić pozycji',
    body: 'GPS nie złapał sygnału. Wyjdź na otwartą przestrzeń i spróbuj ponownie.',
    icon: 'location_off',
  },
};

const PERMISSION_COPY = {
  title: 'Włącz lokalizację, aby rozpocząć',
  body: 'Bez zgody na lokalizację nie wykryjemy gminy. Nigdy nie udostępniamy jej na żywo.',
  icon: 'location_off' as const,
};

function LocationError({ code, onRetry, denied }: { code?: ServiceErrorCode; onRetry: () => void; denied: boolean }) {
  const copy = (code && LOCATION_ERROR_COPY[code]) || PERMISSION_COPY;
  const askSettings = denied && (!code || code === 'PERMISSION');
  return (
    <Card radius={26} padding={18} gap={12} style={{ alignItems: 'center' }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: colors.warnBg,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 6,
        }}
      >
        <Icon name={copy.icon} filled size={32} color={colors.warnIcon} />
      </View>
      <Txt f="b7" size={22} align="center" lh={1.15}>
        {copy.title}
      </Txt>
      <Txt f="n6" size={14} color={colors.muted} align="center">
        {copy.body}
      </Txt>
      <Pressable
        onPress={() => (askSettings ? openLocationSettings() : onRetry())}
        style={({ pressed }) => ({
          borderWidth: 2.5,
          borderColor: colors.outline,
          borderRadius: 20,
          paddingVertical: 10,
          paddingHorizontal: 18,
          backgroundColor: pressed ? colors.outlineHover : 'transparent',
        })}
      >
        <Txt f="b7" size={16} color={colors.outlineText}>
          {askSettings ? 'Otwórz ustawienia' : 'Spróbuj ponownie'}
        </Txt>
      </Pressable>
    </Card>
  );
}

function QuestsCard() {
  const progress = useUserStore((s) => s.quests.progress);
  useUserStore((s) => s.challenges);
  useCatalogStore((s) => s.dailyQuests);
  const quests = allQuests();
  return (
    <Card radius={22} padding={16} gap={12}>
      <Txt f="b7" size={18}>
        Zadania dnia
      </Txt>
      {quests.map((q) => (
        <QuestRow key={q.id} q={q} progress={progress[q.id]?.progress ?? 0} done={!!progress[q.id]?.completed} />
      ))}
    </Card>
  );
}

function QuestRow({ q, progress, done }: { q: Quest; progress: number; done: boolean }) {
  const showProgress = !done && progress > 0;
  const unit = q.kind === 'distance' ? ' km' : '';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 12,
          backgroundColor: done ? colors.primary : q.iconBg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon
          name={(done ? 'check' : q.icon) as IconName}
          filled={done || q.iconFilled}
          size={20}
          color={done ? colors.primaryInk : q.iconColor}
        />
      </View>
      <Txt
        f="n7"
        size={14}
        style={{ flex: 1, textDecorationLine: done ? 'line-through' : 'none' }}
        color={done ? colors.muted : colors.ink}
        numberOfLines={2}
      >
        {q.kind === 'challenge' ? `Wyzwanie: ${q.title}` : q.title}
        {showProgress ? (
          <Txt f="n8" size={13} color={colors.muted}>
            {`  ${String(progress).replace('.', ',')}${unit}/${q.target}${unit}`}
          </Txt>
        ) : null}
      </Txt>
      <Txt f="n8" size={13} color={colors.primaryText}>
        +{q.xp} XP
      </Txt>
    </View>
  );
}

/* ───────────────────────── Stan „wyprawa trwa” ───────────────────────── */

function ActiveTrip() {
  const trip = useActiveTrip()!;
  const finds = useTripStore((s) => s.finds);
  const speed = useSimStore((s) => s.timeSpeed);
  const gmina = useCatalogStore((s) => s.gminaById[trip.gminaId]);
  const now = useNow(speed > 1 ? 200 : 1000);
  const elapsed = tripElapsedMs(trip, speed, now);
  const claimed = trip.findIds.map((id) => finds[id]).filter((f): f is Find => !!f && f.status === 'claimed');
  const collected = claimed.filter((f) => f.collected).length;
  const recent = [...claimed].reverse().slice(0, 3);

  const onFinish = () =>
    ui.confirm({
      title: 'Zakończyć wyprawę?',
      message: 'Podsumujemy trasę i znaleziska. W feedzie pojawi się dopiero, gdy zdecydujesz.',
      icon: 'flag',
      confirmLabel: 'Zakończ wyprawę',
      cancelLabel: 'Zbieram dalej',
      onConfirm: () => {
        const id = finishTrip();
        if (id) router.push(`/summary/${id}`);
      },
    });

  return (
    <View style={{ gap: 16 }}>
      <View
        style={{
          backgroundColor: colors.forest,
          borderRadius: 26,
          padding: 18,
          gap: 14,
          boxShadow: shadows.forest,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <LiveDot />
          <Txt f="n8" size={13} color={colors.onDark} upper ls={0.06}>
            Wyprawa trwa · {gminaTitle(gmina)}
          </Txt>
          {speed > 1 ? (
            <Txt f="n8" size={11} color={colors.xpOnDark} style={{ marginLeft: 'auto' }}>
              ×{speed}
            </Txt>
          ) : null}
        </View>
        <Txt f="b7" size={56} lh={1} color={colors.onDark} style={{ fontVariant: ['tabular-nums'] }}>
          {fmtTimer(elapsed)}
        </Txt>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TripStat value={fmtKm(trip.distanceKm)} label="dystans" />
          <TripStat value={String(collected)} label="grzybów" />
          <TripStat value={`+${fmtInt(trip.xp)}`} label="XP" accent />
        </View>
      </View>

      <Press3D
        onPress={() => router.push('/scan')}
        depth={7}
        pressDepth={5}
        shadowColor={colors.primaryShadow}
        radius={75}
        ring={{ width: 10, color: 'rgba(127,181,71,0.18)' }}
        style={{ alignSelf: 'center' }}
        accessibilityLabel="Skanuj grzyba"
        faceStyle={{
          width: 150,
          height: 150,
          backgroundColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
        }}
      >
        <Icon name="center_focus_strong" filled size={48} color={colors.primaryInk} />
        <Txt f="b7" size={18} color={colors.primaryInk}>
          Skanuj grzyba
        </Txt>
      </Press3D>

      <Card radius={22} padding={16} gap={12}>
        <Txt f="b7" size={18}>
          Ostatnie znaleziska
        </Txt>
        {recent.length === 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                borderWidth: 2,
                borderStyle: 'dashed',
                borderColor: colors.lockedBorder,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="photo_camera" size={22} color={colors.disabled} />
            </View>
            <Txt f="n7" size={13} color={colors.muted} style={{ flex: 1 }}>
              Jeszcze nic – zeskanuj pierwszego grzyba, a pojawi się tutaj.
            </Txt>
          </View>
        ) : (
          recent.map((f) => <RecentFind key={f.id} find={f} />)
        )}
      </Card>

      <Pressable
        onPress={onFinish}
        style={({ pressed }) => ({
          borderWidth: 2.5,
          borderColor: colors.outline,
          borderRadius: 20,
          padding: 14,
          marginBottom: 8,
          backgroundColor: pressed ? colors.outlineHover : 'transparent',
        })}
      >
        <Txt f="b7" size={17} color={colors.outlineText} align="center">
          Zakończ wyprawę
        </Txt>
      </Pressable>
    </View>
  );
}

function TripStat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 16, padding: 10 }}>
      <Txt f="b7" size={22} color={accent ? colors.xpOnDark : colors.onDark} numberOfLines={1}>
        {value}
      </Txt>
      <Txt f="n7" size={12} color={colors.onDark} style={{ opacity: 0.8 }}>
        {label}
      </Txt>
    </View>
  );
}

function RecentFind({ find }: { find: Find }) {
  const sp = useCatalogStore((s) => s.speciesById[find.speciesId]);
  const r = rarityTokens[find.rarity];
  const amount = find.dimensions.pieces ? `${find.dimensions.pieces} szt.` : fmtWeight(find.dimensions.weightG);
  return (
    <Pressable
      onPress={() => router.push(`/species/${find.speciesId}`)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
    >
      <Thumb size={48} radius={14} borderColor={r.color} />
      <View style={{ flex: 1 }}>
        <Txt f="n8" size={14} numberOfLines={1}>
          {sp?.name}
        </Txt>
        <Txt f="n7" size={12} color={find.collected ? r.text : colors.danger}>
          {find.collected ? `${r.label} · ${amount}` : `Tylko zdjęcie · ${r.label}`}
        </Txt>
      </View>
      <Txt f="n8" size={14} color={colors.primaryText}>
        +{find.xp?.total ?? 0}
      </Txt>
    </Pressable>
  );
}
