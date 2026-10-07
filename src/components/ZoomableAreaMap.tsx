import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { projectAreaMap, projectPoint, viewportTransform, type XY } from '@/geo/areaMapProjection';
import { buildForestGrid, pickTreeMarkers, type ForestGrid } from '@/geo/forestMarkers';
import { colors, mapColors, shadows } from '@/theme/tokens';
import type { AreaMap } from '@/types';
import { AreaMapLayers, HALO_MIN, TARGET_M_PER_PX } from './AreaMap';

/** Przybliżenie względem widoku startowego (~9 m/px): 1× = cała okolica, 6× ≈ 1,5 m/px. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;
/** Halo nie rośnie bez końca przy słabym GPS i dużym przybliżeniu. */
const HALO_MAX = 1000;
const HALO_BASE = 200;
const DOT = 24;
/** Komórka siatki lasu (piksele świata z13 ≈ 47 m) – do znaczników drzew. */
const GRID_CELL = 4;
const MARKER_SPACING_PX = 64;
const MARKER_MIN_DEPTH_PX = 12;
const ANIM = { duration: 280, easing: Easing.out(Easing.cubic) };

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

/** Stan widoku: przekształcenie ekranu startowego → bieżącego (q' = t + k·q, q względem środka). */
interface ViewState {
  k: number;
  tx: number;
  ty: number;
}

/** Przesunięcie w granicach danych: środek kadru nie wyjeżdża poza pobrany promień. */
function clampT(t: number, k: number, half: number, extent: number) {
  'worklet';
  const m = Math.max(0, extent * k - half);
  return Math.min(m, Math.max(-m, t));
}

/** Przybliżenie o `f` wokół punktu (fx, fy) ekranu (względem środka) – punkt pod palcem zostaje na miejscu. */
function zoomAt(v: ViewState, f: number, fx: number, fy: number, hw: number, hh: number, extent: number): ViewState {
  'worklet';
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * f));
  const r = k / v.k;
  return {
    k,
    tx: clampT(fx - r * (fx - v.tx), k, hw, extent),
    ty: clampT(fy - r * (fy - v.ty), k, hh, extent),
  };
}

export interface ZoomableAreaMapHandle {
  /** Powrót do widoku startowego: pozycja na środku, skala 1×. */
  recenter(): void;
  /** Przybliżenie (> 1) / oddalenie (< 1) względem środka ekranu. */
  zoomBy(factor: number): void;
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
  onViewChange?: (v: { zoom: number; atHome: boolean }) => void;
  ref?: Ref<ZoomableAreaMapHandle>;
}

/**
 * Mapa okolicy na pełny ekran: szczypanie, przesuwanie, podwójne tapnięcie (web: kółko myszy).
 *
 * Ostrość: w trakcie gestu przesuwamy i skalujemy gotowy obraz (transform na UI thread), a po geście
 * „zatwierdzamy” widok – ścieżki SVG liczone są od nowa dla nowej skali, więc wektory i grubości linii
 * są znów ostre. Żeby przy zatwierdzeniu nic nie mignęło, warstwy są dwie: zewnętrzna (animowana)
 * ma przekształcenie G widoku startowego → bieżącego, wewnętrzna (zwykły prop React) – odwrotność G
 * dla widoku, w którym narysowano SVG. Nowe ścieżki i nowa odwrotność trafiają na ekran w jednym
 * commicie Reacta, a G zmieniają tylko gesty – obraz w każdej klatce jest poprawny, a po zatwierdzeniu
 * złożenie warstw to tożsamość (ostre piksele). SVG ma zakładkę poza ekranem, żeby przesuwanie
 * nie odsłaniało od razu pustych brzegów; gdy zakładka się kończy, widok zatwierdzamy w trakcie gestu.
 */
