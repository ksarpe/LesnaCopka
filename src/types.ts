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
  /**
   * Klucz taksonu w GBIF (nazwa łacińska z katalogu, także gdy GBIF prowadzi ją jako synonim) – mapowanie na etykiety
   * modelu rozpoznawania i zbiorów testowych mimo zmian nazw łacińskich. Lista: docs/species-catalog.csv.
   */
  gbifKey?: number;
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
  /** Szacunek: z odniesienia skali na zdjęciu, bez niego – typowe wymiary gatunku. */
  dimensions: Dimensions;
  lookalikes: Lookalike[];
  /** Alternatywy przy niskiej pewności. */
  candidates: Candidate[];
  /**
   * Podpisane rozpoznanie: id wyniku zapisanego przez serwer (Edge Function `identify`) – trafia do znaleziska
   * i `find.submit`. Brak – wynik niezweryfikowany (wymuszony w panelu dev, starszy serwer, pewność < 60%).
   */
  recognitionId?: string;
  /** Kapelusz zmierzony przez model przy odniesieniu skali (dłoń, moneta, karta, nóż…), a nie typowy dla gatunku. */
  sizeMeasured?: boolean;
  /** Zdjęcie ekranu / wydruku / zdjęcie zdjęcia (wtedy wynik i tak jest odrzuceniem – pole dla porządku). */
  reproduction?: boolean;
  /** Do kiedy serwer przyjmie znalezisko z tym rozpoznaniem (kolejka offline), ISO. */
  expiresAt?: ISODate;
  /**
   * Tryb mock (bez backendu Supabase): symulacja podpisanego rozpoznania z panelu dev („z odniesieniem skali”) –
   * znalezisko liczy się jak zweryfikowane (walki o okaz na botach). W trybie Supabase nigdy.
   */
  simulated?: boolean;
}

/** Części owocnika: kapelusz z wierzchu, spód kapelusza (blaszki / rurki), trzon, podstawa trzonu. */
export type ScanPart = 'cap' | 'underside' | 'stem' | 'base';

/** Ujęcie skanu 3D: zdjęcie z obchodzenia grzyba – z boku, z góry albo nisko przy ziemi (src/scan/orbit.ts). */
export interface ScanView {
  /** Lokalny URI zdjęcia (jak Find.photoUri). */
  uri: string;
  kind: 'side' | 'top' | 'low';
  /** Azymut aparatu względem początku skanu (0–360°) – kolejność klatek w podglądzie 3D. */
  az: number;
  /** Elewacja aparatu (°): -90 = prosto z góry, 0 = poziomo. */
  el: number;
}

/** Zdjęcie do rozpoznania (spust skanu albo koniec skanu 3D). */
export interface ScanResult {
  id: string;
  capturedAt: ISODate;
  /** Zdjęcie z aparatu (lokalny URI). Brak – tylko wymuszony wynik skanu z panelu dev. */
  photoUri?: string;
  /** Skan 3D: wszystkie ujęcia z obchodzenia (photoUri jest jednym z nich); do rozpoznania idzie najwyżej 4. */
  views?: ScanView[];
}

/**
 * Wynik rozpoznania zdjęcia (IdentifyService): grzyb z gatunkiem albo odrzucenie – „to nie grzyb” lub niewyraźne
 * ujęcie (za ciemno, rozmazane, za daleko; także grzyb spoza atlasu) z powodem po polsku. Odrzucenie nie tworzy
 * znaleziska.
 */
