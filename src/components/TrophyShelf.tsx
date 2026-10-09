import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useAsync } from '@/hooks/useAsync';
import { useServices } from '@/services';
import { useSimStore } from '@/store/useSimStore';
import { useStatsSync } from '@/store/useStatsSync';
import { colors, medals, shadows } from '@/theme/tokens';
import type { Trophy, TrophyCase } from '@/types';
import { CONTEST_SCOPE_IN, fmtCm, groupTrophies } from '@/utils/contests';
import { fmtDayMonth, fmtInt, plural } from '@/utils/format';
import { Icon } from './Icon';
import { StateCard } from './OfflineCard';
import { SeeAllButton, SectionHeader } from './SectionHeader';
import { SkeletonRow } from './Skeleton';
import { Txt } from './Txt';

const PLACE_NAME = ['Złoto', 'Srebro', 'Brąz'] as const;

/** Medal z miejscem (złoto / srebro / brąz z tokenów rankingu). */
export function TrophyMedal({ place, size = 40 }: { place: 1 | 2 | 3; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: medals[place - 1],
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: shadows.badgeInset,
      }}
    >
      <Icon name="military_tech" filled size={Math.round(size * 0.58)} color={colors.legendInk} />
    </View>
  );
}

/** Trzy kafle: liczba złotych, srebrnych i brązowych miejsc na podium. */
export function TrophyCounts({ trophies }: { trophies: Pick<TrophyCase, 'gold' | 'silver' | 'bronze'> }) {
  const counts = [trophies.gold, trophies.silver, trophies.bronze];
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {counts.map((n, i) => (
        <View
          key={i}
          accessible
          accessibilityLabel={`${PLACE_NAME[i]}: ${n}`}
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: colors.card,
            borderRadius: 18,
            paddingVertical: 10,
            paddingHorizontal: 12,
            boxShadow: shadows.card,
          }}
        >
          <TrophyMedal place={(i + 1) as 1 | 2 | 3} size={32} />
          <View>
            <Txt f="b7" size={20} lh={1.1}>
              {fmtInt(n)}
            </Txt>
            <Txt f="n8" size={11} color={colors.muted}>
              {PLACE_NAME[i]}
            </Txt>
          </View>
        </View>
      ))}
    </View>
  );
}

const placeText = (t: Trophy) =>
  `${t.place}. ${CONTEST_SCOPE_IN[t.scope]}${t.scope !== 'polska' && t.scopeName ? ` (${t.scopeName})` : ''}`;

/**
 * Trofeum: medal, walka, miejsce i zasięg („2. w województwie (podlaskie)”), okaz, data, XP nagrody. `also` – inne
 * podia tej samej walki (bez nagrody – gracz dostaje w walce tylko najwyższą).
 */
export function TrophyRow({ trophy: t, also = [] }: { trophy: Trophy; also?: Trophy[] }) {
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 18,
        paddingVertical: 10,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        boxShadow: shadows.card,
      }}
    >
      <TrophyMedal place={t.place} />
      <View style={{ flex: 1, gap: 1 }}>
        <Txt f="n8" size={15} numberOfLines={1}>
          {t.contestTitle}
        </Txt>
        <Txt f="n7" size={12} color={colors.muted} numberOfLines={1}>
          {placeText(t)} · {fmtCm(t.capCm)}
        </Txt>
        {also.length ? (
          <Txt f="n7" size={11} color={colors.muted} numberOfLines={2}>
            Też: {also.map(placeText).join(', ')}
          </Txt>
        ) : null}
        <Txt f="n7" size={11} color={colors.faint} numberOfLines={1}>
          {t.awardedAt ? fmtDayMonth(new Date(t.awardedAt)) : ''}
        </Txt>
      </View>
      {t.xp > 0 ? (
        <Txt f="n8" size={14} color={colors.primaryText}>
          +{fmtInt(t.xp)} XP
        </Txt>
      ) : null}
    </View>
  );
}

const EMPTY_TEXT = 'Zgłoś okaz do walki tygodnia – za podium w gminie, województwie albo w Polsce dostaniesz trofeum i XP.';

/**
 * Sekcja „Trofea” (Profil, ekran Rywalizacja): liczniki medali i najnowsze trofea. `onSeeAll` – przycisk pod listą.
 * Błąd / brak sieci – krótka informacja zamiast karty błędu (sekcja jest dodatkiem do ekranu).
 */
export function TrophySection({
  limit = 3,
  onSeeAll,
  title = 'Trofea',
  expandable,
}: {
  limit?: number;
  onSeeAll?: () => void;
  title?: string;
  /** „Pokaż wszystkie trofea (N)” pod listą, gdy jest ich więcej niż `limit` (rozwinięcie na miejscu). */
  expandable?: boolean;
}) {
  const { contests } = useServices();
  const [all, setAll] = useState(false);
  const network = useSimStore((s) => s.networkEnabled);
  const version = useStatsSync((s) => s.version);
  const res = useAsync(() => contests.getTrophies(), [network, version]);
  const data = res.data;
  const total = data ? data.gold + data.silver + data.bronze : 0;
  const groups = data ? groupTrophies(data.items) : [];
  return (
    <View style={{ gap: 10 }}>
      <SectionHeader
        title={title}
        count={data && total ? `${fmtInt(total)} ${plural(total, 'medal', 'medale', 'medali')}` : undefined}
      />
      {data ? (
        total === 0 ? (
          <StateCard icon="military_tech" title="Jeszcze bez trofeów" text={EMPTY_TEXT} />
        ) : (
          <>
            <TrophyCounts trophies={data} />
            {(all ? groups : groups.slice(0, limit)).map((g) => (
              <TrophyRow key={g.top.id} trophy={g.top} also={g.also} />
            ))}
            {expandable && groups.length > limit ? (
              <Pressable onPress={() => setAll((v) => !v)} hitSlop={6} accessibilityRole="button" style={{ alignSelf: 'center', paddingVertical: 2 }}>
                <Txt f="b7" size={15} color={colors.outlineText}>
                  {all ? 'Zwiń' : `Pokaż wszystkie trofea (${groups.length})`}
                </Txt>
              </Pressable>
            ) : null}
          </>
        )
      ) : res.error ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 4 }}>
          <Icon name="wifi_off" size={16} color={colors.muted} />
          <Txt f="n6" size={13} color={colors.muted} style={{ flex: 1 }}>
            Trofea pojawią się, gdy wróci połączenie.
          </Txt>
        </View>
      ) : (
        <SkeletonRow />
      )}
      {onSeeAll ? <SeeAllButton label="Rywalizacja" onPress={onSeeAll} /> : null}
    </View>
  );
}
