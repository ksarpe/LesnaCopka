/**
 * Kontrola map offline na prawdziwych danych: zakres kafli z src/geo/tiles.ts (ten sam co mapa okolicy i pobieranie
 * obszarów), pobranie małego obszaru z OpenFreeMap (≤ 9 kafli, maks. 4 naraz – fair use), zapis w układzie
 * `tiles/13/x/y.pbf` (jak na telefonie) w katalogu tymczasowym, odczyt z dysku i dekodowanie parserem aplikacji
 * (src/geo/mvt.ts). Porównuje też szacunek rozmiaru z rzeczywistym.
 *
 * Uruchom: npm run maps:check            (domyślnie Supraśl)
 *          npm run maps:check -- 52.74 23.58
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { lonLatToWorld, TILE_SIZE } from '../src/geo/mercator';
import { decodeTile, LAYER_KEYS } from '../src/geo/mvt';
import { estimateBytes, parseTileKey, rangeCount, rangeKeys, tileKey, tileRangeForRadius, TILE_ZOOM } from '../src/geo/tiles';

const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
const MAX_TILES = 9;
const PARALLEL = 4;

async function main() {
  const lat = Number(process.argv[2] ?? 53.2097);
  const lon = Number(process.argv[3] ?? 23.3364);
  // Największy promień, przy którym obszar ma ≤ 9 kafli (3 × 3) – zwykle ~3 km.
  let radiusM = 4000;
  while (rangeCount(tileRangeForRadius(lat, lon, radiusM)) > MAX_TILES) radiusM -= 250;
  const range = tileRangeForRadius(lat, lon, radiusM);
  const keys = rangeKeys(range);
  console.log(`Punkt ${lat}, ${lon} · promień ${radiusM} m → ${keys.length} kafli z${TILE_ZOOM}: x ${range.x0}–${range.x1}, y ${range.y0}–${range.y1}`);
  console.log(`Szacunek przed pobraniem: ${(estimateBytes(keys.length) / 1e6).toFixed(2)} MB`);

  const tj = (await (await fetch(TILEJSON_URL)).json()) as { tiles: string[] };
  const tpl = tj.tiles[0];
  console.log(`Szablon kafli: ${tpl}`);

  const root = mkdtempSync(path.join(tmpdir(), 'grzyb-tiles-'));
  const sizes = new Map<string, number>();
  let next = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const worker = async () => {
    while (next < keys.length) {
      const key = keys[next++];
      const t = parseTileKey(key)!;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        const r = await fetch(tpl.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y)));
        const bytes = r.status === 204 || r.status === 404 ? new Uint8Array(0) : new Uint8Array(await r.arrayBuffer());
        if (!r.ok && bytes.length) throw new Error(`${key}: HTTP ${r.status}`);
        const dir = path.join(root, 'tiles', String(t.z), String(t.x));
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, `${t.y}.pbf`), bytes);
        sizes.set(key, bytes.length);
      } finally {
        inFlight--;
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  const total = [...sizes.values()].reduce((a, b) => a + b, 0);
  console.log(`Pobrano ${sizes.size} kafli, ${(total / 1e6).toFixed(2)} MB (śr. ${Math.round(total / sizes.size / 1000)} KB), maks. ${maxInFlight} naraz`);
  if (sizes.size !== keys.length) throw new Error('Nie wszystkie kafle pobrane');
  if (maxInFlight > PARALLEL) throw new Error('Za dużo pobrań naraz');

  // Odczyt z „dysku” i dekodowanie kafla pod punktem – tak jak mapa okolicy bez zasięgu.
  const w = lonLatToWorld(lon, lat, TILE_ZOOM);
  const cx = Math.floor(w.x / TILE_SIZE);
  const cy = Math.floor(w.y / TILE_SIZE);
  const centerKey = tileKey(TILE_ZOOM, cx, cy);
  if (!sizes.has(centerKey)) throw new Error(`Brak kafla pod punktem ${centerKey}`);
  const fromDisk = readFileSync(path.join(root, 'tiles', String(TILE_ZOOM), String(cx), `${cy}.pbf`));
  const data = decodeTile(new Uint8Array(fromDisk), cx, cy);
  const counts = Object.fromEntries(LAYER_KEYS.map((k) => [k, data[k].length]));
  console.log(`Kafel ${centerKey} z dysku (${fromDisk.length} B):`, counts);
  // Współrzędne w pikselach świata – w obrębie kafla (z zakładką bufora MVT).
  const inside = data.forest.flat().every((v, i) => {
    const o = (i % 2 === 0 ? cx : cy) * TILE_SIZE;
    return v >= o - 80 && v <= o + TILE_SIZE + 80;
  });
  if (!inside) throw new Error('Geometria lasu poza kaflem – złe przesunięcie');
  if (LAYER_KEYS.every((k) => data[k].length === 0)) throw new Error('Pusty kafel – sprawdź parser / punkt');

  rmSync(root, { recursive: true, force: true });
  console.log('OK – zakres kafli, pobieranie (≤ 4 naraz), zapis / odczyt z dysku i dekodowanie działają.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
