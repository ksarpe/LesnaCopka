/**
 * Kontrakty warstwy danych. Ekrany znają WYŁĄCZNIE te interfejsy (przez useServices()).
 * Implementacje mock: src/services/mock/*. Podmiana na API = nowa implementacja tych interfejsów
 * przekazana do <ServicesProvider value={…}> w app/_layout.tsx.
 */
import type {
  ActivityItem,
  AreaMap,
  Badge,
  BlockedUser,
  ChanceHorizon,
  Dimensions,
  FriendsOverview,
  FriendStatus,
  Gmina,
  GminaChances,
  GminaStats,
  IdentifyOutcome,
  MushroomForecast,
  Post,
  PostComment,
  PostScope,
  Quest,
  Ranking,
  RankingPeriod,
  Region,
  ScanResult,
  SocialUser,
  Species,
  SpeciesMap,
  SpeciesMapPeriod,
  SpeciesPercentile,
  Trip,
  TripPost,
} from '@/types';
import type { LatLon, TrackPoint } from '@/geo/track';

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
  | 'TIMEOUT'
  /** Serwer odrzucił żądanie (błąd biznesowy / wewnętrzny) – komunikat po polsku w `message`. */
  | 'SERVER'
  /** Limit serwera (np. rozpoznań na dobę) – komunikat po polsku w `message`, ponowienie później. */
  | 'RATE_LIMITED'
  /** Funkcja niedostępna w tej konfiguracji (np. rozpoznawanie bez adresu serwera). */
  | 'UNAVAILABLE'
  /** Brak zdjęcia (brak aparatu, nieudane zdjęcie, plik zniknął) – rozpoznanie go wymaga. */
  | 'NO_PHOTO';

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
  /** Stan zgody prosto z systemu, bez promptu (np. po powrocie z ustawień telefonu). */
  refresh?(kind: PermissionKind): Promise<PermissionStatus>;
  /**
   * „Otwórz ustawienia” po odmowie: ponowny prompt, gdy system jeszcze pozwala zapytać,
   * inaczej ustawienia aplikacji. Zwraca stan zgody po tej próbie.
   */
  openSettings?(kind: PermissionKind): Promise<PermissionStatus>;
}

export interface LocationService {
  /**
   * Pozycja i gmina. `previous` – ostatnio wykryty region: przy granicy gmin nie przeskakujemy
   * do sąsiedniej, dopóki punkt mieści się w dokładności GPS.
   */
  getCurrentRegion(previous?: Region | null): Promise<Region>;
  /**
   * Śledzenie wyprawy (GPS na pierwszym planie): przyrost dystansu w km i przyjęty punkt śladu
   * (po odfiltrowaniu szumu – src/geo/track.ts). Punkty zostają w pamięci, nie są publikowane.
   * `resumeFrom` – ostatni punkt śladu (symulacja kontynuuje spacer stamtąd).
   */
  watchDistance(cb: (deltaKm: number, point?: TrackPoint) => void, opts?: { resumeFrom?: LatLon }): Unsubscribe;
}

export interface AreaMapRequest {
  lat: number;
  lon: number;
  /** Promień pobieranego obszaru (m). */
  radiusM: number;
  /** Gmina, której granicę dorysować. */
  gminaTeryt?: string;
}

export interface AreaMapOptions {
  signal?: AbortSignal;
  /**
   * Tylko kafle zapisane na telefonie (obszary offline + pamięć podręczna), bez sieci i bez pamięci operacyjnej –
   * przełącznik sieci w panelu dev sprawdza tak prawdziwą ścieżkę „w lesie bez zasięgu”.
   */
  offline?: boolean;
}

export interface MapService {
  /**
   * Mapa okolicy: lasy, woda, drogi i granica gminy wokół punktu + odległość do lasu. Kafle najpierw z telefonu,
   * potem z sieci. Brak kafla pod pozycją (offline, bez mapy offline) → ServiceError('NETWORK'); brak dalszych
   * kafli → mapa z pustymi miejscami (`AreaMap.missingTiles`).
   */
  getAreaMap(req: AreaMapRequest, opts?: AreaMapOptions): Promise<AreaMap>;
  /**
   * Surowy kafel MVT z sieci (pobieranie obszarów offline – src/store/useOfflineMapsStore.ts). Co najwyżej 4 naraz
   * razem z mapą okolicy (fair use OpenFreeMap), limit 12 s na kafel. Brak sieci → ServiceError('NETWORK'),
   * przerwanie → 'CANCELLED'.
   */
  fetchTile(x: number, y: number, opts?: { signal?: AbortSignal }): Promise<Uint8Array>;
}

