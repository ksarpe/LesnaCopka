/**
 * Skan 3D – postęp obchodzenia grzyba z czujników ruchu (expo-sensors DeviceMotion). Czysta logika bez Reacta
 * i modułów natywnych – testy: src/scan/__tests__/orbit.test.ts.
 *
 * Kierunek aparatu: orientacja telefonu (alpha, beta, gamma – kąty Eulera W3C, obroty Z-X'-Y'') złożona w macierz
 * obrotu; tylny aparat patrzy wzdłuż -Z urządzenia. iOS (CMAttitude yaw/pitch/roll) i Android (rotation vector
 * → getOrientation) podają te kąty w tej samej konwencji, a złożenie macierzy jest odporne na blokadę przegubu
 * przy telefonie w pionie (beta ≈ 90°). Wynik: azymut (0–360°, zgodnie z ruchem wskazówek zegara patrząc z góry;
 * liczy się tylko względny – odniesienie zależy od systemu) i elewacja (-90° = prosto w dół, 0° = poziomo).
 *
 * Obchodząc grzyba z aparatem skierowanym na niego, azymut aparatu obraca się razem z nami: 12 sektorów po 30°
 * względem kierunku z początku skanu (sektor 0 = start). Do tego ujęcie z góry (aparat mocno w dół) i nisko przy
 * ziemi (aparat prawie poziomo – widać spód kapelusza i trzon). Liczy się tylko spokojny ruch: obrót szybszy niż
 * ORBIT.maxRateDps (machanie telefonem) nie zalicza niczego.
 */

export const ORBIT = {
  sectors: 12,
  /** Sektory do zaliczenia: 9 × 30° = 270° – pełne koło bywa w lesie niemożliwe (drzewo, krzak, stromizna). */
  sectorsNeeded: 9,
  /** Spokojny czas w sektorze, po którym jest zaliczony. */
  dwellMs: 250,
  /** Spokojny czas w ujęciu z góry / przy ziemi. */
  holdMs: 500,
  /** Szybszy obrót telefonu (°/s) to machanie – nie zalicza sektorów ani ujęć. */
  maxRateDps: 90,
  /** Zdjęcie do skanu tylko przy wolniejszym obrocie (°/s) – ostre ujęcia. */
  captureRateDps: 45,
  /** Elewacja aparatu: z góry (≤), nisko przy ziemi (≥), dolna granica sektorów boku, niebo (> – pomijane). */
  topEl: -60,
  lowEl: -20,
  sideMinEl: -78,
  skyEl: 50,
  /** Udział w postępie: obejście, z góry, przy ziemi (suma 1). */
  weights: { orbit: 0.6, top: 0.2, low: 0.2 },
  /** Najdłuższy krok czasu z jednej próbki – przerwa (tło, zacięcie) nie zalicza niczego „za darmo”. */
  maxDtMs: 150,
  /** Tyle szybkiego ruchu z rzędu (ms) → podpowiedź „wolniej”. */
  slowHintMs: 400,
} as const;

const SECTOR_DEG = 360 / ORBIT.sectors;
const DEG = 180 / Math.PI;

/** Orientacja telefonu (radiany) – `rotation` z DeviceMotion. */
export interface Rotation {
  alpha: number;
  beta: number;
  gamma: number;
}

/** Kierunek aparatu (stopnie): azymut 0–360, elewacja -90..90. */
export interface Direction {
  az: number;
  el: number;
}

export interface OrbitSample {
  /** Czas próbki (ms, monotoniczny). */
  t: number;
  rotation: Rotation;
  /** Prędkość obrotu telefonu (°/s) – długość wektora `rotationRate`; brak pomiaru = 0. */
  rateDps: number;
}

export interface OrbitState {
  /** Azymut aparatu na początku skanu (pierwsza spokojna próbka) – sektor 0. */
  startAz: number | null;
  /** Spokojny czas (ms) w każdym sektorze obejścia. */
  sectorMs: number[];
  topMs: number;
  lowMs: number;
  /** Szybki ruch z rzędu (ms) – podpowiedź „wolniej”. */
  fastMs: number;
  lastT: number | null;
  /** Ostatnia próbka: kierunek aparatu i czy ruch był spokojny (zdjęcie ostre). */
  dir: Direction | null;
  rateDps: number;
}

export interface OrbitCoverage {
  /** Zaliczone sektory obejścia (indeks = sektor, 0 = start). */
  sectors: boolean[];
  covered: number;
  top: boolean;
  low: boolean;
  /** 0..1 – grzybek w rogu. */
  progress: number;
  done: boolean;
}

export type OrbitHint = 'start' | 'orbit' | 'low' | 'top' | 'slow' | 'done';

/** Miejsce ujęcia do skanu: bok w danym sektorze, z góry albo przy ziemi. */
export type ViewSlot = { kind: 'side'; sector: number } | { kind: 'top' } | { kind: 'low' };

export const wrap360 = (deg: number) => ((deg % 360) + 360) % 360;

/** Kierunek tylnego aparatu: R = Rz(α)·Rx(β)·Ry(γ), aparat = R·(0, 0, -1). */
export function cameraDirection(r: Rotation): Direction {
  const ca = Math.cos(r.alpha);
  const sa = Math.sin(r.alpha);
  const cb = Math.cos(r.beta);
  const sb = Math.sin(r.beta);
  const cg = Math.cos(r.gamma);
  const sg = Math.sin(r.gamma);
  const x = -ca * sg - sa * sb * cg;
  const y = -sa * sg + ca * sb * cg;
  const z = -cb * cg;
  return { az: wrap360(Math.atan2(x, y) * DEG), el: Math.asin(Math.max(-1, Math.min(1, z))) * DEG };
}

