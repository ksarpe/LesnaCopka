import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { pointInMultiPolygon } from '../geometry';
import { GminaIndex, type GminaIndexFile } from '../gminaIndex';
import { lonLatToWorld, metersPerPx, TILE_SIZE } from '../mercator';
import {
  AVG_TILE_BYTES,
  coverage,
  distanceToTilesPx,
  estimateBytes,
  exclusiveTiles,
  keysBbox,
  parseTileKey,
  pinnedSet,
  rangeCount,
  rangeKeys,
  segmentIntersectsRect,
  selectEvictions,
  tileBbox,
  tileKey,
  tileRangeForBbox,
  tileRangeForRadius,
  tilesForPolygons,
  TILE_ZOOM,
  URBAN_TILE_BYTES,
} from '../tiles';

/** Supraśl (rynek) – punkt z makiety. */
const SUPRASL = { lat: 53.2097, lon: 23.3364 };

/** Kafel zawierający punkt. */
function tileAt(lon: number, lat: number, z = TILE_ZOOM) {
  const w = lonLatToWorld(lon, lat, z);
  return { x: Math.floor(w.x / TILE_SIZE), y: Math.floor(w.y / TILE_SIZE) };
}

/** Prostokąt w stopniach jako pierścień [lon, lat, …]. */
const rect = (w: number, s: number, e: number, n: number) => [w, s, e, s, e, n, w, n];

describe('klucze kafli', () => {
  it('tileKey ↔ parseTileKey', () => {
    expect(tileKey(13, 4627, 2685)).toBe('13/4627/2685');
    expect(parseTileKey('13/4627/2685')).toEqual({ z: 13, x: 4627, y: 2685 });
  });

  it('odrzuca śmieci i kafle spoza siatki', () => {
    expect(parseTileKey('13/4627')).toBeNull();
    expect(parseTileKey('index.json')).toBeNull();
    expect(parseTileKey('13/8192/1')).toBeNull();
    expect(parseTileKey('../13/1/1')).toBeNull();
  });
});

describe('zakres kafli', () => {
  it('promień: ten sam zakres co mapa okolicy (kwadrat ±r wokół punktu świata)', () => {
    const c = lonLatToWorld(SUPRASL.lon, SUPRASL.lat, 13);
    const r = 1600 / metersPerPx(SUPRASL.lat, 13);
    const range = tileRangeForRadius(SUPRASL.lat, SUPRASL.lon, 1600);
    expect(range).toEqual({
      z: 13,
      x0: Math.floor((c.x - r) / 256),
      x1: Math.floor((c.x + r) / 256),
      y0: Math.floor((c.y - r) / 256),
      y1: Math.floor((c.y + r) / 256),
    });
  });

  it('karta 1,6 km: 1–4 kafle; pełny ekran 4 km: 9–16; okolica 5 km: ≤ 25 i obejmuje pełny ekran', () => {
    const card = rangeCount(tileRangeForRadius(SUPRASL.lat, SUPRASL.lon, 1600));
    const full = tileRangeForRadius(SUPRASL.lat, SUPRASL.lon, 4000);
    const around = tileRangeForRadius(SUPRASL.lat, SUPRASL.lon, 5000);
    expect(card).toBeGreaterThanOrEqual(1);
    expect(card).toBeLessThanOrEqual(4);
    expect(rangeCount(full)).toBeGreaterThanOrEqual(9);
    expect(rangeCount(full)).toBeLessThanOrEqual(16);
    expect(rangeCount(around)).toBeLessThanOrEqual(25);
    const aroundKeys = new Set(rangeKeys(around));
    expect(rangeKeys(full).every((k) => aroundKeys.has(k))).toBe(true);
  });

  it('rangeKeys: wszystkie kafle zakresu, bez powtórzeń', () => {
    const keys = rangeKeys({ z: 13, x0: 10, x1: 12, y0: 20, y1: 21 });
    expect(keys).toEqual(['13/10/20', '13/11/20', '13/12/20', '13/10/21', '13/11/21', '13/12/21']);
  });

  it('prostokąt [W,S,E,N]: narożniki w skrajnych kafelkach', () => {
    const bbox: [number, number, number, number] = [23.2, 53.1, 23.5, 53.3];
    const r = tileRangeForBbox(bbox);
    const nw = tileAt(bbox[0], bbox[3]);
    const se = tileAt(bbox[2], bbox[1]);
    expect(r).toEqual({ z: 13, x0: nw.x, x1: se.x, y0: nw.y, y1: se.y });
  });

  it('tileBbox odwraca rzutowanie: punkt leży w prostokącie swojego kafla', () => {
    const t = tileAt(SUPRASL.lon, SUPRASL.lat);
    const [w, s, e, n] = tileBbox(t.x, t.y, 13);
    expect(SUPRASL.lon).toBeGreaterThanOrEqual(w);
    expect(SUPRASL.lon).toBeLessThan(e);
    expect(SUPRASL.lat).toBeGreaterThan(s);
    expect(SUPRASL.lat).toBeLessThanOrEqual(n);
    // ~3 km na boku w Polsce
    const km = ((e - w) * 111.32 * Math.cos((SUPRASL.lat * Math.PI) / 180));
    expect(km).toBeGreaterThan(2.7);
    expect(km).toBeLessThan(3.3);
  });

  it('keysBbox: suma prostokątów kafli', () => {
    const b = keysBbox(['13/10/20', '13/12/21'])!;
    const a = tileBbox(10, 20, 13);
    const c = tileBbox(12, 21, 13);
    expect(b).toEqual([a[0], c[1], c[2], a[3]]);
    expect(keysBbox([])).toBeNull();
  });
});