export interface ForecastRequest {
  lat: number;
  lon: number;
  /** Tylko symulacja (panel dev / makieta): deterministyczna prognoza gminy. Do API pogodowego nie trafia. */
  gminaId?: string;
}

export interface WeatherService {
  /**
   * Prognoza grzybowa dla okolicy punktu (Open-Meteo – src/services/live/weather.ts). Do API trafia tylko kratka 0,1°;
   * wynik z pamięci podręcznej do 3 h. Bez sieci ServiceError('NETWORK').
   */
  getForecast(req: ForecastRequest, opts?: { signal?: AbortSignal }): Promise<MushroomForecast>;
}

export interface IdentifyContext {
  /** Miesiąc 1–12 (sezon). */
  month?: number;
  /** Województwo (VOIVODESHIPS w src/geo/voivodeships.ts) – nic dokładniejszego nie wysyłamy. */
  voivodeship?: string;
}

export interface IdentifyOptions {
  signal?: AbortSignal;
  context?: IdentifyContext;
}

export interface IdentifyService {
  /**
   * Rozpoznanie zdjęcia (src/services/live/identify.ts → Edge Function `identify` → model Claude): grzyb (gatunek,
   * pewność, wymiary, sobowtóry, widoczne części) albo odrzucenie – „to nie grzyb” / niewyraźne ujęcie z powodem.
   * Błędy (ServiceError): NO_PHOTO (bez zdjęcia), UNAVAILABLE (brak serwera), NETWORK, TIMEOUT, RATE_LIMITED,
   * SERVER, CANCELLED. Wymuszony wynik z panelu dev (tylko narzędzia dev) działa bez zdjęcia i bez sieci.
   */
  identify(scan: ScanResult, opts?: IdentifyOptions): Promise<IdentifyOutcome>;
}

export interface StatsService {
  /**
   * Prawdziwe dane (Supabase): rankingi i statystyki tylko z zebranych grzybów – puste stany (gmina bez punktów,
   * brak rekordów, `collected = 0`) i opóźnienie prywatności 24 h. Brak = mocki (zawsze pełne dane, ranking z makiety).
   */
  readonly live?: boolean;
  /** Dowolna gmina z PRG (slug) – także spoza danych gry. */
  getGminaStats(id: string): Promise<GminaStats>;
  /** Ranking gmin województwa (domyślnie podlaskie – heatmapa i ranking z makiety). */
  getRanking(period: RankingPeriod, opts?: { voivodeship?: string }): Promise<Ranking>;
  getSpeciesPercentile(speciesId: string, gminaId: string, size: Dimensions): Promise<SpeciesPercentile>;
  /**
   * Szanse na gatunki na ok. 3-godzinnej wyprawie w gminie. Model liczy telefon (src/utils/chances.ts – ten sam w obu
   * trybach): sezon, rzadkość, lesistość, prognoza i zbiory gminy z ostatnich 14 dni (agregat po opóźnieniu prywatności,
   * gatunki z ≥ 2 znalazcami – zbiory w pamięci 10 min). `date` – YYYY-MM-DD (domyślnie dziś); `forecast` – prognoza
   * gminy (brak / null = typowy dzień sezonu); `horizon` – 'day' (domyślnie) albo 'week'. Bez sieci ServiceError('NETWORK').
   */
  getSpeciesChances(
    gminaId: string,
    date?: string,
    opts?: { forecast?: Pick<MushroomForecast, 'score' | 'daysAfterRain'> | null; horizon?: ChanceHorizon },
  ): Promise<GminaChances>;
  /**
   * Gdzie zbiera się gatunek: stopnie 1–4 gmin województwa i 5 gmin z największą liczbą znalezisk (agregaty po opóźnieniu
   * prywatności, gminy z < 2 znalazcami pominięte). Domyślnie sezon. Wynik w pamięci 10 min (gatunek × województwo × okres).
   */
  getSpeciesMap(speciesId: string, voivodeship: string, period?: SpeciesMapPeriod): Promise<SpeciesMap>;
}

export interface PublishOptions {
  hideRoute: boolean;
}

