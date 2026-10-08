/**
 * Skan 3D na ekranie skanu: czujniki ruchu (expo-sensors DeviceMotion, ~15 Hz) → postęp obchodzenia (./orbit.ts)
 * → seria ujęć w czasie obchodzenia (bok w każdym sektorze, z góry, przy ziemi). Gdy obejście jest kompletne,
 * `onDone` – ekran woła `finish()`, dostaje ujęcia i rozpoznaje grzyba.
 *
 * Bez czujników (web, brak żyroskopu) `available = false` – ekran wraca do zwykłego skanu jednym zdjęciem.
 * Narzędzia dev (`source: 'sim'`): obchodzenie symulowane (src/dev/simOrbit.ts), bez zdjęć.
 *
 * Pliki ujęć należą do hooka, dopóki nie odda ich `finish()` (potem sprząta je ekran albo znalezisko); `reset()`
 * i zamknięcie ekranu kasują nieoddane. Po `finish()` hook stoi (nie liczy próbek, nie robi zdjęć) aż do `reset()`
 * – ekran woła go przy powrocie do celowania.
 */
import { DeviceMotion } from 'expo-sensors';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { simOrbitDirection } from '@/dev/simOrbit';
import { deleteFindPhoto, deleteScanViews } from '@/services/live/findPhotos';
import type { ScanView } from '@/types';

import {
  initialOrbit,
  ORBIT,
  orbitCoverage,
  orbitHint,
  orbitStep,
  relativeAz,
  rotationFor,
  slotKey,
  viewSlot,
  type OrbitCoverage,
  type OrbitHint,
  type OrbitSample,
  type OrbitState,
} from './orbit';

/** Co ile ms próbka czujników. */
const SAMPLE_MS = 66;
/** Po nieudanym ujęciu chwila przerwy, zanim aparat spróbuje znowu. */
const RETRY_MS = 800;

const NATIVE = Platform.OS !== 'web';

function haptic(kind: 'tick' | 'step' | 'done') {
  if (!NATIVE) return;
  const p =
    kind === 'tick'
      ? Haptics.selectionAsync()
      : kind === 'step'
        ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  p.catch(() => {});
}

/** Rodzaj ujęcia z elewacji aparatu (ostatnie ujęcie „Analizuj teraz”). */
function kindForEl(el: number): ScanView['kind'] {
  return el <= ORBIT.topEl ? 'top' : el >= ORBIT.lowEl ? 'low' : 'side';
}

export interface OrbitScanOptions {
  /** Śledzenie teraz: aparat gotowy, podgląd na ekranie, nic się nie analizuje. */
  active: boolean;
  source: 'device' | 'sim';
  /** Ujęcie skanu z aparatu (null – bez zdjęć, np. symulacja). */
  capture: (() => Promise<string | undefined>) | null;
  /** Obejście kompletne (raz na skan). */
  onDone: () => void;
}

export interface OrbitScan {
  /** null = sprawdzam czujniki, false = brak (zwykły skan jednym zdjęciem). */
  available: boolean | null;
  /** 0..1 – grzybek w rogu. */
  progress: SharedValue<number>;
  /** Pozycja na pierścieniu: azymut względem startu (°), NaN przed startem. */
  heading: SharedValue<number>;
  coverage: OrbitCoverage;
  hint: OrbitHint;
  /** Ile ujęć już jest. */
  viewCount: number;
  /** Koniec skanu: czeka na ujęcie w toku (bez ujęć – robi jedno), oddaje ujęcia i staje do reset(). */
  finish: () => Promise<ScanView[]>;
  /** Od nowa (powrót do celowania) – nieoddane ujęcia do kosza. */
  reset: () => void;
}

const EMPTY = orbitCoverage(initialOrbit());

