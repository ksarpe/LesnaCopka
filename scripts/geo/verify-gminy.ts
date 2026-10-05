/**
 * Kontrola jakości wykrywania gminy (assets/geo/*.geo) – uruchom po npm run geo:build:
 *
 *   npm run geo:verify            (ULDK_SAMPLES=0 wyłącza porównanie z usługą GUGiK)
 *
 * 1. Losowe punkty w Polsce: wynik GminaIndex.locate vs granice PRG w pełnej rozdzielczości.
 * 2. Punkty przy granicach (do 60 m od wierzchołka granicy) – tu uproszczenie może się mylić.
 * 3. Próbka porównana z ULDK GetCommuneByXY (GUGiK) – niezależne źródło prawdy.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import mapshaper from 'mapshaper';

import { distanceToBoundaryM, pointInMultiPolygon, type Polygon } from '../../src/geo/geometry';
import { GminaIndex, type GminaIndexFile, type GminaShardFile } from '../../src/geo/gminaIndex';
import { mulberry32 } from '../../src/utils/random';

const ROOT = path.resolve(__dirname, '..', '..');
const ASSETS = path.join(ROOT, 'assets', 'geo');
const CACHE = path.join(ROOT, '.cache', 'geo');
const RANDOM_SAMPLES = Number(process.env.RANDOM_SAMPLES ?? 20000);
const BORDER_SAMPLES = Number(process.env.BORDER_SAMPLES ?? 5000);
const ULDK_SAMPLES = Number(process.env.ULDK_SAMPLES ?? 150);

interface Truth {
  teryt: string;
  bbox: [number, number, number, number];
  polys: Polygon[];
}

async function loadTruth(): Promise<Truth[]> {
  console.log('⚙ wczytuję granice PRG w pełnej rozdzielczości…');
  const out = await mapshaper.applyCommands(
    `-i "${path.join(CACHE, 'A03_Granice_gmin.shp')}" -filter-fields JPT_KOD_JE -o format=geojson full.json`,
  );
  const fc = JSON.parse(String(out['full.json'])) as {
    features: { properties: { JPT_KOD_JE: string }; geometry: { type: string; coordinates: unknown } }[];
  };
  return fc.features.map((f) => {
    const raw = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
    const polys = raw.map((rings) => rings.map((ring) => ring.flat()));
    const bbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of polys.flatMap((p) => p.slice(0, 1))) {
      for (let i = 0; i < ring.length; i += 2) {
        bbox[0] = Math.min(bbox[0], ring[i]);
        bbox[1] = Math.min(bbox[1], ring[i + 1]);
        bbox[2] = Math.max(bbox[2], ring[i]);
        bbox[3] = Math.max(bbox[3], ring[i + 1]);
      }
    }
    return { teryt: f.properties.JPT_KOD_JE, bbox, polys };
  });
}

function truthAt(truth: Truth[], lon: number, lat: number): string | null {
  for (const t of truth) {
    if (lon < t.bbox[0] || lon > t.bbox[2] || lat < t.bbox[1] || lat > t.bbox[3]) continue;
    if (pointInMultiPolygon(lon, lat, t.polys)) return t.teryt;
  }
  return null;
}

function loadIndex() {
  const file = JSON.parse(readFileSync(path.join(ASSETS, 'gminy-index.geo'), 'utf8')) as GminaIndexFile;
  return new GminaIndex(file, async (woj) =>
    JSON.parse(readFileSync(path.join(ASSETS, `gminy-${woj}.geo`), 'utf8')) as GminaShardFile,
  );
}

const pct = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(3)}%`;

async function main() {
  const index = loadIndex();
  const truth = await loadTruth();
  const byTeryt = new Map(truth.map((t) => [t.teryt, t]));
  const rnd = mulberry32(2026);
  const [w, s, e, n] = index.bounds;

  // 1. Losowe punkty
  let inPl = 0;
  let wrong = 0;
  let missed = 0;
  let extra = 0;
  const insidePoints: [number, number, string][] = [];
  for (let i = 0; i < RANDOM_SAMPLES; i++) {
    const lon = w + rnd() * (e - w);
    const lat = s + rnd() * (n - s);
    const t = truthAt(truth, lon, lat);
    const hit = await index.locate(lon, lat);
    if (t) {
      inPl++;
      insidePoints.push([lon, lat, t]);
      if (!hit) missed++;
      else if (hit.gmina.teryt !== t) wrong++;
    } else if (hit) extra++;
  }
  console.log(
    `① losowe: ${RANDOM_SAMPLES} pkt, w Polsce ${inPl} · zła gmina ${wrong} (${pct(wrong, inPl)}) · ` +
      `brak wyniku ${missed} · poza PL, a wynik (≤200 m od granicy) ${extra}`,
  );

  // 2. Punkty przy granicach
  const errDist: number[] = [];
  let borderWrong = 0;
  let borderTotal = 0;
  for (let i = 0; i < BORDER_SAMPLES; i++) {
    const g = truth[Math.floor(rnd() * truth.length)];
    const ring = g.polys[0][0];
    const k = Math.floor((rnd() * ring.length) / 2) * 2;
    const ang = rnd() * 2 * Math.PI;
    const dist = rnd() * 60;
    const lat = ring[k + 1] + (Math.sin(ang) * dist) / 110_574;
    const lon = ring[k] + (Math.cos(ang) * dist) / (111_320 * Math.cos((lat * Math.PI) / 180));
    const t = truthAt(truth, lon, lat);
    if (!t) continue;
    borderTotal++;
    const hit = await index.locate(lon, lat);
    if (hit?.gmina.teryt !== t) {
      borderWrong++;
      // Odległość od prawdziwej granicy (pełna rozdzielczość) – błąd powinien mieścić się w uproszczeniu.
      const polys = byTeryt.get(t)!.polys;
      errDist.push(distanceToBoundaryM(lon, lat, polys));
    }
  }
  errDist.sort((a, b) => a - b);
  const p = (q: number) => (errDist.length ? errDist[Math.min(errDist.length - 1, Math.floor(q * errDist.length))].toFixed(1) : '–');
  console.log(
    `② przy granicach (≤60 m): ${borderTotal} pkt · zła gmina ${borderWrong} (${pct(borderWrong, borderTotal)}) · ` +
      `odległość błędnych od granicy: mediana ${p(0.5)} m, p95 ${p(0.95)} m, max ${p(1)} m`,
  );

  // 3. ULDK (GUGiK)
  if (ULDK_SAMPLES > 0) {
    let ok = 0;
    let diff = 0;
    let failed = 0;
    for (let i = 0; i < Math.min(ULDK_SAMPLES, insidePoints.length); i++) {
      const [lon, lat] = insidePoints[Math.floor(rnd() * insidePoints.length)];
      try {
        const url = `https://uldk.gugik.gov.pl/?request=GetCommuneByXY&xy=${lon},${lat},4326&result=teryt`;
        const body = (await (await fetch(url)).text()).trim().split('\n');
        if (body[0] !== '0') throw new Error(body.join(' '));
        const teryt = body[1].replace('_', '');
        const hit = await index.locate(lon, lat);
        if (hit?.gmina.teryt === teryt) ok++;
        else {
          diff++;
          console.log(`   ULDK ${teryt} ≠ ${hit?.gmina.teryt} @ ${lat.toFixed(5)},${lon.toFixed(5)}`);
        }
      } catch {
        failed++;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    console.log(`③ ULDK: zgodnych ${ok}, różnych ${diff}, błędów zapytań ${failed}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
