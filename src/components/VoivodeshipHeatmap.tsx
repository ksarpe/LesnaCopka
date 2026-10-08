import { router } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { gminaIndex } from '@/geo';
import {
  clampZoom,
  homeZoom,
  interpolateZoom,
  isZoomed,
  pickShape,
  placeLabels,
  textWidth,
  toMap,
  viewBoxOf,
  visibleBox,
  zoomAt,
  zoomToBox,
  type Box,
  type LabelCandidate,
  type MapViewport,
  type Zoom,
} from '@/geo/mapView';
import { detailPath, voivodeshipShapes, type GminaShape, type ShapesMap } from '@/geo/voivodeships';
import { colors, heat as heatColors, shadows } from '@/theme/tokens';
import { fmtMushroomers } from '@/utils/format';
import { Card } from './Card';
import { IconButton } from './IconButton';
import { Txt } from './Txt';

const PAD = 16;
const MAX_H = 300;
const MAX_ZOOM = 10;
/** Od tej skali obrysy przybliżonego fragmentu są dokładniejsze (mniejsza tolerancja upraszczania). */
const DETAIL_ZOOM = 1.6;
/** Od tej skali pokazujemy nazwy gmin. */
const LABEL_ZOOM = 1.8;
/** Najmniejsza gmina z etykietą – pole na ekranie (px²). */
const LABEL_MIN_AREA = 1200;
const LABEL_SIZE = 10;
const LABEL_H = 16;
const LABEL_PAD_X = 5;
/** Szerokość pudełka centrującego etykietę (szersze niż każda nazwa – bez łamania). */
const LABEL_BOX = 220;
const TIP_H = 31;
const BTN = 36;
const BTN_INSET = 8;
/** Pudło palcem do tylu px ekranu od granicy → najbliższa gmina. */
const TAP_SLOP = 28;

interface VoivodeshipHeatmapProps {
  voivodeship: string;
  /** Stopnie 0–4 dla gmin (z rankingu). */
  heat?: Record<string, number>;
  mushroomers?: Record<string, number>;
  /** Tekst podpowiedzi po nazwie gminy (np. „12 okazów” na mapie gatunku) – zamiast liczby grzybiarzy. */
  tips?: Record<string, string>;
  /** Gmina gracza (zaznaczona na starcie). */
  mineId: string | null;
  /** Zaznaczona na starcie, gdy gracz nie ma gminy w tym województwie (np. lider rankingu). */
  defaultId?: string;
  loading: boolean;
}

/** Ile zbudowanych map (województwo × szerokość) trzymamy w pamięci. */
const SHAPES_CACHE_MAX = 6;

/**
 * Zbudowane kontury (setki ścieżek SVG – mazowieckie to kilkadziesiąt ms w V8, kilkaset w Hermesie) wg województwa
 * i szerokości: ponowne wejście na ekran Gminy / kartę gatunku rysuje mapę od razu, bez liczenia na wątku JS.
 * Mały LRU (kolejność Map = kolejność użycia); odrzucona obietnica wypada z pamięci, żeby dało się spróbować znowu.
 */
const shapesCache = new Map<string, { promise: Promise<ShapesMap>; map?: ShapesMap }>();

const shapesKey = (voivodeship: string, width: number) => `${voivodeship}:${width}`;

function loadShapes(voivodeship: string, width: number): Promise<ShapesMap> {
  const key = shapesKey(voivodeship, width);
  const hit = shapesCache.get(key);
  if (hit) {
    shapesCache.delete(key);
    shapesCache.set(key, hit);
    return hit.promise;
  }
  const entry: { promise: Promise<ShapesMap>; map?: ShapesMap } = {
    promise: gminaIndex()
      .then((index) => voivodeshipShapes(index, voivodeship, width, Math.min(MAX_H, width)))
      .then((map) => {
        entry.map = map;
        return map;
      }),
  };
  entry.promise.catch(() => {
    if (shapesCache.get(key) === entry) shapesCache.delete(key);
  });
  shapesCache.set(key, entry);
  while (shapesCache.size > SHAPES_CACHE_MAX) shapesCache.delete(shapesCache.keys().next().value!);
  return entry.promise;
}