export function useOrbitScan({ active, source, capture, onDone }: OrbitScanOptions): OrbitScan {
  const [available, setAvailable] = useState<boolean | null>(source === 'sim' ? true : NATIVE ? null : false);
  const [coverage, setCoverage] = useState<OrbitCoverage>(EMPTY);
  const [hint, setHint] = useState<OrbitHint>('start');
  const [viewCount, setViewCount] = useState(0);
  const progress = useSharedValue(0);
  const heading = useSharedValue(Number.NaN);

  const stateRef = useRef<OrbitState>(initialOrbit());
  const viewsRef = useRef<ScanView[]>([]);
  const keysRef = useRef(new Set<string>());
  const inflightRef = useRef<Promise<void> | null>(null);
  const retryAtRef = useRef(0);
  /** Numer skanu – ujęcie, które wróci po reset(), trafia do kosza. */
  const genRef = useRef(0);
  const doneRef = useRef(false);
  /** Po finish(): bez próbek i zdjęć do reset(). */
  const heldRef = useRef(false);
  const lastKeyRef = useRef('');
  const prevCovRef = useRef<OrbitCoverage>(EMPTY);
  const simMsRef = useRef(0);
  const captureRef = useRef(capture);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    captureRef.current = capture;
    onDoneRef.current = onDone;
  }, [capture, onDone]);

  useEffect(() => {
    if (source === 'sim' || !NATIVE) return;
    let alive = true;
    DeviceMotion.isAvailableAsync()
      .then((ok) => alive && setAvailable(ok))
      .catch(() => alive && setAvailable(false));
    return () => {
      alive = false;
    };
  }, [source]);

  const takeView = useCallback((s: OrbitState) => {
    const cap = captureRef.current;
    if (!cap || inflightRef.current || Date.now() < retryAtRef.current) return;
    const slot = viewSlot(s, (k) => keysRef.current.has(k));
    if (!slot || !s.dir) return;
    const key = slotKey(slot);
    const view = { kind: slot.kind, az: relativeAz(s) ?? 0, el: Math.round(s.dir.el) };
    const gen = genRef.current;
    inflightRef.current = cap()
      .then((uri) => {
        if (!uri) {
          retryAtRef.current = Date.now() + RETRY_MS;
          return;
        }
        if (gen !== genRef.current || keysRef.current.has(key)) {
          deleteFindPhoto(uri);
          return;
        }
        keysRef.current.add(key);
        viewsRef.current = [...viewsRef.current, { uri, ...view, az: Math.round(view.az) % 360 }];
        setViewCount(viewsRef.current.length);
      })
      .finally(() => {
        inflightRef.current = null;
      });
  }, []);

  const onSample = useCallback(
    (sample: OrbitSample) => {
      if (heldRef.current) return;
      const s = orbitStep(stateRef.current, sample);
      stateRef.current = s;
      heading.set(relativeAz(s) ?? Number.NaN);
      const cov = orbitCoverage(s);
      progress.set(withTiming(cov.progress, { duration: 220 }));
      const h = orbitHint(s, cov);
      const key = `${h}|${cov.top}|${cov.low}|${cov.sectors.join()}`;
      if (key !== lastKeyRef.current) {
        lastKeyRef.current = key;
        const prev = prevCovRef.current;
        prevCovRef.current = cov;
        if (cov.done) haptic('done');
        else if ((cov.top && !prev.top) || (cov.low && !prev.low)) haptic('step');
        else if (cov.covered > prev.covered) haptic('tick');
        setCoverage(cov);
        setHint(h);
      }
      if (!cov.done) takeView(s);
      if (cov.done && !doneRef.current) {
        doneRef.current = true;
        onDoneRef.current();
      }
    },
    [heading, progress, takeView],
  );

  const tracking = active && available === true;

  // Czujniki urządzenia – tylko w czasie śledzenia (bateria); po przerwie czas liczy się od nowa.
  useEffect(() => {
    if (!tracking || source !== 'device') return;
    DeviceMotion.setUpdateInterval(SAMPLE_MS);
    const sub = DeviceMotion.addListener((m) => {
      const r = m.rotation;
      if (!r || !Number.isFinite(r.alpha) || !Number.isFinite(r.beta) || !Number.isFinite(r.gamma)) return;
      const rr = m.rotationRate;
      const rateDps = rr ? Math.hypot(rr.alpha || 0, rr.beta || 0, rr.gamma || 0) : 0;
      onSample({ t: Date.now(), rotation: r, rateDps });
    });
    return () => {
      sub.remove();
      stateRef.current = { ...stateRef.current, lastT: null };
    };
  }, [tracking, source, onSample]);

  // Narzędzia dev: symulowane obchodzenie (wznawia się od miejsca przerwy).
  useEffect(() => {
    if (!tracking || source !== 'sim') return;
    const t0 = Date.now() - simMsRef.current;
    const id = setInterval(() => {
      simMsRef.current = Date.now() - t0;
      onSample({ t: Date.now(), rotation: rotationFor(simOrbitDirection(simMsRef.current)), rateDps: 25 });
    }, SAMPLE_MS);
    return () => {
      clearInterval(id);
      stateRef.current = { ...stateRef.current, lastT: null };
    };
  }, [tracking, source, onSample]);

  const reset = useCallback(() => {
    deleteScanViews(viewsRef.current);
    genRef.current += 1;
    heldRef.current = false;
    stateRef.current = initialOrbit();
    viewsRef.current = [];
    keysRef.current = new Set();
    retryAtRef.current = 0;
    doneRef.current = false;
    lastKeyRef.current = '';
    prevCovRef.current = EMPTY;
    simMsRef.current = 0;
    progress.set(0);
    heading.set(Number.NaN);
    setCoverage(EMPTY);
    setHint('start');
    setViewCount(0);
  }, [heading, progress]);

  const finish = useCallback(async () => {
    heldRef.current = true;
    const gen = genRef.current;
    await inflightRef.current;
    if (gen !== genRef.current) return [];
    let views = viewsRef.current;
    const cap = captureRef.current;
    // „Analizuj teraz” zaraz po starcie – jeszcze bez ujęcia: jedno zdjęcie tu i teraz.
    if (!views.length && cap) {
      const s = stateRef.current;
      const uri = await cap();
      if (gen !== genRef.current) {
        deleteFindPhoto(uri);
        return [];
      }
      const el = Math.round(s.dir?.el ?? -40);
      if (uri) views = [{ uri, kind: kindForEl(el), az: Math.round(relativeAz(s) ?? 0) % 360, el }];
    }
    // Od tej chwili ujęcia należą do wywołującego.
    viewsRef.current = [];
    keysRef.current = new Set();
    return views;
  }, []);

  // Zamknięcie ekranu: nieoddane ujęcia do kosza.
  useEffect(
    () => () => {
      genRef.current += 1;
      deleteScanViews(viewsRef.current);
      viewsRef.current = [];
    },
    [],
  );

  return { available, progress, heading, coverage, hint, viewCount, finish, reset };
}
