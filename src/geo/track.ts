/**
 * Ślad wyprawy – czyste funkcje (bez React / expo), testy w src/geo/__tests__/track.test.ts:
 *  - dystans z odczytów GPS z odfiltrowaniem szumu (słaba dokładność, drganie, nierealne skoki),
 *  - symulowany spacer (tryb symulacji i panel /dev),
 *  - przybliżona trasa do publikacji: strefy prywatności wokół startu i mety każdego odcinka
 *    (dom, parking) + uproszczenie Douglasa–Peuckera,
 *  - kadr mapy dopasowany do trasy.
 *
 * Prywatność: punkty śladu żyją wyłącznie w pamięci (useTrackStore) – nigdy nie są zapisywane
 * ani wysyłane. Pokazać (i docelowo opublikować) można co najwyżej wynik `approximateRoute`.
 */
import { mulberry32 } from '@/utils/random';

import { M_PER_DEG_LAT, metersPerDegLon } from './geometry';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface TrackPoint extends LatLon {
  /** Promień niepewności (m). */
  accuracyM: number;
  /** Czas odczytu (ms od epoki). */
  t: number;
  /** Pierwszy punkt nowego odcinka (start śledzenia, powrót po jeździe autem / skoku GPS). */
  newSegment?: boolean;
}

const EARTH_R = 6_371_008.8;
const RAD = Math.PI / 180;

/** Odległość po kole wielkim (m). */
export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Długość łamanej (m). */
export function pathLengthM(points: readonly LatLon[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversineM(points[i - 1], points[i]);
  return d;
}

/** Dzieli ślad na odcinki (`newSegment`) – między odcinkami nie rysujemy linii. */
export function splitSegments<T extends TrackPoint>(points: readonly T[]): T[][] {
  const out: T[][] = [];
  for (const p of points) {
    if (p.newSegment || !out.length) out.push([p]);
    else out[out.length - 1].push(p);
  }
  return out;
}

/* ───────────────────────── Filtr dystansu ───────────────────────── */

export interface DistanceFilterOptions {
  /** Odczyty mniej dokładne niż to (m) odrzucamy. */
  maxAccuracyM: number;
  /** Minimalny krok (m) – mniejsze przesunięcia to drganie GPS na postoju. */
  minStepM: number;
  /** Część niepewności GPS traktowana jako drganie: próg kroku = max(minStepM, k × dokładność). */
  jitterK: number;
  /**
   * Min. średnia prędkość od ostatniego punktu (km/h). Dryf GPS na postoju jest ograniczony,
   * więc z czasem jego „prędkość” spada do zera; prawdziwy (nawet powolny) ruch zostanie
   * doliczony w całości, gdy tylko grzybiarz ruszy szybciej – punkt odniesienia się nie zmienia.
   */
  minSpeedKmh: number;
  /** Maks. prędkość marszu (km/h) – szybsze przesunięcia to skok GPS albo jazda autem. */
  maxSpeedKmh: number;
  /** Po tylu skokach z rzędu przyjmujemy nową pozycję jako początek odcinka (bez doliczania dystansu). */
  reanchorAfter: number;
}

export const DISTANCE_FILTER: DistanceFilterOptions = {
  maxAccuracyM: 35,
  minStepM: 4,
  jitterK: 1,
  minSpeedKmh: 0.5,
  maxSpeedKmh: 12,
  reanchorAfter: 3,
};

export type RejectReason = 'invalid' | 'accuracy' | 'jitter' | 'drift' | 'jump' | 'stale';

export type FixVerdict =
  | {
      accepted: true;
      /** Przyrost dystansu (m) od poprzedniego przyjętego punktu. */
      deltaM: number;
      /** Punkt zaczyna nowy odcinek (pierwszy odczyt albo powrót po serii skoków). */
      newSegment: boolean;
    }
  | { accepted: false; reason: RejectReason };

/**
 * Dystans z kolejnych odczytów GPS. Porównujemy z ostatnim PRZYJĘTYM punktem, więc powolny marsz
 * w końcu przekracza próg drgania i nic nie ginie, a drganie na postoju nie nabija kilometrów.
 */
export class DistanceFilter {
  private last: TrackPoint | null = null;
  private jumps = 0;

  constructor(private readonly opts: DistanceFilterOptions = DISTANCE_FILTER) {}

  /** Zapomina ostatni punkt – kolejny odczyt zacznie nowy odcinek bez doliczania dystansu. */
  reset() {
    this.last = null;
    this.jumps = 0;
  }

  push(fix: TrackPoint): FixVerdict {
    const o = this.opts;
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon) || !Number.isFinite(fix.t)) {
      return { accepted: false, reason: 'invalid' };
    }
    // `!(a <= b)` odrzuca też NaN.
    if (!(fix.accuracyM <= o.maxAccuracyM)) return { accepted: false, reason: 'accuracy' };
    const last = this.last;
    if (!last) {
      this.last = fix;
      return { accepted: true, deltaM: 0, newSegment: true };
    }
    const dt = (fix.t - last.t) / 1000;
    if (dt <= 0) return { accepted: false, reason: 'stale' };
    const d = haversineM(last, fix);
    if (d < Math.max(o.minStepM, o.jitterK * Math.max(last.accuracyM, fix.accuracyM))) {
      // Odczyt zgodny z ostatnim punktem – ten punkt jest wiarygodny, licznik skoków od zera.
      this.jumps = 0;
      return { accepted: false, reason: 'jitter' };
    }
    const speed = d / dt;
    if (speed < o.minSpeedKmh / 3.6) {
      this.jumps = 0;
      return { accepted: false, reason: 'drift' };
    }
    if (speed > o.maxSpeedKmh / 3.6) {
      this.jumps += 1;
      if (this.jumps >= o.reanchorAfter) {
        // Kilka „skoków” z rzędu = naprawdę jesteśmy gdzie indziej (auto, zgubiony sygnał):
        // nowy odcinek, ale bez doliczania przejechanych kilometrów.
        this.last = fix;
        this.jumps = 0;
        return { accepted: true, deltaM: 0, newSegment: true };
      }
      return { accepted: false, reason: 'jump' };
    }
    this.jumps = 0;
    this.last = fix;
    return { accepted: true, deltaM: d, newSegment: false };
  }
}

