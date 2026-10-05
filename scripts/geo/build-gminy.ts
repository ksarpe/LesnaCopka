/**
 * Granice gmin dla wykrywania lokalizacji na urządzeniu (src/geo/gminaIndex.ts).
 *
 *   npm run geo:build
 *
 * 1. PRG – Państwowy Rejestr Granic (GUGiK, dane otwarte): A01 województwa, A02 powiaty, A03 gminy.
 *    Paczka (~380 MB) trafia do .cache/geo/ i jest pobierana tylko raz.
 * 2. Uproszczenie mapshaperem (domyślnie 15 m) z zachowaniem topologii – sąsiednie gminy dzielą krawędzie.
 * 3. Lesistość gmin (%) z GUS BDL (zmienna 194828, ostatni dostępny rok).
 * 4. Slugi: bez zmian dla gmin z mocków (`suprasl`…), przy powtarzających się nazwach sufiks
 *    „-miasto” (gmina miejska) albo nazwa powiatu („jablonna-legionowski”).
 *
 * Wynik: assets/geo/gminy-index.geo, assets/geo/gminy-XX.geo (16 województw)
 * oraz src/geo/assets.generated.ts (statyczne require dla Metro).
 */
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import mapshaper from 'mapshaper';

import { GMINY as MOCK_GMINY } from '../../src/data/mock/gminy';
import type { GminaIndexFile, GminaRow, GminaShardFile } from '../../src/geo/gminaIndex';
import { encodeRing } from '../../src/geo/polyline';

const ROOT = path.resolve(__dirname, '..', '..');
const CACHE = path.join(ROOT, '.cache', 'geo');
const OUT = path.join(ROOT, 'assets', 'geo');
const PRG_URL = 'https://opendata.geoportal.gov.pl/prg/granice/00_jednostki_administracyjne.zip';
const LAYERS = ['A01_Granice_wojewodztw', 'A02_Granice_powiatow', 'A03_Granice_gmin'];
const SIMPLIFY_M = Number(process.env.SIMPLIFY_M ?? 15);
const GUS_VAR = 194828; // „lesistość w %”, poziom 6 (gminy)

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

async function download(url: string, file: string) {
  console.log(`↓ ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${url}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
}

async function ensurePrg() {
  mkdirSync(CACHE, { recursive: true });
  const shp = (l: string) => path.join(CACHE, `${l}.shp`);
  if (LAYERS.every((l) => existsSync(shp(l)))) return;
  const zip = path.join(CACHE, 'prg.zip');
  if (!existsSync(zip)) await download(PRG_URL, zip);
  const members = LAYERS.flatMap((l) => ['shp', 'shx', 'dbf', 'prj', 'cpg'].map((e) => `${l}.${e}`));
  try {
    execFileSync('unzip', ['-o', '-q', zip, ...members], { cwd: CACHE, stdio: 'inherit' });
  } catch {
    execFileSync('tar', ['-xf', zip, ...members], { cwd: CACHE, stdio: 'inherit' }); // bsdtar (Windows/macOS)
  }
}

async function run(cmd: string): Promise<Record<string, string | Buffer>> {
  return mapshaper.applyCommands(cmd);
}

async function readAttributes(layer: string) {
  const out = await run(`-i "${path.join(CACHE, layer + '.shp')}" -drop geometry -o format=json out.json`);
  return JSON.parse(String(out['out.json'])) as Record<string, string>[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJsonRetry(url: string, attempts = 6): Promise<unknown> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i >= attempts - 1) throw e;
      const wait = 2000 * 2 ** i;
      process.stdout.write(` (ponawiam za ${wait / 1000} s: ${(e as Error).message})`);
      await sleep(wait);
    }
  }
}

/** Lesistość (%) per TERYT gminy, z cache .cache/geo/gus-lesistosc.json. */
async function forestCover(): Promise<{ byTeryt: Record<string, number>; year: string }> {
  const file = path.join(CACHE, 'gus-lesistosc.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const byTeryt: Record<string, number> = {};
  let year = '';
  for (let page = 0; ; page++) {
    const url = `https://bdl.stat.gov.pl/api/v1/data/by-variable/${GUS_VAR}?unit-level=6&page-size=100&page=${page}&format=json`;
    const data = (await fetchJsonRetry(url)) as { results: { id: string; values: { year: string; val: number }[] }[]; links: { next?: string } };
    for (const u of data.results) {
      // Id jednostki BDL: „062013702093” → woj 20, powiat 02, gmina 09, rodzaj 3 → TERYT 2002093.
      const teryt = u.id.slice(2, 4) + u.id.slice(7, 9) + u.id.slice(9, 11) + u.id.slice(11, 12);
      const last = [...u.values].sort((a, b) => Number(b.year) - Number(a.year))[0];
      if (last) {
        byTeryt[teryt] = last.val;
        if (last.year > year) year = last.year;
      }
    }
    process.stdout.write(`\r  GUS: strona ${page + 1}`);
    if (!data.links.next) break;
    await sleep(600); // limit anonimowy GUS – przy zbyt szybkich zapytaniach zrywa połączenie
  }
  process.stdout.write('\n');
  const result = { byTeryt, year };
  writeFileSync(file, JSON.stringify(result));
  return result;
}

