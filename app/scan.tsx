import { CameraView } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, Platform, Pressable, StyleSheet, View, type LayoutRectangle } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { hapticLight } from '@/components/Button3D';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { MushroomMeter } from '@/components/MushroomMeter';
import { OrbitRing } from '@/components/OrbitRing';
import { Placeholder } from '@/components/Placeholder';
import { ProgressRing } from '@/components/ProgressRing';
import { ScanSweep } from '@/components/ScanSweep';
import { Spin3D } from '@/components/Spin3D';
import { Txt } from '@/components/Txt';
import { UiHost } from '@/components/UiHost';
import { DEV_TOOLS } from '@/config';
import { detectRegion, useRegionStore } from '@/hooks/useRegion';
import { useBottomPadding, useTopInset } from '@/hooks/useInsets';
import { ORBIT, type OrbitHint } from '@/scan/orbit';
import { useOrbitScan } from '@/scan/useOrbitScan';
import { hasSpin, heroView } from '@/scan/views';
import { ServiceError, useServices, type ServiceErrorCode } from '@/services';
import { captureFindPhoto, captureScanView, isCameraAvailable, pickDevFindPhoto } from '@/services/live/camera';
import { deleteFindPhoto, deleteScanViews, findPhotoSource } from '@/services/live/findPhotos';
import { devScanForced, POSITION_MAX_AGE_MS } from '@/services/live/identify';
import { createPendingFind } from '@/store/game';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useSimStore } from '@/store/useSimStore';
import { ui } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';
import { colors } from '@/theme/tokens';
import type { IdentifyOutcome, ScanResult, ScanView } from '@/types';
import { plural } from '@/utils/format';
import { makeId } from '@/utils/random';

/**
 * Skan grzyba (02): podgląd aparatu z pierścieniem-kadrem → „Analizuję…” (Edge Function `identify`, model Claude)
 * → grzyb: Analiza (03); „to nie grzyb” / niewyraźne ujęcie: karta z powodem i „Spróbuj ponownie” bez tworzenia
 * znaleziska. Bez aparatu nie ma rozpoznania (poza wymuszonym wynikiem z panelu dev).
 *
 * Skan 3D (telefon z czujnikami ruchu; w narzędziach dev także aparat „Symulacja”): gracz obchodzi grzyba – z boku,
 * nisko przy ziemi i z góry (src/scan/orbit.ts). Pierścień zapala obejrzane strony, grzybek w rogu wypełnia się od
 * dołu na zielono, a aparat w tym czasie zbiera ujęcia. Pełny grzybek = analiza rusza sama (do 4 ujęć naraz);
 * spust w trakcie = „Analizuj teraz” z tym, co już jest. Ujęcia zostają przy znalezisku jako podgląd 3D.
 * Bez czujników (web) – zwykły skan: spust robi jedno zdjęcie.
 */
type Phase = 'permission' | 'denied' | 'live' | 'analyzing' | 'rejected' | 'nophoto' | 'error';
type Rejection = Extract<IdentifyOutcome, { kind: 'not_mushroom' | 'unclear' }>;
type ScanFailure = { code: ServiceErrorCode | null; message: string };

const RING = 270;
const RING_THICK = 13.5;
/** Obejście do zaliczenia w stopniach (podpowiedź „90° z 270°”). */
const SECTOR_DEG = 360 / ORBIT.sectors;
const NEEDED_DEG = ORBIT.sectorsNeeded * SECTOR_DEG;
/** Kadr wewnątrz pierścienia – tam, gdzie w makiecie placeholder „grzyb w kadrze”. */
const FRAME_INSET = 26;

/** Najdłużej tyle czekamy na odczyt pozycji przed rozpoznaniem (gmina znaleziska na serwerze) – potem bez pozycji. */
const POSITION_WAIT_MS = 4_000;

/** Wynik obietnicy albo null po `ms` (albo przy błędzie) – obietnica biegnie dalej w tle. */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

