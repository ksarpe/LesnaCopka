import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { BadgeItem } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { StateCard } from '@/components/OfflineCard';
import { Placeholder } from '@/components/Placeholder';
import { ProgressRing } from '@/components/ProgressRing';
import { Screen } from '@/components/Screen';
import { isPoisonous } from '@/components/SpeciesSheet';
import { Txt } from '@/components/Txt';
import { useCatalogStore } from '@/store/useCatalogStore';
import { ui, useUiStore } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';
import { colors, rarity as rarityTokens, shadows } from '@/theme/tokens';
import type { AtlasEntry, Species } from '@/types';
import { fmtInt } from '@/utils/format';
import { levelProgress, levelTitle } from '@/utils/xp';

type Filter = 'all' | 'edible' | 'poison' | 'missing';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Wszystkie' },
  { value: 'edible', label: 'Jadalne' },
  { value: 'poison', label: 'Trujące' },
  { value: 'missing', label: 'Brakujące' },
];

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
        <Atlas atlas={atlas} found={found} total={total} />
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

function Atlas({ atlas, found, total }: { atlas: Record<string, AtlasEntry>; found: number; total: number }) {
  const species = useCatalogStore((s) => s.species);
  const [filter, setFilter] = useState<Filter>('all');
  const items = useMemo(
    () =>
      species.filter((s) => {
        const have = !!atlas[s.id];
        if (filter === 'all') return true;
        if (filter === 'missing') return !have;
        if (filter === 'edible') return have && s.edibility === 'jadalny';
        return have && isPoisonous(s.edibility);
      }),
    [species, atlas, filter],
  );
  const rows: (Species | null)[][] = [];
  for (let i = 0; i < items.length; i += 3) {
    const row: (Species | null)[] = items.slice(i, i + 3);
    while (row.length < 3) row.push(null);
    rows.push(row);
  }

  return (
    <View style={{ gap: 10, paddingBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Txt f="b7" size={18}>
          Atlas gatunków
        </Txt>
        <Txt f="n8" size={13} color={colors.primaryText}>
          {found} / {total}
        </Txt>
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {FILTERS.map((f) => {
          const active = f.value === filter;
          return (
            <Pressable
              key={f.value}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setFilter(f.value)}
              style={{
                backgroundColor: active ? colors.ink : colors.card,
                borderRadius: 999,
                paddingVertical: 6,
                paddingHorizontal: 12,
              }}
            >
              <Txt f="n8" size={13} color={active ? colors.bg : colors.ink}>
                {f.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
      {found === 0 && filter === 'all' ? (
        <StateCard
          icon="menu_book"
          title="Twój atlas jest pusty"
          text="Zeskanuj pierwszego grzyba – gatunek trafi tutaj."
          action="Skanuj grzyba"
          onAction={() => router.push('/scan')}
        />
      ) : null}
      {items.length === 0 ? (
        <StateCard
          icon={filter === 'missing' ? 'celebration' : 'menu_book'}
          title={found === 0 ? 'Twój atlas jest pusty' : filter === 'missing' ? 'Masz wszystkie gatunki!' : 'Brak gatunków w tej kategorii'}
          text={found === 0 ? 'Zeskanuj pierwszego grzyba – gatunek trafi tutaj.' : 'Zmień filtr albo ruszaj do lasu.'}
          action={found === 0 ? 'Skanuj grzyba' : undefined}
          onAction={() => router.push('/scan')}
        />
      ) : (
        rows.map((row, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
            {row.map((s, j) => (s ? <AtlasTile key={s.id} species={s} entry={atlas[s.id]} /> : <View key={`e${j}`} style={{ flex: 1 }} />))}
          </View>
        ))
      )}
    </View>
  );
}

/** „Pieprznik jadalny (kurka)” → „Pieprznik jadalny” (jak w siatce atlasu). */
function shortName(name: string) {
  return name.replace(/ \(.*\)$/, '');
}

function AtlasTile({ species, entry }: { species: Species; entry?: AtlasEntry }) {
  const locked = !entry;
  const poison = isPoisonous(species.edibility);
  const border = locked ? colors.ringTrack : poison ? colors.danger : rarityTokens[species.rarity].color;
  let tag: { text: string; bg: string; color: string } | null = null;
  if (!locked) {
    if (species.edibility === 'smiertelny') tag = { text: 'śmiert.', bg: colors.ink, color: colors.white };
    else if (poison) tag = { text: 'trujący', bg: colors.danger, color: colors.white };
    else tag = { text: `×${entry.count}`, bg: colors.white, color: colors.ink };
  }
  return (
    <Pressable
      onPress={() =>
        locked ? ui.toast('Jeszcze nieodkryty gatunek – szukaj dalej!', 'lock') : router.push(`/species/${species.id}`)
      }
      style={({ pressed }) => ({
        flex: 1,
        backgroundColor: colors.card,
        borderRadius: 18,
        paddingTop: 6,
        paddingHorizontal: 6,
        paddingBottom: 10,
        gap: 6,
        boxShadow: shadows.card,
        borderBottomWidth: 4,
        borderBottomColor: border,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ aspectRatio: 1, borderRadius: 13, overflow: 'hidden' }}>
        {locked ? (
          <View style={{ flex: 1, backgroundColor: colors.lockedBg, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="lock" size={26} color={colors.disabled} />
          </View>
        ) : (
          <Placeholder variant="sand" stripe={6} style={{ flex: 1 }} />
        )}
        {tag ? (
          <View
            style={{
              position: 'absolute',
              right: 5,
              top: 5,
              backgroundColor: tag.bg,
              borderRadius: 999,
              paddingVertical: 1,
              paddingHorizontal: 6,
            }}
          >
            <Txt f="n8" size={10} color={tag.color}>
              {tag.text}
            </Txt>
          </View>
        ) : null}
      </View>
      <Txt f="n8" size={12} lh={1.15} color={locked ? colors.disabled : colors.ink} style={{ paddingHorizontal: 2 }}>
        {locked ? '???' : shortName(species.name)}
      </Txt>
    </Pressable>
  );
}