interface Feature {
  properties: { teryt: string; name: string; bb: [number, number, number, number]; ix: number; iy: number };
  geometry: { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] } | null;
}

function assignIds(rows: { teryt: string; name: string; kind: 1 | 2 | 3; powiat: string }[]) {
  const ids = new Map<string, string>();
  // Gminy z mocków (podlaskie) zachowują swoje slugi; przy parze miasto + gmina wiejska wybieramy wiejską.
  for (const g of MOCK_GMINY) {
    const match = rows
      .filter((r) => r.teryt.startsWith('20') && r.name === g.name)
      .sort((a, b) => (a.kind === 1 ? 1 : 0) - (b.kind === 1 ? 1 : 0));
    if (!match.length) throw new Error(`Brak w PRG gminy z mocków: ${g.name}`);
    ids.set(match[0].teryt, g.id);
  }
  const pinned = new Set(ids.values());
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const base = slug(r.name);
    groups.set(base, [...(groups.get(base) ?? []), r]);
  }
  for (const [base, group] of groups) {
    const free = group.filter((r) => !ids.has(r.teryt));
    const baseTaken = pinned.has(base);
    if (group.length === 1 && !baseTaken) {
      ids.set(group[0].teryt, base);
      continue;
    }
    const urban = free.filter((r) => r.kind === 1);
    const rural = free.filter((r) => r.kind !== 1);
    if (rural.length === 1 && !baseTaken) ids.set(rural[0].teryt, base);
    else for (const r of rural) ids.set(r.teryt, `${base}-${slug(r.powiat)}`);
    for (const r of urban) ids.set(r.teryt, urban.length === 1 ? `${base}-miasto` : `${base}-miasto-${slug(r.powiat)}`);
  }
  // Ostateczna gwarancja unikalności.
  const seen = new Map<string, string>();
  for (const r of rows) {
    let id = ids.get(r.teryt)!;
    if (seen.has(id)) id = `${id}-${r.teryt}`;
    seen.set(id, r.teryt);
    ids.set(r.teryt, id);
  }
  return ids;
}