/* ───────────────────────── Rzut lokalny (metry) ───────────────────────── */

/** Rzut równoodległościowy wokół punktu – wystarczający dla obszaru kilkunastu km. */
function localProjection(origin: LatLon) {
  const kx = metersPerDegLon(origin.lat);
  const ky = M_PER_DEG_LAT;
  return {
    x: (p: LatLon) => (p.lon - origin.lon) * kx,
    y: (p: LatLon) => (p.lat - origin.lat) * ky,
    back: (x: number, y: number): LatLon => ({ lat: origin.lat + y / ky, lon: origin.lon + x / kx }),
  };
}

/* ───────────────────────── Symulowany spacer ───────────────────────── */

export interface WalkState extends LatLon {
  /** Kierunek marszu (rad, 0 = północ, zgodnie z ruchem wskazówek). */
  heading: number;
}

/** Skręty: odchylenie kierunku rośnie z pierwiastkiem kroku – kształt trasy nie zależy od długości kroku. */
const TURN_PER_SQRT_M = 0.09;

/**
 * Następny punkt symulowanego spaceru: łagodne, losowe skręty; dalej niż 60% `maxRadiusM`
 * od punktu startu spacer stopniowo zawraca, więc trasa krąży po okolicy jak grzybiarz po lesie.
 */
export function nextWalkPoint(state: WalkState, stepM: number, rnd: () => number, origin: LatLon, maxRadiusM = 900): WalkState {
  let heading = state.heading + (rnd() - 0.5) * 2 * TURN_PER_SQRT_M * Math.sqrt(Math.max(0, stepM));
  const pr = localProjection(origin);
  const x = pr.x(state);
  const y = pr.y(state);
  const dist = Math.hypot(x, y);
  const soft = maxRadiusM * 0.6;
  if (dist > soft) {
    const home = Math.atan2(-x, -y);
    let diff = home - heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const w = Math.min(1, (dist - soft) / (maxRadiusM - soft)) * Math.min(1, stepM / 40);
    heading += diff * Math.max(0.05, w);
  }
  heading = Math.atan2(Math.sin(heading), Math.cos(heading));
  const next = pr.back(x + stepM * Math.sin(heading), y + stepM * Math.cos(heading));
  return { ...next, heading };
}

/**
 * Spacer o zadanej długości: punkty co `stepM` metrów z czasem jak przy marszu `speedKmh`.
 * Zwraca nowe punkty (bez punktu startowego) i stan do kontynuacji.
 */
