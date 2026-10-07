import { describe, expect, it } from '@jest/globals';

import {
  approximateRoute,
  DistanceFilter,
  fitRoute,
  haversineM,
  nextWalkPoint,
  pathLengthM,
  simplifyPath,
  simulateWalk,
  splitSegments,
  type LatLon,
  type TrackPoint,
  type WalkState,
} from '../track';
import { mulberry32 } from '@/utils/random';

/** Supraśl – punkt odniesienia testów. */
const O: LatLon = { lat: 53.2097, lon: 23.3364 };
const M_LAT = 1 / 111_250;
const M_LON = 1 / (111_320 * Math.cos((O.lat * Math.PI) / 180));

/** Punkt przesunięty o (dx na wschód, dy na północ) metrów. */
const at = (dx: number, dy: number, t = 0, accuracyM = 8): TrackPoint => ({
  lat: O.lat + dy * M_LAT,
  lon: O.lon + dx * M_LON,
  accuracyM,
  t,
});

describe('haversine', () => {
  it('1° szerokości ≈ 111 km', () => {
    expect(haversineM({ lat: 52, lon: 21 }, { lat: 53, lon: 21 })).toBeCloseTo(111_195, -2);
  });

  it('krótkie odcinki z dokładnością do metra', () => {
    expect(haversineM(at(0, 0), at(300, 400))).toBeCloseTo(500, 0);
    expect(pathLengthM([at(0, 0), at(100, 0), at(100, 100)])).toBeCloseTo(200, 0);
  });
});

describe('DistanceFilter', () => {
  it('liczy marsz po prostej (krok 10 m co 5 s)', () => {
    const f = new DistanceFilter();
    let m = 0;
    for (let i = 0; i <= 100; i++) {
      const v = f.push(at(i * 10, 0, i * 5000));
      if (v.accepted) m += v.deltaM;
    }
    expect(m).toBeCloseTo(1000, -1);
  });

  it('pierwszy odczyt zaczyna odcinek bez dystansu', () => {
    const v = new DistanceFilter().push(at(0, 0, 0));
    expect(v).toEqual({ accepted: true, deltaM: 0, newSegment: true });
  });

  it('odrzuca słabą dokładność (> 35 m) i NaN', () => {
    const f = new DistanceFilter();
    expect(f.push(at(0, 0, 0, 80))).toEqual({ accepted: false, reason: 'accuracy' });
    expect(f.push({ ...at(0, 0, 0), accuracyM: NaN })).toEqual({ accepted: false, reason: 'accuracy' });
    expect(f.push({ ...at(0, 0, 0), lat: NaN })).toEqual({ accepted: false, reason: 'invalid' });
  });

  it('drganie na postoju nie nabija dystansu', () => {
    const f = new DistanceFilter();
    const rnd = mulberry32(7);
    let m = 0;
    for (let i = 0; i < 300; i++) {
      // ±4 m wokół jednego punktu przy dokładności 12 m (próg 6 m).
      const v = f.push(at((rnd() - 0.5) * 8, (rnd() - 0.5) * 8, i * 4000, 12));
      if (v.accepted) m += v.deltaM;
    }
    expect(m).toBe(0);
  });

  it('powolny marsz krótkimi krokami nie ginie (porównanie z ostatnim przyjętym punktem)', () => {
    const f = new DistanceFilter();
    let m = 0;
    for (let i = 0; i <= 200; i++) {
      const v = f.push(at(i * 2, 0, i * 3000, 20));
      if (v.accepted) m += v.deltaM;
    }
    // 400 m w krokach po 2 m (poniżej progu 10 m) – liczone skokami co ≥ 10 m.
    expect(m).toBeGreaterThan(380);
    expect(m).toBeLessThanOrEqual(400.5);
  });

  it('odrzuca pojedynczy skok GPS i wraca do trasy', () => {
    const f = new DistanceFilter();
    f.push(at(0, 0, 0));
    expect(f.push(at(10, 0, 5000)).accepted).toBe(true);
    expect(f.push(at(400, 300, 10_000))).toEqual({ accepted: false, reason: 'jump' });
    const v = f.push(at(20, 0, 15_000));
    expect(v).toEqual({ accepted: true, deltaM: expect.any(Number), newSegment: false });
    if (v.accepted) expect(v.deltaM).toBeCloseTo(10, 0);
  });

  it('jazda autem: bez dystansu, nowy odcinek po serii skoków', () => {
    const f = new DistanceFilter();
    f.push(at(0, 0, 0));
    const verdicts = [1, 2, 3, 4, 5, 6].map((i) => f.push(at(i * 70, 0, i * 5000))); // 50 km/h
    expect(verdicts.filter((v) => v.accepted && v.deltaM > 0)).toHaveLength(0);
    expect(verdicts[2]).toEqual({ accepted: true, deltaM: 0, newSegment: true });
    // Dalej marsz od miejsca, gdzie wysiedliśmy.
    const walk = f.push(at(6 * 70 + 10, 0, 6 * 5000 + 6000));
    expect(walk.accepted).toBe(true);
  });

  it('dryf na długim postoju nie jest dystansem, a powolne zbieranie liczy się po ruszeniu', () => {
    const f = new DistanceFilter();
    f.push(at(0, 0, 0, 8));
    // 10 min postoju: dryf 15 m (> próg 8 m, ale 0,09 km/h).
    expect(f.push(at(15, 0, 600_000, 8))).toEqual({ accepted: false, reason: 'drift' });
    // Powolne zbieranie: 30 m w 6 min – jeszcze nie liczone…
    expect(f.push(at(30, 0, 960_000, 8)).accepted).toBe(false);
    // …ale po ruszeniu (300 m w 4 min) dystans od punktu odniesienia wchodzi w całości.
    const v = f.push(at(330, 0, 1_200_000, 8));
    expect(v.accepted).toBe(true);
    if (v.accepted) expect(v.deltaM).toBeCloseTo(330, 0);
  });

  it('pomija odczyty z tym samym / wcześniejszym czasem', () => {
    const f = new DistanceFilter();
    f.push(at(0, 0, 5000));
    expect(f.push(at(50, 0, 5000))).toEqual({ accepted: false, reason: 'stale' });
  });

  it('reset zaczyna nowy odcinek', () => {
    const f = new DistanceFilter();
    f.push(at(0, 0, 0));
    f.reset();
    expect(f.push(at(500, 0, 1000))).toEqual({ accepted: true, deltaM: 0, newSegment: true });
  });
});

