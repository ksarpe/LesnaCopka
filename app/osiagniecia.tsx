import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { AchievementRow, DiamondDisc } from '@/components/Achievement';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { ProgressBar } from '@/components/ProgressBar';
import { Screen } from '@/components/Screen';
import { Txt } from '@/components/Txt';
import { useAchievements } from '@/hooks/useAchievements';
import { colors, tiers as tierTokens } from '@/theme/tokens';
import { ACHIEVEMENT_CATEGORIES, MEDAL_ORDER, TIER_LABEL, tierKind, type TierKind } from '@/utils/achievements';
import { fmtInt } from '@/utils/format';

/** Wszystkie osiągnięcia (z profilu: „Zobacz wszystko”) – podsumowanie i sekcje według kategorii. */
export default function AchievementsScreen() {
  const { states, summary } = useAchievements();
  const medals = useMemo(() => {
    const count: Record<TierKind, number> = { braz: 0, srebro: 0, zloto: 0, platyna: 0, diament: 0 };
    states.forEach((s) => {
      for (let t = 1; t <= s.tier; t++) count[tierKind(s.def.tiers.length, t)]++;
    });
    return count;
  }, [states]);
  const back = () => (router.canGoBack() ? router.back() : router.navigate('/profil'));

  return (
    <Screen>
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton icon="arrow_back" onPress={back} accessibilityLabel="Wróć" />
          <Txt f="b7" size={18}>
            Osiągnięcia
          </Txt>
          <View style={{ width: 44 }} />
        </View>

        <Card radius={22} padding={16} gap={12}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Txt f="b7" size={34} lh={1}>
              {summary.earned}
            </Txt>
            <Txt f="b7" size={18} color={colors.disabled}>
              / {summary.total}
            </Txt>
            <Txt f="n7" size={14} color={colors.muted} style={{ marginLeft: 4, flex: 1 }}>
              zdobytych stopni
            </Txt>
            <Txt f="n8" size={13} color={colors.primaryText}>
              +{fmtInt(summary.xp)} XP
            </Txt>
          </View>
          <ProgressBar value={summary.total ? summary.earned / summary.total : 0} />
          {/* Pięć stopni nie mieści się w jednym wierszu „kółko + liczba + nazwa” – kolumny: kółko i liczba, pod spodem nazwa. */}
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {MEDAL_ORDER.map((k) => (
              <View key={k} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  {k === 'diament' ? (
                    <DiamondDisc size={16} />
                  ) : (
                    <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: tierTokens[k].color }} />
                  )}
                  <Txt f="b7" size={15} lh={1.1}>
                    {medals[k]}
                  </Txt>
                </View>
                <Txt f="n7" size={10} color={colors.muted} numberOfLines={1}>
                  {TIER_LABEL[k]}
                </Txt>
              </View>
            ))}
          </View>
        </Card>

        {ACHIEVEMENT_CATEGORIES.map((cat) => {
          const list = states.filter((s) => s.def.category === cat.id);
          if (!list.length) return null;
          const earned = list.reduce((a, s) => a + s.tier, 0);
          const total = list.reduce((a, s) => a + s.def.tiers.length, 0);
          return (
            <View key={cat.id} style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name={cat.icon} filled size={18} color={colors.primaryText} />
                <Txt f="b7" size={18} style={{ flex: 1 }}>
                  {cat.title}
                </Txt>
                <Txt f="n8" size={13} color={colors.primaryText}>
                  {earned} / {total}
                </Txt>
              </View>
              {list.map((s) => (
                <AchievementRow key={s.def.id} state={s} />
              ))}
            </View>
          );
        })}
      </View>
    </Screen>
  );
}
