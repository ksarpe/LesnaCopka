/**
 * Mapy offline w UI: arkusz „Pobierz na offline” (mapa pełnoekranowa), karta „Mapa gminy na offline” (szczegóły
 * gminy), opis stanu obszaru (Ustawienia → Mapy offline) i jednorazowa podpowiedź na karcie „Wykryto region”.
 * Logika i stan: src/store/useOfflineMapsStore.ts.
 */
import { router, type Href } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { estimateBytes } from '@/geo/tiles';
import { useAsync } from '@/hooks/useAsync';
import { useServices } from '@/services';
import {
  cancelOfflineDownload,
  gminaArea,
  markOfflineHintShown,
  planAround,
  planCoverage,
  planGmina,
  retryOfflineArea,
  startOfflineDownload,
  syncOfflineAreas,
  useOfflineMapsStore,
  useTileUsage,
  type OfflineArea,
  type OfflineJob,
  type OfflinePlan,
} from '@/store/useOfflineMapsStore';
import { useSimStore } from '@/store/useSimStore';
import { ui } from '@/store/useUiStore';
import { colors, shadows } from '@/theme/tokens';
import type { Gmina, GminaKind, Region } from '@/types';
import { fmtDaysAgo, fmtInt, fmtMB, plural } from '@/utils/format';
import { Icon, type IconName } from './Icon';
import { ProgressBar } from './ProgressBar';
import { Txt } from './Txt';

const MANAGE_HREF = '/ustawienia/mapy-offline' as Href;

const tilesLabel = (n: number) => `${fmtInt(n)} ${plural(n, 'kafel', 'kafle', 'kafli')}`;

/** Ten sam zestaw kafli (okolica pobrana w tym samym miejscu). */
const sameTiles = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

/** Plan „cała gmina” – granice z PRG wczytywane przy pierwszym użyciu. */
function useGminaPlan(gmina: Pick<Gmina, 'id' | 'name' | 'kind' | 'teryt'> | undefined) {
  const id = gmina?.id;
  return useAsync(() => (gmina ? planGmina(gmina) : Promise.resolve(undefined)), [id]);
}

/** Opis obszaru do listy w Ustawieniach: „0,3 MB · 25 kafli · pobrano wczoraj” / postęp / „Niepełna…”. */
export function areaStatusText(area: OfflineArea, job?: OfflineJob): string {
  if (job) return `Pobieram… ${job.done} / ${job.total} · ${fmtMB(job.bytes)}`;
  if (area.status === 'downloading') return 'Pobieram…';
  if (area.status === 'partial') {
    return `Niepełna: ${area.tiles.length - area.missing} / ${area.tiles.length} kafli · ${fmtMB(area.bytes)} – ponów przy zasięgu`;
  }
  const when = area.downloadedAt ? ` · pobrano ${fmtDaysAgo(area.downloadedAt)}` : '';
  return `${fmtMB(area.bytes)} · ${tilesLabel(area.tiles.length)}${when}`;
}

/* ───────────── Wiersz „pobierz obszar” ───────────── */

interface PlanOptionProps {
  title: string;
  icon: IconName;
  plan?: OfflinePlan;
  /** Nie udało się policzyć planu (np. brak granic gminy). */
  failed?: boolean;
  /** Obszar offline odpowiadający planowi (pobrany / pobierany). */
  area?: OfflineArea;
  gminaKind?: GminaKind;
  /** Gotowy obszar: dotknięcie → ekran zarządzania (zamiast komunikatu). */
  manageOnReady?: boolean;
}

