import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { OfflineCard, StateCard } from '@/components/OfflineCard';
import { Pill } from '@/components/Pill';
import { PlayerRankRow } from '@/components/PlayerRankRow';
import { Screen, useScreenPadding } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SkeletonRow } from '@/components/Skeleton';
import { Txt } from '@/components/Txt';
import { useAsync } from '@/hooks/useAsync';
import { useBottomPadding } from '@/hooks/useInsets';
import { useServices } from '@/services';
import { useSimStore } from '@/store/useSimStore';
import { colors, shadows } from '@/theme/tokens';
import type { PlayerRanking, PlayerRankingPeriod, PlayerRankingScope } from '@/types';
import { pendingXpText, RANKING_PERIODS, RANKING_SCOPES, rankingTitle } from '@/utils/duels';
import { fmtMushroomers } from '@/utils/format';

/** Wysokość przypiętego wiersza gracza (+ odstęp) – tyle miejsca zostawiamy pod listą. */
const PINNED_SPACE = 84;

const PERIOD_PHRASE: Record<PlayerRankingPeriod, string> = { week: 'w tym tygodniu', season: 'w tym sezonie' };

const asScope = (v?: string): PlayerRankingScope =>
  RANKING_SCOPES.some((s) => s.value === v) ? (v as PlayerRankingScope) : 'znajomi';

/**
 * Ranking grzybiarzy (indywidualny, z ekranu Rywalizacja): zasięg (Znajomi / Gmina / Województwo / Polska) × okres
 * (Tydzień / Sezon). Podium z medalami, wiersz gracza przypięty na dole, podpis o opóźnieniu 24 h i świeżych punktach,
 * stan ukrycia (Ustawienia → Prywatność). `?zasieg=gmina&okres=season` – wejście z konkretnym widokiem.
 */
export default function PlayerRankingScreen() {
  const { duels } = useServices();
  const network = useSimStore((s) => s.networkEnabled);
  const params = useLocalSearchParams<{ zasieg?: string; okres?: string }>();
  const [scope, setScope] = useState<PlayerRankingScope>(() => asScope(params.zasieg));
  const [period, setPeriod] = useState<PlayerRankingPeriod>(() => (params.okres === 'season' ? 'season' : 'week'));
  const ranking = useAsync(() => duels.getPlayerRanking(scope, period), [scope, period, network]);
  const status = useAsync(() => duels.getRivalryStatus(), [network]);
  // Podczas zmiany zasięgu / okresu nie pokazujemy poprzedniego rankingu.
  const data = ranking.data && ranking.data.scope === scope && ranking.data.period === period ? ranking.data : undefined;
  const pinned = data?.me ?? null;
  const { bottom } = useScreenPadding();
  const pinnedBottom = useBottomPadding();

  const back = () => (router.canGoBack() ? router.back() : router.navigate('/rywalizacja' as Href));

  return (
    <Screen
      contentStyle={pinned ? { paddingBottom: bottom + PINNED_SPACE } : undefined}
      toastBottom={pinned ? pinnedBottom + PINNED_SPACE : undefined}
      overlay={
        pinned && !ranking.error ? (
          <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: pinnedBottom }}>
            <PlayerRankRow row={pinned} style={{ boxShadow: shadows.dialog }} />
          </View>
        ) : null
      }
    >
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 14, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton icon="arrow_back" onPress={back} accessibilityLabel="Wróć" />
          <Txt f="b7" size={18}>
            Ranking grzybiarzy
          </Txt>
          <View style={{ width: 44 }} />
        </View>

        <SegmentedControl value={scope} onChange={setScope} options={RANKING_SCOPES.map((o) => ({ value: o.value, label: o.short }))} />
        <SegmentedControl value={period} onChange={setPeriod} options={RANKING_PERIODS} />

        {ranking.error ? (
          <OfflineCard onRetry={ranking.reload} />
        ) : (
          <RankingBody data={data} scope={scope} period={period} review={status.data?.standing === 'review'} />
        )}
      </View>
    </Screen>
  );
}

