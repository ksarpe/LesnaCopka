import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useRef, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { ContestCard, contestHref } from '@/components/ContestCard';
import { DuelCard } from '@/components/DuelCard';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { OfflineCard } from '@/components/OfflineCard';
import { PlayerRankRow } from '@/components/PlayerRankRow';
import { Screen } from '@/components/Screen';
import { SeeAllButton, SectionHeader } from '@/components/SectionHeader';
import { SkeletonCard, SkeletonRow } from '@/components/Skeleton';
import { TrophySection } from '@/components/TrophyShelf';
import { Txt } from '@/components/Txt';
import { useAsync, type AsyncState } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { ServiceError, useServices } from '@/services';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useSimStore } from '@/store/useSimStore';
import { useStatsSync } from '@/store/useStatsSync';
import { useUserStore } from '@/store/useUserStore';
import { colors, shadows } from '@/theme/tokens';
import type { ContestWeek, DuelsOverview, PlayerRanking, RivalryStatus } from '@/types';
import { contestId, fmtWeekRange, RELATIVE_KEY } from '@/utils/contests';
import { recordText } from '@/utils/duels';

/**
 * Rywalizacja (wejście: karta na górze zakładki Gminy, karta walki na ekranie Wyprawa, trofea w Profilu): walki
 * tygodnia (mój okaz, lider województwa, czas do końca), pojedynki, ranking grzybiarzy (podium znajomych), trofea
 * i status gracza (konto bez e-maila – bez nagród, wyniki w weryfikacji, ukrycie w rankingach).
 */
export default function RivalryScreen() {
  const { contests, duels } = useServices();
  const network = useSimStore((s) => s.networkEnabled);
  const version = useStatsSync((s) => s.version);
  const now = useNow(60_000);
  const week = useAsync(() => contests.getContestWeek(), [network, version]);
  const status = useAsync(() => duels.getRivalryStatus(), [network, version]);
  const duelList = useAsync(() => duels.getDuels(), [network, version]);
  const ranking = useAsync(() => duels.getPlayerRanking('znajomi', 'week'), [network, version]);

  // Powrót z walki / pojedynku: stan mógł się zmienić (zgłoszenie, wycofanie, przyjęte wyzwanie) – po cichu od nowa.
  const focused = useRef(false);
  const [r1, r2, r3, r4] = [week.reload, status.reload, duelList.reload, ranking.reload];
  useFocusEffect(
    useCallback(() => {
      if (focused.current) [r1, r2, r3, r4].forEach((r) => void r());
      focused.current = true;
    }, [r1, r2, r3, r4]),
  );

  const back = () => (router.canGoBack() ? router.back() : router.navigate('/gminy' as Href));

  return (
    <Screen>
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 20, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton icon="arrow_back" onPress={back} accessibilityLabel="Wróć" />
          <Txt f="b7" size={18}>
            Rywalizacja
          </Txt>
          <View style={{ width: 44 }} />
        </View>

        <StatusBanners status={status.data} />
        <WeekSection week={week} now={now} status={status.data} />
        <DuelsSection res={duelList} now={now} />
        <RankingSection res={ranking} />
        <TrophySection limit={3} expandable />
      </View>
    </Screen>
  );
}

/* ───────────────────────── Status gracza ───────────────────────── */

function Banner({
  icon,
  text,
  tone,
  onPress,
}: {
  icon: IconName;
  text: string;
  tone: 'warn' | 'info' | 'muted';
  onPress?: () => void;
}) {
  const pal =
    tone === 'warn'
      ? { bg: colors.warnBg, border: colors.warnBorder, icon: colors.warnIcon, text: colors.warnTitle }
      : tone === 'info'
        ? { bg: colors.infoBg, border: colors.infoBg, icon: colors.infoText, text: colors.infoText }
        : { bg: colors.chip, border: colors.chip, icon: colors.muted, text: colors.tagNeutralText };
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: pal.bg,
        borderWidth: 1.5,
        borderColor: pal.border,
        borderRadius: 18,
        paddingVertical: 10,
        paddingHorizontal: 12,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Icon name={icon} filled size={22} color={pal.icon} />
      <Txt f="n8" size={13} color={pal.text} style={{ flex: 1 }}>
        {text}
      </Txt>
      {onPress ? <Icon name="chevron_right" size={20} color={pal.icon} /> : null}
    </Pressable>
  );
}