/** Kontury województwa dla szerokości `width` – z pamięci od razu (bez klatki ładowania), inaczej po zbudowaniu. */
function useVoivodeshipShapes(voivodeship: string, width: number): { map: ShapesMap | null; error: boolean } {
  const key = width > 0 ? shapesKey(voivodeship, width) : null;
  const ready = key ? (shapesCache.get(key)?.map ?? null) : null;
  const [loaded, setLoaded] = useState<{ key: string; map: ShapesMap | null; error: boolean } | null>(null);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    loadShapes(voivodeship, width).then(
      (map) => alive && setLoaded({ key, map, error: false }),
      () => alive && setLoaded({ key, map: null, error: true }),
    );
    return () => {
      alive = false;
    };
  }, [key, voivodeship, width]);
  const mine = loaded?.key === key ? loaded : null;
  return { map: ready ?? mine?.map ?? null, error: !ready && !!mine?.error };
}

/**
 * Mapa cieplna województwa: prawdziwe kontury gmin z PRG (offline) w kolorach heatmapy.
 * Tapnięcie gminy → płynne przybliżenie na nią + podpowiedź; w przybliżeniu tapnięcie innej gminy
 * przesuwa widok, a zaznaczonej / podpowiedzi → szczegóły gminy. Szczypanie, przeciąganie
 * (tylko po przybliżeniu – inaczej przewija się ekran), podwójne tapnięcie, kółko myszy (web)
 * i „Pełny widok”. Po przybliżeniu nazwy gmin. Memo – rodzic (ranking, karta gatunku) przerysowuje się częściej.
 */