export interface FeedService {
  /**
   * Zaproszenia do znajomych czekają na akceptację drugiej strony (Supabase). Brak = mock: dodanie działa od razu,
   * więc UI pokazuje „Znajomi” bez stanu pośredniego „Wysłano”.
   */
  readonly twoSidedFriends?: boolean;
  getFeed(scope: PostScope): Promise<Post[]>;
  /** Pull-to-refresh: dociąga nowsze wpisy. */
  loadNewer(scope: PostScope): Promise<Post[]>;
  publishTrip(trip: Trip, opts: PublishOptions): Promise<TripPost>;
  toggleReaction(postId: string): Promise<{ reacted: boolean; reactions: number }>;
  /** Pojedynczy wpis (nagłówek ekranu komentarzy); NOT_FOUND, gdy usunięty. */
  getPost(postId: string): Promise<Post>;

  /** Komentarze wpisu, od najstarszego. */
  getComments(postId: string): Promise<PostComment[]>;
  /**
   * Komentarz gracza (maks. COMMENT_MAX znaków) – licznik `comments` wpisu rośnie.
   * `clientId` – UUID nadany w telefonie (serwer: ponowienie z tym samym id nie dubluje komentarza).
   */
  addComment(postId: string, text: string, clientId?: string): Promise<PostComment>;
  /** Usuwa własny komentarz gracza. */
  deleteComment(postId: string, commentId: string): Promise<void>;

  /** Ukrywa wpis w feedzie gracza (obu zakresach). */
  hidePost(postId: string): Promise<void>;
  /** Przywraca ukryte wpisy; bez argumentu – wszystkie. */
  unhidePosts(postIds?: string[]): Promise<void>;
  getHiddenPosts(): Promise<Post[]>;
  /** „Zgłoś” wpis (albo komentarz pod nim) do moderacji. */
  reportPost(postId: string, commentId?: string): Promise<void>;

  /** Znajomi gracza – ich wpisy tworzą zakres „Znajomi”. */
  getFriends(): Promise<SocialUser[]>;
  /** Znajomi + zaproszenia w obie strony (ekran Znajomi). Mock: bez zaproszeń. */
  getFriendsOverview(): Promise<FriendsOverview>;
  /** Szukanie grzybiarzy po nicku, imieniu i nazwisku; pusty `query` = propozycje („Mogą Cię znać”). */
  searchUsers(query: string): Promise<SocialUser[]>;
  /** Mini profil autora wpisu / komentarza. */
  getUser(userId: string): Promise<SocialUser>;
  /** Link zaproszenia (…/zaproszenie/<nick>) → grzybiarz; null = brak takiego nicku. */
  getUserByHandle(handle: string): Promise<SocialUser | null>;
  /**
   * Zaproszenie do znajomych. Zwraca grzybiarza z nowym `friendStatus`: `outgoing` (czeka na drugą stronę),
   * `friends` (on zaprosił gracza wcześniej / mock – od razu).
   */
  addFriend(userId: string): Promise<SocialUser>;
  /** Odpowiedź na zaproszenie: `friends` po akceptacji, `none` po odrzuceniu. */
  respondFriendRequest(userId: string, accept: boolean): Promise<FriendStatus>;
  /** Usunięcie znajomego albo anulowanie wysłanego zaproszenia. */
  removeFriend(userId: string): Promise<void>;
  /**
   * Blokada w obie strony: gracz i zablokowany nie widzą nawzajem swoich wpisów, komentarzy, aktywności ani siebie
   * w wyszukiwarce; znajomość i zaproszenia między nimi znikają. Idempotentne.
   */
  blockUser(userId: string): Promise<void>;
  /** Odblokowanie (znajomość nie wraca – trzeba zaprosić ponownie). Idempotentne. */
  unblockUser(userId: string): Promise<void>;
  /** Zablokowani przez gracza, od ostatnio zablokowanego. */
  getBlockedUsers(): Promise<BlockedUser[]>;
  /**
   * Aktywność innych wobec gracza (reakcje, komentarze, zaproszenia) nowsza niż `since` – źródło powiadomień.
   * Tylko backend z prawdziwymi znajomymi (Supabase); w mockach brak → powiadomienia społecznościowe symulowane.
   */
  getActivity?(since?: string): Promise<ActivityItem[]>;
}

export interface CatalogService {
  getSpecies(): Promise<Species[]>;
  getGminy(): Promise<Gmina[]>;
  getBadges(): Promise<Badge[]>;
  /** Pula zadań: dzienne i tygodniowe (losowanie gracza – src/utils/quests.ts). */
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
  weather: WeatherService;
  identify: IdentifyService;
  stats: StatsService;
  feed: FeedService;
  catalog: CatalogService;
}
