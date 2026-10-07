import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useForecast, useGminaForecast } from '@/hooks/useForecast';
import { useSpeciesChances } from '@/hooks/useSpeciesChances';
import { useCatalogStore } from '@/store/useCatalogStore';
import { colors, rarity as rarityTokens, shadows } from '@/theme/tokens';
import type { ChanceHorizon, Species, SpeciesChance } from '@/types';
import { fitChanceLine, fmtChance, OFF_SEASON_FINDS } from '@/utils/chances';
import { Icon, type IconName } from './Icon';
import { Pill } from './Pill';
import { SegmentedControl } from './SegmentedControl';
import { Bone } from './Skeleton';
import { isPoisonous } from './SpeciesSheet';
import { Txt } from './Txt';

/** Tyle gatunków pokazuje karta „Szanse na wyprawie”. */
const TOP = 8;

const HORIZONS: { value: ChanceHorizon; label: string }[] = [
  { value: 'day', label: 'Dziś' },
  { value: 'week', label: 'Ten tydzień' },
];

/**
 * Karta „Szanse na wyprawie” na ekranie gminy: 8 najbardziej prawdopodobnych gatunków z paskiem %, akcentem rzadkości
 * i jednym zdaniem uzasadnienia (model src/utils/chances.ts: sezon, rzadkość, lesistość, prognoza, zbiory gminy
 * z 14 dni). Trujące też – z ostrzeżeniem (warto je sfotografować do atlasu). Tap → karta gatunku, (i) → wyjaśnienie.
 */
export function GminaChancesCard({ gminaId, place }: { gminaId: string; place: string }) {
  const [horizon, setHorizon] = useState<ChanceHorizon>('day');
  const [info, setInfo] = useState(false);
  const forecast = useGminaForecast(gminaId);
  const chances = useSpeciesChances(gminaId, forecast, horizon);
  const speciesById = useCatalogStore((s) => s.speciesById);
  const data = chances.data;
  const rows = useMemo(
    () =>
      data
        ? data.species
            .map((c) => ({ c, s: speciesById[c.speciesId] }))
            .filter((x): x is { c: SpeciesChance; s: Species } => !!x.s)
            .slice(0, TOP)
        : [],
    [data, speciesById],
  );
  const offSeason = !!data && data.expectedFinds < OFF_SEASON_FINDS;
  const sub = !data
    ? 'Na ok. 3-godzinnej wyprawie'
    : data.forecastScore != null
      ? `Na ok. 3-godzinnej wyprawie · prognoza ${Math.round(data.forecastScore)}/5`
      : 'Na ok. 3-godzinnej wyprawie · typowy dzień sezonu';

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Txt f="b7" size={18}>
            Szanse na wyprawie
          </Txt>
          <Txt f="n7" size={12} color={colors.muted} numberOfLines={1}>
            {sub}
          </Txt>
        </View>
        <Pressable
          onPress={() => setInfo(true)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Skąd te szanse?"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingTop: 2 })}
        >
          <Icon name="info" size={22} color={colors.muted} />
        </Pressable>
      </View>

      <SegmentedControl options={HORIZONS} value={horizon} onChange={setHorizon} />

      {chances.error && !data ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Icon name="wifi_off" size={18} color={colors.muted} />
          <Txt f="n7" size={13} color={colors.muted} style={{ flex: 1 }}>
            Szanse policzymy, gdy wróci zasięg.
          </Txt>
          <Pressable onPress={chances.reload} hitSlop={8} accessibilityRole="button">
            <Txt f="n8" size={13} color={colors.primaryText}>
              Ponów
            </Txt>
          </Pressable>
        </View>
      ) : !data ? (
        <View style={{ gap: 14 }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ gap: 6 }}>
              <Bone w={i % 2 ? '45%' : '60%'} h={14} />
              <Bone w="100%" h={8} r={4} />
            </View>
          ))}
        </View>
      ) : (
        <View style={{ gap: 14, opacity: chances.loading ? 0.6 : 1 }}>
          {offSeason ? (
            <Notice icon="eco" text="Poza sezonem grzybowym – grzybów jest teraz bardzo mało, szanse są niewielkie." />
          ) : null}
          {rows.map(({ c, s }) => (
            <ChanceRow key={c.speciesId} chance={c} species={s} />
          ))}
          {data.evidenceTotal === 0 ? (
            <Notice
              icon="schedule"
              text="Brak świeżych zbiorów w tej gminie – szacunek z sezonu, rzadkości i lesistości. Dane z gminy dojdą, gdy grzybiarze zakończą tu wyprawy."
            />
          ) : null}
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
        <Icon name="shield" size={14} color={colors.muted} />
        <Txt f="n6" size={11} color={colors.muted} style={{ flex: 1 }}>
          To szacunek, nie gwarancja. Tylko łączne zbiory gminy, bez miejsc znalezisk.
        </Txt>
      </View>
      {info ? <ChancesInfoSheet place={place} onClose={() => setInfo(false)} /> : null}
    </View>
  );
}

