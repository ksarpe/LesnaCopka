import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  distanceToBoundaryM,
  distanceToFilledRings,
  pointInMultiPolygon,
  pointInPolygon,
  windingNumber,
} from '../geometry';
import { GminaIndex, type GminaIndexFile, type GminaShardFile } from '../gminaIndex';
import { lonLatToWorld, metersPerPx, zoomForMetersPerPx } from '../mercator';
import { decodeRing, encodeRing } from '../polyline';

/** Kwadrat [x0,y0]–[x1,y1] jako pierścień płaski (zgodnie z ruchem wskazówek przy osi y w dół). */
const square = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1];

describe('polyline', () => {
  it('koduje i dekoduje pierścień z dokładnością 1e-5°', () => {
    const ring = [23.33641, 53.20972, 23.4, 53.25, 23.45001, 53.19999, 22.99999, 53.1];
    const back = decodeRing(encodeRing(ring));
    expect(back).toHaveLength(ring.length);
    back.forEach((v, i) => expect(v).toBeCloseTo(ring[i], 5));
  });

  it('pomija punkt zamykający i powtórzenia', () => {
    const closed = [1, 1, 2, 1, 2, 1, 2, 2, 1, 1];
    expect(decodeRing(encodeRing(closed))).toEqual([1, 1, 2, 1, 2, 2]);
  });
});

describe('geometria', () => {
  const outer = square(0, 0, 10, 10);
  const hole = square(4, 4, 6, 6);

  it('punkt w wielokącie z dziurą', () => {
    expect(pointInPolygon(2, 2, [outer, hole])).toBe(true);
    expect(pointInPolygon(5, 5, [outer, hole])).toBe(false);
    expect(pointInPolygon(11, 5, [outer, hole])).toBe(false);
    expect(pointInMultiPolygon(21, 1, [[outer], [square(20, 0, 22, 2)]])).toBe(true);
  });

  it('odległość od granicy w metrach', () => {
    // Kwadrat 0,02° wokół punktu na 53°N: do krawędzi wschodniej ~0,01° długości ≈ 670 m.
    const lat = 53;
    const ring = square(22.99, 52.99, 23.01, 53.01);
    const d = distanceToBoundaryM(23, lat, [[ring]]);
    expect(d).toBeGreaterThan(640);
    expect(d).toBeLessThan(700);
  });

  it('reguła nonzero: zakładki się sumują, dziury odejmują', () => {
    const cw = square(0, 0, 10, 10);
    const ccwHole = [4, 4, 4, 6, 6, 6, 6, 4];
    expect(windingNumber(5, 5, cw)).not.toBe(0);
    expect(windingNumber(5, 5, cw) + windingNumber(5, 5, ccwHole)).toBe(0);
    // Ten sam las w dwóch kaflach (zakładka) – dalej „w lesie”.
    expect(distanceToFilledRings(9, 5, [cw, square(8, 0, 18, 10)])).toBe(0);
    expect(distanceToFilledRings(5, 5, [cw, ccwHole])).toBeCloseTo(1, 5);
    expect(distanceToFilledRings(13, 5, [cw])).toBeCloseTo(3, 5);
    expect(distanceToFilledRings(0, 0, [])).toBe(Infinity);
  });
});

describe('mercator', () => {
  it('piksele świata i skala', () => {
    const p = lonLatToWorld(0, 0, 0);
    expect(p.x).toBeCloseTo(128, 6);
    expect(p.y).toBeCloseTo(128, 6);
    expect(metersPerPx(53, 13)).toBeCloseTo(11.5, 0);
    expect(metersPerPx(53, zoomForMetersPerPx(53, 9))).toBeCloseTo(9, 6);
  });
});

/* ── GminaIndex na danych syntetycznych: dwie gminy obok siebie (A: 20.00–20.10°, B: 20.10–20.20°) ── */