describe('symulowany spacer', () => {
  it('ma zadaną długość i zostaje w okolicy startu', () => {
    const start = { ...O, heading: 0.3 };
    const { points } = simulateWalk(start, O, 7, { rnd: mulberry32(42), t0: 0 });
    const len = pathLengthM([O, ...points]);
    expect(len).toBeGreaterThan(6900);
    expect(len).toBeLessThan(7100);
    const far = Math.max(...points.map((p) => haversineM(O, p)));
    expect(far).toBeLessThan(1300);
    // Czas jak przy marszu 4,2 km/h.
    expect(points[points.length - 1].t / 3_600_000).toBeCloseTo(7 / 4.2, 1);
  });

  it('krok zawraca poza promieniem', () => {
    // 1,5 km na północ, idziemy dalej na północ – kierunek powinien skręcić w stronę startu.
    const p0 = at(0, 1500);
    let s: WalkState = { lat: p0.lat, lon: p0.lon, heading: 0 };
    for (let i = 0; i < 40; i++) s = nextWalkPoint(s, 20, () => 0.5, O, 900);
    expect(haversineM(O, s)).toBeLessThan(1500);
  });
});

describe('splitSegments', () => {
  it('dzieli po newSegment', () => {
    const pts = [at(0, 0), at(10, 0), { ...at(500, 0), newSegment: true }, at(510, 0)];
    expect(splitSegments(pts).map((s) => s.length)).toEqual([2, 2]);
  });
});

describe('simplifyPath', () => {
  it('prosta z drganiem → dwa punkty', () => {
    const pts = Array.from({ length: 50 }, (_, i) => at(i * 20, i % 2 ? 10 : -10));
    const s = simplifyPath(pts, 50);
    expect(s).toHaveLength(2);
  });

  it('zachowuje wyraźne zakręty', () => {
    const pts = [...Array.from({ length: 20 }, (_, i) => at(i * 25, 0)), ...Array.from({ length: 20 }, (_, i) => at(500, (i + 1) * 25))];
    const s = simplifyPath(pts, 50);
    expect(s).toHaveLength(3);
  });
});

