/**
 * Wykrywanie gminy z pozycji GPS – w całości na urządzeniu (offline, współrzędne nie opuszczają telefonu).
 *
 * Dane z PRG (GUGiK) przygotowuje `npm run geo:build` (scripts/geo/build-gminy.ts):
 *  - indeks: metadane i prostokąty (bbox) wszystkich gmin – mały, ładowany przy pierwszym wykryciu,
 *  - 16 paczek województw z granicami (uproszczonymi z zachowaniem topologii – sąsiednie gminy
 *    mają wspólne krawędzie, więc nie ma między nimi szczelin).
 */
import type { GminaKind } from '@/types';

import { distanceToBoundaryM, M_PER_DEG_LAT, metersPerDegLon, pointInMultiPolygon, type Polygon } from './geometry';
import { decodeRing } from './polyline';

export type { GminaKind };

/** Wiersz indeksu: [teryt, id, nazwa, rodzaj 1|2|3, bbox [W,S,E,N], punkt wewnętrzny [lon,lat], lesistość %]. */
export type GminaRow = [string, string, string, 1 | 2 | 3, [number, number, number, number], [number, number], number | null];

export interface GminaIndexFile {
  v: 1;
  /** Opis źródła, np. „PRG (GUGiK) 2026-10-01 · lesistość: GUS BDL 2025”. */
  source: string;
  simplifyM: number;
  /** Kod TERYT województwa (2 cyfry) → nazwa („podlaskie”). */
  woj: Record<string, string>;
  /** Kod TERYT powiatu (4 cyfry) → nazwa bez słowa „powiat” („białostocki”, „Białystok”). */
  powiaty: Record<string, string>;
  gminy: GminaRow[];
}

/** Paczka województwa: TERYT gminy → wielokąty → zakodowane pierścienie (pierwszy zewnętrzny). */
export type GminaShardFile = Record<string, string[][]>;

export interface GminaMeta {
  /** 7 znaków: woj(2) + powiat(2) + gmina(2) + rodzaj(1), np. „2002093”. */
  teryt: string;
  /** Slug używany w aplikacji i bazie („suprasl”, przy kolizji z sufiksem: „jablonna-legionowski”). */
  id: string;
  name: string;
  kind: GminaKind;
  powiat: string;
  voivodeship: string;
  bbox: [number, number, number, number];
  inner: [number, number];
  forestPct: number | null;
}

export interface GminaHit {
  gmina: GminaMeta;
  /** Odległość (m) od granicy gminy. */
  borderM: number;
  /** false = punkt poza wielokątem, ale bliżej niż SNAP_M (uproszczona granica państwa) albo histereza. */
  inside: boolean;
}

export interface LocateOptions {
  /** Dokładność GPS (m). */
  accuracyM?: number;
  /** Poprzednio wykryta gmina – przy granicy nie przeskakujemy do sąsiedniej. */
  previousTeryt?: string | null;
}

/** Punkt poza wszystkimi wielokątami, ale tak blisko granicy, że to błąd uproszczenia / GPS. */
export const SNAP_M = 200;
/** Minimalny margines histerezy przy granicy gmin. */
export const HYSTERESIS_M = 30;

const KINDS: Record<1 | 2 | 3, GminaKind> = { 1: 'miejska', 2: 'wiejska', 3: 'miejsko-wiejska' };

export class GminaIndex {
  readonly list: GminaMeta[];
  readonly byId = new Map<string, GminaMeta>();
  readonly byTeryt = new Map<string, GminaMeta>();
  readonly bounds: [number, number, number, number];
  private shards = new Map<string, Promise<GminaShardFile>>();
  private geoms = new Map<string, Polygon[]>();

  constructor(
    readonly file: GminaIndexFile,
    private loadShard: (wojCode: string) => Promise<GminaShardFile>,
  ) {
    const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    this.list = file.gminy.map(([teryt, id, name, kind, bbox, inner, forestPct]) => {
      const m: GminaMeta = {
        teryt,
        id,
        name,
        kind: KINDS[kind],
        powiat: file.powiaty[teryt.slice(0, 4)] ?? '',
        voivodeship: file.woj[teryt.slice(0, 2)] ?? '',
        bbox,
        inner,
        forestPct,
      };
      this.byId.set(id, m);
      this.byTeryt.set(teryt, m);
      b[0] = Math.min(b[0], bbox[0]);
      b[1] = Math.min(b[1], bbox[1]);
      b[2] = Math.max(b[2], bbox[2]);
      b[3] = Math.max(b[3], bbox[3]);
      return m;
    });
    this.bounds = b;
  }

  private shard(woj: string) {
    let p = this.shards.get(woj);
    if (!p) {
      p = this.loadShard(woj);
      p.catch(() => this.shards.delete(woj));
      this.shards.set(woj, p);
    }
    return p;
  }

  /** Granice gminy (stopnie, [lon, lat]); dekodowane raz i trzymane w pamięci. */
  async geometry(teryt: string): Promise<Polygon[]> {
    const cached = this.geoms.get(teryt);
    if (cached) return cached;
    const shard = await this.shard(teryt.slice(0, 2));
    const polys = (shard[teryt] ?? []).map((rings) => rings.map(decodeRing));
    this.geoms.set(teryt, polys);
    return polys;
  }

  /** Gminy, których bbox (powiększony o marginM) zawiera punkt. */
  candidates(lon: number, lat: number, marginM: number): GminaMeta[] {
    const dLat = marginM / M_PER_DEG_LAT;
    const dLon = marginM / metersPerDegLon(lat);
    const [w, s, e, n] = this.bounds;
    if (lon < w - dLon || lon > e + dLon || lat < s - dLat || lat > n + dLat) return [];
    return this.list.filter(
      (g) => lon >= g.bbox[0] - dLon && lon <= g.bbox[2] + dLon && lat >= g.bbox[1] - dLat && lat <= g.bbox[3] + dLat,
    );
  }

  /** Gmina dla punktu albo null (poza Polską). */
  async locate(lon: number, lat: number, opts: LocateOptions = {}): Promise<GminaHit | null> {
    const accuracy = Math.max(0, opts.accuracyM ?? 0);
    const tolerance = Math.max(HYSTERESIS_M, accuracy);
    const cands = this.candidates(lon, lat, Math.max(SNAP_M, tolerance));
    if (!cands.length) return null;

    const evaluated = await Promise.all(
      cands.map(async (g) => {
        const polys = await this.geometry(g.teryt);
        return { gmina: g, inside: pointInMultiPolygon(lon, lat, polys), borderM: distanceToBoundaryM(lon, lat, polys) };
      }),
    );

    // Przy nakładaniu (artefakt uproszczenia) wygrywa gmina, w której punkt leży „głębiej”.
    const inside = evaluated.filter((e) => e.inside).sort((a, b) => b.borderM - a.borderM);
    const prev = opts.previousTeryt ? evaluated.find((e) => e.gmina.teryt === opts.previousTeryt) : undefined;

    if (inside.length) {
      const hit = inside[0];
      if (prev && prev !== hit && !prev.inside && prev.borderM <= tolerance) {
        return { gmina: prev.gmina, borderM: prev.borderM, inside: false };
      }
      return hit;
    }
    const nearest = evaluated.sort((a, b) => a.borderM - b.borderM)[0];
    if (nearest && nearest.borderM <= Math.max(SNAP_M, accuracy)) return { ...nearest, inside: false };
    return null;
  }
}