export function simulateWalk(
  from: WalkState,
  origin: LatLon,
  km: number,
  opts: { rnd: () => number; t0: number; stepM?: number; speedKmh?: number; maxRadiusM?: number },
): { points: TrackPoint[]; state: WalkState } {
  const stepM = opts.stepM ?? 15;
  const speed = (opts.speedKmh ?? 4.2) / 3.6;
  const total = Math.max(0, km * 1000);
  const points: TrackPoint[] = [];
  let state = from;
  let walked = 0;
  let t = opts.t0;
  while (walked < total - 1e-6) {
    const step = Math.min(stepM, total - walked);
    state = nextWalkPoint(state, step, opts.rnd, origin, opts.maxRadiusM);
    walked += step;
    t += (step / speed) * 1000;
    points.push({ lat: state.lat, lon: state.lon, accuracyM: 8, t: Math.round(t) });
  }
  return { points, state };
}

/* ───────────────────────── Przybliżona trasa ───────────────────────── */

export interface ApproximateOptions {
  /** Promień strefy prywatności wokół startu i końca każdego odcinka (m). */
  zoneM?: number;
  /** Tolerancja uproszczenia Douglasa–Peuckera (m). */
  simplifyM?: number;
  /** Krótsze kawałki (m) po wycięciu stref pomijamy. */
  minPieceM?: number;
  /**
   * Ziarno losowego przesunięcia stref (np. hash id wyprawy). Środek strefy nie leży dokładnie
   * w punkcie startu, a promień jest nieco większy – z kształtu wycięcia nie da się wskazać domu.
   */
  seed?: number;
}

interface Zone {
  x: number;
  y: number;
  r: number;
}

