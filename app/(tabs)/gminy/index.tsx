import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { OfflineCard } from '@/components/OfflineCard';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { Bone, SkeletonRow } from '@/components/Skeleton';
import { Txt } from '@/components/Txt';
import { useAsync } from '@/hooks/useAsync';
import { useServices } from '@/services';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useSimStore } from '@/store/useSimStore';
import { ui, useUiStore } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';
import { colors, heat as heatColors, medalDefault, medals, shadows } from '@/theme/tokens';
import type { Gmina, RankingPeriod, RankingRow } from '@/types';
import { fmtInt } from '@/utils/format';

const TILE = 36;
const GAP = 5;
const COLS = 8;
const ROWS = 7;
const GRID_W = COLS * TILE + (COLS - 1) * GAP;

export default function GminyScreen() {
  const { stats } = useServices();
  const [period, setPeriod] = useState<RankingPeriod>('week');
  const network = useSimStore((s) => s.networkEnabled);
  const ranking = useAsync(() => stats.getRanking(period), [period, network]);
  const homeId = useSimStore((s) => s.forcedGminaId) ?? useUserStore.getState().user.homeGminaId;

  return (
    <Screen tabs>
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Txt f="b7" size={30}>
            Gminy
          </Txt>
          <Pressable
            onPress={pickVoivodeship}
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
              podlaskie
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
          <>
            <Heatmap heat={ranking.data?.heat} homeId={homeId} loading={ranking.loading && !ranking.data} />
            <LeaderBanner rows={ranking.data?.rows} homeId={homeId} contribution={ranking.data?.userContribution} />
            <View style={{ gap: 8, paddingBottom: 8 }}>
              {ranking.loading && !ranking.data
                ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                : ranking.data?.rows.map((r) => <RankRow key={r.gminaId} row={r} mine={r.gminaId === homeId} />)}
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}

function pickVoivodeship() {
  useUiStore.getState().showDialog({
    title: 'Województwo',
    message: 'W prototypie dostępne jest tylko podlaskie – pozostałe regiony pojawią się wkrótce.',
    icon: 'map',
    actions: [
      { label: 'podlaskie ✓', style: 'primary' },
      { label: 'mazowieckie', style: 'default', onPress: () => ui.soon('Mazowieckie') },
      { label: 'Zamknij', style: 'cancel' },
    ],
  });
}

function Heatmap({ heat, homeId, loading }: { heat?: Record<string, number>; homeId: string; loading: boolean }) {
  const all = useCatalogStore((s) => s.gminy);
  // Na heatmapie tylko gminy z kaflem (wykryte z GPS spoza danych gry jej nie mają).
  const gminy = useMemo(() => all.filter((g): g is Gmina & { tile: NonNullable<Gmina['tile']> } => !!g.tile), [all]);
  const [selected, setSelected] = useState<string>(homeId);
  const [cardW, setCardW] = useState(350);
  const [tipW, setTipW] = useState(170);
  const byCell = useMemo(() => {
    const m = new Map<string, Gmina>();
    gminy.forEach((g) => m.set(`${g.tile.row},${g.tile.col}`, g));
    return m;
  }, [gminy]);

  const sel = gminy.find((g) => g.id === selected);
  const inner = cardW - 32;
  const x0 = 16 + (inner - GRID_W) / 2;
  const tipPos = sel
    ? (() => {
        const tx = x0 + sel.tile.col * (TILE + GAP);
        const ty = 16 + sel.tile.row * (TILE + GAP);
        const left = Math.max(8, Math.min(tx - 40.5, cardW - tipW - 8));
        const top = ty - 63 < 4 ? ty + TILE + 8 : ty - 63;
        return { left, top };
      })()
    : null;

  const onTile = (g: Gmina) => {
    if (g.id === selected) router.push(`/gminy/${g.id}`);
    else setSelected(g.id);
  };

  return (
    <Card radius={26} padding={16} gap={12} style={{ position: 'relative' }}>
      <View onLayout={(e) => setCardW(e.nativeEvent.layout.width + 32)} style={{ alignItems: 'center' }}>
        <View style={{ width: GRID_W, gap: GAP }}>
          {Array.from({ length: ROWS }).map((_, r) => (
            <View key={r} style={{ flexDirection: 'row', gap: GAP }}>
              {Array.from({ length: COLS }).map((__, c) => {
                const g = byCell.get(`${r},${c}`);
                if (!g) return <View key={c} style={{ width: TILE, height: TILE }} />;
                const level = heat?.[g.id] ?? 0;
                const isSel = g.id === selected;
                return (
                  <Pressable
                    key={c}
                    accessibilityLabel={`Gmina ${g.name}`}
                    onPress={() => onTile(g)}
                    style={{
                      width: TILE,
                      height: TILE,
                      borderRadius: 11,
                      backgroundColor: loading ? colors.chip : heatColors[level],
                      boxShadow: isSel ? shadows.selectedTile : undefined,
                      zIndex: isSel ? 2 : 0,
                    }}
                  />
                );
              })}
            </View>
          ))}
        </View>
      </View>
      {sel && tipPos && !loading ? (
        <Animated.View
          key={sel.id}
          entering={FadeIn.duration(150)}
          onLayout={(e) => setTipW(e.nativeEvent.layout.width)}
          style={{
            position: 'absolute',
            left: tipPos.left,
            top: tipPos.top,
            backgroundColor: colors.ink,
            borderRadius: 14,
            paddingVertical: 7,
            paddingHorizontal: 11,
            boxShadow: shadows.tooltip,
            zIndex: 5,
          }}
        >
          <Pressable onPress={() => router.push(`/gminy/${sel.id}`)}>
            <Txt f="n8" size={12} color={colors.bg}>
              {sel.name} · {fmtInt(sel.mushroomers)} grzybiarzy
            </Txt>
          </Pressable>
        </Animated.View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
        <Txt f="n7" size={12} color={colors.muted}>
          mniej
        </Txt>
        <View style={{ flexDirection: 'row', gap: 3 }}>
          {heatColors.map((c) => (
            <View key={c} style={{ width: 14, height: 14, borderRadius: 5, backgroundColor: c }} />
          ))}
        </View>
        <Txt f="n7" size={12} color={colors.muted}>
          więcej zbiorów
        </Txt>
      </View>
    </Card>
  );
}

function LeaderBanner({ rows, homeId, contribution }: { rows?: RankingRow[]; homeId: string; contribution?: number }) {
  const gmina = useCatalogStore((s) => s.gminaById[homeId]);
  if (!rows) {
    return (
      <View style={{ backgroundColor: colors.forest, borderRadius: 20, padding: 14, gap: 8, boxShadow: shadows.forest }}>
        <Bone w="70%" h={14} style={{ backgroundColor: 'rgba(255,255,255,0.15)' }} />
        <Bone w="50%" h={12} style={{ backgroundColor: 'rgba(255,255,255,0.15)' }} />
      </View>
    );
  }
  const mine = rows.find((r) => r.gminaId === homeId);
  const title = !mine
    ? `Gmina ${gmina?.name} walczy o podium!`
    : mine.rank === 1
      ? 'Twoja gmina prowadzi w województwie!'
      : `Twoja gmina jest na ${mine.rank}. miejscu!`;
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
          Twój wkład w tym tygodniu: {fmtInt(contribution ?? 0)} pkt
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