export function ZoomableAreaMap({ map, position, accuracyM, width, height, forestLink, onViewChange, ref }: ZoomableAreaMapProps) {
  const hw = width / 2;
  const hh = height / 2;
  /** Piksele ekranu na piksel świata przy 1×. */
  const S = map.metersPerPx / TARGET_M_PER_PX;
  /** Promień danych w pikselach ekranu przy 1×. */
  const extent = map.radiusM / TARGET_M_PER_PX;
  /** Zakładka SVG poza ekranem (px) – kompromis: pamięć bitmapy vs. puste brzegi przy przesuwaniu. */
  const pad = Math.round(Math.min(160, Math.min(width, height) * 0.3));
  /** Pozycja względem środka widoku startowego (px przy 1×). */
  const qx = (position.x - map.center.x) * S;
  const qy = (position.y - map.center.y) * S;
  const home = useMemo<ViewState>(
    () => ({ k: 1, tx: clampT(-qx, 1, hw, extent), ty: clampT(-qy, 1, hh, extent) }),
    [qx, qy, hw, hh, extent],
  );

  const k = useSharedValue(home.k);
  const tx = useSharedValue(home.tx);
  const ty = useSharedValue(home.ty);
  // Widok, w którym narysowano SVG (kopia stanu Reacta dla UI thread) i „commit w drodze”.
  const rk = useSharedValue(home.k);
  const rtx = useSharedValue(home.tx);
  const rty = useSharedValue(home.ty);
  const pending = useSharedValue(false);
  const flinging = useSharedValue(0);

  // Zawsze nowy obiekt (efekt niżej zdejmuje „commit w drodze”); obliczenia zależą od liczb, nie od obiektu.
  const [view, setView] = useState<ViewState>(home);
  const commit = useCallback((nk: number, ntx: number, nty: number) => setView({ k: nk, tx: ntx, ty: nty }), []);
  useEffect(() => {
    rk.set(view.k);
    rtx.set(view.tx);
    rty.set(view.ty);
    pending.set(false);
  }, [view, rk, rtx, rty, pending]);

  const atHome = Math.abs(view.k - home.k) < 1e-3 && Math.abs(view.tx - home.tx) < 1 && Math.abs(view.ty - home.ty) < 1;
  const zoom = view.k;
  useEffect(() => {
    onViewChange?.({ zoom, atHome });
  }, [onViewChange, zoom, atHome]);

  const requestCommit = useCallback(() => {
    'worklet';
    scheduleOnRN(commit, k.get(), tx.get(), ty.get());
  }, [commit, k, tx, ty]);

  const animateTo = useCallback(
    (v: ViewState) => {
      'worklet';
      tx.set(withTiming(v.tx, ANIM));
      ty.set(withTiming(v.ty, ANIM));
      k.set(
        withTiming(v.k, ANIM, (finished) => {
          if (finished) requestCommit();
        }),
      );
    },
    [k, tx, ty, requestCommit],
  );

  useImperativeHandle(
    ref,
    () => ({
      recenter: () => animateTo(home),
      zoomBy: (f: number) => {
        stopAll(k, tx, ty);
        animateTo(zoomAt({ k: k.get(), tx: tx.get(), ty: ty.get() }, f, 0, 0, hw, hh, extent));
      },
    }),
    [animateTo, home, k, tx, ty, hw, hh, extent],
  );

  // Zatwierdzenie w trakcie gestu / animacji, gdy kończy się zakładka SVG albo skala mocno odjechała.
  useAnimatedReaction(
    () => ({ k: k.get(), x: tx.get(), y: ty.get() }),
    (cur) => {
      if (pending.get()) return;
      const ratio = cur.k / rk.get();
      const offX = cur.x - ratio * rtx.get();
      const offY = cur.y - ratio * rty.get();
      // Ile zakładki zostało z każdej strony ekranu (px).
      const mx = ratio * (hw + pad) - hw - Math.abs(offX);
      const my = ratio * (hh + pad) - hh - Math.abs(offY);
      if (Math.min(mx, my) > pad * 0.4 && ratio < 1.8) return;
      pending.set(true);
      scheduleOnRN(commit, cur.k, cur.x, cur.y);
    },
    [hw, hh, pad, commit],
  );

  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .onStart(() => {
        stopAll(k, tx, ty);
      })
      .onChange((e) => {
        const v = zoomAt({ k: k.get(), tx: tx.get(), ty: ty.get() }, e.scaleChange, e.focalX - hw, e.focalY - hh, hw, hh, extent);
        k.set(v.k);
        tx.set(v.tx);
        ty.set(v.ty);
      })
      .onEnd(() => {
        requestCommit();
      });
    const pan = Gesture.Pan()
      .averageTouches(true)
      .onStart(() => {
        stopAll(k, tx, ty);
      })
      .onChange((e) => {
        tx.set(clampT(tx.get() + e.changeX, k.get(), hw, extent));
        ty.set(clampT(ty.get() + e.changeY, k.get(), hh, extent));
      })
      .onEnd((e) => {
        // Bezwładność w granicach danych; zatwierdzenie, gdy obie osie staną.
        const mx = Math.max(0, extent * k.get() - hw);
        const my = Math.max(0, extent * k.get() - hh);
        flinging.set(2);
        const done = () => {
          'worklet';
          flinging.set(flinging.get() - 1);
          if (flinging.get() <= 0) requestCommit();
        };
        tx.set(withDecay({ velocity: e.velocityX, clamp: [-mx, mx] }, done));
        ty.set(withDecay({ velocity: e.velocityY, clamp: [-my, my] }, done));
      });
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDelay(260)
      .onEnd((e, success) => {
        if (!success) return;
        stopAll(k, tx, ty);
        const cur = { k: k.get(), tx: tx.get(), ty: ty.get() };
        // Na maksymalnym przybliżeniu podwójne tapnięcie wraca do całej okolicy.
        const f = cur.k >= MAX_ZOOM - 0.01 ? MIN_ZOOM / cur.k : 2;
        animateTo(zoomAt(cur, f, e.x - hw, e.y - hh, hw, hh, extent));
      });
    return Gesture.Simultaneous(pinch, pan, doubleTap);
  }, [k, tx, ty, flinging, hw, hh, extent, requestCommit, animateTo]);

  // Web: kółko myszy / szczypanie gładzika (ctrl + wheel) przybliża wokół kursora.
  const wheelRef = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = wheelRef.current as unknown as HTMLElement | null;
    if (!el?.addEventListener) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1;
      const f = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.002));
      stopAll(k, tx, ty);
      const v = zoomAt({ k: k.get(), tx: tx.get(), ty: ty.get() }, f, e.clientX - rect.left - hw, e.clientY - rect.top - hh, hw, hh, extent);
      k.set(v.k);
      tx.set(v.tx);
      ty.set(v.ty);
      clearTimeout(timer);
      timer = setTimeout(() => commit(k.get(), tx.get(), ty.get()), 160);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      clearTimeout(timer);
      el.removeEventListener('wheel', onWheel);
    };
  }, [k, tx, ty, hw, hh, height, extent, commit]);

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

  // ── Treść w zatwierdzonym widoku (płótno = ekran + zakładka) ──
  const cw = width + 2 * pad;
  const ch = height + 2 * pad;
  const { k: vk, tx: vtx, ty: vty } = view;
  const vp = useMemo(
    () => ({
      width: cw,
      height: ch,
      mPerPx: TARGET_M_PER_PX / vk,
      center: { x: map.center.x - vtx / (S * vk), y: map.center.y - vty / (S * vk) },
    }),
    [cw, ch, vk, vtx, vty, map, S],
  );
  const paths = useMemo(() => projectAreaMap(map, vp), [map, vp]);
  const markers = useMemo(
    () => (grid ? pickTreeMarkers(grid, S * vk, { spacingPx: MARKER_SPACING_PX, minDepthPx: MARKER_MIN_DEPTH_PX }) : []),
    [grid, S, vk],
  );
  const treePath = useMemo(() => {
    const t = viewportTransform(map, vp);
    let d = '';
    for (const m of markers) {
      const p = projectPoint(t, m);
      if (p.x < -10 || p.y < -10 || p.x > cw + 10 || p.y > ch + 10) continue;
      TREE.forEach(([dx, dy], i) => {
        d += `${i ? 'L' : 'M'}${Math.round((p.x + dx) * 10) / 10} ${Math.round((p.y + dy) * 10) / 10}`;
      });
      d += 'Z';
    }
    return d;
  }, [markers, map, vp, cw, ch]);
  const link = useMemo(() => {
    if (!forestLink) return null;
    const t = viewportTransform(map, vp);
    const r = (v: number) => Math.round(v * 10) / 10;
    const a = projectPoint(t, position);
    const b = projectPoint(t, forestLink);
    return { d: `M${r(a.x)} ${r(a.y)}L${r(b.x)} ${r(b.y)}`, b: { x: r(b.x), y: r(b.y) } };
  }, [forestLink, position, map, vp]);

  // Wewnętrzna warstwa: odwrotność przekształcenia widoku, w którym narysowano SVG.
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
          <Animated.View style={[StyleSheet.absoluteFill, contentStyle]}>
            <View style={[{ position: 'absolute', left: -pad, top: -pad, width: cw, height: ch }, compensate]}>
              <MapCanvas width={cw} height={ch} paths={paths} treePath={treePath} link={link} />
            </View>
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
}

function stopAll(k: SharedValue<number>, tx: SharedValue<number>, ty: SharedValue<number>) {
  'worklet';
  cancelAnimation(k);
  cancelAnimation(tx);
  cancelAnimation(ty);
}

interface MapCanvasProps {
  width: number;
  height: number;
  paths: ReturnType<typeof projectAreaMap>;
  treePath: string;
  link: { d: string; b: XY } | null;
}

/** SVG w zatwierdzonym widoku – przerysowywane tylko po zatwierdzeniu, nie w trakcie gestu. */
const MapCanvas = memo(function MapCanvas({ width, height, paths, treePath, link }: MapCanvasProps) {
  return (
    <Svg width={width} height={height}>
      <AreaMapLayers paths={paths} rich>
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