export const VoivodeshipHeatmap = memo(function VoivodeshipHeatmap({
  voivodeship,
  heat,
  mushroomers,
  tips,
  mineId,
  defaultId,
  loading,
}: VoivodeshipHeatmapProps) {
  const [inner, setInner] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const shapes = useVoivodeshipShapes(voivodeship, inner);
  const map = shapes.map;
  // Pierwsza z kandydatek, która leży na mapie (gmina gracza może być w innym województwie).
  const selectedId = useMemo(
    () => (map ? ([picked, mineId, defaultId].find((id) => id && map.gminy.some((g) => g.id === id)) ?? null) : null),
    [map, picked, mineId, defaultId],
  );

  return (
    <Card radius={26} padding={PAD} gap={12} style={{ position: 'relative' }}>
      <View onLayout={(e) => setInner(Math.round(e.nativeEvent.layout.width))}>
        {map && map.width > 0 && inner > 0 ? (
          <ZoomMap
            // Nowe województwo / szerokość = nowa mapa i pełny widok.
            key={`${voivodeship}:${inner}:${map.width}x${map.height}`}
            map={map}
            width={inner}
            heat={heat}
            mushroomers={mushroomers}
            tips={tips}
            loading={loading}
            selectedId={selectedId}
            onSelect={setPicked}
          />
        ) : (
          <View
            style={{
              width: '100%',
              height: Math.round((inner || 300) * 0.8),
              borderRadius: 18,
              backgroundColor: colors.chip,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {shapes.error ? (
              <Txt f="mono" size={11} color={colors.muted}>
                mapa niedostępna
              </Txt>
            ) : null}
          </View>
        )}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
        <Txt f="n7" size={12} color={colors.muted}>
          mniej
        </Txt>
        <View style={{ flexDirection: 'row', gap: 3 }}>
          {heatColors.map((c) => (
            <View key={c} style={{ width: 14, height: 14, borderRadius: 5, backgroundColor: c }} />
          ))}
        </View>
        <Txt f="n7" size={12} color={colors.muted}>
          więcej zbiorów
        </Txt>
      </View>
    </Card>
  );
});

/** Obraz mapy zatwierdzony w SVG: widok i dokładniejsze obrysy widocznych gmin. */
interface Frame {
  z: Zoom;
  detail: Map<string, string> | null;
}

/** Elementy minimalne interfejsu `HTMLElement` potrzebne do kółka myszy (web) – bez zależności od lib DOM. */
interface WheelTarget {
  addEventListener(type: 'wheel', fn: (e: WheelLike) => void, opts: { passive: boolean }): void;
  removeEventListener(type: 'wheel', fn: (e: WheelLike) => void): void;
  getBoundingClientRect(): { left: number; top: number };
}
interface WheelLike {
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  clientX: number;
  clientY: number;
  preventDefault(): void;
}

/** Pozycja podpowiedzi (px okna mapy) względem kotwicy gminy – jak w makiecie: nad punktem, przy górnej krawędzi pod nim. */
function tipLeft(ax: number, tipW: number, vw: number) {
  'worklet';
  return Math.max(8 - PAD, Math.min(ax - 40, vw + PAD - tipW - 8));
}
function tipTop(ay: number) {
  'worklet';
  return ay - 46 < 4 - PAD ? ay + 14 : ay - 46;
}

interface ZoomMapProps {
  map: ShapesMap;
  width: number;
  heat?: Record<string, number>;
  mushroomers?: Record<string, number>;
  tips?: Record<string, string>;
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Przybliżanie bez rozmycia: w trakcie gestu / animacji skalujemy widok (transform, tani), a po
 * zakończeniu widok trafia do viewBox SVG – wektory rysują się ostro. Żeby podmiana viewBox i zerowanie
 * transformu nie mignęły (React i wątek UI nie są zsynchronizowane), są dwa obrazy: nowy viewBox
 * dostaje ukryty, a widoczność przełączamy, gdy już się narysował. Oba śledzą widok na żywo.
 */
function ZoomMap({ map, width, heat, mushroomers, tips, loading, selectedId, onSelect }: ZoomMapProps) {
  const vp = useMemo<MapViewport>(
    () => ({ w: width, h: map.height, content: [0, 0, map.width, map.height], maxS: MAX_ZOOM }),
    [width, map.width, map.height],
  );
  const home = useMemo(() => homeZoom(vp), [vp]);
  const byId = useMemo(() => new Map(map.gminy.map((g) => [g.id, g])), [map]);
  const sel = selectedId ? byId.get(selectedId) : undefined;

  /* Widok na żywo (wątek UI): gesty i animacje piszą tylko tutaj. */
  const cur = useSharedValue<Zoom>(home);
  const animFrom = useSharedValue<Zoom>(home);
  const animTo = useSharedValue<Zoom>(home);
  const prog = useSharedValue(1);
  const animating = useSharedValue(false);
  const pinching = useSharedValue(false);
  const panning = useSharedValue(false);
  const pinchStart = useSharedValue<Zoom>(home);
  const pinchFocal = useSharedValue({ x: 0, y: 0 });
  const panStart = useSharedValue<Zoom>(home);
  const panOrigin = useSharedValue({ x: 0, y: 0 });
  const panRebase = useSharedValue(false);
  const fling = useSharedValue({ x: 0, y: 0 });

  /* Zatwierdzony widok (React): etykiety, przycisk „Pełny widok”, przeciąganie. */
  const [committed, setCommitted] = useState<Zoom>(home);
  const [zoomedUi, setZoomedUi] = useState(false);
  const [tipW, setTipW] = useState(170);

  /* Dwa obrazy SVG (drugi montowany chwilę po pierwszym). */
  const [frames, setFrames] = useState<Frame[]>(() => [{ z: home, detail: null }]);
  /**
   * Warstwa bazowa: całe województwo w pełnym widoku, zawsze pod spodem. Przybliżony obraz SVG ma tylko
   * swój fragment – przy oddalaniu (przycisk, szczypanie) wokół niego byłoby pusto.
   */
  const baseFrame = useMemo<Frame>(() => ({ z: home, detail: null }), [home]);
  const homeZ = useSharedValue<Zoom>(home);
  useEffect(() => {
    homeZ.set(home);
  }, [home, homeZ]);
  const frameZ0 = useSharedValue<Zoom>(home);
  const frameZ1 = useSharedValue<Zoom>(home);
  const shown = useSharedValue(0);
  const shownRef = useRef(0);
  const framesCount = useRef(1);
  const commitToken = useRef(0);
  const pendingSwap = useRef<{ token: number; target: number; z: Zoom; delay: number } | null>(null);
  const [swapTick, setSwapTick] = useState(0);
  const detailCache = useRef(new Map<string, string>());

  useEffect(() => {
    const t = setTimeout(() => {
      framesCount.current = 2;
      setFrames((prev) => (prev.length < 2 ? [...prev, { z: prev[0].z, detail: null }] : prev));
    }, 700);
    return () => clearTimeout(t);
  }, []);

  /** Dokładniejsze obrysy gmin w (poszerzonym) widocznym fragmencie – tolerancja wg poziomu przybliżenia. */
  const detailFor = useCallback(
    (z: Zoom): Map<string, string> | null => {
      if (z.s < DETAIL_ZOOM) return null;
      const level = Math.max(1, Math.ceil(Math.log2(z.s)));
      const tol = 0.6 / 2 ** level;
      const v = visibleBox(z, vp);
      const mx = (v[2] - v[0]) * 0.4;
      const my = (v[3] - v[1]) * 0.4;
      const out = new Map<string, string>();
      for (const g of map.gminy) {
        if (g.bbox[2] < v[0] - mx || g.bbox[0] > v[2] + mx || g.bbox[3] < v[1] - my || g.bbox[1] > v[3] + my) continue;
        const key = `${g.id}@${level}`;
        let d = detailCache.current.get(key);
        if (d == null) {
          d = detailPath(g, map.proj, tol);
          detailCache.current.set(key, d);
        }
        out.set(g.id, d);
      }
      return out;
    },
    [map, vp],
  );

  /** Koniec gestu / animacji: widok do ukrytego obrazu SVG, przełączenie po jego narysowaniu. */
  const commit = useCallback(
    (z: Zoom) => {
      const token = ++commitToken.current;
      const target = 1 - shownRef.current;
      const delay = framesCount.current < 2 ? 400 : 120;
      framesCount.current = 2;
      const frame: Frame = { z, detail: detailFor(z) };
      setFrames((prev) => {
        const next = prev.slice();
        next[target] = frame;
        return next;
      });
      setCommitted(z);
      setZoomedUi(isZoomed(z));
      pendingSwap.current = { token, target, z, delay };
      setSwapTick(token);
    },
    [detailFor],
  );

  useEffect(() => {
    const p = pendingSwap.current;
    if (!p || p.token !== swapTick) return;
    const t = setTimeout(() => {
      if (commitToken.current !== p.token) return;
      (p.target ? frameZ1 : frameZ0).set(p.z);
      shown.set(p.target);
      shownRef.current = p.target;
      pendingSwap.current = null;
    }, p.delay);
    return () => clearTimeout(t);
  }, [swapTick, frameZ0, frameZ1, shown]);

  /** Płynne przejście do widoku `to` (ease-out), na końcu zatwierdzenie. */
  const startAnim = useCallback(
    (to: Zoom, duration: number) => {
      'worklet';
      animFrom.set(cur.get());
      animTo.set(to);
      animating.set(true);
      prog.set(0);
      prog.set(
        withTiming(1, { duration, easing: Easing.out(Easing.cubic) }, (finished) => {
          if (!finished) return;
          // Ostatnia klatka wprost: reakcja na `prog` nie zobaczy p = 1 po wyłączeniu `animating`,
          // a przy przeskoczonej animacji (zablokowany wątek / karta w tle) widok zostałby na starcie.
          cur.set(to);
          animating.set(false);
          scheduleOnRN(commit, to);
        }),
      );
    },
    [animFrom, animTo, animating, prog, cur, commit],
  );

  useAnimatedReaction(
    () => prog.get(),
    (p) => {
      if (animating.get()) cur.set(clampZoom(interpolateZoom(animFrom.get(), animTo.get(), p, vp), vp));
    },
    [vp],
  );

  const animateTo = useCallback(
    (to: Zoom, duration: number) => {
      setZoomedUi(isZoomed(to));
      scheduleOnUI(startAnim, to, duration);
    },
    [startAnim],
  );

  const selRef = useRef<string | null>(selectedId);
  useEffect(() => {
    selRef.current = selectedId;
  }, [selectedId]);

  /** Tapnięcie (px mapy, bieżąca skala): pudło → najbliższa gmina; zaznaczona w przybliżeniu → szczegóły. */
  const handleTap = useCallback(
    (x: number, y: number, s: number) => {
      const id = pickShape(map.gminy, x, y, TAP_SLOP / s);
      const g = id ? byId.get(id) : undefined;
      if (!g) return;
      const zoomedNow = s > 1.01;
      if (zoomedNow && g.id === selRef.current) {
        router.push(`/gminy/${g.id}`);
        return;
      }
      onSelect(g.id);
      animateTo(zoomToBox(g.bbox, vp, { current: zoomedNow ? s : undefined }), zoomedNow ? 380 : 420);
    },
    [map, byId, vp, onSelect, animateTo],
  );

  // Callbacki gestów działają na wątku UI po dotknięciu (nigdy w renderze) – refy czytają tylko commit / handleTap.
  /* eslint-disable react-hooks/refs */
  const gesture = useMemo(() => {
    const stopAnim = () => {
      'worklet';
      if (!animating.get()) return;
      animating.set(false);
      cancelAnimation(prog);
    };
    // Koniec ostatniego z gestów (szczypanie / przeciąganie): powrót do 1×, rzut albo zatwierdzenie.
    const finish = () => {
      'worklet';
      if (pinching.get() || panning.get()) return;
      const z = cur.get();
      if (z.s < 1.05) {
        startAnim(home, 260);
        return;
      }
      const v = fling.get();
      if (Math.hypot(v.x, v.y) > 250) {
        startAnim(clampZoom({ s: z.s, tx: z.tx + v.x * 0.14, ty: z.ty + v.y * 0.14 }, vp), 320);
        return;
      }
      scheduleOnRN(commit, z);
    };

    const pinch = Gesture.Pinch()
      .onStart((e) => {
        stopAnim();
        pinching.set(true);
        pinchStart.set(cur.get());
        pinchFocal.set({ x: e.focalX, y: e.focalY });
      })
      .onUpdate((e) => {
        const z0 = pinchStart.get();
        const s = Math.min(MAX_ZOOM, Math.max(1, z0.s * e.scale));
        const px = (pinchFocal.get().x - z0.tx) / z0.s;
        const py = (pinchFocal.get().y - z0.ty) / z0.s;
        cur.set(clampZoom({ s, tx: e.focalX - s * px, ty: e.focalY - s * py }, vp));
      })
      .onFinalize(() => {
        if (!pinching.get()) return;
        pinching.set(false);
        panRebase.set(true);
        fling.set({ x: 0, y: 0 });
        finish();
      });

    const pan = Gesture.Pan()
      .enabled(zoomedUi)
      .minDistance(5)
      .averageTouches(true)
      .onStart((e) => {
        stopAnim();
        panning.set(true);
        panStart.set(cur.get());
        panOrigin.set({ x: e.translationX, y: e.translationY });
        panRebase.set(false);
        fling.set({ x: 0, y: 0 });
      })
      .onUpdate((e) => {
        if (pinching.get()) {
          panRebase.set(true);
          return;
        }
        if (panRebase.get()) {
          panRebase.set(false);
          panStart.set(cur.get());
          panOrigin.set({ x: e.translationX, y: e.translationY });
        }
        const z0 = panStart.get();
        const o = panOrigin.get();
        cur.set(clampZoom({ s: z0.s, tx: z0.tx + e.translationX - o.x, ty: z0.ty + e.translationY - o.y }, vp));
      })
      .onEnd((e) => {
        fling.set(pinching.get() ? { x: 0, y: 0 } : { x: e.velocityX, y: e.velocityY });
      })
      .onFinalize(() => {
        if (!panning.get()) return;
        panning.set(false);
        finish();
      });

    const tap = Gesture.Tap()
      .maxDuration(400)
      .maxDistance(10)
      .onEnd((e, success) => {
        if (!success) return;
        const z = cur.get();
        const p = toMap(z, e.x, e.y);
        scheduleOnRN(handleTap, p.x, p.y, z.s);
      });

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDelay(250)
      .maxDistance(16)
      .onEnd((e, success) => {
        if (!success) return;
        startAnim(zoomAt(cur.get(), 2, e.x, e.y, vp), 320);
      });

    return Gesture.Race(Gesture.Simultaneous(pinch, pan), Gesture.Exclusive(doubleTap, tap));
  }, [
    zoomedUi,
    vp,
    home,
    startAnim,
    commit,
    handleTap,
    animating,
    prog,
    pinching,
    panning,
    cur,
    fling,
    pinchStart,
    pinchFocal,
    panStart,
    panOrigin,
    panRebase,
  ]);
  /* eslint-enable react-hooks/refs */

  /* Kółko myszy (web): przybliża z ctrl/⌘ (i gest szczypania na touchpadzie) albo gdy mapa jest już
     przybliżona; przy pełnym widoku zwykłe kółko przewija ekran. */
  const wheelRef = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = wheelRef.current as unknown as WheelTarget | null;
    if (!el?.addEventListener) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (ev: WheelLike) => {
      const z = cur.get();
      if (!(ev.ctrlKey || ev.metaKey || isZoomed(z))) return;
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      const dy = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
      const next = zoomAt(z, Math.exp(-dy * (ev.ctrlKey ? 0.01 : 0.0025)), ev.clientX - r.left, ev.clientY - r.top, vp);
      if (animating.get()) {
        animating.set(false);
        cancelAnimation(prog);
      }
      cur.set(next);
      clearTimeout(timer);
      timer = setTimeout(() => commit(next), 160);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      clearTimeout(timer);
    };
  }, [cur, animating, prog, vp, commit]);

  const showTip = !!sel && !loading;

  /** Etykiety dla zatwierdzonego widoku: duże i widoczne gminy, bez kolizji (podpowiedź i przycisk mają pierwszeństwo). */
  const labels = useMemo(() => {
    const z = committed;
    if (z.s < LABEL_ZOOM) return [];
    const reserved: Box[] = [[vp.w - BTN_INSET - BTN, BTN_INSET, vp.w - BTN_INSET, BTN_INSET + BTN]];
    if (sel) {
      const ax = z.s * sel.anchor.x + z.tx;
      const ay = z.s * sel.anchor.y + z.ty;
      reserved.push([ax - 6, ay - 6, ax + 6, ay + 6]);
      if (showTip) {
        const left = tipLeft(ax, tipW, vp.w);
        const top = tipTop(ay);
        reserved.push([left, top, left + tipW, top + TIP_H]);
      }
    }
    const cands: (LabelCandidate & { g: GminaShape; dy: number })[] = [];
    for (const g of map.gminy) {
      const isSel = g.id === sel?.id;
      // Zaznaczona gmina ma nazwę w podpowiedzi; bez podpowiedzi (ładowanie) – wyróżniona etykieta pod punktem.
      if (isSel && showTip) continue;
      const onScreen = g.area * z.s * z.s;
      if (!isSel && onScreen < LABEL_MIN_AREA) continue;
      const x = z.s * g.anchor.x + z.tx;
      const y = z.s * g.anchor.y + z.ty;
      if (x < 0 || x > vp.w || y < 0 || y > vp.h) continue;
      const dy = isSel ? 14 : 0;
      cands.push({
        id: g.id,
        x,
        y: y + dy,
        w: textWidth(g.name, LABEL_SIZE) + 2 * LABEL_PAD_X,
        h: LABEL_H,
        priority: onScreen,
        force: isSel,
        g,
        dy,
      });
    }
    const byCand = new Map(cands.map((c) => [c.id, c]));
    return placeLabels(cands, [2, 2, vp.w - 2, vp.h - 2], reserved).map((p) => byCand.get(p.id)!);
  }, [committed, map, sel, showTip, tipW, vp]);

  const ax0 = sel?.anchor.x ?? 0;
  const ay0 = sel?.anchor.y ?? 0;
  const tipStyle = useAnimatedStyle(() => {
    const z = cur.get();
    const ax = z.s * ax0 + z.tx;
    const ay = z.s * ay0 + z.ty;
    // Gmina poza oknem (przesunięta mapa) – podpowiedź znika (odsunięta, żeby nie łapała dotyku).
    const inside = ax > -2 && ax < vp.w + 2 && ay > -2 && ay < vp.h + 2;
    return { transform: [{ translateX: tipLeft(ax, tipW, vp.w) }, { translateY: inside ? tipTop(ay) : -10000 }] };
  }, [ax0, ay0, tipW, vp]);

  return (
    <>
      <View
        ref={wheelRef}
        accessibilityLabel="Mapa gmin – stuknij gminę, aby ją przybliżyć"
        style={{ width: vp.w, height: vp.h, borderRadius: 16, overflow: 'hidden' }}
      >
        {/* Web (dotyk): przy pełnym widoku pionowy gest przewija stronę, po przybliżeniu przesuwa mapę. */}
        <GestureDetector gesture={gesture} touchAction={zoomedUi ? 'none' : 'pan-y'}>
          <View style={StyleSheet.absoluteFill} collapsable={false}>
            <FrameView
              index={-1}
              frame={baseFrame}
              frameZ={homeZ}
              shown={shown}
              cur={cur}
              vp={vp}
              map={map}
              heat={heat}
              loading={loading}
            />
            {frames.map((f, i) => (
              <FrameView
                key={i}
                index={i}
                frame={f}
                frameZ={i ? frameZ1 : frameZ0}
                shown={shown}
                cur={cur}
                vp={vp}
                map={map}
                heat={heat}
                loading={loading}
                sel={sel}
              />
            ))}
            <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
              {labels.map((l) => (
                <MapLabel
                  key={l.id}
                  name={l.g.name}
                  ax={l.g.anchor.x}
                  ay={l.g.anchor.y}
                  dy={l.dy}
                  cs={committed.s}
                  cur={cur}
                  strong={!!l.force}
                />
              ))}
            </View>
          </View>
        </GestureDetector>
      </View>
      {sel && showTip ? (
        <Animated.View
          key={sel.id}
          entering={FadeIn.duration(150)}
          onLayout={(e) => setTipW(Math.round(e.nativeEvent.layout.width))}
          style={[
            {
              position: 'absolute',
              left: 0,
              top: 0,
              backgroundColor: colors.ink,
              borderRadius: 14,
              paddingVertical: 7,
              paddingHorizontal: 11,
              boxShadow: shadows.tooltip,
              zIndex: 5,
            },
            tipStyle,
          ]}
        >
          <Pressable onPress={() => router.push(`/gminy/${sel.id}`)}>
            <Txt f="n8" size={12} color={colors.bg}>
              {sel.name}
              {tips
                ? tips[sel.id]
                  ? ` · ${tips[sel.id]}`
                  : ''
                : mushroomers?.[sel.id] != null
                  ? ` · ${fmtMushroomers(mushroomers[sel.id])}`
                  : ''}
            </Txt>
          </Pressable>
        </Animated.View>
      ) : null}
      {zoomedUi ? (
        <Animated.View
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(140)}
          style={{ position: 'absolute', top: BTN_INSET, right: BTN_INSET, zIndex: 6 }}
        >
          <IconButton icon="zoom_out_map" size={BTN} iconSize={20} accessibilityLabel="Pełny widok" onPress={() => animateTo(home, 400)} />
        </Animated.View>
      ) : null}
    </>
  );
}

