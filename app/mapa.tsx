import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';

import { ForecastPills } from '@/components/Forecast';
import { ForestPill, type ForestInfo } from '@/components/ForestPill';
import { IconButton } from '@/components/IconButton';
import { StateCard } from '@/components/OfflineCard';
import { OfflineMapSheet } from '@/components/OfflineMaps';
import { Pill } from '@/components/Pill';
import { Placeholder } from '@/components/Placeholder';
import { Txt } from '@/components/Txt';
import { ZoomableAreaMap, type MapViewInfo, type ZoomableAreaMapHandle } from '@/components/ZoomableAreaMap';
import { nearestPointOnFilledRings } from '@/geo/geometry';
import { lonLatToWorld } from '@/geo/mercator';
import { FULL_MAP_RADIUS_M, useAreaMap } from '@/hooks/useAreaMap';
import { useBottomPadding, useTopInset } from '@/hooks/useInsets';
import { detectRegion, useRegionStore } from '@/hooks/useRegion';
import { useServices } from '@/services';
import { isAreaMapOffline, useOfflineMapsStore } from '@/store/useOfflineMapsStore';
import { colors, mapColors, shadows } from '@/theme/tokens';
import { fmtDistanceM, gminaTitle } from '@/utils/format';

/**
 * Mapa okolicy na pełny ekran (z karty „Wykryto region”): większy obszar (promień 4 km), przybliżanie
 * i przesuwanie, wyraźnie zaznaczone lasy ze znacznikami drzew, kreska do najbliższego lasu,
 * granica gminy i legenda. Pozycja tylko w pamięci (useRegionStore) – nic nowego nie jest zapisywane.
 * Przycisk w prawym górnym rogu: „Pobierz na offline” (okolica 5 km / cała gmina – src/components/OfflineMaps.tsx);
 * plakietka „Mapa offline ✓”, gdy cały widok jest w pobranych obszarach.
 */
