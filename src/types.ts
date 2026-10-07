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
  /**
   * Względna częstość owocnikowania w miesiącach I–XII (12 liczb 0..1, szczyt = 1).
   * Brak = domyślna krzywa sezonu (lipiec–październik) – patrz utils sezonu.
   */
  seasonWeights?: number[];
  /** Siedliska, w których rośnie (pierwsze = najczęstsze). */
  habitats?: Habitat[];
  /** Ochrona gatunkowa w Polsce – chronionego nie zbieramy (tylko zdjęcie). */
  protection?: Protection;
  /** Krótki opis do karty gatunku (1–3 zdania, cechy rozpoznawcze). */
  description?: string;
  /** Wszystkie sobowtóry (pierwszy = `lookalike`, zostaje dla zgodności). */
  lookalikes?: Lookalike[];
}

/** Siedlisko: bór (iglasty), las liściasty, mieszany, łąka / pastwisko, na drewnie, torfowisko, park / ogród. */
export type Habitat = 'iglasty' | 'lisciasty' | 'mieszany' | 'laka' | 'drewno' | 'torfowisko' | 'park';

/** Ochrona gatunkowa grzybów w Polsce (rozporządzenie o ochronie gatunkowej grzybów). */
export type Protection = 'scisla' | 'czesciowa';

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
  /** Zdjęcie z aparatu zrobione spustem (lokalny URI; brak = symulacja / brak kamery). */
  photoUri?: string;
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

/** Zdobyty stopień osiągnięcia (1-based) z nagrodą XP. */
export interface AchievementUnlock {
  id: string;
  tier: number;
  xp: number;
}

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
  /**
   * Zdjęcie znaleziska z aparatu (lokalny URI) – brak = paskowany placeholder. Tryb Supabase na webie: zdjęcie
   * z serwera poza budżetem localStorage to znacznik `sb-photo:<ścieżka>` (utils/findPhoto.ts).
   */
  photoUri?: string;
  /** Tryb Supabase: ścieżka zdjęcia w prywatnym koszyku `scan-photos` (`{uid}/{findId}.jpg`), gdy jest już na serwerze. */
  photoPath?: string;
  xp?: XpBreakdown;
  /** Informacje wyliczone przy odbiorze nagrody (do ekranu Nagroda). */
  reward?: {
    levelBefore: number;
    xpBefore: number;
    levelAfter: number;
    xpAfter: number;
    unlockedBadgeIds: string[];
    /** Stopnie osiągnięć zdobyte tym znaleziskiem (XP wypłacane po ekranie Nagroda). */
    unlockedAchievements?: AchievementUnlock[];
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
  /** Odznaka za wyzwanie – serwer może prowadzić wyzwanie bez odznaki (mocki zawsze ją mają). */
  badgeId?: string;
  badgeName?: string;
  /** Koniec wyzwania (tryb Supabase); brak = bez terminu. */
  endsAt?: ISODate;
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
  /** Pozycja na siatce 8×7 z makiety (wzór stopni heatmapy, seed bazy) – ekran Gminy rysuje już mapę z granic PRG. */
  tile?: { col: number; row: number };
  mushroomers: number;
  /** Prognoza z danych makiety (mocki, nieużywana w UI) – prawdziwa prognoza: `services.weather` (Open-Meteo). */
  forecast?: { score: number; daysAfterRain: number };
}

export interface GminaStats {
  gminaId: string;
  /** Nazwa z serwera (gmina spoza katalogu w telefonie). */
  name?: string;
  /** Miejsce w tygodniowym rankingu województwa; null = gmina bez punktów (tryb Supabase). */
  rank: number | null;
  mushroomers: number;
  mushrooms: number;
  species: number;
  /** Puste = brak rekordów w tym sezonie (tryb Supabase). */
  records: GminaRecord[];
  /** Puste = nikt jeszcze nic tu nie zebrał w tym sezonie (tryb Supabase). */
  distribution: { name: string; pct: number }[];
  challenge: GminaChallenge | null;
  /** Stan gracza z serwera (tryb Supabase); brak = mocki (stan tylko w telefonie). */
  challengeAccepted?: boolean;
  challengeCompleted?: boolean;
  followed?: boolean;
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
  /** Województwo rankingu (brak = podlaskie z makiety). */
  voivodeship?: string;
  /** Liczba grzybiarzy w gminach z mapy (podpowiedź na mapie województwa). */
  mushroomers?: Record<string, number>;
}

export interface SpeciesPercentile {
  speciesId: string;
  gminaId: string;
  /** Okazy gatunku w gminie w tym sezonie; 0 = brak danych (tryb Supabase – „pierwszy taki okaz”). */
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
  /**
   * Kafle niedostępne (offline, poza zapisaną mapą) – zostają puste. 0 / brak = mapa kompletna.
   */
  missingTiles?: number;
  /** Promień (m), w którym dane są kompletne (do najbliższego brakującego kafla); odległość do lasu tylko w nim. */
  completeRadiusM?: number;
  attribution: string;
}