function syntheticIndex() {
  const file: GminaIndexFile = {
    v: 1,
    source: 'test',
    simplifyM: 0,
    woj: { '14': 'mazowieckie' },
    powiaty: { '1401': 'testowy' },
    gminy: [
      ['1401011', 'a', 'A', 1, [20, 52, 20.1, 52.1], [20.05, 52.05], 30],
      ['1401022', 'b', 'B', 2, [20.1, 52, 20.2, 52.1], [20.15, 52.05], null],
    ],
  };
  const shard: GminaShardFile = {
    '1401011': [[encodeRing(square(20, 52, 20.1, 52.1))]],
    '1401022': [[encodeRing(square(20.1, 52, 20.2, 52.1))]],
  };
  return new GminaIndex(file, async () => shard);
}

describe('GminaIndex', () => {
  it('rozpoznaje gminę i metadane', async () => {
    const hit = await syntheticIndex().locate(20.05, 52.05);
    expect(hit?.gmina).toMatchObject({ id: 'a', kind: 'miejska', powiat: 'testowy', voivodeship: 'mazowieckie' });
    expect(hit?.inside).toBe(true);
  });

  it('przy granicy zostaje przy poprzedniej gminie (histereza w zasięgu dokładności GPS)', async () => {
    const index = syntheticIndex();
    // ~50 m na wschód od granicy A|B (0,00073° na 52°N).
    const lon = 20.10073;
    expect((await index.locate(lon, 52.05))?.gmina.id).toBe('b');
    expect((await index.locate(lon, 52.05, { previousTeryt: '1401011', accuracyM: 80 }))?.gmina.id).toBe('a');
    // Dokładny GPS (10 m → margines minimalny 30 m) – granica przekroczona naprawdę.
    expect((await index.locate(lon, 52.05, { previousTeryt: '1401011', accuracyM: 10 }))?.gmina.id).toBe('b');
  });

  it('dociąga punkt tuż za granicą państwa, dalej zwraca null', async () => {
    const index = syntheticIndex();
    const near = await index.locate(20.05, 52.1015); // ~170 m na północ
    expect(near?.gmina.id).toBe('a');
    expect(near?.inside).toBe(false);
    expect(await index.locate(20.05, 52.11)).toBeNull(); // ~1,1 km
    expect(await index.locate(25, 54)).toBeNull();
  });
});

/* ── Prawdziwe dane PRG (assets/geo) ── */

function realIndex() {
  const dir = path.resolve(__dirname, '..', '..', '..', 'assets', 'geo');
  const file = JSON.parse(readFileSync(path.join(dir, 'gminy-index.geo'), 'utf8')) as GminaIndexFile;
  return new GminaIndex(file, async (woj) => JSON.parse(readFileSync(path.join(dir, `gminy-${woj}.geo`), 'utf8')));
}

describe('dane PRG', () => {
  const index = realIndex();

  it('obejmuje całą Polskę i gminy z mocków', () => {
    expect(index.list.length).toBeGreaterThan(2470);
    expect(index.byId.get('suprasl')).toMatchObject({ teryt: '2002093', kind: 'miejsko-wiejska', powiat: 'białostocki' });
    expect(new Set(index.list.map((g) => g.id)).size).toBe(index.list.length);
  });

  it.each([
    // Oczekiwane gminy sprawdzone w ULDK (GUGiK) GetCommuneByXY.
    [53.2097, 23.3364, 'suprasl'], // Supraśl, rynek
    [53.25, 23.4, 'suprasl'], // Puszcza Knyszyńska
    [53.2, 23.45, 'grodek'],
    [52.7375, 23.5813, 'hajnowka-miasto'], // Hajnówka, centrum miasta
    [52.68, 23.65, 'hajnowka'], // gmina wiejska wokół miasta
    [52.2297, 21.0122, 'warszawa'],
    [52.4, 20.9, 'jablonna-legionowski'],
    [49.2992, 19.9496, 'zakopane'],
  ])('%f, %f → %s', async (lat, lon, id) => {
    expect((await index.locate(lon, lat))?.gmina.id).toBe(id);
  });

  it('poza Polską – brak gminy', async () => {
    expect(await index.locate(25.2797, 54.6872)).toBeNull(); // Wilno
    expect(await index.locate(13.405, 52.52)).toBeNull(); // Berlin
  });

  it('punkty wewnętrzne leżą w swoich gminach', async () => {
    for (const g of index.list.filter((_, i) => i % 50 === 0)) {
      expect((await index.locate(g.inner[0], g.inner[1]))?.gmina.teryt).toBe(g.teryt);
    }
  });
});
