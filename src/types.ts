/**
 * Modele domenowe. Kształt jest neutralny względem źródła danych –
 * mocki i przyszłe API zwracają dokładnie te typy.
 */

export type Rarity = 'pospolity' | 'rzadki' | 'epicki' | 'legendarny';

export type Edibility = 'jadalny' | 'niejadalny' | 'trujacy' | 'smiertelny';

export type ISODate = string;

export interface Lookalike {
  name: string;
  edibility: Edibility;
  /** Jak odróżnić – wyświetlane w żółtym banerze bezpieczeństwa. */
  tip: string;
}

export interface Species {
  id: string;
  name: string;
  latin: string;
  /** Krótka nazwa w dopełniaczu/mianowniku do etykiet XP, np. „borowik”. */
  shortName: string;
  rarity: Rarity;
  edibility: Edibility;
  habitat: string;
  lookalike?: Lookalike;
  /** Gatunki zbierane w kępkach liczymy w sztukach (np. kurki). */
  clustered?: boolean;
  /** Typowe wymiary okazu – używane przez mock rozpoznawania. */
  typical: { capCm: number; heightCm: number; weightG: number };
}

export interface Dimensions {
  capCm: number;
  heightCm: number;
  weightG: number;
  ageDays: number;
  pieces?: number;
}

export interface Candidate {
  speciesId: string;
  confidence: number;
}

export interface Identification {
  speciesId: string;
  /** 0..1 */
  confidence: number;
  rarity: Rarity;
  xxl: boolean;
  dimensions: Dimensions;
  lookalikes: Lookalike[];
  /** Alternatywy przy niskiej pewności. */
  candidates: Candidate[];
}

export type ScanPart = 'cap' | 'underside' | 'stem' | 'base';

export interface ScanResult {
  id: string;
  parts: ScanPart[];
  capturedAt: ISODate;
}

export interface XpLine {
  label: string;
  xp: number;
}

export interface XpBreakdown {
  lines: XpLine[];
  total: number;
}

export type FindStatus = 'pending' | 'claimed';

export interface Find {
  id: string;
  tripId: string | null;
  speciesId: string;
  gminaId: string;
  rarity: Rarity;
  confidence: number;
  xxl: boolean;
  dimensions: Dimensions;
  /** false = gatunek trujący: tylko zdjęcie, nie trafia do koszyka. */
  collected: boolean;
  status: FindStatus;
  foundAt: ISODate;
  /** Alternatywy z rozpoznania (ekran niskiej pewności). */
  candidates?: Candidate[];
  xp?: XpBreakdown;
  /** Informacje wyliczone przy odbiorze nagrody (do ekranu Nagroda). */
  reward?: {
    levelBefore: number;
    xpBefore: number;
    levelAfter: number;
    xpAfter: number;
    unlockedBadgeIds: string[];
    completedQuestIds: string[];
    personalRecord: boolean;
  };
}

export type TripStatus = 'active' | 'finished' | 'published';

/** Dokładność trasy w publikacji – nigdy dokładny ślad GPS. */
export type RoutePrecision = 'gmina' | 'approximate';

export interface Trip {
  id: string;
  gminaId: string;
  status: TripStatus;
  startedAt: ISODate;
  endedAt?: ISODate;
  /** Czas symulowany (uwzględnia przyspieszenie ×10 z panelu dev). */
  elapsedMs: number;
  /** Znacznik rzeczywistego czasu, od którego liczymy bieżący odcinek. */
  segmentStartedAt: number;
  distanceKm: number;
  findIds: string[];
  xp: number;
  hideRoute: boolean;
  postId?: string;
}

export interface GminaRecord {
  rarity: Rarity;
  speciesName: string;
  value: string;
  author: string;
  when: string;
}

export interface GminaChallenge {
  id: string;
  title: string;
  speciesId: string;
  description: string;
  xp: number;
  badgeId: string;
  badgeName: string;
}

export type GminaKind = 'miejska' | 'wiejska' | 'miejsko-wiejska';

export interface Gmina {
  /** Slug („suprasl”; przy powtarzającej się nazwie z sufiksem, np. „jablonna-legionowski”). */
  id: string;
  name: string;
  /** Kod TERYT z PRG (7 znaków), np. „2002093”. */
  teryt?: string;
  kind?: GminaKind;
  /** Nazwa powiatu bez słowa „powiat” („białostocki”). */
  powiat?: string;
  /** Kompleks leśny („Puszcza Knyszyńska”) – na razie tylko dla gmin z danymi gry. */
  forest?: string;
  voivodeship: string;
  /** Lesistość w % (GUS BDL). */
  forestPct?: number | null;
  /** Pozycja na heatmapie (kolumna/wiersz siatki 8×7) – tylko gminy z heatmapy. */
  tile?: { col: number; row: number };
  mushroomers: number;
  /** Prognoza grzybowa – jeszcze bez źródła danych (API pogodowe). */
  forecast?: { score: number; daysAfterRain: number };
}