/** Dzień z danych pogodowych (Open-Meteo, doba w strefie Europe/Warsaw). Brak pomiaru = null. */
export interface WeatherDay {
  /** YYYY-MM-DD */
  date: string;
  /** Suma opadów (mm) – dla dnia dzisiejszego i przyszłych to prognoza. */
  precipMm: number | null;
  tMinC: number | null;
  tMaxC: number | null;
  /** Średnia dobowa temperatura (°C). */
  tMeanC: number | null;
  /** Średnia dobowa wilgotność względna (%). */
  humidityPct: number | null;
  /** Kod pogody WMO (ikona w prognozie na najbliższe dni). */
  weatherCode: number | null;
}

export type ForecastLabel = 'Słaba' | 'Umiarkowana' | 'Dobra' | 'Bardzo dobra' | 'Wyśmienita';

/** Prognoza grzybowa (heurystyka z pogody – src/utils/forecast.ts). */
export interface MushroomForecast {
  /** 1–5 */
  score: number;
  label: ForecastLabel;
  /** Dni od ostatniego dnia z opadem ≥ 3 mm (0 = dziś, maks. 14); null = brak takiego dnia w 14 dniach. */
  daysAfterRain: number | null;
  /** Suma opadów z ostatnich 14 dni (mm, z dzisiejszym). */
  rain14Mm: number;
  /** Uzasadnienie oceny po polsku („Dużo deszczu w ostatnich 2 tygodniach (38 mm)”, „Ciepło, 14 °C”). */
  reasons: string[];
  /** Dziś i 2 kolejne dni. */
  outlook: WeatherDay[];
  /** Kiedy pobrano dane pogodowe. */
  updatedAt: ISODate;
  /** open-meteo = prawdziwe dane; sim = prognoza symulowana (panel dev / makieta). */
  source: 'open-meteo' | 'sim';
}

export interface Badge {
  id: string;
  name: string;
  icon: string;
  color: string;
  iconColor: string;
  description: string;
}

/**
 * Rodzaj zadania (postęp liczy src/utils/quests.ts – `questDelta`; serwer: enum `quest_kind`, snake_case).
 * `challenge` – przyjęte wyzwanie gminy (nie z puli zadań).
 */
export type QuestKind =
  | 'scans'
  | 'rare'
  | 'epic'
  | 'distance'
  | 'species'
  | 'tripMinutes'
  | 'newSpecies'
  | 'poisonPhoto'
  | 'awayGmina'
  | 'xxl'
  | 'edible'
  | 'variety'
  | 'publish'
  | 'reactions'
  | 'earlyStart'
  | 'trips'
  | 'challenge';

/** Zadania dnia (reset o północy) i tygodnia (reset w poniedziałek). */
export type QuestPeriod = 'daily' | 'weekly';

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
  /** Dla wyzwań gminy i zadań „znajdź gatunek”: gatunek do znalezienia. */
  speciesId?: string;
  /** Brak = dzienne. */
  period?: QuestPeriod;
  /** 1 = łatwe, 2 = średnie, 3 = trudne (losowanie dzienne: zawsze co najmniej jedno łatwe). */
  difficulty?: 1 | 2 | 3;
  /** Miesiące (1–12), w których zadanie może wypaść (sezon gatunku); brak = cały rok. */
  months?: number[];
  /** `tripMinutes`: minimalny czas wyprawy (min). */
  minutes?: number;
  /** `earlyStart`: start przed tą godziną. */
  beforeHour?: number;
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

/**
 * Avatar gracza: gotowy motyw (ikona na kolorze) albo własne zdjęcie (lokalny URI / data URI na webie; innych graczy
 * i z serwera – publiczny adres z koszyka `avatars`). `path` – ścieżka zdjęcia w Storage, gdy jest już na serwerze.
 */
export type UserAvatar = { kind: 'preset'; id: string } | { kind: 'photo'; uri: string; path?: string };

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
  /** Brak = domyślny paskowany placeholder z makiety. */
  avatar?: UserAvatar;
  /** Krótki opis w profilu (opcjonalny). */
  bio?: string;
}

