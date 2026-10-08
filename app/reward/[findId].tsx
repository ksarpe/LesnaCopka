import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { memo, useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, View, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { AchievementMedal } from '@/components/Achievement';
import { BadgeCircle } from '@/components/Badge';
import { Button3D, Press3D } from '@/components/Button3D';
import { Icon } from '@/components/Icon';
import { Pill } from '@/components/Pill';
import { Placeholder } from '@/components/Placeholder';
import { XpBarAnimated } from '@/components/ProgressBar';
import { Burst, Glow, Rays } from '@/components/RewardFx';
import { Screen, SCREEN_LIST_PROPS } from '@/components/Screen';
import { AiSafetyNote, FIRST_IN_GMINA } from '@/components/SpeciesSheet';
import { Txt } from '@/components/Txt';
import { useAsync } from '@/hooks/useAsync';
import { useCountUp, useTicker } from '@/hooks/useCountUp';
import { useFindPhotoSource } from '@/hooks/useFindPhotoSource';
import { useBottomPadding } from '@/hooks/useInsets';
import { useServices } from '@/services';
import { achievementTitle, grantPendingRewards } from '@/store/game';
import { useCatalogStore } from '@/store/useCatalogStore';
import { holdHydration } from '@/store/useOutboxStore';
import { useTripStore } from '@/store/useTripStore';
import { colors, rarity as rarityTokens } from '@/theme/tokens';
import type { AchievementUnlock, XpLine } from '@/types';
import { ACHIEVEMENT_BY_ID } from '@/utils/achievements';
import { fmtInt, fmtWeight, gminaTitle, plural } from '@/utils/format';
import { levelThreshold } from '@/utils/xp';

const PHOTO = 170;
const BAR_DELAY = 500;
const BAR_DURATION = 1600;
/** Liczby XP w kolumnie – stała referencja, żeby liczniki `memo` nie przerysowywały się z rodzicem. */
const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

export default function RewardScreen() {
  const { findId } = useLocalSearchParams<{ findId: string }>();
  // Tryb Supabase: stan z serwera nie podmienia liczb w trakcie animacji (przyjmiemy go po wyjściu z ekranu).
  useEffect(() => holdHydration(), []);
  const find = useTripStore((s) => s.finds[findId]);
  const photo = useFindPhotoSource(find?.photoUri);
  const species = useCatalogStore((s) => (find ? s.speciesById[find.speciesId] : undefined));
  const gmina = useCatalogStore((s) => (find ? s.gminaById[find.gminaId] : undefined));
  const badgeById = useCatalogStore((s) => s.badgeById);
  const { stats } = useServices();
  const pct = useAsync(
    () => (find ? stats.getSpeciesPercentile(find.speciesId, find.gminaId, find.dimensions) : Promise.reject(new Error('brak'))),
    [findId],
  );

  const reward = find?.reward;
  const levelUp = !!reward && reward.levelAfter > reward.levelBefore;
  const [leveled, setLeveled] = useState(false);
  // Przyklejone przyciski: toast pokazujemy nad nimi.
  const [footerH, setFooterH] = useState(0);
  const bottom = useBottomPadding();
  const leaving = useRef(false);
  const pop = useSharedValue(1);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  const onCross = () => {
    setLeveled(true);
    pop.set(withSequence(withTiming(1.25, { duration: 160 }), withSpring(1, { damping: 7 })));
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  if (!find || !species || !reward || !find.xp) {
    return (
      <Screen bg={colors.night} statusBar="light">
        <View style={{ padding: 20, gap: 16 }}>
          <Txt f="b7" size={24} color={colors.onDark}>
            Brak nagrody do pokazania
          </Txt>
          <Button3D title="Wróć" onDark onPress={() => router.navigate('/')} />
        </View>
      </Screen>
    );
  }

  const r = rarityTokens[find.rarity];
  const level = leveled ? reward.levelAfter : reward.levelBefore;
  const max = levelThreshold(level);
  const fromFrac = reward.xpBefore / levelThreshold(reward.levelBefore);
  const toFrac = reward.xpAfter / levelThreshold(reward.levelAfter);
  const badge = reward.unlockedBadgeIds.map((id) => badgeById[id]).find(Boolean);
  const amount = find.dimensions.pieces ? `${find.dimensions.pieces} szt.` : fmtWeight(find.dimensions.weightG);

  /**
   * „Zbieram dalej” (Start) i „Skanuj kolejnego” (aparat): XP za ukończone zadania i osiągnięcia wypłacamy już
   * na następnym ekranie – tam pojawią się toasty. Wyprawę zaczął (jeśli trzeba) odbiór nagrody na Analizie.
   */
  const leave = (next: 'home' | 'scan') => {
    if (leaving.current) return;
    leaving.current = true;
    if (next === 'scan') router.replace('/scan');
    else {
      if (router.canDismiss()) router.dismissAll();
      router.navigate('/');
    }
    setTimeout(grantPendingRewards, 450);
  };

  return (
    <Screen bg={colors.night} statusBar="light" scroll={false} toastBottom={footerH ? footerH + 8 : undefined}>
      {/* Treść przewija się (np. iPhone SE, odznaka + osiągnięcie), przyciski zostają przyklejone na dole. */}
      <ScrollView style={{ flex: 1 }} {...SCREEN_LIST_PROPS}>
        <View
          style={{
            paddingTop: 14,
            paddingHorizontal: 20,
            paddingBottom: 16,
            alignItems: 'center',
            gap: 16,
            overflow: 'hidden',
          }}
        >
          <View style={{ position: 'absolute', left: '50%', top: 150 - 320, marginLeft: -320 }}>
            <Rays />
          </View>
          <Txt f="n8" size={13} color={colors.onDarkMuted} upper ls={0.14}>
            {find.collected ? 'Nowe znalezisko!' : 'Nowy wpis w atlasie!'}
          </Txt>
          <Txt f="b8" size={44} lh={1} color={r.color} upper ls={0.06}>
            {r.label}
          </Txt>
          <View style={{ width: PHOTO, height: PHOTO, marginTop: 6 }}>
            <Glow color={r.color} photoSize={PHOTO} />
            <View
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: PHOTO,
                height: PHOTO,
                borderRadius: PHOTO / 2,
                borderWidth: 6,
                borderColor: r.color,
                overflow: 'hidden',
              }}
            >
              {/* Bez zdjęcia (np. scenariusz z makiety, usunięty plik): kafel w kolorze rzadkości ze znakiem grzyba. */}
              <Placeholder
                source={photo}
                tile={{ tint: r.color, glyph: 'mushroom', glyphSize: 72 }}
                style={{ flex: 1, backgroundColor: colors.camera }}
              />
            </View>
            <Burst trigger={leveled ? 1 : 0} color={colors.scanGreen} />
          </View>
          <View style={{ alignItems: 'center' }}>
            <Txt f="b7" size={26} color={colors.onDark} align="center">
              {species.name}
            </Txt>
            <Txt f="n7" size={14} color={colors.onDarkMuted}>
              {amount} · {gminaTitle(gmina)}
            </Txt>
            {reward.personalRecord ? (
              <Pill
                label="Rekord osobisty!"
                icon="emoji_events"
                iconFilled
                bg="rgba(239,168,49,0.18)"
                color="#F6CF86"
                style={{ alignSelf: 'center', marginTop: 8 }}
              />
            ) : null}
          </View>
          <AiSafetyNote dark align="center" />

          <View
            style={{
              width: '100%',
              backgroundColor: 'rgba(255,255,255,0.08)',
              borderRadius: 22,
              paddingVertical: 14,
              paddingHorizontal: 16,
              gap: 9,
            }}
          >
            {find.xp.lines.map((l, i) => (
              <XpRow key={l.label} line={l} delay={300 + i * 120} />
            ))}
            <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.15)' }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Txt f="n8" size={15} color={colors.onDark}>
                Razem
              </Txt>
              <XpTotal total={find.xp.total} />
            </View>
          </View>

          <View style={{ width: '100%', gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Animated.View style={popStyle}>
                <Txt f="n8" size={13} color={leveled ? colors.xpOnDark : colors.onDark}>
                  {leveled ? `LEVEL UP! Poziom ${reward.levelAfter}` : `Poziom ${reward.levelBefore}`}
                </Txt>
              </Animated.View>
              <XpTicker
                before={reward.xpBefore}
                after={reward.xpAfter}
                levelUp={levelUp}
                thresholdBefore={levelThreshold(reward.levelBefore)}
                leveled={leveled}
                max={max}
              />
            </View>
            <XpBarAnimated
              from={fromFrac}
              to={toFrac}
              levelUp={levelUp}
              delay={BAR_DELAY}
              duration={BAR_DURATION}
              onCrossLevel={onCross}
            />
          </View>

          {badge ? (
            <View
              style={{
                width: '100%',
                backgroundColor: colors.badgeCard,
                borderRadius: 22,
                padding: 14,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                boxShadow: '0px 4px 0px #C8B78F',
              }}
            >
              <BadgeCircle badge={badge} size={54} iconSize={32} />
              <View style={{ flex: 1 }}>
                <Txt f="n8" size={11} color={colors.legendText} upper ls={0.08}>
                  Nowa odznaka
                </Txt>
                <Txt f="b7" size={19}>
                  {badge.name}
                </Txt>
                <Txt f="n7" size={12} color={colors.muted}>
                  {badge.description}
                </Txt>
              </View>
            </View>
          ) : null}

          {reward.unlockedAchievements?.length ? <AchievementCard unlocks={reward.unlockedAchievements} /> : null}

          <Txt f="n7" size={13} color={colors.onDarkMuted} align="center">
            {/* collected = 0 (tryb Supabase): nikt jeszcze nie zebrał tu tego gatunku w tym sezonie. */}
            {pct.data?.collected === 0
              ? FIRST_IN_GMINA
              : pct.data
                ? `${pct.data.mushroomers} ${plural(pct.data.mushroomers, 'osoba znalazła', 'osoby znalazły', 'osób znalazło')} ten gatunek w gminie w tym sezonie – ${
                    pct.data.biggerCount === 0
                      ? 'Twój okaz jest największy!'
                      : `tylko ${pct.data.biggerCount} ${plural(pct.data.biggerCount, 'okaz był większy', 'okazy były większe', 'okazów było większych')}.`
                  }`
                : pct.error
                  ? 'Porównanie z gminą pojawi się, gdy wróci zasięg.'
                  : ' '}
          </Txt>
        </View>
      </ScrollView>

      {/* Jeden rząd (niski pasek) – na typowym telefonie pasek XP z animacją LEVEL UP zostaje nad przyciskami. */}
      <View
        onLayout={(e) => setFooterH(Math.round(e.nativeEvent.layout.height))}
        style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 10, paddingBottom: bottom, backgroundColor: colors.night }}
      >
        <Press3D
          onPress={() => leave('scan')}
          accessibilityLabel="Skanuj kolejnego"
          depth={5}
          pressDepth={4}
          shadowColor={colors.forestShadow}
          radius={22}
          style={{ width: 100 }}
          // Wysokość twarzy jak „Zbieram dalej” (lg: 2 × 18 px + linia 20 px Baloo).
          faceStyle={{ minHeight: 68, backgroundColor: colors.forest, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, gap: 2 }}
        >
          <Icon name="center_focus_strong" filled size={22} color={colors.scanChipText} />
          <Txt f="n8" size={12} lh={1.15} color={colors.onDark} align="center">
            {'Skanuj\nkolejnego'}
          </Txt>
        </Press3D>
        <Button3D title="Zbieram dalej" onDark onPress={() => leave('home')} style={{ flex: 1 }} />
      </View>
    </Screen>
  );
}

