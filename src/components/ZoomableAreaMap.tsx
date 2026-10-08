import { memo, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { projectAreaMap, projectPoint, type MapTransform, type MapViewport, type ProjectedAreaMap, type XY } from '@/geo/areaMapProjection';
import { baseCanvas, clampT, hasDetail, homeView, MAX_ZOOM, MIN_ZOOM, sameView, viewCenter, zoomAt, type ViewState } from '@/geo/areaMapView';
import { buildForestGrid, pickTreeMarkers, type ForestGrid, type TreeMarker } from '@/geo/forestMarkers';
import { colors, mapColors, shadows } from '@/theme/tokens';
import type { AreaMap } from '@/types';
import { AreaMapLayers, HALO_MIN, TARGET_M_PER_PX } from './AreaMap';

/** Halo nie rośnie bez końca przy słabym GPS i dużym przybliżeniu. */
const HALO_MAX = 1000;
const HALO_BASE = 200;
const DOT = 24;
/** Komórka siatki lasu (piksele świata z13 ≈ 47 m) – do znaczników drzew. */
const GRID_CELL = 4;
const MARKERS = { spacingPx: 64, minDepthPx: 12 };
const NO_MARKERS: TreeMarker[] = [];
const ANIM = { duration: 280, easing: Easing.out(Easing.cubic) };
const IS_WEB = Platform.OS === 'web';
/**
 * Widok musi stać tyle (ms) po ostatnim ruchu, zanim narysujemy go od nowa – kilka szybkich gestów
 * jeden po drugim (albo bezwładność) to jeden rysunek, a nie kilka.
 */
const SETTLE_MS = 90;
/** Kółko myszy przychodzi porcjami – dłuższa przerwa = koniec przybliżania. */
const WHEEL_SETTLE_MS = 160;

/**
 * Sylwetka świerka (środek w 0,0; ok. 12 × 14 px) – jeden znacznik lasu. Rysowana raz z jasną obwódką,
 * raz wypełniona, żeby była czytelna także na drogach i paskach lasu.
 */
const TREE = [
  [0, -7],
  [4.2, -1.5],
  [2.4, -1.5],
  [6, 3.5],
  [1.4, 3.5],
  [1.4, 7],
  [-1.4, 7],
  [-1.4, 3.5],
  [-6, 3.5],
  [-2.4, -1.5],
  [-4.2, -1.5],
];

export interface ZoomableAreaMapHandle {
  /** Powrót do widoku startowego: pozycja na środku, skala 1×. */
  recenter(): void;
  /** Przybliżenie (> 1) / oddalenie (< 1) względem środka ekranu. */
  zoomBy(factor: number): void;
}

/** Stan przycisków mapy – zgłaszany tylko wtedy, gdy się zmienia (nie po każdym geście). */
export interface MapViewInfo {
  canZoomIn: boolean;
  canZoomOut: boolean;
  /** Widok startowy (pozycja na środku, 1×). */
  atHome: boolean;
}

interface ZoomableAreaMapProps {
  map: AreaMap;
  /** Pozycja użytkownika (piksele świata na poziomie `map.zoom`). */
  position: XY;
  /** Dokładność GPS (m) – promień halo. */
  accuracyM: number;
  width: number;
  height: number;
  /** Najbliższy brzeg lasu (piksele świata) – przerywana kreska od pozycji; null = w lesie albo brak lasu. */
  forestLink?: XY | null;
  /** Zatwierdzony widok (po geście) – stan przycisków. */
  onViewChange?: (v: MapViewInfo) => void;
  ref?: Ref<ZoomableAreaMapHandle>;
}

/**
 * Mapa okolicy na pełny ekran: szczypanie, przesuwanie, podwójne tapnięcie (web: kółko myszy).
 *
 * Płynność: w trakcie gestu nic nie jest liczone ani rysowane od nowa – gesty zmieniają tylko wartości
 * współdzielone (k, tx, ty), a te przekształcenie G jednej warstwy `Animated.View` (wątek UI). React
 * i SVG ruszają dopiero, gdy palce puszczą mapę, a widok stanie (koniec bezwładności / animacji,
 * SETTLE_MS spokoju) – wtedy widok jest „zatwierdzany”. Wcześniej zatwierdzaliśmy także w trakcie gestu
 * (gdy kończyła się zakładka płótna) – na iPhonie każde takie przerysowanie SVG blokowało wątek UI
 * i mapa szarpała.
 *
 * Warstwy pod G:
 * - podkład – cała okolica przy 1× (`baseCanvas`), rysowany raz; pokrywa każdy dozwolony kadr, więc
 *   przesuwanie i oddalanie nigdy nie odsłania pustego brzegu (po przybliżeniu w trakcie gestu bywa rozmyty);
 * - szczegóły (tylko po przybliżeniu) – ostre ścieżki dla zatwierdzonego widoku (ekran + zakładka),
 *   nieprzezroczyste, z odwrotnością G tego widoku. Nowe ścieżki i nowa odwrotność trafiają na ekran
 *   w jednym commicie Reacta, więc po zatwierdzeniu złożenie to tożsamość (ostre piksele) i nic nie miga.
 *
 * Web: w trakcie gestu warstwa dostaje `will-change: transform` (własna warstwa kompozytora – przeglądarka
 * tylko przesuwa gotowy obraz, zamiast co klatkę rasteryzować SVG), po zatwierdzeniu go traci, żeby
 * przeglądarka narysowała ją ostro w nowej skali.
 */
export const ZoomableAreaMap = memo(function ZoomableAreaMap({
  map,
  position,
  accuracyM,
  width,
  height,
  forestLink,
  onViewChange,
  ref,
}: ZoomableAreaMapProps) {
  const hw = width / 2;
  const hh = height / 2;
  /** Piksele ekranu na piksel świata przy 1×. */
  const S = map.metersPerPx / TARGET_M_PER_PX;
  /** Promień danych w pikselach ekranu przy 1×. */
  const extent = map.radiusM / TARGET_M_PER_PX;
  /** Zakładka warstwy szczegółów poza ekranem (px) – ostre brzegi przy krótkim przesunięciu; dalej jest podkład. */
  const pad = Math.round(Math.min(120, Math.min(width, height) * 0.25));
  /** Pozycja względem środka widoku startowego (px przy 1×). */
  const qx = (position.x - map.center.x) * S;
  const qy = (position.y - map.center.y) * S;
  const home = useMemo(() => homeView({ x: qx, y: qy }, hw, hh, extent), [qx, qy, hw, hh, extent]);

  const k = useSharedValue(home.k);
  const tx = useSharedValue(home.tx);
  const ty = useSharedValue(home.ty);
  /** Palce na mapie – dopóki są, nic nie zatwierdzamy. */
  const pinching = useSharedValue(false);
  const panning = useSharedValue(false);

  // Zatwierdzony widok – w nim narysowana jest warstwa szczegółów.
  const [view, setView] = useState<ViewState>(home);
  const committed = useRef(view);

  // Web: własna warstwa kompozytora tylko na czas gestu (opis wyżej).
  const contentId = useId();
  const promoted = useRef(false);
  const promote = useCallback(
    (on: boolean) => {
      if (!IS_WEB || promoted.current === on) return;
      promoted.current = on;
      const el = document.getElementById(contentId);
      if (el) el.style.willChange = on ? 'transform' : '';
    },
    [contentId],
  );
  const beginInteraction = useCallback(() => promote(true), [promote]);
  // Przed malowaniem: nowe ścieżki i powrót do zwykłego malowania w tej samej klatce (chyba że palce
  // zdążyły wrócić na mapę – wtedy zrobi to zatwierdzenie po tamtym geście).
  useLayoutEffect(() => {
    committed.current = view;
    if (!pinching.get() && !panning.get()) promote(false);
  }, [view, promote, pinching, panning]);

  const atHome = Math.abs(view.k - home.k) < 1e-3 && Math.abs(view.tx - home.tx) < 1 && Math.abs(view.ty - home.ty) < 1;
  const canZoomIn = view.k < MAX_ZOOM - 0.01;
  const canZoomOut = view.k > MIN_ZOOM + 0.01;
  useEffect(() => {
    onViewChange?.({ canZoomIn, canZoomOut, atHome });
  }, [onViewChange, canZoomIn, canZoomOut, atHome]);

  // Zatwierdzenie dopiero, gdy widok stoi: bez palców na mapie i bez zmian przez SETTLE_MS.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const scheduleCommit = useCallback(
    (delay: number) => {
      const read = (): ViewState => ({ k: k.get(), tx: tx.get(), ty: ty.get() });
      let last = read();
      clearTimeout(timer.current);
      const check = () => {
        // Palce znów na mapie – zatwierdzi koniec tamtego gestu.
        if (pinching.get() || panning.get()) return;
        const cur = read();
        if (cur.k !== last.k || cur.tx !== last.tx || cur.ty !== last.ty) {
          // Jeszcze się rusza (bezwładność, animacja przycisku) – czekamy dalej.
          last = cur;
          timer.current = setTimeout(check, SETTLE_MS);
          return;
        }
        if (sameView(cur, committed.current)) promote(false);
        else setView(cur);
      };
      timer.current = setTimeout(check, delay);
    },
    [k, tx, ty, pinching, panning, promote],
  );

  /** Koniec gestu albo animacji – zatwierdzenie, gdy nic się już nie rusza. */
  const settle = useCallback(() => {
    'worklet';
    if (pinching.get() || panning.get()) return;
    scheduleOnRN(scheduleCommit, SETTLE_MS);
  }, [pinching, panning, scheduleCommit]);

  /** Początek gestu: przerwanie bezwładności / animacji. */
  const begin = useCallback(() => {
    'worklet';
    stopAll(k, tx, ty);
    if (IS_WEB) scheduleOnRN(beginInteraction);
  }, [k, tx, ty, beginInteraction]);

  const animateTo = useCallback(
    (v: ViewState) => {
      'worklet';
      stopAll(k, tx, ty);
      tx.set(withTiming(v.tx, ANIM));
      ty.set(withTiming(v.ty, ANIM));
      k.set(
        withTiming(v.k, ANIM, (finished) => {
          if (finished) settle();
        }),
      );
    },
    [k, tx, ty, settle],
  );

  useImperativeHandle(
    ref,
    () => ({
      recenter: () => {
        beginInteraction();
        animateTo(home);
      },
      zoomBy: (f: number) => {
        beginInteraction();
        animateTo(zoomAt({ k: k.get(), tx: tx.get(), ty: ty.get() }, f, 0, 0, hw, hh, extent));
      },
    }),
    [beginInteraction, animateTo, home, k, tx, ty, hw, hh, extent],
  );

  // Callbacki gestów działają po dotknięciu (nigdy w renderze) – refy czytają tylko begin / settle.
  /* eslint-disable react-hooks/refs */
  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .onStart(() => {
        pinching.set(true);
        begin();
      })
      .onChange((e) => {
        const v = zoomAt({ k: k.get(), tx: tx.get(), ty: ty.get() }, e.scaleChange, e.focalX - hw, e.focalY - hh, hw, hh, extent);
        k.set(v.k);
        tx.set(v.tx);
        ty.set(v.ty);
      })
      .onEnd(() => {
        pinching.set(false);
        settle();
      });
    const pan = Gesture.Pan()
      .averageTouches(true)
      .onStart(() => {
        panning.set(true);
        begin();
      })
      .onChange((e) => {
        tx.set(clampT(tx.get() + e.changeX, k.get(), hw, extent));
        ty.set(clampT(ty.get() + e.changeY, k.get(), hh, extent));
      })
      .onEnd((e) => {
        panning.set(false);
        // Bezwładność w granicach danych; zatwierdzenie, gdy wygaśnie (scheduleCommit czeka, aż widok stanie,
        // a koniec bezwładności dodatkowo je ponawia).
        const mx = Math.max(0, extent * k.get() - hw);
        const my = Math.max(0, extent * k.get() - hh);
        const done = (finished?: boolean) => {
          'worklet';
          if (finished) settle();
        };
        tx.set(withDecay({ velocity: e.velocityX, clamp: [-mx, mx] }, done));
        ty.set(withDecay({ velocity: e.velocityY, clamp: [-my, my] }, done));
        settle();
      });
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDelay(260)
      .onEnd((e, success) => {
        if (!success) return;
        begin();
        const cur = { k: k.get(), tx: tx.get(), ty: ty.get() };
        // Na maksymalnym przybliżeniu podwójne tapnięcie wraca do całej okolicy.
        const f = cur.k >= MAX_ZOOM - 0.01 ? MIN_ZOOM / cur.k : 2;
        animateTo(zoomAt(cur, f, e.x - hw, e.y - hh, hw, hh, extent));
      });
    return Gesture.Simultaneous(pinch, pan, doubleTap);
  }, [k, tx, ty, pinching, panning, hw, hh, extent, begin, settle, animateTo]);
  /* eslint-enable react-hooks/refs */

  // Web: kółko myszy / szczypanie gładzika (ctrl + wheel) przybliża wokół kursora.
  const wheelRef = useRef<View>(null);
  useEffect(() => {
    if (!IS_WEB) return;
    const el = wheelRef.current as unknown as HTMLElement | null;
    if (!el?.addEventListener) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1;
      const f = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.002));
      beginInteraction();
      stopAll(k, tx, ty);
      const v = zoomAt({ k: k.get(), tx: tx.get(), ty: ty.get() }, f, e.clientX - rect.left - hw, e.clientY - rect.top - hh, hw, hh, extent);
      k.set(v.k);
      tx.set(v.tx);
      ty.set(v.ty);
      scheduleCommit(WHEEL_SETTLE_MS);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [k, tx, ty, hw, hh, height, extent, beginInteraction, scheduleCommit]);

  // Siatka lasu (znaczniki drzew) – po pierwszym rysunku mapy, żeby nie opóźniać otwarcia.
  const [grid, setGrid] = useState<ForestGrid | null>(null);
  useEffect(() => {
    const id = setTimeout(() => {
      const r = map.radiusM / map.metersPerPx + GRID_CELL;
      const { x, y } = map.center;
      setGrid(
        buildForestGrid(map.forest, {
          bounds: { minX: x - r, minY: y - r, maxX: x + r, maxY: y + r },
          cell: GRID_CELL,
          exclude: map.water,
        }),
      );
    }, 0);
    return () => clearTimeout(id);
  }, [map]);

  // ── Podkład: cała okolica przy 1× (liczony raz na mapę i rozmiar ekranu) ──
  const base = useMemo(() => baseCanvas(width, height, extent), [width, height, extent]);
  const baseVp = useMemo<MapViewport>(
    () => ({ width: base.width, height: base.height, mPerPx: TARGET_M_PER_PX, center: map.center }),
    [base, map],
  );
  const baseMarkers = useMemo(() => (grid ? pickTreeMarkers(grid, S, MARKERS) : NO_MARKERS), [grid, S]);
  const baseContent = useCanvasContent(map, baseVp, baseMarkers, position, forestLink);

  // ── Szczegóły: zatwierdzony widok (płótno = ekran + zakładka), tylko po przybliżeniu ──
  const cw = width + 2 * pad;
  const ch = height + 2 * pad;
  const { k: vk, tx: vtx, ty: vty } = view;
  const detail = hasDetail(vk);
  const detailVp = useMemo<MapViewport | null>(
    () =>
      detail
        ? { width: cw, height: ch, mPerPx: TARGET_M_PER_PX / vk, center: viewCenter({ k: vk, tx: vtx, ty: vty }, map.center, S) }
        : null,
    [detail, cw, ch, vk, vtx, vty, map, S],
  );
  const detailMarkers = useMemo(
    () => (grid && detail ? pickTreeMarkers(grid, S * vk, MARKERS) : NO_MARKERS),
    [grid, detail, S, vk],
  );
  const detailContent = useCanvasContent(map, detailVp, detailMarkers, position, forestLink);

  // Warstwa szczegółów: odwrotność przekształcenia widoku, w którym ją narysowano.
  const compensate = {
    transform: [{ translateX: -vtx / vk }, { translateY: -vty / vk }, { scale: 1 / vk }],
  };
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: k.get() }],
  }));
  // Pozycja trzyma się mapy (nie środka ekranu), kropka ma stały rozmiar, halo – promień w metrach.
  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.get() + k.get() * qx }, { translateY: ty.get() + k.get() * qy }],
  }));
  const haloStyle = useAnimatedStyle(() => {
    const r = Math.min(HALO_MAX, Math.max(HALO_MIN, (accuracyM * k.get()) / TARGET_M_PER_PX));
    return {
      transform: [
        { translateX: tx.get() + k.get() * qx },
        { translateY: ty.get() + k.get() * qy },
        { scale: (2 * r) / HALO_BASE },
      ],
    };
  });

  return (
    <View ref={wheelRef} style={[StyleSheet.absoluteFill, { overflow: 'hidden', backgroundColor: mapColors.land }]}>
      <GestureDetector gesture={gesture}>
        <View collapsable={false} style={StyleSheet.absoluteFill} accessibilityLabel="Mapa okolicy">
          <Animated.View nativeID={contentId} style={[StyleSheet.absoluteFill, contentStyle]}>
            <View style={{ position: 'absolute', left: -base.padX, top: -base.padY, width: base.width, height: base.height }}>
              <MapCanvas width={base.width} height={base.height} content={baseContent} patternId="forestBase" />
            </View>
            {detailContent ? (
              <View
                style={[
                  { position: 'absolute', left: -pad, top: -pad, width: cw, height: ch, backgroundColor: mapColors.land },
                  compensate,
                ]}
              >
                <MapCanvas width={cw} height={ch} content={detailContent} patternId="forestDetail" />
              </View>
            ) : null}
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                left: hw - HALO_BASE / 2,
                top: hh - HALO_BASE / 2,
                width: HALO_BASE,
                height: HALO_BASE,
                borderRadius: HALO_BASE / 2,
                backgroundColor: 'rgba(127,181,71,0.25)',
              },
              haloStyle,
            ]}
          />
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                left: hw - DOT / 2,
                top: hh - DOT / 2,
                width: DOT,
                height: DOT,
                borderRadius: DOT / 2,
                backgroundColor: colors.primary,
                borderWidth: 3,
                borderColor: colors.white,
                boxShadow: shadows.knob,
              },
              dotStyle,
            ]}
          />
        </View>
      </GestureDetector>
    </View>
  );
});

