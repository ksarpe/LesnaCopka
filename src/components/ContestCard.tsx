import { router, type Href } from 'expo-router';
import { Pressable, View } from 'react-native';

import { useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useServices } from '@/services';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useSimStore } from '@/store/useSimStore';
import { useStatsSync } from '@/store/useStatsSync';
import { todayKey, useUserStore } from '@/store/useUserStore';
import { colors, medals, rarity as rarityTokens, shadows } from '@/theme/tokens';
import type { Contest, ContestEntry, RivalryStatus } from '@/types';
import {
  CONTEST_SCOPE_IN,
  contestCountdown,
  contestWeekBounds,
  contestWeekStart,
  fmtContestScore,
  fmtTimeLeft,
} from '@/utils/contests';
import { Card } from './Card';
import { Icon } from './Icon';
import { Pill } from './Pill';
import { Thumb } from './Thumb';
import { Txt } from './Txt';

/**
 * Stan z makiety (scenariusze dev-linków `?scenario=…` i panelu /dev przypinają zadania dnia z makiety): ekrany
 * z makiety nie pokazują wtedy kart rywalizacji – zrzuty zgadzają się z plikiem 1:1.
 */
export function useDesignScenario(): boolean {
  return useUserStore((s) => !!s.quests.pinned && s.quests.date === todayKey());
}

/** Ekran walki (tablica wyników). */
export const contestHref = (id: string, scope?: string) =>
  `/rywalizacja/walka/${encodeURIComponent(id)}${scope ? `?zasieg=${scope}` : ''}` as Href;

/** Znak walki: „Okaz tygodnia” – złoty puchar, walka gatunku – kafel w kolorze rzadkości gatunku ze znakiem grzyba. */
export function ContestIcon({ contest, size = 48 }: { contest: Pick<Contest, 'kind' | 'speciesId'>; size?: number }) {
  const rarity = useCatalogStore((s) => (contest.speciesId ? s.speciesById[contest.speciesId]?.rarity : undefined));
  const radius = Math.round(size * 0.3);
  if (contest.kind === 'relative') {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: medals[0],
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="emoji_events" filled size={Math.round(size * 0.56)} color={colors.legendInk} />
      </View>
    );
  }
  return <Thumb size={size} radius={radius} borderColor={rarityTokens[rarity ?? 'pospolity'].color} borderWidth={2.5} />;
}

/** Podpis pod tytułem walki: gatunek tygodnia albo zasada „Okazu tygodnia”. */
export function contestRule(c: Pick<Contest, 'kind'>): string {
  return c.kind === 'relative'
    ? 'Dowolny gatunek – kapelusz względem typowego'
    : 'Średnica kapelusza zmierzona przy odniesieniu skali';
}

/** „Twój okaz: 18,5 cm · 4. w województwie” – miejsce, „widoczny od…” albo „w weryfikacji”. */
export function mineLine(c: Pick<Contest, 'kind'>, mine: ContestEntry, status?: RivalryStatus | null): string {
  const score = fmtContestScore(c.kind, mine.score);
  if (mine.status === 'review') return `Twój okaz: ${score} · w weryfikacji`;
  if (mine.rank != null) return `Twój okaz: ${score} · ${mine.rank}. ${CONTEST_SCOPE_IN.wojewodztwo}`;
  // Bez miejsca: przed upływem 24 h, gracz w weryfikacji albo ukryty w rankingach (serwer nie liczy go w zasięgach).
  if (mine.visibleFrom) return `Twój okaz: ${score} · inni zobaczą go po 24 h`;
  if (status?.standing === 'review') return `Twój okaz: ${score} · wyniki w weryfikacji`;
  if (status && !status.showInRankings) return `Twój okaz: ${score} · ukryty w rankingach`;
  return `Twój okaz: ${score}`;
}

/**
 * Karta walki tygodnia (ekran Rywalizacja): znak i tytuł, czas do końca, mój okaz z miejscem w województwie
 * i lider województwa gracza. Tap → tablica wyników.
 */