/** „Nowe osiągnięcie” – jak karta odznaki; XP za osiągnięcia wpada po „Zbieram dalej”. */
function AchievementCard({ unlocks }: { unlocks: AchievementUnlock[] }) {
  const first = unlocks[0];
  const def = ACHIEVEMENT_BY_ID[first.id];
  if (!def) return null;
  const xp = unlocks.reduce((a, x) => a + x.xp, 0);
  const more = unlocks.length - 1;
  return (
    <View
      style={{
        width: '100%',
        backgroundColor: colors.badgeCard,
        borderRadius: 22,
        padding: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        boxShadow: '0px 4px 0px #C8B78F',
      }}
    >
      <AchievementMedal def={def} tier={first.tier} size={54} />
      <View style={{ flex: 1 }}>
        <Txt f="n8" size={11} color={colors.legendText} upper ls={0.08}>
          {unlocks.length === 1 ? 'Nowe osiągnięcie' : `Nowe osiągnięcia (${unlocks.length})`}
        </Txt>
        <Txt f="b7" size={19}>
          {achievementTitle(first)}
        </Txt>
        <Txt f="n7" size={12} color={colors.muted}>
          {def.goal(def.tiers[first.tier - 1].target)}
          {more > 0 ? ` · i ${more} ${plural(more, 'kolejne', 'kolejne', 'kolejnych')}` : ''}
        </Txt>
      </View>
      <Txt f="b7" size={16} color={colors.primaryText}>
        +{fmtInt(xp)}
      </Txt>
    </View>
  );
}