export type IdentifyOutcome =
  | {
      kind: 'mushroom';
      identification: Identification;
      /** Części owocnika widoczne na zdjęciu – podpowiedź na Analizie, ujęcia w `find.submit`. */
      visibleParts: ScanPart[];
    }
  | { kind: 'not_mushroom' | 'unclear'; reason: string };

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
  /** Części owocnika widoczne na zdjęciu (rozpoznanie) – podpowiedź na Analizie; tylko w telefonie. */
  visibleParts?: ScanPart[];
  /**
   * Zdjęcie znaleziska z aparatu (lokalny URI) – brak = paskowany placeholder. Tryb Supabase na webie: zdjęcie
   * z serwera poza budżetem localStorage to znacznik `sb-photo:<ścieżka>` (utils/findPhoto.ts).
   */
  photoUri?: string;
  /** Skan 3D: ujęcia z obchodzenia grzyba (podgląd 3D) – tylko w telefonie, na serwer idzie samo photoUri. */
  views?: ScanView[];
  /** Tryb Supabase: ścieżka zdjęcia w prywatnym koszyku `scan-photos` (`{uid}/{findId}.jpg`), gdy jest już na serwerze. */
  photoPath?: string;
  /**
   * Id rozpoznania zapisanego przez serwer (Edge Function `identify`) – `find.submit` je przekazuje, a serwer bierze
   * gatunek, pewność, wymiary i gminę z własnego rekordu. Brak – znalezisko niezweryfikowane (wynik wymuszony w panelu
   * dev, stara wersja aplikacji).
   */
  recognitionId?: string;
  /** Gatunek i wymiary potwierdzone przez serwer (podpisane rozpoznanie) – warunek rankingów i rywalizacji. */
  verified?: boolean;
  /**
   * `verified` + kapelusz zmierzony przy odniesieniu skali + zdjęcie „na żywo” (nie ekran / wydruk) – warunek walk
   * o okaz i pojedynków „największy okaz”. W telefonie – od razu z wyniku rozpoznania; serwer potwierdza w stanie gry.
   */
  sizeVerified?: boolean;
  /** Do kiedy serwer przyjmie `find.submit` z tym rozpoznaniem (ISO, 14 dni – kolejka offline). */
  recognitionExpiresAt?: ISODate;
  /**
   * Serwer trwale odrzucił znalezisko (`find.submit`: rozpoznanie wygasło / zużyte / nieznane / wymagane) – zostaje
   * tylko w telefonie, oznaczone (bez weryfikacji i bez XP z serwera); odbiór i zdjęcie nie idą już na serwer.
   */
  serverRejected?: { code: string; reason: string; at: ISODate };
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
  /**
   * Tryb Supabase: false = za mało zweryfikowanych okazów do porównania (k-anonimowość: < 5 okazów albo < 3 znalazców) –
   * wtedy liczby jak przy braku danych (`collected` 0). Brak pola = porównanie dostępne (mocki, starszy serwer).
   */
  comparable?: boolean;
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

export type ActivityKind =
  | 'reaction'
  | 'comment'
  | 'friend_request'
  | 'friend_accepted'
  // Rywalizacja (docs/rywalizacja.md §5): pojedynki i walki o okaz.
  | 'duel_invite'
  | 'duel_accepted'
  | 'duel_finished'
  | 'contest_award'
  | 'contest_overtaken';