describe('kafle gminy (wielokąt)', () => {
  it('odcinek a prostokąt', () => {
    expect(segmentIntersectsRect(-1, 0.5, 2, 0.5, 0, 0, 1, 1)).toBe(true); // przez środek
    expect(segmentIntersectsRect(-1, -0.5, 0.5, 1.5, 0, 0, 1, 1)).toBe(true); // przez narożnik, bez wierzchołka w środku
    expect(segmentIntersectsRect(2, 2, 3, 3, 0, 0, 1, 1)).toBe(false);
    expect(segmentIntersectsRect(-1, 2, 2, 2.5, 0, 0, 1, 1)).toBe(false);
    expect(segmentIntersectsRect(0.2, 0.2, 0.3, 0.3, 0, 0, 1, 1)).toBe(true); // w całości w środku
  });

  it('wielokąt w kształcie L pomija pusty kafel w „wycięciu”', () => {
    // 3 × 3 kafle wokół Supraśla, z wyciętym prawym górnym kafelkiem.
    const t = tileAt(SUPRASL.lon, SUPRASL.lat);
    const [w] = tileBbox(t.x - 1, t.y - 1, 13);
    const [, , e] = tileBbox(t.x + 1, t.y + 1, 13);
    const n = tileBbox(t.x - 1, t.y - 1, 13)[3];
    const s = tileBbox(t.x + 1, t.y + 1, 13)[1];
    const notch = tileBbox(t.x + 1, t.y - 1, 13);
    const eps = 1e-6;
    // Pierścień omija prawy górny kafel (z marginesem, żeby nie dotykać jego krawędzi).
    const ring = [w + eps, s + eps, e - eps, s + eps, e - eps, notch[1] - eps, notch[0] - eps, notch[1] - eps, notch[0] - eps, n - eps, w + eps, n - eps];
    const keys = tilesForPolygons([[ring]]);
    expect(keys).toHaveLength(8);
    expect(keys).not.toContain(tileKey(13, t.x + 1, t.y - 1));
    expect(keys).toContain(tileKey(13, t.x, t.y));
  });

  it('kafel w całości wewnątrz (bez wierzchołków granicy) też się liczy', () => {
    const t = tileAt(SUPRASL.lon, SUPRASL.lat);
    const outer = tileBbox(t.x - 2, t.y - 2, 13);
    const outer2 = tileBbox(t.x + 2, t.y + 2, 13);
    const keys = tilesForPolygons([[rect(outer[0] + 1e-6, outer2[1] + 1e-6, outer2[2] - 1e-6, outer[3] - 1e-6)]]);
    expect(keys).toHaveLength(25);
  });

  it('prawdziwa gmina z PRG (Supraśl): mniej kafli niż prostokąt, wszystkie dotykają gminy', async () => {
    const dir = path.resolve(__dirname, '..', '..', '..', 'assets', 'geo');
    const file = JSON.parse(readFileSync(path.join(dir, 'gminy-index.geo'), 'utf8')) as GminaIndexFile;
    const index = new GminaIndex(file, async (woj) => JSON.parse(readFileSync(path.join(dir, `gminy-${woj}.geo`), 'utf8')));
    const meta = index.byId.get('suprasl')!;
    const polys = await index.geometry(meta.teryt);
    const keys = tilesForPolygons(polys);
    const box = rangeCount(tileRangeForBbox(meta.bbox));
    expect(keys.length).toBeGreaterThan(10);
    expect(keys.length).toBeLessThanOrEqual(box);
    expect(keys.length).toBeLessThan(400);
    // Punkt wewnętrzny gminy i rynek Supraśla są w wybranych kaflach.
    const inner = tileAt(meta.inner[0], meta.inner[1]);
    expect(keys).toContain(tileKey(13, inner.x, inner.y));
    const town = tileAt(SUPRASL.lon, SUPRASL.lat);
    expect(keys).toContain(tileKey(13, town.x, town.y));
    // Każdy kafel poza wybranymi (w prostokącie) nie ma środka w gminie.
    const chosen = new Set(keys);
    for (const k of rangeKeys(tileRangeForBbox(meta.bbox))) {
      if (chosen.has(k)) continue;
      const { x, y } = parseTileKey(k)!;
      const b = tileBbox(x, y, 13);
      expect(pointInMultiPolygon((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, polys)).toBe(false);
    }
  });
});

describe('szacunek i obszary', () => {
  it('rozmiar: kafle × średnia (gmina miejska – gęstsze kafle)', () => {
    expect(estimateBytes(24)).toBe(24 * AVG_TILE_BYTES);
    expect(estimateBytes(24, 'wiejska')).toBe(24 * AVG_TILE_BYTES);
    expect(estimateBytes(10, 'miejska')).toBe(10 * URBAN_TILE_BYTES);
    expect(estimateBytes(-3)).toBe(0);
  });

  it('usuwanie obszaru: tylko kafle nieużywane przez inne obszary', () => {
    const a = ['13/1/1', '13/1/2', '13/2/2', '13/1/2'];
    const b = ['13/1/2', '13/5/5'];
    const c = ['13/2/2'];
    expect(exclusiveTiles(a, [b, c])).toEqual(['13/1/1']);
    expect(exclusiveTiles(a, [])).toEqual(['13/1/1', '13/1/2', '13/2/2']);
    expect(exclusiveTiles(b, [a])).toEqual(['13/5/5']);
  });

  it('przypięte = suma kafli obszarów; pokrycie', () => {
    const pinned = pinnedSet([{ tiles: ['13/1/1', '13/1/2'] }, { tiles: ['13/1/2', '13/3/3'] }]);
    expect([...pinned].sort()).toEqual(['13/1/1', '13/1/2', '13/3/3']);
    expect(coverage(['13/1/1', '13/9/9', '13/3/3'], (k) => pinned.has(k))).toEqual({ have: 2, total: 3 });
  });

  it('odległość do brakujących kafli (piksele świata)', () => {
    expect(distanceToTilesPx(100, 100, ['13/0/0'])).toBe(0);
    expect(distanceToTilesPx(100, 100, ['13/1/0'])).toBe(156); // krawędź x = 256
    expect(distanceToTilesPx(300, 300, ['13/0/0'])).toBeCloseTo(Math.hypot(44, 44), 6);
    expect(distanceToTilesPx(0, 0, [])).toBe(Infinity);
  });
});

describe('LRU pamięci podręcznej', () => {
  const entries = [
    { key: 'a', bytes: 10, usedAt: 5 },
    { key: 'b', bytes: 10, usedAt: 1 },
    { key: 'c', bytes: 10, usedAt: 3 },
    { key: 'pinned-old', bytes: 100, usedAt: 0 },
  ];

  it('w limicie – nic', () => {
    expect(selectEvictions(entries, new Set(['pinned-old']), 30)).toEqual([]);
  });

  it('ponad limit – najdawniej używane, z pominięciem przypiętych (nie liczą się do limitu)', () => {
    expect(selectEvictions(entries, new Set(['pinned-old']), 20)).toEqual(['b']);
    expect(selectEvictions(entries, new Set(['pinned-old']), 5)).toEqual(['b', 'c', 'a']);
  });

  it('bez przypięcia – stary duży kafel wypada pierwszy', () => {
    expect(selectEvictions(entries, new Set(), 30)).toEqual(['pinned-old']);
  });
});
