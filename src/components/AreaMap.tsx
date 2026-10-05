import { memo, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, Path, Pattern, Rect } from 'react-native-svg';

import { colors, mapColors, stripes } from '@/theme/tokens';
import type { AreaMap } from '@/types';
import { Placeholder } from './Placeholder';
import { Txt } from './Txt';

/** Skala karty: ok. 9 m na piksel → szerokość ~3,2 km („okolica”, nie cała gmina). */
const TARGET_M_PER_PX = 9;
/** Halo pozycji: minimum jak w makiecie (60 px), maksimum, by nie zalać karty przy słabym GPS. */
const HALO_MIN = 30;
const HALO_MAX = 120;

interface Paths {
  forest: string;
  water: string;
  waterways: string;
  roads: string;
  tracks: string;
  boundary: string;
  /** Piksele ekranu na metr. */
  pxPerM: number;
}

/** Ścieżki SVG w pikselach karty; pomija elementy całkowicie poza kadrem. */
function buildPaths(map: AreaMap, w: number, h: number): Paths {
  const s = map.metersPerPx / TARGET_M_PER_PX;
  const ox = w / 2 - map.center.x * s;
  const oy = h / 2 - map.center.y * s;
  const margin = 8;
  const toD = (list: number[][], closed: boolean) => {
    let d = '';
    for (const p of list) {
      if (p.length < 4) continue;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < p.length; i += 2) {
        const x = p[i] * s + ox;
        const y = p[i + 1] * s + oy;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (maxX < -margin || minX > w + margin || maxY < -margin || minY > h + margin) continue;
      let px = NaN;
      let py = NaN;
      for (let i = 0; i < p.length; i += 2) {
        const x = Math.round((p[i] * s + ox) * 10) / 10;
        const y = Math.round((p[i + 1] * s + oy) * 10) / 10;
        if (i > 0 && x === px && y === py) continue;
        d += `${i === 0 ? 'M' : 'L'}${x} ${y}`;
        px = x;
        py = y;
      }
      if (closed) d += 'Z';
    }
    return d;
  };
  return {
    forest: toD(map.forest, true),
    water: toD(map.water, true),
    waterways: toD(map.waterways, false),
    roads: toD(map.roads, false),
    tracks: toD(map.tracks, false),
    boundary: toD(map.boundary, true),
    pxPerM: 1 / TARGET_M_PER_PX,
  };
}

interface AreaMapViewProps {
  map?: AreaMap;
  /** Brak sieci / błąd pobrania – zostaje placeholder z pozycją. */
  failed?: boolean;
  /** Dokładność GPS (m) – promień halo. */
  accuracyM?: number;
  height: number;
}

/** Mapa okolicy: lasy, woda, drogi, granica gminy i pozycja użytkownika na środku. */
export const AreaMapView = memo(function AreaMapView({ map, failed, accuracyM, height }: AreaMapViewProps) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const nw = Math.round(e.nativeEvent.layout.width);
    if (nw !== w) setW(nw);
  };
  const paths = useMemo(() => (map && w > 0 ? buildPaths(map, w, height) : null), [map, w, height]);
  const halo = Math.max(HALO_MIN, Math.min(HALO_MAX, (accuracyM ?? 0) * (paths?.pxPerM ?? 0)));

  return (
    <View onLayout={onLayout} style={{ height, backgroundColor: mapColors.land, overflow: 'hidden' }}>
      {paths ? (
        <Svg width={w} height={height} style={StyleSheet.absoluteFill}>
          <Defs>
            <Pattern id="forest" patternUnits="userSpaceOnUse" width={10} height={10} patternTransform="rotate(45)">
              <Rect x={0} y={0} width={10} height={10} fill={mapColors.forestA} />
              <Rect x={5} y={0} width={5} height={10} fill={mapColors.forestB} />
            </Pattern>
          </Defs>
          {/* Bez obrysu: wielokąty są przycięte do kafli, obrys rysowałby szwy siatki kafli. */}
          <Path d={paths.forest} fill="url(#forest)" fillRule="nonzero" />
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
          <Path
            d={paths.boundary}
            fill="none"
            stroke={mapColors.boundary}
            strokeWidth={1.8}
            strokeDasharray="7 5"
            strokeOpacity={0.6}
          />
        </Svg>
      ) : (
        // Ładowanie wygląda jak placeholder z makiety; offline podpis schodzi pod pozycję, by jej nie zasłaniać.
        <Placeholder
          variant="moss"
          stripe={10}
          label={failed ? undefined : 'mapa okolicy'}
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