/** Aktywność innych wobec gracza (tryb Supabase) – źródło powiadomień społecznościowych i rywalizacji. */
export interface ActivityItem {
  /** Stabilny identyfikator (klucz powiadomienia). */
  id: string;
  kind: ActivityKind;
  actor: PostAuthor;
  postId: string | null;
  /** Treść komentarza (kind = 'comment'). */
  text: string | null;
  createdAt: ISODate;
  /** Rywalizacja: id pojedynku (`duel_*`) albo walki o okaz (`contest_*`). */
  refId?: string | null;
  /**
   * Rywalizacja – szczegóły (jsonb z serwera): `duel_invite` / `duel_accepted` – `{ kind, days }`, `duel_finished` –
   * `{ outcome, xp }`, `contest_award` – `{ place, scope, scopeName, xp, title }`, `contest_overtaken` – `{ scope, rank, title }`.
   */
  meta?: Record<string, unknown> | null;
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

/* ───────── Rywalizacja (docs/rywalizacja.md): walki o okaz, pojedynki, ranking grzybiarzy, trofea ───────── */

/** Zasięg tablicy wyników walki o okaz. */
export type ContestScope = 'gmina' | 'wojewodztwo' | 'polska' | 'znajomi';

/**
 * 'relative' – „Okaz tygodnia”: dowolny gatunek (bez kępek i gatunków chronionych), kapelusz względem typowego dla
 * gatunku w %; 'species' – jeden gatunek tygodnia, kapelusz w cm.
 */
export type ContestKind = 'relative' | 'species';

/** open – trwa; judging – tydzień minął, czekamy na rozstrzygnięcie (opóźnienie prywatności, zgłoszenia); final – wyniki i nagrody. */
export type ContestStatus = 'open' | 'judging' | 'final';

/** Walka o okaz – jedna kategoria jednego tygodnia (pon–nd, Europe/Warsaw). */
export interface Contest {
  /** Poniedziałek tygodnia + kategoria: '2026-10-05:okaz', '2026-10-05:borowik-szlachetny'. */
  id: string;
  kind: ContestKind;
  /** Gatunek kategorii (kind = 'species'), inaczej null. */
  speciesId: string | null;
  /** „Okaz tygodnia”, „Największy borowik szlachetny”. */
  title: string;
  /** Poniedziałek 00:00 Europe/Warsaw. */
  startsAt: ISODate;
  /** Koniec tygodnia (następny poniedziałek 00:00) – liczą się okazy znalezione przed tą chwilą. */
  endsAt: ISODate;
  /** Rozstrzygnięcie i nagrody. */
  resultsAt: ISODate;
  status: ContestStatus;
  /** Zgłoszone okazy w całej Polsce (widoczne dla innych). */
  entrants: number;
}

/** Zgłoszony okaz na tablicy wyników walki. */
export interface ContestEntry {
  id: string;
  contestId: string;
  findId: string;
  author: PostAuthor;
  speciesId: string;
  /** Średnica kapelusza zmierzona przez model przy odniesieniu skali (cm). */
  capCm: number;
  /** Kapelusz względem typowego dla gatunku, w % (125 = o 25% większy niż typowy). */
  relativePct: number;
  /** Wynik w tej walce: capCm (species) albo relativePct (relative). */
  score: number;
  /** Miejsce w zasięgu tablicy (1 = lider); null – okaz jeszcze niewidoczny dla innych albo w weryfikacji. */
  rank: number | null;
  gminaId: string;
  foundAt: ISODate;
  /** Zdjęcie w prywatnym koszyku `scan-photos` – adres podpisuje klient (polityka Storage dopuszcza zgłoszone okazy). */
  photoPath: string | null;
  /** Mock / własny okaz: lokalne zdjęcie z telefonu. */
  photoUri?: string;
  /** active – na tablicy; review – zgłoszony przez społeczność, ukryty do weryfikacji (widzi go tylko autor). */
  status: 'active' | 'review';
  isMine: boolean;
  /** Własny okaz przed upływem opóźnienia prywatności: od kiedy widzą go inni (null – już widoczny). */
  visibleFrom: ISODate | null;
}

export interface ContestBoard {
  contest: Contest;
  scope: ContestScope;
  /** Gmina (slug) / województwo (nazwa) zasięgu; null – Polska i znajomi. */
  scopeId: string | null;
  /** Do nagłówka: „Gmina Supraśl”, „podlaskie”, „Polska”, „Znajomi”. */
  scopeName: string;
  /** Najlepszy okaz każdego gracza, od największego (do 50). */
  entries: ContestEntry[];
  /** Okaz gracza w tej walce (także spoza listy), null – nie walczy. */
  mine: ContestEntry | null;
  /** Wszyscy gracze z okazem w tym zasięgu. */
  total: number;
}

/** Walka, do której pasuje znalezisko (ekran Nagroda, dziennik). */
export interface ContestMatch {
  contest: Contest;
  /** Wynik okazu w tej walce (cm albo %). */
  score: number;
  /** Miejsce, które okaz zajmuje (albo zająłby po zgłoszeniu) – wg okazów widocznych teraz. */
  projectedRank: { gmina: number; wojewodztwo: number; polska: number };
  /** Ten okaz jest już zgłoszony w tej walce. */
  entered: boolean;
  /** Wynik obecnie zgłoszonego okazu gracza w tej walce (inny okaz), null – brak. */
  currentBest: number | null;
}

/** Czy znalezisko może walczyć o okaz i w których walkach. */
export interface ContestEligibility {
  findId: string;
  eligible: boolean;
  /** Gdy nie: krótki powód po polsku („Na zdjęciu zabrakło odniesienia skali…”). */
  reason: string | null;
  /** Nagrody wymagają konta zabezpieczonego e-mailem (konto anonimowe – walczy, ale bez nagród). */
  prizeEligible: boolean;
  contests: ContestMatch[];
}

/** Walki tygodnia – podgląd na ekranie Rywalizacja. */
export interface ContestWeek {
  /** YYYY-MM-DD (poniedziałek). */
  weekStart: string;
  contests: Contest[];
  /** Okaz gracza w każdej walce (id walki → wpis). */
  mine: Record<string, ContestEntry>;
  /** Lider każdej walki w województwie gracza (id walki → wpis albo null). */
  leaders: Record<string, ContestEntry | null>;
  /** Ostatnio rozstrzygnięty tydzień (wyniki do obejrzenia), null – brak. */
  previousWeekStart: string | null;
}

export type TrophyPlace = 1 | 2 | 3;

/** Miejsce na podium walki o okaz (nagroda). */
export interface Trophy {
  id: string;
  contestId: string;
  contestTitle: string;
  scope: Exclude<ContestScope, 'znajomi'>;
  /** „Gmina Supraśl”, „podlaskie”, „Polska”. */
  scopeName: string;
  place: TrophyPlace;
  speciesId: string;
  capCm: number;
  /** XP nagrody (0 – podium bez nagrody, np. konto anonimowe albo lepsza nagroda w innym zasięgu). */
  xp: number;
  awardedAt: ISODate;
}

export interface TrophyCase {
  gold: number;
  silver: number;
  bronze: number;
  /** Najnowsze najpierw (do 20). */
  items: Trophy[];
}

/** biggest – największy okaz (kapelusz względem typowego, %), count – najwięcej grzybów, species – najwięcej gatunków. */
export type DuelKind = 'biggest' | 'count' | 'species';
export type DuelDays = 1 | 3 | 7;
export type DuelStatus = 'pending' | 'active' | 'finished' | 'declined' | 'cancelled' | 'expired';
export type DuelOutcome = 'won' | 'lost' | 'draw';

export interface DuelSide {
  user: PostAuthor;
  /** biggest – najlepszy kapelusz względem typowego (%), count – grzyby, species – gatunki. */
  score: number;
  /** biggest: najlepszy okaz (null – jeszcze żadnego). */
  best: { findId: string; speciesId: string; capCm: number; relativePct: number; photoPath: string | null } | null;
}

/** Pojedynek dwóch znajomych – liczą się tylko znaleziska zweryfikowane przez serwer, w oknie pojedynku. */
export interface Duel {
  id: string;
  kind: DuelKind;
  days: DuelDays;
  status: DuelStatus;
  /** Gracz wyzwał przeciwnika (false – gracz został wyzwany). */
  iAmChallenger: boolean;
  createdAt: ISODate;
  /** Zaproszenie wygasa (pending), inaczej null. */
  expiresAt: ISODate | null;
  /** Od przyjęcia. */
  startsAt: ISODate | null;
  endsAt: ISODate | null;
  finishedAt: ISODate | null;
  me: DuelSide;
  opponent: DuelSide;
  /** Po rozstrzygnięciu. */
  outcome: DuelOutcome | null;
  /** XP gracza za wynik (0 – bez nagrody: limit tygodniowy, przeciwnik bez wyniku, konto anonimowe). */
  xp: number | null;
}

export interface DuelsOverview {
  active: Duel[];
  /** Wyzwania do gracza (czekają na „Przyjmij” / „Odrzuć”). */
  incoming: Duel[];
  /** Wyzwania wysłane przez gracza. */
  outgoing: Duel[];
  /** Zakończone w ostatnich 30 dniach (także odrzucone / wygasłe / anulowane), najnowsze najpierw, do 20. */
  finished: Duel[];
  record: { won: number; lost: number; draw: number };
}

export type PlayerRankingScope = 'znajomi' | 'gmina' | 'wojewodztwo' | 'polska';
export type PlayerRankingPeriod = 'week' | 'season';

export interface PlayerRankRow {
  rank: number;
  user: PostAuthor;
  /** Punkty rankingu: XP ze zweryfikowanych znalezisk, wyzwań i nagród rywalizacji w okresie. */
  xp: number;
  isMe: boolean;
}

/** Ranking grzybiarzy (indywidualny). */
export interface PlayerRanking {
  scope: PlayerRankingScope;
  /** Gmina (slug) / województwo (nazwa); null – Polska i znajomi. */
  scopeId: string | null;
  scopeName: string;
  period: PlayerRankingPeriod;
  /** Znajomi – na żywo; zasięgi publiczne – punkty sprzed 24 h (opóźnienie prywatności). */
  live: boolean;
  /** Do 50 wierszy. */
  rows: PlayerRankRow[];
  /** Wiersz gracza (także spoza listy); null – gracz ukryty w rankingach, poza rywalizacją albo bez punktów. */
  me: PlayerRankRow | null;
  /** Punkty gracza z ostatnich 24 h – wejdą do rankingu publicznego później (0 w zakresie znajomych). */
  pendingXp: number;
  total: number;
  /** Gracz wyłączył widoczność w rankingach (Ustawienia → Prywatność). */
  hidden: boolean;
}

/** Status gracza w rywalizacji (ekran Rywalizacja, Ustawienia → Prywatność). */
export interface RivalryStatus {
  /** Widoczność w rankingach grzybiarzy i na tablicach walk w zasięgach publicznych. */
  showInRankings: boolean;
  /** ok – bierze udział; review – wyniki wstrzymane do weryfikacji (inni ich nie widzą, bez nagród). */
  standing: 'ok' | 'review';
  /** Konto zabezpieczone e-mailem – warunek nagród (XP) w walkach i pojedynkach. */
  accountSecured: boolean;
}
