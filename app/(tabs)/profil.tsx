import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { AchievementRow } from '@/components/Achievement';
import { AtlasGrid } from '@/components/Atlas';
import { BadgeItem } from '@/components/Badge';
import { IconButton } from '@/components/IconButton';
import { StateCard } from '@/components/OfflineCard';
import { Placeholder } from '@/components/Placeholder';
import { ProgressRing } from '@/components/ProgressRing';
import { Screen } from '@/components/Screen';
import { SectionHeader, SeeAllButton } from '@/components/SectionHeader';
import { Txt } from '@/components/Txt';
import { useAchievements } from '@/hooks/useAchievements';
import { useCatalogStore } from '@/store/useCatalogStore';
import { ui, useUiStore } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';
import { colors, shadows } from '@/theme/tokens';
import type { AtlasEntry } from '@/types';
import { closestToNext } from '@/utils/achievements';
import { fmtInt } from '@/utils/format';
import { levelProgress, levelTitle } from '@/utils/xp';

export default function ProfileScreen() {
  const user = useUserStore((s) => s.user);
  const atlas = useUserStore((s) => s.atlas);
  const found = Object.keys(atlas).length;
  const total = useCatalogStore((s) => s.totalSpecies);

  return (
    <Screen tabs>
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <IconButton icon="settings" iconSize={22} onPress={openSettings} accessibilityLabel="Ustawienia" />
        </View>

        <View style={{ alignItems: 'center', gap: 8, marginTop: -30 }}>
          <ProgressRing size={104} thickness={8} value={levelProgress(user)} color={colors.primary} track={colors.ringTrack}>
            <View
              style={{
                width: 88,
                height: 88,
                borderRadius: 44,
                borderWidth: 4,
                borderColor: colors.bg,
                overflow: 'hidden',
              }}
            >
              <Placeholder variant="sand" stripe={6} style={{ flex: 1 }} />
            </View>
            <View
              style={{
                position: 'absolute',
                bottom: -6,
                alignSelf: 'center',
                backgroundColor: colors.ink,
                borderRadius: 999,
                paddingVertical: 2,
                paddingHorizontal: 10,
              }}
            >
              <Txt f="b7" size={14} color={colors.bg}>
                Lv {user.level}
              </Txt>
            </View>
          </ProgressRing>
          <View style={{ alignItems: 'center', marginTop: 4 }}>
            <Txt f="b7" size={24}>
              {user.name}
            </Txt>
            <Txt f="n7" size={13} color={colors.muted}>
              {user.handle} · {levelTitle(user.level)}
            </Txt>
          </View>
        </View>

        <View
          style={{
            flexDirection: 'row',
            backgroundColor: colors.card,
            borderRadius: 20,
            paddingVertical: 12,
            paddingHorizontal: 4,
            boxShadow: shadows.card,
          }}
        >
          <ProfileStat value={fmtInt(user.tripsCount)} label="wyprawy" />
          <ProfileStat value={fmtInt(user.mushroomsCount)} label="grzybów" divided />
          <ProfileStat value={String(found)} suffix={`/${total}`} label="gatunki" />
        </View>

        <Badges />
        <AtlasPreview atlas={atlas} found={found} total={total} />
        <AchievementsPreview />
      </View>
    </Screen>
  );
}

function openSettings() {
  useUiStore.getState().showDialog({
    title: 'Ustawienia',
    icon: 'settings',
    message: 'Prototyp UX – dane są symulowane.',
    actions: [
      { label: 'Panel symulacji (dev)', style: 'primary', onPress: () => router.push('/dev') },
      { label: 'Powiadomienia', style: 'default', onPress: () => ui.soon('Powiadomienia') },
      { label: 'Zamknij', style: 'cancel' },
    ],
  });
}

function ProfileStat({ value, suffix, label, divided }: { value: string; suffix?: string; label: string; divided?: boolean }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        borderLeftWidth: divided ? 1.5 : 0,
        borderRightWidth: divided ? 1.5 : 0,
        borderColor: colors.track,
      }}
    >
      <Txt f="b7" size={22}>
        {value}
        {suffix ? (
          <Txt f="b7" size={15} color={colors.disabled}>
            {suffix}
          </Txt>
        ) : null}
      </Txt>
      <Txt f="n8" size={12} color={colors.muted}>
        {label}
      </Txt>
    </View>
  );
}

function Badges() {
  const badges = useCatalogStore((s) => s.badges);
  const unlocked = useUserStore((s) => s.badges);
  return (
    <View style={{ gap: 10 }}>
      <Txt f="b7" size={18}>
        Odznaki
      </Txt>
      <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'space-between' }}>
        {badges.map((b) => {
          const locked = !unlocked.includes(b.id);
          return (
            <BadgeItem
              key={b.id}
              badge={b}
              locked={locked}
              onPress={() =>
                useUiStore.getState().showDialog({
                  title: b.name,
                  icon: locked ? 'lock' : 'military_tech',
                  message: locked ? `Zablokowana · ${b.description}` : `Zdobyta! ${b.description}`,
                  actions: [{ label: 'OK', style: 'primary' }],
                })
              }
            />
          );
        })}
      </View>
    </View>
  );
}

/** Jeden wiersz atlasu (ostatnio odkryte) + „Zobacz wszystko” → pełny atlas z filtrami. */
function AtlasPreview({ atlas, found, total }: { atlas: Record<string, AtlasEntry>; found: number; total: number }) {
  const species = useCatalogStore((s) => s.species);
  const row = useMemo(() => {
    const discovered = species
      .filter((s) => atlas[s.id])
      .sort((a, b) => atlas[b.id].firstFoundAt.localeCompare(atlas[a.id].firstFoundAt));
    // Mniej niż 3 odkryte → dopełniamy kaflami „???”.
    return [...discovered, ...species.filter((s) => !atlas[s.id])].slice(0, 3);
  }, [species, atlas]);

  return (
    <View style={{ gap: 10 }}>
      <SectionHeader title="Atlas gatunków" count={`${found} / ${total}`} />
      {found === 0 ? (
        <StateCard
          icon="menu_book"
          title="Twój atlas jest pusty"
          text="Zeskanuj pierwszego grzyba – gatunek trafi tutaj."
          action="Skanuj grzyba"
          onAction={() => router.push('/scan')}
        />
      ) : (
        <AtlasGrid items={row} atlas={atlas} />
      )}
      <SeeAllButton onPress={() => router.push('/atlas')} />
    </View>
  );
}

/** Trzy osiągnięcia najbliżej następnego stopnia + „Zobacz wszystko” → pełna lista z zablokowanymi. */
function AchievementsPreview() {
  const { states, summary } = useAchievements();
  const preview = useMemo(() => closestToNext(states, 3), [states]);
  return (
    <View style={{ gap: 10, paddingBottom: 8 }}>
      <SectionHeader title="Osiągnięcia" count={`${summary.earned} / ${summary.total}`} />
      {preview.map((st) => (
        <AchievementRow key={st.def.id} state={st} />
      ))}
      <SeeAllButton onPress={() => router.push('/osiagniecia')} />
    </View>
  );
}