/*
 * Liczniki XP to osobne liście `memo` ze stanem animacji (co klatkę przez ~2 s): przerysowuje się tylko ich tekst,
 * a nie cały ekran z promieniami, poświatą i zdjęciem.
 */

const XpRow = memo(function XpRow({ line, delay }: { line: XpLine; delay: number }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Txt f="n7" size={14} color={colors.onDark} style={{ flex: 1 }}>
        {line.label}
      </Txt>
      <XpLineValue xp={line.xp} delay={delay} />
    </View>
  );
});

const XpLineValue = memo(function XpLineValue({ xp, delay }: { xp: number; delay: number }) {
  const v = useCountUp(xp, 700, delay);
  return (
    <Txt f="n7" size={14} color={colors.onDark} style={TABULAR}>
      +{v}
    </Txt>
  );
});

const XpTotal = memo(function XpTotal({ total }: { total: number }) {
  const v = useCountUp(total, 1100, 300);
  return (
    <Txt f="b8" size={30} color={colors.xpOnDark} style={TABULAR}>
      +{fmtInt(v)} XP
    </Txt>
  );
});

/** Licznik XP zsynchronizowany z paskiem (0.5 s opóźnienia, 1.6 s). */
const XpTicker = memo(function XpTicker({
  before,
  after,
  levelUp,
  thresholdBefore,
  leveled,
  max,
}: {
  before: number;
  after: number;
  levelUp: boolean;
  thresholdBefore: number;
  leveled: boolean;
  max: number;
}) {
  const t = useTicker(BAR_DURATION, BAR_DELAY);
  const ease = (x: number) => 1 - Math.pow(1 - x, 3);
  const split = 0.45;
  const shown = !levelUp
    ? Math.round(before + (after - before) * ease(t))
    : !leveled
      ? Math.round(before + (thresholdBefore - before) * Math.min(1, t / split))
      : Math.round(after * ease(Math.max(0, (t - split) / (1 - split))));
  return (
    <Txt f="n8" size={13} color={colors.onDarkMuted} style={TABULAR}>
      {fmtInt(shown)} / {fmtInt(max)} XP
    </Txt>
  );
});