function StatusBanners({ status }: { status?: RivalryStatus }) {
  if (!status) return null;
  const items: ReactNode[] = [];
  if (status.standing === 'review') {
    items.push(
      <Banner
        key="review"
        icon="hourglass_top"
        tone="info"
        text="Twoje wyniki są w weryfikacji – inni ich teraz nie widzą, a nagrody czekają na sprawdzenie."
      />,
    );
  }
  if (!status.accountSecured) {
    items.push(
      <Banner
        key="secure"
        icon="mail_lock"
        tone="warn"
        text="Zabezpiecz konto e-mailem, żeby odbierać nagrody"
        onPress={() => router.push('/ustawienia/konto' as Href)}
      />,
    );
  }
  if (!status.showInRankings) {
    items.push(
      <Banner
        key="hidden"
        icon="visibility_off"
        tone="muted"
        text="Jesteś ukryty w rankingach i na tablicach walk – widzą Cię tylko znajomi."
        // Przełącznik widoczności jest w Ustawieniach (grupa Prywatność); /ustawienia/prywatnosc to dokument polityki.
        onPress={() => router.push('/ustawienia' as Href)}
      />,
    );
  }
  return items.length ? <View style={{ gap: 8 }}>{items}</View> : null;
}

/** Sekcja z serwisu, który może jeszcze nie działać (zaślepka – UNAVAILABLE) albo stracić sieć: łagodna informacja. */
function SoftState({ error, unavailable, onRetry }: { error: Error; unavailable: string; onRetry: () => void }) {
  const off = error instanceof ServiceError && error.code === 'UNAVAILABLE';
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 4 }}>
      <Icon name={off ? 'schedule' : 'wifi_off'} size={16} color={colors.muted} />
      <Txt f="n6" size={13} color={colors.muted} style={{ flex: 1 }}>
        {off ? unavailable : 'Brak połączenia – spróbuj za chwilę.'}
      </Txt>
      {off ? null : (
        <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button">
          <Txt f="b7" size={14} color={colors.outlineText}>
            Odśwież
          </Txt>
        </Pressable>
      )}
    </View>
  );
}

/* ───────────────────────── Walki tygodnia ───────────────────────── */

function WeekSection({ week, now, status }: { week: AsyncState<ContestWeek>; now: number; status?: RivalryStatus }) {
  const homeId = useUserStore((s) => s.user.homeGminaId);
  const voivodeship = useCatalogStore((s) => s.gminaById[homeId]?.voivodeship);
  const data = week.data;
  return (
    <View style={{ gap: 10 }}>
      <SectionHeader title="Walki tygodnia" count={data?.weekStart ? fmtWeekRange(data.weekStart) : undefined} />
      {data ? (
        <>
          {data.contests.map((c) => (
            <ContestCard
              key={c.id}
              contest={c}
              mine={data.mine[c.id]}
              leader={data.leaders[c.id]}
              voivodeship={voivodeship}
              now={now}
              status={status}
            />
          ))}
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 4 }}>
            <Icon name="tips_and_updates" size={16} color={colors.muted} />
            <Txt f="n6" size={12} color={colors.muted} style={{ flex: 1 }}>
              Połóż obok grzyba dłoń albo monetę – zmierzę kapelusz. Okaz zgłosisz na ekranie Nagroda albo w dzienniku znalezisk.
            </Txt>
          </View>
          {data.previousWeekStart ? <PreviousWeek weekStart={data.previousWeekStart} /> : null}
        </>
      ) : week.error ? (
        <OfflineCard onRetry={week.reload} />
      ) : (
        Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} lines={2} radius={20} />)
      )}
    </View>
  );
}

