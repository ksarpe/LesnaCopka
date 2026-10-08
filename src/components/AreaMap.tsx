import { memo, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, Path, Pattern, Rect } from 'react-native-svg';

import { projectAreaMap, type ProjectedAreaMap } from '@/geo/areaMapProjection';
import { colors, mapColors, stripes } from '@/theme/tokens';
import type { AreaMap } from '@/types';
import { Placeholder } from './Placeholder';
import { Txt } from './Txt';

/** Skala karty: ok. 9 m na piksel → szerokość ~3,2 km („okolica”, nie cała gmina). */
export const TARGET_M_PER_PX = 9;
/** Halo pozycji: minimum jak w makiecie (60 px), maksimum, by nie zalać karty przy słabym GPS. */
export const HALO_MIN = 30;
const HALO_MAX = 120;

interface AreaMapLayersProps {
  paths: ProjectedAreaMap;
  /**
   * Mapa pełnoekranowa: ciemniejsze paski lasu z brzegiem, wyraźniejsza granica gminy. Karta (false)
   * zostaje dokładnie jak w makiecie.
   */
  rich?: boolean;
  /** Id wzoru lasu – osobne dla każdego `<Svg>` w jednym dokumencie (web: kilka warstw mapy naraz). */
  patternId?: string;
  /** Elementy między drogami a granicą gminy (np. znaczniki drzew). */
  children?: ReactNode;
}