function hapticWarning() {
  if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

/** Podpowiedź skanu 3D: co teraz zrobić, żeby grzybek się zapełnił. */
function orbitStatus(hint: OrbitHint, coveredDeg: number): { title: string; sub: string } {
  switch (hint) {
    case 'start':
      return { title: 'Wyceluj w grzyba', sub: 'Grzyb w kółku – skan 3D rusza sam' };
    case 'orbit':
      return {
        title: 'Obejdź grzyba dookoła',
        sub: `Powoli, aparat cały czas na grzybie · ${Math.min(coveredDeg, NEEDED_DEG)}° z ${NEEDED_DEG}°`,
      };
    case 'low':
      return { title: 'Teraz nisko, przy ziemi', sub: 'Pokaż spód kapelusza i trzon' };
    case 'top':
      return { title: 'Teraz z góry', sub: 'Unieś telefon nad kapelusz' };
    case 'slow':
      return { title: 'Wolniej', sub: 'Przy szybkim ruchu zdjęcia wychodzą rozmazane' };
    case 'done':
      return { title: 'Mam wszystko!', sub: 'Analizuję skan 3D…' };
  }
}

export default function ScanScreen() {
  const services = useServices();
  const top = useTopInset();
  const bottom = useBottomPadding(40);
  const camPerm = useSimStore((s) => s.permissions.camera);
  // Wymuszony wynik skanu (tylko narzędzia dev) – spust działa wtedy także bez aparatu.
  const forced = useSimStore((s) => DEV_TOOLS && s.scan.force !== 'off');
  // Źródło obrazu na czas skanu: prawdziwy aparat albo paskowany placeholder z makiety (panel dev / dev-linki).
  const [simCamera] = useState(() => useSimStore.getState().cameraSource === 'sim');
  const [phase, setPhase] = useState<Phase>(camPerm === 'granted' ? 'live' : 'permission');
  const [flash, setFlash] = useState(false);
  const [failure, setFailure] = useState<ScanFailure | null>(null);
  const [rejection, setRejection] = useState<Rejection | null>(null);
  const [noPhoto, setNoPhoto] = useState<'no_camera' | 'capture_failed'>('no_camera');
  // Aparat: zgoda, błąd podglądu (brak kamery / getUserMedia / symulator), gotowość, zdjęcie już zrobione.
  const [camGranted, setCamGranted] = useState(false);
  const [camFailed, setCamFailed] = useState(false);
  /** Aparat zgłosił gotowość od ostatniego włączenia podglądu (zerowane, gdy podgląd gaśnie). */
  const [readyFlag, setReadyFlag] = useState(false);
  /** Zdjęcie w analizie: URI, '' = bez zdjęcia (wynik wymuszony w dev), null = podgląd. */
  const [shot, setShot] = useState<string | null>(null);
  /** Ujęcia skanu 3D w analizie (obracają się w kółku „Analizuję…”). */
  const [shotViews, setShotViews] = useState<ScanView[] | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background');
  const [frame, setFrame] = useState<LayoutRectangle | null>(null);
  const focused = useIsFocused();
  const ringFill = useSharedValue(0);
  const cameraRef = useRef<CameraView>(null);
  const failedRef = useRef(false);
  /** Rozpoznanie w toku – przerwanie przy zamknięciu ekranu i „Anuluj”. */
  const abortRef = useRef<AbortController | null>(null);
  /** Zdjęcie po spuście – „Spróbuj ponownie” po błędzie sieci nie robi nowego zdjęcia. */
  const capturedRef = useRef<ScanResult | null>(null);
  /** Zdjęcie przekazane do znaleziska – od tej chwili sprząta je game.ts (porzucenie znaleziska). */
  const handedOffRef = useRef(false);
  /** Ekran zamknięty w trakcie analizy (np. „wstecz” na Androidzie) – wynik trafia do kosza. */
  const unmountedRef = useRef(false);
  const busyRef = useRef(false);

  const liveView = !simCamera && !camFailed;
  // Podgląd tylko na widocznym, aktywnym ekranie – w tle, po wyjściu i po zdjęciu aparat jest zwolniony.
  const cameraOn = liveView && camGranted && shot === null && focused && appActive;

  const camReady = cameraOn && readyFlag;

  // Skan 3D: z prawdziwym aparatem (czujniki ruchu urządzenia) albo symulowany z aparatem „Symulacja” (tylko dev).
  const orbitWanted = simCamera ? DEV_TOOLS : !camFailed;
  const cameraOnRef = useRef(false);
  useEffect(() => {
    cameraOnRef.current = cameraOn;
  }, [cameraOn]);
  const captureView = useCallback(async () => {
    const cam = cameraRef.current;
    return cam && cameraOnRef.current ? captureScanView(cam) : undefined;
  }, []);
  const orbit = useOrbitScan({
    active: orbitWanted && phase === 'live' && (simCamera || camReady),
    source: simCamera ? 'sim' : 'device',
    capture: simCamera ? null : captureView,
    onDone: () => void finishOrbit(),
  });
  // Czujniki jeszcze sprawdzane – już ekran skanu 3D (bez mignięcia zwykłego skanu).
  const orbitMode = orbitWanted && orbit.available !== false;
  const resetOrbit = orbit.reset;
  // Podgląd gaśnie po wyjściu z ekranu i w tle – po powrocie czekamy na nowe „gotowe” z aparatu.
  useFocusEffect(
    useCallback(() => {
      return () => setReadyFlag(false);
    }, []),
  );

  // Pierścień wypełnia się, gdy aparat jest gotowy (albo wynik jest wymuszony) – to kadr, nie postęp analizy.
  useEffect(() => {
    ringFill.value = withTiming(camReady || forced ? 1 : 0, { duration: 450, easing: Easing.out(Easing.cubic) });
  }, [camReady, forced, ringFill]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      setAppActive(s !== 'background');
      if (s === 'background') setReadyFlag(false);
    });
    return () => sub.remove();
  }, []);

  const onCameraReady = useCallback(() => {
    // Web po błędzie getUserMedia zgłasza też „gotowość” – zostajemy wtedy przy placeholderze.
    if (failedRef.current) return;
    setReadyFlag(true);
  }, []);

  // Brak kamery / błąd podglądu (np. symulator, kamera zajęta) – placeholder i „Brak aparatu”.
  const onMountError = useCallback(() => {
    failedRef.current = true;
    setCamFailed(true);
    setReadyFlag(false);
    setFlash(false);
  }, []);

  const onGranted = useCallback(() => {
    setCamGranted(true);
    setPhase((p) => (p === 'permission' || p === 'denied' ? 'live' : p));
  }, []);

  /** Zdjęcie (i ujęcia skanu 3D), które nie trafiło do znaleziska, nie zostaje na dysku; skan 3D od nowa. */
  const discardShot = useCallback(() => {
    const scan = capturedRef.current;
    capturedRef.current = null;
    if (scan && !handedOffRef.current) {
      deleteFindPhoto(scan.photoUri);
      deleteScanViews(scan.views);
    }
    setShot(null);
    setShotViews(null);
    resetOrbit();
  }, [resetOrbit]);

  // Uprawnienie do aparatu: w symulacji mockowy prompt przy pierwszym skanie, z aparatem urządzenia – systemowe
  // (bez promptu, gdy już rozstrzygnięte).
  useEffect(() => {
    unmountedRef.current = false;
    let alive = true;
    (async () => {
      // Brak kamery (web bez urządzenia albo bez https) – od razu placeholder, bez pytania o zgodę.
      if (!simCamera && !(await isCameraAvailable())) {
        if (!alive) return;
        failedRef.current = true;
        setCamFailed(true);
        setPhase('live');
        return;
      }
      const st = simCamera && camPerm !== 'undetermined' ? camPerm : await services.permissions.request('camera');
      if (!alive) return;
      if (st === 'granted') onGranted();
      else setPhase('denied');
    })();
    return () => {
      alive = false;
      unmountedRef.current = true;
      abortRef.current?.abort();
      const scan = capturedRef.current;
      if (scan && !handedOffRef.current) {
        deleteFindPhoto(scan.photoUri);
        deleteScanViews(scan.views);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Powrót z ustawień telefonu po odmowie – jeśli zgoda jest już nadana, podgląd rusza sam.
  useEffect(() => {
    if (simCamera || phase !== 'denied' || !appActive || !services.permissions.refresh) return;
    let alive = true;
    services.permissions
      .refresh('camera')
      .then((st) => {
        if (alive && st === 'granted') onGranted();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [simCamera, phase, appActive, services, onGranted]);

  const openSettings = async () => {
    const perms = services.permissions;
    if (!perms.openSettings) {
      ui.toast('Ustawienia › Grzybobranie › Aparat', 'settings');
      return;
    }
    const st = await perms.openSettings('camera');
    if (st === 'granted') onGranted();
    else if (!simCamera && Platform.OS === 'web') {
      ui.toast('Zezwól na aparat w ustawieniach strony (ikona obok adresu) i spróbuj ponownie', 'settings');
    }
  };

  /** Rozpoznanie zrobionego zdjęcia (też „Spróbuj ponownie” po błędzie – to samo zdjęcie). */
  const analyze = async () => {
    const scan = capturedRef.current;
    if (!scan || busyRef.current) return;
    busyRef.current = true;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase('analyzing');
    try {
      const known = useRegionStore.getState().region;
      const home = useUserStore.getState().user.homeGminaId;
      // Pozycja PRZED rozpoznaniem (serwer liczy z niej gminę znaleziska – podpisane rozpoznanie): świeża z pamięci
      // (≤ 15 min), inaczej szybki odczyt (najwyżej POSITION_WAIT_MS; bez zgody na lokalizację – bez pytania i bez pozycji).
      const fresh = known && Date.now() - Date.parse(known.position.at) <= POSITION_MAX_AGE_MS ? known : null;
      const located = fresh ?? (await within(detectRegion(services, { askPermission: false }), POSITION_WAIT_MS));
      if (unmountedRef.current) return;
      if (ctrl.signal.aborted) throw new ServiceError('CANCELLED', 'Rozpoznawanie przerwane');
      const region = located ?? known;
      // Model dostaje tylko miesiąc i województwo (sezon / zasięg gatunku). Pozycja – wyłącznie do gminy znaleziska na
      // serwerze; serwer jej nie zapisuje i nie przekazuje modelowi.
      const voivodeship = region?.gmina.voivodeship ?? useCatalogStore.getState().gminaById[home]?.voivodeship;
      const outcome = await services.identify.identify(scan, {
        signal: ctrl.signal,
        context: { month: new Date().getMonth() + 1, voivodeship, ...(located ? { position: located.position } : {}) },
      });
      // Zamknięty ekran: zdjęcie skasował już cleanup, a router.replace podmieniłby ekran, na którym jest gracz.
      if (unmountedRef.current || ctrl.signal.aborted) return;
      if (outcome.kind === 'mushroom') {
        // Odczyt pozycji mógł skończyć się w trakcie rozpoznania – gmina z najświeższego regionu.
        const where = located ?? useRegionStore.getState().region ?? known;
        const find = createPendingFind(outcome.identification, where?.gmina.id ?? home, {
          photoUri: scan.photoUri,
          parts: outcome.visibleParts,
          views: scan.views,
        });
        handedOffRef.current = true;
        router.replace(`/analysis/${find.id}`);
        return;
      }
      // Nie grzyb / niewyraźne: bez znaleziska, zdjęcie do kosza, podgląd wraca od razu pod kartą.
      discardShot();
      setRejection(outcome);
      setPhase('rejected');
      hapticWarning();
    } catch (e) {
      if (unmountedRef.current) return;
      const err = e instanceof ServiceError ? e : new ServiceError('SERVER', 'Nie udało się rozpoznać grzyba');
      if (err.code === 'CANCELLED') {
        discardShot();
        setPhase('live');
      } else if (err.code === 'NO_PHOTO') {
        discardShot();
        setNoPhoto(liveView ? 'capture_failed' : 'no_camera');
        setPhase('nophoto');
      } else {
        setFailure({ code: err.code, message: err.message });
        setPhase('error');
      }
    } finally {
      busyRef.current = false;
    }
  };

  /** Spust: zdjęcie z aparatu → rozpoznanie. Bez zdjęcia – „Brak aparatu” (chyba że wynik jest wymuszony w dev). */
  const shoot = async () => {
    if (busyRef.current || phase !== 'live') return;
    busyRef.current = true;
    let photoUri: string | undefined;
    try {
      const cam = cameraRef.current;
      photoUri = cam && cameraOn ? await captureFindPhoto(cam) : undefined;
    } finally {
      busyRef.current = false;
    }
    if (unmountedRef.current) {
      deleteFindPhoto(photoUri);
      return;
    }
    if (!photoUri && !devScanForced()) {
      setNoPhoto(liveView ? 'capture_failed' : 'no_camera');
      setPhase('nophoto');
      hapticWarning();
      return;
    }
    capturedRef.current = { id: makeId('scan'), capturedAt: new Date().toISOString(), photoUri };
    // Zdjęcie zrobione (albo wynik wymuszony w dev) – podgląd gaśnie na czas analizy.
    setShot(photoUri ?? '');
    setReadyFlag(false);
    await analyze();
  };

  /**
   * Skan 3D: grzybek pełny (samo) albo spust w trakcie („Analizuj teraz”) – ujęcia z obchodzenia → rozpoznanie.
   * Zdjęcie główne to pierwsze ujęcie z boku; bez żadnego ujęcia – „nie udało się zrobić zdjęcia”.
   */
  const finishOrbit = async () => {
    if (busyRef.current || phase !== 'live') return;
    busyRef.current = true;
    let views: ScanView[] = [];
    try {
      views = await orbit.finish();
    } finally {
      busyRef.current = false;
    }
    if (unmountedRef.current) {
      deleteScanViews(views);
      return;
    }
    const hero = heroView(views);
    if (!hero && !devScanForced()) {
      setNoPhoto(liveView ? 'capture_failed' : 'no_camera');
      setPhase('nophoto');
      hapticWarning();
      return;
    }
    capturedRef.current = {
      id: makeId('scan'),
      capturedAt: new Date().toISOString(),
      photoUri: hero?.uri,
      ...(views.length ? { views } : {}),
    };
    setShot(hero?.uri ?? '');
    setShotViews(views.length ? views : null);
    setReadyFlag(false);
    await analyze();
  };

  /** Tylko narzędzia dev: zdjęcie z galerii zamiast aparatu (w wydaniu – nigdy, anty-cheat). */
  const pickFromGallery = async () => {
    if (!DEV_TOOLS || busyRef.current) return;
    const uri = await pickDevFindPhoto();
    if (uri === 'canceled') return;
    if (!uri) {
      ui.toast('Nie udało się wczytać zdjęcia', 'broken_image');
      return;
    }
    if (unmountedRef.current) {
      deleteFindPhoto(uri);
      return;
    }
    discardShot();
    capturedRef.current = { id: makeId('scan'), capturedAt: new Date().toISOString(), photoUri: uri };
    setShot(uri);
    setReadyFlag(false);
    await analyze();
  };

  /** Z powrotem do podglądu: zdjęcie do kosza, aparat wraca. */
  const backToLive = () => {
    abortRef.current?.abort();
    discardShot();
    setRejection(null);
    setFailure(null);
    setPhase(camGranted || !liveView ? 'live' : 'permission');
  };

  // Latarka: w symulacji jak w makiecie, z aparatem – tylko natywnie i przy działającym podglądzie.
  const torchOk = simCamera || (cameraOn && Platform.OS !== 'web');
  const camLabel = simCamera
    ? orbitMode
      ? 'symulacja skanu 3D'
      : 'podgląd kamery'
    : camFailed
      ? 'podgląd kamery niedostępny'
      : orbitMode
        ? 'skan 3D'
        : ' ';

  const onFlash = () => {
    if (!torchOk) {
      ui.toast(!simCamera && Platform.OS === 'web' ? 'Latarka niedostępna w przeglądarce' : 'Latarka niedostępna', 'flash_off');
      return;
    }
    setFlash((f) => !f);
    ui.toast(flash ? 'Latarka wyłączona' : 'Latarka włączona', 'flash_on');
  };

  const close = () => {
    abortRef.current?.abort();
    router.back();
  };

  const onClose = () => {
    if (phase !== 'analyzing') {
      close();
      return;
    }
    ui.confirm({
      title: 'Przerwać rozpoznawanie?',
      message: 'Zdjęcie zostanie odrzucone. Możesz zrobić nowe w każdej chwili.',
      icon: 'center_focus_strong',
      confirmLabel: 'Przerwij',
      cancelLabel: 'Czekaj',
      danger: true,
      onConfirm: close,
    });
  };

  const status = orbitMode
    ? simCamera || camReady
      ? orbitStatus(orbit.hint, orbit.coverage.covered * SECTOR_DEG)
      : phase === 'permission' || !camGranted
        ? { title: 'Aparat…', sub: 'Potrzebujemy dostępu do aparatu' }
        : { title: 'Uruchamiam aparat…', sub: 'Za chwilę zaczniesz skan 3D' }
    : !liveView
    ? forced
      ? { title: 'Wynik wymuszony (dev)', sub: 'Spust działa bez zdjęcia – panel dev' }
      : { title: 'Brak aparatu', sub: 'Rozpoznawanie wymaga zdjęcia grzyba' }
    : phase === 'permission' || !camGranted
      ? { title: 'Aparat…', sub: 'Potrzebujemy dostępu do aparatu' }
      : camReady
        ? { title: 'Wyceluj w grzyba', sub: 'Cały owocnik w kółku – i spust' }
        : { title: 'Uruchamiam aparat…', sub: 'Za chwilę możesz zrobić zdjęcie' };

  return (
    <View style={{ flex: 1, backgroundColor: colors.camera }}>
      <StatusBar style="light" />
      {liveView ? null : <Placeholder variant="camera" stripe={12} style={StyleSheet.absoluteFill} />}
      {cameraOn ? (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          // Skan 3D robi zdjęcia w trakcie obchodzenia – bez mignięcia podglądu przy każdym ujęciu.
          animateShutter={!orbitMode}
          enableTorch={flash && Platform.OS !== 'web'}
          onCameraReady={onCameraReady}
          onMountError={onMountError}
        />
      ) : null}
      {liveView ? <CameraScrim frame={frame} /> : null}
      <View style={{ flex: 1, paddingTop: top + 8, paddingHorizontal: 20, paddingBottom: bottom, gap: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton icon="close" variant="dark" onPress={onClose} accessibilityLabel="Zamknij skan" />
          <Txt f="b7" size={20} color={colors.onDark}>
            Skan grzyba
          </Txt>
          <IconButton
            icon="flash_on"
            variant="dark"
            iconSize={22}
            filled={flash && torchOk}
            active={flash && torchOk}
            onPress={onFlash}
            accessibilityLabel="Latarka"
          />
        </View>
        <Txt f="mono" size={11} color={colors.cameraLabel} align="center">
          {camLabel}
        </Txt>

        <View
          onLayout={(e) => setFrame(e.nativeEvent.layout)}
          style={{ width: RING, height: RING, alignSelf: 'center', marginTop: 6 }}
        >
          {orbitMode ? (
            <OrbitRing
              size={RING}
              thickness={RING_THICK}
              sectors={orbit.coverage.sectors}
              heading={orbit.heading}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <ProgressRing
              size={RING}
              thickness={RING_THICK}
              progress={ringFill}
              color={colors.scanGreen}
              track="rgba(255,255,255,0.16)"
              style={StyleSheet.absoluteFill}
            />
          )}
          {liveView ? (
            // Na żywym obrazie kadr jest przezroczysty – tylko cienka przerywana linia.
            <View style={styles.frame} />
          ) : (
            <Placeholder
              variant="dark"
              stripe={8}
              label="grzyb w kadrze"
              style={{
                position: 'absolute',
                left: FRAME_INSET,
                top: FRAME_INSET,
                right: FRAME_INSET,
                bottom: FRAME_INSET,
                borderRadius: RING / 2 - FRAME_INSET,
              }}
            />
          )}
        </View>

        <View style={{ alignItems: 'center', gap: 4 }}>
          <Txt f="b7" size={28} lh={1.1} color={colors.onDark} align="center">
            {status.title}
          </Txt>
          <Txt f="n7" size={15} color={colors.onDarkSoft} align="center">
            {status.sub}
          </Txt>
        </View>

        <View style={{ flex: 1 }} />

        <View
          style={{
            backgroundColor: 'rgba(255,255,255,0.1)',
            borderRadius: 18,
            paddingVertical: 12,
            paddingHorizontal: 14,
            flexDirection: 'row',
            gap: 10,
          }}
        >
          <Icon name="tips_and_updates" size={20} color={colors.tipIcon} />
          <Txt f="n6" size={13} color={colors.onDarkTip} style={{ flex: 1 }}>
            {orbitMode
              ? 'Obejdź grzyba z aparatem na nim: z boku, nisko przy ziemi i z góry – pełny grzybek w rogu sam uruchomi analizę. Odsłoń delikatnie podstawę trzonu. Nie da się obejść? Naciśnij spust.'
              : 'Zrób zdjęcie z boku i z bliska: kapelusz, spód i trzon. Odsłoń delikatnie podstawę trzonu – to klucz do odróżnienia gatunków trujących.'}
          </Txt>
        </View>

        <Shutter
          enabled={phase === 'live'}
          ready={!orbitMode && phase === 'live' && (camReady || forced)}
          label={orbitMode ? 'Analizuj teraz, bez pełnego obejścia' : 'Zrób zdjęcie i rozpoznaj'}
          onPress={orbitMode ? finishOrbit : shoot}
        />
      </View>

      {orbitMode ? (
        <MushroomMeter progress={orbit.progress} done={orbit.coverage.done} style={[styles.meter, { top: top + 62 }]} />
      ) : null}

      {phase === 'rejected' && rejection ? (
        <RejectionCard rejection={rejection} bottom={bottom} onRetry={backToLive} onClose={close} />
      ) : null}
      {phase === 'analyzing' ? (
        <Analyzing photoUri={shot || undefined} views={shotViews ?? undefined} onCancel={backToLive} />
      ) : null}
      {phase === 'denied' ? <CameraDenied onOpenSettings={openSettings} /> : null}
      {phase === 'nophoto' ? (
        <NoPhoto
          reason={noPhoto}
          onRetry={liveView ? backToLive : undefined}
          onGallery={DEV_TOOLS ? pickFromGallery : undefined}
          onClose={close}
        />
      ) : null}
      {phase === 'error' ? (
        <ScanError
          failure={failure}
          onRetry={failure?.code === 'UNAVAILABLE' ? undefined : analyze}
          onRescan={backToLive}
          onClose={close}
        />
      ) : null}
      <UiHost />
    </View>
  );
}

/** Kolor przyciemnienia nad żywym obrazem (zieleń z tła aparatu). */
const SCRIM = '16,22,12';

/**
 * Czytelność UI na żywym obrazie: lekkie przyciemnienie poza pierścieniem (wnętrze kadru zostaje czyste)
 * i gradienty pod nagłówkiem oraz pod tekstem, podpowiedzią i spustem.
 */
function CameraScrim({ frame }: { frame: LayoutRectangle | null }) {
  const r = RING / 2 - RING_THICK;
  const cx = frame ? frame.x + frame.width / 2 : 0;
  const cy = frame ? frame.y + frame.height / 2 : 0;
  const hole = `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      {frame ? (
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
          <Path d={`M-4000 -4000H4000V4000H-4000Z${hole}`} fill={`rgb(${SCRIM})`} fillOpacity={0.3} fillRule="evenodd" />
        </Svg>
      ) : null}
      <LinearGradient
        colors={[`rgba(${SCRIM},0.6)`, `rgba(${SCRIM},0)`]}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 190 }}
      />
      <LinearGradient
        colors={[`rgba(${SCRIM},0)`, `rgba(${SCRIM},0.6)`, `rgba(${SCRIM},0.82)`]}
        locations={[0, 0.35, 1]}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '52%' }}
      />
    </View>
  );
}

function Shutter({
  enabled,
  ready,
  label,
  onPress,
}: {
  enabled: boolean;
  ready: boolean;
  label: string;
  onPress: () => void;
}) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = ready
      ? withRepeat(withTiming(1.08, { duration: 700, easing: Easing.inOut(Easing.ease) }), -1, true)
      : withTiming(1, { duration: 150 });
  }, [ready, pulse]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  return (
    <Animated.View style={[{ alignSelf: 'center' }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !enabled }}
        disabled={!enabled}
        onPress={() => {
          hapticLight();
          onPress();
        }}
        style={({ pressed }) => ({
          width: 84,
          height: 84,
          borderRadius: 42,
          borderWidth: 5,
          borderColor: colors.onDark,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: enabled ? 1 : 0.45,
          transform: [{ scale: pressed ? 0.94 : 1 }],
        })}
      >
        <View
          style={{
            width: 62,
            height: 62,
            borderRadius: 31,
            backgroundColor: colors.scanGreen,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="auto_awesome" filled size={30} color={colors.primaryInk} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

const SPIN = 168;
const SPIN_THICK = 10;

/**
 * „Analizuję…” na czas żądania do serwera: zdjęcie w pierścieniu z obracającym się „sweepem” (zwykły wskaźnik);
 * po skanie 3D w pierścieniu obraca się grzyb z ujęć obchodzenia.
 */
function Analyzing({ photoUri, views, onCancel }: { photoUri?: string; views?: ScanView[]; onCancel: () => void }) {
  const total = useCatalogStore((s) => s.totalSpecies || s.species.length);
  const src = findPhotoSource(photoUri);
  const inner = SPIN - 2 * SPIN_THICK - 8;
  const spin = views && hasSpin(views);
  return (
    <Animated.View entering={FadeIn.duration(180)} style={[StyleSheet.absoluteFill, styles.overlay]}>
      <View style={{ width: SPIN, height: SPIN, alignItems: 'center', justifyContent: 'center' }}>
        <ProgressRing size={SPIN} thickness={SPIN_THICK} value={0} color={colors.scanGreen} track="rgba(255,255,255,0.14)" style={StyleSheet.absoluteFill} />
        <ScanSweep size={SPIN} thickness={SPIN_THICK} running />
        {spin ? (
          <Spin3D views={views} interactive={false} spinMs={3600} style={{ width: inner, height: inner, borderRadius: inner / 2 }} />
        ) : src ? (
          <Image source={src} style={{ width: inner, height: inner, borderRadius: inner / 2 }} resizeMode="cover" />
        ) : (
          <View style={[styles.bigIcon, { marginBottom: 0, backgroundColor: colors.scanGreen }]}>
            <Icon name="auto_awesome" filled size={40} color={colors.primaryInk} />
          </View>
        )}
      </View>
      <Txt f="b7" size={30} color={colors.onDark} style={{ marginTop: 26 }}>
        {views?.length ? 'Analizuję skan 3D…' : 'Analizuję…'}
      </Txt>
      <Txt f="n7" size={15} color={colors.onDarkSoft} align="center">
        {views && views.length > 1
          ? `${views.length} ${plural(views.length, 'ujęcie', 'ujęcia', 'ujęć')} · porównuję z atlasem${total ? ` ${total} gatunków` : ''}`
          : `Porównuję zdjęcie z atlasem${total ? ` ${total} gatunków` : ''}`}
      </Txt>
      <Pressable onPress={onCancel} hitSlop={8} style={{ marginTop: 18 }}>
        <Txt f="n8" size={14} color={colors.onDarkMuted}>
          Anuluj
        </Txt>
      </Pressable>
    </Animated.View>
  );
}

const UNCLEAR_TIPS = [
  'Podejdź bliżej – grzyb na środku kółka',
  'Więcej światła, bez ostrych cieni (latarka ⚡)',
  'Pokaż kapelusz z boku, spód i trzon',
];

/** Odrzucenie – karta nad podglądem, który już działa: „Spróbuj ponownie” wraca od razu do celowania. */
function RejectionCard({
  rejection,
  bottom,
  onRetry,
  onClose,
}: {
  rejection: Rejection;
  bottom: number;
  onRetry: () => void;
  onClose: () => void;
}) {
  const notMushroom = rejection.kind === 'not_mushroom';
  return (
    <Animated.View
      entering={FadeInDown.duration(220)}
      style={[styles.card, { bottom: bottom + 8 }]}
      accessibilityRole="alert"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={[styles.cardIcon, { backgroundColor: notMushroom ? 'rgba(255,212,138,0.18)' : 'rgba(255,255,255,0.12)' }]}>
          <Icon name={notMushroom ? 'hide_image' : 'filter_center_focus'} size={26} color={notMushroom ? colors.tipIcon : colors.onDark} />
        </View>
        <Txt f="b7" size={22} lh={1.15} color={colors.onDark} style={{ flex: 1 }}>
          {notMushroom ? 'Nie wykryłem grzyba' : 'Niewyraźne zdjęcie'}
        </Txt>
      </View>
      <Txt f="n6" size={14} color={colors.onDarkSoft}>
        {rejection.reason}
      </Txt>
      {notMushroom ? null : (
        <View style={{ gap: 4 }}>
          {UNCLEAR_TIPS.map((t) => (
            <View key={t} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Icon name="check_circle" size={16} color={colors.scanChipText} />
              <Txt f="n7" size={13} color={colors.onDarkTip} style={{ flex: 1 }}>
                {t}
              </Txt>
            </View>
          ))}
        </View>
      )}
      <Pressable onPress={onRetry} style={[styles.darkBtn, { alignSelf: 'stretch', alignItems: 'center' }]}>
        <Txt f="b7" size={17} color={colors.primaryInk}>
          Spróbuj ponownie
        </Txt>
      </Pressable>
      <Pressable onPress={onClose} hitSlop={8} style={{ alignSelf: 'center' }}>
        <Txt f="n8" size={14} color={colors.onDarkMuted}>
          Wróć
        </Txt>
      </Pressable>
    </Animated.View>
  );
}

function CameraDenied({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay, { gap: 12, paddingHorizontal: 32 }]}>
      <View style={styles.bigIcon}>
        <Icon name="no_photography" filled size={40} color={colors.onDark} />
      </View>
      <Txt f="b7" size={24} color={colors.onDark} align="center" lh={1.15}>
        Brak dostępu do aparatu
      </Txt>
      <Txt f="n6" size={14} color={colors.onDarkSoft} align="center">
        Rozpoznanie gatunku wymaga zdjęcia grzyba. Zdjęcie wysyłamy tylko do rozpoznania – nic poza tym.
      </Txt>
      <Pressable onPress={onOpenSettings} style={styles.darkBtn}>
        <Txt f="b7" size={17} color={colors.primaryInk}>
          Otwórz ustawienia
        </Txt>
      </Pressable>
      <Pressable onPress={() => router.back()} hitSlop={8}>
        <Txt f="n8" size={14} color={colors.onDarkMuted}>
          Wróć
        </Txt>
      </Pressable>
    </View>
  );
}

/** Spust bez zdjęcia: brak aparatu (komputer, symulator) albo nieudane zdjęcie. Galeria – tylko narzędzia dev. */
function NoPhoto({
  reason,
  onRetry,
  onGallery,
  onClose,
}: {
  reason: 'no_camera' | 'capture_failed';
  onRetry?: () => void;
  onGallery?: () => void;
  onClose: () => void;
}) {
  const noCamera = reason === 'no_camera';
  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay, { gap: 12, paddingHorizontal: 32 }]}>
      <View style={styles.bigIcon}>
        <Icon name={noCamera ? 'no_photography' : 'broken_image'} size={40} color={colors.onDark} />
      </View>
      <Txt f="b7" size={24} color={colors.onDark} align="center" lh={1.15}>
        {noCamera ? 'Brak aparatu – rozpoznawanie wymaga zdjęcia' : 'Nie udało się zrobić zdjęcia'}
      </Txt>
      <Txt f="n6" size={14} color={colors.onDarkSoft} align="center">
        {noCamera
          ? 'Na tym urządzeniu nie ma dostępnego aparatu. Zeskanuj grzyba telefonem.'
          : 'Aparat nie oddał zdjęcia. Poczekaj, aż podgląd się pojawi, i spróbuj jeszcze raz.'}
      </Txt>
      {onRetry ? (
        <Pressable onPress={onRetry} style={styles.darkBtn}>
          <Txt f="b7" size={17} color={colors.primaryInk}>
            Spróbuj ponownie
          </Txt>
        </Pressable>
      ) : null}
      {onGallery ? (
        <Pressable onPress={onGallery} style={[styles.darkBtn, styles.devBtn]}>
          <Icon name="photo_library" size={20} color={colors.onDark} />
          <Txt f="b7" size={15} color={colors.onDark}>
            Wybierz zdjęcie z galerii (dev)
          </Txt>
        </Pressable>
      ) : null}
      <Pressable onPress={onClose} hitSlop={8}>
        <Txt f="n8" size={14} color={colors.onDarkMuted}>
          Wróć
        </Txt>
      </Pressable>
    </View>
  );
}

const FAILURE_COPY: Partial<Record<ServiceErrorCode, { icon: IconName; title: string; hint?: string }>> = {
  NETWORK: { icon: 'wifi_off', title: 'Nie udało się rozpoznać', hint: 'Zdjęcie czeka – spróbuj, gdy wróci zasięg.' },
  TIMEOUT: { icon: 'hourglass_top', title: 'Rozpoznawanie trwa zbyt długo', hint: 'Zdjęcie czeka – spróbuj jeszcze raz.' },
  RATE_LIMITED: { icon: 'hourglass_top', title: 'Limit rozpoznań' },
  UNAVAILABLE: {
    icon: 'cloud_off',
    title: 'Rozpoznawanie wymaga połączenia z serwerem',
    hint: DEV_TOOLS ? 'Dev: ustaw adres i klucz Supabase w .env.local albo wymuś wynik skanu w panelu dev.' : undefined,
  },
};

function ScanError({
  failure,
  onRetry,
  onRescan,
  onClose,
}: {
  failure: ScanFailure | null;
  onRetry?: () => void;
  onRescan: () => void;
  onClose: () => void;
}) {
  const copy = (failure?.code && FAILURE_COPY[failure.code]) || { icon: 'error' as IconName, title: 'Nie udało się rozpoznać' };
  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay, { gap: 12, paddingHorizontal: 32 }]}>
      <View style={styles.bigIcon}>
        <Icon name={copy.icon} size={40} color={colors.onDark} />
      </View>
      <Txt f="b7" size={24} color={colors.onDark} align="center" lh={1.15}>
        {copy.title}
      </Txt>
      <Txt f="n6" size={14} color={colors.onDarkSoft} align="center">
        {[failure?.message ?? 'Spróbuj ponownie.', copy.hint].filter(Boolean).join(' ')}
      </Txt>
      {onRetry ? (
        <Pressable onPress={onRetry} style={styles.darkBtn}>
          <Txt f="b7" size={17} color={colors.primaryInk}>
            Spróbuj ponownie
          </Txt>
        </Pressable>
      ) : null}
      <Pressable onPress={onRetry ? onRescan : onClose} hitSlop={8}>
        <Txt f="n8" size={14} color={colors.onDarkMuted}>
          {onRetry ? 'Zrób nowe zdjęcie' : 'Wróć'}
        </Txt>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  meter: {
    position: 'absolute',
    right: 14,
    backgroundColor: 'rgba(20,28,16,0.55)',
    borderRadius: 18,
    paddingTop: 8,
    paddingBottom: 6,
    paddingHorizontal: 8,
  },
  frame: {
    position: 'absolute',
    left: FRAME_INSET,
    top: FRAME_INSET,
    right: FRAME_INSET,
    bottom: FRAME_INSET,
    borderRadius: RING / 2 - FRAME_INSET,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(244,248,236,0.55)',
  },
  overlay: {
    backgroundColor: 'rgba(20,28,16,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  bigIcon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  card: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: 'rgba(20,28,16,0.95)',
    borderRadius: 24,
    padding: 18,
    gap: 12,
  },
  cardIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  darkBtn: {
    marginTop: 8,
    backgroundColor: colors.primary,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 24,
    boxShadow: '0px 4px 0px #4A7522',
  },
  devBtn: {
    marginTop: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
    boxShadow: 'none',
  },
});
