import { LinearGradient } from 'expo-linear-gradient';
import { router, type Href } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AchievementRow } from '@/components/Achievement';
import { AtlasGrid } from '@/components/Atlas';
import { BadgeItem } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { StateCard } from '@/components/OfflineCard';
import { ProgressRing } from '@/components/ProgressRing';
import { Screen } from '@/components/Screen';
import { SectionHeader, SeeAllButton } from '@/components/SectionHeader';
import { Txt } from '@/components/Txt';
import { UserAvatar } from '@/components/UserAvatar';
import { useAchievements } from '@/hooks/useAchievements';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useUiStore } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';
import { colors, diamondGradient, shadows, tiers as tierTokens } from '@/theme/tokens';
import type { AtlasEntry } from '@/types';
import { closestToNext } from '@/utils/achievements';
import { fmtInt } from '@/utils/format';
import { levelPrestige, levelProgress, levelTitle } from '@/utils/xp';

export default function ProfileScreen() {
  const user = useUserStore((s) => s.user);
  const atlas = useUserStore((s) => s.atlas);
  const found = Object.keys(atlas).length;
  const total = useCatalogStore((s) => s.totalSpecies);

  return (
    <Screen tabs>
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <IconButton icon="settings" iconSize={22} onPress={() => router.push('/ustawienia' as Href)} accessibilityLabel="Ustawienia" />
        </View>

        <View style={{ alignItems: 'center', gap: 8, marginTop: -30 }}>
          <Pressable
            onPress={editProfile}
            accessibilityRole="button"
            accessibilityLabel="Edytuj profil"
            style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
          >
            <ProgressRing size={104} thickness={8} value={levelProgress(user)} color={colors.primary} track={colors.ringTrack}>
              <UserAvatar size={88} ringWidth={4} ringColor={colors.bg} stripe={6} />
              <LevelPill level={user.level} />
              {/* Dyskretny ołówek na pierścieniu (prawy górny róg) – tap w avatar otwiera edycję profilu. */}
              <View
                style={{
                  position: 'absolute',
                  top: 1,
                  right: 1,
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: colors.card,
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: shadows.card,
                }}
              >
                <Icon name="edit" size={16} color={colors.ink} />
              </View>
            </ProgressRing>
          </Pressable>
          <Pressable onPress={editProfile} accessibilityRole="button" style={{ alignItems: 'center', marginTop: 4 }}>
            <Txt f="b7" size={24}>
              {user.name}
            </Txt>
            <Txt f="n7" size={13} color={colors.muted}>
              {user.handle} · {levelTitle(user.level)}
            </Txt>
            {user.bio ? (
              <Txt f="n6" size={14} color={colors.bodyDark} align="center" style={{ marginTop: 6, maxWidth: 320 }}>
                {user.bio}
              </Txt>
            ) : null}
          </Pressable>
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
          <ProfileStat value={fmtInt(user.tripsCount)} label="wyprawy" a11y="Historia wypraw" onPress={() => router.push('/wyprawy' as Href)} />
          <ProfileStat
            value={fmtInt(user.mushroomsCount)}
            label="grzybów"
            divided
            a11y="Dziennik znalezisk"
            onPress={() => router.push('/znaleziska' as Href)}
          />
          <ProfileStat value={String(found)} suffix={`/${total}`} label="gatunki" a11y="Atlas gatunków" onPress={() => router.push('/atlas')} />
        </View>

        <Badges />
        <AtlasPreview atlas={atlas} found={found} total={total} />
        <AchievementsPreview />
      </View>
    </Screen>
  );
}

/**
 * Odznaka poziomu na pierścieniu avatara. Prestiż (levelPrestige): od Lv 50 złota z koroną, od Lv 100 diamentowa
 * (lodowy gradient jak medal diamentowy) – subtelnie, bez animacji.
 */
function LevelPill({ level }: { level: number }) {
  const prestige = levelPrestige(level);
  const pill = {
    position: 'absolute' as const,
    bottom: -6,
    alignSelf: 'center' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: prestige ? 8 : 10,
    overflow: 'hidden' as const,
  };
  if (!prestige) {
    return (
      <View style={{ ...pill, backgroundColor: colors.ink }}>
        <Txt f="b7" size={14} color={colors.bg}>
          Lv {level}
        </Txt>
      </View>
    );
  }
  const diamond = prestige === 'diament';
  const ink = diamond ? tierTokens.diament.ink : tierTokens.zloto.ink;
  return (
    <View
      accessibilityLabel={`Poziom ${level}`}
      style={{
        ...pill,
        backgroundColor: diamond ? diamondGradient.colors[1] : tierTokens.zloto.color,
        borderWidth: 1.5,
        borderColor: diamond ? diamondGradient.rim : colors.legendText,
      }}
    >
      {diamond ? (
        <LinearGradient
          pointerEvents="none"
          colors={diamondGradient.colors}
          locations={diamondGradient.locations}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <Icon name={diamond ? 'diamond' : 'workspace_premium'} filled size={14} color={ink} />
      <Txt f="b7" size={14} color={ink}>
        Lv {level}
      </Txt>
    </View>
  );
}

function editProfile() {
  router.push('/ustawienia/profil' as Href);
}

/** Kafel statystyki – tap: wyprawy → Historia wypraw, grzybów → Dziennik znalezisk, gatunki → Atlas. */
function ProfileStat({
  value,
  suffix,
  label,
  divided,
  a11y,
  onPress,
}: {
  value: string;
  suffix?: string;
  label: string;
  divided?: boolean;
  a11y: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${a11y}: ${value}${suffix ?? ''} ${label}`}
      // Pionowo do krawędzi karty (padding 12).
      hitSlop={{ top: 12, bottom: 12 }}
      style={{
        flex: 1,
        alignItems: 'center',
        borderLeftWidth: divided ? 1.5 : 0,
        borderRightWidth: divided ? 1.5 : 0,
        borderColor: colors.track,
      }}
    >
      {({ pressed }) => (
        // Przygaszamy tylko treść – linie podziału zostają.
        <View style={{ alignItems: 'center', opacity: pressed ? 0.55 : 1 }}>
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
      )}
    </Pressable>
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