/** Warstwy mapy okolicy (wnętrze `<Svg>`): las, woda, drogi, drogi leśne, granica gminy. */
export const AreaMapLayers = memo(function AreaMapLayers({ paths, rich, patternId, children }: AreaMapLayersProps) {
  // Osobne id wzoru: na webie karta i mapa pełnoekranowa są w jednym dokumencie.
  const pattern = patternId ?? (rich ? 'forestRich' : 'forest');
  return (
    <>
      <Defs>
        <Pattern id={pattern} patternUnits="userSpaceOnUse" width={10} height={10} patternTransform="rotate(45)">
          <Rect x={0} y={0} width={10} height={10} fill={rich ? mapColors.forestRichA : mapColors.forestA} />
          <Rect x={5} y={0} width={5} height={10} fill={rich ? mapColors.forestRichB : mapColors.forestB} />
        </Pattern>
      </Defs>
      {/*
        Bez obrysu wypełnienia: wielokąty są przycięte do kafli, obrys rysowałby szwy siatki kafli.
        Brzeg lasu w wersji pełnoekranowej: gruba linia pod wypełnieniem – wypełnienie zakrywa jej
        wewnętrzną połowę i szwy (kafle zachodzą na siebie o 4 px świata ≥ 5 px ekranu), zostaje tylko
        zewnętrzny brzeg. Cienki obrys wzorem lasu domyka podpikselowe szczeliny między sąsiednimi
        wielokątami lasu (inaczej prześwitywałby przez nie brzeg).
      */}
      {rich ? (
        <Path d={paths.forest} fill="none" stroke={mapColors.forestEdge} strokeWidth={4} strokeLinejoin="round" />
      ) : null}
      <Path
        d={paths.forest}
        fill={`url(#${pattern})`}
        fillRule="nonzero"
        stroke={rich ? `url(#${pattern})` : undefined}
        strokeWidth={rich ? 1.2 : undefined}
        strokeLinejoin={rich ? 'round' : undefined}
      />
      <Path d={paths.water} fill={mapColors.water} fillRule="nonzero" />
      <Path d={paths.waterways} fill="none" stroke={mapColors.waterLine} strokeWidth={1.5} strokeLinecap="round" />
      <Path
        d={paths.roads}
        fill="none"
        stroke={mapColors.roadCasing}
        strokeWidth={4.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d={paths.roads} fill="none" stroke={mapColors.road} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      <Path d={paths.tracks} fill="none" stroke={mapColors.track} strokeWidth={1.1} strokeDasharray="3 3" />
      {children}
      {rich ? (
        <Path d={paths.boundary} fill="none" stroke={mapColors.boundary} strokeWidth={6} strokeOpacity={0.1} strokeLinejoin="round" />
      ) : null}
      <Path
        d={paths.boundary}
        fill="none"
        stroke={mapColors.boundary}
        strokeWidth={rich ? 2 : 1.8}
        strokeDasharray="7 5"
        strokeOpacity={rich ? 0.7 : 0.6}
      />
    </>
  );
});

interface AreaMapViewProps {
  map?: AreaMap;
  /** Brak sieci / błąd pobrania – zostaje placeholder z pozycją. */
  failed?: boolean;
  /** Dokładność GPS (m) – promień halo. */
  accuracyM?: number;
  height: number;
  /** Skala widoku (m na piksel ekranu); domyślnie ~9 m/px – „okolica”. */
  mPerPx?: number;
  /** Kropka pozycji z halo na środku (false np. dla trasy w Podsumowaniu). */
  showPosition?: boolean;
  /** Podpis placeholdera w trakcie ładowania (null = bez podpisu). */
  loadingLabel?: string | null;
  /** Nakładka nad mapą (np. trasa) – pod podpisem źródła danych. */
  children?: ReactNode;
}

/** Mapa okolicy: lasy, woda, drogi, granica gminy i pozycja użytkownika na środku. */
export const AreaMapView = memo(function AreaMapView({
  map,
  failed,
  accuracyM,
  height,
  mPerPx = TARGET_M_PER_PX,
  showPosition = true,
  loadingLabel = 'mapa okolicy',
  children,
}: AreaMapViewProps) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const nw = Math.round(e.nativeEvent.layout.width);
    if (nw !== w) setW(nw);
  };
  const paths = useMemo(
    () => (map && w > 0 ? projectAreaMap(map, { width: w, height, mPerPx }) : null),
    [map, w, height, mPerPx],
  );
  const halo = Math.max(HALO_MIN, Math.min(HALO_MAX, (accuracyM ?? 0) * (paths?.pxPerM ?? 0)));

  return (
    <View onLayout={onLayout} style={{ height, backgroundColor: mapColors.land, overflow: 'hidden' }}>
      {paths ? (
        <Svg width={w} height={height} style={StyleSheet.absoluteFill}>
          <AreaMapLayers paths={paths} />
        </Svg>
      ) : (
        // Ładowanie wygląda jak placeholder z makiety; offline podpis schodzi pod pozycję, by jej nie zasłaniać.
        <Placeholder
          variant="moss"
          stripe={10}
          label={failed ? undefined : (loadingLabel ?? undefined)}
          style={StyleSheet.absoluteFill}
        />
      )}
      {failed && !paths ? (
        <Txt
          f="mono"
          size={11}
          color={stripes.moss.label}
          align="center"
          style={{ position: 'absolute', left: 0, right: 0, bottom: 12 }}
        >
          mapa niedostępna offline
        </Txt>
      ) : null}
      {children}
      {showPosition ? (
        <>
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: halo * 2,
              height: halo * 2,
              marginLeft: -halo,
              marginTop: -halo,
              borderRadius: halo,
              backgroundColor: 'rgba(127,181,71,0.25)',
            }}
          />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 24,
              height: 24,
              marginLeft: -9,
              marginTop: -9,
              borderRadius: 12,
              backgroundColor: colors.primary,
              borderWidth: 3,
              borderColor: colors.white,
            }}
          />
        </>
      ) : null}
      {paths && map ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: 6,
            bottom: 6,
            backgroundColor: mapColors.attributionBg,
            borderRadius: 6,
            paddingHorizontal: 5,
            paddingVertical: 1,
          }}
        >
          <Txt f="n6" size={9} color={colors.muted}>
            {map.attribution}
          </Txt>
        </View>
      ) : null}
    </View>
  );
});
