import { useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useForecast, useGminaForecast } from '@/hooks/useForecast';
import { colors, heat, shadows } from '@/theme/tokens';
import type { MushroomForecast } from '@/types';
import { fmtClock } from '@/utils/format';
import {
  forecastAttribution,
  forecastPillLabel,
  OUTLOOK_NAMES,
  rainPillLabel,
  WEATHER_ATTRIBUTION_URL,
  weatherIcon,
} from '@/utils/forecast';
import { Icon } from './Icon';
import { Pill } from './Pill';
import { SkeletonPill, SkeletonRow } from './Skeleton';
import { Txt } from './Txt';

/**
 * Pigułki z makiety: „Prognoza grzybowa 4/5” (zielona) i „2 dni po deszczu” (niebieska) – do wiersza pigułek
 * (flexWrap). Pobieranie → pulsująca pigułka; brak sieci / błąd → nic (pigułki lasu zostają). Tap → szczegóły.
 * `compact` – tylko pigułka prognozy (mapa pełnoekranowa).
 */
export function ForecastPills({
  point,
  gminaId,
  place,
  compact,
}: {
  point: { lat: number; lon: number } | null | undefined;
  gminaId?: string;
  /** „Gmina Supraśl” – nagłówek szczegółów. */
  place: string;
  compact?: boolean;
}) {
  const f = useForecast(point, gminaId);
  const [open, setOpen] = useState(false);
  const forecast = f.error ? undefined : f.data;
  if (!forecast) return f.loading && !f.error ? <SkeletonPill width={160} /> : null;
  const show = () => setOpen(true);
  return (
    <>
      <Pill label={forecastPillLabel(forecast.score)} onPress={show} />
      {compact ? null : (
        <Pill label={rainPillLabel(forecast.daysAfterRain)} bg={colors.infoBg} color={colors.infoText} onPress={show} />
      )}
      {open ? <ForecastSheet forecast={forecast} place={place} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** Karta prognozy na ekranie gminy (punkt wewnątrz gminy z PRG). Błąd / offline → karta znika. */
export function GminaForecastCard({ gminaId, place }: { gminaId: string; place: string }) {
  const f = useGminaForecast(gminaId);
  const [open, setOpen] = useState(false);
  const forecast = f.error ? undefined : f.data;
  if (!forecast) return f.loading && !f.error ? <SkeletonRow /> : null;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Prognoza grzybowa ${forecast.score} na 5, ${forecast.label}. Szczegóły`}
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={styles.iconTile}>
            <Icon name="water_drop" filled size={22} color={colors.primaryText} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt f="n8" size={15} numberOfLines={2}>
              Prognoza grzybowa · {forecast.label}
            </Txt>
            <Txt f="n7" size={12} color={colors.muted} numberOfLines={2}>
              {rainPillLabel(forecast.daysAfterRain)} · {fmtMm(forecast.rain14Mm)} w 2 tygodnie
            </Txt>
          </View>
          <Txt f="b7" size={22} color={colors.primaryText}>
            {forecast.score}/5
          </Txt>
          <Icon name="chevron_right" size={20} color={colors.muted} />
        </View>
        <ScoreBar score={forecast.score} />
        <Txt f="n6" size={10} color={colors.muted} align="right">
          {forecastAttribution(forecast.source)}
        </Txt>
      </Pressable>
      {open ? <ForecastSheet forecast={forecast} place={place} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const fmtMm = (mm: number) => `${mm < 10 && mm % 1 ? mm.toFixed(1).replace('.', ',') : Math.round(mm)} mm`;
const fmtDeg = (c: number | null) => (c == null ? '–' : `${Math.round(c)}°`.replace('-', '−'));

/** 5 kresek w kolorach heatmapy – zapełnione do oceny. */
function ScoreBar({ score }: { score: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }} accessible={false}>
      {heat.map((c, i) => (
        <View key={c} style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: i < score ? c : colors.track }} />
      ))}
    </View>
  );
}

/** Arkusz od dołu: ocena, uzasadnienie, pogoda na 3 dni i podpis źródła danych. */
function ForecastSheet({ forecast, place, onClose }: { forecast: MushroomForecast; place: string; onClose: () => void }) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const live = forecast.source === 'open-meteo';
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(160)} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Zamknij prognozę" />
        <Animated.View
          entering={SlideInDown.duration(240)}
          style={[styles.sheet, { maxHeight: Math.round(height * 0.86), paddingBottom: Math.max(insets.bottom, 16) }]}
        >
          <View style={styles.grabber} />
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Txt f="b7" size={24}>
                Prognoza grzybowa
              </Txt>
              <Txt f="n7" size={13} color={colors.muted} numberOfLines={1}>
                {place} · okolica ok. 10 km
              </Txt>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Zamknij">
              <Icon name="close" size={24} color={colors.muted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4, gap: 14 }}>
            <View style={[styles.card, { gap: 12 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
                <Txt f="b7" size={44} lh={1.05} color={colors.primaryText}>
                  {forecast.score}/5
                </Txt>
                <View style={{ flex: 1, paddingBottom: 6 }}>
                  <Txt f="b7" size={20} lh={1.15}>
                    {forecast.label}
                  </Txt>
                  <Txt f="n7" size={12} color={colors.muted}>
                    {fmtMm(forecast.rain14Mm)} deszczu w 2 tygodnie
                  </Txt>
                </View>
              </View>
              <ScoreBar score={forecast.score} />
              <Pill label={rainPillLabel(forecast.daysAfterRain)} bg={colors.infoBg} color={colors.infoText} />
            </View>

            <View style={{ gap: 8 }}>
              <Txt f="b7" size={18}>
                Dlaczego tak?
              </Txt>
              {forecast.reasons.map((r) => (
                <View key={r} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <View style={styles.dot} />
                  <Txt f="n7" size={14} color={colors.bodyDark} style={{ flex: 1 }}>
                    {r}
                  </Txt>
                </View>
              ))}
            </View>

            {forecast.outlook.length ? (
              <View style={{ gap: 8 }}>
                <Txt f="b7" size={18}>
                  Najbliższe dni
                </Txt>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {forecast.outlook.map((d, i) => (
                    <View key={d.date} style={[styles.card, styles.day]}>
                      <Txt f="n8" size={12} color={colors.muted} upper ls={0.06}>
                        {OUTLOOK_NAMES[i] ?? d.date.slice(5)}
                      </Txt>
                      <Icon name={weatherIcon(d.weatherCode, d.precipMm)} filled size={26} color={colors.infoText} />
                      <Txt f="n8" size={15}>
                        {fmtDeg(d.tMaxC)} / {fmtDeg(d.tMinC)}
                      </Txt>
                      <Txt f="n7" size={12} color={colors.muted}>
                        {d.precipMm == null ? '–' : fmtMm(d.precipMm)}
                      </Txt>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Icon name="info" size={16} color={colors.muted} />
              <Txt f="n6" size={12} color={colors.muted} style={{ flex: 1 }}>
                To szacunek z pogody (opady, temperatura, wilgotność, pora roku), a nie gwarancja grzybów – dużo zależy
                też od lasu i gleby. Do serwisu pogody trafia tylko przybliżona okolica, nie Twoja pozycja.
              </Txt>
            </View>
            <Pressable
              onPress={live ? () => Linking.openURL(WEATHER_ATTRIBUTION_URL).catch(() => {}) : undefined}
              disabled={!live}
              accessibilityRole={live ? 'link' : undefined}
            >
              <Txt f="n6" size={11} color={colors.muted} align="right">
                {forecastAttribution(forecast.source)} · aktualizacja {fmtClock(new Date(forecast.updatedAt))}
              </Txt>
            </Pressable>
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  card: { backgroundColor: colors.card, borderRadius: 22, padding: 14, gap: 10, boxShadow: shadows.card },
  day: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 18 },
  iconTile: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary, marginTop: 7 },
});