function PlanOption({ title, icon, plan, failed, area, gminaKind, manageOnReady }: PlanOptionProps) {
  const { map } = useServices();
  const network = useSimStore((s) => s.networkEnabled);
  const job = useOfflineMapsStore((s) => (area ? s.jobs[area.id] : undefined));
  // Kafle planu już na telefonie (inne obszary) – odświeżane razem z listą obszarów.
  useOfflineMapsStore((s) => s.areas);
  const cov = plan ? planCoverage(plan) : null;

  const downloading = !!job || area?.status === 'downloading';
  const covered = !!cov && cov.total > 0 && cov.have === cov.total && !downloading;
  const partial = !covered && !downloading && area?.status === 'partial';
  const tooLarge = !!plan?.tooLarge && !covered && !area;
  const missingTiles = cov ? cov.total - cov.have : 0;

  let sub: string;
  if (failed) sub = 'Nie udało się policzyć obszaru';
  else if (!plan || !cov) sub = 'Liczę rozmiar…';
  else if (downloading) sub = job ? `Pobieram… ${job.done} / ${job.total} · ${fmtMB(job.bytes)}` : 'Pobieram…';
  else if (covered) sub = `Pobrano ✓ · ${area?.bytes ? fmtMB(area.bytes) : tilesLabel(cov.total)}`;
  else if (tooLarge) sub = `Za duża na mapę offline (${tilesLabel(plan.tiles.length)}) – pobierz okolicę`;
  else if (partial) sub = `Niepełna: ${cov.have} / ${cov.total} kafli – ${network ? 'dotknij, aby ponowić' : 'ponów przy zasięgu'}`;
  else {
    const est = `ok. ${fmtMB(estimateBytes(missingTiles, gminaKind))}`;
    sub = !network
      ? `${est} · połącz się z siecią, żeby pobrać`
      : cov.have > 0
        ? `${est} · ${cov.have} z ${tilesLabel(cov.total)} już na telefonie`
        : `${est} · ${tilesLabel(cov.total)}`;
  }

  const disabled = failed || !plan || tooLarge || (!network && !covered && !downloading);

  const onPress = () => {
    if (!plan || downloading) return;
    if (covered) {
      if (manageOnReady) router.push(MANAGE_HREF);
      else ui.toast('Ta mapa jest już na telefonie', 'offline_pin');
      return;
    }
    if (partial && area) {
      void retryOfflineArea(map, area.id);
      return;
    }
    const go = () => {
      if (startOfflineDownload(map, plan)) ui.toast(`Pobieram mapę: ${plan.name}`, 'downloading');
    };
    if (plan.large) {
      ui.confirm({
        title: 'Duży obszar',
        message: `„${plan.name}” zajmie ok. ${fmtMB(plan.estimateBytes)}. Jeśli możesz, pobierz przez Wi-Fi.`,
        icon: 'download_for_offline',
        confirmLabel: 'Pobierz',
        onConfirm: go,
      });
    } else go();
  };

  const right = downloading ? (
    <Pressable
      onPress={() => area && void cancelOfflineDownload(area.id)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Anuluj pobieranie"
      style={({ pressed }) => [styles.smallBtn, pressed && { opacity: 0.7 }]}
    >
      <Icon name="close" size={18} color={colors.muted} />
    </Pressable>
  ) : covered ? (
    <Icon name="check_circle" filled size={24} color={colors.primary} />
  ) : partial ? (
    <Icon name="refresh" size={24} color={colors.primaryText} />
  ) : (
    <Icon name="download_for_offline" filled size={26} color={disabled ? colors.disabled : colors.primaryText} />
  );

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled && !downloading}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}`}
      style={({ pressed }) => [styles.card, pressed && !downloading && { opacity: 0.92 }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={[styles.iconTile, covered && { backgroundColor: colors.primaryTint }]}>
          <Icon name={icon} filled size={22} color={colors.primaryText} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt f="n8" size={15} numberOfLines={1}>
            {title}
          </Txt>
          <Txt f="n7" size={12} color={partial ? colors.warnText : colors.muted}>
            {sub}
          </Txt>
        </View>
        {right}
      </View>
      {downloading ? <ProgressBar value={job && job.total ? job.done / job.total : 0} height={10} animated /> : null}
    </Pressable>
  );
}

/* ───────────── Arkusz na mapie pełnoekranowej ───────────── */

/** Arkusz od dołu: okolica (5 km) albo cała gmina – z szacunkiem rozmiaru, postępem i anulowaniem. */
export function OfflineMapSheet({ region, onClose }: { region: Region; onClose: () => void }) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const areas = useOfflineMapsStore((s) => s.areas);
  const usage = useTileUsage();
  const lat = region.position.lat;
  const lon = region.position.lon;
  const g = region.gmina;
  const around = useMemo(() => planAround({ gmina: g, position: { lat, lon } }), [g, lat, lon]);
  const gmina = useGminaPlan(g);
  // Indeks kafli wczytany i stan obszarów zgodny z dyskiem – dopiero wtedy pokrycie jest pewne.
  const synced = useAsync(() => syncOfflineAreas().then(() => true), []);
  const aroundArea = areas.find((a) => a.kind === 'around' && sameTiles(a.tiles, around.tiles));

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(160)} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Zamknij" />
        <Animated.View
          entering={SlideInDown.duration(240)}
          style={[styles.sheet, { maxHeight: Math.round(height * 0.86), paddingBottom: Math.max(insets.bottom, 16) }]}
        >
          <View style={styles.grabber} />
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Txt f="b7" size={24}>
                Mapa offline
              </Txt>
              <Txt f="n7" size={13} color={colors.muted}>
                Lasy, drogi leśne i woda – także bez zasięgu
              </Txt>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Zamknij">
              <Icon name="close" size={24} color={colors.muted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4, gap: 10 }}>
            <PlanOption
              title="Okolica (5 km)"
              icon="my_location"
              plan={synced.data ? around : undefined}
              area={aroundArea}
              gminaKind={g.kind}
            />
            <PlanOption
              title={g.kind === 'miejska' ? `Całe miasto ${g.name}` : `Cała gmina ${g.name}`}
              icon="home_pin"
              plan={synced.data ? gmina.data : undefined}
              failed={!!gmina.error}
              area={gminaArea(areas, g.id)}
              gminaKind={g.kind}
            />
            <Pressable
              onPress={() => {
                onClose();
                router.push(MANAGE_HREF);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.manage, pressed && { opacity: 0.7 }]}
            >
              <Icon name="hard_drive" size={18} color={colors.muted} />
              <Txt f="n7" size={13} color={colors.muted} style={{ flex: 1 }}>
                {areas.length
                  ? `Mapy offline na telefonie: ${fmtMB(usage.pinnedBytes)}`
                  : 'Pobrana mapa działa bez zasięgu, aż ją usuniesz'}
              </Txt>
              <Txt f="n8" size={13} color={colors.primaryText}>
                Zarządzaj
              </Txt>
              <Icon name="chevron_right" size={18} color={colors.primaryText} />
            </Pressable>
            <Txt f="n6" size={11} color={colors.muted}>
              Dane mapy © OpenStreetMap (ODbL), kafle OpenFreeMap. Pobieramy tylko obszar, który wybierzesz.
            </Txt>
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

/* ───────────── Karta na ekranie gminy ───────────── */

/** „Mapa gminy na offline” – pobranie całej gminy z ekranu szczegółów. */
export function OfflineGminaCard({ gmina }: { gmina: Gmina }) {
  const plan = useGminaPlan(gmina);
  const area = useOfflineMapsStore((s) => gminaArea(s.areas, gmina.id));
  const synced = useAsync(() => syncOfflineAreas().then(() => true), []);
  return (
    <PlanOption
      title={`Mapa ${gmina.kind === 'miejska' ? 'miasta' : 'gminy'} na offline`}
      icon="download_for_offline"
      plan={synced.data ? plan.data : undefined}
      failed={!!plan.error}
      area={area}
      gminaKind={gmina.kind}
      manageOnReady
    />
  );
}

/* ───────────── Podpowiedź ───────────── */

/** Podpowiedź pokazana w tej sesji (po restarcie już nie – flaga w store). */
let hintThisSession = false;

/**
 * „Pobierz mapę na offline, zanim wyjdziesz do lasu” – raz (jedna sesja), gdy mapy okolicy nie ma bez sieci,
 * a gracz nie ma jeszcze żadnej mapy offline.
 */
export function OfflineMapHint({ active }: { active: boolean }) {
  const shown = useOfflineMapsStore((s) => s.hintShown);
  const hasAreas = useOfflineMapsStore((s) => s.areas.length > 0);
  const eligible = active && !hasAreas && useOfflineMapsStore.persist.hasHydrated() && (hintThisSession || !shown);
  useEffect(() => {
    if (!eligible) return;
    hintThisSession = true;
    markOfflineHintShown();
  }, [eligible]);
  if (!eligible) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
      <Icon name="download_for_offline" size={16} color={colors.muted} />
      <Txt f="n6" size={12} color={colors.muted} style={{ flex: 1 }}>
        Pobierz mapę na offline, zanim wyjdziesz do lasu
      </Txt>
    </View>
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
  iconTile: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.chip,
  },
  manage: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 4 },
});