export interface PostAuthor {
  id: string;
  name: string;
  level: number;
  ringRarity: Rarity | 'primary';
  /** „@ola.w” – z serwera (tryb Supabase); mocki mają go tylko w SocialUser. */
  handle?: string;
  /** Avatar autora: motyw z serwera (`avatarPreset`); własne wpisy – avatar gracza. Brak = paski z makiety. */
  avatar?: UserAvatar;
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
  /** Wyprawa, z której powstał wpis (tryb Supabase – łączy wpis czekający w telefonie z wpisem z serwera). */
  tripId?: string;
  /** Własny wpis: znalezisko, którego zdjęcie (Find.photoUri) jest okładką – lokalne zdjęcie ma pierwszeństwo. */
  coverFindId?: string;
  /** Tryb Supabase: publiczny adres okładki z koszyka `post-media` (serwer: `coverPath`). */
  coverUrl?: string;
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

export interface PostComment {
  id: string;
  postId: string;
  author: PostAuthor;
  text: string;
  createdAt: ISODate;
  /** Komentarz gracza. */
  mine?: boolean;
}

/**
 * Relacja z graczem: `outgoing` – gracz wysłał zaproszenie, `incoming` – zaprasza gracza.
 * W mockach zaproszenie jest przyjmowane od razu (`none` → `friends`).
 */
export type FriendStatus = 'none' | 'friends' | 'outgoing' | 'incoming';

/** Inny grzybiarz (znajomy, wynik wyszukiwania, mini profil z feedu). */
export interface SocialUser extends PostAuthor {
  /** Imię i nazwisko – wyszukiwanie działa też po nim (mocki; serwer go nie udostępnia → ''). */
  fullName: string;
  /** „@ola.w” */
  handle: string;
  /** '' = gmina nieznana. */
  homeGminaId: string;
  tripsCount: number;
  mushroomsCount?: number;
  /** Tylko mini profil (get_user). */
  speciesCount?: number;
  friendStatus: FriendStatus;
  /** Czy jest na liście znajomych gracza (= friendStatus === 'friends'). */
  friend: boolean;
  /** Gracz go zablokował (mini profil pokazuje „Odblokuj” zamiast przycisków znajomości). */
  blocked?: boolean;
}

/** Zablokowany grzybiarz (Ustawienia → Prywatność → Zablokowani). */
export interface BlockedUser extends PostAuthor {
  handle: string;
  blockedAt: ISODate;
}

/** Ekran Znajomi: znajomi i zaproszenia w obie strony. */
export interface FriendsOverview {
  friends: SocialUser[];
  /** Zaproszenia do gracza (czekają na „Akceptuj” / „Odrzuć”). */
  incoming: SocialUser[];
  /** Zaproszenia wysłane przez gracza. */
  outgoing: SocialUser[];
}

export type ActivityKind = 'reaction' | 'comment' | 'friend_request' | 'friend_accepted';

/** Aktywność innych wobec gracza (tryb Supabase) – źródło powiadomień społecznościowych. */
export interface ActivityItem {
  /** Stabilny identyfikator (klucz powiadomienia). */
  id: string;
  kind: ActivityKind;
  actor: PostAuthor;
  postId: string | null;
  /** Treść komentarza (kind = 'comment'). */
  text: string | null;
  createdAt: ISODate;
}

/* ───────── Szanse na gatunki i mapa gatunku (src/utils/chances.ts) – tylko agregaty gmin, nigdy punkty ───────── */

/**
 * Zbiory gatunków w gminie z ostatnich dni: tylko odebrane znaleziska po opóźnieniu prywatności, gatunki z co najmniej
 * 2 znalazcami (k-anonimowość). Za mało danych w gminie → `total = 0` i pusta lista.
 */
export interface GminaSpeciesEvidence {
  gminaId: string;
  days: number;
  /** Wszystkie znaleziska w oknie – także gatunków pominiętych na liście (< 2 znalazców). */
  total: number;
  species: { speciesId: string; finds: number; finders: number }[];
}

/** „Dziś” albo „Ten tydzień” (średnio na wyprawę w najbliższych 7 dniach). */
export type ChanceHorizon = 'day' | 'week';

export interface SpeciesChance {
  speciesId: string;
  /** Szansa trafienia gatunku na ok. 3-godzinnej wyprawie: 0,01–0,95. */
  chance: number;
  /** Oczekiwana liczba znalezisk gatunku na takiej wyprawie (λ). */
  expected: number;
  /** Krótkie uzasadnienia, najważniejsze pierwsze („Szczyt sezonu”, „Po deszczu – lubi wilgoć”). */
  reasons: string[];
  /** Gatunek jest w zbiorach gminy z ostatnich 2 tygodni (ocena nie tylko z sezonu). */
  local: boolean;
}

export interface GminaChances {
  gminaId: string;
  /** YYYY-MM-DD */
  date: string;
  horizon: ChanceHorizon;
  /** Oczekiwana liczba znalezisk (wszystkich gatunków) na typowej wyprawie. */
  expectedFinds: number;
  /** Prognoza grzybowa użyta w modelu (null = typowy dzień sezonu). */
  forecastScore: number | null;
  /** Znaleziska w gminie z ostatnich 14 dni (0 = szacunek tylko z sezonu i rzadkości). */
  evidenceTotal: number;
  /** Wszystkie gatunki katalogu, od najbardziej prawdopodobnego. */
  species: SpeciesChance[];
}

/** Okres mapy gatunku: ostatnie 7 dni albo sezon (od 1 stycznia). */
export type SpeciesMapPeriod = 'week' | 'season';

/** Gdzie zbiera się gatunek – agregaty gmin województwa (gminy z < 2 znalazcami pominięte). */
export interface SpeciesMap {
  speciesId: string;
  voivodeship: string;
  period: SpeciesMapPeriod;
  /** 1–4 (kwartyle liczby znalezisk); gminy bez wpisu = brak danych. */
  heat: Record<string, number>;
  /** Do 5 gmin z największą liczbą znalezisk. */
  top: { gminaId: string; name: string; finds: number }[];
  /** Znaleziska gatunku w pokazanych gminach. */
  total: number;
}