/**
 * Jeden obraz mapy: SVG z viewBox zatwierdzonego widoku + transform, który dopasowuje go do widoku
 * na żywo (k = s_na_żywo / s_obrazu). Grubości linii dzielone przez skalę – stałe na ekranie.
 */
const FrameView = memo(function FrameView({
  index,
  frame,
  frameZ,
  shown,
  cur,
  vp,
  map,
  heat,
  loading,
  sel,
}: {
  index: number;
  frame: Frame;
  frameZ: SharedValue<Zoom>;
  shown: SharedValue<number>;
  cur: SharedValue<Zoom>;
  vp: MapViewport;
  map: ShapesMap;
  heat?: Record<string, number>;
  loading: boolean;
  sel?: GminaShape;
}) {
  const style = useAnimatedStyle(() => {
    const c = frameZ.get();
    const z = cur.get();
    const k = z.s / c.s;
    return {
      // index < 0 – warstwa bazowa, widoczna zawsze.
      opacity: index < 0 || shown.get() === index ? 1 : 0,
      transform: [
        { translateX: z.tx - k * c.tx - ((1 - k) * vp.w) / 2 },
        { translateY: z.ty - k * c.ty - ((1 - k) * vp.h) / 2 },
        { scale: k },
      ],
    };
  }, [index, vp]);
  // Obrys i kropka zaznaczenia skalowane transformem puchną (×6 przy przybliżeniu) – wygaszamy je,
  // gdy widok odbiega od zatwierdzonego, i pokazujemy ostre po zakończeniu przejścia (jak nazwy gmin).
  const selStyle = useAnimatedStyle(() => {
    const drift = Math.abs(Math.log(cur.get().s / frameZ.get().s));
    return { opacity: Math.min(1, Math.max(0, 1 - (drift - 0.05) * 5)) };
  });
  const s = frame.z.s;
  const border = s > 1.5 ? 1.2 : 0.8;
  const viewBox = viewBoxOf(frame.z, vp);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }, style]}>
      <Svg width={vp.w} height={vp.h} viewBox={viewBox} preserveAspectRatio="none">
        <G stroke={colors.white} strokeWidth={border / s} strokeLinejoin="round">
          <Layer gminy={map.gminy} heat={heat} loading={loading} detail={frame.detail} />
        </G>
      </Svg>
      {sel ? (
        <Animated.View style={[StyleSheet.absoluteFill, selStyle]}>
          <Svg width={vp.w} height={vp.h} viewBox={viewBox} preserveAspectRatio="none">
            <Path
              d={frame.detail?.get(sel.id) ?? sel.d}
              fill="none"
              fillRule="evenodd"
              stroke={colors.ink}
              strokeWidth={2 / s}
              strokeLinejoin="round"
            />
            <Circle cx={sel.anchor.x} cy={sel.anchor.y} r={4 / s} fill={colors.ink} stroke={colors.white} strokeWidth={2 / s} />
          </Svg>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
});

