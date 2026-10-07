import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { lonLatToWorld, metersPerPx } from '@/geo/mercator';
import { fitRoute, type LatLon } from '@/geo/track';
import { useAsync } from '@/hooks/useAsync';
import { useServices } from '@/services';
import { useSimStore } from '@/store/useSimStore';
import { colors, mapColors } from '@/theme/tokens';
import { AreaMapView } from './AreaMap';
import { Txt } from './Txt';

/** Poziom do rzutowania nakładki – dowolny: skala ekranu się skraca (piksele świata × m/px). */
const Z = 13;
/** Margines trasy od krawędzi karty (px) – miejsce na znaczniki; u góry także na pigułkę gminy. */
const PAD = 22;
const PAD_TOP = 50;

interface RouteMapProps {
  /** Odcinki do narysowania – już przybliżone (to, co wolno pokazać i opublikować). */
  segments: LatLon[][];
  /** Gmina, której granicę dorysować (przerywana linia). */
  gminaTeryt?: string;
  height: number;
  /** Krótki podpis w lewym dolnym rogu (np. „trasa przybliżona”) – obok podpisu źródła mapy. */
  caption?: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

/**
 * Trasa wyprawy na mapie okolicy (te same kafle i styl co karta „Wykryto region”): kadr dopasowany
 * do trasy, linia w kolorze primary z białą obwódką, znaczniki początku i końca widocznej części.
 * Bez sieci – trasa na paskowanym placeholderze z dopiskiem „mapa offline”.
 */
export function RouteMap({ segments, gminaTeryt, height, caption, style, children }: RouteMapProps) {
  const { map } = useServices();
  const net = useSimStore((s) => s.networkEnabled);
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const nw = Math.round(e.nativeEvent.layout.width);
    if (nw !== w) setW(nw);
  };

  const view = useMemo(() => (w > 0 ? fitRoute(segments, w, height, { padPx: PAD, padTopPx: PAD_TOP }) : null), [segments, w, height]);
  // Środek zaokrąglony do ~10 m, promień do 100 m – mapa nie jest pobierana od nowa przy drobnych zmianach.
  // Ten sam (zaokrąglony) środek służy do rzutowania trasy, więc nakładka zgadza się z mapą co do piksela.
  const lat = view ? Math.round(view.center.lat * 1e4) / 1e4 : null;
  const lon = view ? Math.round(view.center.lon * 1e4) / 1e4 : null;
  const radiusM = view ? Math.ceil(view.radiusM / 100) * 100 : null;
  const area = useAsync(
    () =>
      lat == null || lon == null || radiusM == null
        ? Promise.resolve(undefined)
        : map.getAreaMap({ lat, lon, radiusM, gminaTeryt }),
    [map, lat, lon, radiusM, gminaTeryt, net],
  );

  const overlay = useMemo(() => {
    if (!view || lat == null || lon == null || !segments.length) return null;
    const c = lonLatToWorld(lon, lat, Z);
    const s = metersPerPx(lat, Z) / view.mPerPx;
    const project = (p: LatLon) => {
      const q = lonLatToWorld(p.lon, p.lat, Z);
      return { x: Math.round(((q.x - c.x) * s + w / 2) * 10) / 10, y: Math.round(((q.y - c.y) * s + height / 2) * 10) / 10 };
    };
    const d = segments
      .map((seg) =>
        seg
          .map((p, i) => {
            const q = project(p);
            return `${i ? 'L' : 'M'}${q.x} ${q.y}`;
          })
          .join(''),
      )
      .join('');
    const lastSeg = segments[segments.length - 1];
    return { d, start: project(segments[0][0]), end: project(lastSeg[lastSeg.length - 1]) };
  }, [view, lat, lon, segments, w, height]);

  return (
    <View onLayout={onLayout} style={[{ height, borderRadius: 24, overflow: 'hidden' }, style]}>
      {/* Bez sieci zostaje paskowany placeholder; informację „offline” niesie podpis w rogu (nie zasłania trasy). */}
      <AreaMapView
        map={area.data}
        height={height}
        mPerPx={view?.mPerPx}
        showPosition={false}
        loadingLabel={null}
      >
        {overlay && w > 0 ? (
          <Svg width={w} height={height} style={StyleSheet.absoluteFill}>
            <Path
              d={overlay.d}
              fill="none"
              stroke={colors.white}
              strokeOpacity={0.9}
              strokeWidth={7.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Path d={overlay.d} fill="none" stroke={colors.primary} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
            <Circle cx={overlay.start.x} cy={overlay.start.y} r={5.5} fill={colors.white} stroke={colors.primaryShadow} strokeWidth={3} />
            <Circle cx={overlay.end.x} cy={overlay.end.y} r={7} fill={colors.primary} stroke={colors.white} strokeWidth={3} />
          </Svg>
        ) : null}
      </AreaMapView>
      {caption || area.error ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 6,
            bottom: 6,
            backgroundColor: mapColors.attributionBg,
            borderRadius: 6,
            paddingHorizontal: 5,
            paddingVertical: 1,
          }}
        >
          <Txt f="n6" size={9} color={colors.muted}>
            {[caption, area.error ? 'mapa offline' : null].filter(Boolean).join(' · ')}
          </Txt>
        </View>
      ) : null}
      {children}
    </View>
  );
}
