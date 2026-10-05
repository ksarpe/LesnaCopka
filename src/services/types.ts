/**
 * Kontrakty warstwy danych. Ekrany znają WYŁĄCZNIE te interfejsy (przez useServices()).
 * Implementacje mock: src/services/mock/*. Podmiana na API = nowa implementacja tych interfejsów
 * przekazana do <ServicesProvider value={…}> w app/_layout.tsx.
 */
import type {
  AreaMap,
  Badge,
  Dimensions,
  Gmina,
  GminaStats,
  Identification,
  Post,
  PostScope,
  Quest,
  Ranking,
  RankingPeriod,
  Region,
  ScanPart,
  ScanResult,
  Species,
  SpeciesPercentile,
  Trip,
  TripPost,
} from '@/types';

export type Unsubscribe = () => void;

export type ServiceErrorCode =
  | 'NETWORK'
  | 'GPS_OFF'
  | 'PERMISSION'
  | 'NOT_FOUND'
  | 'CANCELLED'
  /** Pozycja poza Polską (poza granicami PRG). */
  | 'OUT_OF_AREA'
  /** GPS nie ustalił pozycji w wyznaczonym czasie. */
  | 'TIMEOUT';

export class ServiceError extends Error {
  constructor(
    public code: ServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export type PermissionKind = 'location' | 'camera';
export type PermissionStatus = 'undetermined' | 'granted' | 'denied';

export interface PermissionService {
  get(kind: PermissionKind): PermissionStatus;
  /** Pokazuje systemowy prompt (w mocku – symulowany dialog). */
  request(kind: PermissionKind): Promise<PermissionStatus>;
}

export interface LocationService {
  /**
   * Pozycja i gmina. `previous` – ostatnio wykryty region: przy granicy gmin nie przeskakujemy
   * do sąsiedniej, dopóki punkt mieści się w dokładności GPS.
   */
  getCurrentRegion(previous?: Region | null): Promise<Region>;
  /** Przyrosty dystansu w km (GPS w tle podczas wyprawy). */
  watchDistance(cb: (deltaKm: number) => void): Unsubscribe;
}

export interface AreaMapRequest {
  lat: number;
  lon: number;
  /** Promień pobieranego obszaru (m). */
  radiusM: number;
  /** Gmina, której granicę dorysować. */
  gminaTeryt?: string;
}

export interface MapService {
  /** Mapa okolicy: lasy, woda, drogi i granica gminy wokół punktu + odległość do lasu. */
  getAreaMap(req: AreaMapRequest, opts?: { signal?: AbortSignal }): Promise<AreaMap>;
}

export interface ScanOptions {
  signal?: AbortSignal;
}

export interface ScanService {
  /** Skan 360°: raportuje postęp 0..1 i zaliczone części grzyba, kończy się wynikiem. */
  startScan(cb: (progress: number, parts: ScanPart[]) => void, opts?: ScanOptions): Promise<ScanResult>;
  /** Natychmiastowe zdjęcie z częściami zebranymi do tej pory (tryb dev). */
  capturePartial(parts: ScanPart[]): ScanResult;
}

export interface IdentifyService {
  /** Gatunek, pewność, wymiary, sobowtóry. */
  identify(scan: ScanResult): Promise<Identification>;
}

export interface StatsService {
  getGminaStats(id: string): Promise<GminaStats>;
  getRanking(period: RankingPeriod): Promise<Ranking>;
  getSpeciesPercentile(speciesId: string, gminaId: string, size: Dimensions): Promise<SpeciesPercentile>;
}

export interface PublishOptions {
  hideRoute: boolean;
}

export interface FeedService {
  getFeed(scope: PostScope): Promise<Post[]>;
  /** Pull-to-refresh: dociąga nowsze wpisy. */
  loadNewer(scope: PostScope): Promise<Post[]>;
  publishTrip(trip: Trip, opts: PublishOptions): Promise<TripPost>;
  toggleReaction(postId: string): Promise<{ reacted: boolean; reactions: number }>;
}

export interface CatalogService {
  getSpecies(): Promise<Species[]>;
  getGminy(): Promise<Gmina[]>;
  getBadges(): Promise<Badge[]>;
  getDailyQuests(): Promise<Quest[]>;
  /** Łączna liczba gatunków w atlasie (mianownik „23 / 120”). */
  getTotalSpecies(): Promise<number>;
}

/** Narzędzia wyłącznie dla prototypu (panel /dev). Implementacja API może je pominąć. */
export interface DevTools {
  /** Przywraca dane „serwera” do stanu startowego. */
  reset(opts?: { emptyFeed?: boolean }): void;
}

export interface Services {
  /** Inicjalizacja przed pierwszym renderem (np. odtworzenie cache, sesja). */
  init(): Promise<void>;
  dev?: DevTools;
  permissions: PermissionService;
  location: LocationService;
  map: MapService;
  scan: ScanService;
  identify: IdentifyService;
  stats: StatsService;
  feed: FeedService;
  catalog: CatalogService;
}