describe('approximateRoute (prywatność)', () => {
  /** Pętla 2 km × 1 km: start = koniec (parking). */
  const loop = (): TrackPoint[] => {
    const pts: TrackPoint[] = [];
    for (let x = 0; x <= 2000; x += 10) pts.push(at(x, 0));
    for (let y = 10; y <= 1000; y += 10) pts.push(at(2000, y));
    for (let x = 1990; x >= 0; x -= 10) pts.push(at(x, 1000));
    for (let y = 990; y >= 0; y -= 10) pts.push(at(0, y));
    return pts;
  };

  it('nic nie zostaje bliżej niż 200 m od startu ani końca', () => {
    const track = loop();
    const route = approximateRoute([track], { seed: 1 });
    expect(route.length).toBeGreaterThan(0);
    const start = track[0];
    const end = track[track.length - 1];
    for (const piece of route)
      for (const p of piece) {
        // Strefa może być przesunięta o ≤ 25% promienia, ale promień ≥ 200 m → ≥ 150 m od punktu.
        expect(haversineM(start, p)).toBeGreaterThan(150);
        expect(haversineM(end, p)).toBeGreaterThan(150);
      }
  });

  it('upraszcza do kilku punktów i jest powtarzalna dla tego samego ziarna', () => {
    const track = loop();
    const a = approximateRoute([track], { seed: 9 });
    const b = approximateRoute([track], { seed: 9 });
    expect(a).toEqual(b);
    const n = a.reduce((k, s) => k + s.length, 0);
    expect(n).toBeLessThan(20);
    expect(n).toBeLessThan(track.length / 10);
  });

  it('za krótka trasa → pusto', () => {
    const short = Array.from({ length: 30 }, (_, i) => at(i * 10, 0));
    expect(approximateRoute([short], { seed: 3 })).toEqual([]);
  });

  it('wycina też parking (start / koniec każdego odcinka)', () => {
    // Odcinek 1: dom → (jazda) ; odcinek 2: spacer od parkingu 3 km dalej.
    const home = Array.from({ length: 80 }, (_, i) => at(i * 10, 0));
    const walk = Array.from({ length: 150 }, (_, i) => at(3000 + i * 10, 500));
    walk[0] = { ...walk[0], newSegment: true };
    const route = approximateRoute(splitSegments([...home, ...walk]), { seed: 5 });
    const parking = walk[0];
    for (const piece of route) for (const p of piece) expect(haversineM(parking, p)).toBeGreaterThan(150);
    // Spacer 1,5 km bez stref na końcach – zostaje ok. 1 km.
    const walkPieces = route.filter((s) => haversineM(O, s[0]) > 2000);
    const shown = walkPieces.reduce((k, s) => k + pathLengthM(s), 0);
    expect(shown).toBeGreaterThan(700);
    expect(shown).toBeLessThan(1200);
  });
});

describe('fitRoute', () => {
  it('kadr obejmuje trasę z marginesem', () => {
    const seg = [at(0, 0), at(2000, 1000)];
    const v = fitRoute([seg], 350, 170, { padPx: 20 })!;
    expect(v.center.lat).toBeCloseTo(O.lat + 500 * M_LAT, 5);
    // 2000 m / 310 px ≈ 6,5 m/px; 1000 m / 130 px ≈ 7,7 m/px → wygrywa wysokość.
    expect(v.mPerPx).toBeGreaterThan(7.5);
    expect(v.mPerPx).toBeLessThan(7.9);
    expect(v.radiusM).toBeGreaterThan(175 * v.mPerPx);
  });

  it('większy margines u góry przesuwa trasę w dół', () => {
    const seg = [at(0, 0), at(2000, 1000)];
    const even = fitRoute([seg], 350, 170, { padPx: 20 })!;
    const top = fitRoute([seg], 350, 170, { padPx: 20, padTopPx: 50 })!;
    expect(top.mPerPx).toBeGreaterThan(even.mPerPx);
    // Środek kadru na północ od środka trasy o 15 px.
    expect((top.center.lat - (O.lat + 500 * M_LAT)) / M_LAT).toBeCloseTo(15 * top.mPerPx, -1);
  });

  it('krótka trasa nie przybliża bardziej niż minMPerPx', () => {
    const v = fitRoute([[at(0, 0), at(30, 0)]], 350, 170, { minMPerPx: 3 })!;
    expect(v.mPerPx).toBe(3);
  });

  it('brak punktów → null', () => {
    expect(fitRoute([], 350, 170)).toBeNull();
  });
});