export function ContestCard({
  contest: c,
  mine,
  leader,
  voivodeship,
  now,
  status,
}: {
  contest: Contest;
  mine?: ContestEntry | null;
  leader?: ContestEntry | null;
  /** Województwo gracza (podpis lidera). */
  voivodeship?: string;
  now: number;
  /** Status gracza w rywalizacji – dlaczego okaz nie ma miejsca (weryfikacja, ukrycie w rankingach). */
  status?: RivalryStatus | null;
}) {
  const open = c.status === 'open' && now < Date.parse(c.endsAt);
  const leaderIsMe = !!leader?.isMine;
  return (
    <Pressable
      onPress={() => router.push(contestHref(c.id))}
      accessibilityRole="button"
      accessibilityLabel={`${c.title}, ${contestCountdown(c, now)}`}
      style={({ pressed }) => ({
        backgroundColor: pressed ? '#FDFBF6' : colors.card,
        borderRadius: 20,
        padding: 14,
        gap: 12,
        boxShadow: shadows.card,
        borderWidth: 2.5,
        borderColor: mine ? colors.primary : 'transparent',
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <ContestIcon contest={c} size={46} />
        <View style={{ flex: 1, gap: 1 }}>
          <Txt f="n8" size={16} numberOfLines={2} lh={1.2}>
            {c.title}
          </Txt>
          <Txt f="n7" size={12} color={colors.muted} numberOfLines={1}>
            {contestRule(c)}
          </Txt>
        </View>
        <Icon name="chevron_right" size={22} color={colors.disabled} />
      </View>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon
            name={mine ? 'check_circle' : 'add_a_photo'}
            filled={!!mine}
            size={18}
            color={mine ? colors.primaryText : colors.muted}
          />
          <Txt f={mine ? 'n8' : 'n7'} size={13} color={mine ? colors.ink : colors.muted} style={{ flex: 1 }} numberOfLines={1}>
            {mine ? mineLine(c, mine, status) : open ? 'Nie walczysz – zgłoś okaz z tego tygodnia' : 'Nie walczysz w tym tygodniu'}
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="emoji_events" filled size={18} color={leader ? medals[0] : colors.disabled} />
          <Txt f="n7" size={13} color={colors.bodyDark} style={{ flex: 1 }} numberOfLines={1}>
            {leader
              ? `${leaderIsMe ? 'Prowadzisz' : `Prowadzi ${leader.author.name}`} · ${fmtContestScore(c.kind, leader.score)}${voivodeship ? ` · ${voivodeship}` : ''}`
              : 'W województwie nikt jeszcze nie walczy – bądź pierwszy!'}
          </Txt>
        </View>
      </View>
      <Pill
        label={contestCountdown(c, now)}
        icon={open ? 'schedule' : 'hourglass_top'}
        bg={open ? colors.primaryTint : colors.chip}
        color={open ? colors.primaryTintText : colors.tagNeutralText}
        size={12}
        padV={3}
        padH={9}
        iconSize={14}
      />
    </Pressable>
  );
}

/**
 * Karta walki tygodnia na ekranie Wyprawa (stan „idle”): mój okaz z miejscem albo zaproszenie do walki i czas do
 * końca tygodnia. Bez danych (ładowanie, brak sieci) – sam tytuł i czas liczony w telefonie. Tap → Rywalizacja.
 * W stanach z makiety (scenariusze) karty nie ma.
 */
export function ContestWeekTeaser() {
  const design = useDesignScenario();
  const { contests } = useServices();
  const network = useSimStore((s) => s.networkEnabled);
  const version = useStatsSync((s) => s.version);
  const now = useNow(60_000);
  const week = useAsync(() => (design ? Promise.resolve(null) : contests.getContestWeek()), [network, version, design]);
  if (design) return null;
  const data = week.data ?? null;
  const mineContest = data?.contests.find((c) => data.mine[c.id]);
  const mine = mineContest ? data?.mine[mineContest.id] : undefined;
  const speciesTitles =
    data?.contests.filter((c) => c.kind === 'species').map((c) => c.title.replace(/^Największ[ya] /, '')) ?? [];
  const endsAt = data?.contests[0]?.endsAt ?? contestWeekBounds(contestWeekStart(now)).endsAt;
  const left = Date.parse(endsAt) - now;
  return (
    <Card
      onPress={() => router.push('/rywalizacja' as Href)}
      radius={22}
      padding={{ v: 12, h: 14 }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
    >
      <ContestIcon contest={{ kind: 'relative', speciesId: null }} size={42} />
      <View style={{ flex: 1, gap: 1 }}>
        <Txt f="n8" size={15} numberOfLines={1}>
          {mine ? 'Twój okaz walczy!' : 'Walka o okaz tygodnia'}
        </Txt>
        <Txt f="n7" size={12} color={colors.muted} numberOfLines={2}>
          {mine && mineContest
            ? `${mineContest.title}: ${mineLine(mineContest, mine).replace(/^Twój okaz: /, '')}`
            : speciesTitles.length
              ? `Okaz tygodnia, ${speciesTitles.join(' i ')} – zrób zdjęcie z dłonią obok`
              : 'Zrób zdjęcie z dłonią albo monetą obok i zgłoś największy okaz'}
        </Txt>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Txt f="n8" size={12} color={left > 0 ? colors.primaryText : colors.muted}>
          {left > 0 ? fmtTimeLeft(left) : 'wyniki'}
        </Txt>
        <Icon name="chevron_right" size={20} color={colors.disabled} />
      </View>
    </Card>
  );
}

/**
 * Mała karta wejścia do Rywalizacji (zakładka Gminy) w stylu banera lidera: puchar, tytuł i podpis.
 */
export function RivalryBanner({ title, subtitle, onPress }: { title: string; subtitle: string; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress ?? (() => router.push('/rywalizacja' as Href))}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      style={({ pressed }) => ({
        backgroundColor: colors.forest,
        borderRadius: 20,
        padding: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        boxShadow: shadows.forest,
        opacity: pressed ? 0.92 : 1,
      })}
    >
      <Icon name="military_tech" filled size={30} color={medals[0]} />
      <View style={{ flex: 1 }}>
        <Txt f="n8" size={14} color={colors.onDark} numberOfLines={1}>
          {title}
        </Txt>
        <Txt f="n7" size={12} color={colors.onDark} style={{ opacity: 0.85 }} numberOfLines={2}>
          {subtitle}
        </Txt>
      </View>
      <Icon name="chevron_right" size={22} color={colors.onDarkMuted} />
    </Pressable>
  );
}