export default function MapScreen() {
  const services = useServices();
  const region = useRegionStore((s) => s.region);
  const regionStatus = useRegionStore((s) => s.status);
  const area = useAreaMap(region, FULL_MAP_RADIUS_M);
  const map = area.data;
  const top = useTopInset();
  const bottom = useBottomPadding();
  const mapRef = useRef<ZoomableAreaMapHandle>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<MapViewInfo>({ canZoomIn: true, canZoomOut: false, atHome: true });
  const [offlineOpen, setOfflineOpen] = useState(false);
  const job = useOfflineMapsStore((s) => Object.values(s.jobs)[0]);
  // Cały zakres kafli mapy w obszarach offline – subskrypcja listy obszarów przelicza go po pobraniu / usunięciu.
  useOfflineMapsStore((s) => s.areas);
  const offlineReady = map ? isAreaMapOffline(map) : false;

  // Wejście prosto w /mapa (np. odświeżenie strony na webie) – region nie był jeszcze wykryty.
  useEffect(() => {
    const st = useRegionStore.getState();
    if (!st.region && st.status !== 'loading') detectRegion(services, { askPermission: false });
  }, [services]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    const h = Math.round(e.nativeEvent.layout.height);
    if (!size || size.w !== w || size.h !== h) setSize({ w, h });
  };

  const lat = region?.position.lat;
  const lon = region?.position.lon;
  const position = useMemo(
    () => (map && lat != null && lon != null ? lonLatToWorld(lon, lat, map.zoom) : null),
    [map, lat, lon],
  );
  // Odległość do lasu z dokładnej pozycji (ta sama, z której rysujemy kreskę).
  const nearest = useMemo(
    () => (map && position ? nearestPointOnFilledRings(position.x, position.y, map.forest) : null),
    [map, position],
  );
  const forestM = nearest ? (nearest.inside ? 0 : nearest.d * map!.metersPerPx) : null;
  // Mapa z brakami (offline poza pobranym obszarem): las szukamy tylko tam, gdzie dane są kompletne.
  const searchM = map ? (map.completeRadiusM ?? map.radiusM) : 0;
  const inRange = forestM != null && forestM <= searchM;
  const forestInfo: ForestInfo | undefined = map ? { distanceM: inRange ? Math.round(forestM!) : null, radiusM: searchM } : undefined;
  const forestLink = useMemo(
    () => (nearest && !nearest.inside && inRange ? { x: nearest.x, y: nearest.y } : null),
    [nearest, inRange],
  );

  const close = () => (router.canGoBack() ? router.back() : router.navigate('/'));
  const accuracy = region?.position.accuracyM ?? 0;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: mapColors.land }} onLayout={onLayout}>
        <StatusBar style="dark" />
        {map && position && size ? (
          <ZoomableAreaMap
            key={`${map.center.x}:${map.center.y}`}
            ref={mapRef}
            map={map}
            position={position}
            accuracyM={accuracy}
            width={size.w}
            height={size.h}
            forestLink={forestLink}
            onViewChange={setView}
          />
        ) : (
          <Placeholder
            variant="moss"
            stripe={10}
            label={area.error || regionStatus === 'error' ? undefined : region ? 'wczytuję mapę okolicy…' : 'ustalam pozycję…'}
            style={StyleSheet.absoluteFill}
          />
        )}

        {!map && (area.error || regionStatus === 'error') ? (
          <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { justifyContent: 'center', padding: 24 }]}>
            {area.error ? (
              <StateCard
                icon="cloud_off"
                title="Mapa niedostępna offline"
                text="Gmina i lesistość działają bez sieci. Lasy w okolicy pokażemy, gdy wróci połączenie – następnym razem pobierz mapę na offline, zanim wyjdziesz do lasu."
                action="Spróbuj ponownie"
                onAction={area.reload}
              />
            ) : (
              <StateCard
                icon="location_off"
                title="Nie znamy Twojej pozycji"
                text="Wróć do ekranu Start i włącz lokalizację, a pokażemy lasy w okolicy."
                action="Wróć"
                onAction={close}
              />
            )}
          </View>
        ) : null}

        {/* Góra: zamknięcie i nazwa gminy (granica gminy na mapie – przerywana linia). */}
        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', top: top + 2, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}
        >
          <IconButton icon="close" onPress={close} accessibilityLabel="Zamknij mapę" />
          <View pointerEvents="none" style={{ flex: 1, alignItems: 'center' }}>
            {region ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  maxWidth: '100%',
                  backgroundColor: colors.card,
                  borderRadius: 999,
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                  boxShadow: shadows.card,
                }}
              >
                <LineSwatch color={mapColors.boundary} dash="4 3" width={2} opacity={0.75} />
                <Txt f="n8" size={14} numberOfLines={1} style={{ flexShrink: 1 }}>
                  {gminaTitle(region.gmina)}
                </Txt>
              </View>
            ) : null}
          </View>
          {region ? (
            <IconButton
              icon={job ? 'downloading' : offlineReady ? 'offline_pin' : 'download_for_offline'}
              filled={offlineReady && !job}
              onPress={() => setOfflineOpen(true)}
              accessibilityLabel={offlineReady ? 'Mapa offline – pobrana' : 'Pobierz na offline'}
            />
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>

        {/* Dół: przyciski mapy nad legendą. */}
        {map && position ? (
          <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom, gap: 12 }}>
            <View pointerEvents="box-none" style={{ alignSelf: 'flex-end', gap: 10 }}>
              <IconButton
                icon="add"
                onPress={() => mapRef.current?.zoomBy(2)}
                accessibilityLabel="Przybliż"
                style={{ opacity: view.canZoomIn ? 1 : 0.5 }}
              />
              <IconButton
                icon="remove"
                onPress={() => mapRef.current?.zoomBy(0.5)}
                accessibilityLabel="Oddal"
                style={{ opacity: view.canZoomOut ? 1 : 0.5 }}
              />
              <IconButton
                icon="my_location"
                filled={view.atHome}
                onPress={() => mapRef.current?.recenter()}
                accessibilityLabel="Wróć do mojej pozycji"
              />
            </View>
            <View
              style={{
                backgroundColor: colors.card,
                borderRadius: 22,
                boxShadow: shadows.card,
                paddingVertical: 12,
                paddingHorizontal: 14,
                gap: 10,
              }}
            >
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <ForestPill info={forestInfo} loading={area.loading} />
                {region ? (
                  <ForecastPills point={region.position} gminaId={region.gmina.id} place={gminaTitle(region.gmina)} compact />
                ) : null}
                {accuracy > 500 ? (
                  <Pill
                    label={`Dokładność ±${fmtDistanceM(accuracy)}`}
                    icon="warning"
                    bg={colors.warnBg}
                    color={colors.warnText}
                    iconColor={colors.warnIcon}
                  />
                ) : null}
                {job ? (
                  <Pill
                    label={`Pobieram mapę ${job.total ? Math.round((job.done / job.total) * 100) : 0}%`}
                    icon="downloading"
                    bg={colors.infoBg}
                    color={colors.infoText}
                    onPress={() => setOfflineOpen(true)}
                  />
                ) : offlineReady ? (
                  <Pill label="Mapa offline ✓" onPress={() => setOfflineOpen(true)} />
                ) : map.missingTiles ? (
                  <Pill
                    label="Część mapy niedostępna offline"
                    icon="cloud_off"
                    bg={colors.chip}
                    color={colors.tagNeutralText}
                    onPress={() => setOfflineOpen(true)}
                  />
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 6 }}>
                <LegendItem label="Las">
                  <ForestSwatch />
                </LegendItem>
                <LegendItem label="Woda">
                  <View
                    style={{
                      width: 18,
                      height: 12,
                      borderRadius: 3,
                      backgroundColor: mapColors.water,
                      borderWidth: 1,
                      borderColor: mapColors.waterLine,
                    }}
                  />
                </LegendItem>
                <LegendItem label="Droga leśna">
                  <LineSwatch color={mapColors.track} dash="3 3" width={1.6} />
                </LegendItem>
                <LegendItem label="Granica gminy">
                  <LineSwatch color={mapColors.boundary} dash="5 3" width={2} opacity={0.75} />
                </LegendItem>
              </View>
              <Txt f="n6" size={10} color={colors.muted} align="right">
                {map.attribution}
              </Txt>
            </View>
          </View>
        ) : null}
      </View>
      {offlineOpen && region ? <OfflineMapSheet region={region} onClose={() => setOfflineOpen(false)} /> : null}
    </GestureHandlerRootView>
  );
}

function LegendItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {children}
      <Txt f="n7" size={12} color={colors.bodyDark}>
        {label}
      </Txt>
    </View>
  );
}

function ForestSwatch() {
  return (
    <Svg width={18} height={12}>
      <Defs>
        <Pattern id="legendForest" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
          <Rect x={0} y={0} width={6} height={6} fill={mapColors.forestRichA} />
          <Rect x={3} y={0} width={3} height={6} fill={mapColors.forestRichB} />
        </Pattern>
      </Defs>
      <Rect x={0.75} y={0.75} width={16.5} height={10.5} rx={3} fill="url(#legendForest)" stroke={mapColors.forestEdge} strokeWidth={1.5} />
    </Svg>
  );
}

function LineSwatch({ color, dash, width, opacity = 1 }: { color: string; dash: string; width: number; opacity?: number }) {
  return (
    <Svg width={20} height={12}>
      <Line x1={1} y1={6} x2={19} y2={6} stroke={color} strokeWidth={width} strokeDasharray={dash} strokeOpacity={opacity} />
    </Svg>
  );
}