/** Wszystkie gminy (setki ścieżek) – memoizowane: zmiana zaznaczenia ani gest ich nie przerysowuje. */
const Layer = memo(function Layer({
  gminy,
  heat,
  loading,
  detail,
}: {
  gminy: GminaShape[];
  heat?: Record<string, number>;
  loading: boolean;
  detail: Map<string, string> | null;
}) {
  return (
    <>
      {gminy.map((g) => (
        <GminaPath
          key={g.id}
          d={detail?.get(g.id) ?? g.d}
          fill={loading ? colors.chip : heatColors[Math.max(0, Math.min(4, heat?.[g.id] ?? 0))]}
        />
      ))}
    </>
  );
});

const GminaPath = memo(function GminaPath({ d, fill }: { d: string; fill: string }) {
  return <Path d={d} fill={fill} fillRule="evenodd" />;
});

/** Nazwa gminy: stały rozmiar niezależnie od skali, pozycja za widokiem na żywo, znika przy dużej zmianie skali. */
const MapLabel = memo(function MapLabel({
  name,
  ax,
  ay,
  dy,
  cs,
  cur,
  strong,
}: {
  name: string;
  ax: number;
  ay: number;
  dy: number;
  /** Skala, dla której etykiety rozmieszczono. */
  cs: number;
  cur: SharedValue<Zoom>;
  strong: boolean;
}) {
  const style = useAnimatedStyle(() => {
    const z = cur.get();
    const drift = Math.abs(Math.log2(z.s / cs));
    return {
      opacity: Math.min(1, Math.max(0, 1 - (drift - 0.12) * 3)),
      transform: [{ translateX: z.s * ax + z.tx - LABEL_BOX / 2 }, { translateY: z.s * ay + z.ty + dy - LABEL_H / 2 }],
    };
  }, [ax, ay, dy, cs]);
  return (
    <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: LABEL_BOX, height: LABEL_H, alignItems: 'center' }, style]}>
      <Animated.View
        entering={FadeIn.duration(220)}
        style={{
          height: LABEL_H,
          justifyContent: 'center',
          paddingHorizontal: LABEL_PAD_X,
          borderRadius: 8,
          backgroundColor: strong ? colors.ink : 'rgba(255,255,255,0.86)',
        }}
      >
        <Txt f="n8" size={LABEL_SIZE} lh={14} numberOfLines={1} color={strong ? colors.bg : colors.ink}>
          {name}
        </Txt>
      </Animated.View>
    </Animated.View>
  );
});