function Notice({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: colors.canvas, borderRadius: 14, padding: 10 }}>
      <Icon name={icon} size={16} color={colors.muted} />
      <Txt f="n6" size={12} color={colors.tagNeutralText} style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}

/** Wiersz gatunku: akcent rzadkości, nazwa, %, pasek i uzasadnienie (trujące – czerwony pasek i „tylko zdjęcie”). */
function ChanceRow({ chance, species }: { chance: SpeciesChance; species: Species }) {
  const r = rarityTokens[species.rarity];
  const poison = isPoisonous(species.edibility);
  const pct = Math.round(chance.chance * 100);
  const reason = chance.reasons.slice(0, 2).join(' · ');
  return (
    <Pressable
      onPress={() => router.push(`/species/${species.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${species.name}, ${r.labelLower}: ${pct}% szans. ${poison ? 'Trujący – tylko zdjęcie. ' : ''}${reason}`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'stretch', gap: 10, opacity: pressed ? 0.7 : 1 })}
    >
      <View style={{ width: 4, borderRadius: 2, backgroundColor: r.color }} />
      <View style={{ flex: 1, gap: 5 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Txt f="n8" size={14} numberOfLines={1} style={{ flexShrink: 1 }}>
            {species.name}
          </Txt>
          {poison ? (
            <Pill
              label={species.edibility === 'smiertelny' ? 'śmiertelny' : 'trujący'}
              size={11}
              padV={1}
              padH={7}
              bg={species.edibility === 'smiertelny' ? colors.ink : colors.dangerBg}
              color={species.edibility === 'smiertelny' ? colors.white : colors.dangerTitle}
            />
          ) : null}
          <Txt f="b7" size={16} color={poison ? colors.danger : colors.ink} style={{ marginLeft: 'auto' }}>
            {fmtChance(chance.chance)}
          </Txt>
        </View>
        <View style={{ height: 8, borderRadius: 999, backgroundColor: colors.track, overflow: 'hidden' }}>
          <View style={{ height: '100%', width: `${pct}%`, borderRadius: 999, backgroundColor: poison ? colors.danger : colors.primary }} />
        </View>
        <Txt f="n6" size={12} color={poison ? colors.dangerText : colors.muted} numberOfLines={1}>
          {poison ? `Nie zbieraj – tylko zdjęcie · ${reason}` : reason}
        </Txt>
      </View>
    </Pressable>
  );
}

/**
 * Jedna linijka pod pigułkami karty „Wykryto region” (Start): „Najbardziej prawdopodobne tu: podgrzybek 78% · kurka
 * 45% · borowik 22%” – tylko jadalne i niechronione, bez powtórzeń nazwy; na wąskim ekranie krócej („Szanse tu:
 * podgrzybek 95% · borowik 81%”), zawsze w jednej linii. Bez danych / poza sezonem / offline – nic. Tap → gmina.
 */
export function ChanceStrip({ gminaId, point }: { gminaId: string; point: { lat: number; lon: number } | null | undefined }) {
  const forecast = useForecast(point, gminaId);
  const chances = useSpeciesChances(gminaId, forecast, 'day');
  const speciesById = useCatalogStore((s) => s.speciesById);
  const data = chances.data;
  const top = useMemo(() => {
    if (!data || data.expectedFinds < OFF_SEASON_FINDS) return [];
    const seen = new Set<string>();
    const out: { name: string; pct: string }[] = [];
    for (const c of data.species) {
      const s = speciesById[c.speciesId];
      if (!s || s.edibility !== 'jadalny' || s.protection || c.chance < 0.05 || seen.has(s.shortName)) continue;
      seen.add(s.shortName);
      out.push({ name: s.shortName, pct: fmtChance(c.chance) });
      if (out.length === 3) break;
    }
    return out;
  }, [data, speciesById]);
  const [width, setWidth] = useState(0);
  if (!top.length) return null;
  const items = top.map((t) => `${t.name} ${t.pct}`);
  const line = width > 0 ? fitChanceLine(items, width) : null;
  return (
    <Pressable
      onPress={() => router.push(`/gminy/${gminaId}`)}
      accessibilityRole="button"
      accessibilityLabel={`Najbardziej prawdopodobne tu: ${items.join(', ')}. Szczegóły gminy`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: pressed ? 0.7 : 1 })}
    >
      <Icon name="eco" filled size={15} color={colors.primaryText} />
      <View style={{ flex: 1, minHeight: 17 }} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
        {line ? (
          <Txt f="n7" size={12} color={colors.muted} numberOfLines={1}>
            <Txt f="n8" size={12} color={colors.primaryText}>
              {line.label}
            </Txt>
            {line.text}
          </Txt>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Arkusz od dołu (jak szczegóły prognozy): jak liczymy szanse, prywatność, „to szacunek”. */
function ChancesInfoSheet({ place, onClose }: { place: string; onClose: () => void }) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(160)} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Zamknij wyjaśnienie" />
        <Animated.View
          entering={SlideInDown.duration(240)}
          style={[styles.sheet, { maxHeight: Math.round(height * 0.86), paddingBottom: Math.max(insets.bottom, 16) }]}
        >
          <View style={styles.grabber} />
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Txt f="b7" size={24}>
                Skąd te szanse?
              </Txt>
              <Txt f="n7" size={13} color={colors.muted} numberOfLines={1}>
                {place} · ok. 3-godzinna wyprawa
              </Txt>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Zamknij">
              <Icon name="close" size={24} color={colors.muted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4, gap: 14 }}>
            <View style={{ gap: 8 }}>
              {[
                'Procent to szansa, że na ok. 3-godzinnej wyprawie trafisz co najmniej jeden okaz gatunku.',
                'Liczymy ją z sezonu gatunku (miesiąc), jego rzadkości, lesistości gminy i prognozy grzybowej – po deszczu więcej grzybów, a kurki i opieńki lubią wilgoć.',
                'Do tego dochodzi, co grzybiarze zebrali w tej gminie w ostatnich 2 tygodniach – im więcej zbiorów, tym bardziej liczą się dane z gminy.',
                '„Dziś” – przy dzisiejszej prognozie. „Ten tydzień” – średnio na wyprawę w najbliższych 7 dniach (pogoda za kilka dni to niewiadoma).',
              ].map((t) => (
                <View key={t} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <View style={styles.dot} />
                  <Txt f="n7" size={14} color={colors.bodyDark} style={{ flex: 1 }}>
                    {t}
                  </Txt>
                </View>
              ))}
            </View>
            <View style={[styles.box, { backgroundColor: colors.primaryTint }]}>
              <Icon name="shield" filled size={22} color={colors.primaryText} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt f="n8" size={14} color={colors.primaryTintText}>
                  Prywatność
                </Txt>
                <Txt f="n6" size={13} color={colors.primaryTintBody}>
                  Korzystamy tylko z łącznych liczb dla całej gminy, najwcześniej 24 h po wyprawach. Gatunek liczy się, gdy
                  znalazło go tu co najmniej 2 grzybiarzy – nigdy nie używamy miejsc znalezisk ani tego, kto co znalazł.
                </Txt>
              </View>
            </View>
            <View style={[styles.box, { backgroundColor: colors.dangerBg }]}>
              <Icon name="dangerous" filled size={22} color={colors.danger} />
              <Txt f="n6" size={13} color={colors.dangerText} style={{ flex: 1 }}>
                Trujące pokazujemy, bo warto je sfotografować do atlasu. Nie zbieraj ich i nie dotykaj gołymi rękami.
              </Txt>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Icon name="info" size={16} color={colors.muted} />
              <Txt f="n6" size={12} color={colors.muted} style={{ flex: 1 }}>
                To szacunek, a nie gwarancja – dużo zależy od konkretnego lasu, gleby i Twojej trasy.
              </Txt>
            </View>
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 22, padding: 16, gap: 14, boxShadow: shadows.card },
  backdrop: { flex: 1, backgroundColor: 'rgba(30,27,22,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
    gap: 4,
    boxShadow: shadows.dialog,
  },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.outline, marginBottom: 8 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary, marginTop: 7 },
  box: { flexDirection: 'row', gap: 12, borderRadius: 18, padding: 14 },
});
