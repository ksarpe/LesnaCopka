# Grzybobranie – klikalny prototyp (React Native / Expo)

Frontend-only prototyp zgamifikowanego grzybobrania. Dane gry są mockami, a skan kamerą,
rozpoznawanie AI i publikacja są **symulowane**. **Lokalizacja jest prawdziwa**: GPS urządzenia,
gmina wykrywana na telefonie z granic PRG i mapa okolicy z lasami (patrz [Lokalizacja i mapa okolicy](#lokalizacja-i-mapa-okolicy)). Wygląd odwzorowuje 1:1 plik
`Grzybobranie UI v2.dc.html` (9 ekranów, ramka iPhone 390×844).

- Expo SDK 57 · React Native 0.86 · TypeScript (strict) · expo-router
- react-native-reanimated 4 · gesture-handler · react-native-svg · expo-linear-gradient
- zustand (+ persist w AsyncStorage) · expo-haptics · fonty Baloo 2 / Nunito Sans / Material Symbols Rounded

## Uruchomienie

```bash
npm install
```

```bash
npx expo start
```

Następnie zeskanuj QR kod w **Expo Go** (iOS, SDK 57) albo naciśnij `i` (symulator iOS) / `w` (przeglądarka).
Android uruchamia się tak samo (`a`), ale nie był dopieszczany.

Kontrole jakości:

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run lint
```

## Pełna pętla do przeklikania

Start → **Rozpocznij grzybobranie** → **Skanuj grzyba** (zgoda na aparat) → skan 360° dochodzi do 100% →
spust ✦ → „Analizuję…” → **Analiza** → **Odbierz nagrodę** → **Nagroda** (XP, pasek poziomu, odznaka) →
**Zbieram dalej** → (powtórz) → **Zakończ wyprawę** → potwierdzenie → **Podsumowanie** → przełącznik trasy →
**Opublikuj w feedzie** → wpis na górze **Feedu** z adnotacją „widoczne za 24 h”.

Pierwszy skan zawsze zwraca borowika szlachetnego XXL 410 g – dokładnie scenariusz z makiety
(+250 XP, odznaka „Król Puszczy”). Kolejne skany losują gatunki deterministycznie (stały seed).

## Mapa ekranów

| # | Ekran | Plik | Prezentacja |
|---|---|---|---|
| 01 | Start / aktywna wyprawa | `app/(tabs)/index.tsx` | zakładka „Wyprawa” |
| 02 | Skan 360° | `app/scan.tsx` | modal fullscreen, fade |
| 03 | Analiza (+ niska pewność, gatunek trujący) | `app/analysis/[findId].tsx` | stack push |
| 04 | Nagroda | `app/reward/[findId].tsx` | modal fullscreen, fade |
| 05 | Podsumowanie wyprawy | `app/summary/[tripId].tsx` | stack push |
| 06 | Mapa gmin | `app/(tabs)/gminy/index.tsx` | zakładka „Gminy” |
| 07 | Szczegóły gminy | `app/(tabs)/gminy/[id].tsx` | push w zakładce (bez tab bara) |
| 08 | Profil i atlas | `app/(tabs)/profil.tsx` | zakładka „Profil” |
| 09 | Feed | `app/(tabs)/feed.tsx` | zakładka „Feed” |
| – | Karta gatunku (atlas, tylko odczyt) | `app/species/[speciesId].tsx` | stack push |
| – | Panel symulacji | `app/dev.tsx` | modal |

Panel symulacji: **przytrzymaj avatar** na ekranie Start albo wejdź w Profil → ⚙ → „Panel symulacji (dev)”.
Pozwala przełączyć źródło pozycji (GPS urządzenia / symulacja: wybrana gmina, słaby GPS ±1,5 km,
punkt za granicą), wyłączyć GPS / sieć, ustawić zgody (lokalizacja, aparat),
wymusić wynik skanu (gatunek, rzadkość, XXL, trujący, niska pewność), przyspieszyć czas ×10,
dodać dystans i XP, odblokować odznakę, wczytać scenariusze (m.in. stany z makiety) i zresetować wszystko.

Na webie (tylko dev) działają też linki-scenariusze, np. `http://localhost:8081/?scenario=designReward`
albo `/?scenario=designAnalysis&low=1` – lista w `src/dev/devLinks.ts`. Linki domyślnie używają
symulowanej pozycji (powtarzalne zrzuty); prawdziwy GPS: `&src=device`.

## Struktura

```
app/                      trasy expo-router (ekrany powyżej)
src/theme/tokens.ts       kolory, rzadkości, typografia, promienie, cienie
src/components/           Button3D/Press3D, Card, Pill, RarityPill, ProgressBar, ProgressRing, Placeholder,
                          TabBar, IconButton, SegmentedControl, Badge, Icon, Toggle, Skeleton, UiHost (toast/dialog)…
src/types.ts              modele: Species, Find, Trip, Gmina, User, Post, Badge, Quest, Rarity…
src/services/types.ts     interfejsy serwisów (kontrakt warstwy danych)
src/services/mock/        implementacje mock + „baza” mocków (posty)
src/services/live/        prawdziwe: lokalizacja (expo-location + gmina z PRG), mapa okolicy (kafle MVT)
src/geo/                  wykrywanie gminy offline, geometria, Web Mercator – czyste funkcje, testy w src/geo/__tests__
assets/geo/               granice gmin (indeks + 16 paczek województw) – generowane przez npm run geo:build
scripts/geo/              build-gminy.ts (PRG + GUS → assets/geo), verify-gminy.ts (kontrola jakości)
src/data/mock/            dane: gatunki, gminy, użytkownicy, feed, odznaki/zadania
src/store/                useUserStore, useTripStore, useSimStore (persist) + game.ts (akcje gry)
src/utils/xp.ts           logika XP/poziomów – czyste funkcje, testy w src/utils/__tests__
```

## Mock → API: gdzie podmienić

Ekrany korzystają wyłącznie z interfejsów z `src/services/types.ts` przez `useServices()`:

| Interfejs | Metody |
|---|---|
| `LocationService` | `getCurrentRegion(previous)` → gmina + pozycja, `watchDistance(cb)` |
| `MapService` | `getAreaMap({ lat, lon, radiusM, gminaTeryt })` → lasy, woda, drogi, granica gminy, odległość do lasu |
| `ScanService` | `startScan(cb, { signal })`, `capturePartial(parts)` |
| `IdentifyService` | `identify(scan)` → gatunek, pewność, wymiary, sobowtóry |
| `StatsService` | `getGminaStats(id)`, `getRanking(period)`, `getSpeciesPercentile(speciesId, gminaId, size)` |
| `FeedService` | `getFeed(scope)`, `loadNewer(scope)`, `publishTrip(trip, { hideRoute })`, `toggleReaction(postId)` |
| `CatalogService` | słowniki: gatunki, gminy, odznaki, zadania dnia, liczba gatunków |
| `PermissionService` | `get(kind)`, `request(kind)` – w mocku symulowany prompt systemowy |

Podmiana: napisz implementację `Services` (np. `src/services/api/index.ts` na `fetch`/`expo-location`/
`expo-camera`) i przekaż ją w `app/_layout.tsx`:

```tsx
<ServicesProvider value={apiServices}>
```

`Services.dev` (reset danych mocków) jest opcjonalne – API może go nie implementować.
Stan startowy gracza (`src/store/useUserStore.ts`) jest seedowany z `src/data/mock/users.ts`;
z backendem zastąp go odpowiedzią `GET /me` (XP, odznaki, atlas), a `src/store/game.ts`
(liczenie XP po stronie klienta) – wywołaniem API zwracającym `Find` z rozpiską `xp`/`reward`.

## Lokalizacja i mapa okolicy

Karta „Wykryto region” na ekranie Start:

1. **Pozycja** – `expo-location` (działa w Expo Go i na webie; web wymaga `localhost` albo https).
   Ostatnia znana pozycja (≤ 60 s, ≤ 100 m) daje kartę od razu, inaczej świeży odczyt (limit 12 s).
   Odświeżenie po powrocie aplikacji na pierwszy plan – bez ciągłego śledzenia.
2. **Gmina – offline, na urządzeniu.** Granice wszystkich 2479 gmin z PRG (GUGiK), uproszczone do 15 m
   z zachowaniem topologii: indeks 250 KB + paczka województwa 150–510 KB (łącznie 4,7 MB w `assets/geo`).
   Bbox → punkt-w-wielokącie; przy granicy histereza (nie przeskakujemy do sąsiedniej gminy, dopóki
   punkt mieści się w dokładności GPS, min. 30 m); do 200 m za granicą państwa – najbliższa gmina; dalej „Jesteś poza Polską”.
   Kontrola (`npm run geo:verify`): 20 000 losowych punktów – 0,03% błędów; punkty ≤ 60 m od granicy – błędy
   wyłącznie ≤ 10 m od prawdziwej granicy; 150/150 zgodnych z ULDK GUGiK.
3. **Mapa okolicy** – wektorowe kafle z13 (schemat OpenMapTiles, dane OSM) z OpenFreeMap, rysowane w SVG
   w stylu aplikacji: lasy, woda, drogi i drogi leśne, granica gminy (przerywana), halo dokładności GPS.
   Z tych samych kafli: „Jesteś w lesie” / „Las 400 m stąd” (promień 1,6 km). Lesistość gminy – GUS BDL.
   Bez sieci gmina i lesistość nadal działają, mapa pokazuje placeholder.

Slugi gmin: bez zmian dla gmin z mocków (`suprasl`…), przy powtarzających się nazwach sufiks
`-miasto` (gmina miejska) albo powiat (`jablonna-legionowski`); `Gmina.teryt` łączy z PRG i bazą.
Gmina spoza danych gry dostaje statystyki z generatora mocków.

Odświeżenie danych (pobiera PRG ~380 MB do `.cache/geo` tylko za pierwszym razem):

```bash
npm run geo:build
```

```bash
npm run geo:verify
```

Źródła i licencje: PRG i BDOT10k – GUGiK (dane otwarte); lesistość – GUS BDL; mapa – © OpenStreetMap
(ODbL), kafle OpenFreeMap / OpenMapTiles – podpis na karcie jest wymagany. Docelowo własne kafle
(BDOT10k + Bank Danych o Lasach) – wystarczy podmienić `TILEJSON_URL` w `src/services/live/map.ts`.

Nie jest jeszcze prawdziwe: prognoza grzybowa i „dni po deszczu” (potrzebują API pogodowego – pigułki ukryte),
dystans wyprawy (`watchDistance` nadal symulowany) i nazwy kompleksów leśnych poza gminami z mocków.

## Prywatność (wymóg produktowy)

Lokalizacja nigdy nie jest publikowana na żywo. Wpis trafia do feedu dopiero po zakończeniu wyprawy,
z dokładnością do gminy lub przybliżonej trasy. W typach: `Post.publishedAt`, `Post.visibleFrom`
(+24 h dla innych), `TripPost.routePrecision: 'gmina' | 'approximate'`; mock feedu ukrywa cudze wpisy
sprzed `visibleFrom`, a własny pokazuje od razu z adnotacją „widoczne za 24 h”.

Współrzędne GPS są tylko w pamięci (`useRegionStore`, bez persist) – gmina liczona jest na telefonie.
Serwer kafli mapy dostaje wyłącznie numery kafli (obszar ok. 3 × 3 km), nie dokładną pozycję.

## Backend (Supabase)

Schemat bazy, RLS i logika gry po stronie serwera: [docs/backend.md](docs/backend.md)
(migracja w `supabase/migrations/`, seed z mocków: `npm run db:seed`, test bez Dockera: `npm run db:test`).

Szczegóły decyzji i rozbieżności z makietą: [NOTES.md](NOTES.md).