async function main() {
  await ensurePrg();
  const wojAttrs = await readAttributes('A01_Granice_wojewodztw');
  const powAttrs = await readAttributes('A02_Granice_powiatow');
  const woj = Object.fromEntries(wojAttrs.map((r) => [r.JPT_KOD_JE, r.JPT_NAZWA_]));
  const powiaty = Object.fromEntries(powAttrs.map((r) => [r.JPT_KOD_JE, r.JPT_NAZWA_.replace(/^powiat\s+/i, '')]));

  const simplified = path.join(CACHE, `gminy-${SIMPLIFY_M}m.geojson`);
  if (!existsSync(simplified)) {
    console.log(`⚙ upraszczanie granic gmin (${SIMPLIFY_M} m)…`);
    const out = await run(
      `-i "${path.join(CACHE, 'A03_Granice_gmin.shp')}" ` +
        `-simplify interval=${SIMPLIFY_M} keep-shapes ` +
        `-each "teryt=JPT_KOD_JE, name=JPT_NAZWA_, bb=this.bounds, ix=this.innerX, iy=this.innerY" ` +
        `-filter-fields teryt,name,bb,ix,iy ` +
        `-o format=geojson precision=0.00001 gminy.json`,
    );
    writeFileSync(simplified, String(out['gminy.json']));
  }
  const fc = JSON.parse(readFileSync(simplified, 'utf8')) as { features: Feature[] };
  const { byTeryt: forest, year: gusYear } = await forestCover();

  const rows = fc.features.map((f) => ({
    teryt: f.properties.teryt,
    name: f.properties.name,
    kind: Number(f.properties.teryt.slice(-1)) as 1 | 2 | 3,
    powiat: powiaty[f.properties.teryt.slice(0, 4)] ?? '',
  }));
  const ids = assignIds(rows);

  const index: GminaIndexFile = {
    v: 1,
    source: `PRG (GUGiK) ${statSync(path.join(CACHE, 'A03_Granice_gmin.shp')).mtime.toISOString().slice(0, 10)} · lesistość: GUS BDL ${gusYear}`,
    simplifyM: SIMPLIFY_M,
    woj,
    powiaty,
    gminy: [],
  };
  const shards: Record<string, GminaShardFile> = {};
  let missingForest = 0;
  for (const f of fc.features) {
    const { teryt, name, bb, ix, iy } = f.properties;
    if (!f.geometry) throw new Error(`Gmina bez geometrii: ${teryt} ${name}`);
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const wojCode = teryt.slice(0, 2);
    (shards[wojCode] ??= {})[teryt] = polys.map((rings) => rings.map((ring) => encodeRing(ring.flat())));
    const pct = forest[teryt] ?? null;
    if (pct === null) missingForest++;
    const row: GminaRow = [
      teryt,
      ids.get(teryt)!,
      name,
      Number(teryt.slice(-1)) as 1 | 2 | 3,
      [round5(bb[0]), round5(bb[1]), round5(bb[2]), round5(bb[3])],
      [round5(ix), round5(iy)],
      pct,
    ];
    index.gminy.push(row);
  }
  index.gminy.sort((a, b) => a[0].localeCompare(b[0]));

  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, 'gminy-index.geo'), JSON.stringify(index));
  const codes = Object.keys(shards).sort();
  let total = 0;
  for (const code of codes) {
    const json = JSON.stringify(shards[code]);
    total += json.length;
    writeFileSync(path.join(OUT, `gminy-${code}.geo`), json);
  }
  const lines = [
    '// WYGENEROWANE przez scripts/geo/build-gminy.ts – nie edytuj ręcznie.',
    '/* eslint-disable @typescript-eslint/no-require-imports */',
    '',
    '/** Indeks gmin (metadane + bbox). */',
    "export const GMINY_INDEX_ASSET: number = require('../../assets/geo/gminy-index.geo');",
    '',
    '/** Granice gmin per województwo (kod TERYT 2 cyfry). */',
    'export const GMINY_SHARD_ASSETS: Record<string, number> = {',
    ...codes.map((c) => `  '${c}': require('../../assets/geo/gminy-${c}.geo'),`),
    '};',
    '',
  ];
  writeFileSync(path.join(ROOT, 'src', 'geo', 'assets.generated.ts'), lines.join('\n'));

  const indexKb = (JSON.stringify(index).length / 1024).toFixed(0);
  console.log(
    `✓ ${index.gminy.length} gmin · indeks ${indexKb} KB · granice ${(total / 1024 / 1024).toFixed(2)} MB w ${codes.length} paczkach` +
      ` · bez lesistości: ${missingForest}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