/** Odwrotność cameraDirection przy gamma = 0 (symulacja obchodzenia w narzędziach dev, testy). */
export function rotationFor(dir: Direction): Rotation {
  return { alpha: -dir.az / DEG, beta: Math.acos(-Math.sin(dir.el / DEG)), gamma: 0 };
}

export function initialOrbit(): OrbitState {
  return {
    startAz: null,
    sectorMs: new Array<number>(ORBIT.sectors).fill(0),
    topMs: 0,
    lowMs: 0,
    fastMs: 0,
    lastT: null,
    dir: null,
    rateDps: 0,
  };
}

/** Sektor obejścia dla azymutu względnego (sektor 0 = ±15° od startu). */
export function sectorOf(relAz: number): number {
  return Math.floor(wrap360(relAz + SECTOR_DEG / 2) / SECTOR_DEG) % ORBIT.sectors;
}

/** Azymut względem startu (0–360) – pozycja na pierścieniu; null przed startem. */
export function relativeAz(s: OrbitState): number | null {
  return s.startAz == null || !s.dir ? null : wrap360(s.dir.az - s.startAz);
}

/** Kolejna próbka czujników → nowy stan (zaliczanie sektorów, ujęcia z góry / przy ziemi, szybki ruch). */
export function orbitStep(s: OrbitState, sample: OrbitSample): OrbitState {
  const dir = cameraDirection(sample.rotation);
  const dt = s.lastT == null ? 0 : Math.max(0, Math.min(ORBIT.maxDtMs, sample.t - s.lastT));
  const next: OrbitState = { ...s, lastT: sample.t, dir, rateDps: sample.rateDps };
  if (sample.rateDps > ORBIT.maxRateDps) {
    next.fastMs = s.fastMs + dt;
    return next;
  }
  next.fastMs = 0;
  // Aparat w niebo – to nie celowanie w grzyba.
  if (dir.el > ORBIT.skyEl) return next;
  if (next.startAz == null) next.startAz = dir.az;
  if (dt <= 0) return next;
  if (dir.el >= ORBIT.sideMinEl) {
    const sector = sectorOf(dir.az - next.startAz);
    next.sectorMs = s.sectorMs.slice();
    next.sectorMs[sector] += dt;
  }
  if (dir.el <= ORBIT.topEl) next.topMs = s.topMs + dt;
  if (dir.el >= ORBIT.lowEl) next.lowMs = s.lowMs + dt;
  return next;
}

export function orbitCoverage(s: OrbitState): OrbitCoverage {
  const sectors = s.sectorMs.map((ms) => ms >= ORBIT.dwellMs);
  const covered = sectors.filter(Boolean).length;
  // Postęp płynny: też część czasu w sektorze, który jeszcze się zalicza.
  const partial = s.sectorMs.reduce((sum, ms) => sum + Math.min(1, ms / ORBIT.dwellMs), 0);
  const w = ORBIT.weights;
  const raw =
    w.orbit * Math.min(1, partial / ORBIT.sectorsNeeded) +
    w.top * Math.min(1, s.topMs / ORBIT.holdMs) +
    w.low * Math.min(1, s.lowMs / ORBIT.holdMs);
  const top = s.topMs >= ORBIT.holdMs;
  const low = s.lowMs >= ORBIT.holdMs;
  const done = covered >= ORBIT.sectorsNeeded && top && low;
  return { sectors, covered, top, low, progress: done ? 1 : Math.min(0.99, raw), done };
}

/** Co teraz podpowiedzieć: najpierw obejście, potem przy ziemi, na końcu z góry. */
export function orbitHint(s: OrbitState, cov: OrbitCoverage = orbitCoverage(s)): OrbitHint {
  if (cov.done) return 'done';
  if (s.fastMs >= ORBIT.slowHintMs) return 'slow';
  if (s.startAz == null) return 'start';
  if (cov.covered < ORBIT.sectorsNeeded) return 'orbit';
  if (!cov.low) return 'low';
  return 'top';
}

export const slotKey = (slot: ViewSlot) => (slot.kind === 'side' ? `side:${slot.sector}` : slot.kind);

/**
 * Ujęcie do zrobienia teraz (albo null): tylko przy spokojnym ruchu i aparacie na grzybie. Z góry i przy ziemi
 * mają pierwszeństwo, dopóki ich nie ma; potem – bok w bieżącym sektorze, jeśli jeszcze bez zdjęcia.
 */
export function viewSlot(s: OrbitState, has: (key: string) => boolean): ViewSlot | null {
  const dir = s.dir;
  if (!dir || s.startAz == null || s.rateDps > ORBIT.captureRateDps || dir.el > ORBIT.skyEl) return null;
  if (dir.el <= ORBIT.topEl && !has('top')) return { kind: 'top' };
  if (dir.el >= ORBIT.lowEl && !has('low')) return { kind: 'low' };
  if (dir.el < ORBIT.sideMinEl) return null;
  const side: ViewSlot = { kind: 'side', sector: sectorOf(dir.az - s.startAz) };
  return has(slotKey(side)) ? null : side;
}