function stopAll(k: SharedValue<number>, tx: SharedValue<number>, ty: SharedValue<number>) {
  'worklet';
  cancelAnimation(k);
  cancelAnimation(tx);
  cancelAnimation(ty);
}

interface CanvasContent {
  paths: ProjectedAreaMap;
  treePath: string;
  link: { d: string; b: XY } | null;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Znaczniki drzew w kadrze jako jedna ścieżka (px płótna). */
function treeMarkersPath(markers: readonly TreeMarker[], t: MapTransform, w: number, h: number): string {
  let d = '';
  for (const m of markers) {
    const p = projectPoint(t, m);
    if (p.x < -10 || p.y < -10 || p.x > w + 10 || p.y > h + 10) continue;
    for (let i = 0; i < TREE.length; i++) d += `${i ? 'L' : 'M'}${r1(p.x + TREE[i][0])} ${r1(p.y + TREE[i][1])}`;
    d += 'Z';
  }
  return d;
}

/**
 * Treść płótna dla kadru `vp` (null = bez warstwy). Osobne memo dla ścieżek, drzew i kreski – siatka lasu
 * czy kreska do lasu nie przeliczają warstw mapy.
 */
function useCanvasContent(
  map: AreaMap,
  vp: MapViewport | null,
  markers: readonly TreeMarker[],
  position: XY,
  forestLink: XY | null | undefined,
): CanvasContent | null {
  const paths = useMemo(() => (vp ? projectAreaMap(map, vp) : null), [map, vp]);
  const treePath = useMemo(() => (paths && vp ? treeMarkersPath(markers, paths, vp.width, vp.height) : ''), [markers, paths, vp]);
  const link = useMemo(() => {
    if (!paths || !forestLink) return null;
    const a = projectPoint(paths, position);
    const b = projectPoint(paths, forestLink);
    return { d: `M${r1(a.x)} ${r1(a.y)}L${r1(b.x)} ${r1(b.y)}`, b: { x: r1(b.x), y: r1(b.y) } };
  }, [paths, position, forestLink]);
  return useMemo(() => (paths ? { paths, treePath, link } : null), [paths, treePath, link]);
}

interface MapCanvasProps {
  width: number;
  height: number;
  content: CanvasContent | null;
  /** Id wzoru lasu – osobne dla podkładu i szczegółów (web: jeden dokument). */
  patternId: string;
}

/** SVG jednej warstwy – przerysowywane tylko po zatwierdzeniu widoku, nigdy w trakcie gestu. */
const MapCanvas = memo(function MapCanvas({ width, height, content, patternId }: MapCanvasProps) {
  if (!content) return null;
  const { paths, treePath, link } = content;
  return (
    <Svg width={width} height={height}>
      <AreaMapLayers paths={paths} rich patternId={patternId}>
        {treePath ? (
          <>
            <Path d={treePath} fill={mapColors.treeHalo} stroke={mapColors.treeHalo} strokeWidth={2.5} strokeLinejoin="round" />
            <Path d={treePath} fill={mapColors.tree} />
          </>
        ) : null}
      </AreaMapLayers>
      {link ? (
        <>
          {/* Kropkowana kreska do najbliższego lasu: zielone kropki z jasną obwódką. */}
          <Path d={link.d} stroke={colors.white} strokeOpacity={0.85} strokeWidth={5.5} strokeDasharray="0.1 6" strokeLinecap="round" />
          <Path d={link.d} stroke={mapColors.forestLink} strokeWidth={2.6} strokeDasharray="0.1 6" strokeLinecap="round" />
          <Circle cx={link.b.x} cy={link.b.y} r={4.5} fill={colors.white} stroke={mapColors.forestLink} strokeWidth={2} />
        </>
      ) : null}
    </Svg>
  );
});