function PreviousWeek({ weekStart }: { weekStart: string }) {
  return (
    <Pressable
      onPress={() => router.push(contestHref(contestId(weekStart, RELATIVE_KEY)))}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: pressed ? '#FDFBF6' : colors.card,
        borderRadius: 18,
        paddingVertical: 12,
        paddingHorizontal: 14,
        boxShadow: shadows.card,
      })}
    >
      <Icon name="history" size={22} color={colors.primaryText} />
      <View style={{ flex: 1 }}>
        <Txt f="n8" size={14}>
          Wyniki poprzedniego tygodnia
        </Txt>
        <Txt f="n7" size={12} color={colors.muted}>
          {fmtWeekRange(weekStart)} · podia i nagrody
        </Txt>
      </View>
      <Icon name="chevron_right" size={22} color={colors.disabled} />
    </Pressable>
  );
}

/* ───────────────────────── Pojedynki ───────────────────────── */

function DuelsSection({ res, now }: { res: AsyncState<DuelsOverview>; now: number }) {
  const data = res.data;
  const shown = data ? [...data.incoming, ...data.active].slice(0, 3) : [];
  const open = (id: string) => router.push(`/rywalizacja/pojedynek/${id}` as Href);
  return (
    <View style={{ gap: 10 }}>
      <SectionHeader title="Pojedynki" count={data ? recordText(data.record) : undefined} />
      {data ? (
        shown.length ? (
          shown.map((d) => <DuelCard key={d.id} duel={d} now={now} onPress={() => open(d.id)} />)
        ) : (
          <Txt f="n6" size={13} color={colors.muted} style={{ paddingHorizontal: 4 }}>
            Wyzwij znajomego: największy okaz, najwięcej grzybów albo gatunków – na 1, 3 lub 7 dni.
          </Txt>
        )
      ) : res.error ? (
        <SoftState error={res.error} unavailable="Pojedynki będą dostępne wkrótce." onRetry={res.reload} />
      ) : (
        <SkeletonRow />
      )}
      <SeeAllButton
        label={data && (data.outgoing.length || shown.length) ? 'Wszystkie pojedynki' : 'Wyzwij znajomego'}
        onPress={() => router.push('/rywalizacja/pojedynki' as Href)}
      />
    </View>
  );
}

/* ───────────────────────── Ranking grzybiarzy ───────────────────────── */

/** Pusty ranking znajomych: „Dodaj znajomych” tylko bez znajomych, inaczej – nikt nie ma jeszcze punktów. */
function EmptyRanking() {
  const { feed } = useServices();
  const friends = useAsync(() => feed.getFriends().then((l) => l.length), [feed]);
  return (
    <Txt f="n6" size={13} color={colors.muted} style={{ paddingHorizontal: 4 }}>
      {friends.data === 0
        ? 'Dodaj znajomych – ranking porówna Wasze punkty z tego tygodnia.'
        : 'Nikt ze znajomych nie ma jeszcze punktów w tym tygodniu.'}
    </Txt>
  );
}

function RankingSection({ res }: { res: AsyncState<PlayerRanking> }) {
  const data = res.data;
  const podium = data?.rows.slice(0, 3) ?? [];
  const me = data?.me && !podium.some((r) => r.isMe) ? data.me : null;
  return (
    <View style={{ gap: 10 }}>
      <SectionHeader title="Ranking grzybiarzy" count="znajomi · tydzień" />
      {data ? (
        podium.length ? (
          <>
            {podium.map((r) => (
              <PlayerRankRow key={r.user.id} row={r} />
            ))}
            {me ? (
              <>
                <Txt f="b7" size={18} color={colors.faint} align="center" lh={1}>
                  ⋯
                </Txt>
                <PlayerRankRow row={me} />
              </>
            ) : null}
          </>
        ) : (
          <EmptyRanking />
        )
      ) : res.error ? (
        <SoftState error={res.error} unavailable="Ranking grzybiarzy będzie dostępny wkrótce." onRetry={res.reload} />
      ) : (
        <SkeletonRow />
      )}
      <SeeAllButton label="Zobacz ranking" onPress={() => router.push('/rywalizacja/ranking' as Href)} />
    </View>
  );
}
