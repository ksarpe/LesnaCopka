import { CameraView } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, View, type LayoutRectangle } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { hapticLight } from '@/components/Button3D';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Placeholder } from '@/components/Placeholder';
import { ProgressRing } from '@/components/ProgressRing';
import { ScanSweep } from '@/components/ScanSweep';
import { Txt } from '@/components/Txt';
import { UiHost } from '@/components/UiHost';
import { detectRegion, useRegionStore } from '@/hooks/useRegion';
import { useBottomPadding, useTopInset } from '@/hooks/useInsets';
import { ServiceError, useServices } from '@/services';
import { captureFindPhoto, isCameraAvailable } from '@/services/live/camera';
import { deleteFindPhoto } from '@/services/live/findPhotos';
import { createPendingFind } from '@/store/game';
import { useSimStore } from '@/store/useSimStore';
import { ui } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';
import { colors } from '@/theme/tokens';
import type { ScanPart, ScanResult } from '@/types';

const PARTS: { key: ScanPart; label: string }[] = [
  { key: 'cap', label: 'Kapelusz' },
  { key: 'underside', label: 'Spód (rurki)' },
  { key: 'stem', label: 'Trzon' },
  { key: 'base', label: 'Podstawa trzonu' },
];


type Phase = 'permission' | 'denied' | 'scanning' | 'ready' | 'analyzing' | 'error';

const RING = 270;
const RING_THICK = 13.5;
/** Kadr wewnątrz pierścienia – tam, gdzie w makiecie placeholder „grzyb w kadrze”. */
const FRAME_INSET = 26;
/** Gdy aparat nie zgłosi gotowości, symulowany skan i tak rusza. */
const CAMERA_READY_TIMEOUT_MS = 5000;