function RankingBody({
  data,
  scope,
  period,
  review,
}: {
  data?: PlayerRanking;
  scope: PlayerRankingScope;
  period: PlayerRankingPeriod;
  review: boolean;
}) {
  if (!data) {
    return (
      <View style={{ gap: 8 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </View>
    );
  }
  const rows = data.rows;
  const meOutside = data.me && !rows.some((r) => r.isMe);
  const isPublic = scope !== 'znajomi';
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 2 }}>
        <Txt f="b7" size={18} numberOfLines={1} style={{ flexShrink: 1 }}>
          {rankingTitle(data)}
        </Txt>
        {data.total ? (
          <Txt f="n8" size={13} color={colors.primaryText}>
            {fmtMushroomers(data.total)}
          </Txt>
        ) : null}
      </View>

      {data.hidden && isPublic ? (
        <Banner
          icon="visibility_off"
          title="Jesteś ukryty w rankingach"
          text="Inni nie widzą Cię tutaj ani na tablicach walk o okaz. Zmień to w Ustawieniach → Prywatność."
          onPress={() => router.push('/ustawienia' as Href)}
        />
      ) : null}
      {review ? (
        <Banner
          icon="policy"
          title="Twoje wyniki są w weryfikacji"
          text="Na razie inni ich nie widzą, a rywalizacja nie daje nagród. Sprawdzimy je najszybciej, jak się da."
        />
      ) : null}

      {!rows.length ? (
        <EmptyRanking data={data} scope={scope} period={period} />
      ) : (
        <>
          {rows.map((r) => (
            <PlayerRankRow key={`${r.rank}:${r.user.id}`} row={r} />
          ))}
          {/* Gracz spoza listy – jego wiersz jest przypięty na dole ekranu. */}
          {meOutside ? (
            <Txt f="b7" size={18} color={colors.faint} align="center" lh={1}>
              ⋯
            </Txt>
          ) : null}
        </>
      )}

      {data.pendingXp > 0 ? (
        <Pill label={pendingXpText(data.pendingXp)} icon="schedule" size={12} bg={colors.infoBg} color={colors.infoText} style={{ marginTop: 4 }} />
      ) : null}
      <Footnote
        icon={data.live ? 'group' : 'schedule'}
        text={
          data.live
            ? 'Znajomi widzą Wasze punkty na żywo – bez gminy i miejsc.'
            : 'Ranking uwzględnia punkty sprzed 24 h – tak chronimy lokalizację grzybiarzy.'
        }
      />
      <Footnote icon="verified" text="Punkty: XP ze zweryfikowanych znalezisk, wyzwań gmin, walk o okaz i pojedynków (bez osiągnięć i zadań)." />
    </View>
  );
}

function EmptyRanking({ data, scope, period }: { data: PlayerRanking; scope: PlayerRankingScope; period: PlayerRankingPeriod }) {
  if (scope === 'znajomi') {
    return (
      <StateCard
        icon="group"
        title="Jeszcze bez punktów"
        text={`Ty i znajomi nie macie punktów ${PERIOD_PHRASE[period]}. Zaproś kogoś i ruszajcie do lasu!`}
        action="Znajomi"
        onAction={() => router.push('/znajomi' as Href)}
      />
    );
  }
  if (scope !== 'polska' && !data.scopeId) {
    return (
      <StateCard
        icon="home_pin"
        title="Wybierz gminę domową"
        text="Ranking gminy i województwa liczymy dla Twojej gminy domowej."
        action="Wybierz gminę"
        onAction={() => router.push('/ustawienia/gmina' as Href)}
      />
    );
  }
  return <StateCard icon="emoji_events" title="Ranking jest jeszcze pusty" text={`Nikt nie ma tu jeszcze punktów ${PERIOD_PHRASE[period]} – bądź pierwszy!`} />;
}

function Banner({ icon, title, text, onPress }: { icon: IconName; title: string; text: string; onPress?: () => void }) {
  const body = (
    <>
      <Icon name={icon} filled size={24} color={colors.warnIcon} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt f="n8" size={14} color={colors.warnTitle}>
          {title}
        </Txt>
        <Txt f="n6" size={12} color={colors.warnText}>
          {text}
        </Txt>
      </View>
      {onPress ? <Icon name="chevron_right" size={20} color={colors.warnIcon} /> : null}
    </>
  );
  const style = {
    backgroundColor: colors.warnBg,
    borderWidth: 2,
    borderColor: colors.warnBorder,
    borderRadius: 18,
    padding: 12,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
  };
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [style, pressed && { opacity: 0.85 }]}>
      {body}
    </Pressable>
  );
}

function Footnote({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 4, paddingTop: 2 }}>
      <Icon name={icon} size={16} color={colors.muted} />
      <Txt f="n6" size={12} color={colors.muted} style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}