export interface GminaStats {
  gminaId: string;
  rank: number;
  mushroomers: number;
  mushrooms: number;
  species: number;
  records: GminaRecord[];
  distribution: { name: string; pct: number }[];
  challenge: GminaChallenge | null;
}

export type RankingPeriod = 'week' | 'season' | 'records';

export interface RankingRow {
  gminaId: string;
  rank: number;
  name: string;
  sub: string;
  points: string;
  trend: number | null;
}

export interface Ranking {
  period: RankingPeriod;
  rows: RankingRow[];
  /** 0–4 dla każdej gminy na heatmapie. */
  heat: Record<string, number>;
  userContribution: number;
}

export interface SpeciesPercentile {
  speciesId: string;
  gminaId: string;
  collected: number;
  mushroomers: number;
  /** Pozycja okazu w gminie w sezonie (1 = największy). */
  sizeRank: number;
  /** 0..100 */
  percentile: number;
  biggerCount: number;
}

/** Pozycja GPS – tylko w pamięci, nigdy nie zapisywana ani publikowana. */
export interface GeoPosition {
  lat: number;
  lon: number;
  /** Promień niepewności (m). */
  accuracyM: number;
  at: ISODate;
}

export interface Region {
  gmina: Gmina;
  position: GeoPosition;
  /** Punkt bliżej granicy gminy niż dokładność GPS. */
  nearBorder: boolean;
  /** 'device' = GPS urządzenia, 'sim' = punkt z panelu symulacji. */
  source: 'device' | 'sim';
}

/**
 * Geometria mapy okolicy w pikselach świata Web Mercator (kafle 256 px) na poziomie `zoom`.
 * Każda ścieżka to płaska tablica [x0, y0, x1, y1, …]. Pierścienie wielokątów zachowują kierunek
 * z kafli MVT (zewnętrzne zgodnie z ruchem wskazówek zegara, dziury przeciwnie) → reguła `nonzero`.
 */
export interface AreaMap {
  zoom: number;
  /** Punkt, wokół którego pobrano mapę (piksele świata). */
  center: { x: number; y: number };
  /** Metry na piksel na poziomie `zoom` (na szerokości geograficznej środka). */
  metersPerPx: number;
  forest: number[][];
  water: number[][];
  /** Rzeki i strumienie (linie). */
  waterways: number[][];
  /** Drogi publiczne (linie). */
  roads: number[][];
  /** Drogi leśne, ścieżki (linie). */
  tracks: number[][];
  /** Granica wykrytej gminy (pierścienie). */
  boundary: number[][];
  /** Odległość do najbliższego lasu (m): 0 = w lesie, null = brak lasu w pobranym obszarze. */
  forestDistanceM: number | null;
  /** Zasięg pobranych danych (m) – dalej nie szukamy lasu. */
  radiusM: number;
  attribution: string;
}

export interface Badge {
  id: string;
  name: string;
  icon: string;
  color: string;
  iconColor: string;
  description: string;
}

export type QuestKind = 'scans' | 'rare' | 'distance' | 'challenge';

export interface Quest {
  id: string;
  kind: QuestKind;
  title: string;
  icon: string;
  iconFilled?: boolean;
  iconBg: string;
  iconColor: string;
  xp: number;
  target: number;
  /** Dla wyzwań gminy: gatunek do znalezienia. */
  speciesId?: string;
}

export interface QuestProgress {
  questId: string;
  progress: number;
  completed: boolean;
}

export interface AtlasEntry {
  count: number;
  firstFoundAt: ISODate;
  bestCapCm: number;
  bestWeightG: number;
}

export interface User {
  id: string;
  name: string;
  firstName: string;
  handle: string;
  level: number;
  /** XP w obrębie bieżącego poziomu. */
  xp: number;
  streakDays: number;
  tripsCount: number;
  mushroomsCount: number;
  homeGminaId: string;
}

export interface PostAuthor {
  id: string;
  name: string;
  level: number;
  ringRarity: Rarity | 'primary';
}

export type PostScope = 'friends' | 'gmina';

interface PostBase {
  id: string;
  author: PostAuthor;
  gminaId: string;
  createdAt: ISODate;
  /** Kiedy wpis został wysłany do serwera. */
  publishedAt: ISODate;
  /** Od kiedy wpis widzą inni (opóźnienie prywatności). */
  visibleFrom: ISODate;
  scopes: PostScope[];
}

export interface TripPost extends PostBase {
  kind: 'trip';
  title: string;
  distanceKm: number;
  durationMin: number;
  mushrooms: number;
  species: number;
  xp: number;
  routePrecision: RoutePrecision;
  highlight?: { rarity: Rarity; text: string };
  reactions: number;
  reacted: boolean;
  comments: number;
  mine?: boolean;
}

export interface LevelUpPost extends PostBase {
  kind: 'levelup';
  level: number;
  badgeName?: string;
}

export interface CompactPost extends PostBase {
  kind: 'compact';
  distanceKm: number;
  mushrooms: number;
  species: number;
  xp: number;
  thumbs: Rarity[];
}

export type Post = TripPost | LevelUpPost | CompactPost;