export default function ScanScreen() {
  const services = useServices();
  const top = useTopInset();
  const bottom = useBottomPadding(40);
  const camPerm = useSimStore((s) => s.permissions.camera);
  const devMode = useSimStore((s) => s.devMode);
  // Źródło obrazu na czas skanu: prawdziwy aparat albo paskowany placeholder z makiety (panel dev / dev-linki).
  const [simCamera] = useState(() => useSimStore.getState().cameraSource === 'sim');
  const [phase, setPhase] = useState<Phase>(camPerm === 'granted' ? 'scanning' : 'permission');
  const [pct, setPct] = useState(0);
  const [parts, setParts] = useState<ScanPart[]>([]);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Aparat: zgoda, błąd podglądu (brak kamery / getUserMedia / symulator), zdjęcie już zrobione.
  const [camGranted, setCamGranted] = useState(false);
  const [camFailed, setCamFailed] = useState(false);
  const [shot, setShot] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background');
  const [frame, setFrame] = useState<LayoutRectangle | null>(null);
  const focused = useIsFocused();
  const progress = useSharedValue(0);
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<ScanResult | null>(null);
  const partsRef = useRef<ScanPart[]>([]);
  const cameraRef = useRef<CameraView>(null);
  const readyRef = useRef(false);
  const failedRef = useRef(false);
  const pendingStartRef = useRef(false);
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Skan ze zdjęciem po spuście – „Spróbuj ponownie” po błędzie sieci nie robi nowego zdjęcia. */
  const capturedRef = useRef<ScanResult | null>(null);
  /** Zdjęcie przekazane do znaleziska – od tej chwili sprząta je game.ts (porzucenie znaleziska). */
  const handedOffRef = useRef(false);
  /** Ekran zamknięty w trakcie analizy (np. „wstecz” na Androidzie) – wynik trafia do kosza. */
  const unmountedRef = useRef(false);
  const busyRef = useRef(false);

  const liveView = !simCamera && !camFailed;
  // Podgląd tylko na widocznym, aktywnym ekranie – w tle, po wyjściu i po zdjęciu aparat jest zwolniony.
  const cameraOn = liveView && camGranted && !shot && focused && appActive;

  useEffect(() => {
    if (!cameraOn) readyRef.current = false;
  }, [cameraOn]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s !== 'background'));
    return () => sub.remove();
  }, []);

  const resetScan = useCallback(() => {
    resultRef.current = null;
    partsRef.current = [];
    setPhase('scanning');
    setPct(0);
    setParts([]);
    progress.set(0);
  }, [progress]);

  const runScan = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    resetScan();
    let lastParts = 0;
    services.scan
      .startScan(
        (p, ps) => {
          progress.set(p);
          setPct(Math.round(p * 100));
          partsRef.current = ps;
          if (ps.length !== lastParts) {
            lastParts = ps.length;
            setParts(ps);
            hapticLight();
          }
        },
        { signal: ctrl.signal },
      )
      .then((res) => {
        resultRef.current = res;
        setPhase('ready');
      })
      .catch(() => {});
  }, [services, progress, resetScan]);

  /** Symulowany skan rusza, gdy podgląd jest gotowy (albo wiadomo, że go nie będzie). */
  const startWhenReady = useCallback(() => {
    if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
    resetScan();
    if (simCamera || failedRef.current || readyRef.current) {
      pendingStartRef.current = false;
      runScan();
      return;
    }
    pendingStartRef.current = true;
    readyTimerRef.current = setTimeout(() => {
      if (!pendingStartRef.current) return;
      pendingStartRef.current = false;
      runScan();
    }, CAMERA_READY_TIMEOUT_MS);
  }, [simCamera, resetScan, runScan]);

  const flushPendingStart = useCallback(() => {
    if (!pendingStartRef.current) return;
    pendingStartRef.current = false;
    if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
    runScan();
  }, [runScan]);

  const onCameraReady = useCallback(() => {
    // Web po błędzie getUserMedia zgłasza też „gotowość” – zostajemy wtedy przy placeholderze.
    if (failedRef.current) return;
    readyRef.current = true;
    flushPendingStart();
  }, [flushPendingStart]);

  // Brak kamery / błąd podglądu (np. symulator, kamera zajęta) – placeholder, a skan idzie dalej bez zdjęcia.
  const onMountError = useCallback(() => {
    failedRef.current = true;
    readyRef.current = false;
    setCamFailed(true);
    setFlash(false);
    flushPendingStart();
  }, [flushPendingStart]);

  const onGranted = useCallback(() => {
    setCamGranted(true);
    startWhenReady();
  }, [startWhenReady]);

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
        runScan();
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
      if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
      // Zdjęcie, które nie trafiło do znaleziska (np. błąd sieci i zamknięcie skanu), nie zostaje na dysku.
      const photo = capturedRef.current?.photoUri;
      if (photo && !handedOffRef.current) deleteFindPhoto(photo);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Powrót z ustawień telefonu po odmowie – jeśli zgoda jest już nadana, skan rusza sam.
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

  const analyze = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    abortRef.current?.abort();
    pendingStartRef.current = false;
    setPhase('analyzing');
    try {
      let scan = capturedRef.current;
      if (!scan) {
        const base = resultRef.current ?? services.scan.capturePartial(partsRef.current);
        // Zdjęcie spustem, gdy podgląd działa. Błąd zdjęcia nigdy nie blokuje rozpoznania.
        const cam = cameraRef.current;
        const photoUri = cam && readyRef.current ? await captureFindPhoto(cam) : undefined;
        if (unmountedRef.current) {
          if (photoUri) deleteFindPhoto(photoUri);
          return;
        }
        scan = photoUri ? { ...base, photoUri } : base;
        capturedRef.current = scan;
        setShot(true);
      }
      let region = useRegionStore.getState().region;
      if (!region) region = await detectRegion(services, { askPermission: false });
      const gminaId = region?.gmina.id ?? useUserStore.getState().user.homeGminaId;
      const id = await services.identify.identify(scan);
      // Zamknięty ekran: zdjęcie skasował już cleanup, a router.replace podmieniłby ekran, na którym jest gracz.
      if (unmountedRef.current) return;
      const find = createPendingFind(id, gminaId, { photoUri: scan.photoUri, parts: scan.parts });
      handedOffRef.current = true;
      router.replace(`/analysis/${find.id}`);
    } catch (e) {
      if (unmountedRef.current) return;
      setError(e instanceof ServiceError ? e.message : 'Nie udało się rozpoznać grzyba');
      setPhase('error');
    } finally {
      busyRef.current = false;
    }
  };

  /** „Zeskanuj od nowa” po błędzie: zdjęcie do kosza, aparat wraca. */
  const rescan = () => {
    const photo = capturedRef.current?.photoUri;
    capturedRef.current = null;
    if (photo) deleteFindPhoto(photo);
    setShot(false);
    startWhenReady();
  };

  const canShoot = phase === 'ready' || (devMode && phase === 'scanning');
  // Latarka: w symulacji jak w makiecie, z aparatem – tylko natywnie i przy działającym podglądzie.
  const torchOk = simCamera || (cameraOn && Platform.OS !== 'web');
  const camLabel = simCamera ? 'podgląd kamery' : camFailed ? 'podgląd kamery niedostępny' : ' ';

  const onFlash = () => {
    if (!torchOk) {
      ui.toast(!simCamera && Platform.OS === 'web' ? 'Latarka niedostępna w przeglądarce' : 'Latarka niedostępna', 'flash_off');
      return;
    }
    setFlash((f) => !f);
    ui.toast(flash ? 'Latarka wyłączona' : 'Latarka włączona', 'flash_on');
  };

  const onClose = () => {
    const inProgress = (phase === 'scanning' && pct > 0) || phase === 'ready';
    if (!inProgress) {
      abortRef.current?.abort();
      router.back();
      return;
    }
    ui.confirm({
      title: 'Przerwać skan?',
      message: 'Zebrane ujęcia zostaną odrzucone. Możesz zacząć od nowa w każdej chwili.',
      icon: 'center_focus_strong',
      confirmLabel: 'Przerwij skan',
      cancelLabel: 'Skanuj dalej',
      danger: true,
      onConfirm: () => {
        abortRef.current?.abort();
        router.back();
      },
    });
  };


  return (
    <View style={{ flex: 1, backgroundColor: colors.camera }}>
      <StatusBar style="light" />
      {liveView ? null : <Placeholder variant="camera" stripe={12} style={StyleSheet.absoluteFill} />}
      {cameraOn ? (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
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
            Skan 360°
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
          <ProgressRing
            size={RING}
            thickness={RING_THICK}
            progress={progress}
            color={colors.scanGreen}
            track="rgba(255,255,255,0.16)"
            style={StyleSheet.absoluteFill}
          />
          <ScanSweep size={RING} thickness={RING_THICK} running={phase === 'scanning' || phase === 'ready'} />
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
          {parts.length > 0 ? (
            <Animated.View
              entering={FadeIn.duration(200)}
              style={{
                position: 'absolute',
                left: RING / 2 - 14,
                top: -14,
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: colors.scanGreen,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="check" filled size={18} color={colors.primaryInk} />
            </Animated.View>
          ) : null}
        </View>

        <View style={{ alignItems: 'center', gap: 4 }}>
          <Txt f="b7" size={44} lh={1} color={colors.onDark} style={{ fontVariant: ['tabular-nums'] }}>
            {pct}%
          </Txt>
          <Txt f="n7" size={15} color={colors.onDarkSoft}>
            {phase === 'denied'
              ? 'Brak dostępu do aparatu'
              : phase === 'ready'
                ? 'Gotowe! Naciśnij spust'
                : 'Obejdź grzyba powoli dookoła'}
          </Txt>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
          {PARTS.map((p) => {
            const done = parts.includes(p.key);
            return (
              <View
                key={p.key}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  borderRadius: 999,
                  paddingVertical: 6,
                  paddingHorizontal: 11,
                  backgroundColor: done ? 'rgba(159,210,102,0.2)' : 'rgba(255,255,255,0.1)',
                  borderWidth: done ? 0 : 1.5,
                  borderStyle: 'dashed',
                  borderColor: 'rgba(255,255,255,0.4)',
                }}
              >
                <Icon
                  name={done ? 'check_circle' : 'radio_button_unchecked'}
                  size={16}
                  color={done ? colors.scanChipText : colors.onDark}
                />
                <Txt f="n8" size={13} color={done ? colors.scanChipText : colors.onDark}>
                  {p.label}
                </Txt>
              </View>
            );
          })}
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
            Odsłoń delikatnie podstawę trzonu – to klucz do odróżnienia gatunków trujących.
          </Txt>
        </View>

        <Shutter enabled={canShoot} ready={phase === 'ready'} onPress={analyze} />
      </View>

      {phase === 'analyzing' ? <Analyzing /> : null}
      {phase === 'denied' ? <CameraDenied onOpenSettings={openSettings} /> : null}
      {phase === 'error' ? <ScanError message={error} onRetry={analyze} onRescan={rescan} /> : null}
      <UiHost />
    </View>
  );
}

/** Kolor przyciemnienia nad żywym obrazem (zieleń z tła aparatu). */
const SCRIM = '16,22,12';

/**
 * Czytelność UI na żywym obrazie: lekkie przyciemnienie poza pierścieniem (wnętrze kadru zostaje czyste)
 * i gradienty pod nagłówkiem oraz pod procentem, częściami grzyba, podpowiedzią i spustem.
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

function Shutter({ enabled, ready, onPress }: { enabled: boolean; ready: boolean; onPress: () => void }) {
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
        accessibilityLabel="Zrób zdjęcie i rozpoznaj"
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

/** „Analizuję…” – pulsujący loader (~1.5 s, czas odpowiedzi IdentifyService). */
function Analyzing() {
  const s = useSharedValue(0);
  useEffect(() => {
    s.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [s]);
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: 1 + s.value * 0.18 }], opacity: 0.55 + s.value * 0.45 }));
  const core = useAnimatedStyle(() => ({ transform: [{ scale: 1 + s.value * 0.06 }] }));
  return (
    <Animated.View entering={FadeIn.duration(180)} style={[StyleSheet.absoluteFill, styles.overlay]}>
      <View style={{ width: 150, height: 150, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View
          style={[
            { position: 'absolute', width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(159,210,102,0.25)' },
            ring,
          ]}
        />
        <Animated.View
          style={[
            { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.scanGreen, alignItems: 'center', justifyContent: 'center' },
            core,
          ]}
        >
          <Icon name="auto_awesome" filled size={44} color={colors.primaryInk} />
        </Animated.View>
      </View>
      <Txt f="b7" size={30} color={colors.onDark} style={{ marginTop: 26 }}>
        Analizuję…
      </Txt>
      <Txt f="n7" size={15} color={colors.onDarkSoft} align="center">
        Porównuję kapelusz, rurki i trzon{'\n'}z atlasem 120 gatunków
      </Txt>
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
        Skan 360° potrzebuje aparatu, żeby rozpoznać gatunek. Zdjęcia nie opuszczają telefonu bez Twojej zgody.
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

function ScanError({ message, onRetry, onRescan }: { message: string | null; onRetry: () => void; onRescan: () => void }) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay, { gap: 12, paddingHorizontal: 32 }]}>
      <View style={styles.bigIcon}>
        <Icon name="wifi_off" size={40} color={colors.onDark} />
      </View>
      <Txt f="b7" size={24} color={colors.onDark} align="center" lh={1.15}>
        Nie udało się rozpoznać
      </Txt>
      <Txt f="n6" size={14} color={colors.onDarkSoft} align="center">
        {message ?? 'Spróbuj ponownie.'} Skan jest zapisany – spróbuj, gdy wróci zasięg.
      </Txt>
      <Pressable onPress={onRetry} style={styles.darkBtn}>
        <Txt f="b7" size={17} color={colors.primaryInk}>
          Spróbuj ponownie
        </Txt>
      </Pressable>
      <Pressable onPress={onRescan} hitSlop={8}>
        <Txt f="n8" size={14} color={colors.onDarkMuted}>
          Zeskanuj od nowa
        </Txt>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
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
  darkBtn: {
    marginTop: 8,
    backgroundColor: colors.primary,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 24,
    boxShadow: '0px 4px 0px #4A7522',
  },
});