/** Douglas–Peucker (iteracyjnie) na punktach płaskich (metry, piksele); zwraca indeksy, końce zawsze zostają. */
export function simplifyXY(xs: number[], ys: number[], tol: number): number[] {
  const n = xs.length;
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = xs[a];
    const ay = ys[a];
    const dx = xs[b] - ax;
    const dy = ys[b] - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = tol2;
    for (let i = a + 1; i < b; i++) {
      let t = len2 > 0 ? ((xs[i] - ax) * dx + (ys[i] - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = xs[i] - (ax + t * dx);
      const ey = ys[i] - (ay + t * dy);
      const d2 = ex * ex + ey * ey;
      if (d2 > bestD) {
        bestD = d2;
        best = i;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out: number[] = [];
  keep.forEach((k, i) => k && out.push(i));
  return out;
}

/** Uproszczenie łamanej (Douglas–Peucker) z tolerancją w metrach. */
export function simplifyPath(points: readonly LatLon[], toleranceM: number): LatLon[] {
  if (points.length <= 2) return points.map((p) => ({ lat: p.lat, lon: p.lon }));
  const pr = localProjection(points[0]);
  const idx = simplifyXY(points.map(pr.x), points.map(pr.y), toleranceM);
  return idx.map((i) => ({ lat: points[i].lat, lon: points[i].lon }));
}

const inZone = (x: number, y: number, zones: Zone[]) => zones.some((z) => (x - z.x) ** 2 + (y - z.y) ** 2 < z.r * z.r);

/**
 * Trasa, którą wolno pokazać i opublikować jako „przybliżoną”: bez fragmentów w strefach
 * prywatności (start i koniec każdego odcinka – dom, parking), uproszczona do ~`simplifyM`.
 * Pusta tablica = po wycięciu stref nic sensownego nie zostaje (za krótka trasa).
 */
export function approximateRoute(segments: readonly (readonly LatLon[])[], opts: ApproximateOptions = {}): LatLon[][] {
  const zoneM = opts.zoneM ?? 200;
  const simplifyM = opts.simplifyM ?? 50;
  const minPieceM = opts.minPieceM ?? 40;
  const segs = segments.filter((s) => s.length >= 2);
  if (!segs.length) return [];
  const pr = localProjection(segs[0][0]);
  const rnd = mulberry32(opts.seed ?? 0);

  const zones: Zone[] = [];
  for (const s of segs) {
    for (const p of [s[0], s[s.length - 1]]) {
      const ang = rnd() * Math.PI * 2;
      const off = rnd() * zoneM * 0.25;
      zones.push({ x: pr.x(p) + off * Math.sin(ang), y: pr.y(p) + off * Math.cos(ang), r: zoneM * (1 + rnd() * 0.3) });
    }
  }

  const pieces: LatLon[][] = [];
  for (const s of segs) {
    let cur: { x: number; y: number }[] = [];
    const flush = () => {
      if (cur.length >= 2) {
        let len = 0;
        for (let i = 1; i < cur.length; i++) len += Math.hypot(cur[i].x - cur[i - 1].x, cur[i].y - cur[i - 1].y);
        if (len >= minPieceM) {
          const idx = simplifyXY(
            cur.map((p) => p.x),
            cur.map((p) => p.y),
            simplifyM,
          );
          pieces.push(idx.map((i) => pr.back(cur[i].x, cur[i].y)));
        }
      }
      cur = [];
    };
    let px = pr.x(s[0]);
    let py = pr.y(s[0]);
    let pIn = inZone(px, py, zones);
    if (!pIn) cur.push({ x: px, y: py });
    for (let i = 1; i < s.length; i++) {
      const x = pr.x(s[i]);
      const y = pr.y(s[i]);
      const nIn = inZone(x, y, zones);
      if (pIn !== nIn) {
        // Dokładne przecięcie z brzegiem strefy (bisekcja na odcinku).
        let lo = 0;
        let hi = 1;
        for (let k = 0; k < 24; k++) {
          const mid = (lo + hi) / 2;
          if (inZone(px + (x - px) * mid, py + (y - py) * mid, zones) === pIn) lo = mid;
          else hi = mid;
        }
        const t = pIn ? hi : lo;
        const cx = px + (x - px) * t;
        const cy = py + (y - py) * t;
        if (pIn) cur.push({ x: cx, y: cy });
        else {
          cur.push({ x: cx, y: cy });
          flush();
        }
      }
      if (!nIn) cur.push({ x, y });
      px = x;
      py = y;
      pIn = nIn;
    }
    flush();
  }
  return pieces;
}

/* ───────────────────────── Kadr mapy ───────────────────────── */

export interface RouteViewport {
  /** Środek kadru. */
  center: LatLon;
  /** Skala widoku (m na piksel ekranu). */
  mPerPx: number;
  /** Promień obszaru mapy do pobrania (m) – pokrywa cały kadr. */
  radiusM: number;
}

/**
 * Kadr `w × h` px obejmujący wszystkie odcinki z marginesem `padPx` (u góry `padTopPx` – miejsce
 * na pigułkę z nazwą gminy). Skala w granicach [minMPerPx, maxMPerPx] – krótka trasa nie robi się
 * „pikselowa”, długa zostaje czytelna. Środek kadru = środek ekranu (tak rysuje AreaMapView).
 */
export function fitRoute(
  segments: readonly (readonly LatLon[])[],
  w: number,
  h: number,
  opts: { padPx?: number; padTopPx?: number; minMPerPx?: number; maxMPerPx?: number } = {},
): RouteViewport | null {
  const pad = opts.padPx ?? 22;
  const padTop = opts.padTopPx ?? pad;
  let s = Infinity;
  let n = -Infinity;
  let west = Infinity;
  let e = -Infinity;
  for (const seg of segments)
    for (const p of seg) {
      s = Math.min(s, p.lat);
      n = Math.max(n, p.lat);
      west = Math.min(west, p.lon);
      e = Math.max(e, p.lon);
    }
  if (!Number.isFinite(s) || w <= 2 * pad || h <= pad + padTop) return null;
  const mid = { lat: (s + n) / 2, lon: (west + e) / 2 };
  const widthM = (e - west) * metersPerDegLon(mid.lat);
  const heightM = (n - s) * M_PER_DEG_LAT;
  const fit = Math.max(widthM / (w - 2 * pad), heightM / (h - pad - padTop));
  const mPerPx = Math.max(opts.minMPerPx ?? 3, Math.min(opts.maxMPerPx ?? 30, fit));
  // Większy margines u góry: trasa schodzi o (padTop − pad) / 2 px w dół – środek kadru na północ.
  const center = { lat: mid.lat + (((padTop - pad) / 2) * mPerPx) / M_PER_DEG_LAT, lon: mid.lon };
  // Kafle pobieramy w kwadracie ±radiusM – musi objąć dłuższy bok kadru.
  const radiusM = Math.ceil((Math.max(w, h) / 2) * mPerPx + 100);
  return { center, mPerPx, radiusM };
}
